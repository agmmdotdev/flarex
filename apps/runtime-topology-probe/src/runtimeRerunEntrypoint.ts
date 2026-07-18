import { RpcTarget, WorkerEntrypoint } from "cloudflare:workers";

import { copyCloudflareRpcRecord } from "./effectBoundary";
import { readBoundedJson } from "./http";
import { elapsedPerformanceDurationSince } from "./performanceDuration";
import {
  decodeProbeRerunSessionResponseV1OrNull,
  decodeProbeRuntimeRerunRequestV1OrNull,
  decodeProbeRuntimeRerunResponseV1OrNull,
  probeRerunFacetReceiptMatchesRequest,
  ProbeRuntimeRerunResponseV1Schema,
  type ProbeRuntimeRerunRequestV1,
  type ProbeRuntimeRerunResponseV1,
} from "./rerunProtocol";
import type { ProbeSessionDO, ProbeSessionEnv } from "./sessionDO";
import { ProbeDurationMsSchema } from "./protocol";
import { ProbeOneShotInvocationGate } from "./rerunGuards";

const MAX_INTERNAL_RESPONSE_BYTES = 8_192;

export interface ProbeRuntimeRerunEnv extends ProbeSessionEnv {
  readonly PROBE_SESSIONS: DurableObjectNamespace<ProbeSessionDO>;
}

export abstract class ProbeRuntimeRerunCapability extends RpcTarget {
  abstract invoke(): Promise<ProbeRuntimeRerunResponseV1>;
}

export class OneShotProbeRuntimeRerunCapability
  extends ProbeRuntimeRerunCapability
{
  private readonly gate = new ProbeOneShotInvocationGate();

  constructor(
    private readonly runtime: Service<typeof ProbeRuntimeRerunEntrypoint>,
    private readonly request: ProbeRuntimeRerunRequestV1,
  ) {
    super();
  }

  async invoke(): Promise<ProbeRuntimeRerunResponseV1> {
    return await this.gate.run(async () => {
      const rawResponse = await this.runtime.rerun(this.request);
      const response = decodeProbeRuntimeRerunResponseV1OrNull(
        copyCloudflareRpcRecord(rawResponse),
      );
      if (response === null) {
        throw new Error("invalid runtime rerun response");
      }
      return response;
    });
  }
}

export class ProbeRuntimeRerunEntrypoint
  extends WorkerEntrypoint<ProbeRuntimeRerunEnv>
{
  async rerun(value: unknown): Promise<ProbeRuntimeRerunResponseV1> {
    const request = decodeProbeRuntimeRerunRequestV1OrNull(value);
    if (request === null) throw new Error("invalid runtime rerun request");
    const session = this.env.PROBE_SESSIONS.getByName(request.sessionId);
    const startedAt = performance.now();
    const response = await session.fetch(
      new Request("https://probe-session.internal/v1/rerun", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
    if (!response.ok) throw new Error("runtime rerun session failed");
    const body = await readBoundedJson(response, MAX_INTERNAL_RESPONSE_BYTES);
    const sessionReceipt = body.ok
      ? decodeProbeRerunSessionResponseV1OrNull(body.value)
      : null;
    if (
      sessionReceipt === null ||
      !probeRerunFacetReceiptMatchesRequest(sessionReceipt.facet, request)
    ) {
      throw new Error("invalid runtime rerun session receipt");
    }
    return ProbeRuntimeRerunResponseV1Schema.make({
      session: sessionReceipt,
      runtimeSessionDurationMs: ProbeDurationMsSchema.make(
        elapsedPerformanceDurationSince(startedAt),
      ),
      terminalAck: true,
    });
  }
}

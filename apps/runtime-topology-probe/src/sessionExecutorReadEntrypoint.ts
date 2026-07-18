import { WorkerEntrypoint } from "cloudflare:workers";
import { isNonArrayRecord } from "@flarex/utils/records";

import {
  decodeProbeMockReadRequestV1OrNull,
  decodeProbeMockReadResponseV1OrNull,
  type ProbeMockReadRequestV1,
  type ProbeMockReadResponseV1,
} from "./commitProtocol";
import { copyCloudflareRpcRecord } from "./effectBoundary";
import type { ProbeSessionDO } from "./sessionDO";

interface ProbeSessionExecutorReadEnv {
  readonly PROBE_SESSIONS: DurableObjectNamespace<ProbeSessionDO>;
  readonly RUNTIME_TOPOLOGY_PROBE_TEST_READ_DELAY_MS?: string;
  readonly RUNTIME_TOPOLOGY_PROBE_TEST_UNFROZEN_ADMISSION?: string;
}

export interface ProbeSessionExecutorReadEnvelope {
  readonly capabilityToken: string;
  readonly expected: ProbeMockReadRequestV1;
}

export class ProbeSessionExecutorReadEntrypoint
  extends WorkerEntrypoint<ProbeSessionExecutorReadEnv>
{
  async read(
    envelopeValue: unknown,
    value: unknown,
  ): Promise<ProbeMockReadResponseV1> {
    const envelope = decodeProbeSessionExecutorReadEnvelope(envelopeValue);
    if (envelope === null) {
      throw new Error("invalid SessionDO read capability envelope");
    }
    const delayMs = testReadDelayMs(this.env);
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    const raw = await this.env.PROBE_SESSIONS
      .getByName(envelope.expected.sessionId)
      .executorRead(envelope, value);
    const response = decodeProbeMockReadResponseV1OrNull(
      copyCloudflareRpcRecord(raw),
    );
    if (response === null) {
      throw new Error("invalid SessionDO read capability response");
    }
    return response;
  }
}

function testReadDelayMs(env: ProbeSessionExecutorReadEnv): number {
  if (
    env.RUNTIME_TOPOLOGY_PROBE_TEST_UNFROZEN_ADMISSION !==
      "explicit-test-only"
  ) {
    return 0;
  }
  const value = env.RUNTIME_TOPOLOGY_PROBE_TEST_READ_DELAY_MS;
  if (value === undefined || !/^[1-9][0-9]{0,3}$/.test(value)) return 0;
  const delay = Number(value);
  return delay <= 5_000 ? delay : 0;
}

export function newProbeSessionExecutorReadEnvelope(
  expected: ProbeMockReadRequestV1,
): ProbeSessionExecutorReadEnvelope {
  return {
    capabilityToken: `rtp-executor-cap-${crypto.randomUUID()}`,
    expected,
  };
}

export function decodeProbeSessionExecutorReadEnvelope(
  value: unknown,
): ProbeSessionExecutorReadEnvelope | null {
  if (!isNonArrayRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "capabilityToken" ||
    keys[1] !== "expected"
  ) {
    return null;
  }
  const capabilityToken: unknown = Reflect.get(value, "capabilityToken");
  const expected = decodeProbeMockReadRequestV1OrNull(
    Reflect.get(value, "expected"),
  );
  return typeof capabilityToken === "string" &&
      /^rtp-executor-cap-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        capabilityToken,
      ) && expected !== null
    ? { capabilityToken, expected }
    : null;
}

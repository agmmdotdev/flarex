import { protocolValueOrNull } from "./effectBoundary";
import {
  probeSampleId,
  probeSpanId,
  ProbeOrdinalSchema,
} from "./identity";
import {
  hasExactBearerCapability,
  isConfiguredSecret,
  noStoreJson,
  readBoundedJson,
} from "./http";
import {
  probeSampleIdentityV1,
  PROBE_LIMITS_V1,
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
  ProbeTraceSpanV1Schema,
  type ProbeNormalizedErrorV1,
  type ProbeRunRequestV1,
  type ProbeTraceSpanV1,
} from "./protocol";
import {
  decodeProbeGatewaySampleRequestV1Effect,
  gatewaySampleFromRun,
  type ProbeGatewaySampleRequestV1,
} from "./runtimeProtocol";
import {
  decodeProbeSessionEchoResponseV1Effect,
  ProbeSessionEchoRequestV1Schema,
  type ProbeSessionEchoResponseV1,
} from "./sessionProtocol";
import type { ProbeSessionDO } from "./sessionDO";

export interface ProbeGatewayEnv {
  readonly PROBE_SESSIONS: DurableObjectNamespace<ProbeSessionDO>;
  readonly RUNTIME_TOPOLOGY_PROBE_TOKEN?: string;
}

export interface ProbeGatewayWorker {
  fetch(request: Request, env: ProbeGatewayEnv): Promise<Response>;
}

export const PROBE_SAMPLE_ROUTE = "/v1/samples";
export const PROBE_PUBLIC_BODY_MAX_BYTES =
  PROBE_LIMITS_V1.maxPayloadBytes + 8_192;
const PROBE_INTERNAL_RESPONSE_MAX_BYTES = 8_192;

export type ProbeSessionFailureSource =
  | { readonly kind: "transport" }
  | { readonly kind: "response-status"; readonly status: number }
  | { readonly kind: "invalid-receipt" };

export function createProbeGatewayWorker(): ProbeGatewayWorker {
  return {
    async fetch(request, env) {
      const token = env.RUNTIME_TOPOLOGY_PROBE_TOKEN;
      if (!isConfiguredSecret(token)) {
        return gatewayError("runtime_failure", 500);
      }
      if (!(await hasExactBearerCapability(request, token))) {
        return gatewayError("unauthorized", 401);
      }

      const pathname = new URL(request.url).pathname;
      if (pathname !== PROBE_SAMPLE_ROUTE) {
        return gatewayError("invalid_request", 404);
      }
      if (request.method !== "POST") {
        return gatewayError("invalid_request", 405);
      }
      if (!isJsonContentType(request.headers.get("content-type"))) {
        return gatewayError("invalid_request", 415);
      }

      const body = await readBoundedJson(
        request,
        PROBE_PUBLIC_BODY_MAX_BYTES,
      );
      if (!body.ok) {
        return gatewayError(
          body.reason === "body_too_large"
            ? "limit_exceeded"
            : "invalid_request",
          body.reason === "body_too_large" ? 413 : 400,
        );
      }
      const sampleRequest = await decodeSampleRequest(body.value);
      if (sampleRequest === null) {
        return gatewayError("invalid_request", 400);
      }
      if (
        sampleRequest.run.scenario !== "edge_echo" &&
        sampleRequest.run.scenario !== "session_echo"
      ) {
        return gatewayError("unsupported_scenario", 422);
      }

      const edgeColo = requestColo(request);
      switch (sampleRequest.run.scenario) {
        case "edge_echo":
          return noStoreJson(
            gatewaySampleFromRun(
              sampleRequest.run,
              sampleRequest.sampleOrdinal,
              {
                edgeColo,
                outcome: { kind: "ok" },
                spans: [],
              },
            ),
          );
        case "session_echo":
          return noStoreJson(
            await executeSessionEcho(env, sampleRequest, edgeColo),
          );
      }
    },
  };
}

async function executeSessionEcho(
  env: ProbeGatewayEnv,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
) {
  const identity = probeSampleIdentityV1(
    sampleRequest.run.runId,
    sampleRequest.run.scenario,
    sampleRequest.run.dimensions,
    sampleRequest.sampleOrdinal,
  );
  if (identity.kind !== "session-only") {
    throw new Error("session_echo did not derive a session-only identity");
  }

  const stub = env.PROBE_SESSIONS.getByName(identity.sessionId);
  const internalRequest = ProbeSessionEchoRequestV1Schema.make({
    protocolVersion: sampleRequest.run.protocolVersion,
    runId: sampleRequest.run.runId,
    sampleId: probeSampleId(
      sampleRequest.run.runId,
      sampleRequest.sampleOrdinal,
    ),
    sampleOrdinal: sampleRequest.sampleOrdinal,
    sessionId: identity.sessionId,
    sessionMode: sampleRequest.run.dimensions.sessionMode,
    payload: sampleRequest.payload,
  });

  const startedAt = performance.now();
  let response: Response;
  try {
    response = await stub.fetch(
      new Request("https://probe-session.internal/v1/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(internalRequest),
      }),
    );
  } catch {
    return failedSessionSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      elapsedSince(startedAt),
      probeSessionFailureRetryable({ kind: "transport" }),
    );
  }
  if (!response.ok) {
    return failedSessionSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      elapsedSince(startedAt),
      probeSessionFailureRetryable({
        kind: "response-status",
        status: response.status,
      }),
    );
  }
  const body = await readBoundedJson(
    response,
    PROBE_INTERNAL_RESPONSE_MAX_BYTES,
  );
  const decoded = body.ok
    ? await decodeSessionResponse(body.value)
    : null;
  const durationMs = elapsedSince(startedAt);
  if (
    decoded === null ||
    !sameSessionReceipt(decoded, internalRequest)
  ) {
    return failedSessionSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      durationMs,
      probeSessionFailureRetryable({ kind: "invalid-receipt" }),
    );
  }

  return gatewaySampleFromRun(
    sampleRequest.run,
    sampleRequest.sampleOrdinal,
    {
      edgeColo,
      outcome: { kind: "ok" },
      spans: [sessionSpan(durationMs, { kind: "ok" })],
    },
  );
}

function failedSessionSample(
  run: ProbeRunRequestV1,
  sampleOrdinal: ProbeGatewaySampleRequestV1["sampleOrdinal"],
  edgeColo: string | null,
  durationMs: number,
  retryable: boolean,
) {
  const error: ProbeNormalizedErrorV1 = {
    code: "runtime_failure",
    retryable,
    stage: "gateway_session_rtt",
  };
  return gatewaySampleFromRun(run, sampleOrdinal, {
    edgeColo,
    outcome: { kind: "error", error },
    spans: [sessionSpan(durationMs, { kind: "error", error })],
  });
}

function sessionSpan(
  durationMs: number,
  outcome: ProbeTraceSpanV1["outcome"],
): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(1)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(0)),
    name: "gateway_session_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome,
  });
}

async function decodeSampleRequest(
  value: unknown,
): Promise<ProbeGatewaySampleRequestV1 | null> {
  return await protocolValueOrNull(
    decodeProbeGatewaySampleRequestV1Effect(value),
  );
}

async function decodeSessionResponse(
  value: unknown,
): Promise<ProbeSessionEchoResponseV1 | null> {
  return await protocolValueOrNull(
    decodeProbeSessionEchoResponseV1Effect(value),
  );
}

function sameSessionReceipt(
  response: ProbeSessionEchoResponseV1,
  request: typeof ProbeSessionEchoRequestV1Schema.Type,
): boolean {
  return response.protocolVersion === request.protocolVersion &&
    response.runId === request.runId &&
    response.sampleId === request.sampleId &&
    response.sampleOrdinal === request.sampleOrdinal &&
    response.sessionId === request.sessionId &&
    response.sessionMode === request.sessionMode &&
    response.payloadBytes === request.payload.length;
}

function requestColo(request: Request): string | null {
  const colo = request.cf?.colo;
  return typeof colo === "string" && /^[A-Z0-9]{3,8}$/.test(colo)
    ? colo
    : null;
}

function elapsedSince(startedAt: number): number {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function isJsonContentType(value: string | null): boolean {
  return value !== null &&
    value.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function gatewayError(
  code:
    | "invalid_request"
    | "limit_exceeded"
    | "runtime_failure"
    | "unauthorized"
    | "unsupported_scenario",
  status: number,
): Response {
  return noStoreJson(
    {
      protocolVersion: PROBE_PROTOCOL_VERSION_V1,
      error: { code, retryable: false, stage: "request" },
    },
    status,
  );
}

export function probeSessionFailureRetryable(
  source: ProbeSessionFailureSource,
): boolean {
  switch (source.kind) {
    case "transport":
      return true;
    case "response-status":
      return source.status >= 500 && source.status <= 599;
    case "invalid-receipt":
      return false;
  }
}

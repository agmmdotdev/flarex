import { protocolValueOrNull } from "./effectBoundary";
import {
  decodeProbeDirectEchoResponseV1Effect,
  probeDirectWorkerCode,
  ProbeDirectEchoRequestV1Schema,
  type ProbeDirectEchoResponseV1,
} from "./dynamicProtocol";
import {
  decodeProbeFacetSessionResponseV1Effect,
  probeFacetJournalSealDigest,
  ProbeFacetInvokeRequestV1Schema,
  type ProbeFacetInvokeRequestV1,
  type ProbeFacetSessionResponseV1,
} from "./facetProtocol";
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
  type ProbeGatewaySampleV1,
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
  readonly LOADER?: WorkerLoader;
  readonly RUNTIME_TOPOLOGY_PROBE_TOKEN?: string;
}

export interface ProbeGatewayWorker {
  fetch(request: Request, env: ProbeGatewayEnv): Promise<Response>;
}

export const PROBE_SAMPLE_ROUTE = "/v1/samples";
export const PROBE_PUBLIC_BODY_MAX_BYTES =
  PROBE_LIMITS_V1.maxPayloadBytes + 8_192;
const PROBE_INTERNAL_RESPONSE_MAX_BYTES = 8_192;

export type ProbeRuntimeFailureSource =
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
        sampleRequest.run.scenario !== "session_echo" &&
        sampleRequest.run.scenario !== "dynamic_direct_echo" &&
        sampleRequest.run.scenario !== "facet_echo" &&
        sampleRequest.run.scenario !== "facet_journal"
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
        case "dynamic_direct_echo":
          if (env.LOADER === undefined) {
            return gatewayError("runtime_failure", 500);
          }
          return noStoreJson(
            await executeDynamicDirectEcho(
              env.LOADER,
              sampleRequest,
              edgeColo,
            ),
          );
        case "facet_echo":
        case "facet_journal": {
          if (env.LOADER === undefined) {
            return gatewayError("runtime_failure", 500);
          }
          const result = await executeFacetScenario(
            env,
            sampleRequest,
            edgeColo,
          );
          return result instanceof Response ? result : noStoreJson(result);
        }
      }
    },
  };
}

async function executeFacetScenario(
  env: ProbeGatewayEnv,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
): Promise<ProbeGatewaySampleV1 | Response> {
  const scenario = sampleRequest.run.scenario;
  if (scenario !== "facet_echo" && scenario !== "facet_journal") {
    throw new Error("executeFacetScenario received a non-facet scenario");
  }
  const identity = probeSampleIdentityV1(
    sampleRequest.run.runId,
    sampleRequest.run.scenario,
    sampleRequest.run.dimensions,
    sampleRequest.sampleOrdinal,
  );
  if (identity.kind !== "facet-session") {
    throw new Error("facet scenario did not derive a facet-session identity");
  }
  const internalRequest = ProbeFacetInvokeRequestV1Schema.make({
    protocolVersion: sampleRequest.run.protocolVersion,
    runId: sampleRequest.run.runId,
    sampleId: probeSampleId(
      sampleRequest.run.runId,
      sampleRequest.sampleOrdinal,
    ),
    sampleOrdinal: sampleRequest.sampleOrdinal,
    scenario,
    sessionId: identity.sessionId,
    sessionMode: sampleRequest.run.dimensions.sessionMode,
    attemptId: identity.attemptId,
    codeMode: sampleRequest.run.dimensions.codeMode,
    codeId: identity.codeId,
    journalEntries: sampleRequest.run.dimensions.journalEntries,
    payload: sampleRequest.payload,
  });
  const session = env.PROBE_SESSIONS.getByName(identity.sessionId);
  const startedAt = performance.now();
  let response: Response;
  try {
    response = await session.fetch(
      new Request("https://probe-session.internal/v1/facet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(internalRequest),
      }),
    );
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  if (!response.ok) return gatewayError("runtime_failure", 502);
  const body = await readBoundedJson(
    response,
    PROBE_INTERNAL_RESPONSE_MAX_BYTES,
  );
  const decoded = body.ok ? await decodeFacetSessionResponse(body.value) : null;
  if (
    decoded === null ||
    !(await sameFacetSessionReceipt(decoded, internalRequest))
  ) {
    return gatewayError("runtime_failure", 502);
  }
  const sessionDurationMs = elapsedSince(startedAt);

  const spans: ProbeTraceSpanV1[] = [
    sessionSpan(sessionDurationMs, { kind: "ok" }),
    facetSpan(decoded.facetDurationMs),
  ];
  if (
    decoded.scenario === "facet_journal" &&
    decoded.journalDurationMs !== null
  ) {
    spans.push(journalSpan(decoded.journalDurationMs));
  }
  return gatewaySampleFromRun(
    sampleRequest.run,
    sampleRequest.sampleOrdinal,
    {
      edgeColo,
      outcome: { kind: "ok" },
      spans,
      startup: {
        workerLoader: decoded.workerLoaderCallbackRan
          ? "callback-ran"
          : "callback-not-run",
        facet: decoded.facetStartupCallbackRan
          ? "callback-ran"
          : "callback-not-run",
      },
    },
  );
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
      probeRuntimeFailureRetryable({ kind: "transport" }),
    );
  }
  if (!response.ok) {
    return failedSessionSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      elapsedSince(startedAt),
      probeRuntimeFailureRetryable({
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
      probeRuntimeFailureRetryable({ kind: "invalid-receipt" }),
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

async function executeDynamicDirectEcho(
  loader: WorkerLoader,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
) {
  const identity = probeSampleIdentityV1(
    sampleRequest.run.runId,
    sampleRequest.run.scenario,
    sampleRequest.run.dimensions,
    sampleRequest.sampleOrdinal,
  );
  if (identity.kind !== "dynamic-direct") {
    throw new Error("dynamic_direct_echo did not derive a direct code identity");
  }
  const internalRequest = ProbeDirectEchoRequestV1Schema.make({
    protocolVersion: sampleRequest.run.protocolVersion,
    runId: sampleRequest.run.runId,
    sampleId: probeSampleId(
      sampleRequest.run.runId,
      sampleRequest.sampleOrdinal,
    ),
    sampleOrdinal: sampleRequest.sampleOrdinal,
    codeMode: sampleRequest.run.dimensions.codeMode,
    codeId: identity.codeId,
    payload: sampleRequest.payload,
  });

  let loaderCallbackRan = false;
  const startedAt = performance.now();
  let response: Response;
  try {
    const worker = loader.get(identity.codeId, () => {
      loaderCallbackRan = true;
      return probeDirectWorkerCode();
    });
    response = await worker.getEntrypoint().fetch(
      new Request("https://probe-dynamic.internal/v1/direct-echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(internalRequest),
      }),
    );
  } catch {
    return failedDynamicSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      elapsedSince(startedAt),
      loaderCallbackRan,
      probeRuntimeFailureRetryable({ kind: "transport" }),
    );
  }
  if (!response.ok) {
    return failedDynamicSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      elapsedSince(startedAt),
      loaderCallbackRan,
      probeRuntimeFailureRetryable({
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
    ? await decodeDirectResponse(body.value)
    : null;
  const durationMs = elapsedSince(startedAt);
  if (decoded === null || !sameDirectReceipt(decoded, internalRequest)) {
    return failedDynamicSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      durationMs,
      loaderCallbackRan,
      probeRuntimeFailureRetryable({ kind: "invalid-receipt" }),
    );
  }

  return gatewaySampleFromRun(
    sampleRequest.run,
    sampleRequest.sampleOrdinal,
    {
      edgeColo,
      outcome: { kind: "ok" },
      spans: [dynamicSpan(durationMs, { kind: "ok" })],
      startup: dynamicStartup(loaderCallbackRan),
    },
  );
}

function failedDynamicSample(
  run: ProbeRunRequestV1,
  sampleOrdinal: ProbeGatewaySampleRequestV1["sampleOrdinal"],
  edgeColo: string | null,
  durationMs: number,
  loaderCallbackRan: boolean,
  retryable: boolean,
) {
  const error: ProbeNormalizedErrorV1 = {
    code: "runtime_failure",
    retryable,
    stage: "gateway_dynamic_rtt",
  };
  return gatewaySampleFromRun(run, sampleOrdinal, {
    edgeColo,
    outcome: { kind: "error", error },
    spans: [dynamicSpan(durationMs, { kind: "error", error })],
    startup: dynamicStartup(loaderCallbackRan),
  });
}

function dynamicSpan(
  durationMs: number,
  outcome: ProbeTraceSpanV1["outcome"],
): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(1)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(0)),
    name: "gateway_dynamic_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome,
  });
}

function facetSpan(durationMs: number): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(2)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(1)),
    name: "session_facet_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}

function journalSpan(durationMs: number): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(3)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(2)),
    name: "facet_journal_io",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}

function dynamicStartup(loaderCallbackRan: boolean) {
  return {
    workerLoader: loaderCallbackRan ? "callback-ran" : "callback-not-run",
    facet: "not-applicable",
  } as const;
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

async function decodeDirectResponse(
  value: unknown,
): Promise<ProbeDirectEchoResponseV1 | null> {
  return await protocolValueOrNull(
    decodeProbeDirectEchoResponseV1Effect(value),
  );
}

async function decodeFacetSessionResponse(
  value: unknown,
): Promise<ProbeFacetSessionResponseV1 | null> {
  return await protocolValueOrNull(
    decodeProbeFacetSessionResponseV1Effect(value),
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

function sameDirectReceipt(
  response: ProbeDirectEchoResponseV1,
  request: typeof ProbeDirectEchoRequestV1Schema.Type,
): boolean {
  return response.protocolVersion === request.protocolVersion &&
    response.runId === request.runId &&
    response.sampleId === request.sampleId &&
    response.sampleOrdinal === request.sampleOrdinal &&
    response.codeMode === request.codeMode &&
    response.codeId === request.codeId &&
    response.payloadBytes === request.payload.length;
}

async function sameFacetSessionReceipt(
  response: ProbeFacetSessionResponseV1,
  request: ProbeFacetInvokeRequestV1,
): Promise<boolean> {
  return response.protocolVersion === request.protocolVersion &&
    response.runId === request.runId &&
    response.sampleId === request.sampleId &&
    response.sampleOrdinal === request.sampleOrdinal &&
    response.scenario === request.scenario &&
    response.sessionId === request.sessionId &&
    response.sessionMode === request.sessionMode &&
    response.attemptId === request.attemptId &&
    response.codeMode === request.codeMode &&
    response.codeId === request.codeId &&
    response.journalEntries === request.journalEntries &&
    response.payloadBytes === request.payload.length &&
    response.sealDigest === await probeFacetJournalSealDigest(request);
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

export function probeRuntimeFailureRetryable(
  source: ProbeRuntimeFailureSource,
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

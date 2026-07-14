import {
  copyCloudflareRpcRecord,
  protocolValueOrNull,
} from "./effectBoundary";
import {
  decodeProbeMockFinishResponseV1OrNull,
  probeSyntheticCommitSeq,
  ProbeMockFinishRequestV1Schema,
  type ProbeMockFinishRequestV1,
  type ProbeMockFinishResponseV1,
} from "./commitProtocol";
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
  decodeProbeFullInvokeSessionFailureV1OrNull,
  decodeProbeFullInvokeSessionResponseV1OrNull,
  probeInvokeJournalSealDigest,
  ProbeInvokeFacetRequestV1Schema,
  type ProbeFullInvokeSessionResponseV1,
  type ProbeFullInvokeSessionFailureV1,
  type ProbeFullInvokeSessionObservationV1,
  type ProbeInvokeFacetRequestV1,
} from "./invokeProtocol";
import type {
  MockFinishEntrypoint,
  MockReadEntrypoint,
  MockRerunEntrypoint,
} from "./mockCommitWorker";
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
  type ProbeStartupObservationsV1,
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
import type { ProbeSessionDO, ProbeSessionEnv } from "./sessionDO";
import {
  decodeProbeSyncRerunReceiptV1OrNull,
  ProbeRuntimeRerunRequestV1Schema,
  ProbeSyncRerunRequestV1Schema,
  type ProbeSyncRerunReceiptV1,
  type ProbeSyncRerunRequestV1,
} from "./rerunProtocol";
import type { ProbeRuntimeRerunCapability } from "./runtimeRerunEntrypoint";

export interface ProbeGatewayEnv extends ProbeSessionEnv {
  readonly PROBE_SESSIONS: DurableObjectNamespace<ProbeSessionDO>;
  readonly LOADER?: WorkerLoader;
  readonly MOCK_FINISH?: Service<typeof MockFinishEntrypoint>;
  readonly MOCK_READ?: Service<typeof MockReadEntrypoint>;
  readonly MOCK_RERUN?: Service<typeof MockRerunEntrypoint>;
  readonly RUNTIME_TOPOLOGY_PROBE_TOKEN?: string;
}

export interface ProbeGatewayWorker {
  fetch(
    request: Request,
    env: ProbeGatewayEnv,
    createRuntimeRerunCapability?: ProbeRuntimeRerunCapabilityFactory,
  ): Promise<Response>;
}

export type ProbeRuntimeRerunCapabilityFactory = (
  request: typeof ProbeRuntimeRerunRequestV1Schema.Type,
) => ProbeRuntimeRerunCapability;

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
    async fetch(request, env, createRuntimeRerunCapability) {
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
        sampleRequest.run.scenario !== "facet_journal" &&
        sampleRequest.run.scenario !== "commit_wake" &&
        sampleRequest.run.scenario !== "full_invoke" &&
        sampleRequest.run.scenario !== "sync_rerun"
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
        case "commit_wake": {
          if (env.MOCK_FINISH === undefined) {
            return noStoreJson(
              failedNestedSample(
                sampleRequest,
                edgeColo,
                runtimeError("request", false),
              ),
            );
          }
          const result = await executeCommitWake(
            env.MOCK_FINISH,
            sampleRequest,
            edgeColo,
          );
          return result instanceof Response ? result : noStoreJson(result);
        }
        case "full_invoke": {
          if (
            env.LOADER === undefined ||
            env.MOCK_READ === undefined ||
            env.MOCK_FINISH === undefined
          ) {
            return noStoreJson(
              failedNestedSample(
                sampleRequest,
                edgeColo,
                runtimeError("request", false),
                [],
                {
                  workerLoader: "callback-not-run",
                  facet: "callback-not-run",
                },
              ),
            );
          }
          const result = await executeFullInvokeScenario(
            env,
            sampleRequest,
            edgeColo,
          );
          return result instanceof Response ? result : noStoreJson(result);
        }
        case "sync_rerun": {
          if (
            env.LOADER === undefined ||
            env.MOCK_RERUN === undefined ||
            createRuntimeRerunCapability === undefined
          ) {
            return noStoreJson(
              failedNestedSample(
                sampleRequest,
                edgeColo,
                runtimeError("request", false),
                [],
                {
                  workerLoader: "callback-not-run",
                  facet: "callback-not-run",
                },
              ),
            );
          }
          return noStoreJson(
            await executeSyncRerunScenario(
              env.MOCK_RERUN,
              createRuntimeRerunCapability,
              sampleRequest,
              edgeColo,
            ),
          );
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

async function executeCommitWake(
  mockFinish: Service<typeof MockFinishEntrypoint>,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
): Promise<ProbeGatewaySampleV1 | Response> {
  if (sampleRequest.run.scenario !== "commit_wake") {
    throw new Error("executeCommitWake received a non-wake scenario");
  }
  const identity = probeSampleIdentityV1(
    sampleRequest.run.runId,
    sampleRequest.run.scenario,
    sampleRequest.run.dimensions,
    sampleRequest.sampleOrdinal,
  );
  if (identity.kind !== "scope-only") {
    throw new Error("commit_wake did not derive a scope-only identity");
  }
  const finishRequest = ProbeMockFinishRequestV1Schema.make({
    protocolVersion: sampleRequest.run.protocolVersion,
    runId: sampleRequest.run.runId,
    sampleId: probeSampleId(
      sampleRequest.run.runId,
      sampleRequest.sampleOrdinal,
    ),
    sampleOrdinal: sampleRequest.sampleOrdinal,
    scopeId: identity.scopeId,
    scenario: "commit_wake",
    commitSeq: probeSyntheticCommitSeq(sampleRequest.sampleOrdinal),
  });
  let finish: ProbeMockFinishResponseV1 | null;
  try {
    const rawFinish = await mockFinish.finish(finishRequest);
    finish = decodeMockFinishResponse(
      copyCloudflareRpcRecord(rawFinish),
    );
  } catch {
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      runtimeError("mock_sync_wake_rtt", true),
    );
  }
  if (finish === null || !sameMockFinishReceipt(finish, finishRequest)) {
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      runtimeError("mock_sync_wake_rtt", false),
    );
  }
  if (
    finish.sync.disposition !== "applied" &&
    finish.sync.disposition !== "duplicate"
  ) {
    const error = runtimeError("sync_cursor_io", false);
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      error,
      [
        mockSyncWakeSpan(finish.mockSyncWakeDurationMs, 1, 0),
        syncCursorSpan(
          finish.sync.cursorDurationMs,
          2,
          1,
          { kind: "error", error },
        ),
      ],
    );
  }
  return gatewaySampleFromRun(
    sampleRequest.run,
    sampleRequest.sampleOrdinal,
    {
      edgeColo,
      outcome: { kind: "ok" },
      spans: [
        mockSyncWakeSpan(finish.mockSyncWakeDurationMs, 1, 0),
        syncCursorSpan(finish.sync.cursorDurationMs, 2, 1),
      ],
    },
  );
}

async function executeFullInvokeScenario(
  env: ProbeGatewayEnv,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
): Promise<ProbeGatewaySampleV1 | Response> {
  if (sampleRequest.run.scenario !== "full_invoke") {
    throw new Error("executeFullInvokeScenario received a non-invoke scenario");
  }
  const identity = probeSampleIdentityV1(
    sampleRequest.run.runId,
    sampleRequest.run.scenario,
    sampleRequest.run.dimensions,
    sampleRequest.sampleOrdinal,
  );
  if (identity.kind !== "facet-session") {
    throw new Error("full_invoke did not derive a facet-session identity");
  }
  const internalRequest = ProbeInvokeFacetRequestV1Schema.make({
    protocolVersion: sampleRequest.run.protocolVersion,
    runId: sampleRequest.run.runId,
    sampleId: probeSampleId(
      sampleRequest.run.runId,
      sampleRequest.sampleOrdinal,
    ),
    sampleOrdinal: sampleRequest.sampleOrdinal,
    scopeId: identity.scopeId,
    scenario: "full_invoke",
    commitSeq: probeSyntheticCommitSeq(sampleRequest.sampleOrdinal),
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
      new Request("https://probe-session.internal/v1/full-invoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(internalRequest),
      }),
    );
  } catch {
    const error = runtimeError("gateway_session_rtt", true);
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      error,
      [sessionSpan(elapsedSince(startedAt), { kind: "error", error })],
      unobservedFacetStartup(),
    );
  }
  const sessionDurationMs = elapsedSince(startedAt);
  const body = await readBoundedJson(
    response,
    PROBE_INTERNAL_RESPONSE_MAX_BYTES,
  );
  if (!response.ok) {
    const failure = response.status === 409 && body.ok
      ? decodeFullInvokeSessionFailure(body.value)
      : null;
    if (
      failure !== null &&
      await sameFullInvokeSessionReceipt(failure, internalRequest)
    ) {
      return gatewaySampleFromRun(
        sampleRequest.run,
        sampleRequest.sampleOrdinal,
        {
          edgeColo,
          outcome: { kind: "error", error: failure.error },
          spans: fullInvokeSpans(
            failure,
            sessionDurationMs,
            { kind: "error", error: failure.error },
          ),
          startup: fullInvokeStartup(failure),
        },
      );
    }
    const error = runtimeError(
      "gateway_session_rtt",
      probeRuntimeFailureRetryable({
        kind: "response-status",
        status: response.status,
      }),
    );
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      error,
      [sessionSpan(elapsedSince(startedAt), { kind: "error", error })],
      unobservedFacetStartup(),
    );
  }
  const decoded = body.ok
    ? decodeFullInvokeSessionResponse(body.value)
    : null;
  if (
    decoded === null ||
    !(await sameFullInvokeSessionReceipt(decoded, internalRequest))
  ) {
    const error = runtimeError("gateway_session_rtt", false);
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      error,
      [sessionSpan(elapsedSince(startedAt), { kind: "error", error })],
      unobservedFacetStartup(),
    );
  }
  return gatewaySampleFromRun(
    sampleRequest.run,
    sampleRequest.sampleOrdinal,
    {
      edgeColo,
      outcome: { kind: "ok" },
      spans: fullInvokeSpans(decoded, sessionDurationMs),
      startup: fullInvokeStartup(decoded),
    },
  );
}

async function executeSyncRerunScenario(
  mockRerun: Service<typeof MockRerunEntrypoint>,
  createRuntimeRerunCapability: ProbeRuntimeRerunCapabilityFactory,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
): Promise<ProbeGatewaySampleV1> {
  if (sampleRequest.run.scenario !== "sync_rerun") {
    throw new Error("executeSyncRerunScenario received a different scenario");
  }
  const identity = probeSampleIdentityV1(
    sampleRequest.run.runId,
    sampleRequest.run.scenario,
    sampleRequest.run.dimensions,
    sampleRequest.sampleOrdinal,
  );
  if (identity.kind !== "facet-session") {
    throw new Error("sync_rerun did not derive a facet-session identity");
  }
  const rerunRequest = ProbeSyncRerunRequestV1Schema.make({
    protocolVersion: sampleRequest.run.protocolVersion,
    runId: sampleRequest.run.runId,
    sampleId: probeSampleId(
      sampleRequest.run.runId,
      sampleRequest.sampleOrdinal,
    ),
    sampleOrdinal: sampleRequest.sampleOrdinal,
    scopeId: identity.scopeId,
    scenario: "sync_rerun",
    sessionId: identity.sessionId,
    sessionMode: "new-session",
    attemptId: identity.attemptId,
    codeMode: sampleRequest.run.dimensions.codeMode,
    codeId: identity.codeId,
    reentryDepth: 0,
    payload: sampleRequest.payload,
  });
  const runtimeRequest = ProbeRuntimeRerunRequestV1Schema.make({
    ...rerunRequest,
    reentryDepth: 1,
  });
  let receipt: ProbeSyncRerunReceiptV1 | null;
  try {
    const capability = createRuntimeRerunCapability(runtimeRequest);
    const rawReceipt = await mockRerun.rerun(rerunRequest, capability);
    receipt = decodeProbeSyncRerunReceiptV1OrNull(
      copyCloudflareRpcRecord(rawReceipt),
    );
  } catch {
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      runtimeError("sync_runtime_rerun_rtt", true),
      [],
      unobservedFacetStartup(),
    );
  }
  if (receipt === null || !sameSyncRerunReceipt(receipt, rerunRequest)) {
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      runtimeError("sync_runtime_rerun_rtt", false),
      [],
      unobservedFacetStartup(),
    );
  }
  const runtime = receipt.runtime;
  const session = runtime.session;
  return gatewaySampleFromRun(
    sampleRequest.run,
    sampleRequest.sampleOrdinal,
    {
      edgeColo,
      outcome: { kind: "ok" },
      spans: [
        syncRuntimeRerunSpan(receipt.syncRuntimeRerunDurationMs),
        rerunSessionSpan(runtime.runtimeSessionDurationMs),
        rerunFacetSpan(session.facetDurationMs),
      ],
      startup: {
        workerLoader: session.workerLoaderCallbackRan
          ? "callback-ran"
          : "callback-not-run",
        facet: session.facetStartupCallbackRan
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

function journalSpan(
  durationMs: number,
  spanOrdinal = 3,
): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(spanOrdinal)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(2)),
    name: "facet_journal_io",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}

function mockReadSpan(durationMs: number): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(3)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(2)),
    name: "facet_mock_read_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}

function sessionMockFinishSpan(durationMs: number): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(5)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(1)),
    name: "session_mock_finish_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}

function mockSyncWakeSpan(
  durationMs: number,
  spanOrdinal: number,
  parentOrdinal: number,
): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(spanOrdinal)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(parentOrdinal)),
    name: "mock_sync_wake_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}

function syncCursorSpan(
  durationMs: number,
  spanOrdinal: number,
  parentOrdinal: number,
  outcome: ProbeTraceSpanV1["outcome"] = { kind: "ok" },
): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(spanOrdinal)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(parentOrdinal)),
    name: "sync_cursor_io",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome,
  });
}

function fullInvokeSpans(
  observation: ProbeFullInvokeSessionObservationV1,
  sessionDurationMs: number,
  syncOutcome: ProbeTraceSpanV1["outcome"] = { kind: "ok" },
): ReadonlyArray<ProbeTraceSpanV1> {
  const facet = observation.facet;
  const finish = observation.finish;
  return [
    sessionSpan(sessionDurationMs, { kind: "ok" }),
    facetSpan(observation.facetDurationMs),
    mockReadSpan(facet.mockReadDurationMs),
    journalSpan(facet.journalDurationMs, 4),
    sessionMockFinishSpan(observation.sessionMockFinishDurationMs),
    mockSyncWakeSpan(finish.mockSyncWakeDurationMs, 6, 5),
    syncCursorSpan(finish.sync.cursorDurationMs, 7, 6, syncOutcome),
  ];
}

function fullInvokeStartup(
  observation: ProbeFullInvokeSessionObservationV1,
): ProbeStartupObservationsV1 {
  return {
    workerLoader: observation.workerLoaderCallbackRan
      ? "callback-ran"
      : "callback-not-run",
    facet: observation.facetStartupCallbackRan
      ? "callback-ran"
      : "callback-not-run",
  };
}

function syncRuntimeRerunSpan(durationMs: number): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(1)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(0)),
    name: "sync_runtime_rerun_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}

function rerunSessionSpan(durationMs: number): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(2)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(1)),
    name: "gateway_session_rtt",
    durationMs: ProbeDurationMsSchema.make(durationMs),
    outcome: { kind: "ok" },
  });
}

function rerunFacetSpan(durationMs: number): ProbeTraceSpanV1 {
  return ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(ProbeOrdinalSchema.make(3)),
    parentSpanId: probeSpanId(ProbeOrdinalSchema.make(2)),
    name: "session_facet_rtt",
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

function decodeMockFinishResponse(
  value: unknown,
): ProbeMockFinishResponseV1 | null {
  return decodeProbeMockFinishResponseV1OrNull(value);
}

function decodeFullInvokeSessionResponse(
  value: unknown,
): ProbeFullInvokeSessionResponseV1 | null {
  return decodeProbeFullInvokeSessionResponseV1OrNull(value);
}

function decodeFullInvokeSessionFailure(
  value: unknown,
): ProbeFullInvokeSessionFailureV1 | null {
  return decodeProbeFullInvokeSessionFailureV1OrNull(value);
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

function sameMockFinishReceipt(
  response: ProbeMockFinishResponseV1,
  request: ProbeMockFinishRequestV1,
): boolean {
  const receipt = response.request;
  if (
    receipt.protocolVersion !== request.protocolVersion ||
    receipt.runId !== request.runId ||
    receipt.sampleId !== request.sampleId ||
    receipt.sampleOrdinal !== request.sampleOrdinal ||
    receipt.scopeId !== request.scopeId ||
    receipt.scenario !== request.scenario ||
    receipt.commitSeq !== request.commitSeq
  ) {
    return false;
  }
  if (receipt.scenario === "commit_wake") {
    return request.scenario === "commit_wake";
  }
  return request.scenario === "full_invoke" &&
    receipt.sessionId === request.sessionId &&
    receipt.sessionMode === request.sessionMode &&
    receipt.attemptId === request.attemptId &&
    receipt.codeMode === request.codeMode &&
    receipt.codeId === request.codeId &&
    receipt.journalEntries === request.journalEntries &&
    receipt.sealDigest === request.sealDigest;
}

function sameSyncRerunReceipt(
  receipt: ProbeSyncRerunReceiptV1,
  request: ProbeSyncRerunRequestV1,
): boolean {
  const facet = receipt.runtime.session.facet;
  return receipt.terminalAck === true &&
    receipt.capabilityCallCount === 1 &&
    receipt.cursorBefore === receipt.cursorAfter &&
    facet.protocolVersion === request.protocolVersion &&
    facet.runId === request.runId &&
    facet.sampleId === request.sampleId &&
    facet.sampleOrdinal === request.sampleOrdinal &&
    facet.scopeId === request.scopeId &&
    facet.scenario === request.scenario &&
    facet.sessionId === request.sessionId &&
    facet.sessionMode === request.sessionMode &&
    facet.attemptId === request.attemptId &&
    facet.codeMode === request.codeMode &&
    facet.codeId === request.codeId &&
    facet.reentryDepth === request.reentryDepth + 1 &&
    facet.payloadBytes === request.payload.length;
}

async function sameFullInvokeSessionReceipt(
  response: ProbeFullInvokeSessionObservationV1,
  request: ProbeInvokeFacetRequestV1,
): Promise<boolean> {
  const facet = response.facet;
  const finish = response.finish.request;
  if (finish.scenario !== "full_invoke") return false;
  const identityMatches = facet.protocolVersion === request.protocolVersion &&
    facet.runId === request.runId &&
    facet.sampleId === request.sampleId &&
    facet.sampleOrdinal === request.sampleOrdinal &&
    facet.scopeId === request.scopeId &&
    facet.scenario === request.scenario &&
    facet.commitSeq === request.commitSeq &&
    facet.sessionId === request.sessionId &&
    facet.sessionMode === request.sessionMode &&
    facet.attemptId === request.attemptId &&
    facet.codeMode === request.codeMode &&
    facet.codeId === request.codeId &&
    facet.journalEntries === request.journalEntries &&
    facet.payloadBytes === request.payload.length &&
    facet.syntheticRevision === request.commitSeq - 1;
  if (!identityMatches) return false;
  const expectedSeal = await probeInvokeJournalSealDigest(request);
  return facet.sealDigest === expectedSeal &&
    finish.protocolVersion === request.protocolVersion &&
    finish.runId === request.runId &&
    finish.sampleId === request.sampleId &&
    finish.sampleOrdinal === request.sampleOrdinal &&
    finish.scopeId === request.scopeId &&
    finish.commitSeq === request.commitSeq &&
    finish.sessionId === request.sessionId &&
    finish.sessionMode === request.sessionMode &&
    finish.attemptId === request.attemptId &&
    finish.codeMode === request.codeMode &&
    finish.codeId === request.codeId &&
    finish.journalEntries === request.journalEntries &&
    finish.sealDigest === expectedSeal;
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

function failedNestedSample(
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
  error: ProbeNormalizedErrorV1,
  spans: ReadonlyArray<ProbeTraceSpanV1> = [],
  startup?: ProbeStartupObservationsV1,
): ProbeGatewaySampleV1 {
  return gatewaySampleFromRun(
    sampleRequest.run,
    sampleRequest.sampleOrdinal,
    {
      edgeColo,
      outcome: { kind: "error", error },
      spans,
      ...(startup === undefined ? {} : { startup }),
    },
  );
}

function runtimeError(
  stage: ProbeNormalizedErrorV1["stage"],
  retryable: boolean,
): ProbeNormalizedErrorV1 {
  return { code: "runtime_failure", retryable, stage };
}

function unobservedFacetStartup(): ProbeStartupObservationsV1 {
  return {
    workerLoader: "callback-unobserved",
    facet: "callback-unobserved",
  };
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

import {
  decodeProbeCampaignControlReceiptV1OrNull,
  decodeProbeCampaignControlRequestV1Effect,
  decodeProbeCampaignManifestV1Effect,
  decodeProbeCampaignPurgeRequestV1OrNull,
  decodeProbeCampaignRegistrationReceiptV1OrNull,
  decodeProbeCampaignStatusReceiptV1OrNull,
  ProbeCampaignManifestV1Schema,
  ProbeCampaignControlRequestV1Schema,
  type ProbeCampaignErrorCodeV1,
  type ProbeCampaignManifestV1,
} from "./campaignProtocol";
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
  PROBE_CAMPAIGN_ACTOR_NAME,
  ProbeCampaignIdSchema,
  probeSampleId,
  probeSpanId,
  probeRunActorId,
  decodeProbeRunIdEffect,
  ProbeOrdinalSchema,
  type ProbeRunId,
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
  MockPurgeEntrypoint,
  MockReadEntrypoint,
  MockRerunEntrypoint,
} from "./mockCommitWorker";
import {
  hasExactBearerCapability,
  isConfiguredSecret,
  isJsonContentType,
  noStoreJson,
  readBoundedJson,
} from "./http";
import { elapsedPerformanceDurationSince } from "./performanceDuration";
import {
  probeSampleIdentityV1,
  decodeProbeRunRequestV1Effect,
  PROBE_PROTOCOL_VERSION_V1,
  ProbeDurationMsSchema,
  ProbeTraceSpanV1Schema,
  sameProbeDimensionsV1,
  sameProbeNormalizedErrorV1,
  sameProbeSampleIdentityV1,
  type ProbeNormalizedErrorV1,
  type ProbeRunRequestV1,
  type ProbeStartupObservationsV1,
  type ProbeTraceSpanV1,
} from "./protocol";
import {
  gatewaySampleFromRun,
  ProbeGatewaySampleRequestV1Schema,
  type ProbeGatewaySampleV1,
  type ProbeGatewaySampleRequestV1,
  type ProbeSyncWakeObservationV1,
} from "./runtimeProtocol";
import type { ProbeRunDO } from "./probeRunDO";
import type { ProbeCampaignDO } from "./probeCampaignDO";
import {
  decodeProbeExternalCompletionReceiptV1OrNull,
  decodeProbeExternalCompletionRequestV1Effect,
  decodeProbePublicSampleRequestV1Effect,
  decodeProbeRunRegistrationReceiptV1OrNull,
  decodeProbeRunEvidencePageReceiptV1OrNull,
  decodeProbeRunEvidencePageRequestV1Effect,
  decodeProbeRunStatusReceiptV1OrNull,
  decodeProbeSampleClaimReceiptV1OrNull,
  decodeProbeSampleFinalizeReceiptV1OrNull,
  canonicalProbeRunRequestV1,
  ProbeRunStatusRequestV1Schema,
  ProbeSampleFinalizeRequestV1Schema,
  type ProbePublicSampleRequestV1,
  type ProbeRunRegistrationReceiptV1,
  type ProbeRunStatusReceiptV1,
  type ProbeRunStateErrorV1,
  type ProbeSampleClaimReceiptV1,
  type ProbeSampleFinalizeRequestV1,
  type ProbeSampleFinalizeReceiptV1,
} from "./runProtocol";
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
  readonly PROBE_CAMPAIGN: DurableObjectNamespace<ProbeCampaignDO>;
  readonly PROBE_RUNS: DurableObjectNamespace<ProbeRunDO>;
  readonly PROBE_SESSIONS: DurableObjectNamespace<ProbeSessionDO>;
  readonly LOADER?: WorkerLoader;
  readonly MOCK_FINISH?: Service<typeof MockFinishEntrypoint>;
  readonly MOCK_PURGE?: Service<typeof MockPurgeEntrypoint>;
  readonly MOCK_READ?: Service<typeof MockReadEntrypoint>;
  readonly MOCK_RERUN?: Service<typeof MockRerunEntrypoint>;
  readonly RUNTIME_TOPOLOGY_PROBE_TEST_UNFROZEN_ADMISSION?: string;
  readonly RUNTIME_TOPOLOGY_PROBE_TOKEN?: string;
}

export interface ProbeGatewayAdmissionPolicy {
  manifestIsAdmitted(
    env: ProbeGatewayEnv,
    manifest: ProbeCampaignManifestV1,
  ): boolean;
  runIdIsAdmitted(env: ProbeGatewayEnv, runId: ProbeRunId): boolean;
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
export const PROBE_RUN_ROUTE = "/v1/runs";
export const PROBE_CAMPAIGN_ROUTE = "/v1/campaign";
export const PROBE_CAMPAIGN_STATUS_ROUTE = "/v1/campaign/status";
export const PROBE_CAMPAIGN_RECONCILE_ROUTE = "/v1/campaign/reconcile";
export const PROBE_CAMPAIGN_SEAL_EVIDENCE_ROUTE =
  "/v1/campaign/seal-evidence";
export const PROBE_CAMPAIGN_PURGE_ROUTE = "/v1/campaign/purge";
export const PROBE_EXTERNAL_COMPLETION_ROUTE = "/v1/external-completions";
export const PROBE_EVIDENCE_PAGE_ROUTE = "/v1/evidence";
export const PROBE_PUBLIC_BODY_MAX_BYTES = 65_536;
const PROBE_SAMPLE_BODY_MAX_BYTES = 1_024;
const PROBE_INTERNAL_RESPONSE_MAX_BYTES = 8_192;

export type ProbeRuntimeFailureSource =
  | { readonly kind: "transport" }
  | { readonly kind: "response-status"; readonly status: number }
  | { readonly kind: "invalid-receipt" };

export function createProbeGatewayWorker(
  admission: ProbeGatewayAdmissionPolicy,
): ProbeGatewayWorker {
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
      if (pathname === PROBE_CAMPAIGN_ROUTE) {
        return await registerProbeCampaign(request, env, admission);
      }
      if (pathname === PROBE_CAMPAIGN_STATUS_ROUTE) {
        return await readProbeCampaignStatus(request, env);
      }
      if (pathname === PROBE_CAMPAIGN_RECONCILE_ROUTE) {
        return await controlProbeCampaign(request, env, "reconcile");
      }
      if (pathname === PROBE_CAMPAIGN_SEAL_EVIDENCE_ROUTE) {
        return await controlProbeCampaign(request, env, "seal-evidence");
      }
      if (pathname === PROBE_CAMPAIGN_PURGE_ROUTE) {
        return await controlProbeCampaign(request, env, "purge");
      }
      if (pathname === PROBE_RUN_ROUTE) {
        return await registerProbeRun(request, env, admission);
      }
      const statusRunId = await runIdFromStatusPath(pathname);
      if (statusRunId !== null) {
        if (!admission.runIdIsAdmitted(env, statusRunId)) {
          return gatewayError("invalid_request", 404);
        }
        return await readProbeRunStatus(request, env, statusRunId);
      }
      if (pathname === PROBE_SAMPLE_ROUTE) {
        return await executeClaimedSample(
          request,
          env,
          createRuntimeRerunCapability,
          admission,
        );
      }
      if (pathname === PROBE_EXTERNAL_COMPLETION_ROUTE) {
        return await completeExternalProbeSample(request, env, admission);
      }
      if (pathname === PROBE_EVIDENCE_PAGE_ROUTE) {
        return await readProbeEvidencePage(request, env, admission);
      }
      return gatewayError("invalid_request", 404);
    },
  };
}

interface ProbeScenarioExecution {
  readonly fragment: ProbeGatewaySampleV1;
  readonly syncWake: ProbeSyncWakeObservationV1;
}

async function registerProbeCampaign(
  request: Request,
  env: ProbeGatewayEnv,
  admission: ProbeGatewayAdmissionPolicy,
): Promise<Response> {
  if (request.method !== "POST") return gatewayError("invalid_request", 405);
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return gatewayError("invalid_request", 415);
  }
  const body = await readBoundedJson(request, PROBE_PUBLIC_BODY_MAX_BYTES);
  if (!body.ok) return publicBodyError(body.reason);
  const manifest = await protocolValueOrNull(
    decodeProbeCampaignManifestV1Effect(body.value),
  );
  if (manifest === null) return gatewayError("invalid_request", 400);
  return await registerCampaignManifest(env, manifest, admission);
}

async function registerCampaignManifest(
  env: ProbeGatewayEnv,
  manifest: ProbeCampaignManifestV1,
  admission: ProbeGatewayAdmissionPolicy,
): Promise<Response> {
  if (!admission.manifestIsAdmitted(env, manifest)) {
    return gatewayError("invalid_request", 404);
  }
  let rawReceipt: unknown;
  try {
    rawReceipt = await env.PROBE_CAMPAIGN.getByName(PROBE_CAMPAIGN_ACTOR_NAME)
      .register(manifest);
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  const receipt = decodeProbeCampaignRegistrationReceiptV1OrNull(
    copyCloudflareRpcRecord(rawReceipt),
  );
  if (receipt === null) return gatewayError("runtime_failure", 502);
  if (receipt.kind === "rejected") {
    return noStoreJson(receipt, campaignErrorHttpStatus(receipt.error.code));
  }
  if (
    receipt.status.manifest.campaignId !== manifest.campaignId ||
    receipt.status.manifest.runs.length !== manifest.runs.length
  ) {
    return gatewayError("runtime_failure", 502);
  }
  return noStoreJson(receipt, receipt.created ? 201 : 200);
}

async function readProbeCampaignStatus(
  request: Request,
  env: ProbeGatewayEnv,
): Promise<Response> {
  if (request.method !== "POST") return gatewayError("invalid_request", 405);
  const control = await readCampaignControlBody(request);
  if (control instanceof Response) return control;
  let rawReceipt: unknown;
  try {
    rawReceipt = await env.PROBE_CAMPAIGN.getByName(PROBE_CAMPAIGN_ACTOR_NAME)
      .status(control);
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  const receipt = decodeProbeCampaignStatusReceiptV1OrNull(
    copyCloudflareRpcRecord(rawReceipt),
  );
  if (receipt === null) return gatewayError("runtime_failure", 502);
  return noStoreJson(receipt, receipt.kind === "found" ? 200 : 404);
}

async function controlProbeCampaign(
  request: Request,
  env: ProbeGatewayEnv,
  operation: "purge" | "reconcile" | "seal-evidence",
): Promise<Response> {
  if (request.method !== "POST") return gatewayError("invalid_request", 405);
  const body = await readBoundedJson(request, PROBE_PUBLIC_BODY_MAX_BYTES);
  if (!body.ok) return publicBodyError(body.reason);
  const decoded = operation === "purge"
    ? decodeProbeCampaignPurgeRequestV1OrNull(body.value)
    : await protocolValueOrNull(
        decodeProbeCampaignControlRequestV1Effect(body.value),
      );
  if (decoded === null) return gatewayError("invalid_request", 400);
  let rawReceipt: unknown;
  try {
    const campaign = env.PROBE_CAMPAIGN.getByName(PROBE_CAMPAIGN_ACTOR_NAME);
    rawReceipt = operation === "purge"
      ? await campaign.purge(decoded)
      : operation === "reconcile"
      ? await campaign.reconcile(decoded)
      : await campaign.sealEvidence(decoded);
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  const receipt = decodeProbeCampaignControlReceiptV1OrNull(
    copyCloudflareRpcRecord(rawReceipt),
  );
  if (receipt === null) return gatewayError("runtime_failure", 502);
  return receipt.kind === "rejected"
    ? noStoreJson(receipt, campaignErrorHttpStatus(receipt.error.code))
    : noStoreJson(receipt);
}

async function readCampaignControlBody(
  request: Request,
): Promise<
  typeof ProbeCampaignControlRequestV1Schema.Type | Response
> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return gatewayError("invalid_request", 415);
  }
  const body = await readBoundedJson(request, PROBE_PUBLIC_BODY_MAX_BYTES);
  if (!body.ok) return publicBodyError(body.reason);
  const control = await protocolValueOrNull(
    decodeProbeCampaignControlRequestV1Effect(body.value),
  );
  return control ?? gatewayError("invalid_request", 400);
}

async function registerProbeRun(
  request: Request,
  env: ProbeGatewayEnv,
  admission: ProbeGatewayAdmissionPolicy,
): Promise<Response> {
  if (request.method !== "POST") {
    return gatewayError("invalid_request", 405);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return gatewayError("invalid_request", 415);
  }
  const body = await readBoundedJson(request, PROBE_PUBLIC_BODY_MAX_BYTES);
  if (!body.ok) return publicBodyError(body.reason);
  const run = await protocolValueOrNull(
    decodeProbeRunRequestV1Effect(body.value),
  );
  if (run === null) return gatewayError("invalid_request", 400);
  const manifest = ProbeCampaignManifestV1Schema.make({
    protocolVersion: run.protocolVersion,
    campaignId: ProbeCampaignIdSchema.make(run.runId),
    collectorConcurrency: 1,
    runs: [run],
  });
  return await registerCampaignManifest(env, manifest, admission);
}

async function completeExternalProbeSample(
  request: Request,
  env: ProbeGatewayEnv,
  admission: ProbeGatewayAdmissionPolicy,
): Promise<Response> {
  if (request.method !== "POST") return gatewayError("invalid_request", 405);
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return gatewayError("invalid_request", 415);
  }
  const body = await readBoundedJson(request, PROBE_SAMPLE_BODY_MAX_BYTES);
  if (!body.ok) return publicBodyError(body.reason);
  const completion = await protocolValueOrNull(
    decodeProbeExternalCompletionRequestV1Effect(body.value),
  );
  if (completion === null) return gatewayError("invalid_request", 400);
  if (!admission.runIdIsAdmitted(env, completion.runId)) {
    return gatewayError("invalid_request", 404);
  }
  let rawReceipt: unknown;
  try {
    rawReceipt = await env.PROBE_RUNS.getByName(
      probeRunActorId(completion.runId),
    ).completeExternal(completion);
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  const receipt = decodeProbeExternalCompletionReceiptV1OrNull(
    copyCloudflareRpcRecord(rawReceipt),
  );
  if (receipt === null) return gatewayError("runtime_failure", 502);
  return receipt.kind === "rejected"
    ? noStoreJson(receipt, runStateHttpStatus(receipt.error))
    : noStoreJson(receipt);
}

async function readProbeEvidencePage(
  request: Request,
  env: ProbeGatewayEnv,
  admission: ProbeGatewayAdmissionPolicy,
): Promise<Response> {
  if (request.method !== "POST") return gatewayError("invalid_request", 405);
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return gatewayError("invalid_request", 415);
  }
  const body = await readBoundedJson(request, PROBE_SAMPLE_BODY_MAX_BYTES);
  if (!body.ok) return publicBodyError(body.reason);
  const pageRequest = await protocolValueOrNull(
    decodeProbeRunEvidencePageRequestV1Effect(body.value),
  );
  if (pageRequest === null) return gatewayError("invalid_request", 400);
  if (!admission.runIdIsAdmitted(env, pageRequest.runId)) {
    return gatewayError("invalid_request", 404);
  }
  let rawReceipt: unknown;
  try {
    rawReceipt = await env.PROBE_RUNS.getByName(
      probeRunActorId(pageRequest.runId),
    ).evidencePage(pageRequest);
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  const receipt = decodeProbeRunEvidencePageReceiptV1OrNull(
    copyCloudflareRpcRecord(rawReceipt),
  );
  if (receipt === null) return gatewayError("runtime_failure", 502);
  return receipt.kind === "rejected"
    ? noStoreJson(receipt, runStateHttpStatus(receipt.error))
    : noStoreJson(receipt);
}

async function readProbeRunStatus(
  request: Request,
  env: ProbeGatewayEnv,
  runId: ProbeRunId,
): Promise<Response> {
  if (request.method !== "GET") {
    return gatewayError("invalid_request", 405);
  }
  const statusRequest = ProbeRunStatusRequestV1Schema.make({
    protocolVersion: PROBE_PROTOCOL_VERSION_V1,
    runId,
  });
  let rawReceipt: unknown;
  try {
    rawReceipt = await env.PROBE_RUNS.getByName(probeRunActorId(runId))
      .status(statusRequest);
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  const receipt = decodeProbeRunStatusReceiptV1OrNull(
    copyCloudflareRpcRecord(rawReceipt),
  );
  if (receipt === null) return gatewayError("runtime_failure", 502);
  if (
    receipt.kind === "found" &&
    !probeRunStatusReceiptMatchesRequest(receipt, statusRequest)
  ) {
    return gatewayError("runtime_failure", 502);
  }
  return noStoreJson(receipt, receipt.kind === "found" ? 200 : 404);
}

async function executeClaimedSample(
  request: Request,
  env: ProbeGatewayEnv,
  createRuntimeRerunCapability: ProbeRuntimeRerunCapabilityFactory | undefined,
  admission: ProbeGatewayAdmissionPolicy,
): Promise<Response> {
  if (request.method !== "POST") {
    return gatewayError("invalid_request", 405);
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return gatewayError("invalid_request", 415);
  }
  const body = await readBoundedJson(request, PROBE_SAMPLE_BODY_MAX_BYTES);
  if (!body.ok) return publicBodyError(body.reason);
  const publicRequest = await protocolValueOrNull(
    decodeProbePublicSampleRequestV1Effect(body.value),
  );
  if (publicRequest === null) return gatewayError("invalid_request", 400);
  if (!admission.runIdIsAdmitted(env, publicRequest.runId)) {
    return gatewayError("invalid_request", 404);
  }
  const runStub = env.PROBE_RUNS.getByName(
    probeRunActorId(publicRequest.runId),
  );
  let rawClaim: unknown;
  try {
    rawClaim = await runStub.claim(publicRequest);
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  const claim = decodeProbeSampleClaimReceiptV1OrNull(
    copyCloudflareRpcRecord(rawClaim),
  );
  if (claim === null) return gatewayError("runtime_failure", 502);
  if (claim.kind === "rejected") {
    return noStoreJson(claim, runStateHttpStatus(claim.error));
  }
  if (!probeSampleClaimReceiptMatchesRequest(claim, publicRequest)) {
    return gatewayError("runtime_failure", 502);
  }
  const sampleRequest = ProbeGatewaySampleRequestV1Schema.make({
    run: claim.run,
    sampleOrdinal: claim.sampleOrdinal,
    phase: claim.phase,
    payload: "x".repeat(claim.run.dimensions.payloadBytes),
  });
  const edgeColo = requestColo(request);
  const scenarioStartedAt = performance.now();
  let execution: ProbeScenarioExecution;
  try {
    execution = await executeRegisteredScenario(
      env,
      sampleRequest,
      edgeColo,
      createRuntimeRerunCapability,
    );
  } catch {
    execution = failedScenarioExecution(sampleRequest, edgeColo);
  }
  const scenarioWindowDurationMs = elapsedPerformanceDurationSince(
    scenarioStartedAt,
  );
  const finalizeRequest = ProbeSampleFinalizeRequestV1Schema.make({
    protocolVersion: publicRequest.protocolVersion,
    runId: publicRequest.runId,
    sampleOrdinal: publicRequest.sampleOrdinal,
    claimToken: claim.claimToken,
    fragment: execution.fragment,
    scenarioWindowDurationMs: ProbeDurationMsSchema.make(
      scenarioWindowDurationMs,
    ),
    syncWake: execution.syncWake,
  });
  let rawFinalization: unknown;
  try {
    rawFinalization = await runStub.finalize(finalizeRequest);
  } catch {
    return gatewayError("runtime_failure", 502);
  }
  const finalization = decodeProbeSampleFinalizeReceiptV1OrNull(
    copyCloudflareRpcRecord(rawFinalization),
  );
  if (finalization === null) return gatewayError("runtime_failure", 502);
  if (finalization.kind === "rejected") {
    return noStoreJson(
      finalization,
      runStateHttpStatus(finalization.error),
    );
  }
  if (
    !probeSampleFinalizeReceiptMatchesRequest(
      finalization,
      finalizeRequest,
      claim,
    )
  ) {
    return gatewayError("runtime_failure", 502);
  }
  return noStoreJson(finalization.sample);
}

async function executeRegisteredScenario(
  env: ProbeGatewayEnv,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
  createRuntimeRerunCapability: ProbeRuntimeRerunCapabilityFactory | undefined,
): Promise<ProbeScenarioExecution> {
  switch (sampleRequest.run.scenario) {
    case "edge_echo":
      return ordinaryExecution(
        gatewaySampleFromRun(
          sampleRequest.run,
          sampleRequest.sampleOrdinal,
          { edgeColo, outcome: { kind: "ok" }, spans: [] },
        ),
      );
    case "session_echo":
      return ordinaryExecution(
        await executeSessionEcho(env, sampleRequest, edgeColo),
      );
    case "dynamic_direct_echo":
      return env.LOADER === undefined
        ? failedScenarioExecution(sampleRequest, edgeColo)
        : ordinaryExecution(
            await executeDynamicDirectEcho(
              env.LOADER,
              sampleRequest,
              edgeColo,
            ),
          );
    case "facet_echo":
    case "facet_journal": {
      if (env.LOADER === undefined) {
        return failedScenarioExecution(sampleRequest, edgeColo);
      }
      return ordinaryExecution(
        await executeFacetScenario(env, sampleRequest, edgeColo),
      );
    }
    case "commit_wake":
      return env.MOCK_FINISH === undefined
        ? failedScenarioExecution(sampleRequest, edgeColo)
        : await executeCommitWake(
            env.MOCK_FINISH,
            sampleRequest,
            edgeColo,
          );
    case "full_invoke":
      if (
        env.LOADER === undefined ||
        env.MOCK_READ === undefined ||
        env.MOCK_FINISH === undefined
      ) {
        return failedScenarioExecution(sampleRequest, edgeColo);
      }
      return await executeFullInvokeScenario(env, sampleRequest, edgeColo);
    case "sync_rerun":
      if (
        env.LOADER === undefined ||
        env.MOCK_RERUN === undefined ||
        createRuntimeRerunCapability === undefined
      ) {
        return failedScenarioExecution(sampleRequest, edgeColo);
      }
      return ordinaryExecution(
        await executeSyncRerunScenario(
          env.MOCK_RERUN,
          createRuntimeRerunCapability,
          sampleRequest,
          edgeColo,
        ),
      );
  }
}

function ordinaryExecution(
  fragment: ProbeGatewaySampleV1,
): ProbeScenarioExecution {
  return { fragment, syncWake: { kind: "not-applicable" } };
}

function failedScenarioExecution(
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
): ProbeScenarioExecution {
  const error = runtimeError("request", false);
  const scenario = sampleRequest.run.scenario;
  if (scenario === "dynamic_direct_echo") {
    return {
      fragment: failedNestedSample(
        sampleRequest,
        edgeColo,
        runtimeError("gateway_dynamic_rtt", false),
        [dynamicSpan(0, { kind: "error", error: runtimeError("gateway_dynamic_rtt", false) })],
        { workerLoader: "callback-not-run", facet: "not-applicable" },
      ),
      syncWake: { kind: "not-applicable" },
    };
  }
  if (scenario === "session_echo") {
    return {
      fragment: failedNestedSample(
        sampleRequest,
        edgeColo,
        runtimeError("gateway_session_rtt", false),
        [sessionSpan(0, { kind: "error", error: runtimeError("gateway_session_rtt", false) })],
      ),
      syncWake: { kind: "not-applicable" },
    };
  }
  const startup =
    scenario === "facet_echo" ||
      scenario === "facet_journal" ||
      scenario === "full_invoke" ||
      scenario === "sync_rerun"
      ? { workerLoader: "callback-not-run", facet: "callback-not-run" } as const
      : undefined;
  return {
    fragment: failedNestedSample(
      sampleRequest,
      edgeColo,
      error,
      [],
      startup,
    ),
    syncWake: scenario === "commit_wake" || scenario === "full_invoke"
      ? { kind: "unobserved" }
      : { kind: "not-applicable" },
  };
}

async function runIdFromStatusPath(pathname: string): Promise<ProbeRunId | null> {
  const prefix = `${PROBE_RUN_ROUTE}/`;
  if (!pathname.startsWith(prefix)) return null;
  const segment = pathname.slice(prefix.length);
  if (segment.length === 0 || segment.includes("/")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return await protocolValueOrNull(decodeProbeRunIdEffect(decoded));
}

function publicBodyError(
  reason: "body_too_large" | "invalid_body",
): Response {
  return gatewayError(
    reason === "body_too_large" ? "limit_exceeded" : "invalid_request",
    reason === "body_too_large" ? 413 : 400,
  );
}

function runStateHttpStatus(error: ProbeRunStateErrorV1): number {
  if (error.code === "concurrency-limit") {
    return 429;
  }
  if (error.code === "run-not-registered") return 404;
  if (
    error.code === "sample-out-of-range" ||
    error.code.endsWith("budget-exhausted")
  ) {
    return 422;
  }
  return 409;
}

function campaignErrorHttpStatus(code: ProbeCampaignErrorCodeV1): number {
  switch (code) {
    case "invalid-request":
    case "identity-mismatch":
      return 400;
    case "campaign-not-registered":
      return 404;
    case "registration-incomplete":
    case "reconciliation-incomplete":
    case "purge-incomplete":
      return 503;
    case "manifest-conflict":
    case "campaign-not-running":
    case "campaign-not-reconciled":
    case "evidence-not-sealed":
    case "target-rejected":
      return 409;
  }
}

async function executeFacetScenario(
  env: ProbeGatewayEnv,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
): Promise<ProbeGatewaySampleV1> {
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
    const error = runtimeError(
      "gateway_session_rtt",
      probeRuntimeFailureRetryable({ kind: "transport" }),
    );
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      error,
      [
        sessionSpan(elapsedPerformanceDurationSince(startedAt), {
          kind: "error",
          error,
        }),
      ],
      unobservedFacetStartup(),
    );
  }
  const sessionDurationMs = elapsedPerformanceDurationSince(startedAt);
  if (!response.ok) {
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
      [sessionSpan(sessionDurationMs, { kind: "error", error })],
      unobservedFacetStartup(),
    );
  }
  const body = await readBoundedJson(
    response,
    PROBE_INTERNAL_RESPONSE_MAX_BYTES,
  );
  const decoded = body.ok ? await decodeFacetSessionResponse(body.value) : null;
  if (
    decoded === null ||
    !(await sameFacetSessionReceipt(decoded, internalRequest))
  ) {
    const error = runtimeError(
      "gateway_session_rtt",
      probeRuntimeFailureRetryable({ kind: "invalid-receipt" }),
    );
    return failedNestedSample(
      sampleRequest,
      edgeColo,
      error,
      [sessionSpan(sessionDurationMs, { kind: "error", error })],
      unobservedFacetStartup(),
    );
  }

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

export function probeRegisteredRunReceiptMatchesRequest(
  receipt: Extract<
    ProbeRunRegistrationReceiptV1,
    { readonly kind: "registered" }
  >,
  request: ProbeRunRequestV1,
): boolean {
  return receipt.protocolVersion === request.protocolVersion &&
    receipt.status.protocolVersion === request.protocolVersion &&
    canonicalProbeRunRequestV1(receipt.status.run) ===
      canonicalProbeRunRequestV1(request);
}

export function probeRunStatusReceiptMatchesRequest(
  receipt: Extract<ProbeRunStatusReceiptV1, { readonly kind: "found" }>,
  request: typeof ProbeRunStatusRequestV1Schema.Type,
): boolean {
  return receipt.protocolVersion === request.protocolVersion &&
    receipt.status.protocolVersion === request.protocolVersion &&
    receipt.status.run.protocolVersion === request.protocolVersion &&
    receipt.status.run.runId === request.runId;
}

export function probeSampleClaimReceiptMatchesRequest(
  receipt: Extract<ProbeSampleClaimReceiptV1, { readonly kind: "claimed" }>,
  request: ProbePublicSampleRequestV1,
): boolean {
  const expectedPhase = receipt.sampleOrdinal < receipt.run.warmupRepetitions
    ? "warmup"
    : "measurement";
  return receipt.protocolVersion === request.protocolVersion &&
    receipt.run.protocolVersion === request.protocolVersion &&
    receipt.run.runId === request.runId &&
    receipt.sampleOrdinal === request.sampleOrdinal &&
    receipt.sampleOrdinal <
      receipt.run.warmupRepetitions + receipt.run.repetitions &&
    receipt.phase === expectedPhase &&
    receipt.observedOutstandingClaims <= receipt.run.dimensions.concurrency;
}

export function probeSampleFinalizeReceiptMatchesRequest(
  receipt: Extract<ProbeSampleFinalizeReceiptV1, { readonly kind: "finalized" }>,
  request: ProbeSampleFinalizeRequestV1,
  claim: Extract<ProbeSampleClaimReceiptV1, { readonly kind: "claimed" }>,
): boolean {
  const { fragment, control } = receipt.sample;
  return receipt.protocolVersion === request.protocolVersion &&
    request.protocolVersion === claim.run.protocolVersion &&
    request.runId === claim.run.runId &&
    request.sampleOrdinal === claim.sampleOrdinal &&
    request.claimToken === claim.claimToken &&
    request.fragment.scenario === claim.run.scenario &&
    sameProbeDimensionsV1(request.fragment.dimensions, claim.run.dimensions) &&
    sameProbeGatewaySample(fragment, request.fragment) &&
    control.phase === claim.phase &&
    control.terminalState ===
      (request.fragment.outcome.kind === "ok" ? "completed" : "failed") &&
    control.measurementDisposition === expectedMeasurementDisposition(
      claim.phase,
      request.syncWake,
    ) &&
    control.configuredConcurrency === claim.run.dimensions.concurrency &&
    control.observedOutstandingClaims >= claim.observedOutstandingClaims &&
    control.observedOutstandingClaims <= claim.run.dimensions.concurrency &&
    control.scenarioWindowDurationMs === request.scenarioWindowDurationMs &&
    sameSyncWakeObservation(control.syncWake, request.syncWake);
}

type ProbeComparableOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly error: ProbeNormalizedErrorV1 };

function sameProbeGatewaySample(
  left: ProbeGatewaySampleV1,
  right: ProbeGatewaySampleV1,
): boolean {
  return left.protocolVersion === right.protocolVersion &&
    left.runId === right.runId &&
    left.sampleId === right.sampleId &&
    left.scenario === right.scenario &&
    sameProbeDimensionsV1(left.dimensions, right.dimensions) &&
    sameProbeSampleIdentityV1(left.identity, right.identity) &&
    left.startup.workerLoader === right.startup.workerLoader &&
    left.startup.facet === right.startup.facet &&
    left.edgeColo === right.edgeColo &&
    sameProbeOutcome(left.outcome, right.outcome) &&
    left.spans.length === right.spans.length &&
    left.spans.every((span, index) => {
      const other = right.spans[index];
      return other !== undefined &&
        span.spanId === other.spanId &&
        span.parentSpanId === other.parentSpanId &&
        span.name === other.name &&
        span.durationMs === other.durationMs &&
        sameProbeOutcome(span.outcome, other.outcome);
    });
}

function sameProbeOutcome(
  left: ProbeComparableOutcome,
  right: ProbeComparableOutcome,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "ok" || right.kind === "ok") return true;
  return sameProbeNormalizedErrorV1(left.error, right.error);
}

function sameSyncWakeObservation(
  left: ProbeSyncWakeObservationV1,
  right: ProbeSyncWakeObservationV1,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "observed" || right.kind !== "observed") return true;
  return left.disposition === right.disposition;
}

function expectedMeasurementDisposition(
  phase: Extract<
    ProbeSampleClaimReceiptV1,
    { readonly kind: "claimed" }
  >["phase"],
  syncWake: ProbeSyncWakeObservationV1,
) {
  if (phase === "warmup") return "excluded-warmup" as const;
  return syncWake.kind === "observed" &&
      syncWake.disposition === "duplicate"
    ? "excluded-duplicate-wake" as const
    : "eligible" as const;
}

async function executeCommitWake(
  mockFinish: Service<typeof MockFinishEntrypoint>,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
): Promise<ProbeScenarioExecution> {
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
    return {
      fragment: failedNestedSample(
        sampleRequest,
        edgeColo,
        runtimeError("mock_sync_wake_rtt", true),
      ),
      syncWake: { kind: "unobserved" },
    };
  }
  if (finish === null || !sameMockFinishReceipt(finish, finishRequest)) {
    return {
      fragment: failedNestedSample(
        sampleRequest,
        edgeColo,
        runtimeError("mock_sync_wake_rtt", false),
      ),
      syncWake: { kind: "unobserved" },
    };
  }
  if (
    finish.sync.disposition !== "applied" &&
    finish.sync.disposition !== "duplicate"
  ) {
    const error = runtimeError("sync_cursor_io", false);
    return {
      fragment: failedNestedSample(
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
      ),
      syncWake: {
        kind: "observed",
        disposition: finish.sync.disposition,
      },
    };
  }
  return {
    fragment: gatewaySampleFromRun(
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
    ),
    syncWake: {
      kind: "observed",
      disposition: finish.sync.disposition,
    },
  };
}

async function executeFullInvokeScenario(
  env: ProbeGatewayEnv,
  sampleRequest: ProbeGatewaySampleRequestV1,
  edgeColo: string | null,
): Promise<ProbeScenarioExecution> {
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
    return {
      fragment: failedNestedSample(
        sampleRequest,
        edgeColo,
        error,
        [
          sessionSpan(elapsedPerformanceDurationSince(startedAt), {
            kind: "error",
            error,
          }),
        ],
        unobservedFacetStartup(),
      ),
      syncWake: { kind: "unobserved" },
    };
  }
  const sessionDurationMs = elapsedPerformanceDurationSince(startedAt);
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
      return {
        fragment: gatewaySampleFromRun(
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
        ),
        syncWake: {
          kind: "observed",
          disposition: failure.finish.sync.disposition,
        },
      };
    }
    const error = runtimeError(
      "gateway_session_rtt",
      probeRuntimeFailureRetryable({
        kind: "response-status",
        status: response.status,
      }),
    );
    return {
      fragment: failedNestedSample(
        sampleRequest,
        edgeColo,
        error,
        [
          sessionSpan(elapsedPerformanceDurationSince(startedAt), {
            kind: "error",
            error,
          }),
        ],
        unobservedFacetStartup(),
      ),
      syncWake: { kind: "unobserved" },
    };
  }
  const decoded = body.ok
    ? decodeFullInvokeSessionResponse(body.value)
    : null;
  if (
    decoded === null ||
    !(await sameFullInvokeSessionReceipt(decoded, internalRequest))
  ) {
    const error = runtimeError("gateway_session_rtt", false);
    return {
      fragment: failedNestedSample(
        sampleRequest,
        edgeColo,
        error,
        [
          sessionSpan(elapsedPerformanceDurationSince(startedAt), {
            kind: "error",
            error,
          }),
        ],
        unobservedFacetStartup(),
      ),
      syncWake: { kind: "unobserved" },
    };
  }
  return {
    fragment: gatewaySampleFromRun(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      {
        edgeColo,
        outcome: { kind: "ok" },
        spans: fullInvokeSpans(decoded, sessionDurationMs),
        startup: fullInvokeStartup(decoded),
      },
    ),
    syncWake: {
      kind: "observed",
      disposition: decoded.finish.sync.disposition,
    },
  };
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
      elapsedPerformanceDurationSince(startedAt),
      probeRuntimeFailureRetryable({ kind: "transport" }),
    );
  }
  if (!response.ok) {
    return failedSessionSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      elapsedPerformanceDurationSince(startedAt),
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
  const durationMs = elapsedPerformanceDurationSince(startedAt);
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
      elapsedPerformanceDurationSince(startedAt),
      loaderCallbackRan,
      probeRuntimeFailureRetryable({ kind: "transport" }),
    );
  }
  if (!response.ok) {
    return failedDynamicSample(
      sampleRequest.run,
      sampleRequest.sampleOrdinal,
      edgeColo,
      elapsedPerformanceDurationSince(startedAt),
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
  const durationMs = elapsedPerformanceDurationSince(startedAt);
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

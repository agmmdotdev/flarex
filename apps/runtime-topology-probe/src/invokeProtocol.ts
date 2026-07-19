import { Data, Effect, Schema } from "effect";

import {
  probeCommitIdentityIssueV1,
  probeInvokeRuntimeIdentityIssueV1,
  probeMockFinishResponsesEqualV1,
  ProbeCommitScenarioSchema,
  ProbeInvokeCommitScenarioSchema,
  ProbeMockFinishResponseV1Schema,
  type ProbeMockReadRequestV1,
  ProbeMockReadResponseV1Schema,
  type ProbeMockReadResponseV1,
  ProbeSyntheticCommitSeqSchema,
  ProbeSyntheticCursorSchema,
} from "./commitProtocol";
import {
  ProbeAttemptIdSchema,
  ProbeCodeIdSchema,
  ProbeCodeModeSchema,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  ProbeSampleIdSchema,
  ProbeScopeIdSchema,
  ProbeSessionIdSchema,
} from "./identity";
import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  PROBE_LIMITS_V1,
  ProbeDurationMsSchema,
  ProbeNormalizedErrorV1Schema,
  ProbeProtocolVersionV1Schema,
  ProbeSessionModeSchema,
} from "./protocol";
import { sha256Hex } from "./sha256";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strictSchemaOptions";

const SyntheticPayloadSchema = Schema.String.check(Schema.isPattern(/^x*$/));
const PayloadBytesSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= PROBE_LIMITS_V1.maxPayloadBytes
      ? undefined
      : "payloadBytes exceeds the protocol limit"
  ),
);
const JournalEntriesSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= PROBE_LIMITS_V1.maxJournalEntries
      ? undefined
      : "journalEntries exceeds the protocol limit"
  ),
);
const SealDigestSchema = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/),
);

const InvokeIdentityShape = {
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  scopeId: ProbeScopeIdSchema,
  scenario: ProbeInvokeCommitScenarioSchema,
  commitSeq: ProbeSyntheticCommitSeqSchema,
  sessionId: ProbeSessionIdSchema,
  sessionMode: ProbeSessionModeSchema,
  attemptId: ProbeAttemptIdSchema,
  codeMode: ProbeCodeModeSchema,
  codeId: ProbeCodeIdSchema,
  journalEntries: JournalEntriesSchema,
} as const;

const ProbeInvokeFacetRequestV1Shape = Schema.Struct({
  ...InvokeIdentityShape,
  payload: SyntheticPayloadSchema,
}).annotate(StrictStructOptions);

export const ProbeInvokeFacetRequestV1Schema =
  ProbeInvokeFacetRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = invokeIdentityIssue(request);
      if (identityIssue !== undefined) return identityIssue;
      return request.payload.length <= PROBE_LIMITS_V1.maxPayloadBytes
        ? undefined
        : "payload exceeds the protocol byte limit";
    }),
  );
export type ProbeInvokeFacetRequestV1 =
  typeof ProbeInvokeFacetRequestV1Schema.Type;

const ProbeInvokeFacetExecutionRequestV1Shape = Schema.Struct({
  ...InvokeIdentityShape,
  payload: SyntheticPayloadSchema,
  prefetchedRead: Schema.Union([
    ProbeMockReadResponseV1Schema,
    Schema.Null,
  ]),
}).annotate(StrictStructOptions);

export const ProbeInvokeFacetExecutionRequestV1Schema =
  ProbeInvokeFacetExecutionRequestV1Shape.check(
    Schema.makeFilter(request => {
      const identityIssue = invokeIdentityIssue(request);
      if (identityIssue !== undefined) return identityIssue;
      if (request.payload.length > PROBE_LIMITS_V1.maxPayloadBytes) {
        return "payload exceeds the protocol byte limit";
      }
      if (
        request.scenario === "facet_executor_invoke" ||
        request.scenario === "facet_finalizer_invoke"
      ) {
        return request.prefetchedRead !== null &&
            probeMockReadReceiptMatchesRequestV1(
              request.prefetchedRead,
              probeMockReadRequestFromInvoke(request),
            )
          ? undefined
          : "facet executor requires the exact prefetched read receipt";
      }
      return request.prefetchedRead === null
        ? undefined
        : "only the facet executor may receive a prefetched read receipt";
    }),
  );
export type ProbeInvokeFacetExecutionRequestV1 =
  typeof ProbeInvokeFacetExecutionRequestV1Schema.Type;

export function probeMockReadRequestFromInvoke(
  request: ProbeInvokeFacetRequestV1,
): ProbeMockReadRequestV1 {
  return {
    protocolVersion: request.protocolVersion,
    runId: request.runId,
    sampleId: request.sampleId,
    sampleOrdinal: request.sampleOrdinal,
    scopeId: request.scopeId,
    scenario: request.scenario,
    commitSeq: request.commitSeq,
    sessionId: request.sessionId,
    sessionMode: request.sessionMode,
    attemptId: request.attemptId,
    codeMode: request.codeMode,
    codeId: request.codeId,
    payloadBytes: request.payload.length,
  };
}

export function probeMockReadReceiptMatchesRequestV1(
  receipt: ProbeMockReadResponseV1,
  request: ProbeMockReadRequestV1,
): boolean {
  return receipt.protocolVersion === request.protocolVersion &&
    receipt.runId === request.runId &&
    receipt.sampleId === request.sampleId &&
    receipt.sampleOrdinal === request.sampleOrdinal &&
    receipt.scopeId === request.scopeId &&
    receipt.scenario === request.scenario &&
    receipt.commitSeq === request.commitSeq &&
    receipt.sessionId === request.sessionId &&
    receipt.sessionMode === request.sessionMode &&
    receipt.attemptId === request.attemptId &&
    receipt.codeMode === request.codeMode &&
    receipt.codeId === request.codeId &&
    receipt.payloadBytes === request.payloadBytes &&
    receipt.syntheticRevision === request.commitSeq - 1;
}

const ProbeInvokeFacetWorkerResponseV1Shape = Schema.Struct({
  ...InvokeIdentityShape,
  payloadBytes: PayloadBytesSchema,
  syntheticRevision: ProbeSyntheticCursorSchema,
  mockReadDurationMs: ProbeDurationMsSchema,
  readMode: Schema.Literals(["bound-capability", "prefetched-snapshot"]),
  outboundReadCalls: Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value === 0 || value === 1
        ? undefined
        : "outboundReadCalls must be zero or one"
    ),
  ),
  outboundFinishCalls: Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value === 0 || value === 1
        ? undefined
        : "outboundFinishCalls must be zero or one"
    ),
  ),
  journalDurationMs: ProbeDurationMsSchema,
  facetFinalizationDurationMs: Schema.Union([
    ProbeDurationMsSchema,
    Schema.Null,
  ]),
  attemptPhase: Schema.Literals(["sealed", "committed"]),
  sealDigest: SealDigestSchema,
  resultDigest: SealDigestSchema,
  commitIntent: Schema.Struct({
    protocolVersion: Schema.Literal(1),
    snapshotRevision: ProbeSyntheticCursorSchema,
    journalEntries: JournalEntriesSchema,
    journalSealDigest: SealDigestSchema,
    resultDigest: SealDigestSchema,
    digest: SealDigestSchema,
  }).annotate(StrictStructOptions),
  finish: Schema.Union([ProbeMockFinishResponseV1Schema, Schema.Null]),
}).annotate(StrictStructOptions);

export const ProbeInvokeFacetWorkerResponseV1Schema =
  ProbeInvokeFacetWorkerResponseV1Shape.check(
    Schema.makeFilter(response => {
      const identityIssue = invokeIdentityIssue(response);
      if (identityIssue !== undefined) return identityIssue;
      if (response.syntheticRevision !== response.commitSeq - 1) {
        return "syntheticRevision must identify the pre-commit synthetic snapshot";
      }
      const snapshotSeeded =
        response.scenario === "facet_executor_invoke" ||
        response.scenario === "facet_finalizer_invoke";
      if (
        response.commitIntent.snapshotRevision !== response.syntheticRevision ||
        response.commitIntent.journalEntries !== response.journalEntries ||
        response.commitIntent.journalSealDigest !== response.sealDigest ||
        response.commitIntent.resultDigest !== response.resultDigest
      ) {
        return "sealed commit intent evidence must match the facet result";
      }
      const readEvidenceMatches = response.readMode ===
            (snapshotSeeded ? "prefetched-snapshot" : "bound-capability") &&
        response.outboundReadCalls === (snapshotSeeded ? 0 : 1);
      if (!readEvidenceMatches) {
        return "read mode and outbound call evidence must match the invoke scenario";
      }
      const facetFinalizer = response.scenario === "facet_finalizer_invoke";
      if (!facetFinalizer) {
        return response.outboundFinishCalls === 0 &&
            response.facetFinalizationDurationMs === null &&
            response.attemptPhase === "sealed" &&
            response.finish === null
          ? undefined
          : "non-finalizer facets cannot report a finish capability or committed outcome";
      }
      if (
        response.outboundFinishCalls !== 1 ||
        response.facetFinalizationDurationMs === null ||
        response.attemptPhase !== "committed" ||
        response.finish === null ||
        response.finish.request.scenario === "commit_wake"
      ) {
        return "facet finalizer requires one exact committed finish receipt";
      }
      return sameInvokeAndFinishIdentity(response, response.finish.request)
        ? undefined
        : "facet finalizer finish must match the exact facet invocation identity";
    }),
  );
export type ProbeInvokeFacetWorkerResponseV1 =
  typeof ProbeInvokeFacetWorkerResponseV1Schema.Type;

export const ProbeFacetFinalizerOutcomeUncertainV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  sessionId: ProbeSessionIdSchema,
  attemptId: ProbeAttemptIdSchema,
  error: Schema.Literal("facet_finalizer_outcome_uncertain"),
}).annotate(StrictStructOptions);
export type ProbeFacetFinalizerOutcomeUncertainV1 =
  typeof ProbeFacetFinalizerOutcomeUncertainV1Schema.Type;

const FullInvokeSessionObservationShape = {
  facet: ProbeInvokeFacetWorkerResponseV1Schema,
  facetDurationMs: ProbeDurationMsSchema,
  workerLoaderCallbackRan: Schema.Boolean,
  facetStartupCallbackRan: Schema.Boolean,
  executorHost: Schema.Literals([
    "external-worker",
    "facet-do",
    "facet-finalizer",
    "session-do",
  ]),
  readCapabilityCalls: Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value === 0 || value === 1
        ? undefined
        : "readCapabilityCalls must be zero or one"
    ),
  ),
  sessionMockFinishDurationMs: ProbeDurationMsSchema,
  snapshotReadDurationMs: Schema.Union([
    ProbeDurationMsSchema,
    Schema.Null,
  ]),
  finish: ProbeMockFinishResponseV1Schema,
} as const;

const ProbeFullInvokeSessionResponseV1Shape = Schema.Struct(
  FullInvokeSessionObservationShape,
).annotate(StrictStructOptions);

export const ProbeFullInvokeSessionResponseV1Schema =
  ProbeFullInvokeSessionResponseV1Shape.check(
    Schema.makeFilter(response => {
      const observationIssue = fullInvokeSessionObservationIssue(response);
      if (observationIssue !== undefined) return observationIssue;
      if (
        response.finish.sync.disposition !== "applied" &&
        response.finish.sync.disposition !== "duplicate"
      ) {
        return "successful full invoke requires an applied or duplicate wake";
      }
      return undefined;
    }),
  );
export type ProbeFullInvokeSessionResponseV1 =
  typeof ProbeFullInvokeSessionResponseV1Schema.Type;

const ProbeFullInvokeSessionFailureV1Shape = Schema.Struct({
  ...FullInvokeSessionObservationShape,
  error: ProbeNormalizedErrorV1Schema,
}).annotate(StrictStructOptions);

export const ProbeFullInvokeSessionFailureV1Schema =
  ProbeFullInvokeSessionFailureV1Shape.check(
    Schema.makeFilter(response => {
      const observationIssue = fullInvokeSessionObservationIssue(response);
      if (observationIssue !== undefined) return observationIssue;
      if (
        response.finish.sync.disposition !== "gap" &&
        response.finish.sync.disposition !== "stale"
      ) {
        return "failed full invoke requires a rejected gap or stale wake";
      }
      return response.error.code === "runtime_failure" &&
          response.error.stage === "sync_cursor_io" &&
          response.error.retryable === false
        ? undefined
        : "failed full invoke requires the canonical sync-cursor error";
    }),
  );
export type ProbeFullInvokeSessionFailureV1 =
  typeof ProbeFullInvokeSessionFailureV1Schema.Type;
export type ProbeFullInvokeSessionObservationV1 =
  | ProbeFullInvokeSessionFailureV1
  | ProbeFullInvokeSessionResponseV1;

export async function probeInvokeJournalSealDigest(
  request: ProbeInvokeFacetRequestV1,
): Promise<string> {
  const payloadDigest = await sha256Hex(request.payload);
  return await sha256Hex(canonicalJournalSeal(request, payloadDigest));
}

export async function probeInvokeResultDigest(
  request: ProbeInvokeFacetRequestV1,
  syntheticRevision: number,
): Promise<string> {
  return await sha256Hex(JSON.stringify([
    1,
    "ok",
    request.runId,
    request.sampleId,
    request.attemptId,
    request.payload.length,
    syntheticRevision,
  ]));
}

export async function probeFacetCommitIntentDigest(
  request: ProbeInvokeFacetRequestV1,
  evidence: {
    readonly resultDigest: string;
    readonly sealDigest: string;
    readonly syntheticRevision: number;
  },
): Promise<string> {
  return await sha256Hex(JSON.stringify([
    1,
    request.runId,
    request.scopeId,
    request.sampleId,
    request.sessionId,
    request.attemptId,
    request.codeId,
    request.commitSeq,
    evidence.syntheticRevision,
    request.journalEntries,
    evidence.sealDigest,
    evidence.resultDigest,
  ]));
}

export async function probeInvokeFacetReceiptMatchesRequestV1(
  response: ProbeInvokeFacetWorkerResponseV1,
  request: ProbeInvokeFacetRequestV1,
): Promise<boolean> {
  const expectedSealDigest = await probeInvokeJournalSealDigest(request);
  const expectedResultDigest = await probeInvokeResultDigest(
    request,
    response.syntheticRevision,
  );
  const expectedCommitIntentDigest = await probeFacetCommitIntentDigest(
    request,
    {
      syntheticRevision: response.syntheticRevision,
      sealDigest: expectedSealDigest,
      resultDigest: expectedResultDigest,
    },
  );
  const snapshotSeeded = request.scenario === "facet_executor_invoke" ||
    request.scenario === "facet_finalizer_invoke";
  const facetFinalizer = request.scenario === "facet_finalizer_invoke";
  const finalizationMatches = facetFinalizer
    ? response.outboundFinishCalls === 1 &&
      response.facetFinalizationDurationMs !== null &&
      response.attemptPhase === "committed" &&
      response.finish !== null &&
      response.finish.request.scenario !== "commit_wake" &&
      sameInvokeAndFinishIdentity(response, response.finish.request)
    : response.outboundFinishCalls === 0 &&
      response.facetFinalizationDurationMs === null &&
      response.attemptPhase === "sealed" &&
      response.finish === null;
  return response.protocolVersion === request.protocolVersion &&
    response.runId === request.runId &&
    response.sampleId === request.sampleId &&
    response.sampleOrdinal === request.sampleOrdinal &&
    response.scopeId === request.scopeId &&
    response.scenario === request.scenario &&
    response.commitSeq === request.commitSeq &&
    response.sessionId === request.sessionId &&
    response.sessionMode === request.sessionMode &&
    response.attemptId === request.attemptId &&
    response.codeMode === request.codeMode &&
    response.codeId === request.codeId &&
    response.journalEntries === request.journalEntries &&
    response.payloadBytes === request.payload.length &&
    response.syntheticRevision === request.commitSeq - 1 &&
    response.readMode ===
      (snapshotSeeded ? "prefetched-snapshot" : "bound-capability") &&
    response.outboundReadCalls === (snapshotSeeded ? 0 : 1) &&
    finalizationMatches &&
    response.sealDigest === expectedSealDigest &&
    response.resultDigest === expectedResultDigest &&
    response.commitIntent.protocolVersion === 1 &&
    response.commitIntent.snapshotRevision === response.syntheticRevision &&
    response.commitIntent.journalEntries === request.journalEntries &&
    response.commitIntent.journalSealDigest === expectedSealDigest &&
    response.commitIntent.resultDigest === expectedResultDigest &&
    response.commitIntent.digest === expectedCommitIntentDigest;
}

export class ProbeInvokeProtocolValidationError extends Data.TaggedError(
  "ProbeInvokeProtocolValidationError",
)<{
  readonly boundary:
    | "invoke-request"
    | "invoke-worker-response"
    | "invoke-session-response"
    | "invoke-session-failure";
  readonly cause: unknown;
}> {}

function decoder<S extends Schema.Top>(
  schema: S,
  boundary: ProbeInvokeProtocolValidationError["boundary"],
) {
  const decode = Schema.decodeUnknownEffect(schema, StrictParseOptions);
  return (value: unknown) =>
    decode(value).pipe(
      Effect.mapError(
        cause => new ProbeInvokeProtocolValidationError({ boundary, cause }),
      ),
    );
}

const decodeInvokeRequest = decoder(
  ProbeInvokeFacetRequestV1Schema,
  "invoke-request",
);
const decodeInvokeWorkerResponse = decoder(
  ProbeInvokeFacetWorkerResponseV1Schema,
  "invoke-worker-response",
);
const decodeInvokeSessionResponse = decoder(
  ProbeFullInvokeSessionResponseV1Schema,
  "invoke-session-response",
);
const decodeInvokeSessionFailure = decoder(
  ProbeFullInvokeSessionFailureV1Schema,
  "invoke-session-failure",
);

export const decodeProbeInvokeFacetRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeInvokeFacetRequestV1",
)((value: unknown) => decodeInvokeRequest(value));
export const decodeProbeInvokeFacetWorkerResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeInvokeFacetWorkerResponseV1",
)((value: unknown) => decodeInvokeWorkerResponse(value));
export const decodeProbeFullInvokeSessionResponseV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFullInvokeSessionResponseV1",
)((value: unknown) => decodeInvokeSessionResponse(value));
export const decodeProbeFullInvokeSessionFailureV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeFullInvokeSessionFailureV1",
)((value: unknown) => decodeInvokeSessionFailure(value));

export const decodeProbeInvokeFacetRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeInvokeFacetRequestV1Schema);
export const decodeProbeInvokeFacetExecutionRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeInvokeFacetExecutionRequestV1Schema);
export const decodeProbeInvokeFacetWorkerResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeInvokeFacetWorkerResponseV1Schema);
export const decodeProbeFullInvokeSessionResponseV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeFullInvokeSessionResponseV1Schema);
export const decodeProbeFullInvokeSessionFailureV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeFullInvokeSessionFailureV1Schema);
export const decodeProbeFacetFinalizerOutcomeUncertainV1OrNull =
  strictSchemaValueOrNullDecoder(
    ProbeFacetFinalizerOutcomeUncertainV1Schema,
  );

function fullInvokeSessionObservationIssue(response: {
  readonly executorHost:
    | "external-worker"
    | "facet-do"
    | "facet-finalizer"
    | "session-do";
  readonly facet: ProbeInvokeFacetWorkerResponseV1;
  readonly facetStartupCallbackRan: boolean;
  readonly finish: typeof ProbeMockFinishResponseV1Schema.Type;
  readonly readCapabilityCalls: number;
  readonly sessionMockFinishDurationMs: number;
  readonly snapshotReadDurationMs: number | null;
  readonly workerLoaderCallbackRan: boolean;
}): string | undefined {
  if (
    response.workerLoaderCallbackRan &&
    !response.facetStartupCallbackRan
  ) {
    return "Worker Loader callback cannot run without facet startup";
  }
  const request = response.finish.request;
  if (request.scenario === "commit_wake") {
    return "invoke session observation requires an invoke finish";
  }
  const expectedHost = request.scenario === "session_executor_invoke"
    ? "session-do"
    : request.scenario === "facet_finalizer_invoke"
    ? "facet-finalizer"
    : request.scenario === "facet_executor_invoke"
    ? "facet-do"
    : "external-worker";
  const snapshotSeeded = expectedHost === "facet-do" ||
    expectedHost === "facet-finalizer";
  if (
    response.executorHost !== expectedHost ||
    response.readCapabilityCalls !== (expectedHost === "session-do" ? 1 : 0) ||
    (snapshotSeeded
      ? response.snapshotReadDurationMs === null
      : response.snapshotReadDurationMs !== null)
  ) {
    return "executor host, read capability, and snapshot evidence must match the invoke scenario";
  }
  if (expectedHost === "facet-finalizer") {
    if (
      response.sessionMockFinishDurationMs !== 0 ||
      response.facet.finish === null ||
      !probeMockFinishResponsesEqualV1(response.facet.finish, response.finish)
    ) {
      return "facet finalizer must carry the exact outer finish receipt and report zero SessionDO finish duration";
    }
  } else if (response.facet.finish !== null) {
    return "non-finalizer facets cannot carry the session-owned finish receipt";
  }
  return sameInvokeAndFinishIdentity(response.facet, request)
    ? undefined
    : "mock finish must match the exact facet invocation identity";
}

function invokeIdentityIssue(input: {
  readonly attemptId: typeof ProbeAttemptIdSchema.Type;
  readonly codeId: typeof ProbeCodeIdSchema.Type;
  readonly codeMode: typeof ProbeCodeModeSchema.Type;
  readonly commitSeq: typeof ProbeSyntheticCommitSeqSchema.Type;
  readonly runId: typeof ProbeRunIdSchema.Type;
  readonly sampleId: typeof ProbeSampleIdSchema.Type;
  readonly sampleOrdinal: typeof ProbeOrdinalSchema.Type;
  readonly scopeId: typeof ProbeScopeIdSchema.Type;
  readonly scenario: typeof ProbeCommitScenarioSchema.Type;
  readonly sessionId: typeof ProbeSessionIdSchema.Type;
  readonly sessionMode: typeof ProbeSessionModeSchema.Type;
}): string | undefined {
  const commitIssue = probeCommitIdentityIssueV1(input);
  return commitIssue ?? probeInvokeRuntimeIdentityIssueV1(input);
}

function sameInvokeAndFinishIdentity(
  facet: ProbeInvokeFacetWorkerResponseV1,
  finish: Exclude<
    typeof ProbeMockFinishResponseV1Schema.Type["request"],
    { readonly scenario: "commit_wake" }
  >,
): boolean {
  return facet.protocolVersion === finish.protocolVersion &&
    facet.runId === finish.runId &&
    facet.sampleId === finish.sampleId &&
    facet.sampleOrdinal === finish.sampleOrdinal &&
    facet.scopeId === finish.scopeId &&
    facet.scenario === finish.scenario &&
    facet.commitSeq === finish.commitSeq &&
    facet.sessionId === finish.sessionId &&
    facet.sessionMode === finish.sessionMode &&
    facet.attemptId === finish.attemptId &&
    facet.codeMode === finish.codeMode &&
    facet.codeId === finish.codeId &&
    facet.journalEntries === finish.journalEntries &&
    facet.sealDigest === finish.sealDigest;
}

function canonicalJournalSeal(
  request: ProbeInvokeFacetRequestV1,
  payloadDigest: string,
): string {
  return JSON.stringify([
    1,
    request.runId,
    request.scopeId,
    request.sampleId,
    request.sessionId,
    request.attemptId,
    request.codeId,
    request.commitSeq,
    request.journalEntries,
    request.payload.length,
    payloadDigest,
    Array.from({ length: request.journalEntries }, (_, sequence) => sequence),
  ]);
}

export const PROBE_INVOKE_WORKER_MAIN_MODULE = "probe-invoke-worker.js";
export const PROBE_INVOKE_FACET_CLASS_NAME = "ProbeInvocationFacet";

export interface ProbeInvokeReadCapability {
  read(value: unknown): Promise<ProbeMockReadResponseV1>;
}

export interface ProbeInvokeFinishCapability {
  finish(value: unknown): Promise<typeof ProbeMockFinishResponseV1Schema.Type>;
}

export interface ProbeInvokeSessionReadCapability {
  read(
    envelope: unknown,
    value: unknown,
  ): Promise<ProbeMockReadResponseV1>;
}

export function probeInvokeWorkerCode(
  executorRead: ProbeInvokeReadCapability,
): WorkerLoaderWorkerCode {
  return probeInvokeWorkerCodeWithEnv({ EXECUTOR_READ: executorRead });
}

export function probeSessionInvokeWorkerCode(
  executorRead: ProbeInvokeSessionReadCapability,
  executorCapability: unknown,
): WorkerLoaderWorkerCode {
  return probeInvokeWorkerCodeWithEnv({
    EXECUTOR_READ: executorRead,
    EXECUTOR_CAPABILITY: executorCapability,
  });
}

export function probeSnapshotInvokeWorkerCode(): WorkerLoaderWorkerCode {
  return probeInvokeWorkerCodeWithEnv({});
}

export function probeFacetFinalizerWorkerCode(
  executorFinish: ProbeInvokeFinishCapability,
): WorkerLoaderWorkerCode {
  return probeInvokeWorkerCodeWithEnv({ EXECUTOR_FINISH: executorFinish });
}

function probeInvokeWorkerCodeWithEnv(
  env: WorkerLoaderWorkerCode["env"],
): WorkerLoaderWorkerCode {
  return {
    compatibilityDate: "2026-06-14",
    mainModule: PROBE_INVOKE_WORKER_MAIN_MODULE,
    modules: {
      [PROBE_INVOKE_WORKER_MAIN_MODULE]: PROBE_INVOKE_WORKER_SOURCE,
    },
    env,
    globalOutbound: null,
    limits: { cpuMs: 50, subRequests: 4 },
  };
}

const PROBE_INVOKE_WORKER_SOURCE = `
import { DurableObject } from "cloudflare:workers";

const MAX_BODY_BYTES = 73728;
const MAX_JOURNAL_ENTRIES = 256;
const MAX_PAYLOAD_BYTES = 65536;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const REQUEST_KEYS = [
  "attemptId",
  "codeId",
  "codeMode",
  "commitSeq",
  "journalEntries",
  "payload",
  "prefetchedRead",
  "protocolVersion",
  "runId",
  "sampleId",
  "sampleOrdinal",
  "scenario",
  "scopeId",
  "sessionId",
  "sessionMode"
];
const READ_RECEIPT_KEYS = [
  "attemptId",
  "codeId",
  "codeMode",
  "commitSeq",
  "payloadBytes",
  "protocolVersion",
  "runId",
  "sampleId",
  "sampleOrdinal",
  "scenario",
  "scopeId",
  "sessionId",
  "sessionMode",
  "syntheticRevision"
];
const FINISH_RESPONSE_KEYS = ["mockSyncWakeDurationMs", "request", "sync"];
const FINISH_REQUEST_KEYS = [
  "attemptId",
  "codeId",
  "codeMode",
  "commitSeq",
  "journalEntries",
  "protocolVersion",
  "runId",
  "sampleId",
  "sampleOrdinal",
  "scenario",
  "scopeId",
  "sealDigest",
  "sessionId",
  "sessionMode"
];
const SYNC_RECEIPT_KEYS = [
  "commitSeq",
  "cursor",
  "cursorDurationMs",
  "disposition",
  "previousCursor",
  "protocolVersion",
  "runId",
  "sampleId",
  "sampleOrdinal",
  "scenario",
  "scopeId"
];

export class ProbeInvocationFacet extends DurableObject {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if (request.method === "POST" && pathname === "/v1/purge-ensure") {
      return await this.ensurePurgeStorage();
    }
    if (request.method !== "POST" || pathname !== "/v1/full-invoke") {
      return json({ error: "not_found" }, 404);
    }
    const value = await readJson(request);
    if (!validRequest(value)) return json({ error: "invalid_request" }, 400);
    if (this.ctx.id.toString() !== value.attemptId) {
      return json({ error: "attempt_identity_mismatch" }, 409);
    }
    const snapshotSeeded = value.scenario === "facet_executor_invoke" ||
      value.scenario === "facet_finalizer_invoke";
    const facetFinalizer = value.scenario === "facet_finalizer_invoke";
    if (!snapshotSeeded &&
      (this.env.EXECUTOR_READ === undefined || typeof this.env.EXECUTOR_READ.read !== "function")) {
      return json({ error: "executor_read_unavailable" }, 500);
    }
    if (snapshotSeeded && this.env.EXECUTOR_READ !== undefined) {
      return json({ error: "unexpected_executor_read_capability" }, 500);
    }
    if (facetFinalizer &&
      (this.env.EXECUTOR_FINISH === undefined || typeof this.env.EXECUTOR_FINISH.finish !== "function")) {
      return json({ error: "executor_finish_unavailable" }, 500);
    }
    if (!facetFinalizer && this.env.EXECUTOR_FINISH !== undefined) {
      return json({ error: "unexpected_executor_finish_capability" }, 500);
    }

    const sql = this.ctx.storage.sql;
    const requestJson = JSON.stringify(value);
    if (facetFinalizer) {
      sql.exec("CREATE TABLE IF NOT EXISTS invoke_attempt_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), request_json TEXT NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('running', 'finishing', 'committed')), response_json TEXT)");
      const existingAttempt = sql.exec("SELECT request_json, phase, response_json FROM invoke_attempt_state WHERE singleton = 1").toArray()[0];
      if (existingAttempt !== undefined) {
        if (existingAttempt.request_json !== requestJson) {
          return json({ error: "facet_attempt_conflict" }, 409);
        }
        if (existingAttempt.phase === "committed" && typeof existingAttempt.response_json === "string") {
          return json(JSON.parse(existingAttempt.response_json), 200);
        }
        return json({ error: "facet_attempt_busy" }, 409);
      }
      sql.exec("INSERT INTO invoke_attempt_state (singleton, request_json, phase, response_json) VALUES (1, ?, 'running', NULL)", requestJson);
      await this.ctx.storage.sync();
    }

    const readRequest = mockReadRequest(value);
    const readStartedAt = performance.now();
    const rpcReadReceipt = snapshotSeeded
      ? value.prefetchedRead
      : this.env.EXECUTOR_CAPABILITY === undefined
      ? await this.env.EXECUTOR_READ.read(readRequest)
      : await this.env.EXECUTOR_READ.read(
          this.env.EXECUTOR_CAPABILITY,
          readRequest
        );
    const readReceipt = Object.fromEntries(Object.entries(rpcReadReceipt));
    if (!validReadReceipt(readReceipt, readRequest)) {
      return json({ error: "mock_read_receipt_mismatch" }, 502);
    }
    const mockReadDurationMs = elapsedSince(readStartedAt);

    const journalStartedAt = performance.now();
    const payloadDigest = await sha256Hex(value.payload);
    const sealDigest = await sha256Hex(canonicalJournalSeal(value, payloadDigest));
    const readSetDigest = await sha256Hex(JSON.stringify(readRequest));
    const resultDigest = await sha256Hex(canonicalResult(value, readReceipt.syntheticRevision));
    const commitIntentDigest = await sha256Hex(canonicalCommitIntent(
      value,
      readReceipt.syntheticRevision,
      sealDigest,
      resultDigest
    ));
    sql.exec("CREATE TABLE IF NOT EXISTS invoke_read_set (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), request_digest TEXT NOT NULL, synthetic_revision INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS invoke_journal_entries (seq INTEGER PRIMARY KEY, payload_digest TEXT NOT NULL, payload TEXT NOT NULL, payload_bytes INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS invoke_journal_seal (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), digest TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS invoke_result (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), digest TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS invoke_commit_intent (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), snapshot_revision INTEGER NOT NULL, journal_entries INTEGER NOT NULL, journal_seal_digest TEXT NOT NULL, result_digest TEXT NOT NULL, digest TEXT NOT NULL)");
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM invoke_read_set");
      sql.exec("DELETE FROM invoke_journal_entries");
      sql.exec("DELETE FROM invoke_journal_seal");
      sql.exec("DELETE FROM invoke_result");
      sql.exec("DELETE FROM invoke_commit_intent");
      sql.exec("INSERT INTO invoke_read_set (singleton, request_digest, synthetic_revision) VALUES (1, ?, ?)", readSetDigest, readReceipt.syntheticRevision);
      for (let sequence = 0; sequence < value.journalEntries; sequence += 1) {
        sql.exec(
          "INSERT INTO invoke_journal_entries (seq, payload_digest, payload, payload_bytes) VALUES (?, ?, ?, ?)",
          sequence,
          payloadDigest,
          value.payload,
          value.payload.length
        );
      }
      sql.exec("INSERT INTO invoke_journal_seal (singleton, digest) VALUES (1, ?)", sealDigest);
      sql.exec("INSERT INTO invoke_result (singleton, digest) VALUES (1, ?)", resultDigest);
      sql.exec("INSERT INTO invoke_commit_intent (singleton, snapshot_revision, journal_entries, journal_seal_digest, result_digest, digest) VALUES (1, ?, ?, ?, ?, ?)", readReceipt.syntheticRevision, value.journalEntries, sealDigest, resultDigest, commitIntentDigest);
    });
    await this.ctx.storage.sync();
    const storedReadSet = sql.exec("SELECT request_digest, synthetic_revision FROM invoke_read_set WHERE singleton = 1").one();
    const rows = sql.exec("SELECT seq, payload_digest, payload, payload_bytes FROM invoke_journal_entries ORDER BY seq").toArray();
    const storedSeal = sql.exec("SELECT digest FROM invoke_journal_seal WHERE singleton = 1").one().digest;
    const storedResult = sql.exec("SELECT digest FROM invoke_result WHERE singleton = 1").one();
    const storedIntent = sql.exec("SELECT snapshot_revision, journal_entries, journal_seal_digest, result_digest, digest FROM invoke_commit_intent WHERE singleton = 1").one();
    if (
      storedReadSet.request_digest !== readSetDigest ||
      storedReadSet.synthetic_revision !== readReceipt.syntheticRevision ||
      !validJournalReadback(rows, value.journalEntries, payloadDigest, value.payload) ||
      storedSeal !== sealDigest ||
      storedResult.digest !== resultDigest ||
      storedIntent.snapshot_revision !== readReceipt.syntheticRevision ||
      storedIntent.journal_entries !== value.journalEntries ||
      storedIntent.journal_seal_digest !== sealDigest ||
      storedIntent.result_digest !== resultDigest ||
      storedIntent.digest !== commitIntentDigest
    ) {
      return json({ error: "execution_state_readback_failed" }, 500);
    }
    const journalDurationMs = elapsedSince(journalStartedAt);
    const finishRequest = {
      protocolVersion: value.protocolVersion,
      runId: value.runId,
      sampleId: value.sampleId,
      sampleOrdinal: value.sampleOrdinal,
      scopeId: value.scopeId,
      scenario: value.scenario,
      commitSeq: value.commitSeq,
      sessionId: value.sessionId,
      sessionMode: value.sessionMode,
      attemptId: value.attemptId,
      codeMode: value.codeMode,
      codeId: value.codeId,
      journalEntries: value.journalEntries,
      sealDigest
    };
    let finish = null;
    let facetFinalizationDurationMs = null;
    let outboundFinishCalls = 0;
    if (facetFinalizer) {
      const finishing = sql.exec("UPDATE invoke_attempt_state SET phase = 'finishing' WHERE singleton = 1 AND request_json = ? AND phase = 'running'", requestJson);
      if (finishing.rowsWritten !== 1) {
        return json({ error: "facet_attempt_transition_failed" }, 500);
      }
      await this.ctx.storage.sync();
      const finishStartedAt = performance.now();
      const rpcFinish = await this.env.EXECUTOR_FINISH.finish(finishRequest);
      outboundFinishCalls = 1;
      finish = JSON.parse(JSON.stringify(rpcFinish));
      facetFinalizationDurationMs = elapsedSince(finishStartedAt);
      if (!validFinishReceipt(finish, finishRequest)) {
        return json({ error: "mock_finish_receipt_mismatch" }, 502);
      }
    }

    const response = {
      protocolVersion: value.protocolVersion,
      runId: value.runId,
      sampleId: value.sampleId,
      sampleOrdinal: value.sampleOrdinal,
      scopeId: value.scopeId,
      scenario: value.scenario,
      commitSeq: value.commitSeq,
      sessionId: value.sessionId,
      sessionMode: value.sessionMode,
      attemptId: value.attemptId,
      codeMode: value.codeMode,
      codeId: value.codeId,
      journalEntries: value.journalEntries,
      payloadBytes: value.payload.length,
      syntheticRevision: readReceipt.syntheticRevision,
      mockReadDurationMs,
      readMode: snapshotSeeded ? "prefetched-snapshot" : "bound-capability",
      outboundReadCalls: snapshotSeeded ? 0 : 1,
      outboundFinishCalls,
      journalDurationMs,
      facetFinalizationDurationMs,
      attemptPhase: facetFinalizer ? "committed" : "sealed",
      sealDigest,
      resultDigest,
      commitIntent: {
        protocolVersion: 1,
        snapshotRevision: readReceipt.syntheticRevision,
        journalEntries: value.journalEntries,
        journalSealDigest: sealDigest,
        resultDigest,
        digest: commitIntentDigest
      },
      finish
    };
    if (facetFinalizer) {
      const responseJson = JSON.stringify(response);
      const committed = sql.exec("UPDATE invoke_attempt_state SET phase = 'committed', response_json = ? WHERE singleton = 1 AND request_json = ? AND phase = 'finishing'", responseJson, requestJson);
      if (committed.rowsWritten !== 1) {
        return json({ error: "facet_attempt_commit_failed" }, 500);
      }
      await this.ctx.storage.sync();
    }
    return json(response, 200);
  }

  async ensurePurgeStorage() {
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS probe_purge_marker (singleton INTEGER PRIMARY KEY CHECK (singleton = 1))");
    sql.exec("INSERT OR IGNORE INTO probe_purge_marker (singleton) VALUES (1)");
    await this.ctx.storage.sync();
    return json({ kind: "purge-ready" }, 200);
  }
}

function mockReadRequest(value) {
  return {
    protocolVersion: value.protocolVersion,
    runId: value.runId,
    sampleId: value.sampleId,
    sampleOrdinal: value.sampleOrdinal,
    scopeId: value.scopeId,
    scenario: value.scenario,
    commitSeq: value.commitSeq,
    sessionId: value.sessionId,
    sessionMode: value.sessionMode,
    attemptId: value.attemptId,
    codeMode: value.codeMode,
    codeId: value.codeId,
    payloadBytes: value.payload.length
  };
}

function validRequest(value) {
  if (!exactKeys(value, REQUEST_KEYS)) return false;
  if (value.protocolVersion !== 1 || typeof value.runId !== "string" || !RUN_ID_PATTERN.test(value.runId)) return false;
  if (!Number.isInteger(value.sampleOrdinal) || value.sampleOrdinal < 0 || value.sampleOrdinal > 999999) return false;
  if (value.sampleId !== "rtp-sample-" + value.runId + "-" + value.sampleOrdinal) return false;
  if (value.scopeId !== "rtp-scope-" + value.runId) return false;
  if (
    (value.scenario !== "full_invoke" &&
      value.scenario !== "executor_worker_invoke" &&
      value.scenario !== "facet_executor_invoke" &&
      value.scenario !== "facet_finalizer_invoke" &&
      value.scenario !== "session_executor_invoke") ||
    value.commitSeq !== value.sampleOrdinal + 1
  ) return false;
  if (value.sessionMode !== "new-session" && value.sessionMode !== "reuse-session") return false;
  const sessionOrdinal = value.sessionMode === "reuse-session" ? 0 : value.sampleOrdinal;
  if (value.sessionId !== "rtp-session-" + value.runId + "-" + sessionOrdinal) return false;
  if (value.attemptId !== "rtp-attempt-" + value.runId + "-" + sessionOrdinal + "-" + value.sampleOrdinal) return false;
  if (value.codeMode !== "stable" && value.codeMode !== "new-code") return false;
  const codeProfile = value.scenario === "facet_finalizer_invoke"
    ? "invoke-finalizer"
    : "invoke";
  const expectedCodeId = value.codeMode === "stable"
    ? "rtp-code-" + codeProfile + "-v1-stable"
    : "rtp-code-" + codeProfile + "-v1-" + value.runId + "-" + value.sampleOrdinal;
  if (value.codeId !== expectedCodeId) return false;
  if (!Number.isInteger(value.journalEntries) || value.journalEntries < 0 || value.journalEntries > MAX_JOURNAL_ENTRIES) return false;
  if (typeof value.payload !== "string" || value.payload.length > MAX_PAYLOAD_BYTES || !/^x*$/.test(value.payload)) return false;
  const readRequest = mockReadRequest(value);
  return value.scenario === "facet_executor_invoke" ||
      value.scenario === "facet_finalizer_invoke"
    ? validReadReceipt(value.prefetchedRead, readRequest)
    : value.prefetchedRead === null;
}

function validReadReceipt(receipt, request) {
  if (!exactKeys(receipt, READ_RECEIPT_KEYS)) return false;
  for (const key of Object.keys(request)) {
    if (receipt[key] !== request[key]) return false;
  }
  return receipt.syntheticRevision === request.commitSeq - 1;
}

function validFinishReceipt(receipt, request) {
  if (!exactKeys(receipt, FINISH_RESPONSE_KEYS) ||
    !exactKeys(receipt.request, FINISH_REQUEST_KEYS) ||
    !exactKeys(receipt.sync, SYNC_RECEIPT_KEYS)) return false;
  for (const key of Object.keys(request)) {
    if (receipt.request[key] !== request[key]) return false;
  }
  const duration = receipt.mockSyncWakeDurationMs;
  const sync = receipt.sync;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 ||
    typeof sync.cursorDurationMs !== "number" || !Number.isFinite(sync.cursorDurationMs) || sync.cursorDurationMs < 0 ||
    !Number.isInteger(sync.previousCursor) || sync.previousCursor < 0 || sync.previousCursor > 1000000 ||
    !Number.isInteger(sync.cursor) || sync.cursor < 0 || sync.cursor > 1000000) return false;
  for (const key of ["protocolVersion", "runId", "sampleId", "sampleOrdinal", "scopeId", "scenario", "commitSeq"]) {
    if (sync[key] !== request[key]) return false;
  }
  if (sync.cursor !== sync.previousCursor && sync.disposition !== "applied") return false;
  if (sync.disposition === "applied") {
    return sync.commitSeq === sync.previousCursor + 1 && sync.cursor === sync.commitSeq;
  }
  if (sync.disposition === "duplicate") return sync.commitSeq === sync.previousCursor;
  if (sync.disposition === "gap") return sync.commitSeq > sync.previousCursor + 1;
  return sync.disposition === "stale" && sync.commitSeq < sync.previousCursor;
}

function validJournalReadback(rows, expectedCount, payloadDigest, payload) {
  if (rows.length !== expectedCount) return false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.seq !== index || row.payload_digest !== payloadDigest || row.payload !== payload || row.payload_bytes !== payload.length) return false;
  }
  return true;
}

function canonicalJournalSeal(value, payloadDigest) {
  return JSON.stringify([
    1,
    value.runId,
    value.scopeId,
    value.sampleId,
    value.sessionId,
    value.attemptId,
    value.codeId,
    value.commitSeq,
    value.journalEntries,
    value.payload.length,
    payloadDigest,
    Array.from({ length: value.journalEntries }, (_, sequence) => sequence)
  ]);
}

function canonicalResult(value, syntheticRevision) {
  return JSON.stringify([
    1,
    "ok",
    value.runId,
    value.sampleId,
    value.attemptId,
    value.payload.length,
    syntheticRevision
  ]);
}

function canonicalCommitIntent(value, syntheticRevision, sealDigest, resultDigest) {
  return JSON.stringify([
    1,
    value.runId,
    value.scopeId,
    value.sampleId,
    value.sessionId,
    value.attemptId,
    value.codeId,
    value.commitSeq,
    syntheticRevision,
    value.journalEntries,
    sealDigest,
    resultDigest
  ]);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(request) {
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_BODY_BYTES) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

function exactKeys(value, expected) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (keys[index] !== expected[index]) return false;
  }
  return true;
}

function elapsedSince(startedAt) {
  const duration = performance.now() - startedAt;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}
`;

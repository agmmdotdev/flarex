import { Data, Effect, Schema } from "effect";

import {
  probeAttemptId,
  probeCodeId,
  probeSampleId,
  probeScopeId,
  probeSessionId,
  ProbeCodeModeSchema,
  type ProbeCodeProfile,
  ProbeCodeIdSchema,
  ProbeAttemptIdSchema,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  ProbeSampleIdSchema,
  ProbeScopeIdSchema,
  ProbeSessionIdSchema,
  ProbeSpanIdSchema,
  PROBE_ORDINAL_ZERO,
  type ProbeOrdinal,
} from "./identity";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strictSchemaOptions";

export const PROBE_LIMITS_V1 = {
  maxConcurrency: 25,
  maxJournalEntries: 256,
  maxNewCodeRepetitions: 16,
  maxPayloadBytes: 65_536,
  maxRepetitions: 500,
  maxWarmupRepetitions: 100,
} as const;

export const ProbeProtocolVersionV1Schema = Schema.Literal(1).pipe(
  Schema.brand("Flarex/RuntimeTopologyProbeProtocolVersionV1"),
);
export type ProbeProtocolVersionV1 =
  typeof ProbeProtocolVersionV1Schema.Type;
export const PROBE_PROTOCOL_VERSION_V1 =
  ProbeProtocolVersionV1Schema.make(1);

export const ProbeScenarioSchema = Schema.Literals([
  "edge_echo",
  "session_echo",
  "dynamic_direct_echo",
  "facet_echo",
  "facet_journal",
  "commit_wake",
  "full_invoke",
  "executor_worker_invoke",
  "session_executor_invoke",
  "sync_rerun",
]);
export type ProbeScenario = typeof ProbeScenarioSchema.Type;

export const ProbeSamplePhaseSchema = Schema.Literals([
  "warmup",
  "measurement",
]);
export type ProbeSamplePhase = typeof ProbeSamplePhaseSchema.Type;

export const ProbeSessionModeSchema = Schema.Literals([
  "reuse-session",
  "new-session",
]);
export type ProbeSessionMode = typeof ProbeSessionModeSchema.Type;

export const ProbeSpanNameSchema = Schema.Literals([
  "external_request",
  "gateway_session_rtt",
  "gateway_dynamic_rtt",
  "session_facet_rtt",
  "facet_journal_io",
  "facet_mock_read_rtt",
  "facet_session_read_rtt",
  "session_mock_finish_rtt",
  "session_executor_finish",
  "mock_sync_wake_rtt",
  "session_sync_wake_rtt",
  "sync_cursor_io",
  "sync_runtime_rerun_rtt",
]);
export type ProbeSpanName = typeof ProbeSpanNameSchema.Type;

export const ProbeErrorCodeSchema = Schema.Literals([
  "unauthorized",
  "invalid_request",
  "limit_exceeded",
  "unsupported_scenario",
  "runtime_failure",
  "incomplete_trace",
  "cleanup_failure",
]);
export type ProbeErrorCode = typeof ProbeErrorCodeSchema.Type;

export const ProbeErrorStageSchema = Schema.Union([
  ProbeSpanNameSchema,
  Schema.Literals(["request", "cleanup"]),
]);
export type ProbeErrorStage = typeof ProbeErrorStageSchema.Type;

export function boundedProbeIntegerSchema(
  minimum: number,
  maximum: number,
  label: string,
): Schema.Codec<number> {
  return Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value >= minimum && value <= maximum
        ? undefined
        : `${label} must be an integer from ${minimum} through ${maximum}`
    ),
  );
}

export const ProbeDurationMsSchema = Schema.Number.check(
  Schema.makeFilter((value: number) =>
    Number.isFinite(value) && value >= 0 && !Object.is(value, -0)
      ? undefined
      : "durationMs must be one finite non-negative number",
  ),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeDurationMsV1"));
export type ProbeDurationMs = typeof ProbeDurationMsSchema.Type;

const RepetitionsSchema = boundedProbeIntegerSchema(
  1,
  PROBE_LIMITS_V1.maxRepetitions,
  "repetitions",
);
const WarmupRepetitionsSchema = boundedProbeIntegerSchema(
  0,
  PROBE_LIMITS_V1.maxWarmupRepetitions,
  "warmupRepetitions",
);
const ReplicateSchema = boundedProbeIntegerSchema(
  1,
  100,
  "replicate",
);
const ConcurrencySchema = boundedProbeIntegerSchema(
  1,
  PROBE_LIMITS_V1.maxConcurrency,
  "concurrency",
);
const PayloadBytesSchema = boundedProbeIntegerSchema(
  0,
  PROBE_LIMITS_V1.maxPayloadBytes,
  "payloadBytes",
);
const JournalEntriesSchema = boundedProbeIntegerSchema(
  0,
  PROBE_LIMITS_V1.maxJournalEntries,
  "journalEntries",
);

export const ProbeDimensionsV1Schema = Schema.Struct({
  codeMode: ProbeCodeModeSchema,
  concurrency: ConcurrencySchema,
  journalEntries: JournalEntriesSchema,
  payloadBytes: PayloadBytesSchema,
  sessionMode: ProbeSessionModeSchema,
}).annotate(StrictStructOptions);
export type ProbeDimensionsV1 = typeof ProbeDimensionsV1Schema.Type;

export function sameProbeDimensionsV1(
  left: ProbeDimensionsV1,
  right: ProbeDimensionsV1,
): boolean {
  return left.codeMode === right.codeMode &&
    left.concurrency === right.concurrency &&
    left.journalEntries === right.journalEntries &&
    left.payloadBytes === right.payloadBytes &&
    left.sessionMode === right.sessionMode;
}

const ProbeRunRequestV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  scenario: ProbeScenarioSchema,
  replicate: Schema.optional(ReplicateSchema),
  repetitions: RepetitionsSchema,
  warmupRepetitions: WarmupRepetitionsSchema,
  dimensions: ProbeDimensionsV1Schema,
}).annotate(StrictStructOptions);

export const ProbeRunRequestV1Schema = ProbeRunRequestV1Shape.check(
  Schema.makeFilter(request => {
    const dimensionIssue = probeDimensionRelationshipIssueV1(
      request.scenario,
      request.dimensions,
    );
    if (dimensionIssue !== undefined) return dimensionIssue;
    if (request.dimensions.concurrency > request.repetitions) {
      return "concurrency cannot exceed measured repetitions";
    }
    if (
      (request.scenario === "executor_worker_invoke" ||
        request.scenario === "session_executor_invoke") &&
      request.repetitions + request.warmupRepetitions >
        PROBE_LIMITS_V1.maxNewCodeRepetitions
    ) {
      return `attempt-scoped loader scenarios allow at most ${PROBE_LIMITS_V1.maxNewCodeRepetitions} total executions`;
    }
    if (request.dimensions.codeMode !== "new-code") return undefined;
    if (request.warmupRepetitions !== 0) {
      return "new-code mode does not allow warmup repetitions";
    }
    return request.repetitions <= PROBE_LIMITS_V1.maxNewCodeRepetitions
      ? undefined
      : `new-code mode allows at most ${PROBE_LIMITS_V1.maxNewCodeRepetitions} repetitions`;
  }),
);
export type ProbeRunRequestV1 = typeof ProbeRunRequestV1Schema.Type;

export const ProbeNormalizedErrorV1Schema = Schema.Struct({
  code: ProbeErrorCodeSchema,
  retryable: Schema.Boolean,
  stage: ProbeErrorStageSchema,
}).annotate(StrictStructOptions);
export type ProbeNormalizedErrorV1 =
  typeof ProbeNormalizedErrorV1Schema.Type;

export function sameProbeNormalizedErrorV1(
  left: ProbeNormalizedErrorV1,
  right: ProbeNormalizedErrorV1,
): boolean {
  return left.code === right.code &&
    left.retryable === right.retryable &&
    left.stage === right.stage;
}

export const ProbeSpanOutcomeV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ok") }).annotate(StrictStructOptions),
  Schema.Struct({
    kind: Schema.Literal("error"),
    error: ProbeNormalizedErrorV1Schema,
  }).annotate(StrictStructOptions),
]);
export type ProbeSpanOutcomeV1 = typeof ProbeSpanOutcomeV1Schema.Type;

export const ProbeCallbackObservationSchema = Schema.Literals([
  "not-applicable",
  "callback-ran",
  "callback-not-run",
  "callback-unobserved",
]);
export type ProbeCallbackObservation =
  typeof ProbeCallbackObservationSchema.Type;

export const ProbeStartupObservationsV1Schema = Schema.Struct({
  workerLoader: ProbeCallbackObservationSchema,
  facet: ProbeCallbackObservationSchema,
}).annotate(StrictStructOptions);
export type ProbeStartupObservationsV1 =
  typeof ProbeStartupObservationsV1Schema.Type;

export const ProbeTraceSpanV1Schema = Schema.Struct({
  spanId: ProbeSpanIdSchema,
  parentSpanId: Schema.Union([ProbeSpanIdSchema, Schema.Null]),
  name: ProbeSpanNameSchema,
  durationMs: ProbeDurationMsSchema,
  outcome: ProbeSpanOutcomeV1Schema,
}).annotate(StrictStructOptions);
export type ProbeTraceSpanV1 = typeof ProbeTraceSpanV1Schema.Type;

export const ProbeSampleOutcomeV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ok") }).annotate(StrictStructOptions),
  Schema.Struct({
    kind: Schema.Literal("error"),
    error: ProbeNormalizedErrorV1Schema,
  }).annotate(StrictStructOptions),
]);
export type ProbeSampleOutcomeV1 = typeof ProbeSampleOutcomeV1Schema.Type;

export const ProbeEdgeColoSchema = Schema.String.check(
  Schema.isPattern(/^[A-Z0-9]{3,8}$/),
);

const ProbeSampleIdentityBase = {
  sampleOrdinal: ProbeOrdinalSchema,
  scopeId: ProbeScopeIdSchema,
} as const;

export const ProbeSampleIdentityV1Schema = Schema.Union([
  Schema.Struct({
    ...ProbeSampleIdentityBase,
    kind: Schema.Literal("scope-only"),
    sessionId: Schema.Null,
    attemptId: Schema.Null,
    codeId: Schema.Null,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    ...ProbeSampleIdentityBase,
    kind: Schema.Literal("session-only"),
    sessionId: ProbeSessionIdSchema,
    attemptId: Schema.Null,
    codeId: Schema.Null,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    ...ProbeSampleIdentityBase,
    kind: Schema.Literal("dynamic-direct"),
    sessionId: Schema.Null,
    attemptId: Schema.Null,
    codeId: ProbeCodeIdSchema,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    ...ProbeSampleIdentityBase,
    kind: Schema.Literal("facet-session"),
    sessionId: ProbeSessionIdSchema,
    attemptId: ProbeAttemptIdSchema,
    codeId: ProbeCodeIdSchema,
  }).annotate(StrictStructOptions),
]);
export type ProbeSampleIdentityV1 =
  typeof ProbeSampleIdentityV1Schema.Type;

export function sameProbeSampleIdentityV1(
  left: ProbeSampleIdentityV1,
  right: ProbeSampleIdentityV1,
): boolean {
  return left.kind === right.kind &&
    left.sampleOrdinal === right.sampleOrdinal &&
    left.scopeId === right.scopeId &&
    left.sessionId === right.sessionId &&
    left.attemptId === right.attemptId &&
    left.codeId === right.codeId;
}

export function probeWorkerLoaderIdentityV1(
  scenario: ProbeScenario,
  identity: Pick<ProbeSampleIdentityV1, "attemptId" | "codeId">,
): string | null {
  if (identity.codeId === null) return null;
  return (scenario === "executor_worker_invoke" ||
      scenario === "session_executor_invoke") &&
      identity.attemptId !== null
    ? `${identity.codeId}-${identity.attemptId}`
    : identity.codeId;
}

const ProbeSampleResultV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleId: ProbeSampleIdSchema,
  scenario: ProbeScenarioSchema,
  dimensions: ProbeDimensionsV1Schema,
  identity: ProbeSampleIdentityV1Schema,
  startup: ProbeStartupObservationsV1Schema,
  edgeColo: Schema.Union([ProbeEdgeColoSchema, Schema.Null]),
  outcome: ProbeSampleOutcomeV1Schema,
  spans: Schema.Array(ProbeTraceSpanV1Schema),
}).annotate(StrictStructOptions);

export const ProbeSampleResultV1Schema = ProbeSampleResultV1Shape.check(
  Schema.makeFilter(sample => sampleRelationshipIssue(sample)),
);
export type ProbeSampleResultV1 = typeof ProbeSampleResultV1Schema.Type;

export function probeSampleIdentityV1(
  runId: ProbeRunRequestV1["runId"],
  scenario: ProbeScenario,
  dimensions: ProbeDimensionsV1,
  sampleOrdinal: ProbeOrdinal,
): ProbeSampleIdentityV1 {
  const scopeId = probeScopeId(runId);
  const sessionOrdinal =
    dimensions.sessionMode === "reuse-session"
      ? PROBE_ORDINAL_ZERO
      : sampleOrdinal;
  const sessionId = probeSessionId(runId, sessionOrdinal);
  switch (scenario) {
    case "edge_echo":
    case "commit_wake":
      return {
        kind: "scope-only",
        sampleOrdinal,
        scopeId,
        sessionId: null,
        attemptId: null,
        codeId: null,
      };
    case "session_echo":
      return {
        kind: "session-only",
        sampleOrdinal,
        scopeId,
        sessionId,
        attemptId: null,
        codeId: null,
      };
    case "dynamic_direct_echo":
      return {
        kind: "dynamic-direct",
        sampleOrdinal,
        scopeId,
        sessionId: null,
        attemptId: null,
        codeId: codeIdForScenario(
          "direct",
          runId,
          dimensions,
          sampleOrdinal,
        ),
      };
    case "facet_echo":
    case "facet_journal":
      return {
        kind: "facet-session",
        sampleOrdinal,
        scopeId,
        sessionId,
        attemptId: probeAttemptId(
          runId,
          sessionOrdinal,
          sampleOrdinal,
        ),
        codeId: codeIdForScenario(
          "facet",
          runId,
          dimensions,
          sampleOrdinal,
        ),
      };
    case "full_invoke":
    case "executor_worker_invoke":
    case "session_executor_invoke":
      return {
        kind: "facet-session",
        sampleOrdinal,
        scopeId,
        sessionId,
        attemptId: probeAttemptId(
          runId,
          sessionOrdinal,
          sampleOrdinal,
        ),
        codeId: codeIdForScenario(
          "invoke",
          runId,
          dimensions,
          sampleOrdinal,
        ),
      };
    case "sync_rerun":
      return {
        kind: "facet-session",
        sampleOrdinal,
        scopeId,
        sessionId,
        attemptId: probeAttemptId(
          runId,
          sessionOrdinal,
          sampleOrdinal,
        ),
        codeId: codeIdForScenario(
          "rerun",
          runId,
          dimensions,
          sampleOrdinal,
        ),
      };
  }
}

function codeIdForScenario(
  profile: ProbeCodeProfile,
  runId: ProbeRunRequestV1["runId"],
  dimensions: ProbeDimensionsV1,
  sampleOrdinal: ProbeOrdinal,
) {
  return dimensions.codeMode === "stable"
    ? probeCodeId({ mode: "stable", profile })
    : probeCodeId({
        mode: "new-code",
        profile,
        runId,
        version: sampleOrdinal,
      });
}

function sampleRelationshipIssue(
  sample: typeof ProbeSampleResultV1Shape.Type,
): string | undefined {
  const dimensionIssue = probeDimensionRelationshipIssueV1(
    sample.scenario,
    sample.dimensions,
  );
  if (dimensionIssue !== undefined) return dimensionIssue;
  if (
    sample.sampleId !== probeSampleId(
      sample.runId,
      sample.identity.sampleOrdinal,
    )
  ) {
    return "sampleId must be derived from runId and identity.sampleOrdinal";
  }
  const expectedIdentity = probeSampleIdentityV1(
    sample.runId,
    sample.scenario,
    sample.dimensions,
    sample.identity.sampleOrdinal,
  );
  if (!sameProbeSampleIdentityV1(sample.identity, expectedIdentity)) {
    return "identity must match the run, scenario, dimensions, and sample ordinal";
  }
  return probeStartupRelationshipIssueV1(
    sample.scenario,
    sample.startup,
    sample.outcome,
  );
}

export function probeStartupRelationshipIssueV1(
  scenario: ProbeScenario,
  startup: ProbeStartupObservationsV1,
  outcome: ProbeSampleOutcomeV1,
): string | undefined {
  switch (scenario) {
    case "edge_echo":
    case "session_echo":
    case "commit_wake":
      return startup.workerLoader === "not-applicable" &&
          startup.facet === "not-applicable"
        ? undefined
        : `${scenario} cannot report Dynamic Worker startup callbacks`;
    case "dynamic_direct_echo":
      if (startup.facet !== "not-applicable") {
        return "dynamic_direct_echo requires only a Worker Loader callback observation";
      }
      if (startup.workerLoader === "not-applicable") {
        return "dynamic_direct_echo requires a Worker Loader callback observation";
      }
      return outcome.kind === "ok" &&
          startup.workerLoader === "callback-unobserved"
        ? "successful dynamic_direct_echo cannot leave its callback unobserved"
        : undefined;
    case "facet_echo":
    case "facet_journal":
    case "full_invoke":
    case "executor_worker_invoke":
    case "session_executor_invoke":
    case "sync_rerun":
      if (
        startup.workerLoader === "not-applicable" ||
        startup.facet === "not-applicable"
      ) {
        return `${scenario} requires Worker Loader and facet callback observations`;
      }
      const workerUnobserved =
        startup.workerLoader === "callback-unobserved";
      const facetUnobserved = startup.facet === "callback-unobserved";
      if (workerUnobserved || facetUnobserved) {
        if (outcome.kind === "ok") {
          return `${scenario} cannot leave successful callbacks unobserved`;
        }
        return workerUnobserved && facetUnobserved
          ? undefined
          : `${scenario} must leave both callback observations unobserved when the nested response is unavailable`;
      }
      if (
        scenario === "sync_rerun" &&
        outcome.kind === "ok" &&
        startup.facet !== "callback-ran"
      ) {
        return "successful sync_rerun must start its fresh attempt facet";
      }
      return startup.facet === "callback-not-run" &&
          startup.workerLoader === "callback-ran"
        ? "a Worker Loader callback cannot run when the enclosing facet startup callback did not run"
        : undefined;
  }
}

export function probeDimensionRelationshipIssueV1(
  scenario: ProbeScenario,
  dimensions: ProbeDimensionsV1,
): string | undefined {
  const usesDynamicWorker =
    scenario === "dynamic_direct_echo" ||
    scenario === "facet_echo" ||
    scenario === "facet_journal" ||
    scenario === "full_invoke" ||
    scenario === "executor_worker_invoke" ||
    scenario === "session_executor_invoke" ||
    scenario === "sync_rerun";
  if (!usesDynamicWorker && dimensions.codeMode !== "stable") {
    return `${scenario} requires canonical stable code mode because it does not invoke a Dynamic Worker`;
  }

  const usesSession =
    scenario === "session_echo" ||
    scenario === "facet_echo" ||
    scenario === "facet_journal" ||
    scenario === "full_invoke" ||
    scenario === "executor_worker_invoke" ||
    scenario === "session_executor_invoke" ||
    scenario === "sync_rerun";
  if (!usesSession && dimensions.sessionMode !== "new-session") {
    return `${scenario} requires canonical new-session mode because it does not invoke a SessionDO`;
  }
  if (scenario === "sync_rerun" && dimensions.sessionMode !== "new-session") {
    return "sync_rerun requires a fresh session";
  }
  if (
    (scenario === "commit_wake" ||
      scenario === "full_invoke" ||
      scenario === "executor_worker_invoke" ||
      scenario === "session_executor_invoke") &&
    dimensions.concurrency !== 1
  ) {
    return `${scenario} requires concurrency 1 because synthetic sync commits must finish in ordinal order`;
  }

  const usesJournal =
    scenario === "facet_journal" ||
    scenario === "full_invoke" ||
    scenario === "executor_worker_invoke" ||
    scenario === "session_executor_invoke";
  return !usesJournal && dimensions.journalEntries !== 0
    ? `${scenario} requires zero journal entries because it does not measure journal I/O`
    : undefined;
}

export class ProbeProtocolValidationError extends Data.TaggedError(
  "ProbeProtocolValidationError",
)<{
  readonly boundary: "run-request-v1" | "sample-result-v1";
  readonly cause: unknown;
}> {}

const decodeUnknownProbeRunRequestV1 = Schema.decodeUnknownEffect(
  ProbeRunRequestV1Schema,
  StrictParseOptions,
);
const decodeUnknownProbeSampleResultV1 = Schema.decodeUnknownEffect(
  ProbeSampleResultV1Schema,
  StrictParseOptions,
);

export const decodeProbeRunRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeRunRequestV1",
)((value: unknown) =>
  decodeUnknownProbeRunRequestV1(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeProtocolValidationError({
          boundary: "run-request-v1",
          cause,
      }),
    ),
  ));

export const decodeProbeSampleResultV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSampleResultV1",
)((value: unknown) =>
  decodeUnknownProbeSampleResultV1(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeProtocolValidationError({
          boundary: "sample-result-v1",
          cause,
      }),
    ),
  ));

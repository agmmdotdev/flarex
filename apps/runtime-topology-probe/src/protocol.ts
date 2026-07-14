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

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;

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
  "sync_rerun",
]);
export type ProbeScenario = typeof ProbeScenarioSchema.Type;

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
  "session_mock_finish_rtt",
  "mock_sync_wake_rtt",
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

const boundedInteger = (
  minimum: number,
  maximum: number,
  label: string,
) =>
  Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value >= minimum && value <= maximum
        ? undefined
        : `${label} must be an integer from ${minimum} through ${maximum}`
    ),
  );

export const ProbeDurationMsSchema = Schema.Number.check(
  Schema.makeFilter((value: number) =>
    Number.isFinite(value) && value >= 0 && !Object.is(value, -0)
      ? undefined
      : "durationMs must be one finite non-negative number",
  ),
).pipe(Schema.brand("Flarex/RuntimeTopologyProbeDurationMsV1"));
export type ProbeDurationMs = typeof ProbeDurationMsSchema.Type;

const RepetitionsSchema = boundedInteger(
  1,
  PROBE_LIMITS_V1.maxRepetitions,
  "repetitions",
);
const WarmupRepetitionsSchema = boundedInteger(
  0,
  PROBE_LIMITS_V1.maxWarmupRepetitions,
  "warmupRepetitions",
);
const ConcurrencySchema = boundedInteger(
  1,
  PROBE_LIMITS_V1.maxConcurrency,
  "concurrency",
);
const PayloadBytesSchema = boundedInteger(
  0,
  PROBE_LIMITS_V1.maxPayloadBytes,
  "payloadBytes",
);
const JournalEntriesSchema = boundedInteger(
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

const ProbeRunRequestV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  scenario: ProbeScenarioSchema,
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
          "invoke",
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
  if (!sameSampleIdentity(sample.identity, expectedIdentity)) {
    return "identity must match the run, scenario, dimensions, and sample ordinal";
  }
  return probeStartupRelationshipIssueV1(
    sample.scenario,
    sample.startup,
    sample.outcome,
  );
}

function sameSampleIdentity(
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
    scenario === "sync_rerun";
  if (!usesDynamicWorker && dimensions.codeMode !== "stable") {
    return `${scenario} requires canonical stable code mode because it does not invoke a Dynamic Worker`;
  }

  const usesSession =
    scenario === "session_echo" ||
    scenario === "facet_echo" ||
    scenario === "facet_journal" ||
    scenario === "full_invoke" ||
    scenario === "sync_rerun";
  if (!usesSession && dimensions.sessionMode !== "new-session") {
    return `${scenario} requires canonical new-session mode because it does not invoke a SessionDO`;
  }

  const usesJournal =
    scenario === "facet_journal" || scenario === "full_invoke";
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
)(function* (
  value: unknown,
): Effect.fn.Return<ProbeRunRequestV1, ProbeProtocolValidationError> {
  return yield* decodeUnknownProbeRunRequestV1(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeProtocolValidationError({
          boundary: "run-request-v1",
          cause,
        }),
    ),
  );
});

export const decodeProbeSampleResultV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSampleResultV1",
)(function* (
  value: unknown,
): Effect.fn.Return<ProbeSampleResultV1, ProbeProtocolValidationError> {
  return yield* decodeUnknownProbeSampleResultV1(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeProtocolValidationError({
          boundary: "sample-result-v1",
          cause,
        }),
    ),
  );
});

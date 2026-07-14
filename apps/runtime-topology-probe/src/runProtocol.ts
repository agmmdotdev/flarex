import { Data, Effect, Schema } from "effect";

import { strictSchemaValueOrNullDecoder } from "./effectBoundary";
import {
  ProbeClaimTokenSchema,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
} from "./identity";
import {
  PROBE_LIMITS_V1,
  ProbeDurationMsSchema,
  ProbeProtocolVersionV1Schema,
  ProbeRunRequestV1Schema,
  ProbeSamplePhaseSchema,
  type ProbeRunRequestV1,
} from "./protocol";
import {
  ProbeControlledGatewaySampleV1Schema,
  ProbeGatewaySampleV1Schema,
  ProbeMeasurementDispositionSchema,
  ProbeSyncWakeObservationV1Schema,
} from "./runtimeProtocol";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;

const MAX_RUN_SAMPLES =
  PROBE_LIMITS_V1.maxRepetitions + PROBE_LIMITS_V1.maxWarmupRepetitions;

export const PROBE_RUN_BUDGET_LIMITS_V1 = {
  sampleClaims: MAX_RUN_SAMPLES,
  payloadBytes: MAX_RUN_SAMPLES * PROBE_LIMITS_V1.maxPayloadBytes,
  journalEntries: MAX_RUN_SAMPLES * PROBE_LIMITS_V1.maxJournalEntries,
  uniqueCodeIds: PROBE_LIMITS_V1.maxNewCodeRepetitions,
} as const;

const SampleCountSchema = boundedInteger(
  0,
  PROBE_RUN_BUDGET_LIMITS_V1.sampleClaims,
  "sample count",
);
const PayloadBudgetSchema = boundedInteger(
  0,
  PROBE_RUN_BUDGET_LIMITS_V1.payloadBytes,
  "payload byte budget",
);
const JournalBudgetSchema = boundedInteger(
  0,
  PROBE_RUN_BUDGET_LIMITS_V1.journalEntries,
  "journal entry budget",
);
const CodeBudgetSchema = boundedInteger(
  0,
  PROBE_RUN_BUDGET_LIMITS_V1.uniqueCodeIds,
  "unique code ID budget",
);
const ConcurrencyCountSchema = boundedInteger(
  0,
  PROBE_LIMITS_V1.maxConcurrency,
  "outstanding claim count",
);
const ObservedOutstandingClaimsSchema = boundedInteger(
  1,
  PROBE_LIMITS_V1.maxConcurrency,
  "observed outstanding claims",
);

export const ProbeRunBudgetValuesV1Schema = Schema.Struct({
  sampleClaims: SampleCountSchema,
  payloadBytes: PayloadBudgetSchema,
  journalEntries: JournalBudgetSchema,
  uniqueCodeIds: CodeBudgetSchema,
}).annotate(StrictStructOptions);
export type ProbeRunBudgetValuesV1 =
  typeof ProbeRunBudgetValuesV1Schema.Type;

export const ProbeRunBudgetsV1Schema = Schema.Struct({
  limits: ProbeRunBudgetValuesV1Schema,
  planned: ProbeRunBudgetValuesV1Schema,
  consumed: ProbeRunBudgetValuesV1Schema,
}).annotate(StrictStructOptions);
export type ProbeRunBudgetsV1 = typeof ProbeRunBudgetsV1Schema.Type;

export const ProbeRunCountersV1Schema = Schema.Struct({
  claimed: SampleCountSchema,
  terminal: SampleCountSchema,
  completed: SampleCountSchema,
  failed: SampleCountSchema,
  outstanding: ConcurrencyCountSchema,
  highWaterOutstandingClaims: ConcurrencyCountSchema,
  eligible: SampleCountSchema,
  excludedWarmup: SampleCountSchema,
  excludedDuplicateWake: SampleCountSchema,
}).annotate(StrictStructOptions);
export type ProbeRunCountersV1 = typeof ProbeRunCountersV1Schema.Type;

export const ProbeRunSampleStatusV1Schema = Schema.Union([
  Schema.Struct({
    sampleOrdinal: ProbeOrdinalSchema,
    phase: ProbeSamplePhaseSchema,
    state: Schema.Literal("claimed"),
    observedOutstandingClaims: ObservedOutstandingClaimsSchema,
    measurementDisposition: Schema.Null,
    syncWake: Schema.Null,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    sampleOrdinal: ProbeOrdinalSchema,
    phase: ProbeSamplePhaseSchema,
    state: Schema.Literals(["completed", "failed"]),
    observedOutstandingClaims: ObservedOutstandingClaimsSchema,
    measurementDisposition: ProbeMeasurementDispositionSchema,
    syncWake: ProbeSyncWakeObservationV1Schema,
  }).annotate(StrictStructOptions),
]);
export type ProbeRunSampleStatusV1 =
  typeof ProbeRunSampleStatusV1Schema.Type;

const ProbeRunStatusV1Shape = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  run: ProbeRunRequestV1Schema,
  state: Schema.Literals([
    "registered",
    "outstanding-claims",
    "partial",
    "complete",
  ]),
  budgets: ProbeRunBudgetsV1Schema,
  counters: ProbeRunCountersV1Schema,
  samples: Schema.Array(ProbeRunSampleStatusV1Schema),
}).annotate(StrictStructOptions);

export const ProbeRunStatusV1Schema = ProbeRunStatusV1Shape.check(
  Schema.makeFilter(status => runStatusRelationshipIssue(status)),
);
export type ProbeRunStatusV1 = typeof ProbeRunStatusV1Schema.Type;

export const ProbeRunStateErrorCodeSchema = Schema.Literals([
  "invalid-request",
  "run-not-registered",
  "registration-conflict",
  "sample-out-of-range",
  "sample-already-claimed",
  "sample-already-finalized",
  "sample-not-claimed",
  "sample-order-blocked",
  "concurrency-limit",
  "sample-budget-exhausted",
  "payload-budget-exhausted",
  "journal-budget-exhausted",
  "code-budget-exhausted",
  "claim-token-mismatch",
  "finalization-conflict",
  "identity-mismatch",
]);
export type ProbeRunStateErrorCode =
  typeof ProbeRunStateErrorCodeSchema.Type;

export const ProbeRunStateErrorV1Schema = Schema.Struct({
  code: ProbeRunStateErrorCodeSchema,
  retryable: Schema.Boolean,
}).annotate(StrictStructOptions);
export type ProbeRunStateErrorV1 = typeof ProbeRunStateErrorV1Schema.Type;

const RejectedOperationSchema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  kind: Schema.Literal("rejected"),
  error: ProbeRunStateErrorV1Schema,
}).annotate(StrictStructOptions);

export const ProbeRunRegistrationReceiptV1Schema = Schema.Union([
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("registered"),
    created: Schema.Boolean,
    status: ProbeRunStatusV1Schema,
  }).annotate(StrictStructOptions),
  RejectedOperationSchema,
]);
export type ProbeRunRegistrationReceiptV1 =
  typeof ProbeRunRegistrationReceiptV1Schema.Type;

export const ProbePublicSampleRequestV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
}).annotate(StrictStructOptions);
export type ProbePublicSampleRequestV1 =
  typeof ProbePublicSampleRequestV1Schema.Type;

export const ProbeSampleClaimReceiptV1Schema = Schema.Union([
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("claimed"),
    claimToken: ProbeClaimTokenSchema,
    run: ProbeRunRequestV1Schema,
    sampleOrdinal: ProbeOrdinalSchema,
    phase: ProbeSamplePhaseSchema,
    observedOutstandingClaims: ObservedOutstandingClaimsSchema,
  }).annotate(StrictStructOptions),
  RejectedOperationSchema,
]);
export type ProbeSampleClaimReceiptV1 =
  typeof ProbeSampleClaimReceiptV1Schema.Type;

export const ProbeSampleFinalizeRequestV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
  sampleOrdinal: ProbeOrdinalSchema,
  claimToken: ProbeClaimTokenSchema,
  fragment: ProbeGatewaySampleV1Schema,
  scenarioWindowDurationMs: ProbeDurationMsSchema,
  syncWake: ProbeSyncWakeObservationV1Schema,
}).annotate(StrictStructOptions);
export type ProbeSampleFinalizeRequestV1 =
  typeof ProbeSampleFinalizeRequestV1Schema.Type;

export const ProbeSampleFinalizeReceiptV1Schema = Schema.Union([
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("finalized"),
    idempotent: Schema.Boolean,
    sample: ProbeControlledGatewaySampleV1Schema,
  }).annotate(StrictStructOptions),
  RejectedOperationSchema,
]);
export type ProbeSampleFinalizeReceiptV1 =
  typeof ProbeSampleFinalizeReceiptV1Schema.Type;

export const ProbeRunStatusRequestV1Schema = Schema.Struct({
  protocolVersion: ProbeProtocolVersionV1Schema,
  runId: ProbeRunIdSchema,
}).annotate(StrictStructOptions);
export type ProbeRunStatusRequestV1 =
  typeof ProbeRunStatusRequestV1Schema.Type;

export const ProbeRunStatusReceiptV1Schema = Schema.Union([
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("found"),
    status: ProbeRunStatusV1Schema,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    protocolVersion: ProbeProtocolVersionV1Schema,
    kind: Schema.Literal("not-found"),
  }).annotate(
    StrictStructOptions,
  ),
]);
export type ProbeRunStatusReceiptV1 =
  typeof ProbeRunStatusReceiptV1Schema.Type;

export class ProbeRunProtocolValidationError extends Data.TaggedError(
  "ProbeRunProtocolValidationError",
)<{
  readonly boundary:
    | "public-sample-request-v1"
    | "sample-finalize-request-v1"
    | "run-status-request-v1";
  readonly cause: unknown;
}> {}

const decodeUnknownPublicSampleRequest = Schema.decodeUnknownEffect(
  ProbePublicSampleRequestV1Schema,
  StrictParseOptions,
);
const decodeUnknownFinalizeRequest = Schema.decodeUnknownEffect(
  ProbeSampleFinalizeRequestV1Schema,
  StrictParseOptions,
);
const decodeUnknownStatusRequest = Schema.decodeUnknownEffect(
  ProbeRunStatusRequestV1Schema,
  StrictParseOptions,
);

export const decodeProbePublicSampleRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodePublicSampleRequestV1",
)((value: unknown) =>
  decodeUnknownPublicSampleRequest(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRunProtocolValidationError({
          boundary: "public-sample-request-v1",
          cause,
        }),
    ),
  ));

export const decodeProbeSampleFinalizeRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeSampleFinalizeRequestV1",
)((value: unknown) =>
  decodeUnknownFinalizeRequest(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRunProtocolValidationError({
          boundary: "sample-finalize-request-v1",
          cause,
        }),
    ),
  ));

export const decodeProbeRunStatusRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeRunStatusRequestV1",
)((value: unknown) =>
  decodeUnknownStatusRequest(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRunProtocolValidationError({
          boundary: "run-status-request-v1",
          cause,
        }),
    ),
  ));

export const decodeProbeRunRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRunRequestV1Schema);
export const decodeProbePublicSampleRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbePublicSampleRequestV1Schema);
export const decodeProbeSampleFinalizeRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSampleFinalizeRequestV1Schema);
export const decodeProbeRunStatusRequestV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRunStatusRequestV1Schema);
export const decodeProbeRunRegistrationReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRunRegistrationReceiptV1Schema);
export const decodeProbeSampleClaimReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSampleClaimReceiptV1Schema);
export const decodeProbeSampleFinalizeReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSampleFinalizeReceiptV1Schema);
export const decodeProbeRunStatusReceiptV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeRunStatusReceiptV1Schema);
export const decodeProbeControlledGatewaySampleV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeControlledGatewaySampleV1Schema);

export function probeRunBudgetPlanV1(
  run: ProbeRunRequestV1,
): ProbeRunBudgetValuesV1 {
  const sampleClaims = run.warmupRepetitions + run.repetitions;
  const hasDynamicCode =
    run.scenario === "dynamic_direct_echo" ||
    run.scenario === "facet_echo" ||
    run.scenario === "facet_journal" ||
    run.scenario === "full_invoke" ||
    run.scenario === "sync_rerun";
  const uniqueCodeIds = !hasDynamicCode
    ? 0
    : run.dimensions.codeMode === "stable"
    ? 1
    : sampleClaims;
  return ProbeRunBudgetValuesV1Schema.make({
    sampleClaims,
    payloadBytes: sampleClaims * run.dimensions.payloadBytes,
    journalEntries: sampleClaims * run.dimensions.journalEntries,
    uniqueCodeIds,
  });
}

export function canonicalProbeRunRequestV1(run: ProbeRunRequestV1): string {
  return JSON.stringify({
    protocolVersion: run.protocolVersion,
    runId: run.runId,
    scenario: run.scenario,
    repetitions: run.repetitions,
    warmupRepetitions: run.warmupRepetitions,
    dimensions: {
      codeMode: run.dimensions.codeMode,
      concurrency: run.dimensions.concurrency,
      journalEntries: run.dimensions.journalEntries,
      payloadBytes: run.dimensions.payloadBytes,
      sessionMode: run.dimensions.sessionMode,
    },
  });
}

function runStatusRelationshipIssue(
  status: typeof ProbeRunStatusV1Shape.Type,
): string | undefined {
  const { counters, budgets } = status;
  const planned = probeRunBudgetPlanV1(status.run);
  if (!sameBudgetValues(budgets.limits, PROBE_RUN_BUDGET_LIMITS_V1)) {
    return "run budget limits must match the protocol limits";
  }
  if (!sameBudgetValues(budgets.planned, planned)) {
    return "planned run budgets must match the immutable run configuration";
  }
  if (counters.claimed !== counters.terminal + counters.outstanding) {
    return "claimed samples must equal terminal plus outstanding samples";
  }
  if (counters.terminal !== counters.completed + counters.failed) {
    return "terminal samples must equal completed plus failed samples";
  }
  if (
    counters.terminal !==
      counters.eligible + counters.excludedWarmup +
        counters.excludedDuplicateWake
  ) {
    return "terminal samples must equal the disposition counters";
  }
  if (budgets.consumed.sampleClaims !== counters.claimed) {
    return "consumed sample claims must equal claimed samples";
  }
  if (
    budgets.consumed.payloadBytes !==
      counters.claimed * status.run.dimensions.payloadBytes ||
    budgets.consumed.journalEntries !==
      counters.claimed * status.run.dimensions.journalEntries ||
    budgets.consumed.uniqueCodeIds !== expectedConsumedCodeIds(status)
  ) {
    return "consumed run budgets must match the claimed sample identities";
  }
  if (
    counters.outstanding > status.run.dimensions.concurrency ||
    counters.highWaterOutstandingClaims > status.run.dimensions.concurrency
  ) {
    return "outstanding concurrency cannot exceed the registered limit";
  }
  if (status.samples.length !== counters.claimed) {
    return "status must include every claimed sample exactly once";
  }
  const sampleIssue = runSampleRelationshipIssue(status);
  if (sampleIssue !== undefined) return sampleIssue;
  if (
    budgets.consumed.sampleClaims > budgets.planned.sampleClaims ||
    budgets.consumed.payloadBytes > budgets.planned.payloadBytes ||
    budgets.consumed.journalEntries > budgets.planned.journalEntries ||
    budgets.consumed.uniqueCodeIds > budgets.planned.uniqueCodeIds
  ) {
    return "consumed run budgets cannot exceed their immutable plan";
  }
  const expectedState = counters.claimed === 0
    ? "registered"
    : counters.terminal === budgets.planned.sampleClaims
    ? "complete"
    : counters.outstanding > 0
    ? "outstanding-claims"
    : "partial";
  if (status.state !== expectedState) {
    return "run state must match its durable counters";
  }
  return undefined;
}

function runSampleRelationshipIssue(
  status: typeof ProbeRunStatusV1Shape.Type,
): string | undefined {
  const seenOrdinals = new Set<number>();
  let completed = 0;
  let failed = 0;
  let outstanding = 0;
  let eligible = 0;
  let excludedWarmup = 0;
  let excludedDuplicateWake = 0;
  let observedHighWater = 0;
  const totalSamples =
    status.run.warmupRepetitions + status.run.repetitions;

  for (const sample of status.samples) {
    if (
      sample.sampleOrdinal >= totalSamples ||
      seenOrdinals.has(sample.sampleOrdinal)
    ) {
      return "sample ordinals must be unique and inside the immutable run";
    }
    seenOrdinals.add(sample.sampleOrdinal);
    const expectedPhase = sample.sampleOrdinal < status.run.warmupRepetitions
      ? "warmup"
      : "measurement";
    if (sample.phase !== expectedPhase) {
      return "sample phases must match their immutable run segment";
    }
    if (
      sample.observedOutstandingClaims > status.run.dimensions.concurrency
    ) {
      return "sample observations cannot exceed configured concurrency";
    }
    observedHighWater = Math.max(
      observedHighWater,
      sample.observedOutstandingClaims,
    );
    if (sample.state === "claimed") {
      outstanding += 1;
      continue;
    }
    const wakeScenario = status.run.scenario === "commit_wake" ||
      status.run.scenario === "full_invoke";
    if (
      (wakeScenario && sample.syncWake.kind === "not-applicable") ||
      (!wakeScenario && sample.syncWake.kind !== "not-applicable")
    ) {
      return "terminal sample wake evidence must match the registered scenario";
    }
    if (wakeScenario) {
      const successfulWake = sample.syncWake.kind === "observed" &&
        (sample.syncWake.disposition === "applied" ||
          sample.syncWake.disposition === "duplicate");
      if ((sample.state === "completed") !== successfulWake) {
        return "terminal sample state must match its wake result";
      }
    }
    const expectedDisposition = sample.phase === "warmup"
      ? "excluded-warmup"
      : sample.syncWake.kind === "observed" &&
          sample.syncWake.disposition === "duplicate"
      ? "excluded-duplicate-wake"
      : "eligible";
    if (sample.measurementDisposition !== expectedDisposition) {
      return "terminal sample dispositions must match phase and wake evidence";
    }
    if (sample.state === "completed") completed += 1;
    else failed += 1;
    switch (sample.measurementDisposition) {
      case "eligible":
        eligible += 1;
        break;
      case "excluded-warmup":
        excludedWarmup += 1;
        break;
      case "excluded-duplicate-wake":
        excludedDuplicateWake += 1;
        break;
    }
  }

  if (
    completed !== status.counters.completed ||
    failed !== status.counters.failed ||
    outstanding !== status.counters.outstanding
  ) {
    return "sample lifecycle states must match the durable counters";
  }
  if (
    eligible !== status.counters.eligible ||
    excludedWarmup !== status.counters.excludedWarmup ||
    excludedDuplicateWake !== status.counters.excludedDuplicateWake
  ) {
    return "sample dispositions must match the durable counters";
  }
  return observedHighWater === status.counters.highWaterOutstandingClaims
    ? undefined
    : "sample observations must match the durable concurrency high-water mark";
}

function expectedConsumedCodeIds(
  status: typeof ProbeRunStatusV1Shape.Type,
): number {
  if (status.budgets.planned.uniqueCodeIds === 0) return 0;
  return status.run.dimensions.codeMode === "stable"
    ? Number(status.counters.claimed > 0)
    : status.counters.claimed;
}

function sameBudgetValues(
  left: ProbeRunBudgetValuesV1,
  right: ProbeRunBudgetValuesV1,
): boolean {
  return left.sampleClaims === right.sampleClaims &&
    left.payloadBytes === right.payloadBytes &&
    left.journalEntries === right.journalEntries &&
    left.uniqueCodeIds === right.uniqueCodeIds;
}

function boundedInteger(minimum: number, maximum: number, label: string) {
  return Schema.Int.check(
    Schema.makeFilter((value: number) =>
      value >= minimum && value <= maximum
        ? undefined
        : `${label} must be an integer from ${minimum} through ${maximum}`
    ),
  );
}

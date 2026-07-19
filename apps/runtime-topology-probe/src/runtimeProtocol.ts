import { Data, Effect, Schema } from "effect";

import { ProbeSyncDispositionSchema } from "./commitProtocol";
import { strictSchemaValueOrNullDecoder } from "./effectBoundary";

import {
  probeSampleId,
  probeSpanId,
  ProbeOrdinalSchema,
  ProbeRunIdSchema,
  ProbeSampleIdSchema,
  PROBE_ORDINAL_ZERO,
  type ProbeOrdinal,
} from "./identity";
import {
  probeSampleIdentityV1,
  probeDimensionRelationshipIssueV1,
  PROBE_LIMITS_V1,
  ProbeDimensionsV1Schema,
  ProbeDurationMsSchema,
  ProbeEdgeColoSchema,
  ProbeProtocolVersionV1Schema,
  probeStartupRelationshipIssueV1,
  ProbeRunRequestV1Schema,
  ProbeSampleIdentityV1Schema,
  ProbeSampleOutcomeV1Schema,
  ProbeSampleResultV1Schema,
  ProbeSamplePhaseSchema,
  ProbeScenarioSchema,
  ProbeStartupObservationsV1Schema,
  ProbeTraceSpanV1Schema,
  sameProbeNormalizedErrorV1,
  sameProbeSampleIdentityV1,
  type ProbeRunRequestV1,
  type ProbeSampleOutcomeV1,
  type ProbeSamplePhase,
  type ProbeSampleResultV1,
  type ProbeStartupObservationsV1,
  type ProbeTraceSpanV1,
} from "./protocol";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strictSchemaOptions";

const SyntheticPayloadSchema = Schema.String.check(
  Schema.isPattern(/^x*$/),
);

const ProbeGatewaySampleRequestV1Shape = Schema.Struct({
  run: ProbeRunRequestV1Schema,
  sampleOrdinal: ProbeOrdinalSchema,
  phase: ProbeSamplePhaseSchema,
  payload: SyntheticPayloadSchema,
}).annotate(StrictStructOptions);

export const ProbeGatewaySampleRequestV1Schema =
  ProbeGatewaySampleRequestV1Shape.check(
    Schema.makeFilter(request => {
      const totalSamples =
        request.run.warmupRepetitions + request.run.repetitions;
      if (request.sampleOrdinal >= totalSamples) {
        return "sampleOrdinal must address one configured warmup or measured sample";
      }
      const isWarmup =
        request.sampleOrdinal < request.run.warmupRepetitions;
      if (
        (request.phase === "warmup") !== isWarmup
      ) {
        return "phase must match the sample ordinal's configured run segment";
      }
      return new TextEncoder().encode(request.payload).byteLength ===
          request.run.dimensions.payloadBytes
        ? undefined
        : "payload must contain exactly dimensions.payloadBytes synthetic bytes";
    }),
  );
export type ProbeGatewaySampleRequestV1 =
  typeof ProbeGatewaySampleRequestV1Schema.Type;

const ProbeGatewaySampleV1Shape = Schema.Struct({
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

export const ProbeGatewaySampleV1Schema = ProbeGatewaySampleV1Shape.check(
  Schema.makeFilter(sample => gatewaySampleRelationshipIssue(sample)),
);
export type ProbeGatewaySampleV1 = typeof ProbeGatewaySampleV1Schema.Type;

export const ProbeMeasurementDispositionSchema = Schema.Literals([
  "eligible",
  "excluded-warmup",
  "excluded-duplicate-wake",
]);
export type ProbeMeasurementDisposition =
  typeof ProbeMeasurementDispositionSchema.Type;

export const ProbeSyncWakeObservationV1Schema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("not-applicable") }).annotate(
    StrictStructOptions,
  ),
  Schema.Struct({ kind: Schema.Literal("unobserved") }).annotate(
    StrictStructOptions,
  ),
  Schema.Struct({
    kind: Schema.Literal("observed"),
    disposition: ProbeSyncDispositionSchema,
  }).annotate(StrictStructOptions),
]);
export type ProbeSyncWakeObservationV1 =
  typeof ProbeSyncWakeObservationV1Schema.Type;
export const decodeProbeSyncWakeObservationV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeSyncWakeObservationV1Schema);

const ObservedOutstandingClaimsSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 1 && value <= PROBE_LIMITS_V1.maxConcurrency
      ? undefined
      : `observedOutstandingClaims must be an integer from 1 through ${PROBE_LIMITS_V1.maxConcurrency}`
  ),
);
const ConfiguredConcurrencySchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 1 && value <= PROBE_LIMITS_V1.maxConcurrency
      ? undefined
      : `configuredConcurrency must be an integer from 1 through ${PROBE_LIMITS_V1.maxConcurrency}`
  ),
);

const ProbeSampleControlV1Shape = Schema.Struct({
  phase: ProbeSamplePhaseSchema,
  terminalState: Schema.Literals(["completed", "failed"]),
  measurementDisposition: ProbeMeasurementDispositionSchema,
  configuredConcurrency: ConfiguredConcurrencySchema,
  observedOutstandingClaims: ObservedOutstandingClaimsSchema,
  scenarioWindowDurationMs: ProbeDurationMsSchema,
  syncWake: ProbeSyncWakeObservationV1Schema,
  externalRequestIncludesControlPlane: Schema.Literal(true),
}).annotate(StrictStructOptions);

export const ProbeSampleControlV1Schema = ProbeSampleControlV1Shape.check(
  Schema.makeFilter(control => sampleControlRelationshipIssue(control)),
);
export type ProbeSampleControlV1 = typeof ProbeSampleControlV1Schema.Type;

const ProbeControlledGatewaySampleV1Shape = Schema.Struct({
  fragment: ProbeGatewaySampleV1Schema,
  control: ProbeSampleControlV1Schema,
}).annotate(StrictStructOptions);

export const ProbeControlledGatewaySampleV1Schema =
  ProbeControlledGatewaySampleV1Shape.check(
    Schema.makeFilter(value =>
      controlledSampleRelationshipIssue(value.fragment, value.control)
    ),
  );
export type ProbeControlledGatewaySampleV1 =
  typeof ProbeControlledGatewaySampleV1Schema.Type;
export const decodeProbeControlledGatewaySampleV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeControlledGatewaySampleV1Schema);

const ProbeControlledSampleResultV1Shape = Schema.Struct({
  sample: ProbeSampleResultV1Schema,
  control: ProbeSampleControlV1Schema,
}).annotate(StrictStructOptions);

export const ProbeControlledSampleResultV1Schema =
  ProbeControlledSampleResultV1Shape.check(
    Schema.makeFilter(value =>
      controlledSampleRelationshipIssue(value.sample, value.control)
    ),
  );
export type ProbeControlledSampleResultV1 =
  typeof ProbeControlledSampleResultV1Schema.Type;
export const decodeProbeControlledSampleResultV1OrNull =
  strictSchemaValueOrNullDecoder(ProbeControlledSampleResultV1Schema);

export class ProbeRuntimeProtocolValidationError extends Data.TaggedError(
  "ProbeRuntimeProtocolValidationError",
)<{
  readonly boundary:
    | "gateway-sample-request-v1"
    | "gateway-sample-v1"
    | "controlled-gateway-sample-v1"
    | "controlled-sample-result-v1";
  readonly cause: unknown;
}> {}

const decodeUnknownGatewaySampleRequest = Schema.decodeUnknownEffect(
  ProbeGatewaySampleRequestV1Schema,
  StrictParseOptions,
);
const decodeUnknownGatewaySample = Schema.decodeUnknownEffect(
  ProbeGatewaySampleV1Schema,
  StrictParseOptions,
);
const decodeUnknownControlledGatewaySample = Schema.decodeUnknownEffect(
  ProbeControlledGatewaySampleV1Schema,
  StrictParseOptions,
);
const decodeUnknownControlledSampleResult = Schema.decodeUnknownEffect(
  ProbeControlledSampleResultV1Schema,
  StrictParseOptions,
);

export const decodeProbeGatewaySampleRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeGatewaySampleRequestV1",
)((value: unknown) =>
  decodeUnknownGatewaySampleRequest(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRuntimeProtocolValidationError({
          boundary: "gateway-sample-request-v1",
          cause,
      }),
    ),
  ));

export const decodeProbeGatewaySampleV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeGatewaySampleV1",
)((value: unknown) =>
  decodeUnknownGatewaySample(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRuntimeProtocolValidationError({
          boundary: "gateway-sample-v1",
          cause,
      }),
    ),
  ));

export const decodeProbeControlledGatewaySampleV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeControlledGatewaySampleV1",
)((value: unknown) =>
  decodeUnknownControlledGatewaySample(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRuntimeProtocolValidationError({
          boundary: "controlled-gateway-sample-v1",
          cause,
        }),
    ),
  ));

export const decodeProbeControlledSampleResultV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeControlledSampleResultV1",
)((value: unknown) =>
  decodeUnknownControlledSampleResult(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRuntimeProtocolValidationError({
          boundary: "controlled-sample-result-v1",
          cause,
        }),
    ),
  ));

export function completeProbeGatewaySampleV1(
  gatewaySample: ProbeGatewaySampleV1,
  externalDurationMs: number,
): ProbeSampleResultV1 {
  const externalSpan = ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(PROBE_ORDINAL_ZERO),
    parentSpanId: null,
    name: "external_request",
    durationMs: ProbeDurationMsSchema.make(externalDurationMs),
    outcome: gatewaySample.outcome.kind === "ok"
      ? { kind: "ok" }
      : { kind: "error", error: gatewaySample.outcome.error },
  });
  return ProbeSampleResultV1Schema.make({
    protocolVersion: gatewaySample.protocolVersion,
    runId: gatewaySample.runId,
    sampleId: gatewaySample.sampleId,
    scenario: gatewaySample.scenario,
    dimensions: gatewaySample.dimensions,
    identity: gatewaySample.identity,
    startup: gatewaySample.startup,
    edgeColo: gatewaySample.edgeColo,
    outcome: gatewaySample.outcome,
    spans: [externalSpan, ...gatewaySample.spans],
  });
}

export function completeControlledProbeGatewaySampleV1(
  gatewaySample: ProbeControlledGatewaySampleV1,
  externalDurationMs: number,
): ProbeControlledSampleResultV1 {
  return ProbeControlledSampleResultV1Schema.make({
    sample: completeProbeGatewaySampleV1(
      gatewaySample.fragment,
      externalDurationMs,
    ),
    control: gatewaySample.control,
  });
}

export function controlledProbeGatewaySampleV1(
  fragment: ProbeGatewaySampleV1,
  control: ProbeSampleControlV1,
): ProbeControlledGatewaySampleV1 {
  return ProbeControlledGatewaySampleV1Schema.make({ fragment, control });
}

export function probeSyncWakeRelationshipIssueV1(
  sample: Pick<ProbeGatewaySampleV1, "scenario" | "outcome">,
  syncWake: ProbeSyncWakeObservationV1,
): string | undefined {
  const wakeScenario =
    sample.scenario === "commit_wake" ||
    sample.scenario === "full_invoke" ||
    sample.scenario === "executor_worker_invoke" ||
    sample.scenario === "facet_executor_invoke" ||
    sample.scenario === "facet_finalizer_invoke" ||
    sample.scenario === "session_executor_invoke";
  if (!wakeScenario) {
    return syncWake.kind === "not-applicable"
      ? undefined
      : `${sample.scenario} cannot report a sync wake observation`;
  }
  if (syncWake.kind === "not-applicable") {
    return `${sample.scenario} must report an observed or unobserved sync wake`;
  }
  if (sample.outcome.kind === "ok") {
    return syncWake.kind === "observed" &&
        (syncWake.disposition === "applied" ||
          syncWake.disposition === "duplicate")
      ? undefined
      : `successful ${sample.scenario} requires an applied or duplicate wake`;
  }
  if (syncWake.kind === "unobserved") {
    const preReceiptStage = sample.scenario === "commit_wake"
      ? "mock_sync_wake_rtt"
      : "gateway_session_rtt";
    return sample.outcome.error.stage === "request" ||
        sample.outcome.error.stage === preReceiptStage
      ? undefined
      : `unobserved ${sample.scenario} wakes require a pre-receipt failure`;
  }
  if (
    (syncWake.disposition === "gap" || syncWake.disposition === "stale") &&
    sample.outcome.error.stage === "sync_cursor_io"
  ) {
    return undefined;
  }
  return `failed ${sample.scenario} wake evidence must identify a gap or stale sync-cursor failure`;
}

function sampleControlRelationshipIssue(
  control: typeof ProbeSampleControlV1Shape.Type,
): string | undefined {
  if (control.observedOutstandingClaims > control.configuredConcurrency) {
    return "observed outstanding claims cannot exceed configured concurrency";
  }
  if (control.phase === "warmup") {
    return control.measurementDisposition === "excluded-warmup"
      ? undefined
      : "warmup samples must be excluded from measurement aggregates";
  }
  if (
    control.syncWake.kind === "observed" &&
    control.syncWake.disposition === "duplicate"
  ) {
    return control.measurementDisposition === "excluded-duplicate-wake"
      ? undefined
      : "measured duplicate wakes must use the duplicate-wake disposition";
  }
  return control.measurementDisposition === "eligible"
    ? undefined
    : "ordinary measured samples must be aggregate eligible";
}

function controlledSampleRelationshipIssue(
  sample: ProbeGatewaySampleV1 | ProbeSampleResultV1,
  control: ProbeSampleControlV1,
): string | undefined {
  if (control.configuredConcurrency !== sample.dimensions.concurrency) {
    return "configuredConcurrency must match the registered sample dimensions";
  }
  if (
    control.terminalState !==
      (sample.outcome.kind === "ok" ? "completed" : "failed")
  ) {
    return "terminalState must match the sample outcome";
  }
  return probeSyncWakeRelationshipIssueV1(sample, control.syncWake);
}

function gatewaySampleRelationshipIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
): string | undefined {
  const dimensionIssue = probeDimensionRelationshipIssueV1(
    sample.scenario,
    sample.dimensions,
  );
  if (dimensionIssue !== undefined) return dimensionIssue;
  const startupIssue = probeStartupRelationshipIssueV1(
    sample.scenario,
    sample.startup,
    sample.outcome,
  );
  if (startupIssue !== undefined) return startupIssue;
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
  switch (sample.scenario) {
    case "edge_echo":
      return hasNoStartupCallbacks(sample.startup) &&
          sample.spans.length === 0 &&
          (sample.outcome.kind === "ok" ||
            sample.outcome.error.stage === "request")
        ? undefined
        : "edge_echo must return one rootless gateway sample";
    case "session_echo":
      return hasNoStartupCallbacks(sample.startup)
        ? sessionEchoRelationshipIssue(sample)
        : "session_echo cannot report Dynamic Worker callbacks";
    case "dynamic_direct_echo":
      return sample.startup.workerLoader !== "not-applicable" &&
          sample.startup.facet === "not-applicable"
        ? dynamicDirectRelationshipIssue(sample)
        : "dynamic_direct_echo requires only a Worker Loader callback observation";
    case "facet_echo":
    case "facet_journal":
      return hasFacetStartupObservations(sample.startup)
        ? facetRelationshipIssue(sample)
        : `${sample.scenario} requires consistent Worker Loader and facet callback observations`;
    case "commit_wake":
      return hasNoStartupCallbacks(sample.startup)
        ? commitWakeRelationshipIssue(sample)
        : "commit_wake cannot report Dynamic Worker callbacks";
    case "full_invoke":
    case "executor_worker_invoke":
    case "facet_executor_invoke":
    case "facet_finalizer_invoke":
    case "session_executor_invoke":
      return hasFacetStartupObservations(sample.startup)
        ? fullInvokeRelationshipIssue(sample)
        : `${sample.scenario} requires consistent Worker Loader and facet callback observations`;
    case "sync_rerun":
      return hasFacetStartupObservations(sample.startup)
        ? syncRerunRelationshipIssue(sample)
        : "sync_rerun requires consistent Worker Loader and facet callback observations";
    default:
      return "this gateway sample version does not support the selected scenario";
  }
}

function hasNoStartupCallbacks(
  startup: ProbeStartupObservationsV1,
): boolean {
  return startup.workerLoader === "not-applicable" &&
    startup.facet === "not-applicable";
}

function sessionEchoRelationshipIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
): string | undefined {
  const [span] = sample.spans;
  if (
    sample.spans.length !== 1 ||
    span === undefined ||
    span.spanId !== probeSpanId(ordinal(1)) ||
    span.parentSpanId !== probeSpanId(PROBE_ORDINAL_ZERO) ||
    span.name !== "gateway_session_rtt"
  ) {
    return "session_echo must return exactly its gateway-to-session round trip";
  }
  if (sample.outcome.kind === "ok") {
    return span.outcome.kind === "ok"
      ? undefined
      : "successful session_echo requires a successful span";
  }
  return span.outcome.kind === "error" &&
      sameProbeNormalizedErrorV1(span.outcome.error, sample.outcome.error)
    ? undefined
    : "failed session_echo requires one matching failed span";
}

function dynamicDirectRelationshipIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
): string | undefined {
  const [span] = sample.spans;
  if (
    sample.spans.length !== 1 ||
    span === undefined ||
    span.spanId !== probeSpanId(ordinal(1)) ||
    span.parentSpanId !== probeSpanId(PROBE_ORDINAL_ZERO) ||
    span.name !== "gateway_dynamic_rtt"
  ) {
    return "dynamic_direct_echo must return exactly its gateway-to-worker round trip";
  }
  if (sample.outcome.kind === "ok") {
    return span.outcome.kind === "ok"
      ? undefined
      : "successful dynamic_direct_echo requires a successful span";
  }
  return span.outcome.kind === "error" &&
      sameProbeNormalizedErrorV1(span.outcome.error, sample.outcome.error)
    ? undefined
    : "failed dynamic_direct_echo requires one matching failed span";
}

function hasFacetStartupObservations(
  startup: ProbeStartupObservationsV1,
): boolean {
  if (
    startup.workerLoader === "not-applicable" ||
    startup.facet === "not-applicable"
  ) {
    return false;
  }
  return !(
    startup.workerLoader === "callback-ran" &&
    startup.facet === "callback-not-run"
  );
}

function facetRelationshipIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
): string | undefined {
  const expected = sample.scenario === "facet_journal"
    ? [
        ["gateway_session_rtt", 1, 0],
        ["session_facet_rtt", 2, 1],
        ["facet_journal_io", 3, 2],
      ] as const
    : [
        ["gateway_session_rtt", 1, 0],
        ["session_facet_rtt", 2, 1],
      ] as const;
  if (sample.outcome.kind !== "ok") {
    return nestedSpanTreeIssue(sample, expected);
  }
  if (sample.spans.length !== expected.length) {
    return `${sample.scenario} must return every completed nested round trip`;
  }
  for (const [index, [name, spanOrdinal, parentOrdinal]] of expected.entries()) {
    const span = sample.spans[index];
    if (
      span === undefined ||
      span.name !== name ||
      span.spanId !== probeSpanId(ordinal(spanOrdinal)) ||
      span.parentSpanId !== probeSpanId(ordinal(parentOrdinal)) ||
      span.outcome.kind !== "ok"
    ) {
      return `${sample.scenario} returned an invalid nested span tree`;
    }
  }
  return undefined;
}

function commitWakeRelationshipIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
): string | undefined {
  return nestedSpanTreeIssue(sample, [
    ["mock_sync_wake_rtt", 1, 0],
    ["sync_cursor_io", 2, 1],
  ]);
}

function fullInvokeRelationshipIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
): string | undefined {
  if (sample.scenario === "facet_finalizer_invoke") {
    return nestedSpanTreeIssue(sample, [
      ["gateway_session_rtt", 1, 0],
      ["session_snapshot_read_rtt", 2, 1],
      ["session_facet_rtt", 3, 1],
      ["facet_snapshot_read", 4, 3],
      ["facet_journal_io", 5, 3],
      ["facet_atomic_commit_rtt", 6, 3],
      ["mock_sync_wake_rtt", 7, 6],
      ["sync_cursor_io", 8, 7],
    ]);
  }
  if (sample.scenario === "facet_executor_invoke") {
    return nestedSpanTreeIssue(sample, [
      ["gateway_session_rtt", 1, 0],
      ["session_snapshot_read_rtt", 2, 1],
      ["session_facet_rtt", 3, 1],
      ["facet_snapshot_read", 4, 3],
      ["facet_journal_io", 5, 3],
      ["session_mock_finish_rtt", 6, 1],
      ["mock_sync_wake_rtt", 7, 6],
      ["sync_cursor_io", 8, 7],
    ]);
  }
  const tail = sample.scenario === "session_executor_invoke"
    ? [
        ["facet_session_read_rtt", 3, 2],
        ["facet_journal_io", 4, 2],
        ["session_executor_finish", 5, 1],
        ["session_sync_wake_rtt", 6, 5],
        ["sync_cursor_io", 7, 6],
      ] as const
    : [
        ["facet_mock_read_rtt", 3, 2],
        ["facet_journal_io", 4, 2],
        ["session_mock_finish_rtt", 5, 1],
        ["mock_sync_wake_rtt", 6, 5],
        ["sync_cursor_io", 7, 6],
      ] as const;
  return nestedSpanTreeIssue(sample, [
    ["gateway_session_rtt", 1, 0],
    ["session_facet_rtt", 2, 1],
    ...tail,
  ]);
}

function syncRerunRelationshipIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
): string | undefined {
  return nestedSpanTreeIssue(sample, [
    ["sync_runtime_rerun_rtt", 1, 0],
    ["gateway_session_rtt", 2, 1],
    ["session_facet_rtt", 3, 2],
  ]);
}

function nestedSpanTreeIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
  expected: ReadonlyArray<
    readonly [
      name: ProbeTraceSpanV1["name"],
      spanOrdinal: number,
      parentOrdinal: number,
    ]
  >,
): string | undefined {
  if (
    sample.outcome.kind === "ok" &&
    sample.spans.length !== expected.length
  ) {
    return `${sample.scenario} must return every completed nested round trip`;
  }
  if (sample.spans.length > expected.length) {
    return `${sample.scenario} returned more spans than its topology permits`;
  }
  for (const [index, span] of sample.spans.entries()) {
    const expectedSpan = expected[index];
    if (expectedSpan === undefined) {
      return `${sample.scenario} returned an unexpected nested span`;
    }
    const [name, spanOrdinal, parentOrdinal] = expectedSpan;
    if (
      span.name !== name ||
      span.spanId !== probeSpanId(ordinal(spanOrdinal)) ||
      span.parentSpanId !== probeSpanId(ordinal(parentOrdinal))
    ) {
      return `${sample.scenario} returned an invalid nested span tree`;
    }
  }
  if (sample.outcome.kind === "ok") {
    return sample.spans.every(span => span.outcome.kind === "ok")
      ? undefined
      : `successful ${sample.scenario} requires successful nested spans`;
  }
  if (sample.spans.length === 0) {
    const firstExpected = expected[0]?.[0];
    return sample.outcome.error.stage === "request" ||
        sample.outcome.error.stage === firstExpected
      ? undefined
      : `failed ${sample.scenario} without spans cannot claim an unobserved deep stage`;
  }
  const lastIndex = sample.spans.length - 1;
  for (const [index, span] of sample.spans.entries()) {
    if (index === lastIndex) {
      if (
        span.outcome.kind !== "error" ||
        !sameProbeNormalizedErrorV1(span.outcome.error, sample.outcome.error) ||
        span.name !== sample.outcome.error.stage
      ) {
        return `failed ${sample.scenario} requires a matching terminal failed span`;
      }
    } else if (span.outcome.kind !== "ok") {
      return `failed ${sample.scenario} requires a successful span prefix`;
    }
  }
  return undefined;
}

function ordinal(value: number): ProbeOrdinal {
  return ProbeOrdinalSchema.make(value);
}

export function gatewaySampleFromRun(
  run: ProbeRunRequestV1,
  sampleOrdinal: ProbeOrdinal,
  input: {
    readonly edgeColo: string | null;
    readonly outcome: ProbeSampleOutcomeV1;
    readonly spans: ReadonlyArray<ProbeTraceSpanV1>;
    readonly startup?: ProbeStartupObservationsV1;
  },
): ProbeGatewaySampleV1 {
  return ProbeGatewaySampleV1Schema.make({
    protocolVersion: run.protocolVersion,
    runId: run.runId,
    sampleId: probeSampleId(run.runId, sampleOrdinal),
    scenario: run.scenario,
    dimensions: run.dimensions,
    identity: probeSampleIdentityV1(
      run.runId,
      run.scenario,
      run.dimensions,
      sampleOrdinal,
    ),
    startup: input.startup ?? {
      workerLoader: "not-applicable",
      facet: "not-applicable",
    },
    edgeColo: input.edgeColo,
    outcome: input.outcome,
    spans: input.spans,
  });
}

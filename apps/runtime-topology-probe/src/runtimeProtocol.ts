import { Data, Effect, Schema } from "effect";

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
  ProbeDimensionsV1Schema,
  ProbeDurationMsSchema,
  ProbeEdgeColoSchema,
  ProbeProtocolVersionV1Schema,
  ProbeRunRequestV1Schema,
  ProbeSampleIdentityV1Schema,
  ProbeSampleOutcomeV1Schema,
  ProbeSampleResultV1Schema,
  ProbeScenarioSchema,
  ProbeStartupObservationsV1Schema,
  ProbeTraceSpanV1Schema,
  type ProbeNormalizedErrorV1,
  type ProbeRunRequestV1,
  type ProbeSampleOutcomeV1,
  type ProbeSampleResultV1,
  type ProbeStartupObservationsV1,
  type ProbeTraceSpanV1,
} from "./protocol";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;
const StrictParseOptions = { onExcessProperty: "error" } as const;

const SyntheticPayloadSchema = Schema.String.check(
  Schema.isPattern(/^x*$/),
);

export const ProbeSamplePhaseSchema = Schema.Literals([
  "warmup",
  "measurement",
]);
export type ProbeSamplePhase = typeof ProbeSamplePhaseSchema.Type;

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

export class ProbeRuntimeProtocolValidationError extends Data.TaggedError(
  "ProbeRuntimeProtocolValidationError",
)<{
  readonly boundary: "gateway-sample-request-v1" | "gateway-sample-v1";
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

export const decodeProbeGatewaySampleRequestV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeGatewaySampleRequestV1",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ProbeGatewaySampleRequestV1,
  ProbeRuntimeProtocolValidationError
> {
  return yield* decodeUnknownGatewaySampleRequest(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRuntimeProtocolValidationError({
          boundary: "gateway-sample-request-v1",
          cause,
        }),
    ),
  );
});

export const decodeProbeGatewaySampleV1Effect = Effect.fn(
  "RuntimeTopologyProbe.decodeGatewaySampleV1",
)(function* (
  value: unknown,
): Effect.fn.Return<ProbeGatewaySampleV1, ProbeRuntimeProtocolValidationError> {
  return yield* decodeUnknownGatewaySample(value).pipe(
    Effect.mapError(
      cause =>
        new ProbeRuntimeProtocolValidationError({
          boundary: "gateway-sample-v1",
          cause,
        }),
    ),
  );
});

export function completeProbeGatewaySampleV1(
  gatewaySample: ProbeGatewaySampleV1,
  externalDurationMs: number,
): ProbeSampleResultV1 {
  const externalSpan = ProbeTraceSpanV1Schema.make({
    spanId: probeSpanId(PROBE_ORDINAL_ZERO),
    parentSpanId: null,
    name: "external_request",
    durationMs: ProbeDurationMsSchema.make(externalDurationMs),
    outcome: { kind: "ok" },
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

function gatewaySampleRelationshipIssue(
  sample: typeof ProbeGatewaySampleV1Shape.Type,
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
  if (!sameGatewayIdentity(sample.identity, expectedIdentity)) {
    return "identity must match the run, scenario, dimensions, and sample ordinal";
  }
  switch (sample.scenario) {
    case "edge_echo":
      return hasNoStartupCallbacks(sample.startup) &&
          sample.spans.length === 0 &&
          sample.outcome.kind === "ok"
        ? undefined
        : "edge_echo must return one successful rootless gateway sample";
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
      sameError(span.outcome.error, sample.outcome.error)
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
      sameError(span.outcome.error, sample.outcome.error)
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
  if (sample.outcome.kind !== "ok") {
    return `${sample.scenario} gateway fragments require a fully observed successful call`;
  }
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

function sameGatewayIdentity(
  left: typeof ProbeSampleIdentityV1Schema.Type,
  right: typeof ProbeSampleIdentityV1Schema.Type,
): boolean {
  return left.kind === right.kind &&
    left.sampleOrdinal === right.sampleOrdinal &&
    left.scopeId === right.scopeId &&
    left.sessionId === right.sessionId &&
    left.attemptId === right.attemptId &&
    left.codeId === right.codeId;
}

function sameError(
  left: ProbeNormalizedErrorV1,
  right: ProbeNormalizedErrorV1,
): boolean {
  return left.code === right.code &&
    left.retryable === right.retryable &&
    left.stage === right.stage;
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

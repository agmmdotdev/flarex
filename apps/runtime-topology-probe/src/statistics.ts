import { compareUtf16Strings } from "@flarex/utils/strings";
import { Schema } from "effect";

import {
  ProbeCallbackObservationSchema,
  ProbeDurationMsSchema,
  ProbeEdgeColoSchema,
  ProbeSamplePhaseSchema,
  ProbeScenarioSchema,
  ProbeSessionModeSchema,
  ProbeSpanNameSchema,
  type ProbeDurationMs,
  type ProbeSpanName,
} from "./protocol";
import {
  ProbeMeasurementDispositionSchema,
  type ProbeControlledSampleResultV1,
} from "./runtimeProtocol";
import {
  PROBE_SCENARIO_TOPOLOGY,
  validateProbeTraceV1,
} from "./trace";
import { ProbeCodeModeSchema } from "./identity";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;

const SummaryCountSchema = Schema.Int.check(
  Schema.makeFilter((value: number) =>
    value >= 0 && value <= 2_048
      ? undefined
      : "summary count must be between 0 and 2048"
  ),
);

export const ProbePercentile = {
  median: 50,
  p95: 95,
  p99: 99,
} as const;
export type ProbePercentile =
  typeof ProbePercentile[keyof typeof ProbePercentile];

export type ProbeMeasurement =
  | { readonly kind: "success"; readonly durationMs: ProbeDurationMs }
  | { readonly kind: "failure" };

const NullableDurationSchema = Schema.Union([ProbeDurationMsSchema, Schema.Null]);

const ProbeLatencySummaryV1Shape = Schema.Struct({
  count: SummaryCountSchema,
  successCount: SummaryCountSchema,
  failureCount: SummaryCountSchema,
  minMs: NullableDurationSchema,
  medianMs: NullableDurationSchema,
  p95Ms: NullableDurationSchema,
  p99Ms: NullableDurationSchema,
  maxMs: NullableDurationSchema,
}).annotate(StrictStructOptions);

export const ProbeLatencySummaryV1Schema = ProbeLatencySummaryV1Shape.check(
  Schema.makeFilter(summary => latencySummaryIssueV1(summary)),
);
export type ProbeLatencySummaryV1 = typeof ProbeLatencySummaryV1Schema.Type;

function latencySummaryIssueV1(
  summary: typeof ProbeLatencySummaryV1Shape.Type,
): string | undefined {
  if (summary.count !== summary.successCount + summary.failureCount) {
    return "latency summary count must equal success plus failure";
  }
  const durations = [
    summary.minMs,
    summary.medianMs,
    summary.p95Ms,
    summary.p99Ms,
    summary.maxMs,
  ];
  if (summary.successCount === 0) {
    return durations.every(duration => duration === null)
      ? undefined
      : "latency summary without successes must not report durations";
  }
  if (durations.some(duration => duration === null)) {
    return "latency summary successes require every duration statistic";
  }
  return summary.minMs !== null && summary.medianMs !== null &&
      summary.p95Ms !== null && summary.p99Ms !== null &&
      summary.maxMs !== null && summary.minMs <= summary.medianMs &&
      summary.medianMs <= summary.p95Ms && summary.p95Ms <= summary.p99Ms &&
      summary.p99Ms <= summary.maxMs
    ? undefined
    : "latency summary duration statistics must be ordered";
}

export const ProbeCohortKeyV1Schema = Schema.Struct({
  scenario: ProbeScenarioSchema,
  spanName: ProbeSpanNameSchema,
  codeMode: ProbeCodeModeSchema,
  sessionMode: ProbeSessionModeSchema,
  configuredConcurrency: Schema.Int,
  observedOutstandingClaims: Schema.Int,
  phase: ProbeSamplePhaseSchema,
  measurementDisposition: ProbeMeasurementDispositionSchema,
  journalEntries: Schema.Int,
  payloadBytes: Schema.Int,
  edgeColo: Schema.Union([ProbeEdgeColoSchema, Schema.Null]),
  workerLoaderCallback: ProbeCallbackObservationSchema,
  facetStartupCallback: ProbeCallbackObservationSchema,
}).annotate(StrictStructOptions);
export type ProbeCohortKeyV1 = typeof ProbeCohortKeyV1Schema.Type;

export const ProbeHopLatencySummaryV1Schema = Schema.Struct({
  cohort: ProbeCohortKeyV1Schema,
  latency: ProbeLatencySummaryV1Schema,
}).annotate(StrictStructOptions);
export type ProbeHopLatencySummaryV1 =
  typeof ProbeHopLatencySummaryV1Schema.Type;

export function nearestRankPercentile(
  values: readonly ProbeDurationMs[],
  percentile: ProbePercentile,
): ProbeDurationMs | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.max(rank - 1, 0)] ?? null;
}

export function summarizeProbeMeasurements(
  measurements: readonly ProbeMeasurement[],
): ProbeLatencySummaryV1 {
  const durations = measurements.flatMap(measurement =>
    measurement.kind === "success" ? [measurement.durationMs] : []
  );
  const sorted = [...durations].sort((left, right) => left - right);
  return {
    count: measurements.length,
    successCount: durations.length,
    failureCount: measurements.length - durations.length,
    minMs: sorted[0] ?? null,
    medianMs: nearestRankPercentile(sorted, ProbePercentile.median),
    p95Ms: nearestRankPercentile(sorted, ProbePercentile.p95),
    p99Ms: nearestRankPercentile(sorted, ProbePercentile.p99),
    maxMs: sorted[sorted.length - 1] ?? null,
  };
}

export function summarizeProbeSamples(
  samples: readonly ProbeControlledSampleResultV1[],
): readonly ProbeHopLatencySummaryV1[] {
  const cohorts = new Map<
    string,
    {
      readonly cohort: ProbeCohortKeyV1;
      readonly measurements: ProbeMeasurement[];
    }
  >();
  for (const controlled of samples) {
    const sample = controlled.sample;
    const traceValid = validateProbeTraceV1(sample).ok;
    for (const [spanName] of PROBE_SCENARIO_TOPOLOGY[sample.scenario]) {
      const cohort = cohortKey(controlled, spanName);
      const serialized = serializeCohortKey(cohort);
      const existing = cohorts.get(serialized);
      const bucket = existing ?? { cohort, measurements: [] };
      bucket.measurements.push(
        traceValid
          ? spanMeasurement(sample, spanName)
          : { kind: "failure" },
      );
      if (existing === undefined) cohorts.set(serialized, bucket);
    }
  }
  return [...cohorts.entries()]
    .sort(([left], [right]) => compareUtf16Strings(left, right))
    .map(([, cohort]) => ({
      cohort: cohort.cohort,
      latency: summarizeProbeMeasurements(cohort.measurements),
    }));
}

function spanMeasurement(
  sample: ProbeControlledSampleResultV1["sample"],
  spanName: ProbeSpanName,
): ProbeMeasurement {
  const span = sample.spans.find(candidate => candidate.name === spanName);
  return span === undefined || span.outcome.kind === "error"
    ? { kind: "failure" }
    : { kind: "success", durationMs: span.durationMs };
}

function cohortKey(
  controlled: ProbeControlledSampleResultV1,
  spanName: ProbeSpanName,
): ProbeCohortKeyV1 {
  const sample = controlled.sample;
  return {
    scenario: sample.scenario,
    spanName,
    codeMode: sample.dimensions.codeMode,
    sessionMode: sample.dimensions.sessionMode,
    configuredConcurrency: controlled.control.configuredConcurrency,
    observedOutstandingClaims:
      controlled.control.observedOutstandingClaims,
    phase: controlled.control.phase,
    measurementDisposition: controlled.control.measurementDisposition,
    journalEntries: sample.dimensions.journalEntries,
    payloadBytes: sample.dimensions.payloadBytes,
    edgeColo: sample.edgeColo,
    workerLoaderCallback: sample.startup.workerLoader,
    facetStartupCallback: sample.startup.facet,
  };
}

function serializeCohortKey(cohort: ProbeCohortKeyV1): string {
  return JSON.stringify([
    cohort.scenario,
    cohort.spanName,
    cohort.codeMode,
    cohort.sessionMode,
    cohort.configuredConcurrency,
    cohort.observedOutstandingClaims,
    cohort.phase,
    cohort.measurementDisposition,
    cohort.journalEntries,
    cohort.payloadBytes,
    cohort.edgeColo,
    cohort.workerLoaderCallback,
    cohort.facetStartupCallback,
  ]);
}

import type {
  ProbeCallbackObservation,
  ProbeDurationMs,
  ProbeScenario,
  ProbeSessionMode,
  ProbeSpanName,
} from "./protocol";
import type {
  ProbeControlledSampleResultV1,
  ProbeMeasurementDisposition,
} from "./runtimeProtocol";
import {
  PROBE_SCENARIO_TOPOLOGY,
  validateProbeTraceV1,
} from "./trace";
import type { ProbeCodeMode } from "./identity";

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

export interface ProbeLatencySummaryV1 {
  readonly count: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly minMs: ProbeDurationMs | null;
  readonly medianMs: ProbeDurationMs | null;
  readonly p95Ms: ProbeDurationMs | null;
  readonly p99Ms: ProbeDurationMs | null;
  readonly maxMs: ProbeDurationMs | null;
}

export interface ProbeCohortKeyV1 {
  readonly scenario: ProbeScenario;
  readonly spanName: ProbeSpanName;
  readonly codeMode: ProbeCodeMode;
  readonly sessionMode: ProbeSessionMode;
  readonly configuredConcurrency: number;
  readonly observedOutstandingClaims: number;
  readonly phase: ProbeControlledSampleResultV1["control"]["phase"];
  readonly measurementDisposition: ProbeMeasurementDisposition;
  readonly journalEntries: number;
  readonly payloadBytes: number;
  readonly edgeColo: string | null;
  readonly workerLoaderCallback: ProbeCallbackObservation;
  readonly facetStartupCallback: ProbeCallbackObservation;
}

export interface ProbeHopLatencySummaryV1 {
  readonly cohort: ProbeCohortKeyV1;
  readonly latency: ProbeLatencySummaryV1;
}

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
    .sort(([left], [right]) => left.localeCompare(right))
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

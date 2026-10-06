import type { PointCommitPublicationEvent, PointCommitPublicationPhase } from
  "@flarex/persistence-postgres/point-commit-transaction";
import type { TraceFingerprintOwner, TraceInvocationRecord } from "../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import type { PerformanceSettlementLedger } from "./mixedMutationPerformanceReport";
import type { admitPublicationServerLogCopies, PublicationPerformanceServer } from "./publicationPerformanceServer";
import type { readRetrievalRuntimeSettings } from
  "../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server";

export type PublicationProfile = "product" | "productPayload" | "workflow";
export type PublicationObservationMode = "boundaryOnly" | "detailed";
export interface PublicationRuntimeSettingsRecord {
  readonly profile: PublicationProfile;
  readonly control: Awaited<ReturnType<typeof readRetrievalRuntimeSettings>>;
  readonly target: Awaited<ReturnType<typeof readRetrievalRuntimeSettings>>;
  readonly poolMax: Readonly<{ control: number | undefined; target: number | undefined }>;
}
export interface PublicationCompactServerRecord {
  readonly id: string;
  readonly profile: PublicationProfile;
  readonly observation: ReturnType<PublicationPerformanceServer["compact"]>;
}
export interface PublicationLogCaptureAccounting {
  appendBytes?: number; freeBytesBefore?: number; originalBufferByteBound?: number;
  memoryBefore?: NodeJS.MemoryUsage; peakMemoryCoverage?: string;
  selectedBytes?: number; admission?: ReturnType<typeof admitPublicationServerLogCopies>;
  afterRead?: NodeJS.MemoryUsage; afterFilter?: NodeJS.MemoryUsage;
  sampledRssPeakBytes?: number; readAndFilterMs?: number; copyMs?: number;
  copiedBytes?: number; freeBytesAfter?: number; captureMs?: number;
}
export interface PublicationInterval {
  readonly phase: string;
  readonly startMs: number;
  readonly endMs: number;
}
export interface PublicationTimedEvent {
  readonly atMs: number;
  readonly event: PointCommitPublicationEvent;
}

/** Sample-level union, preserving overlapping source intervals in the raw report. */
export function publicationIntervalUnion(intervals: readonly PublicationInterval[]): number {
  const sorted = intervals.map(interval => ({ ...interval })).sort((a, b) => a.startMs - b.startMs);
  let end = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const interval of sorted) {
    if (!Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs) || interval.endMs < interval.startMs)
      throw new Error("Invalid publication timing interval");
    total += Math.max(0, interval.endMs - Math.max(end, interval.startMs));
    end = Math.max(end, interval.endMs);
  }
  return total;
}

export function publicationPhaseIntervals(events: readonly PublicationTimedEvent[]) {
  const opened = new Map<PointCommitPublicationPhase, number[]>();
  const intervals: PublicationInterval[] = [];
  let unmatchedEdges = 0;
  for (const timed of events) {
    if (timed.event.kind !== "phase") continue;
    const phase = timed.event.phase;
    const stack = opened.get(phase) ?? [];
    if (timed.event.edge === "begin") {
      stack.push(timed.atMs); opened.set(phase, stack);
    } else {
      const startMs = stack.pop();
      if (startMs === undefined || timed.atMs < startMs) unmatchedEdges++;
      else intervals.push({ phase, startMs, endMs: timed.atMs });
    }
  }
  for (const stack of opened.values()) unmatchedEdges += stack.length;
  return { intervals, unmatchedEdges };
}

export function publicationPhaseSummary(intervals: readonly PublicationInterval[]) {
  const names = [...new Set(intervals.map(interval => interval.phase))];
  return names.map(phase => {
    const selected = intervals.filter(interval => interval.phase === phase);
    return { phase, intervals: selected.length, unionMs: publicationIntervalUnion(selected) };
  });
}

/** Overlap is attribution to an observed region, not a reconstructed stack or
 * additive server cost. All original dispatches remain visible, including those
 * outside publication and outside the explicit target transaction. */
export function correlatePublicationDispatches(trace: TraceInvocationRecord,
  traceOriginMs: number, intervals: readonly PublicationInterval[]) {
  return trace.dispatches.map((dispatch, ordinal) => {
    const startMs = traceOriginMs + dispatch.atMs;
    const endMs = dispatch.awaitedMs === null ? null : startMs + dispatch.awaitedMs;
    const overlaps = endMs === null ? [] : intervals.filter(interval =>
      interval.startMs < endMs && interval.endMs > startMs).map(interval => ({
        phase: interval.phase,
        overlapMs: Math.min(endMs, interval.endMs) - Math.max(startMs, interval.startMs),
        containing: interval.startMs <= startMs && interval.endMs >= endMs,
      }));
    return { ordinal: ordinal + 1, ...dispatch, startMs, endMs, overlaps };
  });
}

export function publicationDistribution(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  const lower = sorted[Math.max(0, middle - 1)];
  if (upper === undefined || lower === undefined) throw new Error("Invalid publication distribution");
  return { count: sorted.length, median: sorted.length % 2 === 0 ? (lower + upper) / 2 : upper,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)], min: sorted[0], max: sorted.at(-1) };
}

export interface PublicationPerformanceSample {
  readonly id: string;
  readonly profile: PublicationProfile;
  readonly mode: PublicationObservationMode;
  readonly pair: number;
  readonly warmup: boolean;
  readonly order: number;
  readonly wallMs: number | null;
  readonly preparationMs: number;
  readonly evidenceMs: number;
  readonly traceFinalizationMs: number;
  readonly status: "ok" | "businessFailure" | "invalidObservation";
  readonly businessStatus: "published" | "failedOrUncertain" | "notStarted";
  readonly failure: Readonly<{ name: string; code: string | null; reason: string | null }> | null;
  readonly observationFailures: number;
  readonly cleanupFailures: readonly Readonly<{ name: string; code: string | null; reason: string | null }>[];
  readonly unmatchedEdges: number;
  readonly canonicalResultBytes: number | null;
  readonly workerConstructionMs: number | null;
  readonly intervals: readonly PublicationInterval[];
  readonly phases: ReturnType<typeof publicationPhaseSummary>;
  readonly events: readonly PublicationTimedEvent[];
  readonly trace: TraceInvocationRecord | null;
  readonly fingerprintOwners: readonly TraceFingerprintOwner[];
  readonly dispatchAttribution: ReturnType<typeof correlatePublicationDispatches> | null;
  readonly settlementLedger: PerformanceSettlementLedger | null;
  readonly unavailable: readonly string[];
}

/** The final-cap path retains known metadata, never full query snapshots or
 * fabricated replacement measurements. This projection is an invalid receipt. */
export function publicationFinalCapFailureReceipt(input: Readonly<{
  report: PublicationPerformanceReport; rawBytesWritten: number; finalRawBytes: number;
  safeRuntimeSettings: readonly PublicationRuntimeSettingsRecord[];
  compactServerWindows: readonly PublicationCompactServerRecord[];
  safeLogAccounting: Readonly<{ logStart: number | null; logEnd: number | null; appendBytes: number | null;
    originalLogCaptured: boolean; selectedLogCaptured: boolean; logCaptureAccounting: PublicationLogCaptureAccounting;
    filteredCoverage: Readonly<{ recognizedHeaders: number; excludedHeaders: number; unrecognizedLines: number;
      coverage: string }> | string | undefined }>;
  spentWork: Readonly<{ directoryCreationMs: number; sourceHashStartMs: number; sourceHashEndMs: number;
    finalSerializationMs: number; artifactTimings: readonly Readonly<{ id: string; bytes: number;
      serializationAndWriteMs: number }>[]; runElapsedMs: number;
    diagnosticSecondaryFailures: readonly NonNullable<PublicationPerformanceSample["failure"]>[];
    failure: PublicationPerformanceSample["failure"] }>;
}>) {
  const report = input.report;
  return { format: "flarex.publication-attribution-cap-refusal", complete: false,
    reason: "finalArtifactByteCap", planned: report.planned,
    samples: report.samples.map(sample => ({ id: sample.id, profile: sample.profile,
      mode: sample.mode, pair: sample.pair, warmup: sample.warmup, order: sample.order,
      status: sample.status, businessStatus: sample.businessStatus, failure: sample.failure,
      observationFailures: sample.observationFailures, unmatchedEdges: sample.unmatchedEdges,
      cleanupFailures: sample.cleanupFailures, wallMs: sample.wallMs, preparationMs: sample.preparationMs,
      evidenceMs: sample.evidenceMs, traceFinalizationMs: sample.traceFinalizationMs })),
    rawBytesWritten: input.rawBytesWritten, finalRawBytes: input.finalRawBytes,
    combinedRawBytes: input.rawBytesWritten + input.finalRawBytes,
    sourceStable: report.sourceStable, sourceHashesStart: report.sourceHashesStart,
    sourceHashesEnd: report.sourceHashesEnd, runtimeSettings: input.safeRuntimeSettings,
    serverWindows: input.compactServerWindows, logAccounting: input.safeLogAccounting,
    spentWork: input.spentWork,
    unavailable: ["fullFinalReport", "fullServerQuerySnapshots", "successfulFinalizationReceipt",
      "completeServerAttribution", "receiptOwnWriteDuration"] };
}

export interface PublicationPerformanceReport {
  readonly format: "flarex.publication-attribution";
  readonly planned: Readonly<{ profiles: readonly PublicationProfile[]; warmupPairs: 1;
    retainedPairs: 1 | 5; attemptCap: 6 | 36; timeoutMs: 900000 | 1800000;
    rawByteCap: 262144000; reportByteCap: 52428800; serverLogByteCap: 536870912 }>;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly sourceHashesStart: Readonly<Record<string, string>>;
  readonly sourceHashesEnd: Readonly<Record<string, string>>;
  readonly sourceStable: boolean;
  readonly complete: boolean;
  readonly serverDiagnostics?: unknown;
  readonly samples: readonly PublicationPerformanceSample[];
  readonly setup: readonly Readonly<{ profile: PublicationProfile; provisioningMs: number;
    preparedModuleMs: number; initialSeedingMs: number; additionalSetupSeedingMs: number;
    completeSetupMs: number }>[];
}

export function renderPublicationPerformanceReport(report: PublicationPerformanceReport): string {
  const lines = ["# Publication Attribution", "", `Complete: ${report.complete}; source stable: ${report.sourceStable}.`, "",
    `Planned attempts: ${report.planned.attemptCap}; attempted: ${report.samples.length}; business failures: ${report.samples.filter(sample => sample.status === "businessFailure").length}; invalid observations: ${report.samples.filter(sample => sample.status === "invalidObservation").length}. All attempted samples remain in original order, including warmups and failures.`, "",
    "Boundary-only includes owner phase timing. Detailed includes scalar demands and SQL tracing; neither is fully uninstrumented.", "",
    "| Profile | Mode | Retained samples | Complete attempt median / P95 ms |",
    "| --- | --- | ---: | --- |"];
  for (const profile of report.planned.profiles) {
    for (const mode of ["boundaryOnly", "detailed"] as const) {
      const selected = report.samples.filter(sample => sample.profile === profile && sample.mode === mode &&
        !sample.warmup && sample.status === "ok");
      const distribution = publicationDistribution(selected.flatMap(sample => sample.wallMs === null ? [] : [sample.wallMs]));
      lines.push(`| ${profile} | ${mode} | ${selected.length} | ${distribution === null ? "unavailable" :
        `${distribution.median.toFixed(3)} / ${distribution.p95?.toFixed(3)}`} |`);
    }
  }
  lines.push("", "## Owner component intervals", "",
    "| Profile | Mode | Owner region | Sample union median / P95 ms |",
    "| --- | --- | --- | --- |");
  for (const profile of report.planned.profiles) {
    for (const mode of ["boundaryOnly", "detailed"] as const) {
      const selected = report.samples.filter(sample => sample.profile === profile && sample.mode === mode &&
        !sample.warmup && sample.status === "ok");
      for (const phase of new Set(selected.flatMap(sample => sample.phases.map(region => region.phase)))) {
        const values = selected.flatMap(sample => sample.phases.filter(region => region.phase === phase).map(region => region.unionMs));
        const distribution = publicationDistribution(values);
        if (distribution !== null) lines.push(`| ${profile} | ${mode} | ${phase} | ${distribution.median.toFixed(3)} / ${distribution.p95?.toFixed(3)} |`);
      }
    }
  }
  lines.push("", "## Paired complete-attempt observation difference", "",
    "These are sample-level detailed minus boundary-only differences for alternating pairs. They include real workload variation and diagnostic work; they are not a pure instrumentation cost.", "",
    "| Profile | Matched retained pairs | Difference median / P95 ms |", "| --- | ---: | --- |");
  for (const profile of report.planned.profiles) {
    const differences: number[] = [];
    for (let pair = 1; pair <= report.planned.retainedPairs; pair++) {
      const quiet = report.samples.find(sample => sample.profile === profile && sample.pair === pair && sample.mode === "boundaryOnly" && sample.status === "ok");
      const detail = report.samples.find(sample => sample.profile === profile && sample.pair === pair && sample.mode === "detailed" && sample.status === "ok");
      if (quiet !== undefined && detail !== undefined && quiet.wallMs !== null && detail.wallMs !== null)
        differences.push(detail.wallMs - quiet.wallMs);
    }
    const distribution = publicationDistribution(differences);
    lines.push(`| ${profile} | ${differences.length} | ${distribution === null ? "unavailable" : `${distribution.median.toFixed(3)} / ${distribution.p95?.toFixed(3)}`} |`);
  }
  lines.push("", "## Paired publisher observation difference", "",
    "The genuine outer publisher region includes child gaps. It is distinct from fixture authoritative publication, which can include executor handoff work. Differences and ratios below are formed within each matched retained pair before computing distributions; child percentiles are never summed.", "",
    "| Profile | Matched publisher pairs | Difference median / P95 ms | Detailed / boundary ratio median / P95 |",
    "| --- | ---: | --- | --- |");
  for (const profile of report.planned.profiles) {
    const differences: number[] = [], ratios: number[] = [];
    for (let pair = 1; pair <= report.planned.retainedPairs; pair++) {
      const quiet = report.samples.find(sample => sample.profile === profile && sample.pair === pair && sample.mode === "boundaryOnly" && sample.status === "ok");
      const detail = report.samples.find(sample => sample.profile === profile && sample.pair === pair && sample.mode === "detailed" && sample.status === "ok");
      const quietMs = quiet?.phases.find(phase => phase.phase === "publisher")?.unionMs;
      const detailedMs = detail?.phases.find(phase => phase.phase === "publisher")?.unionMs;
      if (quietMs !== undefined && detailedMs !== undefined && quietMs > 0) {
        differences.push(detailedMs - quietMs); ratios.push(detailedMs / quietMs);
      }
    }
    const delta = publicationDistribution(differences), ratio = publicationDistribution(ratios);
    lines.push(`| ${profile} | ${differences.length} | ${delta === null ? "unavailable" : `${delta.median.toFixed(3)} / ${delta.p95?.toFixed(3)}`} | ${ratio === null ? "unavailable" : `${ratio.median.toFixed(3)} / ${ratio.p95?.toFixed(3)}`} |`);
  }
  lines.push("", "Per-sample raw owner intervals retain overlap and SQL intersections. Phase unions are computed within each sample; percentiles are never added or subtracted.", "",
    "Original demands and actual batch observations are distinct from net committed effects. Counts and batch events describe separate levels; do not sum them. Writes are provisional until real COMMIT. Server diagnostics, when present, remain a separate charged lane with partial nested coverage; CPU and lock costs remain unavailable.", "",
    "Failed samples remain in original order. Complete-attempt timings include request admission, Worker execution, local freeze, final publication and fixture cleanup; setup is separate.", "");
  return lines.join("\n");
}

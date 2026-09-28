export type PerformanceWorkload = "product" | "productPayload" | "mixedWorkflow" | "standaloneWorkflow";
export type PerformanceTemperature = "warmup" | "warm" | "cold" | "probe";

export interface PerformanceInventory {
  readonly rowCurrent: number;
  readonly indexCurrent: number;
  readonly commits: number;
  readonly events: number;
  readonly journals: number;
  /** Remaining live journal bytes at the sampled frontier, not bytes produced by this attempt. */
  readonly liveJournalBytes: number | null;
}

export interface PerformancePhase {
  readonly path: string;
  readonly inclusiveMs: number;
  readonly exclusiveMs: number;
  readonly complete: boolean;
}

export interface PerformanceSqlGroup {
  readonly pool: "control" | "target";
  readonly phase: string;
  readonly fingerprint: string | null;
  readonly owner: string | null;
  readonly ownerStatus: "single" | "ambiguous" | "unattributed";
  readonly dispatches: number;
  /** Known statement count; unknown dispatches are tracked separately. */
  readonly statements: number;
  readonly unknownStatementDispatches: number;
  readonly queryErrors: number;
  readonly awaitedMs: number;
}

export interface PerformanceTraceSummary {
  readonly durationMs: number;
  readonly dispatches: number;
  readonly knownStatements: number;
  readonly unknownStatementDispatches: number;
  readonly queryErrors: number;
  readonly unobservedDispatches: number;
  readonly lostContextDispatches: number;
  readonly poolQueryCalls: number;
  readonly delegatedPoolQueryDispatches: number;
  readonly checkoutMs: number;
  readonly checkoutGroups: readonly Readonly<{ pool: "control" | "target"; phase: string;
    count: number; awaitedMs: number; errorCount: number }>[];
  readonly transactionGroups: readonly Readonly<{ pool: "control" | "target"; phase: string;
    outcome: "commit" | "rollback" | "commit-error" | "rollback-error" | "open-at-end";
    count: number; durationMs: number; minMs: number; maxMs: number }>[];
  readonly awaitedDispatchMs: number;
  /** Union of observed awaited intervals, not a reconstructed server critical path. */
  readonly awaitedDispatchUnionMs: number | null;
  readonly incompleteSpans: number;
  readonly phases: readonly PerformancePhase[];
  readonly sqlGroups: readonly PerformanceSqlGroup[];
}

export interface PerformanceSample {
  readonly id: string;
  readonly workload: PerformanceWorkload;
  readonly temperature: PerformanceTemperature;
  readonly index: number;
  readonly status: "ok" | "error";
  readonly failureName: string | null;
  readonly failureStage: string | null;
  readonly failureCode: string | null;
  readonly failureReason: string | null;
  /** Fixed known tokens observed in the native Worker error, never raw messages or SQL. */
  readonly failureDiagnosticTokens: readonly string[];
  /** Named secondary profiler failures, while failureName/code retain the request's primary cause. */
  readonly cpuDiagnosticSecondaryFailures?: readonly Readonly<{ stage: string; name: string }>[];
  readonly wallMs: number | null;
  readonly requestWorkerConstructionMs: number | null;
  /** Encoded canonical journal bytes captured at a successful seal through the test store port. */
  readonly sealedJournalBytes: number | null;
  /** Outer envelope minus the trace's inner request duration; includes trace finalization. */
  readonly instrumentationFinalizationMs: number | null;
  /** Reusable host construction and seeding are outside the request; fresh admission is inside it. */
  readonly construction: Readonly<{
    setupTotalMs: number | null;
    provisioningMs: number | null;
    preparedModuleMs: number | null;
    initialSeedingMs: number | null;
    additionalSetupSeedingMs: number | null;
    standaloneRuntimeConstructionMs: number | null;
    seedingMs: number | null;
  }>;
  readonly inventoryBefore: PerformanceInventory | null;
  readonly inventoryAfter: PerformanceInventory | null;
  readonly trace: PerformanceTraceSummary | null;
}

export interface PerformanceRawReport {
  readonly format: "flarex.mixed-mutation-performance";
  readonly revision: string;
  readonly workingDiffSha256: string;
  readonly mode: "smoke" | "full";
  readonly observationMode: "traced" | "untraced";
  readonly diagnostic?: Readonly<{ kind: "node-inspector-cpu"; latencyAcceptance: false }>;
  readonly planned: Readonly<{ warmups: number; warm: number; cold: number }>;
  readonly plannedWorkloads: readonly PerformanceWorkload[];
  readonly environment: Readonly<Record<string, unknown>>;
  readonly interpretation: readonly string[];
  readonly unavailable: readonly string[];
  readonly sqlTemplates: readonly Readonly<{ fingerprint: string; template: string }>[];
  readonly setupFailures: readonly Readonly<{ id: string; stage: string; name: string;
    code: string | null; reason: string | null }>[];
  readonly ownerMappings: readonly Readonly<{ seriesId: string; fingerprint: string; phase: string;
    pool: "control" | "target"; status: "single" | "ambiguous" | "unattributed";
    owner: string | null; observedDispatches: number;
    sourceSites: readonly Readonly<{ siteId: string; owner: string | null;
      sourceFrames: readonly string[]; dispatchCount: number }>[] }> [];
  readonly samples: readonly PerformanceSample[];
}

function spanPath(span: TracePhaseSpan, byId: ReadonlyMap<number, TracePhaseSpan>): string {
  const names = [span.name];
  let parent = span.parentId;
  while (parent !== null) {
    const preceding = byId.get(parent);
    if (preceding === undefined) throw new Error("Trace span has an unknown parent");
    names.unshift(preceding.name);
    parent = preceding.parentId;
  }
  return names.join(" / ");
}

/** Project the bounded driver trace into the durable, parameter-free sample record. */
export function summarizeMixedMutationTrace(record: TraceInvocationRecord,
  mappings: readonly TraceFingerprintOwner[]): PerformanceTraceSummary {
  if (record.unobservedDispatches !== 0 || record.lostContextDispatches !== 0 ||
    record.incompleteSpans !== 0 ||
    record.poolQueryCalls !== record.delegatedPoolQueryDispatches)
    throw new Error("Mixed mutation SQL trace coverage is incomplete");
  const dispatches = record.dispatchGroups.reduce((sum, group) => sum + group.dispatchCount, 0);
  const unknown = record.dispatchGroups.reduce((sum, group) => sum + group.unknownStatementDispatches, 0);
  if (unknown !== record.unknownStatementDispatches)
    throw new Error("Mixed mutation SQL trace statement counts disagree");
  const byId = new Map(record.spans.map(span => [span.id, span]));
  return {
    durationMs: record.durationMs,
    dispatches,
    knownStatements: record.dispatchGroups.reduce((sum, group) => sum + group.statementCount, 0),
    unknownStatementDispatches: record.unknownStatementDispatches,
    queryErrors: record.dispatchGroups.reduce((sum, group) => sum + group.errorCount, 0),
    unobservedDispatches: record.unobservedDispatches,
    lostContextDispatches: record.lostContextDispatches,
    poolQueryCalls: record.poolQueryCalls,
    delegatedPoolQueryDispatches: record.delegatedPoolQueryDispatches,
    checkoutMs: record.checkoutGroups.reduce((sum, group) => sum + group.awaitedMsSum, 0),
    checkoutGroups: record.checkoutGroups.map(group => ({ pool: group.pool,
      phase: group.phasePath.join(" / "), count: group.checkoutCount,
      awaitedMs: group.awaitedMsSum, errorCount: group.errorCount })),
    transactionGroups: record.transactionGroups.map(group => ({ pool: group.pool,
      phase: group.phasePath.join(" / "), outcome: group.outcome,
      count: group.intervalCount, durationMs: group.durationMsSum,
      minMs: group.durationMsMin, maxMs: group.durationMsMax })),
    awaitedDispatchMs: record.dispatchGroups.reduce((sum, group) => sum + group.awaitedMsSum, 0),
    awaitedDispatchUnionMs: record.dispatchAwaitedUnionMs,
    incompleteSpans: record.incompleteSpans,
    phases: record.spans.map(span => ({ path: spanPath(span, byId),
      inclusiveMs: span.inclusiveMs, exclusiveMs: span.exclusiveMs, complete: span.complete })),
    sqlGroups: record.dispatchGroups.map(group => {
      const mapping = group.fingerprint === null ? undefined : mappings.find(candidate =>
        candidate.pool === group.pool && candidate.fingerprint === group.fingerprint &&
        candidate.phasePath.join("/") === group.phasePath.join("/"));
      return { pool: group.pool, phase: group.phasePath.join(" / "),
        fingerprint: group.fingerprint, owner: mapping?.owner ?? null,
        ownerStatus: mapping?.status ?? "unattributed",
        dispatches: group.dispatchCount, statements: group.statementCount,
        unknownStatementDispatches: group.unknownStatementDispatches,
        queryErrors: group.errorCount,
        awaitedMs: group.awaitedMsSum };
    }),
  };
}

function distribution(values: readonly number[]): Readonly<{
  n: number; median: number | null; min: number | null; max: number | null; p95: number | null;
}> {
  const sorted = values.toSorted((left, right) => left - right);
  if (sorted.length === 0) return { n: 0, median: null, min: null, max: null, p95: null };
  const middle = Math.floor(sorted.length / 2);
  return { n: sorted.length,
    median: sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
    min: sorted[0]!, max: sorted.at(-1)!,
    p95: sorted.length === 20 ? sorted[Math.ceil(0.95 * sorted.length) - 1]! : null };
}

const shown = (value: number | null) => value === null ? "unavailable" : value.toFixed(1);

/** A descriptive report only: nested phase and SQL wait totals are not added to wall time. */
export function renderMixedMutationPerformanceReport(raw: PerformanceRawReport): string {
  const lines = [
    raw.diagnostic === undefined ? "# Private mixed mutation performance baseline"
      : "# Private mixed mutation Node CPU diagnostic — excluded from latency acceptance",
    "",
    `Revision: \`${raw.revision}\`; working diff SHA-256: \`${raw.workingDiffSha256}\`; mode: **${raw.mode}**, observation: **${raw.observationMode}**.`,
    `Plan: ${raw.planned.warmups} warmups, ${raw.planned.warm} measured warm samples, ${raw.planned.cold} cold samples per workload.`,
    ...(raw.diagnostic === undefined ? [] : [
      "Node Inspector samples the current Node isolate and adds observer overhead. The profile window includes profiler start/stop sampling outside the request wall; separate Workerd CPU, allocation accounting and async waits are unavailable. This diagnostic is not a latency distribution or acceptance run.",
    ]),
    "",
    raw.observationMode === "traced"
      ? "The request interval starts before fresh admission and ends after authoritative publication and retained-outcome resolution. The outer invocation wall envelope includes trace finalization, which is reported separately. SQL awaited time includes driver and database wait; it is not server execution time. Nested phases and overlapping query waits are non-additive. The standalone graph has fewer root obligations, so its latency delta does not isolate framework overhead. No native ORM parity or hosted transport claim is made."
      : "The outer invocation wall interval uses the same workload boundaries, from before fresh admission through authoritative publication and retained-outcome resolution. No SQL or phase observer is installed, so request trace spans, dispatches, awaits, transaction intervals and trace finalization are unavailable. The standalone graph has fewer root obligations; no native ORM parity or hosted transport claim is made.",
    "",
    "## Environment",
    "",
    "```json",
    JSON.stringify(raw.environment, null, 2),
    "```",
    "",
    "## Sample distributions",
    "",
    "| Workload | Series | Successful / observed | Request median (ms) | Range (ms) | Descriptive p95 (ms) | Outer invocation wall median (ms) | Outer range (ms) | Outer descriptive p95 (ms) | Fresh Worker startup median (ms) | Trace finalization median (ms) | Dispatch median | Known statement median | Awaited DB median (ms) | DB wait interval union median (ms) |",
    "| --- | --- | ---: | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  const workloads = raw.plannedWorkloads;
  for (const workload of workloads) for (const temperature of ["warm", "cold"] as const) {
    const observed = raw.samples.filter(sample => sample.workload === workload && sample.temperature === temperature);
    const good = observed.filter(sample => sample.status === "ok" && sample.wallMs !== null &&
      (raw.observationMode === "untraced" || sample.trace !== null));
    const wall = distribution(good.flatMap(sample => sample.trace === null ? [] : [sample.trace.durationMs]));
    const outerWall = distribution(good.flatMap(sample => sample.wallMs === null ? [] : [sample.wallMs]));
    const workerStartup = distribution(good.flatMap(sample => sample.requestWorkerConstructionMs === null
      ? [] : [sample.requestWorkerConstructionMs]));
    const finalization = distribution(good.flatMap(sample => sample.instrumentationFinalizationMs === null
      ? [] : [sample.instrumentationFinalizationMs]));
    const dispatch = distribution(good.flatMap(sample => sample.trace === null ? [] : [sample.trace.dispatches]));
    const statements = distribution(good.flatMap(sample => sample.trace === null ? [] : [sample.trace.knownStatements]));
    const awaited = distribution(good.flatMap(sample => sample.trace === null ? [] : [sample.trace.awaitedDispatchMs]));
    const sequential = distribution(good.flatMap(sample => sample.trace?.awaitedDispatchUnionMs == null
      ? [] : [sample.trace.awaitedDispatchUnionMs]));
    lines.push(`| ${workload} | ${temperature} | ${good.length}/${observed.length} | ${shown(wall.median)} | ` +
      `${shown(wall.min)}–${shown(wall.max)} | ${shown(wall.p95)} | ${shown(outerWall.median)} | ` +
      `${shown(outerWall.min)}–${shown(outerWall.max)} | ${shown(outerWall.p95)} | ${shown(workerStartup.median)} | ` +
      `${shown(finalization.median)} | ${shown(dispatch.median)} | ` +
      `${shown(statements.median)} | ${shown(awaited.median)} | ${shown(sequential.median)} |`);
  }
  lines.push("", "## Series construction outside each request", "",
    "| Workload | Series | Provisioning and installation (ms) | Prepared modules (ms) | Initial seeding (ms) | Further setup seeding (ms) | Standalone runtime construction (ms) | Total setup (ms) |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const sample of raw.samples.filter(sample => sample.construction.setupTotalMs !== null)) {
    const setup = sample.construction;
    lines.push(`| ${sample.workload} | ${sample.id} | ${shown(setup.provisioningMs)} | ` +
      `${shown(setup.preparedModuleMs)} | ${shown(setup.initialSeedingMs)} | ` +
      `${shown(setup.additionalSetupSeedingMs)} | ${shown(setup.standaloneRuntimeConstructionMs)} | ` +
      `${shown(setup.setupTotalMs)} |`);
  }
  lines.push("", "## Retained state growth per successful warm request", "",
    "| Workload | Rows Δ median | Index entries Δ median | Commits Δ median | Events Δ median | Live journal rows Δ median | Sealed attempt bytes median | Live journal bytes Δ median |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const workload of workloads) {
    const completed = raw.samples.filter(sample => sample.workload === workload &&
      sample.temperature === "warm" && sample.status === "ok" &&
      sample.inventoryBefore !== null && sample.inventoryAfter !== null);
    const delta = (select: (inventory: PerformanceInventory) => number | null) =>
      distribution(completed.flatMap(sample => {
        if (sample.inventoryBefore === null || sample.inventoryAfter === null) return [];
        const before = select(sample.inventoryBefore);
        const after = select(sample.inventoryAfter);
        return before === null || after === null ? [] : [after - before];
      })).median;
    lines.push(`| ${workload} | ${shown(delta(value => value.rowCurrent))} | ` +
      `${shown(delta(value => value.indexCurrent))} | ${shown(delta(value => value.commits))} | ` +
      `${shown(delta(value => value.events))} | ${shown(delta(value => value.journals))} | ` +
      `${shown(distribution(completed.flatMap(sample => sample.sealedJournalBytes === null
        ? [] : [sample.sealedJournalBytes])).median)} | ` +
      `${shown(delta(value => value.liveJournalBytes))} |`);
  }
  lines.push("", "## Observed database transaction intervals in successful warm requests", "",
    "These BEGIN-to-settlement intervals include application work and waits; they are not lock-hold measurements.", "",
    "| Workload | Pool | Phase | Outcome | Intervals | Duration total (ms) | Range (ms) |",
    "| --- | --- | --- | --- | ---: | ---: | --- |");
  const transactionTotals = new Map<string, { workload: PerformanceWorkload; pool: string;
    phase: string; outcome: string; count: number; durationMs: number; minMs: number; maxMs: number }>();
  for (const sample of raw.samples) {
    if (sample.temperature !== "warm" || sample.status !== "ok") continue;
    for (const group of sample.trace?.transactionGroups ?? []) {
      const key = `${sample.workload}:${group.pool}:${group.phase}:${group.outcome}`;
      const current = transactionTotals.get(key) ?? { workload: sample.workload,
        pool: group.pool, phase: group.phase, outcome: group.outcome,
        count: 0, durationMs: 0, minMs: Number.POSITIVE_INFINITY, maxMs: 0 };
      current.count += group.count;
      current.durationMs += group.durationMs;
      current.minMs = Math.min(current.minMs, group.minMs);
      current.maxMs = Math.max(current.maxMs, group.maxMs);
      transactionTotals.set(key, current);
    }
  }
  for (const row of [...transactionTotals.values()].toSorted((left, right) => right.durationMs - left.durationMs)) {
    lines.push(`| ${row.workload} | ${row.pool} | ${row.phase} | ${row.outcome} | ${row.count} | ` +
      `${shown(row.durationMs)} | ${shown(row.minMs)}–${shown(row.maxMs)} |`);
  }
  lines.push("", "## Ranked SQL owners in successful warm samples", "",
    "| Workload | Owner | Pool | Phase | Dispatches | Known statements | Unknown statements | Awaited total (ms) |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: |");
  const byOwner = new Map<string, { workload: PerformanceWorkload; owner: string; pool: string; phase: string; dispatches: number;
    statements: number; unknown: number; awaitedMs: number }>();
  for (const sample of raw.samples) {
    if (sample.temperature !== "warm" || sample.status !== "ok") continue;
    for (const group of sample.trace?.sqlGroups ?? []) {
      const owner = group.owner ?? group.ownerStatus;
      const key = `${sample.workload}:${group.pool}:${group.phase}:${owner}`;
      const current = byOwner.get(key) ?? { workload: sample.workload,
        owner, pool: group.pool, phase: group.phase, dispatches: 0,
        statements: 0, unknown: 0, awaitedMs: 0 };
      current.dispatches += group.dispatches;
      current.statements += group.statements;
      current.unknown += group.unknownStatementDispatches;
      current.awaitedMs += group.awaitedMs;
      byOwner.set(key, current);
    }
  }
  for (const row of [...byOwner.values()].toSorted((left, right) => right.awaitedMs - left.awaitedMs)) {
    lines.push(`| ${row.workload} | ${row.owner} | ${row.pool} | ${row.phase} | ${row.dispatches} | ${row.statements} | ${row.unknown} | ${shown(row.awaitedMs)} |`);
  }
  lines.push("", "## Ranked SQL fingerprints in successful warm samples", "",
    "| Workload | Fingerprint | Owner | Pool | Phase | Dispatches | Known statements | Unknown dispatches | Awaited total (ms) | Template excerpt |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |");
  const byFingerprint = new Map<string, { workload: PerformanceWorkload; fingerprint: string; owner: string; pool: string;
    phase: string; dispatches: number; statements: number; unknown: number; awaitedMs: number }>();
  for (const sample of raw.samples) {
    if (sample.temperature !== "warm" || sample.status !== "ok") continue;
    for (const group of sample.trace?.sqlGroups ?? []) {
      const fingerprint = group.fingerprint ?? "unclassified";
      const key = `${sample.workload}:${group.pool}:${group.phase}:${fingerprint}`;
      const current = byFingerprint.get(key) ?? { workload: sample.workload,
        fingerprint, owner: group.owner ?? group.ownerStatus,
        pool: group.pool, phase: group.phase, dispatches: 0,
        statements: 0, unknown: 0, awaitedMs: 0 };
      current.dispatches += group.dispatches;
      current.statements += group.statements;
      current.unknown += group.unknownStatementDispatches;
      current.awaitedMs += group.awaitedMs;
      byFingerprint.set(key, current);
    }
  }
  for (const workload of workloads) for (const row of [...byFingerprint.values()]
    .filter(row => row.workload === workload).toSorted((left, right) => right.awaitedMs - left.awaitedMs).slice(0, 12)) {
    const template = raw.sqlTemplates.find(item => item.fingerprint === row.fingerprint)?.template ?? "unavailable";
    const excerpt = template.replaceAll("|", "\\|").replaceAll(/\s+/g, " ").slice(0, 120);
    lines.push(`| ${row.workload} | \`${row.fingerprint}\` | ${row.owner} | ${row.pool} | ${row.phase} | ` +
      `${row.dispatches} | ${row.statements} | ${row.unknown} | ${shown(row.awaitedMs)} | ${excerpt} |`);
  }
  lines.push("", "## Phase spans in successful warm samples", "",
    "| Workload | Phase path | Inclusive median (ms) | Exclusive median (ms) |",
    "| --- | --- | ---: | ---: |");
  for (const workload of workloads) {
    const paths = new Set(raw.samples.filter(sample => sample.workload === workload &&
      sample.temperature === "warm" && sample.status === "ok")
      .flatMap(sample => sample.trace?.phases.map(phase => phase.path) ?? []));
    for (const path of [...paths].toSorted()) {
      const spans = raw.samples.filter(sample => sample.workload === workload && sample.temperature === "warm" &&
        sample.status === "ok").flatMap(sample => sample.trace?.phases.filter(phase => phase.path === path) ?? []);
      lines.push(`| ${workload} | ${path} | ${shown(distribution(spans.map(span => span.inclusiveMs)).median)} | ` +
        `${shown(distribution(spans.map(span => span.exclusiveMs)).median)} |`);
    }
  }
  const failures = raw.samples.filter(sample => sample.status === "error");
  lines.push("", "## Failures and uncertainty", "",
    `Failures: ${failures.length + raw.setupFailures.length}. Successful warm percentiles exclude failures; the raw file retains every attempted sample.`);
  for (const failure of raw.setupFailures) lines.push(`- ${failure.id} at ${failure.stage}: ` +
    `${failure.name}${failure.code === null ? "" : ` (${failure.code})`}` +
    `${failure.reason === null ? "" : `, ${failure.reason}`}`);
  for (const failure of failures) lines.push(`- ${failure.id} at ${failure.failureStage ?? "unknown stage"}: ` +
    `${failure.failureName ?? "unknown failure"}${failure.failureCode === null ? "" : ` (${failure.failureCode})`}` +
    `${failure.failureReason === null ? "" : `, ${failure.failureReason}`}` +
    (failure.failureDiagnosticTokens.length === 0 ? "" :
      `; observed diagnostic tokens ${failure.failureDiagnosticTokens.join(", ")}`) +
    ((failure.cpuDiagnosticSecondaryFailures?.length ?? 0) === 0 ? "" :
      `; secondary CPU diagnostic failures ${failure.cpuDiagnosticSecondaryFailures?.map(item =>
        `${item.stage}:${item.name}`).join(", ")}`) +
    (failure.trace === null ? "" : `; observed query errors ${failure.trace.queryErrors}, ` +
      `open transactions ${failure.trace.transactionGroups.filter(group => group.outcome === "open-at-end")
        .reduce((count, group) => count + group.count, 0)}`));
  lines.push("", "Unavailable or unmeasured metrics:");
  for (const item of raw.unavailable) lines.push(`- ${item}`);
  lines.push("", "Interpretation notes:");
  for (const item of raw.interpretation) lines.push(`- ${item}`);
  lines.push("");
  return lines.join("\n");
}
import type { TraceFingerprintOwner, TraceInvocationRecord, TracePhaseSpan } from
  "../../../persistence-postgres/test/mixedMutationPerformanceTrace";

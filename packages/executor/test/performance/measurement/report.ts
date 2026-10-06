import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Data } from "effect";
import type { MeasurementAnalysis } from "./analysis";
import type { MeasurementEvidence } from "./artifact";
import type { FailureEvidence } from "./failure";
import type { TraceInvocationRecord } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import type { CorePerformanceScenario } from "../support/scenario";
import type { CorePerformanceScenarioName, CorePerformanceSize } from "../support/scenarioCatalog";

export interface RequestReport {
  readonly id: string;
  readonly lane: "flarex" | "native";
  readonly index: number;
  readonly kind: "warmup" | "quiet" | "calibration" | "diagnostic";
  readonly requestMs: number | null;
  readonly seedMs: number;
  readonly verificationMs: number;
  readonly cleanupMs: number;
  readonly outcome: "success" | "failure";
  readonly failureStage: string | null;
  readonly failures: readonly FailureEvidence[];
  readonly effectFailures?: readonly Readonly<{ spanId: string; failure: FailureEvidence }>[];
  readonly evidence?: MeasurementEvidence;
  readonly analysis?: MeasurementAnalysis;
  readonly invalidEvidence?: string;
  readonly driver?: TraceInvocationRecord;
}

export interface RunReport {
  readonly runId: string;
  readonly operation: "measure" | "compare";
  readonly mode: "quiet" | "timeline" | "database" | "cpu" | "server";
  readonly execution: "complete" | "failed" | "incomplete";
  readonly acceptance: "passed" | "failed" | "notEvaluated";
  readonly sampling: Readonly<{ requestedSamples: number; warmups: number; size: CorePerformanceSize;
    scenario: CorePerformanceScenarioName; driver: "postgres" | "pglite"; pairOrder: "alternating" | "none" }>;
  readonly workload?: CorePerformanceScenario["workload"];
  readonly samples: readonly RequestReport[];
  readonly pairs: readonly Readonly<{ index: number; nativeMs: number; flarexMs: number; addedMs: number }>[];
  readonly pairedSummary: Readonly<{ samples: number; medianAddedMs: number; p95AddedMs: number }> | null;
  readonly gates: readonly Readonly<{ name: string; passed: boolean; detail: string }>[];
  readonly setupMs: number;
  readonly cleanupMs: number;
  readonly cleanup: "notAcquired" | "completed" | "failed";
  readonly failures: readonly FailureEvidence[];
  readonly sources: Readonly<{ before: string | null; after: string | null; files: number }>;
  readonly environment: Readonly<{ before: unknown; after: unknown }>;
}

export class MeasurementInfrastructureError extends Data.TaggedError("MeasurementInfrastructureError")<{
  readonly stage: "persistence";
  readonly cause: unknown;
  readonly reports: Readonly<{ raw?: string; human?: string; profiles?: readonly string[] }>;
}> { override readonly message = "Measurement artifact persistence failed"; }

export class MeasurementRunFailure extends Data.TaggedError("MeasurementRunFailure")<{
  readonly cause: unknown;
  readonly runId: string;
  readonly execution: "failed";
  readonly acceptance: RunReport["acceptance"];
  readonly reports: Readonly<{ raw: string; human: string; profiles?: readonly string[] }>;
}> { override readonly message = "Measurement execution failed; retained reports are available"; }

function humanReport(report: RunReport): string {
  const rows = [`# ${report.sampling.scenario} measurement ${report.runId}`, "",
    `Execution: **${report.execution}**. Acceptance: **${report.acceptance}**. Mode: ${report.mode}.`, "",
    `This measures the selected ${report.sampling.size} graph: ${report.workload?.flow ?? report.sampling.scenario}. Setup, seeding, verification and command cleanup are outside request timers. Flarex's existing attempt finalizers remain inside its complete call.`, "",
    "Matched native references run independently committed framework calls; Application portions use a SQL surrogate. They do not provide Flarex's atomic mixed publication, Application OCC, revision history or durable outcome. Paired excess is a business-reference comparison, not an equal-guarantee engine comparison.", "",
    "| Request | Lane | Kind | Complete call ms | Outcome |", "|---|---|---|---:|---|"];
  for (const sample of report.samples) rows.push(`| ${sample.id} | ${sample.lane} | ${sample.kind} | ${sample.requestMs?.toFixed(3) ?? "unavailable"} | ${sample.outcome} |`);
  const failures = [...report.failures, ...report.samples.flatMap(sample => sample.failures)];
  if (failures.length > 0) {
    rows.push("", "| Failure stage | Observed outcome | Ordered reason kinds | Safe tags |", "|---|---|---|---|");
    for (const failure of failures) rows.push(`| ${failure.stage} | ${failure.outcome} | ${failure.reasons.map(reason => reason.kind).join(", ")} | ${failure.tokens.join(", ")} |`);
    rows.push("", "Original execution and cleanup causes are retained by the SDK's failed-run rejection. Artifacts retain bounded structured reason kinds and safe tags; arbitrary messages, stack contents and payloads are excluded.");
  }
  if (report.pairedSummary !== null) rows.push("", `Paired added latency: median ${report.pairedSummary.medianAddedMs.toFixed(3)} ms; P95 ${report.pairedSummary.p95AddedMs.toFixed(3)} ms (${report.pairedSummary.samples} fresh pairs).`);
  for (const sample of report.samples) {
    const analysis = sample.analysis;
    if (sample.invalidEvidence !== undefined) rows.push("", `Diagnostic ${sample.id} is invalid: ${sample.invalidEvidence}`);
    if (analysis === undefined) continue;
    rows.push("", `## Diagnostic ${sample.id}`, "",
      `Accounting root: ${analysis.wall.rootMs.toFixed(3)} ms; complete SDK call: ${sample.requestMs?.toFixed(3) ?? "unavailable"} ms. The root is the observed request span; adapter entry/exit and post-request trace finalization remain separately visible.`, "",
      `Diagnostic integrity: ${analysis.diagnostic}. Reconciliation error: ${analysis.wall.reconciliationErrorMs.toExponential(2)} ms.`, "",
      `Strict deepest-operation wall: attributed ${analysis.coverage.attributedMs.toFixed(3)} ms; ambiguous ${analysis.coverage.ambiguousMs.toFixed(3)} ms; unattributed ${analysis.coverage.unattributedMs.toFixed(3)} ms; observer-only ${analysis.coverage.observerOnlyMs.toFixed(3)} ms. Unknown descendants and concurrent coordination remain in this conservative ledger.`, "",
      `Enclosing operation-context wall: attributed ${analysis.operationContext.ledger.attributed.toFixed(3)} ms; ambiguous ${analysis.operationContext.ledger.ambiguous.toFixed(3)} ms; unattributed ${analysis.operationContext.ledger.unattributed.toFixed(3)} ms; observer-only ${analysis.operationContext.ledger.observer.toFixed(3)} ms. This separate ledger follows actual ancestry to the nearest known operation owner; it establishes enclosing responsibility, not deepest-operation ownership or CPU cost.`, "",
      `Coordination lifetime union: ${analysis.operationContext.coordinationUnionMs.toFixed(3)} ms; simultaneous foreground leaf union: ${analysis.operationContext.concurrentLeafUnionMs.toFixed(3)} ms; unknown foreground leaf union: ${analysis.operationContext.unknownLeafUnionMs.toFixed(3)} ms. Coordination wrappers remain retained; actual child work still participates in contextual ambiguity. All ledgers and unions overlap and must not be added.`, "",
      `Driver-await union: ${analysis.wall.driverAwaitUnionMs.toFixed(3)} ms; checkout-await union: ${analysis.wall.checkoutAwaitUnionMs.toFixed(3)} ms; observed instrumentation union: ${analysis.wall.observerUnionMs.toFixed(3)} ms; observer/await overlap: ${analysis.wall.observerAwaitOverlapMs.toFixed(3)} ms; post-request observer union: ${analysis.wall.postRequestObserverUnionMs.toFixed(3)} ms. These overlapping unions must not be added.`, "",
      sample.driver !== undefined
        ? `Actual driver exchanges: ${analysis.database.driverExchanges}; checkouts: ${analysis.database.checkouts}; transactions: ${analysis.database.transactions}; decoded JSON UTF-8 bytes: ${analysis.database.observedDecodedJsonBytes} (${analysis.database.unknownDecodedJsonByteExchanges} unknown exchanges). Operation-correlated exchanges: ${analysis.database.correlatedDriverExchanges}; uncorrelated: ${analysis.database.uncorrelatedDriverExchanges}; root-only: ${analysis.database.rootOnlyDriverExchanges}. A root-only link provides request identity without deeper operation attribution.`
        : "Database observations are unavailable in this diagnostic lane. Empty driver totals do not mean zero SQL or zero database work.", "",
      "| Owner | Attributed wall ms | Inclusive observed ms | Driver exchanges |", "|---|---:|---:|---:|");
    for (const owner of analysis.owners) rows.push(`| ${owner.owner} | ${owner.attributedWallMs.toFixed(3)} | ${owner.inclusiveObservedWallMs.toFixed(3)} | ${owner.driverExchangeCount} |`);
    rows.push("", "| Enclosing operation context | Attributed context wall ms | Inclusive context ms | Context-linked driver exchanges |",
      "|---|---:|---:|---:|");
    for (const owner of analysis.operationContext.owners) rows.push(`| ${owner.owner} | ${owner.attributedWallMs.toFixed(3)} | ${owner.inclusiveContextWallMs.toFixed(3)} | ${owner.driverExchangeCount} |`);
    if (sample.driver !== undefined) {
      rows.push("", "| Initiating observed operation | Nearest known context | Driver exchanges | Summed driver await ms |", "|---|---|---:|---:|");
      for (const operation of analysis.databaseOperations) rows.push(`| ${operation.name ?? "uncorrelated"} | ${operation.contextOwners.join(", ") || "unknown"} | ${operation.driverExchangeCount} | ${operation.awaitSumMs.toFixed(3)} |`);
      rows.push("", "Driver groups use exact operation identities before grouping by name/context. Summed awaits can overlap and are not disjoint wall. Source frames, source-site IDs and source-owner candidates remain separate raw provenance; a query proxy is not semantic ownership.");
    }
    rows.push("", "| Owner / site | Work | Unit | Observed total |", "|---|---|---|---:|");
    for (const work of analysis.work) rows.push(`| ${work.owner ?? "unattributed"} / ${work.site ?? "unknown"} | ${work.metric} | ${work.unit} | ${work.value} |`);
    if (analysis.cpu !== undefined) {
      const cpu = analysis.cpu;
      rows.push("", `CPU collection: ${cpu.complete ? "complete" : "incomplete"}. Clock alignment: ${cpu.alignment.status}; offset uncertainty ${cpu.alignment.uncertaintyMs?.toFixed(3) ?? "unavailable"} ms. Root samples: ${cpu.definitelyInsideSamples} inside, ${cpu.boundaryAmbiguousSamples} boundary-ambiguous, ${cpu.outsideSamples} outside.`, "",
        "| Sampled source frame | Self samples | Inclusive samples | Sampled elapsed spacing ms |", "|---|---:|---:|---:|");
      for (const frame of cpu.sampledFrames.slice(0, 30)) rows.push(`| ${frame.callFrame.url}:${frame.callFrame.lineNumber + 1} ${frame.callFrame.functionName} | ${frame.selfSamples} | ${frame.inclusiveSamples} | ${frame.sampledElapsedWeightMs.toFixed(3)} |`);
      rows.push("", `GC root overlap: ${cpu.gc.summedRootOverlapMs?.toFixed(3) ?? "unavailable"} ms in ${cpu.gc.intervals.length} observed intervals. Allocation estimate: ${cpu.allocations?.estimatedBytes ?? "unavailable"} bytes across the entire profiler window; ${cpu.allocations?.sampleCount ?? "unavailable"} allocation samples. Allocation samples have order but no timestamps, so they cannot be assigned exactly to request phases.`, "",
        `Process CPU counters: user ${cpu.counters?.process.user ?? "unavailable"} µs, system ${cpu.counters?.process.system ?? "unavailable"} µs. Thread counters: user ${cpu.counters?.thread?.user ?? "unavailable"} µs, system ${cpu.counters?.thread?.system ?? "unavailable"} µs. Counter windows include profiler boundaries.`, "",
        `Event-loop active ${cpu.counters?.eventLoop.active.toFixed(3) ?? "unavailable"} ms, idle ${cpu.counters?.eventLoop.idle.toFixed(3) ?? "unavailable"} ms. Heap occupancy delta ${cpu.memoryOccupancyDeltaBytes?.heapUsed ?? "unavailable"} bytes; RSS delta ${cpu.memoryOccupancyDeltaBytes?.rss ?? "unavailable"} bytes. Endpoint occupancy is neither total allocation nor peak memory.`, "",
        "Sampled stack spacing is elapsed weighting, not exact scheduler CPU. Inclusive samples overlap. GC and process counters belong to the controlled Node isolate/process; external contention and exact request causality remain unavailable. Full sanitized profiles, samples, deltas, windows and failures are retained in the raw artifact.");
      if (cpu.allocations !== null) {
        rows.push("", "| Allocation source frame | Estimated self bytes |", "|---|---:|");
        for (const frame of cpu.allocations.frames.slice(0, 20)) rows.push(`| ${frame.callFrame.url}:${frame.callFrame.lineNumber + 1} ${frame.callFrame.functionName} | ${frame.selfSize} |`);
      }
    }
    if (analysis.server !== undefined) {
      const server = analysis.server;
      rows.push("", `PostgreSQL collection: ${server.status}. Top-level calls ${server.topLevel.calls}, plans ${server.topLevel.plans}, planning ${server.topLevel.planningMs.toFixed(3)} ms, execution ${server.topLevel.executionMs.toFixed(3)} ms. Nested calls ${server.nested.calls}, plans ${server.nested.plans}, planning ${server.nested.planningMs.toFixed(3)} ms, execution ${server.nested.executionMs.toFixed(3)} ms. Top-level and nested elapsed totals overlap and must not be added.`, "",
        "| Sampled wait type | Wait event | Observations | Backend PIDs |", "|---|---|---:|---|");
      for (const wait of server.waits) rows.push(`| ${wait.waitType} | ${wait.waitEvent} | ${wait.observations} | ${wait.pids.join(", ")} |`);
      rows.push("", `PID/time correlation: ${server.correlations.filter(entry => entry.status === "singleCandidate").length} single-candidate samples, ${server.correlations.filter(entry => entry.status === "ambiguous").length} ambiguous samples; all other samples retain their unavailable/unmatched/reused-PID status. A candidate is not proof of unique operation ownership. Observer awaits sum to ${server.observerAwaitMsInclusiveSum.toFixed(3)} ms; this inclusive sum can overlap and does not measure all instrumentation contention.`, "");
      for (const limit of server.limitations) rows.push(`- ${limit}.`);
      const plans = sample.evidence?.server?.actualPlans;
      rows.push("", `Actual plans: ${plans?.status ?? "unavailable"}.`);
      if (plans !== undefined && plans.status !== "unavailable") {
        rows.push(`Retained plans: ${plans.plans.length}; coverage ${plans.coverage}; log flush completeness ${plans.flushCompleteness}. Plan log windows are not proof of exclusive request ownership.`, "",
          "| Observed query ID | PID / session | Plan elapsed ms | Operators |", "|---|---|---:|---|");
        for (const plan of plans.plans.slice(0, 30)) rows.push(`| ${plan.header.queryId} | ${plan.header.backendPid} / ${plan.header.sessionId} | ${plan.durationMs.toFixed(3)} | ${plan.nodes.map(node => node.nodeType).join(", ")} |`);
        rows.push("", "Safe node rows/loops/cost/buffer metrics and trigger counts remain in the raw artifact. Parent/child plan durations and nested statement totals overlap; this table must not be added to request wall.");
      }
    }
    if (analysis.incompleteReasons.length > 0) rows.push("", `Missing observations: ${analysis.incompleteReasons.join(", ")}.`);
  }
  rows.push("", "Effect spans report elapsed work including awaits. Driver waits do not establish server execution, lock time, network cost or scheduler CPU. Decoded JSON bytes do not measure wire traffic or heap allocation. CPU/GC/allocation evidence appears only in CPU mode; server counters and sampled waits appear only in server mode. Empty evidence in other lanes means unavailable. The platform clock precision is unknown. Observed instrumentation intervals cover collector callbacks; Effect context wrapping and all instrumentation cost are not fully measured. Diagnostic and quiet requests are separate; observed instrumentation cost is disclosed and never subtracted to invent quiet latency. Server calibration shares the declared server instrumentation settings; it is not an uninstrumented PostgreSQL baseline.", "",
    "| Gate | Result | Detail |", "|---|---|---|");
  for (const gate of report.gates) rows.push(`| ${gate.name} | ${gate.passed ? "passed" : "failed"} | ${gate.detail} |`);
  rows.push("", `Command setup: ${report.setupMs.toFixed(3)} ms. Cleanup: ${report.cleanup} (${report.cleanupMs.toFixed(3)} ms).`, "");
  return rows.join("\n");
}

/** Artifact I/O is a foreign boundary after all request timers and resource
 * finalizers. Successful partial paths accompany the original persistence error. */
export async function persistMeasurementReport(directory: string, report: RunReport) {
  const profiles: string[] = [];
  const reports: { raw?: string; human?: string; profiles?: readonly string[] } = {};
  try {
    await mkdir(directory, { recursive: true });
    const raw = resolve(directory, `${report.runId}.json`);
    await writeFile(raw, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    reports.raw = raw;
    const human = resolve(directory, `${report.runId}.md`);
    await writeFile(human, humanReport(report), { flag: "wx" });
    reports.human = human;
    for (const sample of report.samples) {
      const cpu = sample.evidence?.cpu;
      if (cpu === undefined) continue;
      for (const [extension, profile] of [["cpuprofile", cpu.cpuProfile],
        ["allocation.json", cpu.allocationProfile]] as const) {
        if (profile === null) continue;
        const path = resolve(directory, `${report.runId}-${sample.lane}-${sample.index}.${extension}`);
        await writeFile(path, JSON.stringify(profile) + "\n", { flag: "wx" });
        profiles.push(path);
        reports.profiles = [...profiles];
      }
    }
    return { raw, human, ...(profiles.length === 0 ? {} : { profiles: [...profiles] }) };
  } catch (cause) {
    throw new MeasurementInfrastructureError({ stage: "persistence", cause, reports });
  }
}

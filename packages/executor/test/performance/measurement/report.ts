import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Data } from "effect";
import type { MeasurementAnalysis } from "./analysis";
import type { MeasurementEvidence } from "./artifact";
import type { FailureEvidence } from "./failure";
import type { TraceInvocationRecord } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";

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
  readonly mode: "quiet" | "timeline" | "database";
  readonly execution: "complete" | "failed" | "incomplete";
  readonly acceptance: "passed" | "failed" | "notEvaluated";
  readonly sampling: Readonly<{ requestedSamples: number; warmups: number; size: "small";
    scenario: "mixed-product"; driver: "postgres" | "pglite"; pairOrder: "alternating" | "none" }>;
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
  readonly reports: Readonly<{ raw?: string; human?: string }>;
}> { override readonly message = "Measurement artifact persistence failed"; }

export class MeasurementRunFailure extends Data.TaggedError("MeasurementRunFailure")<{
  readonly cause: unknown;
  readonly runId: string;
  readonly execution: "failed";
  readonly acceptance: RunReport["acceptance"];
  readonly reports: Readonly<{ raw: string; human: string }>;
}> { override readonly message = "Measurement execution failed; retained reports are available"; }

function humanReport(report: RunReport): string {
  const rows = [`# Mixed Product measurement ${report.runId}`, "",
    `Execution: **${report.execution}**. Acceptance: **${report.acceptance}**. Mode: ${report.mode}.`, "",
    "This measures the existing small mixed Product business graph. Setup, seeding, verification and command cleanup are outside request timers. Flarex's existing attempt finalizers remain inside its complete call.", "",
    "Native runs independently committed framework calls and an Application SQL surrogate. It does not provide Flarex's atomic mixed publication, Application OCC, revision history or durable outcome. Paired excess is a business-reference comparison, not an equal-guarantee engine comparison.", "",
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
      report.mode === "database"
        ? `Actual driver exchanges: ${analysis.database.driverExchanges}; checkouts: ${analysis.database.checkouts}; transactions: ${analysis.database.transactions}; decoded JSON UTF-8 bytes: ${analysis.database.observedDecodedJsonBytes} (${analysis.database.unknownDecodedJsonByteExchanges} unknown exchanges). Operation-correlated exchanges: ${analysis.database.correlatedDriverExchanges}; uncorrelated: ${analysis.database.uncorrelatedDriverExchanges}; root-only: ${analysis.database.rootOnlyDriverExchanges}. A root-only link provides request identity without deeper operation attribution.`
        : "Database observations are unavailable in this timeline lane. Empty driver totals do not mean zero SQL or zero database work.", "",
      "| Owner | Attributed wall ms | Inclusive observed ms | Driver exchanges |", "|---|---:|---:|---:|");
    for (const owner of analysis.owners) rows.push(`| ${owner.owner} | ${owner.attributedWallMs.toFixed(3)} | ${owner.inclusiveObservedWallMs.toFixed(3)} | ${owner.driverExchangeCount} |`);
    rows.push("", "| Enclosing operation context | Attributed context wall ms | Inclusive context ms | Context-linked driver exchanges |",
      "|---|---:|---:|---:|");
    for (const owner of analysis.operationContext.owners) rows.push(`| ${owner.owner} | ${owner.attributedWallMs.toFixed(3)} | ${owner.inclusiveContextWallMs.toFixed(3)} | ${owner.driverExchangeCount} |`);
    if (report.mode === "database") {
      rows.push("", "| Initiating observed operation | Nearest known context | Driver exchanges | Summed driver await ms |", "|---|---|---:|---:|");
      for (const operation of analysis.databaseOperations) rows.push(`| ${operation.name ?? "uncorrelated"} | ${operation.contextOwners.join(", ") || "unknown"} | ${operation.driverExchangeCount} | ${operation.awaitSumMs.toFixed(3)} |`);
      rows.push("", "Driver groups use exact operation identities before grouping by name/context. Summed awaits can overlap and are not disjoint wall. Source frames, source-site IDs and source-owner candidates remain separate raw provenance; a query proxy is not semantic ownership.");
    }
    rows.push("", "| Owner / site | Work | Unit | Observed total |", "|---|---|---|---:|");
    for (const work of analysis.work) rows.push(`| ${work.owner ?? "unattributed"} / ${work.site ?? "unknown"} | ${work.metric} | ${work.unit} | ${work.value} |`);
    if (analysis.incompleteReasons.length > 0) rows.push("", `Missing observations: ${analysis.incompleteReasons.join(", ")}.`);
  }
  rows.push("", "Effect spans report elapsed work including awaits. Driver waits do not establish server execution, lock time, network cost or scheduler CPU. Decoded JSON bytes do not measure wire traffic or heap allocation. CPU, GC and server observations are unavailable in this first slice. The platform clock precision is unknown. Observed instrumentation intervals cover collector callbacks; Effect context wrapping and all instrumentation cost are not fully measured. Diagnostic and quiet requests are separate; observed instrumentation cost is disclosed and never subtracted to invent quiet latency.", "",
    "| Gate | Result | Detail |", "|---|---|---|");
  for (const gate of report.gates) rows.push(`| ${gate.name} | ${gate.passed ? "passed" : "failed"} | ${gate.detail} |`);
  rows.push("", `Command setup: ${report.setupMs.toFixed(3)} ms. Cleanup: ${report.cleanup} (${report.cleanupMs.toFixed(3)} ms).`, "");
  return rows.join("\n");
}

/** Artifact I/O is a foreign boundary after all request timers and resource
 * finalizers. Successful partial paths accompany the original persistence error. */
export async function persistMeasurementReport(directory: string, report: RunReport) {
  const reports: { raw?: string; human?: string } = {};
  try {
    await mkdir(directory, { recursive: true });
    const raw = resolve(directory, `${report.runId}.json`);
    await writeFile(raw, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    reports.raw = raw;
    const human = resolve(directory, `${report.runId}.md`);
    await writeFile(human, humanReport(report), { flag: "wx" });
    reports.human = human;
    return { raw, human };
  } catch (cause) {
    throw new MeasurementInfrastructureError({ stage: "persistence", cause, reports });
  }
}

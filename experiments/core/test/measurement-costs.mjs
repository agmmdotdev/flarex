import assert from "node:assert/strict";
import { analyzeCpuEvidence } from "../../../packages/executor/test/performance/measurement/cpu.ts";
import { failureEvidence } from "./measurement-errors.mjs";

/** log_duration emits no SQL text; extended Parse/Bind/Execute durations are
 * separate entries. Keep every duration, never infer phases from their order. */
export function serverDurations(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^fx_duration\|(\d+)\|(\d+)\|LOG:\s+duration: (\d+(?:\.\d+)?) ms\s*$/.exec(line);
    if (line.startsWith("fx_duration|") && /\|LOG:\s+duration:/.test(line)) assert.ok(match, "Recognized server duration protocol");
    if (match !== null) entries.push({ backendPid: Number(match[1]), line: Number(match[2]), durationMs: Number(match[3]) });
  }
  return { entries, totalMs: entries.reduce((total, entry) => total + entry.durationMs, 0),
    meaning: "Sum of logged server statement/protocol durations in isolated-cluster request window; includes waits, not server CPU; no separate planning attribution" };
}

/** Independent capture attempts preserve available evidence when another
 * diagnostic fails. Caller joins these faults with the initiating request. */
export async function captureCostDiagnostics(target, collector, readServerWindow) {
  const failures = [];
  target.profile = {};
  try {
    target.profile.evidence = collector.evidence();
    target.profile.summary = analyzeCpuEvidence(target.profile.evidence);
    assert.equal(target.profile.evidence.complete, true, "Complete bounded CPU capture");
    assert.equal(target.profile.summary.complete, true, "Aligned CPU attribution window");
  } catch (cause) { failures.push(cause); }
  finally {
    // evidence() may add export faults. Preserve their initiating causes both
    // in the owning aggregate and through the report's JSON boundary.
    const faults = collector.failures();
    target.profile.failures = faults.map(({ stage, cause }) => ({ stage, evidence: failureEvidence(cause) }));
    failures.push(...faults.map(fault => fault.cause));
  }
  try {
    target.serverDurationLog = await readServerWindow();
    target.server = serverDurations(target.serverDurationLog);
    assert.ok(target.server.entries.length > 0, "Server timing coverage");
  } catch (cause) { failures.push(cause); }
  return failures;
}

export function traceCosts(record) {
  assert.equal(record.aggregationComplete, true);
  const control = record.dispatches.filter(dispatch => dispatch.transactionAction !== null);
  return { observedRequestMs: record.durationMs, driverAwaitedUnionMs: record.dispatchAwaitedUnionMs,
    checkoutAwaitedUnionMs: record.checkoutAwaitedUnionMs,
    controlAwaitedMs: control.reduce((sum, dispatch) => sum + dispatch.awaitedMs, 0),
    transactions: record.transactions.length, exchanges: record.dispatches.length,
    queries: record.dispatchGroups.map(({ template, dispatchCount, awaitedMsSum }) => ({ template, count: dispatchCount, awaitedMs: awaitedMsSum })),
    observerIntervalSumMs: record.observerIntervals.reduce((sum, interval) => sum + interval.durationMs, 0),
    meaning: "Diagnostic overlapping intervals; driver time includes server/network/decoding. Do not add overlapping values or subtract independent campaigns." };
}

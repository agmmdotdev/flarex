import { Effect, Exit } from "effect";
import type { MixedMutationPerformanceTrace, TraceInvocationRecord } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";

/** Diagnostic runtime boundary: the child owns the ALS phase until its entire
 * Exit, including uninterruptible cleanup, has completed. */
export function traceMixedMutationEffect<A, E>(
  trace: MixedMutationPerformanceTrace | undefined,
  name: string,
  operation: Effect.Effect<A, E>,
): Effect.Effect<A, E> {
  if (trace === undefined) return operation;
  return Effect.suspend(() => {
    let completion: Promise<Exit.Exit<A, E>> | undefined;
    return Effect.uninterruptibleMask(restore => restore(Effect.promise(signal => {
      completion = trace.withPhase(name, () => Effect.runPromiseExit(operation, { signal }));
      return completion;
    })).pipe(Effect.onInterrupt(() => {
      const pending = completion;
      return pending === undefined ? Effect.void
        : Effect.promise(() => pending).pipe(Effect.flatMap(exit =>
          Exit.isFailure(exit) ? Effect.failCause(exit.cause) : Effect.void));
    }))).pipe(
      Effect.flatMap(exit => Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.failCause(exit.cause)));
  });
}

export function latencySummary(values: readonly number[], full: boolean) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const at = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  return { samples: sorted.length, medianMs: at(0.5), minMs: sorted[0], maxMs: sorted.at(-1),
    ...(full && values.length >= 20 ? { p95Ms: at(0.95) } : {}) };
}

/** Test-report boundary: retain typed tags/codes/reasons while excluding input,
 * arbitrary error messages, SQL parameters and database credentials. */
export function failureTokens(cause: unknown): readonly string[] {
  const seen = new Set<object>();
  const tokens = new Set<string>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || typeof value !== "object" || value === null || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(value.name)) tokens.add(value.name);
    if (Array.isArray(value)) { for (const member of value) visit(member, depth + 1); return; }
    for (const [key, member] of Object.entries(value)) {
      if (["_tag", "code", "reason", "kind"].includes(key) && typeof member === "string" &&
        /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(member)) tokens.add(member);
      if (["cause", "error", "failure", "failures", "defect", "errors", "reasons", "reason"].includes(key)) visit(member, depth + 1);
    }
    if (value instanceof Error) visit(value.cause, depth + 1);
  };
  visit(cause, 0);
  return [...tokens];
}

export function sqlSummary(record: TraceInvocationRecord) {
  const groups = record.dispatchGroups;
  const byPhase = new Map<string, { pool: "control" | "target"; phasePath: readonly string[];
    dispatches: number; statements: number; awaitedMsSum: number }>();
  for (const group of groups) {
    const key = JSON.stringify([group.pool, group.phasePath]);
    const phase = byPhase.get(key) ?? { pool: group.pool, phasePath: group.phasePath,
      dispatches: 0, statements: 0, awaitedMsSum: 0 };
    phase.dispatches += group.dispatchCount;
    phase.statements += group.statementCount;
    phase.awaitedMsSum += group.awaitedMsSum;
    byPhase.set(key, phase);
  }
  return { outcome: record.outcome, dispatches: groups.reduce((sum, group) => sum + group.dispatchCount, 0),
    statements: groups.reduce((sum, group) => sum + group.statementCount, 0),
    transactions: record.transactionGroups.reduce((sum, group) => sum + group.intervalCount, 0),
    openTransactions: record.transactionGroups.filter(group => group.outcome === "open-at-end")
      .reduce((sum, group) => sum + group.intervalCount, 0),
    queryErrors: groups.reduce((sum, group) => sum + group.errorCount, 0),
    lostContextDispatches: record.lostContextDispatches, unknownStatementDispatches: record.unknownStatementDispatches,
    unobservedDispatches: record.unobservedDispatches, incompleteSpans: record.incompleteSpans,
    diagnosticDurationMs: record.durationMs,
    // Await sums can overlap; unions count observed wall time once. Neither is server CPU time.
    dispatchAwaitedMsSum: groups.reduce((sum, group) => sum + group.awaitedMsSum, 0),
    dispatchAwaitedUnionMs: record.dispatchAwaitedUnionMs,
    checkoutAwaitedMsSum: record.checkoutGroups.reduce((sum, group) => sum + group.awaitedMsSum, 0),
    checkoutAwaitedUnionMs: record.checkoutAwaitedUnionMs,
    phases: record.spans,
    dispatchGroups: record.dispatchGroups,
    // Each dispatch belongs only to its deepest observed path, not every ancestor.
    sqlByPhase: [...byPhase.values()] };
}

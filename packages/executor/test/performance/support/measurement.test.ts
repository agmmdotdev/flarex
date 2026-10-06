import { describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { Pool } from "pg";
import { createMixedMutationPerformanceTrace, type TraceInvocationRecord } from "../../../../persistence-postgres/test/mixedMutationPerformanceTrace";
import { failureTokens, latencySummary, sqlSummary, traceMixedMutationEffect } from "./measurement";

describe("core performance report", () => {
  it("preserves the quiet Effect and the diagnostic operation's complete failure Cause", async () => {
    const cause = Cause.combine(Cause.fail({ _tag: "ExpectedFailure" }), Cause.die(new Error("operation defect")));
    const operation = Effect.failCause(cause);
    expect(traceMixedMutationEffect(undefined, "quiet", operation)).toBe(operation);
    const controlPool = new Pool();
    const targetPool = new Pool();
    const trace = createMixedMutationPerformanceTrace({ controlPool, targetPool });
    try {
      const exit = await trace.withInvocation({ id: "cause", mode: "measured" }, () =>
        Effect.runPromiseExit(traceMixedMutationEffect(trace, "operation", operation)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(exit.cause).toBe(cause);
      expect(trace.records()[0]?.incompleteSpans).toBe(0);
    } finally {
      trace.close();
      await Promise.all([controlPool.end(), targetPool.end()]);
    }
  });

  it.each([false, true])("drains traced child cleanup before parent cleanup, retaining defects=%s", async cleanupDefect => {
    const controlPool = new Pool();
    const targetPool = new Pool();
    const trace = createMixedMutationPerformanceTrace({ controlPool, targetPool });
    const defect = new Error("child cleanup defect");
    const events: string[] = [];
    try {
      const exit = await trace.withInvocation({ id: "drain", mode: "measured" }, () => Effect.runPromise(
        Effect.scoped(Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const cleanupStarted = yield* Deferred.make<void>();
          const cleanupRelease = yield* Deferred.make<void>();
          const parentClosed = yield* Deferred.make<void>();
          const operation = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never),
            Effect.ensuring(Effect.gen(function* () {
              events.push("child cleanup started");
              yield* Deferred.succeed(cleanupStarted, undefined);
              yield* Deferred.await(cleanupRelease);
              events.push("child cleanup finished");
              if (cleanupDefect) yield* Effect.die(defect);
            })));
          const parent = yield* Effect.forkScoped(traceMixedMutationEffect(trace, "operation", operation).pipe(
            Effect.ensuring(Effect.sync(() => { events.push("parent cleanup"); }).pipe(
              Effect.andThen(Deferred.succeed(parentClosed, undefined))))));
          yield* Deferred.await(started);
          const interrupt = yield* Effect.forkScoped(Fiber.interrupt(parent));
          yield* Deferred.await(cleanupStarted);
          const closedBeforeRelease = yield* Deferred.isDone(parentClosed);
          const eventsBeforeRelease = [...events];
          yield* Deferred.succeed(cleanupRelease, undefined);
          yield* Fiber.join(interrupt);
          expect(closedBeforeRelease).toBe(false);
          expect(eventsBeforeRelease).toEqual(["child cleanup started"]);
          return yield* Fiber.await(parent);
        }))));
      expect(events).toEqual(["child cleanup started", "child cleanup finished", "parent cleanup"]);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
        expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect))
          .toEqual(cleanupDefect ? [defect] : []);
      }
      const record = trace.records()[0];
      expect(record?.incompleteSpans).toBe(0);
      expect(record?.spans.find(span => span.name === "operation")?.complete).toBe(true);
    } finally {
      trace.close();
      await Promise.all([controlPool.end(), targetPool.end()]);
    }
  });

  it("omits P95 for short or incomplete measurements and preserves observations", () => {
    const values = [3, 1, 2];
    expect(latencySummary(values, false)).toEqual({ samples: 3, medianMs: 2, minMs: 1, maxMs: 3 });
    expect(latencySummary(values, true)).not.toHaveProperty("p95Ms");
    expect(latencySummary([], true)).toBeNull();
    expect(latencySummary(Array.from({ length: 20 }, (_, index) => index + 1), true)).toHaveProperty("p95Ms", 19);
    expect(values).toEqual([3, 1, 2]);
  });
  it("retains nested typed failures without exposing foreign error messages", () => {
    const cause = new Error("postgres://private:secret@example/db", {
      cause: { _tag: "CommerceTransactionError", reason: "rollbackOnly",
        error: { _tag: "LogicalParticipantAdmissionError", reason: "resourceFailure" } },
    });
    expect(failureTokens(cause)).toEqual(["Error", "CommerceTransactionError", "rollbackOnly",
      "LogicalParticipantAdmissionError", "resourceFailure"]);
    expect(JSON.stringify(failureTokens(cause))).not.toContain("secret");
  });
  it("keeps nested phase wall time separate from exclusive SQL attribution and overlapping waits", () => {
    const dispatch = { pool: "target" as const, fingerprint: null, template: null,
      unknownStatementDispatches: 0, awaitedMsMin: 4, awaitedMsMax: 4,
      errorCount: 0, unobservedCount: 0 };
    const record: TraceInvocationRecord = {
      id: "diagnostic", mode: "measured", startedAtMs: 0, durationMs: 12, outcome: "ok",
      spans: [
        { id: 0, parentId: null, name: "invocation", startMs: 0, endMs: 12,
          inclusiveMs: 12, exclusiveMs: 2, complete: true },
        { id: 1, parentId: 0, name: "native operation", startMs: 1, endMs: 11,
          inclusiveMs: 10, exclusiveMs: 10, complete: true },
      ],
      dispatchGroups: [
        { ...dispatch, phasePath: ["invocation"], dispatchCount: 1, statementCount: 1, awaitedMsSum: 4 },
        { ...dispatch, phasePath: ["invocation", "native operation"], dispatchCount: 1, statementCount: 2, awaitedMsSum: 4 },
        { ...dispatch, phasePath: ["invocation", "native operation"], dispatchCount: 1, statementCount: 1, awaitedMsSum: 4 },
      ],
      checkoutGroups: [], transactionGroups: [], dispatches: [], checkouts: [], transactions: [],
      dispatchAwaitedUnionMs: 8, checkoutAwaitedUnionMs: 0, poolQueryCalls: 0,
      delegatedPoolQueryDispatches: 0, lostContextDispatches: 0, unobservedDispatches: 0,
      unknownStatementDispatches: 0, incompleteSpans: 0,
      observerIntervals: [], observationErrors: 0, droppedObservations: 0,
      observationLimit: 100_000, aggregationComplete: true,
    };
    const summary = sqlSummary(record);
    expect(summary.phases).toEqual(record.spans);
    expect(summary).toMatchObject({ diagnosticDurationMs: 12, dispatches: 3, statements: 4,
      dispatchAwaitedMsSum: 12, dispatchAwaitedUnionMs: 8 });
    expect(summary.sqlByPhase).toEqual([
      { pool: "target", phasePath: ["invocation"], dispatches: 1, statements: 1, awaitedMsSum: 4 },
      { pool: "target", phasePath: ["invocation", "native operation"], dispatches: 2, statements: 3, awaitedMsSum: 8 },
    ]);
    expect(summary.sqlByPhase.reduce((sum, phase) => sum + phase.statements, 0)).toBe(summary.statements);
  });
});

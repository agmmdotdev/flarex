import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  beginEvaluation,
  completionInput,
  prepareEvaluationState,
  queryDescriptor,
} from "./deploymentSyncEvaluationStateTestSupport";

describe("deployment query-sync evaluation state atomicity", () => {
  it("rolls back completion rows, dependencies, pending work, and scope together", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const attempt = await beginEvaluation(prepared, queryDescriptor(11));
      const input = completionInput(prepared, attempt, "atomic-completion");
      const before = snapshot(prepared.database);
      installScopeFailureTrigger(prepared.database);

      const exit = await Effect.runPromiseExit(
        prepared.state.completeQueryEvaluation(
          attempt,
          input.evaluation,
          input.refresh,
          input.publication,
        ),
      );

      expectDefect(exit);
      expect(snapshot(prepared.database)).toEqual(before);
      prepared.database.exec("DROP TRIGGER fail_evaluation_scope_write");
      await expect(Effect.runPromise(
        prepared.state.completeQueryEvaluation(
          attempt,
          input.evaluation,
          input.refresh,
          input.publication,
        ),
      )).resolves.toMatchObject({ _tag: "completed" });
    } finally {
      prepared.database.close();
    }
  });

  it("rolls back a terminal block before exposing its receipt", async () => {
    const prepared = await prepareEvaluationState();
    try {
      await beginEvaluation(prepared, queryDescriptor(12));
      const claimed = await Effect.runPromise(
        prepared.state.claimEvaluationWork({
          maximumQueryInspections: 1,
          continuation: null,
        }),
      );
      if (claimed._tag !== "claimed") {
        throw new Error(`Expected claimed receipt, received ${claimed._tag}.`);
      }
      const before = snapshot(prepared.database);
      installScopeFailureTrigger(prepared.database);

      const exit = await Effect.runPromiseExit(
        prepared.state.recordEvaluationAttemptOutcome(
          claimed.attempt,
          "terminalRefusal",
        ),
      );

      expectDefect(exit);
      expect(snapshot(prepared.database)).toEqual(before);
      prepared.database.exec("DROP TRIGGER fail_evaluation_scope_write");
      await expect(Effect.runPromise(
        prepared.state.recordEvaluationAttemptOutcome(
          claimed.attempt,
          "terminalRefusal",
        ),
      )).resolves.toMatchObject({ _tag: "blocked" });
    } finally {
      prepared.database.close();
    }
  });
});

function installScopeFailureTrigger(
  database: import("node:sqlite").DatabaseSync,
): void {
  database.exec(`CREATE TRIGGER fail_evaluation_scope_write
    BEFORE UPDATE ON deployment_sync_scope_state
    BEGIN
      SELECT RAISE(FAIL, 'forced evaluation scope rollback');
    END`);
}

function snapshot(database: import("node:sqlite").DatabaseSync) {
  return Object.freeze({
    scope: database.prepare(
      "SELECT * FROM deployment_sync_scope_state",
    ).all(),
    queries: database.prepare(
      "SELECT * FROM deployment_sync_queries ORDER BY query_key",
    ).all(),
    dependencies: database.prepare(
      `SELECT * FROM deployment_sync_query_dependencies
       ORDER BY query_key, role, generation, dependency_key`,
    ).all(),
    pending: database.prepare(
      "SELECT * FROM deployment_sync_pending_publications ORDER BY query_key",
    ).all(),
  });
}

function expectDefect<A, E>(exit: Exit.Exit<A, E>): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  expect(Cause.hasDies(exit.cause)).toBe(true);
}

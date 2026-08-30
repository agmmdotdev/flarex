import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  type CompletionEvidenceInput,
  type CompletionSqlStage,
  makeCompletionEvidence,
  makeCompletionSqlProbe,
} from "./deploymentSyncCompletionTestSupport";
import {
  beginEvaluation,
  completionInput,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const REPLACEMENT_WRITE_STAGES = Object.freeze([
  "complete-query-write",
  "active-dependencies-delete",
  "active-dependency-insert",
  "active-dependency-insert",
  "completion-dependencies-delete",
  "completion-dependency-insert",
  "completion-dependency-insert",
  "pending-publication-delete",
  "pending-publication-insert",
  "scope-write",
] as const satisfies readonly CompletionSqlStage[]);

describe("deployment query-sync evaluation state atomicity", () => {
  it("rolls back completion rows, dependencies, pending work, and scope together", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const attempt = await beginEvaluation(prepared, queryDescriptor(11));
      const input = completionInput(prepared, attempt, "atomic-completion");
      const before = snapshotEvaluationState(prepared.database);
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
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
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
      const before = snapshotEvaluationState(prepared.database);
      installScopeFailureTrigger(prepared.database);

      const exit = await Effect.runPromiseExit(
        prepared.state.recordEvaluationAttemptOutcome(
          claimed.attempt,
          "terminalRefusal",
        ),
      );

      expectDefect(exit);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
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

  it("rolls back before and after every changed-digest completion write", async () => {
    const baseline = await prepareReplacementFixture();
    try {
      baseline.probe.start();
      await expect(completeEvaluation(
        baseline.prepared,
        baseline.attempt,
        baseline.input,
      )).resolves.toMatchObject({ _tag: "completed" });
      expect(onlyWrites(baseline.probe.stop())).toEqual(
        REPLACEMENT_WRITE_STAGES,
      );
    } finally {
      baseline.prepared.database.close();
    }

    for (const phase of ["before", "after"] as const) {
      for (
        let writeOrdinal = 1;
        writeOrdinal <= REPLACEMENT_WRITE_STAGES.length;
        writeOrdinal += 1
      ) {
        const fixture = await prepareReplacementFixture();
        try {
          const before = snapshotEvaluationState(fixture.prepared.database);
          const fault = new Error(
            `forced ${phase} completion write ${writeOrdinal}`,
          );
          fixture.probe.start({ phase, writeOrdinal, cause: fault });

          const exit = await Effect.runPromiseExit(
            fixture.prepared.state.completeQueryEvaluation(
              fixture.attempt,
              fixture.input.evaluation,
              fixture.input.refresh,
              fixture.input.publication,
            ),
          );

          expectDefect(exit, fault);
          expect(onlyWrites(fixture.probe.stop())).toEqual(
            REPLACEMENT_WRITE_STAGES.slice(0, writeOrdinal),
          );
          expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
            before,
          );
          await expect(completeEvaluation(
            fixture.prepared,
            fixture.attempt,
            fixture.input,
          )).resolves.toMatchObject({ _tag: "completed" });
        } finally {
          fixture.prepared.database.close();
        }
      }
    }
  }, 60_000);
});

async function prepareReplacementFixture(): Promise<Readonly<{
  readonly prepared: PreparedEvaluationState;
  readonly probe: ReturnType<typeof makeCompletionSqlProbe>;
  readonly attempt: Awaited<ReturnType<typeof beginEvaluation>>;
  readonly input: CompletionEvidenceInput;
}>> {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(71);
  const firstAttempt = await beginEvaluation(prepared, descriptor);
  await completeEvaluation(
    prepared,
    firstAttempt,
    makeCompletionEvidence(prepared, firstAttempt, {
      dependencyLabels: ["old-a", "old-b"],
      resultSeed: 171,
      publicationLabel: "old-pending",
    }),
  );
  const batch = captureCompletionBatch(
    prepared.binding,
    12n,
    ["old-a"],
  );
  await applyCompletionBatch(prepared, batch);
  const attempt = await beginEvaluation(prepared, descriptor, {
    expectedActiveGeneration: firstAttempt.generation,
    requestedDirtyThroughSequence: batch.sourceSequence,
  });
  return Object.freeze({
    prepared,
    probe,
    attempt,
    input: makeCompletionEvidence(prepared, attempt, {
      dependencyLabels: ["new-a", "new-b"],
      resultSeed: 172,
      publicationLabel: "replacement-pending",
    }),
  });
}

function onlyWrites(
  stages: readonly CompletionSqlStage[],
): readonly CompletionSqlStage[] {
  return stages.filter(stage => (
    stage.endsWith("-write")
    || stage.endsWith("-delete")
    || stage.endsWith("-insert")
  ));
}

function installScopeFailureTrigger(
  database: import("node:sqlite").DatabaseSync,
): void {
  database.exec(`CREATE TRIGGER fail_evaluation_scope_write
    BEFORE UPDATE ON deployment_sync_scope_state
    BEGIN
      SELECT RAISE(FAIL, 'forced evaluation scope rollback');
    END`);
}

function expectDefect<A, E>(
  exit: Exit.Exit<A, E>,
  expected?: Error,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  expect(Cause.hasDies(exit.cause)).toBe(true);
  if (expected !== undefined) {
    expect(success(Cause.findDefect(exit.cause))).toBe(expected);
  }
}

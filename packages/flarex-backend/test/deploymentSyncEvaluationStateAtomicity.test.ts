import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import {
  DeploymentQuerySyncAdapterInvariantDefect,
} from "../src/deploymentSync/StateStorage";
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

const AFFECTED_ROW_WRITE_STAGES = Object.freeze([
  "complete-query-write",
  "active-dependencies-delete",
  "active-dependency-insert",
  "completion-dependencies-delete",
  "completion-dependency-insert",
  "pending-publication-delete",
  "pending-publication-insert",
  "scope-write",
] as const satisfies readonly CompletionSqlStage[]);

const AFFECTED_ROW_REFUSAL_SCENARIOS = [
  { name: "query CAS", writeOrdinal: 1, mode: "skip",
    expectedStage: "complete-query-cas" },
  { name: "active dependency delete", writeOrdinal: 2, mode: "skip",
    expectedStage: "active-dependency-delete" },
  { name: "active dependency insert", writeOrdinal: 3,
    mode: "zeroRowsWritten", expectedStage: "active-dependency-insert" },
  { name: "completion dependency delete", writeOrdinal: 4, mode: "skip",
    expectedStage: "completion-dependency-delete" },
  { name: "completion dependency insert", writeOrdinal: 5,
    mode: "zeroRowsWritten", expectedStage: "completion-dependency-insert" },
  { name: "pending publication delete", writeOrdinal: 6, mode: "skip",
    expectedStage: "pending-publication-delete" },
  { name: "pending publication insert", writeOrdinal: 7,
    mode: "zeroRowsWritten", expectedStage: "pending-publication-insert" },
  { name: "scope CAS", writeOrdinal: 8, mode: "skip",
    expectedStage: "write" },
] as const;

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
      expect(attemptedWriteStages(baseline.probe.stop())).toEqual(
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
          expect(attemptedWriteStages(fixture.probe.stop())).toEqual(
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

  it.each(AFFECTED_ROW_REFUSAL_SCENARIOS)(
    "refuses $name affected-row evidence and rolls back",
    async scenario => {
      const fixture = await prepareReplacementFixture(1);
      try {
        const before = snapshotEvaluationState(fixture.prepared.database);
        fixture.probe.startAffectedRowRefusal(
          scenario.writeOrdinal,
          scenario.mode,
        );

        const exit = await Effect.runPromiseExit(
          fixture.prepared.state.completeQueryEvaluation(
            fixture.attempt,
            fixture.input.evaluation,
            fixture.input.refresh,
            fixture.input.publication,
          ),
        );

        expectAdapterInvariantDefect(exit, scenario.expectedStage);
        expect(attemptedWriteStages(fixture.probe.stop())).toEqual(
          AFFECTED_ROW_WRITE_STAGES.slice(0, scenario.writeOrdinal),
        );
        expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
          before,
        );
        await expect(completeEvaluation(
          fixture.prepared,
          fixture.attempt,
          fixture.input,
        )).resolves.toMatchObject({
          _tag: "completed",
          generation: fixture.attempt.generation,
          publicationDisposition: { _tag: "pending" },
        });
      } finally {
        fixture.prepared.database.close();
      }
    },
  );

  it("replays a committed completion after response loss without another write", async () => {
    const fixture = await prepareReplacementFixture(1);
    try {
      const responseLoss = new Error("forced committed completion response loss");
      fixture.probe.start();
      let lostReceipt: unknown;

      const lostExit = await Effect.runPromiseExit(
        fixture.prepared.state.completeQueryEvaluation(
          fixture.attempt,
          fixture.input.evaluation,
          fixture.input.refresh,
          fixture.input.publication,
        ).pipe(Effect.flatMap(receipt => {
          lostReceipt = receipt;
          return Effect.die(responseLoss);
        })),
      );

      expectDefect(lostExit, responseLoss);
      expect(attemptedWriteStages(fixture.probe.stop())).toEqual(
        AFFECTED_ROW_WRITE_STAGES,
      );
      const afterCommit = snapshotEvaluationState(fixture.prepared.database);

      fixture.probe.start();
      const replayed = await completeEvaluation(
        fixture.prepared,
        fixture.attempt,
        fixture.input,
      );

      expect(replayed).toMatchObject({
        _tag: "replayed",
        generation: fixture.attempt.generation,
        publicationDisposition: { _tag: "pending" },
      });
      expect(lostReceipt).toEqual({ ...replayed, _tag: "completed" });
      expect(attemptedWriteStages(fixture.probe.stop())).toEqual([]);
      expect(snapshotEvaluationState(fixture.prepared.database)).toEqual(
        afterCommit,
      );
    } finally {
      fixture.prepared.database.close();
    }
  });
});

async function prepareReplacementFixture(
  dependencyCount = 2,
): Promise<Readonly<{
  readonly prepared: PreparedEvaluationState;
  readonly probe: ReturnType<typeof makeCompletionSqlProbe>;
  readonly attempt: Awaited<ReturnType<typeof beginEvaluation>>;
  readonly input: CompletionEvidenceInput;
}>> {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(71);
  const firstAttempt = await beginEvaluation(prepared, descriptor);
  const oldDependencies = Array.from(
    { length: dependencyCount },
    (_value, index) => `old-${index}`,
  );
  const newDependencies = Array.from(
    { length: dependencyCount },
    (_value, index) => `new-${index}`,
  );
  const invalidatedDependency = oldDependencies[0];
  if (invalidatedDependency === undefined) {
    throw new Error("Replacement fixture requires at least one dependency.");
  }
  await completeEvaluation(
    prepared,
    firstAttempt,
    makeCompletionEvidence(prepared, firstAttempt, {
      dependencyLabels: oldDependencies,
      resultSeed: 171,
      publicationLabel: "old-pending",
    }),
  );
  const batch = captureCompletionBatch(
    prepared.binding,
    12n,
    [invalidatedDependency],
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
      dependencyLabels: newDependencies,
      resultSeed: 172,
      publicationLabel: "replacement-pending",
    }),
  });
}

function expectAdapterInvariantDefect<A, E>(
  exit: Exit.Exit<A, E>,
  expectedStage: string,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected Effect defect.");
  const defect = success(Cause.findDefect(exit.cause));
  expect(defect).toBeInstanceOf(DeploymentQuerySyncAdapterInvariantDefect);
  expect(defect).toMatchObject({
    operation: "completeQueryEvaluation",
    stage: expectedStage,
  });
}

function attemptedWriteStages(
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

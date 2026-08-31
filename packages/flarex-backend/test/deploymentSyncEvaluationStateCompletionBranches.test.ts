import type {
  QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  COMPLETION_COMMON_READ_STAGES,
  type CompletionEvidenceInput,
  type CompletionSqlProbe,
  makeCompletionEvidence,
  makeCompletionSqlProbe,
} from "./deploymentSyncCompletionTestSupport";
import {
  beginEvaluation,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  snapshotEvaluationState,
} from "./deploymentSyncEvaluationStateTestSupport";

interface NoWriteScenario {
  readonly prepared: PreparedEvaluationState;
  readonly probe: CompletionSqlProbe;
  readonly attempt: QueryEvaluationAttempt;
  readonly input: CompletionEvidenceInput;
  readonly expectedTag:
    | "refreshRequired"
    | "resnapshotRequired"
    | "rerunRequired"
    | "superseded"
    | "recoveryEvidenceExpired";
}

const noWriteScenarios = [
  ["refresh-required", prepareRefreshRequired],
  ["resnapshot-required", prepareResnapshotRequired],
  ["rerun-required", prepareRerunRequired],
  ["superseded", prepareSuperseded],
  ["recovery-evidence-expired", prepareRecoveryEvidenceExpired],
] as const;

describe("deployment query-sync completion control flow", () => {
  it.each(noWriteScenarios)(
    "returns %s after only scalar reads and no writes",
    async (_name, prepareScenario) => {
      const scenario = await prepareScenario();
      try {
        const before = snapshotEvaluationState(scenario.prepared.database);
        scenario.probe.start();

        const receipt = await completeEvaluation(
          scenario.prepared,
          scenario.attempt,
          scenario.input,
        );

        expect(receipt._tag).toBe(scenario.expectedTag);
        expect(scenario.probe.stop()).toEqual(COMPLETION_COMMON_READ_STAGES);
        expect(snapshotEvaluationState(scenario.prepared.database)).toEqual(
          before,
        );
      } finally {
        scenario.prepared.database.close();
      }
    },
  );

  it("uses exact material, pending replay, and unchanged replay stages", async () => {
    const probe = makeCompletionSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const descriptor = queryDescriptor(31);
      const firstAttempt = await beginEvaluation(prepared, descriptor);
      const firstInput = makeCompletionEvidence(prepared, firstAttempt, {
        dependencyLabels: ["alpha", "beta"],
        resultSeed: 131,
        publicationLabel: "first-pending",
      });
      probe.start();

      await expect(completeEvaluation(
        prepared,
        firstAttempt,
        firstInput,
      )).resolves.toMatchObject({ _tag: "completed" });
      expect(probe.stop()).toEqual([
        ...COMPLETION_COMMON_READ_STAGES,
        "active-dependencies-read",
        "completion-dependencies-read",
        "pending-publication-read",
        "in-flight-publication-read",
        "publication-state-read",
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
      ]);

      const afterFirst = snapshotEvaluationState(prepared.database);
      probe.start();
      await expect(completeEvaluation(
        prepared,
        firstAttempt,
        firstInput,
      )).resolves.toMatchObject({ _tag: "replayed" });
      expect(probe.stop()).toEqual([
        ...COMPLETION_COMMON_READ_STAGES,
        "completion-dependencies-read",
        "pending-publication-read",
      ]);
      expect(snapshotEvaluationState(prepared.database)).toEqual(afterFirst);

      const invalidReplay = makeCompletionEvidence(prepared, firstAttempt, {
        dependencyLabels: ["alpha", "beta"],
        resultSeed: 132,
        publicationLabel: "first-pending",
      });
      probe.start();
      const replayExit = await runCompletionExit(
        prepared,
        firstAttempt,
        invalidReplay,
      );
      expectTypedFailure(replayExit, {
        _tag: "InvalidQueryCompletionReplayError",
        operation: "completeQueryEvaluation",
        reason: "fingerprintMismatch",
        queryKey: firstAttempt.descriptor.queryKey,
        generation: firstAttempt.generation,
      });
      expect(probe.stop()).toEqual([
        ...COMPLETION_COMMON_READ_STAGES,
        "completion-dependencies-read",
        "pending-publication-read",
      ]);
      expect(snapshotEvaluationState(prepared.database)).toEqual(afterFirst);

      const contentMismatch = makeCompletionEvidence(prepared, firstAttempt, {
        dependencyLabels: ["alpha", "beta"],
        resultSeed: 131,
        publicationLabel: "different-content",
      });
      probe.start();
      const contentExit = await runCompletionExit(
        prepared,
        firstAttempt,
        contentMismatch,
      );
      expectTypedFailure(contentExit, {
        _tag: "InvalidQueryCompletionReplayError",
        operation: "completeQueryEvaluation",
        reason: "publicationContentMismatch",
        queryKey: firstAttempt.descriptor.queryKey,
        generation: firstAttempt.generation,
      });
      expect(probe.stop()).toEqual([
        ...COMPLETION_COMMON_READ_STAGES,
        "completion-dependencies-read",
        "pending-publication-read",
      ]);
      expect(snapshotEvaluationState(prepared.database)).toEqual(afterFirst);

      const batch = captureCompletionBatch(
        prepared.binding,
        12n,
        ["alpha"],
      );
      await applyCompletionBatch(prepared, batch);
      const secondAttempt = await beginEvaluation(prepared, descriptor, {
        expectedActiveGeneration: firstAttempt.generation,
        requestedDirtyThroughSequence: batch.sourceSequence,
      });
      const unchanged = makeCompletionEvidence(prepared, secondAttempt, {
        dependencyLabels: ["alpha", "beta"],
        resultSeed: 131,
        publicationLabel: "ignored-unchanged-content",
      });
      const pendingBeforeUnchanged = snapshotEvaluationState(
        prepared.database,
      ).pending;
      probe.start();
      await expect(completeEvaluation(
        prepared,
        secondAttempt,
        unchanged,
      )).resolves.toMatchObject({ _tag: "completed" });
      expect(probe.stop()).toEqual([
        ...COMPLETION_COMMON_READ_STAGES,
        "active-dependencies-read",
        "completion-dependencies-read",
        "pending-publication-read",
        "in-flight-publication-read",
        "publication-state-read",
        "complete-query-write",
        "active-dependencies-delete",
        "active-dependency-insert",
        "active-dependency-insert",
        "completion-dependencies-delete",
        "completion-dependency-insert",
        "completion-dependency-insert",
        "scope-write",
      ]);
      expect(snapshotEvaluationState(prepared.database).pending).toEqual(
        pendingBeforeUnchanged,
      );

      const afterUnchanged = snapshotEvaluationState(prepared.database);
      probe.start();
      await expect(completeEvaluation(
        prepared,
        secondAttempt,
        unchanged,
      )).resolves.toMatchObject({ _tag: "replayed" });
      expect(probe.stop()).toEqual([
        ...COMPLETION_COMMON_READ_STAGES,
        "completion-dependencies-read",
      ]);
      expect(snapshotEvaluationState(prepared.database)).toEqual(
        afterUnchanged,
      );
    } finally {
      prepared.database.close();
    }
  });

  it("stops invalid evidence at the scalar stage without writes", async () => {
    const probe = makeCompletionSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const attempt = await beginEvaluation(prepared, queryDescriptor(32));
      const evaluation = makeCompletionEvidence(prepared, attempt, {
        dependencyLabels: ["expected"],
      });
      const other = makeCompletionEvidence(prepared, attempt, {
        dependencyLabels: ["other"],
      });
      const mismatched: CompletionEvidenceInput = Object.freeze({
        evaluation: evaluation.evaluation,
        refresh: other.refresh,
        publication: evaluation.publication,
      });
      const before = snapshotEvaluationState(prepared.database);
      probe.start();

      const exit = await runCompletionExit(prepared, attempt, mismatched);

      expectTypedFailure(exit, {
        _tag: "InvalidQueryEvidenceError",
        operation: "completeQueryEvaluation",
        reason: "evaluationRefreshDependenciesMismatch",
      });
      expect(probe.stop()).toEqual(COMPLETION_COMMON_READ_STAGES);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });

  it("stops corrupt material dependencies before later reads or writes", async () => {
    const probe = makeCompletionSqlProbe();
    const prepared = await prepareEvaluationState(probe.hooks);
    try {
      const descriptor = queryDescriptor(33);
      const firstAttempt = await beginEvaluation(prepared, descriptor);
      const firstInput = makeCompletionEvidence(prepared, firstAttempt, {
        dependencyLabels: ["corrupt-active"],
      });
      await completeEvaluation(prepared, firstAttempt, firstInput);
      const batch = captureCompletionBatch(
        prepared.binding,
        12n,
        ["corrupt-active"],
      );
      await applyCompletionBatch(prepared, batch);
      const secondAttempt = await beginEvaluation(prepared, descriptor, {
        expectedActiveGeneration: firstAttempt.generation,
        requestedDirtyThroughSequence: batch.sourceSequence,
      });
      const secondInput = makeCompletionEvidence(prepared, secondAttempt, {
        dependencyLabels: ["replacement"],
        resultSeed: 133,
      });
      prepared.database.prepare(`UPDATE deployment_sync_query_dependencies
        SET generation = '999'
        WHERE role = 'active'`).run();
      const before = snapshotEvaluationState(prepared.database);
      probe.start();

      const exit = await runCompletionExit(
        prepared,
        secondAttempt,
        secondInput,
      );

      expectTypedFailure(exit, {
        _tag: "QuerySyncStoredStateCorruptError",
        operation: "completeQueryEvaluation",
        reason: "storedAggregateInvalid",
      });
      expect(probe.stop()).toEqual([
        ...COMPLETION_COMMON_READ_STAGES,
        "active-dependencies-read",
      ]);
      expect(snapshotEvaluationState(prepared.database)).toEqual(before);
    } finally {
      prepared.database.close();
    }
  });
});

async function prepareRefreshRequired(): Promise<NoWriteScenario> {
  const base = await prepareBaseScenario(41);
  const input = makeCompletionEvidence(base.prepared, base.attempt);
  await applyCompletionBatch(
    base.prepared,
    captureCompletionBatch(base.prepared.binding, 12n),
  );
  return Object.freeze({ ...base, input, expectedTag: "refreshRequired" });
}

async function prepareResnapshotRequired(): Promise<NoWriteScenario> {
  const base = await prepareBaseScenario(42);
  return Object.freeze({
    ...base,
    input: makeCompletionEvidence(base.prepared, base.attempt, {
      evaluationWitnessSeed: 141,
      refreshWitnessSeed: 142,
    }),
    expectedTag: "resnapshotRequired",
  });
}

async function prepareRerunRequired(): Promise<NoWriteScenario> {
  const base = await prepareBaseScenario(43);
  const batch = captureCompletionBatch(
    base.prepared.binding,
    12n,
    ["rerun"],
  );
  await applyCompletionBatch(base.prepared, batch);
  return Object.freeze({
    ...base,
    input: makeCompletionEvidence(base.prepared, base.attempt, {
      dependencyLabels: ["rerun"],
      refreshThroughSequence: 12n,
      refreshBatches: [batch],
    }),
    expectedTag: "rerunRequired",
  });
}

async function prepareSuperseded(): Promise<NoWriteScenario> {
  const history = await prepareThreeGenerationHistory(44, false);
  return Object.freeze({
    prepared: history.prepared,
    probe: history.probe,
    attempt: history.firstAttempt,
    input: history.firstInput,
    expectedTag: "superseded",
  });
}

async function prepareRecoveryEvidenceExpired(): Promise<NoWriteScenario> {
  const history = await prepareThreeGenerationHistory(45, true);
  return Object.freeze({
    prepared: history.prepared,
    probe: history.probe,
    attempt: history.firstAttempt,
    input: history.firstInput,
    expectedTag: "recoveryEvidenceExpired",
  });
}

async function prepareBaseScenario(seed: number) {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const attempt = await beginEvaluation(prepared, queryDescriptor(seed));
  return Object.freeze({ prepared, probe, attempt });
}

async function prepareThreeGenerationHistory(
  seed: number,
  includeThirdGeneration: boolean,
) {
  const base = await prepareBaseScenario(seed);
  const descriptor = base.attempt.descriptor;
  const firstInput = makeCompletionEvidence(base.prepared, base.attempt, {
    dependencyLabels: ["history"],
    resultSeed: 151,
  });
  await completeEvaluation(base.prepared, base.attempt, firstInput);
  const secondBatch = captureCompletionBatch(
    base.prepared.binding,
    12n,
    ["history"],
  );
  await applyCompletionBatch(base.prepared, secondBatch);
  const secondAttempt = await beginEvaluation(base.prepared, descriptor, {
    expectedActiveGeneration: base.attempt.generation,
    requestedDirtyThroughSequence: secondBatch.sourceSequence,
  });
  await completeEvaluation(
    base.prepared,
    secondAttempt,
    makeCompletionEvidence(base.prepared, secondAttempt, {
      dependencyLabels: ["history"],
      resultSeed: 152,
    }),
  );
  if (includeThirdGeneration) {
    const thirdBatch = captureCompletionBatch(
      base.prepared.binding,
      13n,
      ["history"],
    );
    await applyCompletionBatch(base.prepared, thirdBatch);
    const thirdAttempt = await beginEvaluation(base.prepared, descriptor, {
      expectedActiveGeneration: secondAttempt.generation,
      requestedDirtyThroughSequence: thirdBatch.sourceSequence,
    });
    await completeEvaluation(
      base.prepared,
      thirdAttempt,
      makeCompletionEvidence(base.prepared, thirdAttempt, {
        dependencyLabels: ["history"],
        resultSeed: 153,
      }),
    );
  }
  return Object.freeze({
    prepared: base.prepared,
    probe: base.probe,
    firstAttempt: base.attempt,
    firstInput,
  });
}

function runCompletionExit(
  prepared: PreparedEvaluationState,
  attempt: QueryEvaluationAttempt,
  input: CompletionEvidenceInput,
) {
  return Effect.runPromiseExit(prepared.state.completeQueryEvaluation(
    attempt,
    input.evaluation,
    input.refresh,
    input.publication,
  ));
}

function expectTypedFailure<A, E>(
  exit: Exit.Exit<A, E>,
  shape: Readonly<Record<string, unknown>>,
): void {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject(
    shape,
  );
}

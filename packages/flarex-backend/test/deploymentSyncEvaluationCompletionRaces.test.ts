import type {
  AdmittedInvalidationBatch,
  QueryDescriptor,
  QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import type {
  ApplyAdmittedBatchReceipt,
  CompleteQueryEvaluationReceipt,
} from "@flarex/query-sync/internal/transition-plan";
import {
  createReferenceModel,
  reduceReferenceModel,
  type QuerySyncReferenceModel,
  type ReferenceModelTransition,
} from "@flarex/query-sync/testing/reference-model";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  captureCompletionBatch,
  COMPLETION_COMMON_READ_STAGES,
  completeEvaluation,
  type CompletionEvidenceInput,
  type CompletionSqlProbe,
  type CompletionSqlStage,
  makeCompletionEvidence,
  makeCompletionSqlProbe,
} from "./deploymentSyncCompletionTestSupport";
import {
  beginEvaluation,
  beginRequest,
  prepareEvaluationState,
  type PreparedEvaluationState,
  queryDescriptor,
  readEvaluationScope,
  snapshotEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const MATERIAL_COMPLETION_TRACE = Object.freeze([
  ...COMPLETION_COMMON_READ_STAGES,
  "active-dependencies-read",
  "completion-dependencies-read",
  "pending-publication-read",
  "complete-query-write",
  "active-dependencies-delete",
  "active-dependency-insert",
  "completion-dependencies-delete",
  "completion-dependency-insert",
  "pending-publication-delete",
  "pending-publication-insert",
  "scope-write",
] as const satisfies readonly CompletionSqlStage[]);

type CompletionInvalidationOrder =
  | "completionFirst"
  | "invalidationFirst";

interface CompletionInvalidationFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: CompletionSqlProbe;
  readonly reference: QuerySyncReferenceModel;
  readonly descriptor: QueryDescriptor;
  readonly attempt: QueryEvaluationAttempt;
  readonly completion: CompletionEvidenceInput;
  readonly invalidation: AdmittedInvalidationBatch;
}

interface CompletionInvalidationHistory {
  readonly completion: ReferenceModelTransition;
  readonly invalidation: ReferenceModelTransition;
  readonly finalReference: QuerySyncReferenceModel;
}

interface ActualCompletionInvalidationHistory {
  readonly completion: CompleteQueryEvaluationReceipt;
  readonly invalidation: ApplyAdmittedBatchReceipt;
  readonly completionTrace: readonly CompletionSqlStage[];
  readonly beforeCompletion: ReturnType<typeof snapshotEvaluationState>;
}

describe("deployment query-sync evaluation completion races", () => {
  it.each([
    {
      name: "completion before exact-next invalidation",
      order: "completionFirst",
      completionTrace: MATERIAL_COMPLETION_TRACE,
      expectedWorkRevision: "3",
    },
    {
      name: "exact-next invalidation before completion",
      order: "invalidationFirst",
      completionTrace: COMPLETION_COMMON_READ_STAGES,
      expectedWorkRevision: "1",
    },
  ] as const)("matches the complete $name history", async scenario => {
    const fixture = await prepareCompletionInvalidationFixture();
    try {
      const before = snapshotEvaluationState(fixture.prepared.database);
      const completeFirst = buildCompletionInvalidationHistory(
        fixture,
        "completionFirst",
      );
      const invalidationFirst = buildCompletionInvalidationHistory(
        fixture,
        "invalidationFirst",
      );
      expect(completeFirst.finalReference.state).not.toEqual(
        invalidationFirst.finalReference.state,
      );
      const expected = scenario.order === "completionFirst"
        ? completeFirst
        : invalidationFirst;

      const actual = await runCompletionInvalidationHistory(
        fixture,
        scenario.order,
      );

      expect(actual.completion).toEqual(
        receiptWithoutState(expected.completion.decision),
      );
      expect(actual.invalidation).toEqual(
        receiptWithoutState(expected.invalidation.decision),
      );
      expect(actual.completionTrace).toEqual(scenario.completionTrace);

      const after = snapshotEvaluationState(fixture.prepared.database);
      expectScopeMatchesReference(fixture.prepared, expected.finalReference);
      expect(readEvaluationScope(fixture.prepared.database)).toMatchObject({
        evaluationWorkRevision: scenario.expectedWorkRevision,
        fairnessAnchor: null,
      });
      if (scenario.order === "completionFirst") {
        expect(actual.completion).toMatchObject({
          _tag: "completed",
          generation: fixture.attempt.generation,
          publicationDisposition: { _tag: "pending" },
        });
        expect(actual.invalidation).toEqual({
          _tag: "applied",
          appliedSequence: fixture.invalidation.sourceSequence,
          affectedQueryKeys: [fixture.descriptor.queryKey],
        });
        expectCompletedThenInvalidatedProjection(fixture, before, after);
      } else {
        expect(actual.invalidation).toEqual({
          _tag: "applied",
          appliedSequence: fixture.invalidation.sourceSequence,
          affectedQueryKeys: [],
        });
        expect(actual.completion).toEqual({
          _tag: "refreshRequired",
          refreshedThroughSequence:
            fixture.completion.refresh.refreshedThroughSequence,
          requiredThroughSequence: fixture.invalidation.sourceSequence,
        });
        expect(after).toEqual(actual.beforeCompletion);
        expect(after.queries).toEqual(before.queries);
        expect(after.dependencies).toEqual(before.dependencies);
        expect(after.pending).toEqual(before.pending);
      }
    } finally {
      fixture.prepared.database.close();
    }
  });
});

async function prepareCompletionInvalidationFixture(): Promise<
  CompletionInvalidationFixture
> {
  const probe = makeCompletionSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(280);
  const reference = success(createReferenceModel(
    prepared.binding.bootstrapCursor,
  ));
  const request = beginRequest(prepared.binding, descriptor);
  const referenceBegin = success(reduceReferenceModel(reference, {
    _tag: "beginQueryEvaluation",
    request,
  }));
  if (referenceBegin.decision._tag !== "created") {
    throw new Error("Expected completion-race reference creation.");
  }
  const attempt = await beginEvaluation(prepared, descriptor);
  expect(attempt).toEqual(referenceBegin.decision.attempt);
  const completion = makeCompletionEvidence(prepared, attempt, {
    dependencyLabels: ["completion-race"],
    resultSeed: 281,
    publicationLabel: "completion-race-pending",
  });
  const invalidation = captureCompletionBatch(
    prepared.binding,
    12n,
    ["completion-race"],
  );
  return Object.freeze({
    prepared,
    probe,
    reference: referenceBegin.model,
    descriptor,
    attempt,
    completion,
    invalidation,
  });
}

function buildCompletionInvalidationHistory(
  fixture: CompletionInvalidationFixture,
  order: CompletionInvalidationOrder,
): CompletionInvalidationHistory {
  if (order === "completionFirst") {
    const completion = success(reduceReferenceModel(fixture.reference, {
      _tag: "completeQueryEvaluation",
      attempt: fixture.attempt,
      ...fixture.completion,
    }));
    const invalidation = success(reduceReferenceModel(completion.model, {
      _tag: "applyAdmittedInvalidations",
      batch: fixture.invalidation,
    }));
    return Object.freeze({
      completion,
      invalidation,
      finalReference: invalidation.model,
    });
  }
  const invalidation = success(reduceReferenceModel(fixture.reference, {
    _tag: "applyAdmittedInvalidations",
    batch: fixture.invalidation,
  }));
  const completion = success(reduceReferenceModel(invalidation.model, {
    _tag: "completeQueryEvaluation",
    attempt: fixture.attempt,
    ...fixture.completion,
  }));
  return Object.freeze({
    completion,
    invalidation,
    finalReference: completion.model,
  });
}

async function runCompletionInvalidationHistory(
  fixture: CompletionInvalidationFixture,
  order: CompletionInvalidationOrder,
): Promise<ActualCompletionInvalidationHistory> {
  if (order === "completionFirst") {
    const beforeCompletion = snapshotEvaluationState(
      fixture.prepared.database,
    );
    fixture.probe.start();
    const completion = await completeEvaluation(
      fixture.prepared,
      fixture.attempt,
      fixture.completion,
    );
    const completionTrace = fixture.probe.stop();
    const invalidation = await Effect.runPromise(
      fixture.prepared.state.applyAdmittedBatchAndAdvance(
        fixture.invalidation,
      ),
    );
    return Object.freeze({
      completion,
      invalidation,
      completionTrace,
      beforeCompletion,
    });
  }
  const invalidation = await Effect.runPromise(
    fixture.prepared.state.applyAdmittedBatchAndAdvance(
      fixture.invalidation,
    ),
  );
  const beforeCompletion = snapshotEvaluationState(fixture.prepared.database);
  fixture.probe.start();
  const completion = await completeEvaluation(
    fixture.prepared,
    fixture.attempt,
    fixture.completion,
  );
  const completionTrace = fixture.probe.stop();
  return Object.freeze({
    completion,
    invalidation,
    completionTrace,
    beforeCompletion,
  });
}

function expectCompletedThenInvalidatedProjection(
  fixture: CompletionInvalidationFixture,
  before: ReturnType<typeof snapshotEvaluationState>,
  after: ReturnType<typeof snapshotEvaluationState>,
): void {
  const beforeQuery = onlyQueryRow(before.queries);
  const dependencyKey = onlyDependencyKey(fixture.completion);
  const generation = fixture.attempt.generation.toString();
  const registrationSequence = fixture.attempt.registrationCursor
    .appliedThroughSequence.toString();
  const evaluationSequence = fixture.completion.evaluation.snapshotSequence
    .toString();
  const refreshedSequence = fixture.completion.refresh.refreshedThroughSequence
    .toString();
  expect(after.queries).toEqual([{
    ...beforeQuery,
    active_generation: generation,
    active_evaluation_snapshot_sequence: evaluationSequence,
    active_fresh_through_sequence: refreshedSequence,
    active_dirty_through_sequence: fixture.invalidation.sourceSequence
      .toString(),
    active_result_digest: fixture.completion.evaluation.resultDigest,
    active_authority_witness: fixture.completion.refresh.authorityWitness,
    provisional_generation: null,
    provisional_expected_active_generation: null,
    provisional_registration_sequence: null,
    provisional_requested_dirty_through_sequence: null,
    provisional_disposition: null,
    completion_generation: generation,
    completion_expected_active_generation: null,
    completion_registration_sequence: registrationSequence,
    completion_requested_dirty_through_sequence: null,
    completion_evaluation_snapshot_sequence: evaluationSequence,
    completion_evaluation_authority_witness:
      fixture.completion.evaluation.authorityWitness,
    completion_refreshed_through_sequence: refreshedSequence,
    completion_relevant_through_sequence: null,
    completion_refresh_authority_witness:
      fixture.completion.refresh.authorityWitness,
    completion_result_digest: fixture.completion.evaluation.resultDigest,
    completion_publication_disposition: "pending",
    preceding_completion_generation: null,
  }]);
  expect(after.dependencies).toEqual([
    {
      role: "active",
      query_key: fixture.descriptor.queryKey,
      generation,
      dependency_key: dependencyKey,
    },
    {
      role: "completion",
      query_key: fixture.descriptor.queryKey,
      generation,
      dependency_key: dependencyKey,
    },
  ]);
  expect(after.pending).toEqual([{
    query_key: fixture.descriptor.queryKey,
    generation,
    query_identity: fixture.descriptor.queryIdentity,
    completed_through_sequence: refreshedSequence,
    result_digest: fixture.completion.evaluation.resultDigest,
    content: fixture.completion.publication.content,
  }]);
}

function onlyDependencyKey(input: CompletionEvidenceInput): string {
  const dependencyKey = input.evaluation.dependencyKeys[0];
  if (
    dependencyKey === undefined
    || input.evaluation.dependencyKeys.length !== 1
  ) {
    throw new Error("Expected exactly one completion-race dependency.");
  }
  return dependencyKey;
}

function expectScopeMatchesReference(
  prepared: PreparedEvaluationState,
  reference: QuerySyncReferenceModel,
): void {
  expect(readEvaluationScope(prepared.database)).toEqual({
    appliedThroughSequence:
      reference.state.cursor.appliedThroughSequence.toString(),
    evaluationWorkRevision:
      reference.state.evaluationWork.revision.toString(),
    fairnessAnchor: reference.state.evaluationWork.fairnessAnchor,
    metrics: reference.state.metrics,
  });
}

function onlyQueryRow(
  rows: readonly Record<string, unknown>[],
): Readonly<Record<string, unknown>> {
  const row = rows[0];
  if (row === undefined || rows.length !== 1) {
    throw new Error("Expected exactly one retained query row.");
  }
  return row;
}

function receiptWithoutState<Decision extends { readonly state: unknown }>(
  decision: Decision,
): Omit<Decision, "state"> {
  const { state: _state, ...receipt } = decision;
  return receipt;
}

import type { DatabaseSync } from "node:sqlite";

import type {
  CanonicalDependencyKey,
  QuerySyncStateMetrics,
} from "@flarex/query-sync/internal/kernel";
import {
  createReferenceModel,
  reduceReferenceModel,
} from "@flarex/query-sync/testing/reference-model";
import { describe, expect, it } from "vitest";

import {
  applyCompletionBatch,
  captureCompletionBatch,
  completeEvaluation,
  makeCompletionEvidence,
} from "./deploymentSyncCompletionTestSupport";
import {
  beginEvaluation,
  beginRequest,
  prepareEvaluationState,
  queryDescriptor,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

const FIRST_COMPLETION_METRICS = Object.freeze({
  queryCount: 1,
  retainedIdentityBytes: 19,
  dependencyMemberships: 2,
  pendingPublicationCount: 1,
  inFlightPublicationCount: 0,
  retainedPublicationContentBytes: 13,
  settlementEnvelopeBytes: 0,
  countedCanonicalBytes: 622,
} satisfies QuerySyncStateMetrics);

const REPLACEMENT_COMPLETION_METRICS = Object.freeze({
  ...FIRST_COMPLETION_METRICS,
  retainedPublicationContentBytes: 14,
  countedCanonicalBytes: 679,
} satisfies QuerySyncStateMetrics);

describe("deployment query-sync evaluation state accounting", () => {
  it("rotates one preceding completion and keeps all eight counters exact", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const descriptor = queryDescriptor(31);
      const firstRequest = beginRequest(prepared.binding, descriptor);
      const reference = success(createReferenceModel(
        prepared.binding.bootstrapCursor,
      ));
      const referenceFirstBegin = success(reduceReferenceModel(reference, {
        _tag: "beginQueryEvaluation",
        request: firstRequest,
      }));
      const firstAttempt = await beginEvaluation(prepared, descriptor);
      if (referenceFirstBegin.decision._tag !== "created") {
        throw new Error("Expected the reference model to create generation 1.");
      }
      expect(firstAttempt).toEqual(referenceFirstBegin.decision.attempt);

      const firstInput = makeCompletionEvidence(prepared, firstAttempt, {
        dependencyLabels: ["alpha", "beta"],
        resultSeed: 131,
        publicationLabel: "first-pending",
      });
      const referenceFirstCompletion = success(reduceReferenceModel(
        referenceFirstBegin.model,
        {
          _tag: "completeQueryEvaluation",
          attempt: firstAttempt,
          ...firstInput,
        },
      ));
      const firstCompletion = await completeEvaluation(
        prepared,
        firstAttempt,
        firstInput,
      );
      expect(firstCompletion).toEqual(
        receiptWithoutState(referenceFirstCompletion.decision),
      );
      expect(referenceFirstCompletion.model.state.metrics).toEqual(
        FIRST_COMPLETION_METRICS,
      );
      expectCompletionAccounting(prepared.database, {
        metrics: referenceFirstCompletion.model.state.metrics,
        appliedThroughSequence: "11",
        evaluationWorkRevision: "2",
        queryKey: descriptor.queryKey,
        activeGeneration: "1",
        activeFreshThroughSequence: "11",
        resultDigest: firstInput.evaluation.resultDigest,
        completionDisposition: "pending",
        precedingCompletionGeneration: null,
        dependencyKeys: firstInput.evaluation.dependencyKeys,
      });
      const firstPending = readPendingRows(prepared.database);
      expect(firstPending).toEqual([{
        query_key: descriptor.queryKey,
        generation: "1",
        query_identity: descriptor.queryIdentity,
        completed_through_sequence: "11",
        result_digest: firstInput.evaluation.resultDigest,
        content: firstInput.publication.content,
      }]);

      const sequence12 = captureCompletionBatch(
        prepared.binding,
        12n,
        ["alpha"],
      );
      const referenceSequence12 = success(reduceReferenceModel(
        referenceFirstCompletion.model,
        { _tag: "applyAdmittedInvalidations", batch: sequence12 },
      ));
      await applyCompletionBatch(prepared, sequence12);
      const secondRequest = beginRequest(prepared.binding, descriptor, {
        expectedActiveGeneration: firstAttempt.generation,
        requestedDirtyThroughSequence: sequence12.sourceSequence,
      });
      const referenceSecondBegin = success(reduceReferenceModel(
        referenceSequence12.model,
        { _tag: "beginQueryEvaluation", request: secondRequest },
      ));
      const secondAttempt = await beginEvaluation(prepared, descriptor, {
        expectedActiveGeneration: firstAttempt.generation,
        requestedDirtyThroughSequence: sequence12.sourceSequence,
      });
      if (referenceSecondBegin.decision._tag !== "created") {
        throw new Error("Expected the reference model to create generation 2.");
      }
      expect(secondAttempt).toEqual(referenceSecondBegin.decision.attempt);

      const secondInput = makeCompletionEvidence(prepared, secondAttempt, {
        dependencyLabels: ["alpha", "beta"],
        resultSeed: 132,
        publicationLabel: "second-pending",
      });
      const referenceSecondCompletion = success(reduceReferenceModel(
        referenceSecondBegin.model,
        {
          _tag: "completeQueryEvaluation",
          attempt: secondAttempt,
          ...secondInput,
        },
      ));
      const secondCompletion = await completeEvaluation(
        prepared,
        secondAttempt,
        secondInput,
      );
      expect(secondCompletion).toEqual(
        receiptWithoutState(referenceSecondCompletion.decision),
      );
      expect(referenceSecondCompletion.model.state.metrics).toEqual(
        REPLACEMENT_COMPLETION_METRICS,
      );
      expectCompletionAccounting(prepared.database, {
        metrics: referenceSecondCompletion.model.state.metrics,
        appliedThroughSequence: "12",
        evaluationWorkRevision: "5",
        queryKey: descriptor.queryKey,
        activeGeneration: "2",
        activeFreshThroughSequence: "12",
        resultDigest: secondInput.evaluation.resultDigest,
        completionDisposition: "pending",
        precedingCompletionGeneration: "1",
        dependencyKeys: secondInput.evaluation.dependencyKeys,
      });
      const secondPending = readPendingRows(prepared.database);
      expect(secondPending).toEqual([{
        query_key: descriptor.queryKey,
        generation: "2",
        query_identity: descriptor.queryIdentity,
        completed_through_sequence: "12",
        result_digest: secondInput.evaluation.resultDigest,
        content: secondInput.publication.content,
      }]);

      const sequence13 = captureCompletionBatch(
        prepared.binding,
        13n,
        ["beta"],
      );
      const referenceSequence13 = success(reduceReferenceModel(
        referenceSecondCompletion.model,
        { _tag: "applyAdmittedInvalidations", batch: sequence13 },
      ));
      await applyCompletionBatch(prepared, sequence13);
      const thirdRequest = beginRequest(prepared.binding, descriptor, {
        expectedActiveGeneration: secondAttempt.generation,
        requestedDirtyThroughSequence: sequence13.sourceSequence,
      });
      const referenceThirdBegin = success(reduceReferenceModel(
        referenceSequence13.model,
        { _tag: "beginQueryEvaluation", request: thirdRequest },
      ));
      const thirdAttempt = await beginEvaluation(prepared, descriptor, {
        expectedActiveGeneration: secondAttempt.generation,
        requestedDirtyThroughSequence: sequence13.sourceSequence,
      });
      if (referenceThirdBegin.decision._tag !== "created") {
        throw new Error("Expected the reference model to create generation 3.");
      }
      expect(thirdAttempt).toEqual(referenceThirdBegin.decision.attempt);

      const thirdInput = makeCompletionEvidence(prepared, thirdAttempt, {
        dependencyLabels: ["alpha", "beta"],
        resultSeed: 132,
        publicationLabel: "ignored-third-content",
      });
      const referenceThirdCompletion = success(reduceReferenceModel(
        referenceThirdBegin.model,
        {
          _tag: "completeQueryEvaluation",
          attempt: thirdAttempt,
          ...thirdInput,
        },
      ));
      const thirdCompletion = await completeEvaluation(
        prepared,
        thirdAttempt,
        thirdInput,
      );
      expect(thirdCompletion).toEqual(
        receiptWithoutState(referenceThirdCompletion.decision),
      );
      if (thirdCompletion._tag !== "completed") {
        throw new Error(
          `Expected generation 3 completion, received ${thirdCompletion._tag}.`,
        );
      }
      expect(thirdCompletion.publicationDisposition).toEqual({
        _tag: "unchanged",
      });
      expect(referenceThirdCompletion.model.state.metrics).toEqual(
        REPLACEMENT_COMPLETION_METRICS,
      );
      expectCompletionAccounting(prepared.database, {
        metrics: referenceThirdCompletion.model.state.metrics,
        appliedThroughSequence: "13",
        evaluationWorkRevision: "8",
        queryKey: descriptor.queryKey,
        activeGeneration: "3",
        activeFreshThroughSequence: "13",
        resultDigest: thirdInput.evaluation.resultDigest,
        completionDisposition: "unchanged",
        precedingCompletionGeneration: "2",
        dependencyKeys: thirdInput.evaluation.dependencyKeys,
      });
      expect(readPendingRows(prepared.database)).toEqual(secondPending);
    } finally {
      prepared.database.close();
    }
  });
});

interface ExpectedCompletionAccounting {
  readonly metrics: QuerySyncStateMetrics;
  readonly appliedThroughSequence: string;
  readonly evaluationWorkRevision: string;
  readonly queryKey: string;
  readonly activeGeneration: string;
  readonly activeFreshThroughSequence: string;
  readonly resultDigest: string;
  readonly completionDisposition: "pending" | "unchanged";
  readonly precedingCompletionGeneration: string | null;
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

function expectCompletionAccounting(
  database: DatabaseSync,
  expected: ExpectedCompletionAccounting,
): void {
  expect(readScopeAccounting(database)).toEqual({
    appliedThroughSequence: expected.appliedThroughSequence,
    evaluationWorkRevision: expected.evaluationWorkRevision,
    fairnessAnchor: null,
    metrics: expected.metrics,
  });
  expect(database.prepare(`SELECT
    query_key,
    active_generation,
    active_fresh_through_sequence,
    active_dirty_through_sequence,
    active_result_digest,
    provisional_generation,
    completion_generation,
    completion_result_digest,
    completion_publication_disposition,
    preceding_completion_generation
    FROM deployment_sync_queries`).get()).toEqual({
    query_key: expected.queryKey,
    active_generation: expected.activeGeneration,
    active_fresh_through_sequence: expected.activeFreshThroughSequence,
    active_dirty_through_sequence: null,
    active_result_digest: expected.resultDigest,
    provisional_generation: null,
    completion_generation: expected.activeGeneration,
    completion_result_digest: expected.resultDigest,
    completion_publication_disposition: expected.completionDisposition,
    preceding_completion_generation: expected.precedingCompletionGeneration,
  });
  expect(database.prepare(`SELECT
    role, query_key, generation, dependency_key
    FROM deployment_sync_query_dependencies
    ORDER BY role, dependency_key`).all()).toEqual(
    expectedDependencyRows(expected),
  );
}

function readScopeAccounting(database: DatabaseSync) {
  const row = database.prepare(`SELECT
    applied_through_sequence AS appliedThroughSequence,
    evaluation_work_revision AS evaluationWorkRevision,
    fairness_anchor AS fairnessAnchor,
    query_count AS queryCount,
    retained_identity_bytes AS retainedIdentityBytes,
    dependency_memberships AS dependencyMemberships,
    pending_publication_count AS pendingPublicationCount,
    in_flight_publication_count AS inFlightPublicationCount,
    retained_publication_content_bytes AS retainedPublicationContentBytes,
    settlement_envelope_bytes AS settlementEnvelopeBytes,
    counted_canonical_bytes AS countedCanonicalBytes
    FROM deployment_sync_scope_state`).get();
  if (row === undefined) throw new Error("Expected one scope accounting row.");
  return Object.freeze({
    appliedThroughSequence: row.appliedThroughSequence,
    evaluationWorkRevision: row.evaluationWorkRevision,
    fairnessAnchor: row.fairnessAnchor,
    metrics: Object.freeze({
      queryCount: row.queryCount,
      retainedIdentityBytes: row.retainedIdentityBytes,
      dependencyMemberships: row.dependencyMemberships,
      pendingPublicationCount: row.pendingPublicationCount,
      inFlightPublicationCount: row.inFlightPublicationCount,
      retainedPublicationContentBytes: row.retainedPublicationContentBytes,
      settlementEnvelopeBytes: row.settlementEnvelopeBytes,
      countedCanonicalBytes: row.countedCanonicalBytes,
    }),
  });
}

function expectedDependencyRows(
  expected: ExpectedCompletionAccounting,
): readonly Readonly<Record<string, string>>[] {
  return Object.freeze((["active", "completion"] as const).flatMap(role => (
    expected.dependencyKeys.map(dependencyKey => Object.freeze({
      role,
      query_key: expected.queryKey,
      generation: expected.activeGeneration,
      dependency_key: dependencyKey,
    }))
  )));
}

function readPendingRows(database: DatabaseSync) {
  return database.prepare(`SELECT
    query_key,
    generation,
    query_identity,
    completed_through_sequence,
    result_digest,
    content
    FROM deployment_sync_pending_publications
    ORDER BY query_key`).all();
}

function receiptWithoutState<Decision extends { readonly state: unknown }>(
  decision: Decision,
): Omit<Decision, "state"> {
  const { state: _state, ...receipt } = decision;
  return receipt;
}

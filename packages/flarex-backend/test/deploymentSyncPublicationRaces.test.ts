import {
  capturePublicationAttemptInstant,
  type AcceptedQueryPublicationEvidence,
  type AdmittedInvalidationBatch,
  type PublicationAttemptInstant,
  type QueryDescriptor,
  type QueryEvaluationAttempt,
} from "@flarex/query-sync/internal/kernel";
import type {
  ApplyAdmittedBatchReceipt,
  ClaimPublicationReceipt,
  CompletePublicationReceipt,
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
  completeEvaluation,
  type CompletionEvidenceInput,
  makeCompletionEvidence,
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
import {
  acceptanceFor,
  claimInstalledPublication,
  type DeploymentQuerySyncPublicationOperations,
  makeDeterministicPublicationOperations,
} from "./deploymentSyncPublicationTestSupport";
import {
  normalizedDeploymentQuerySyncState,
} from "./deploymentSyncStateConformanceTestSupport";

type ClaimCompletionOrder = "claimFirst" | "completionFirst";
type PublicationInvalidationOrder =
  | "completionFirst"
  | "invalidationFirst";

interface ClaimCompletionFixture {
  readonly prepared: PreparedEvaluationState;
  readonly reference: QuerySyncReferenceModel;
  readonly descriptor: QueryDescriptor;
  readonly secondAttempt: QueryEvaluationAttempt;
  readonly secondCompletion: CompletionEvidenceInput;
  readonly publicationOperations: DeploymentQuerySyncPublicationOperations;
  readonly publicationInstant: PublicationAttemptInstant;
}

interface ClaimCompletionHistory {
  readonly claim: ReferenceModelTransition;
  readonly completion: ReferenceModelTransition;
  readonly finalReference: QuerySyncReferenceModel;
}

interface ActualClaimCompletionHistory {
  readonly claim: ClaimPublicationReceipt;
  readonly completion: CompleteQueryEvaluationReceipt;
}

interface PublicationInvalidationFixture {
  readonly prepared: PreparedEvaluationState;
  readonly reference: QuerySyncReferenceModel;
  readonly descriptor: QueryDescriptor;
  readonly firstAttempt: QueryEvaluationAttempt;
  readonly evidence: AcceptedQueryPublicationEvidence;
  readonly invalidation: AdmittedInvalidationBatch;
}

interface PublicationInvalidationHistory {
  readonly completion: ReferenceModelTransition;
  readonly invalidation: ReferenceModelTransition;
  readonly finalReference: QuerySyncReferenceModel;
}

interface ActualPublicationInvalidationHistory {
  readonly completion: CompletePublicationReceipt;
  readonly invalidation: ApplyAdmittedBatchReceipt;
}

describe("deployment query-sync cross-operation publication races", () => {
  it.each([
    {
      name: "publication claim before successor evaluation completion",
      order: "claimFirst",
      expectedInFlightGeneration: "1",
      expectedPendingGeneration: "2",
      expectedPendingCount: 1,
    },
    {
      name: "successor evaluation completion before publication claim",
      order: "completionFirst",
      expectedInFlightGeneration: "2",
      expectedPendingGeneration: null,
      expectedPendingCount: 0,
    },
  ] as const)("matches the complete $name history", async scenario => {
    const fixture = await prepareClaimCompletionFixture();
    try {
      const claimFirst = buildClaimCompletionHistory(fixture, "claimFirst");
      const completionFirst = buildClaimCompletionHistory(
        fixture,
        "completionFirst",
      );
      expect(claimFirst.finalReference.state).not.toEqual(
        completionFirst.finalReference.state,
      );
      const expected = scenario.order === "claimFirst"
        ? claimFirst
        : completionFirst;

      const actual = await runClaimCompletionHistory(fixture, scenario.order);

      expect(actual.claim).toEqual(receiptWithoutState(
        expected.claim.decision,
      ));
      expect(actual.completion).toEqual(receiptWithoutState(
        expected.completion.decision,
      ));
      expectPhysicalStateMatchesReference(
        fixture.prepared,
        expected.finalReference,
      );

      const physical = snapshotEvaluationState(fixture.prepared.database);
      expect(physical.inFlight).toHaveLength(1);
      expect(physical.inFlight[0]).toMatchObject({
        query_key: fixture.descriptor.queryKey,
        generation: scenario.expectedInFlightGeneration,
      });
      if (scenario.expectedPendingGeneration === null) {
        expect(physical.pending).toEqual([]);
      } else {
        expect(physical.pending).toHaveLength(1);
        expect(physical.pending[0]).toMatchObject({
          query_key: fixture.descriptor.queryKey,
          generation: scenario.expectedPendingGeneration,
        });
      }
      expect(physical.scope).toHaveLength(1);
      expect(physical.scope[0]).toMatchObject({
        pending_publication_count: scenario.expectedPendingCount,
        in_flight_publication_count: 1,
      });
      expect(readEvaluationScope(fixture.prepared.database).metrics)
        .toMatchObject({
          pendingPublicationCount: scenario.expectedPendingCount,
          inFlightPublicationCount: 1,
        });
    } finally {
      fixture.prepared.database.close();
    }
  });

  it.each([
    {
      name: "publication completion before exact-next invalidation",
      order: "completionFirst",
    },
    {
      name: "exact-next invalidation before publication completion",
      order: "invalidationFirst",
    },
  ] as const)("commutes the complete $name history", async scenario => {
    const fixture = await preparePublicationInvalidationFixture();
    try {
      const completionFirst = buildPublicationInvalidationHistory(
        fixture,
        "completionFirst",
      );
      const invalidationFirst = buildPublicationInvalidationHistory(
        fixture,
        "invalidationFirst",
      );
      expect(completionFirst.finalReference.state).toEqual(
        invalidationFirst.finalReference.state,
      );
      expect(receiptWithoutState(completionFirst.completion.decision)).toEqual(
        receiptWithoutState(invalidationFirst.completion.decision),
      );
      expect(receiptWithoutState(completionFirst.invalidation.decision))
        .toEqual(receiptWithoutState(invalidationFirst.invalidation.decision));
      const expected = scenario.order === "completionFirst"
        ? completionFirst
        : invalidationFirst;

      const actual = await runPublicationInvalidationHistory(
        fixture,
        scenario.order,
      );

      expect(actual.completion).toEqual(receiptWithoutState(
        expected.completion.decision,
      ));
      expect(actual.invalidation).toEqual(receiptWithoutState(
        expected.invalidation.decision,
      ));
      expect(actual.completion).toEqual({
        _tag: "completed",
        identity: fixture.evidence.identity,
      });
      expect(actual.invalidation).toEqual({
        _tag: "applied",
        appliedSequence: fixture.invalidation.sourceSequence,
        affectedQueryKeys: [fixture.descriptor.queryKey],
      });
      expectPhysicalStateMatchesReference(
        fixture.prepared,
        expected.finalReference,
      );

      const physical = snapshotEvaluationState(fixture.prepared.database);
      expect(physical.pending).toEqual([]);
      expect(physical.inFlight).toEqual([]);
      expect(physical.publicationState).toHaveLength(1);
      expect(physical.publicationState[0]).toMatchObject({
        latest_delivered_query_key: fixture.descriptor.queryKey,
        latest_delivered_generation:
          fixture.firstAttempt.generation.toString(),
      });
      expect(physical.queries).toHaveLength(1);
      expect(physical.queries[0]).toMatchObject({
        query_key: fixture.descriptor.queryKey,
        active_generation: fixture.firstAttempt.generation.toString(),
        active_dirty_through_sequence:
          fixture.invalidation.sourceSequence.toString(),
      });
    } finally {
      fixture.prepared.database.close();
    }
  });
});

async function prepareClaimCompletionFixture(): Promise<ClaimCompletionFixture> {
  const prepared = await prepareEvaluationState();
  const descriptor = queryDescriptor(310);
  let reference = success(createReferenceModel(
    prepared.binding.bootstrapCursor,
  ));

  const firstRequest = beginRequest(prepared.binding, descriptor);
  const firstBegin = success(reduceReferenceModel(reference, {
    _tag: "beginQueryEvaluation",
    request: firstRequest,
  }));
  if (firstBegin.decision._tag !== "created") {
    throw new Error("Expected first cross-operation evaluation creation.");
  }
  const firstAttempt = await beginEvaluation(prepared, descriptor);
  expect(firstAttempt).toEqual(firstBegin.decision.attempt);
  reference = firstBegin.model;

  const firstCompletion = makeCompletionEvidence(prepared, firstAttempt, {
    dependencyLabels: ["publication-claim-completion"],
    resultSeed: 311,
    publicationLabel: "publication-claim-completion-generation-1",
  });
  const firstCompleted = success(reduceReferenceModel(reference, {
    _tag: "completeQueryEvaluation",
    attempt: firstAttempt,
    ...firstCompletion,
  }));
  expect(await completeEvaluation(prepared, firstAttempt, firstCompletion))
    .toEqual(receiptWithoutState(firstCompleted.decision));
  reference = firstCompleted.model;

  const invalidation = captureCompletionBatch(
    prepared.binding,
    12n,
    ["publication-claim-completion"],
  );
  const invalidated = success(reduceReferenceModel(reference, {
    _tag: "applyAdmittedInvalidations",
    batch: invalidation,
  }));
  const actualInvalidation = await Effect.runPromise(
    prepared.state.applyAdmittedBatchAndAdvance(invalidation),
  );
  expect(actualInvalidation).toEqual(receiptWithoutState(
    invalidated.decision,
  ));
  reference = invalidated.model;

  const secondRequest = beginRequest(prepared.binding, descriptor, {
    expectedActiveGeneration: firstAttempt.generation,
    requestedDirtyThroughSequence: invalidation.sourceSequence,
  });
  const secondBegin = success(reduceReferenceModel(reference, {
    _tag: "beginQueryEvaluation",
    request: secondRequest,
  }));
  if (secondBegin.decision._tag !== "created") {
    throw new Error("Expected successor cross-operation evaluation creation.");
  }
  const secondAttempt = await beginEvaluation(prepared, descriptor, {
    expectedActiveGeneration: firstAttempt.generation,
    requestedDirtyThroughSequence: invalidation.sourceSequence,
  });
  expect(secondAttempt).toEqual(secondBegin.decision.attempt);
  reference = secondBegin.model;

  const secondCompletion = makeCompletionEvidence(prepared, secondAttempt, {
    dependencyLabels: ["publication-claim-completion"],
    resultSeed: 312,
    publicationLabel: "publication-claim-completion-generation-2",
  });
  const publicationInstant = success(capturePublicationAttemptInstant(10_000));
  const deterministic = makeDeterministicPublicationOperations(
    prepared,
    [publicationInstant],
  );
  expect(normalizedDeploymentQuerySyncState(prepared)).toEqual(reference.state);

  return Object.freeze({
    prepared,
    reference,
    descriptor,
    secondAttempt,
    secondCompletion,
    publicationOperations: deterministic.operations,
    publicationInstant,
  });
}

function buildClaimCompletionHistory(
  fixture: ClaimCompletionFixture,
  order: ClaimCompletionOrder,
): ClaimCompletionHistory {
  if (order === "claimFirst") {
    const claim = success(reduceReferenceModel(fixture.reference, {
      _tag: "claimPublication",
      capturedNow: fixture.publicationInstant,
    }));
    const completion = success(reduceReferenceModel(claim.model, {
      _tag: "completeQueryEvaluation",
      attempt: fixture.secondAttempt,
      ...fixture.secondCompletion,
    }));
    return Object.freeze({
      claim,
      completion,
      finalReference: completion.model,
    });
  }
  const completion = success(reduceReferenceModel(fixture.reference, {
    _tag: "completeQueryEvaluation",
    attempt: fixture.secondAttempt,
    ...fixture.secondCompletion,
  }));
  const claim = success(reduceReferenceModel(completion.model, {
    _tag: "claimPublication",
    capturedNow: fixture.publicationInstant,
  }));
  return Object.freeze({
    claim,
    completion,
    finalReference: claim.model,
  });
}

async function runClaimCompletionHistory(
  fixture: ClaimCompletionFixture,
  order: ClaimCompletionOrder,
): Promise<ActualClaimCompletionHistory> {
  if (order === "claimFirst") {
    const claim = await Effect.runPromise(
      fixture.publicationOperations.claimPublication(),
    );
    const completion = await completeEvaluation(
      fixture.prepared,
      fixture.secondAttempt,
      fixture.secondCompletion,
    );
    return Object.freeze({ claim, completion });
  }
  const completion = await completeEvaluation(
    fixture.prepared,
    fixture.secondAttempt,
    fixture.secondCompletion,
  );
  const claim = await Effect.runPromise(
    fixture.publicationOperations.claimPublication(),
  );
  return Object.freeze({ claim, completion });
}

async function preparePublicationInvalidationFixture(): Promise<
  PublicationInvalidationFixture
> {
  const prepared = await prepareEvaluationState();
  const descriptor = queryDescriptor(320);
  let reference = success(createReferenceModel(
    prepared.binding.bootstrapCursor,
  ));

  const request = beginRequest(prepared.binding, descriptor);
  const begun = success(reduceReferenceModel(reference, {
    _tag: "beginQueryEvaluation",
    request,
  }));
  if (begun.decision._tag !== "created") {
    throw new Error("Expected publication-invalidation evaluation creation.");
  }
  const firstAttempt = await beginEvaluation(prepared, descriptor);
  expect(firstAttempt).toEqual(begun.decision.attempt);
  reference = begun.model;

  const completion = makeCompletionEvidence(prepared, firstAttempt, {
    dependencyLabels: ["publication-completion-invalidation"],
    resultSeed: 321,
    publicationLabel: "publication-completion-invalidation-generation-1",
  });
  const completed = success(reduceReferenceModel(reference, {
    _tag: "completeQueryEvaluation",
    attempt: firstAttempt,
    ...completion,
  }));
  expect(await completeEvaluation(prepared, firstAttempt, completion)).toEqual(
    receiptWithoutState(completed.decision),
  );
  reference = completed.model;

  const publicationInstant = success(capturePublicationAttemptInstant(20_000));
  const referenceClaim = success(reduceReferenceModel(reference, {
    _tag: "claimPublication",
    capturedNow: publicationInstant,
  }));
  const deterministic = makeDeterministicPublicationOperations(
    prepared,
    [publicationInstant],
  );
  const firstPublicationAttempt = await claimInstalledPublication(
    prepared,
    deterministic.operations,
  );
  expect(firstPublicationAttempt).toEqual(
    requireReferencePublicationClaim(referenceClaim).attempt,
  );
  expect(deterministic.clockReads()).toBe(1);
  reference = referenceClaim.model;

  return Object.freeze({
    prepared,
    reference,
    descriptor,
    firstAttempt,
    evidence: acceptanceFor(firstPublicationAttempt),
    invalidation: captureCompletionBatch(
      prepared.binding,
      12n,
      ["publication-completion-invalidation"],
    ),
  });
}

function buildPublicationInvalidationHistory(
  fixture: PublicationInvalidationFixture,
  order: PublicationInvalidationOrder,
): PublicationInvalidationHistory {
  if (order === "completionFirst") {
    const completion = success(reduceReferenceModel(fixture.reference, {
      _tag: "completePublication",
      evidence: fixture.evidence,
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
    _tag: "completePublication",
    evidence: fixture.evidence,
  }));
  return Object.freeze({
    completion,
    invalidation,
    finalReference: completion.model,
  });
}

async function runPublicationInvalidationHistory(
  fixture: PublicationInvalidationFixture,
  order: PublicationInvalidationOrder,
): Promise<ActualPublicationInvalidationHistory> {
  if (order === "completionFirst") {
    const completion = await Effect.runPromise(
      fixture.prepared.state.completePublication(fixture.evidence),
    );
    const invalidation = await Effect.runPromise(
      fixture.prepared.state.applyAdmittedBatchAndAdvance(
        fixture.invalidation,
      ),
    );
    return Object.freeze({ completion, invalidation });
  }
  const invalidation = await Effect.runPromise(
    fixture.prepared.state.applyAdmittedBatchAndAdvance(fixture.invalidation),
  );
  const completion = await Effect.runPromise(
    fixture.prepared.state.completePublication(fixture.evidence),
  );
  return Object.freeze({ completion, invalidation });
}

function requireReferencePublicationClaim(
  transition: ReferenceModelTransition,
) {
  const decision = transition.decision;
  if (decision._tag !== "claimed" || "continuation" in decision) {
    throw new Error(
      `Expected publication claim, received ${decision._tag}.`,
    );
  }
  return decision;
}

function expectPhysicalStateMatchesReference(
  prepared: PreparedEvaluationState,
  reference: QuerySyncReferenceModel,
): void {
  expect(normalizedDeploymentQuerySyncState(prepared)).toEqual(reference.state);
  expect(readEvaluationScope(prepared.database)).toEqual({
    appliedThroughSequence:
      reference.state.cursor.appliedThroughSequence.toString(),
    evaluationWorkRevision:
      reference.state.evaluationWork.revision.toString(),
    fairnessAnchor: reference.state.evaluationWork.fairnessAnchor,
    metrics: reference.state.metrics,
  });

  const scopeRows = snapshotEvaluationState(prepared.database).scope;
  expect(scopeRows).toHaveLength(1);
  expect(scopeRows[0]).toMatchObject({
    applied_through_sequence:
      reference.state.cursor.appliedThroughSequence.toString(),
    evaluation_work_revision:
      reference.state.evaluationWork.revision.toString(),
    query_count: reference.state.metrics.queryCount,
    retained_identity_bytes: reference.state.metrics.retainedIdentityBytes,
    dependency_memberships: reference.state.metrics.dependencyMemberships,
    pending_publication_count:
      reference.state.metrics.pendingPublicationCount,
    in_flight_publication_count:
      reference.state.metrics.inFlightPublicationCount,
    retained_publication_content_bytes:
      reference.state.metrics.retainedPublicationContentBytes,
    settlement_envelope_bytes:
      reference.state.metrics.settlementEnvelopeBytes,
    counted_canonical_bytes: reference.state.metrics.countedCanonicalBytes,
  });
}

function receiptWithoutState<Decision extends { readonly state: unknown }>(
  decision: Decision,
): Omit<Decision, "state"> {
  const { state: _state, ...receipt } = decision;
  return receipt;
}

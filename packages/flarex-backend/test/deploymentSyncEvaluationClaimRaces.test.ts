import {
  compareCanonicalBase64Url,
  type AdmittedInvalidationBatch,
  type QueryDescriptor,
} from "@flarex/query-sync/internal/kernel";
import type {
  ClaimEvaluationWorkReceipt,
} from "@flarex/query-sync/internal/state";
import type {
  ApplyAdmittedBatchReceipt,
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
  CLAIM_COMMON_READ_STAGES,
  claimEvaluationWork,
  claimRequest,
  type ClaimSqlProbe,
  type ClaimSqlStage,
  makeClaimSqlProbe,
} from "./deploymentSyncClaimTestSupport";
import {
  captureCompletionBatch,
  completeEvaluation,
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

const FRESH_READY_WRITE_TRACE = Object.freeze([
  ...CLAIM_COMMON_READ_STAGES,
  "scan-read",
  "selected-query-read",
  "scope-write",
] as const satisfies readonly ClaimSqlStage[]);

const ANCHORED_READY_WRITE_TRACE = Object.freeze([
  ...CLAIM_COMMON_READ_STAGES,
  "anchor-read",
  "scan-read",
  "selected-query-read",
  "scope-write",
] as const satisfies readonly ClaimSqlStage[]);

const FRESH_DIRTY_WRITE_TRACE = Object.freeze([
  ...CLAIM_COMMON_READ_STAGES,
  "scan-read",
  "selected-query-read",
  "selected-query-write",
  "scope-write",
] as const satisfies readonly ClaimSqlStage[]);

type ClaimedEvaluationWork = Extract<
  ClaimEvaluationWorkReceipt,
  { readonly _tag: "claimed" }
>;

type ClaimInvalidationOrder = "claimFirst" | "invalidationFirst";

interface CompetingClaimFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: ClaimSqlProbe;
  readonly reference: QuerySyncReferenceModel;
  readonly descriptors: readonly [QueryDescriptor, QueryDescriptor];
}

interface DirtyClaimRaceFixture {
  readonly prepared: PreparedEvaluationState;
  readonly probe: ClaimSqlProbe;
  readonly reference: QuerySyncReferenceModel;
  readonly descriptor: QueryDescriptor;
  readonly laterInvalidation: AdmittedInvalidationBatch;
}

interface ClaimInvalidationHistory {
  readonly claim: ReferenceModelTransition;
  readonly invalidation: ReferenceModelTransition;
  readonly finalReference: QuerySyncReferenceModel;
}

describe("deployment query-sync evaluation claim races", () => {
  it("serializes two competing fresh claims to the complete portable history", async () => {
    const fixture = await prepareCompetingClaimFixture();
    try {
      const request = claimRequest(1);
      const firstReference = success(reduceReferenceModel(
        fixture.reference,
        { _tag: "claimEvaluationWork", request },
      ));
      const secondReference = success(reduceReferenceModel(
        firstReference.model,
        { _tag: "claimEvaluationWork", request },
      ));
      const expectedClaims = [
        requireReferenceClaim(firstReference),
        requireReferenceClaim(secondReference),
      ].toSorted(compareClaims);
      const before = snapshotEvaluationState(fixture.prepared.database);
      fixture.probe.start();

      const raced = await Effect.runPromise(Effect.all([
        fixture.prepared.state.claimEvaluationWork(request),
        fixture.prepared.state.claimEvaluationWork(request),
      ] as const, { concurrency: "unbounded" }));

      const actualClaims = raced.map(requireClaimed).toSorted(compareClaims);
      expect(actualClaims).toEqual(expectedClaims);
      expect(new Set(actualClaims.map(
        claim => claim.attempt.descriptor.queryKey,
      ))).toEqual(new Set(fixture.descriptors.map(
        descriptor => descriptor.queryKey,
      )));
      expect(fixture.probe.stop()).toEqual([
        ...FRESH_READY_WRITE_TRACE,
        ...ANCHORED_READY_WRITE_TRACE,
      ]);
      expect(fixture.probe.completed().filter(
        completion => completion.stage === "scan-read",
      ).map(completion => Object.freeze({
        rowsRead: completion.rowsRead,
        rowsWritten: completion.rowsWritten,
      }))).toEqual([
        { rowsRead: 2, rowsWritten: 0 },
        { rowsRead: 2, rowsWritten: 0 },
      ]);
      const after = snapshotEvaluationState(fixture.prepared.database);
      expect(after.queries).toEqual(before.queries);
      expect(after.dependencies).toEqual(before.dependencies);
      expect(after.pending).toEqual(before.pending);
      expectScopeMatchesReference(fixture.prepared, secondReference.model);
    } finally {
      fixture.prepared.database.close();
    }
  });

  it.each([
    {
      name: "claim before exact-next invalidation",
      order: "claimFirst",
      capturedSequence: 12n,
      observedWorkRevision: 4n,
    },
    {
      name: "exact-next invalidation before claim",
      order: "invalidationFirst",
      capturedSequence: 13n,
      observedWorkRevision: 5n,
    },
  ] as const)("matches the complete $name history", async scenario => {
    const fixture = await prepareDirtyClaimRaceFixture();
    try {
      const before = snapshotEvaluationState(fixture.prepared.database);
      const expected = buildClaimInvalidationHistory(
        fixture.reference,
        fixture.laterInvalidation,
        scenario.order,
      );

      const actual = await runClaimInvalidationHistory(
        fixture,
        scenario.order,
      );

      const claimed = requireClaimed(actual.claim);
      const expectedClaim = requireReferenceClaim(expected.claim);
      const expectedInvalidation = requireReferenceInvalidation(
        expected.invalidation,
      );
      expect(claimed).toEqual(expectedClaim);
      expect(actual.invalidation).toEqual(expectedInvalidation);
      expect(actual.invalidation).toEqual({
        _tag: "applied",
        appliedSequence: fixture.laterInvalidation.sourceSequence,
        affectedQueryKeys: [fixture.descriptor.queryKey],
      });
      expect(claimed.attempt).toMatchObject({
        descriptor: fixture.descriptor,
        generation: 2n,
        expectedActiveGeneration: 1n,
        registrationCursor: { appliedThroughSequence: scenario.capturedSequence },
        requestedDirtyThroughSequence: scenario.capturedSequence,
      });
      expect(claimed.continuation.observedWorkRevision).toBe(
        scenario.observedWorkRevision,
      );
      expect(actual.claimTrace).toEqual(FRESH_DIRTY_WRITE_TRACE);

      const after = snapshotEvaluationState(fixture.prepared.database);
      const beforeQuery = onlyQueryRow(before.queries);
      expect(after.queries).toEqual([{
        ...beforeQuery,
        active_dirty_through_sequence:
          fixture.laterInvalidation.sourceSequence.toString(),
        provisional_generation: "2",
        provisional_expected_active_generation: "1",
        provisional_registration_sequence: scenario.capturedSequence.toString(),
        provisional_requested_dirty_through_sequence:
          scenario.capturedSequence.toString(),
        provisional_disposition: "ready",
      }]);
      expect(after.dependencies).toEqual(before.dependencies);
      expect(after.pending).toEqual(before.pending);
      expectScopeMatchesReference(fixture.prepared, expected.finalReference);
    } finally {
      fixture.prepared.database.close();
    }
  });
});

async function prepareCompetingClaimFixture(): Promise<CompetingClaimFixture> {
  const probe = makeClaimSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptors = sortedDescriptorPair(250, 260);
  let reference = success(createReferenceModel(
    prepared.binding.bootstrapCursor,
  ));
  for (const descriptor of descriptors) {
    const request = beginRequest(prepared.binding, descriptor);
    const referenceBegin = success(reduceReferenceModel(reference, {
      _tag: "beginQueryEvaluation",
      request,
    }));
    if (referenceBegin.decision._tag !== "created") {
      throw new Error("Expected competing-claim reference creation.");
    }
    const attempt = await beginEvaluation(prepared, descriptor);
    expect(attempt).toEqual(referenceBegin.decision.attempt);
    reference = referenceBegin.model;
  }
  return Object.freeze({ prepared, probe, reference, descriptors });
}

async function prepareDirtyClaimRaceFixture(): Promise<DirtyClaimRaceFixture> {
  const probe = makeClaimSqlProbe();
  const prepared = await prepareEvaluationState(probe.hooks);
  const descriptor = queryDescriptor(270);
  let reference = success(createReferenceModel(
    prepared.binding.bootstrapCursor,
  ));
  const request = beginRequest(prepared.binding, descriptor);
  const referenceBegin = success(reduceReferenceModel(reference, {
    _tag: "beginQueryEvaluation",
    request,
  }));
  if (referenceBegin.decision._tag !== "created") {
    throw new Error("Expected dirty-race reference creation.");
  }
  const attempt = await beginEvaluation(prepared, descriptor);
  expect(attempt).toEqual(referenceBegin.decision.attempt);
  reference = referenceBegin.model;

  const completion = makeCompletionEvidence(prepared, attempt, {
    dependencyLabels: ["claim-race"],
    resultSeed: 271,
    publicationLabel: "claim-race-pending",
  });
  const referenceCompletion = success(reduceReferenceModel(reference, {
    _tag: "completeQueryEvaluation",
    attempt,
    ...completion,
  }));
  const completed = await completeEvaluation(prepared, attempt, completion);
  expect(completed).toEqual(receiptWithoutState(referenceCompletion.decision));
  reference = referenceCompletion.model;

  const initialInvalidation = captureCompletionBatch(
    prepared.binding,
    12n,
    ["claim-race"],
  );
  const referenceInvalidation = success(reduceReferenceModel(reference, {
    _tag: "applyAdmittedInvalidations",
    batch: initialInvalidation,
  }));
  const applied = await Effect.runPromise(
    prepared.state.applyAdmittedBatchAndAdvance(initialInvalidation),
  );
  expect(applied).toEqual(receiptWithoutState(referenceInvalidation.decision));
  reference = referenceInvalidation.model;

  return Object.freeze({
    prepared,
    probe,
    reference,
    descriptor,
    laterInvalidation: captureCompletionBatch(
      prepared.binding,
      13n,
      ["claim-race"],
    ),
  });
}

function buildClaimInvalidationHistory(
  reference: QuerySyncReferenceModel,
  invalidation: AdmittedInvalidationBatch,
  order: ClaimInvalidationOrder,
): ClaimInvalidationHistory {
  const request = claimRequest(1);
  if (order === "claimFirst") {
    const claim = success(reduceReferenceModel(reference, {
      _tag: "claimEvaluationWork",
      request,
    }));
    const applied = success(reduceReferenceModel(claim.model, {
      _tag: "applyAdmittedInvalidations",
      batch: invalidation,
    }));
    return Object.freeze({
      claim,
      invalidation: applied,
      finalReference: applied.model,
    });
  }
  const applied = success(reduceReferenceModel(reference, {
    _tag: "applyAdmittedInvalidations",
    batch: invalidation,
  }));
  const claim = success(reduceReferenceModel(applied.model, {
    _tag: "claimEvaluationWork",
    request,
  }));
  return Object.freeze({
    claim,
    invalidation: applied,
    finalReference: claim.model,
  });
}

async function runClaimInvalidationHistory(
  fixture: DirtyClaimRaceFixture,
  order: ClaimInvalidationOrder,
): Promise<Readonly<{
  claim: ClaimEvaluationWorkReceipt;
  invalidation: ApplyAdmittedBatchReceipt;
  claimTrace: readonly ClaimSqlStage[];
}>> {
  if (order === "claimFirst") {
    fixture.probe.start();
    const claim = await claimEvaluationWork(
      fixture.prepared,
      claimRequest(1),
    );
    const claimTrace = fixture.probe.stop();
    const invalidation = await Effect.runPromise(
      fixture.prepared.state.applyAdmittedBatchAndAdvance(
        fixture.laterInvalidation,
      ),
    );
    return Object.freeze({ claim, invalidation, claimTrace });
  }
  const invalidation = await Effect.runPromise(
    fixture.prepared.state.applyAdmittedBatchAndAdvance(
      fixture.laterInvalidation,
    ),
  );
  fixture.probe.start();
  const claim = await claimEvaluationWork(
    fixture.prepared,
    claimRequest(1),
  );
  const claimTrace = fixture.probe.stop();
  return Object.freeze({ claim, invalidation, claimTrace });
}

function requireReferenceClaim(
  transition: ReferenceModelTransition,
): ClaimedEvaluationWork {
  if (
    transition.decision._tag !== "claimed"
    || !("continuation" in transition.decision)
  ) {
    throw new Error(
      `Expected claimed reference work, received ${transition.decision._tag}.`,
    );
  }
  return receiptWithoutState(transition.decision);
}

function requireReferenceInvalidation(
  transition: ReferenceModelTransition,
): ApplyAdmittedBatchReceipt {
  if (transition.decision._tag !== "applied") {
    throw new Error(
      `Expected applied reference invalidation, received ${transition.decision._tag}.`,
    );
  }
  return receiptWithoutState(transition.decision);
}

function requireClaimed(receipt: ClaimEvaluationWorkReceipt): ClaimedEvaluationWork {
  if (receipt._tag !== "claimed") {
    throw new Error(`Expected claimed work, received ${receipt._tag}.`);
  }
  return receipt;
}

function compareClaims(
  left: ClaimedEvaluationWork,
  right: ClaimedEvaluationWork,
): number {
  return compareCanonicalBase64Url(
    left.attempt.descriptor.queryKey,
    right.attempt.descriptor.queryKey,
  );
}

function sortedDescriptorPair(
  firstSeed: number,
  secondSeed: number,
): readonly [QueryDescriptor, QueryDescriptor] {
  const descriptors = [firstSeed, secondSeed].map(queryDescriptor).toSorted(
    (left, right) => compareCanonicalBase64Url(
      left.queryKey,
      right.queryKey,
    ),
  );
  const first = descriptors[0];
  const second = descriptors[1];
  if (first === undefined || second === undefined) {
    throw new Error("Expected two query descriptors.");
  }
  return [first, second];
}

function receiptWithoutState<Decision extends { readonly state: unknown }>(
  decision: Decision,
): Omit<Decision, "state"> {
  const { state: _state, ...receipt } = decision;
  return receipt;
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

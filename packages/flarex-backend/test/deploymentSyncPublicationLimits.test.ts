import {
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_PENDING_PUBLICATIONS,
  MAX_REFERENCE_QUERIES,
  MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
  PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
  QuerySyncStateLimitError,
  captureNamespaceCursor,
  capturePublicationAttemptInstant,
  captureQuerySyncWorkRevision,
  claimPublication as claimReferencePublication,
  completePublication as completeReferencePublication,
  completeQueryEvaluation as completeReferenceQueryEvaluation,
  recordPublicationAttemptOutcome as recordReferencePublicationOutcome,
  type NamespaceCursor,
  type PublicationAttemptInstant,
  type QueryEvaluationAttempt,
  type QueryState,
} from "@flarex/query-sync/internal/kernel";
import { Cause, Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import type {
  DeploymentQuerySyncBinding,
} from "../src/deploymentSync/Binding";
import {
  beginRequest,
  prepareEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";
import {
  seedEvaluationPopulation,
} from "./deploymentSyncEvaluationPopulationTestSupport";
import {
  PENDING_CLAIM_READ_STAGES,
  acceptanceFor,
  makeDeterministicPublicationOperations,
  makePublicationSqlProbe,
} from "./deploymentSyncPublicationTestSupport";
import {
  buildCountedCanonicalClaimPopulation,
  buildMaximumPublicationPopulation,
  makePendingSelectionPlanProbe,
  makePublicationSuccessorMaterial,
  publicationLimitsSummary,
} from "./deploymentSyncPublicationLimitTestSupport";

const MAXIMUM_TEST_TIMEOUT = 120_000;

describe("deployment query-sync publication maximum limits", () => {
  it("retains 4,096 pending rows and 32 MiB while a claimed predecessor has a newer pending generation", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const cursor = cursorAt(prepared.binding, 12n);
      const population = buildMaximumPublicationPopulation({
        cursor,
        registrationCursor: cursorAt(prepared.binding, 11n),
        evaluationWorkRevision: workRevision(
          BigInt(2 * MAX_REFERENCE_QUERIES),
        ),
      });
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population.state,
      );
      const initial = publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      );
      expect(initial).toMatchObject({
        physical: {
          queryRowCount: MAX_REFERENCE_QUERIES,
          pendingRowCount: MAX_PENDING_PUBLICATIONS,
          inFlightRowCount: 0,
          maximumContentPendingRowCount: 32,
        },
        scopeMetrics: {
          pendingPublicationCount: MAX_PENDING_PUBLICATIONS,
          inFlightPublicationCount: 0,
          retainedPublicationContentBytes:
            MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
          settlementEnvelopeBytes: 0,
        },
        selected: {
          activeGeneration: "1",
          provisionalGeneration: "2",
          completionGeneration: "1",
          completionPublicationDisposition: "pending",
          pending: { generation: "1" },
          inFlight: null,
        },
      });

      const claimedAt = instant(1_000);
      const outcomeAt = instant(1_001);
      const selectionPlan = makePendingSelectionPlanProbe(prepared.storage);
      const deterministic = makeDeterministicPublicationOperations(
        prepared,
        [claimedAt, outcomeAt],
        selectionPlan.storage,
      );
      const referenceClaim = resultSuccess(claimReferencePublication(
        population.state,
        claimedAt,
      ));
      if (referenceClaim._tag !== "claimed") {
        throw new Error(`Expected reference claim, received ${referenceClaim._tag}.`);
      }
      const claimed = await Effect.runPromise(
        deterministic.operations.claimPublication(),
      );
      if (claimed._tag !== "claimed") {
        throw new Error(`Expected storage claim, received ${claimed._tag}.`);
      }
      expect(claimed.attempt).toEqual(referenceClaim.attempt);
      expect(selectionPlan.captureCount()).toBe(1);
      const queryPlan = selectionPlan.explain();
      expect(queryPlan.some(row =>
        row.detail.includes("deployment_sync_pending_publications")
      )).toBe(true);
      expect(queryPlan.every(row =>
        !row.detail.includes("USE TEMP B-TREE")
      )).toBe(true);

      const afterClaim = publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      );
      expect(afterClaim.scopeMetrics).toEqual(referenceClaim.state.metrics);
      expect(
        afterClaim.scopeMetrics.countedCanonicalBytes
        - initial.scopeMetrics.countedCanonicalBytes,
      ).toBe(PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES);
      expect(afterClaim.scopeMetrics.settlementEnvelopeBytes).toBeGreaterThan(
        0,
      );
      expect(afterClaim).toMatchObject({
        physical: {
          pendingRowCount: MAX_PENDING_PUBLICATIONS - 1,
          inFlightRowCount: 1,
          maximumContentPendingRowCount: 31,
        },
        scopeMetrics: {
          retainedPublicationContentBytes:
            MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
        },
        selected: {
          pending: null,
          inFlight: { generation: "1" },
        },
      });

      const evaluationAttempt = await replayAttempt(
        prepared,
        population.selectedQuery,
      );
      const material = makePublicationSuccessorMaterial(
        cursor,
        evaluationAttempt,
      );
      const referenceCompletion = resultSuccess(
        completeReferenceQueryEvaluation(
          referenceClaim.state,
          evaluationAttempt,
          material.evaluation,
          material.refresh,
          material.publication,
        ),
      );
      const completed = await Effect.runPromise(
        prepared.state.completeQueryEvaluation(
          evaluationAttempt,
          material.evaluation,
          material.refresh,
          material.publication,
        ),
      );
      expect(completed).toMatchObject({
        _tag: referenceCompletion._tag,
        generation: 2n,
        publicationDisposition: { _tag: "pending" },
      });
      const compound = publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      );
      expect(compound.scopeMetrics).toEqual(referenceCompletion.state.metrics);
      expect(compound.scopeMetrics.settlementEnvelopeBytes).toBeGreaterThan(0);
      expect(compound).toMatchObject({
        physical: {
          pendingRowCount: MAX_PENDING_PUBLICATIONS,
          inFlightRowCount: 1,
          maximumContentPendingRowCount: 31,
        },
        scopeMetrics: {
          pendingPublicationCount: MAX_PENDING_PUBLICATIONS,
          inFlightPublicationCount: 1,
          retainedPublicationContentBytes:
            MAX_RETAINED_PUBLICATION_CONTENT_BYTES,
        },
        selected: {
          activeGeneration: "2",
          provisionalGeneration: null,
          completionGeneration: "2",
          completionPublicationDisposition: "pending",
          pending: { generation: "2", contentCharacters: 0 },
          inFlight: { generation: "1" },
        },
      });

      const referenceOutcome = resultSuccess(
        recordReferencePublicationOutcome(
          referenceCompletion.state,
          claimed.attempt,
          "outcomeUnknown",
          outcomeAt,
        ),
      );
      const recorded = await Effect.runPromise(
        deterministic.operations.recordPublicationAttemptOutcome(
          claimed.attempt,
          "outcomeUnknown",
        ),
      );
      expect(recorded).toMatchObject({
        _tag: referenceOutcome._tag,
        attemptOrdinal: 1,
        nextAttemptOrdinal: 2,
        nextDisposition: "uncertain",
      });
      expect(publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      ).scopeMetrics).toEqual(referenceOutcome.state.metrics);

      const accepted = acceptanceFor(claimed.attempt);
      const referenceDelivered = resultSuccess(completeReferencePublication(
        referenceOutcome.state,
        accepted,
      ));
      const delivered = await Effect.runPromise(
        deterministic.operations.completePublication(accepted),
      );
      expect(delivered).toMatchObject({ _tag: referenceDelivered._tag });
      const settled = publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      );
      expect(settled.scopeMetrics).toEqual(referenceDelivered.state.metrics);
      expect(settled).toMatchObject({
        physical: {
          pendingRowCount: MAX_PENDING_PUBLICATIONS,
          inFlightRowCount: 0,
        },
        scopeMetrics: {
          pendingPublicationCount: MAX_PENDING_PUBLICATIONS,
          inFlightPublicationCount: 0,
          retainedPublicationContentBytes:
            MAX_RETAINED_PUBLICATION_CONTENT_BYTES
            - (MAX_RETAINED_PUBLICATION_CONTENT_BYTES / 32),
          settlementEnvelopeBytes: 0,
        },
        selected: {
          pending: { generation: "2", contentCharacters: 0 },
          inFlight: null,
        },
      });
      expect(deterministic.clockReads()).toBe(2);
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);

  it("claims at the exact 64 MiB boundary and keeps outcome and completion capacity-infallible", async () => {
    const prepared = await prepareEvaluationState();
    try {
      const population = buildCountedCanonicalClaimPopulation({
        cursor: cursorAt(prepared.binding, 11n),
        evaluationWorkRevision: workRevision(
          BigInt(2 * MAX_REFERENCE_QUERIES),
        ),
        preClaimCountedCanonicalBytes:
          MAX_COUNTED_CANONICAL_BYTES
          - PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
      });
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population.state,
      );
      const claimedAt = instant(2_000);
      const outcomeAt = instant(2_001);
      const deterministic = makeDeterministicPublicationOperations(
        prepared,
        [claimedAt, outcomeAt],
      );
      const referenceClaim = resultSuccess(claimReferencePublication(
        population.state,
        claimedAt,
      ));
      if (referenceClaim._tag !== "claimed") {
        throw new Error(`Expected reference claim, received ${referenceClaim._tag}.`);
      }
      const claimed = await Effect.runPromise(
        deterministic.operations.claimPublication(),
      );
      if (claimed._tag !== "claimed") {
        throw new Error(`Expected storage claim, received ${claimed._tag}.`);
      }
      expect(claimed.attempt).toEqual(referenceClaim.attempt);
      const afterClaim = publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      );
      expect(afterClaim.scopeMetrics).toEqual(referenceClaim.state.metrics);
      expect(afterClaim.scopeMetrics).toMatchObject({
        countedCanonicalBytes: MAX_COUNTED_CANONICAL_BYTES,
      });
      expect(afterClaim.scopeMetrics.settlementEnvelopeBytes).toBeGreaterThan(
        0,
      );

      const referenceOutcome = resultSuccess(
        recordReferencePublicationOutcome(
          referenceClaim.state,
          claimed.attempt,
          "outcomeUnknown",
          outcomeAt,
        ),
      );
      const recorded = await Effect.runPromise(
        deterministic.operations.recordPublicationAttemptOutcome(
          claimed.attempt,
          "outcomeUnknown",
        ),
      );
      expect(recorded).toMatchObject({
        _tag: referenceOutcome._tag,
        nextAttemptOrdinal: 2,
        nextDisposition: "uncertain",
      });
      const afterOutcome = publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      );
      expect(afterOutcome.scopeMetrics).toEqual(referenceOutcome.state.metrics);
      expect(afterOutcome.scopeMetrics.countedCanonicalBytes).toBe(
        MAX_COUNTED_CANONICAL_BYTES,
      );

      const accepted = acceptanceFor(claimed.attempt);
      const referenceDelivered = resultSuccess(completeReferencePublication(
        referenceOutcome.state,
        accepted,
      ));
      const delivered = await Effect.runPromise(
        deterministic.operations.completePublication(accepted),
      );
      expect(delivered).toMatchObject({ _tag: referenceDelivered._tag });
      const settled = publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      );
      expect(settled.scopeMetrics).toEqual(referenceDelivered.state.metrics);
      expect(settled.scopeMetrics.countedCanonicalBytes).toBeLessThanOrEqual(
        MAX_COUNTED_CANONICAL_BYTES,
      );
      expect(deterministic.clockReads()).toBe(2);
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);

  it("rejects the exact counted-canonical plus-one claim before exposure or mutation", async () => {
    const sqlProbe = makePublicationSqlProbe();
    const prepared = await prepareEvaluationState(sqlProbe.hooks);
    try {
      const population = buildCountedCanonicalClaimPopulation({
        cursor: cursorAt(prepared.binding, 11n),
        evaluationWorkRevision: workRevision(
          BigInt(2 * MAX_REFERENCE_QUERIES),
        ),
        preClaimCountedCanonicalBytes:
          MAX_COUNTED_CANONICAL_BYTES
          - PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES
          + 1,
      });
      seedEvaluationPopulation(
        prepared.database,
        prepared.binding,
        population.state,
      );
      const before = publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      );
      const claimedAt = instant(3_000);
      const expected = resultFailure(claimReferencePublication(
        population.state,
        claimedAt,
      ));
      const selectionPlan = makePendingSelectionPlanProbe(prepared.storage);
      const deterministic = makeDeterministicPublicationOperations(
        prepared,
        [claimedAt],
        selectionPlan.storage,
      );
      sqlProbe.start();
      const exit = await Effect.runPromiseExit(
        deterministic.operations.claimPublication(),
      );

      const failure = typedFailure(exit);
      expect(failure).toBeInstanceOf(QuerySyncStateLimitError);
      expect(failure).toEqual(expected);
      expect(failure).toMatchObject({
        _tag: "QuerySyncStateLimitError",
        operation: "buildQuerySyncState",
        dimension: "countedCanonicalBytes",
        maximum: MAX_COUNTED_CANONICAL_BYTES,
        observed: MAX_COUNTED_CANONICAL_BYTES + 1,
      });
      expect(sqlProbe.stop()).toEqual(PENDING_CLAIM_READ_STAGES.filter(
        stage => stage !== "clock-read",
      ));
      expect(sqlProbe.writeCount()).toBe(0);
      expect(publicationLimitsSummary(
        prepared.storage.sql,
        population.selectedQuery.descriptor.queryKey,
      )).toEqual(before);
      expect(selectionPlan.captureCount()).toBe(1);
      expect(selectionPlan.explain().every(row =>
        !row.detail.includes("USE TEMP B-TREE")
      )).toBe(true);
      expect(deterministic.clockReads()).toBe(1);
    } finally {
      prepared.database.close();
    }
  }, MAXIMUM_TEST_TIMEOUT);
});

async function replayAttempt(
  prepared: Awaited<ReturnType<typeof prepareEvaluationState>>,
  query: QueryState,
): Promise<QueryEvaluationAttempt> {
  const provisional = query.provisional;
  if (provisional === null) throw new Error("Expected a provisional query.");
  const receipt = await Effect.runPromise(
    prepared.state.beginQueryEvaluation(beginRequest(
      prepared.binding,
      query.descriptor,
      {
        ...(provisional.expectedActiveGeneration === null
          ? {}
          : {
              expectedActiveGeneration:
                provisional.expectedActiveGeneration,
            }),
        ...(provisional.requestedDirtyThroughSequence === null
          ? {}
          : {
              requestedDirtyThroughSequence:
                provisional.requestedDirtyThroughSequence,
            }),
      },
    )),
  );
  if (receipt._tag !== "replayed") {
    throw new Error(`Expected replayed evaluation, received ${receipt._tag}.`);
  }
  return receipt.attempt;
}

function cursorAt(
  binding: DeploymentQuerySyncBinding,
  appliedThroughSequence: bigint,
): NamespaceCursor {
  return success(captureNamespaceCursor({
    namespaceId: binding.namespaceId,
    syncModelId: binding.syncModelId,
    sourceEpoch: binding.sourceEpoch,
    appliedThroughSequence,
  }));
}

function workRevision(revision: bigint) {
  return success(captureQuerySyncWorkRevision(revision));
}

function instant(value: number): PublicationAttemptInstant {
  return success(capturePublicationAttemptInstant(value));
}

function typedFailure<A, E>(exit: Exit.Exit<A, E>): E {
  if (!Exit.isFailure(exit)) throw new Error("Expected typed failure.");
  expect(Cause.hasDies(exit.cause)).toBe(false);
  return Option.getOrThrow(Cause.findErrorOption(exit.cause));
}

function resultSuccess<A, E>(result: Result.Result<A, E>): A {
  return Result.match(result, {
    onFailure: failure => {
      throw failure;
    },
    onSuccess: value => value,
  });
}

function resultFailure<A, E>(result: Result.Result<A, E>): E {
  return Result.match(result, {
    onFailure: failure => failure,
    onSuccess: () => {
      throw new Error("Expected portable state-limit failure.");
    },
  });
}

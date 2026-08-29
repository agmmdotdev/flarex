import { describe, expect, it } from "vitest";

import {
  beginQueryEvaluation,
  captureQueryGeneration,
  captureSyncSequence,
  claimEvaluationWork,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import type {
  BeginQueryEvaluationDecision,
  ClaimEvaluationWorkDecision,
  CompleteQueryEvaluationDecision,
  QueryCompletionPublicationDisposition,
  QueryPublicationIdentity,
  RecordEvaluationAttemptOutcomeDecision,
} from "@flarex/query-sync/internal/kernel";

import {
  initializedNamespaceReceipt,
  projectBeginReceipt,
  projectClaimEvaluationWorkReceipt,
  projectCompleteReceipt,
  projectRecordEvaluationAttemptOutcomeReceipt,
} from "../src/state/Receipts.js";
import {
  cursor,
  firstEvaluationRequest,
  getSuccess,
} from "./fixtures.js";

describe("query-sync receipt ownership", () => {
  it("captures cursor, metrics, and evaluation attempt by exact fields", () => {
    let extraGetterReads = 0;
    const poison = <A extends object>(value: A): A => Object.defineProperty(
      value,
      "unmeasured",
      {
        enumerable: true,
        get: () => {
          extraGetterReads += 1;
          throw new Error("Undeclared receipt field was traversed.");
        },
      },
    );
    const namespaceCursor = cursor();
    const state = getSuccess(createEmptyQuerySyncState(namespaceCursor));
    const begin = getSuccess(beginQueryEvaluation(
      state,
      firstEvaluationRequest(),
    ));
    expect(begin._tag).toBe("created");
    if (begin._tag !== "created") {
      throw new Error("Expected an evaluation attempt to be created.");
    }
    const enrichedCursor = poison({
      namespaceId: namespaceCursor.namespaceId,
      syncModelId: namespaceCursor.syncModelId,
      sourceEpoch: namespaceCursor.sourceEpoch,
      appliedThroughSequence: namespaceCursor.appliedThroughSequence,
    });
    const enrichedMetrics = poison({
      queryCount: state.metrics.queryCount,
      retainedIdentityBytes: state.metrics.retainedIdentityBytes,
      dependencyMemberships: state.metrics.dependencyMemberships,
      pendingPublicationCount: state.metrics.pendingPublicationCount,
      inFlightPublicationCount: state.metrics.inFlightPublicationCount,
      retainedPublicationContentBytes:
        state.metrics.retainedPublicationContentBytes,
      settlementEnvelopeBytes: state.metrics.settlementEnvelopeBytes,
      countedCanonicalBytes: state.metrics.countedCanonicalBytes,
    });
    const initialized = initializedNamespaceReceipt(
      "initialized",
      enrichedCursor,
      enrichedMetrics,
    );

    expect(initialized._tag).toBe("initialized");
    if (initialized._tag !== "initialized") {
      throw new Error("Expected an initialized receipt.");
    }
    expect(Object.keys(initialized.cursor)).toEqual([
      "namespaceId",
      "syncModelId",
      "sourceEpoch",
      "appliedThroughSequence",
    ]);
    expect(Object.keys(initialized.metrics)).toEqual([
      "queryCount",
      "retainedIdentityBytes",
      "dependencyMemberships",
      "pendingPublicationCount",
      "inFlightPublicationCount",
      "retainedPublicationContentBytes",
      "settlementEnvelopeBytes",
      "countedCanonicalBytes",
    ]);

    const enrichedDescriptor = poison({
      queryKey: begin.attempt.descriptor.queryKey,
      queryIdentity: begin.attempt.descriptor.queryIdentity,
    });
    const enrichedAttempt = poison({
      namespaceId: begin.attempt.namespaceId,
      syncModelId: begin.attempt.syncModelId,
      sourceEpoch: begin.attempt.sourceEpoch,
      descriptor: enrichedDescriptor,
      generation: begin.attempt.generation,
      expectedActiveGeneration: begin.attempt.expectedActiveGeneration,
      registrationCursor: enrichedCursor,
      requestedDirtyThroughSequence:
        begin.attempt.requestedDirtyThroughSequence,
    });
    const projected = projectBeginReceipt(poison({
      _tag: begin._tag,
      state: begin.state,
      attempt: enrichedAttempt,
    }) as unknown as BeginQueryEvaluationDecision);
    expect(projected._tag).toBe("created");
    if (projected._tag !== "created") {
      throw new Error("Expected a projected evaluation attempt.");
    }
    expect(Object.keys(projected.attempt)).toEqual([
      "namespaceId",
      "syncModelId",
      "sourceEpoch",
      "descriptor",
      "generation",
      "expectedActiveGeneration",
      "registrationCursor",
      "requestedDirtyThroughSequence",
    ]);
    expect(Object.keys(projected.attempt.descriptor)).toEqual([
      "queryKey",
      "queryIdentity",
    ]);
    expect(Object.keys(projected.attempt.registrationCursor)).toEqual([
      "namespaceId",
      "syncModelId",
      "sourceEpoch",
      "appliedThroughSequence",
    ]);
    expect(extraGetterReads).toBe(0);
  });

  it("owns every evaluation-work receipt and preserves nominal capabilities", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = getSuccess(beginQueryEvaluation(
      initial,
      firstEvaluationRequest(),
    ));
    if (begun._tag !== "created") {
      throw new Error("Expected initial evaluation work.");
    }
    const claimed = getSuccess(claimEvaluationWork(begun.state, {
      maximumQueryInspections: 1,
      continuation: null,
    }));
    if (claimed._tag !== "claimed") {
      throw new Error("Expected claimed evaluation work.");
    }
    const blockedWork = Object.freeze({
      queryKey: claimed.attempt.descriptor.queryKey,
      generation: claimed.attempt.generation,
      reason: "terminalEvaluatorRefusal" as const,
      resetRequired: true as const,
    });
    const claimDecisions: readonly ClaimEvaluationWorkDecision[] = [
      claimed,
      Object.freeze({
        _tag: "continued",
        state: claimed.state,
        continuation: claimed.continuation,
      }),
      Object.freeze({
        _tag: "scanRestarted",
        state: claimed.state,
        continuation: claimed.continuation,
      }),
      Object.freeze({
        _tag: "blocked",
        state: claimed.state,
        blockedWork,
      }),
      Object.freeze({ _tag: "none", state: claimed.state }),
    ];
    const claimReceipts = claimDecisions.map(
      projectClaimEvaluationWorkReceipt,
    );
    expect(claimReceipts.map(Object.keys)).toEqual([
      ["_tag", "attempt", "continuation"],
      ["_tag", "continuation"],
      ["_tag", "continuation"],
      ["_tag", "blockedWork"],
      ["_tag"],
    ]);
    for (const receipt of claimReceipts) {
      expect(Object.isFrozen(receipt)).toBe(true);
    }
    const claimedReceipt = claimReceipts[0];
    if (claimedReceipt?._tag !== "claimed") {
      throw new Error("Expected claimed receipt.");
    }
    expect(claimedReceipt.attempt).toBe(claimed.attempt);
    expect(claimedReceipt.continuation).toBe(claimed.continuation);
    const continuedReceipt = claimReceipts[1];
    if (continuedReceipt?._tag !== "continued") {
      throw new Error("Expected continued receipt.");
    }
    expect(continuedReceipt.continuation).toBe(claimed.continuation);
    const blockedClaimReceipt = claimReceipts[3];
    if (blockedClaimReceipt?._tag !== "blocked") {
      throw new Error("Expected blocked claim receipt.");
    }
    expect(Object.keys(blockedClaimReceipt.blockedWork)).toEqual([
      "queryKey",
      "generation",
      "reason",
      "resetRequired",
    ]);
    expect(Object.isFrozen(blockedClaimReceipt.blockedWork)).toBe(true);

    const nextGeneration = getSuccess(captureQueryGeneration(2n));
    const outcomeDecisions:
      readonly RecordEvaluationAttemptOutcomeDecision[] = [
        Object.freeze({
          _tag: "eligible",
          state: claimed.state,
          queryKey: blockedWork.queryKey,
          generation: blockedWork.generation,
        }),
        Object.freeze({
          _tag: "blocked",
          state: claimed.state,
          blockedWork,
        }),
        Object.freeze({
          _tag: "superseded",
          state: claimed.state,
          queryKey: blockedWork.queryKey,
          generation: blockedWork.generation,
          activeGeneration: nextGeneration,
        }),
        Object.freeze({
          _tag: "recoveryEvidenceExpired",
          state: claimed.state,
          queryKey: blockedWork.queryKey,
          generation: blockedWork.generation,
          activeGeneration: nextGeneration,
        }),
      ];
    const outcomeReceipts = outcomeDecisions.map(
      projectRecordEvaluationAttemptOutcomeReceipt,
    );
    expect(outcomeReceipts.map(Object.keys)).toEqual([
      ["_tag", "queryKey", "generation"],
      ["_tag", "blockedWork"],
      ["_tag", "queryKey", "generation", "activeGeneration"],
      ["_tag", "queryKey", "generation", "activeGeneration"],
    ]);
    for (const receipt of outcomeReceipts) {
      expect(Object.isFrozen(receipt)).toBe(true);
    }
    const blockedOutcomeReceipt = outcomeReceipts[1];
    if (blockedOutcomeReceipt?._tag !== "blocked") {
      throw new Error("Expected blocked outcome receipt.");
    }
    expect(Object.isFrozen(blockedOutcomeReceipt.blockedWork)).toBe(true);
  });

  it("owns and freezes every exact completion receipt shape", () => {
    let extraGetterReads = 0;
    const poison = <A extends object>(value: A): A => Object.defineProperty(
      value,
      "unmeasured",
      {
        enumerable: true,
        get: () => {
          extraGetterReads += 1;
          throw new Error("Undeclared completion receipt field was traversed.");
        },
      },
    );
    const namespaceCursor = cursor();
    const state = getSuccess(createEmptyQuerySyncState(namespaceCursor));
    const begin = getSuccess(beginQueryEvaluation(
      state,
      firstEvaluationRequest(),
    ));
    if (begin._tag !== "created") {
      throw new Error("Expected an evaluation attempt to be created.");
    }
    const generation = begin.attempt.generation;
    const nextGeneration = getSuccess(captureQueryGeneration(2n));
    const nextSequence = getSuccess(captureSyncSequence(1n));
    const sourceIdentity: QueryPublicationIdentity = poison({
      namespaceId: begin.attempt.namespaceId,
      syncModelId: begin.attempt.syncModelId,
      sourceEpoch: begin.attempt.sourceEpoch,
      queryKey: begin.attempt.descriptor.queryKey,
      generation,
    });
    const sourceDisposition: QueryCompletionPublicationDisposition = poison({
      _tag: "pending",
      identity: sourceIdentity,
    });
    const decisions: readonly CompleteQueryEvaluationDecision[] = [
      poison({
        _tag: "refreshRequired" as const,
        state,
        refreshedThroughSequence: namespaceCursor.appliedThroughSequence,
        requiredThroughSequence: nextSequence,
      }),
      poison({
        _tag: "resnapshotRequired" as const,
        state,
        generation,
      }),
      poison({
        _tag: "rerunRequired" as const,
        state,
        generation,
        relevantThroughSequence: nextSequence,
      }),
      poison({
        _tag: "completed" as const,
        state,
        generation,
        publicationDisposition: sourceDisposition,
      }),
      poison({
        _tag: "replayed" as const,
        state,
        generation,
        publicationDisposition: poison({ _tag: "unchanged" as const }),
      }),
      poison({
        _tag: "superseded" as const,
        state,
        generation,
        activeGeneration: nextGeneration,
      }),
      poison({
        _tag: "recoveryEvidenceExpired" as const,
        state,
        generation,
        activeGeneration: nextGeneration,
      }),
    ];
    const receipts = decisions.map(projectCompleteReceipt);

    expect(receipts.map((receipt) => Object.keys(receipt))).toEqual([
      ["_tag", "refreshedThroughSequence", "requiredThroughSequence"],
      ["_tag", "generation"],
      ["_tag", "generation", "relevantThroughSequence"],
      ["_tag", "generation", "publicationDisposition"],
      ["_tag", "generation", "publicationDisposition"],
      ["_tag", "generation", "activeGeneration"],
      ["_tag", "generation", "activeGeneration"],
    ]);
    for (const receipt of receipts) expect(Object.isFrozen(receipt)).toBe(true);
    const completed = receipts[3];
    if (completed?._tag !== "completed") {
      throw new Error("Expected the completed receipt.");
    }
    expect(Object.isFrozen(sourceDisposition)).toBe(false);
    expect(Object.isFrozen(sourceIdentity)).toBe(false);
    expect(completed.publicationDisposition === sourceDisposition).toBe(false);
    expect(Object.isFrozen(completed.publicationDisposition)).toBe(true);
    expect(Object.keys(completed.publicationDisposition)).toEqual([
      "_tag",
      "identity",
    ]);
    if (completed.publicationDisposition._tag !== "pending") {
      throw new Error("Expected a pending publication disposition.");
    }
    expect(completed.publicationDisposition.identity === sourceIdentity).toBe(
      false,
    );
    expect(Object.isFrozen(
      completed.publicationDisposition.identity,
    )).toBe(true);
    expect(Object.keys(completed.publicationDisposition.identity)).toEqual([
      "namespaceId",
      "syncModelId",
      "sourceEpoch",
      "queryKey",
      "generation",
    ]);
    const replayed = receipts[4];
    if (replayed?._tag !== "replayed") {
      throw new Error("Expected the replayed receipt.");
    }
    expect(Object.isFrozen(replayed.publicationDisposition)).toBe(true);
    expect(Object.keys(replayed.publicationDisposition)).toEqual(["_tag"]);
    expect(extraGetterReads).toBe(0);
  });
});

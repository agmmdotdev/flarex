import { describe, expect, it } from "vitest";

import {
  beginQueryEvaluation,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";

import {
  initializedNamespaceReceipt,
  projectBeginReceipt,
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
      pendingPublicationContentBytes:
        state.metrics.pendingPublicationContentBytes,
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
      "pendingPublicationContentBytes",
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
    }));
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
});

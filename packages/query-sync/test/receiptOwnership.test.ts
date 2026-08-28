import { describe, expect, it } from "vitest";

import {
  beginQueryGeneration,
  createEmptyQuerySyncState,
} from "@flarex/query-sync/internal/kernel";

import {
  initializedNamespaceReceipt,
  projectBeginReceipt,
} from "../src/state/Receipts.js";
import { cursor, getSuccess, target } from "./fixtures.js";

describe("query-sync receipt ownership", () => {
  it("captures cursor, metrics, and descriptor by exact fields", () => {
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
    const begin = getSuccess(beginQueryGeneration(state, target()));
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
      "countedCanonicalBytes",
    ]);

    const enrichedDescriptor = poison({
      queryKey: begin.descriptor.queryKey,
      queryIdentity: begin.descriptor.queryIdentity,
    });
    const projected = projectBeginReceipt(poison({
      _tag: begin._tag,
      state: begin.state,
      descriptor: enrichedDescriptor,
      generation: begin.generation,
      registrationCursor: enrichedCursor,
    }));
    expect(Object.keys(projected.descriptor)).toEqual([
      "queryKey",
      "queryIdentity",
    ]);
    expect(Object.keys(projected.registrationCursor)).toEqual([
      "namespaceId",
      "syncModelId",
      "sourceEpoch",
      "appliedThroughSequence",
    ]);
    expect(extraGetterReads).toBe(0);
  });
});

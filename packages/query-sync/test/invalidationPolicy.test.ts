import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyAdmittedInvalidations,
  beginQueryGeneration,
  completeQueryGeneration,
  createEmptyQuerySyncState,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
} from "@flarex/query-sync/internal/kernel";
import type {
  QueryDescriptor,
  QuerySyncState,
} from "@flarex/query-sync/internal/kernel";
import {
  deriveGenerationRefreshEvidence,
} from "@flarex/query-sync/testing/reference-model";

import {
  batch,
  canonicalText,
  cursor,
  descriptor,
  evaluation,
  getSuccess,
  target,
} from "./fixtures.js";

function installActiveQuery(
  state: QuerySyncState,
  queryDescriptor: QueryDescriptor,
  dependencies: readonly string[],
): QuerySyncState {
  const begun = getSuccess(beginQueryGeneration(
    state,
    target({ descriptor: queryDescriptor }),
  ));
  const evidence = evaluation({
    descriptor: queryDescriptor,
    generation: begun.generation,
    snapshot: state.cursor.appliedThroughSequence,
    dependencies,
  });
  const refresh = getSuccess(deriveGenerationRefreshEvidence(
    evidence,
    begun.state.cursor,
    [],
    evidence.authorityWitness,
  ));
  const completed = getSuccess(completeQueryGeneration(
    begun.state,
    evidence,
    refresh,
  ));
  if (completed._tag !== "completed") {
    throw new Error("Expected clean fixture completion");
  }
  return completed.state;
}

describe("admitted invalidation policy", () => {
  it("routes an exact-next batch through the dependency directory", () => {
    const dependency = canonicalText("record:1");
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const active = installActiveQuery(initial, descriptor(), [dependency]);
    const applied = getSuccess(applyAdmittedInvalidations(
      active,
      batch({ sequence: 1n, dependencies: [dependency] }),
    ));

    expect(applied).toMatchObject({
      _tag: "applied",
      appliedSequence: 1n,
      affectedQueryKeys: [descriptor().queryKey],
    });
    expect(applied.state.cursor.appliedThroughSequence).toBe(1n);
    expect(applied.state.queries[0]?.active?.dirtyThroughSequence).toBe(1n);
    expect(active.cursor.appliedThroughSequence).toBe(0n);
    expect(active.queries[0]?.active?.dirtyThroughSequence).toBeNull();
  });

  it("advances the cursor atomically even when no active query matches", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const begun = getSuccess(beginQueryGeneration(initial, target()));
    const applied = getSuccess(applyAdmittedInvalidations(
      begun.state,
      batch({
        sequence: 1n,
        dependencies: [canonicalText("unrelated")],
      }),
    ));

    expect(applied).toMatchObject({
      _tag: "applied",
      affectedQueryKeys: [],
    });
    expect(applied.state.cursor.appliedThroughSequence).toBe(1n);
    expect(applied.state.queries[0]?.active).toBeNull();
    expect(applied.state.queries[0]?.provisional?.generation).toBe(1n);
  });

  it("preserves active and provisional slots and advances dirty monotonically", () => {
    const dependency = canonicalText("record:1");
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const active = installActiveQuery(initial, descriptor(), [dependency]);
    const withCandidate = getSuccess(beginQueryGeneration(active, target()));

    const first = getSuccess(applyAdmittedInvalidations(
      withCandidate.state,
      batch({ sequence: 1n, dependencies: [dependency] }),
    ));
    const second = getSuccess(applyAdmittedInvalidations(
      first.state,
      batch({ sequence: 2n, dependencies: [dependency] }),
    ));

    expect(second.state.queries[0]?.active?.dirtyThroughSequence).toBe(2n);
    expect(second.state.queries[0]?.provisional?.generation).toBe(2n);
    expect(second.state.queries[0]?.active?.dependencyKeys).toEqual([
      dependency,
    ]);
  });

  it("returns unchanged state for duplicate, gap, and epoch reset decisions", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor({ sequence: 3n })));
    const duplicate = getSuccess(applyAdmittedInvalidations(
      initial,
      batch({ sequence: 3n }),
    ));
    const gap = getSuccess(applyAdmittedInvalidations(
      initial,
      batch({ sequence: 5n }),
    ));
    const reset = getSuccess(applyAdmittedInvalidations(
      initial,
      batch({ sourceEpoch: "epoch-b", sequence: 1n }),
    ));

    expect(duplicate._tag).toBe("duplicate");
    expect(gap).toMatchObject({
      _tag: "gap",
      expectedSequence: 4n,
      observedSequence: 5n,
    });
    expect(reset._tag).toBe("resetRequired");
    expect(duplicate.state).toBe(initial);
    expect(gap.state).toBe(initial);
    expect(reset.state).toBe(initial);
  });

  it("refuses namespace and model crossing without advancing the cursor", () => {
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const wrongNamespace = applyAdmittedInvalidations(
      initial,
      batch({ namespaceId: "tenant-b", sequence: 1n }),
    );
    expect(Result.isFailure(wrongNamespace)).toBe(true);
    if (Result.isFailure(wrongNamespace)) {
      expect(wrongNamespace.failure).toBeInstanceOf(
        QuerySyncNamespaceMismatchError,
      );
    }

    const wrongModel = applyAdmittedInvalidations(
      initial,
      batch({ syncModelId: "graph", sequence: 1n }),
    );
    expect(Result.isFailure(wrongModel)).toBe(true);
    if (Result.isFailure(wrongModel)) {
      expect(wrongModel.failure).toBeInstanceOf(QuerySyncModelMismatchError);
    }
    expect(initial.cursor.appliedThroughSequence).toBe(0n);
  });

  it("returns affected query keys in canonical order independent of insertion", () => {
    const dependency = canonicalText("shared");
    const firstDescriptor = descriptor({ keySeed: 9, identity: "later" });
    const secondDescriptor = descriptor({ keySeed: 2, identity: "earlier" });
    const initial = getSuccess(createEmptyQuerySyncState(cursor()));
    const first = installActiveQuery(
      initial,
      firstDescriptor,
      [dependency],
    );
    const second = installActiveQuery(
      first,
      secondDescriptor,
      [dependency],
    );
    const applied = getSuccess(applyAdmittedInvalidations(
      second,
      batch({ sequence: 1n, dependencies: [dependency] }),
    ));

    expect(applied._tag).toBe("applied");
    if (applied._tag === "applied") {
      expect(applied.affectedQueryKeys).toEqual([
        secondDescriptor.queryKey,
        firstDescriptor.queryKey,
      ]);
      expect(Object.isFrozen(applied.affectedQueryKeys)).toBe(true);
    }
  });
});

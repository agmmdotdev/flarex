import { expect, it } from "vitest";

import {
  proveApplicationNativeQuery,
  proveApplicationNativeQueryCache,
  type ApplicationNativeQueryFixtureFactory,
} from "../../support/applicationNativeQueryHarness";

export interface ApplicationNativeQueryContractAdapter {
  readonly runScenario: <A>(
    scenario: (createFixture: ApplicationNativeQueryFixtureFactory) => Promise<A>,
  ) => Promise<A>;
}

export function defineApplicationNativeQueryContract(
  adapter: ApplicationNativeQueryContractAdapter,
): void {
  it("opens the active snapshot and executes one fresh Application Worker", async () => {
    const proof = await adapter.runScenario(proveApplicationNativeQuery);
    expect(proof).toMatchObject({
      result: { name: "Ada" },
      freshWorkerLoads: 2,
      snapshotRevalidations: 2,
      pointDocumentReads: 2,
      sourceReads: 2,
      headMovementSelectedNewRevision: true,
    });
  }, 480_000);
  it("transfers completed query data and refreshes genuine same-key and key-changing patches", async () => {
    const proof = await adapter.runScenario(proveApplicationNativeQueryCache);
    const { first, next, ids } = proof;
    expect(proof.caughtMismatch).toMatchObject({ workerLoads: 1,
      error: { _tag: "ApplicationResultContractError", operation: "query" } });
    for (const refusal of [proof.coldInvertedBounds, proof.warmInvertedBounds]) {
      expect(refusal).toMatchObject({ refused: true, invalidBoundsFailures: 1, workerLoads: 1 });
      expect(refusal.reads.every(read => read.method === "queryIndexRange")).toBe(true);
      expect(refusal.reads.at(-1)).toMatchObject({ rowSnapshotReads: 0, indexSnapshotReads: 0 });
    }
    expect(proof.coldInvertedBounds.reads).toHaveLength(1);
    expect(proof.warmInvertedBounds.reads).toHaveLength(2);
    expect(proof.warmInvertedBounds.reads[0]?.rowSnapshotReads).toBeGreaterThan(0);
    expect(proof.warmInvertedBounds.reads[0]?.indexSnapshotReads).toBeGreaterThan(0);
    for (const operation of [first, proof.unchanged, proof.afterCaughtMismatch, proof.sameKey, next]) {
      const value = operation.value;
      expect(operation.workerLoads).toBe(1);
      expect(value.repeated).toEqual(value.first);
      expect(value.missing).toBeNull();
      expect(value.missingRepeated).toBeNull();
      expect(value.limited).toMatchObject({ documents: [{ _id: ids.first, name: "Ada" }], isDone: false });
      expect(value.fromRange).toEqual(value.limited.documents[0]);
      expect(value.expanded.documents.map(document => document._id)).toEqual([ids.first, ids.second, ids.changed]);
      expect(value.expanded.isDone).toBe(true);
      expect(value.afterExpanded).toEqual(value.expanded.documents[1]);
      expect(value.covered).toEqual({ documents: value.expanded.documents.slice(0, 2), isDone: false });
      expect(value.bounded).toEqual({ documents: value.expanded.documents.slice(0, 2), isDone: true });
      expect(value.boundedLimited).toEqual({ documents: value.expanded.documents.slice(0, 1), isDone: false });
      expect(value.repeatedRange).toEqual(value.expanded);

      const points = operation.reads.filter(read => read.method === "readPointDocument");
      const indexes = operation.reads.filter(read => read.method === "queryIndexRange");
      expect(points).toHaveLength(6);
      expect(indexes).toHaveLength(6);
      // Positive controls make missing cross-RPC diagnostics fail, rather than
      // treating an unobserved operation as proof of a zero-read cache hit.
      expect(points[2]?.rowSnapshotReads).toBeGreaterThan(0);
      if (operation === first || operation === proof.afterCaughtMismatch) {
        expect(points[0]?.rowSnapshotReads).toBeGreaterThan(0);
        expect(indexes[0]?.indexSnapshotReads).toBeGreaterThan(0);
        expect(indexes[0]?.rowSnapshotReads).toBeGreaterThan(0);
        expect(indexes[1]?.indexSnapshotReads).toBeGreaterThan(0);
      } else {
        expect(points[0]?.rowSnapshotReads).toBe(0);
        for (const read of indexes) expect(read).toMatchObject({ rowSnapshotReads: 0, indexSnapshotReads: 0 });
      }
      const reused = operation.reads.filter(read => read.method === "readPointDocument"
        ? read.ordinal === 2 || read.ordinal >= 4 : read.ordinal >= 3);
      expect(reused).toHaveLength(8);
      for (const read of reused) expect(read).toMatchObject({ rowSnapshotReads: 0, indexSnapshotReads: 0 });
    }
    expect(first.value.first).toMatchObject({ _id: ids.changed, name: "Bea" });
    expect(first.refreshCaptures).toBe(0);
    expect(first.refreshRowSnapshotReads).toBe(0);
    expect(proof.unchanged.value).toEqual(first.value);
    expect(proof.afterCaughtMismatch.value).toEqual(first.value);
    expect(proof.unchanged.refreshCaptures).toBe(0);
    expect(proof.unchanged.refreshRowSnapshotReads).toBe(0);
    expect(proof.sameKey.value.first).toMatchObject({ _id: ids.changed, name: "Bea", padding: "same-key refreshed body" });
    for (const operation of [proof.sameKey, next]) {
      expect(operation.refreshCaptures).toBe(1);
      expect(operation.refreshRowSnapshotReads).toBeGreaterThan(0);
    }
    expect(next.value.first).toMatchObject({ _id: ids.changed, name: "Cyra" });
    expect(next.value.expanded.documents[2]).toMatchObject({ _id: ids.changed, name: "Cyra" });
    expect(proof.mutationCommitSeq).toBeGreaterThan(0n);
  }, 480_000);
}

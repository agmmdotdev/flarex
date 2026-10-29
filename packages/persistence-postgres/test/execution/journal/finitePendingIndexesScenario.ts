import { Effect } from "effect";
import { expect } from "vitest";
import { decodeAppRowIdHexV1, type AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodeOrderedIndexBoundHexV1, type OrderedIndexBoundsV1 } from "flarex-protocol/ordered-index";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence,
  ApplicationNativeMutationFixtureOptions } from "../../application/applicationNativeMutationTestFixture";
import { FINITE_INDEXED_QUERY_OPTIONS, inventory, makeFiniteIndexedQueriesHarness } from "./finiteIndexedQueriesScenario";
import { pendingIndexOwnerScenario } from "./pendingIndexOwnerScenario";

export const FINITE_PENDING_INDEX_OPTIONS = {
  ...FINITE_INDEXED_QUERY_OPTIONS,
  initialUserDocuments: [...FINITE_INDEXED_QUERY_OPTIONS.initialUserDocuments,
    { name: "Delta", rowId: decodeAppRowIdHexV1("d1000000000000000000000000000004") },
    { name: "Gamma", rowId: decodeAppRowIdHexV1("c1000000000000000000000000000003") }],
} satisfies ApplicationNativeMutationFixtureOptions;

type Fixture = ApplicationNativeMutationFixture<ApplicationNativeMutationPersistence>;
type FiniteIndexedHarness = Effect.Success<ReturnType<typeof makeFiniteIndexedQueriesHarness>>;
type FiniteIndexedEntry = Effect.Success<ReturnType<FiniteIndexedHarness["open"]>>;

/** Real finite calls preserve write admission, body replacement, dependency
 * order and base-prefix refill independently of the private index structure. */
export const finitePendingIndexesScenario = Effect.fn("FiniteIndexedQueries.pendingIndexes")(
  function* (native: Fixture) {
    return yield* Effect.scoped(Effect.gen(function* () {
      const harness = yield* makeFiniteIndexedQueriesHarness(native);
      const warmEntry = yield* harness.open();
      const warm = finiteUserOperations(harness, warmEntry);

      // An unread intermediate key may be invalid, even before first index use.
      yield* warm.patch(harness.alphaId, { name: "Z".repeat(3_000) });
      yield* warm.patch(harness.alphaId, { name: "Charlie" });
      expect(yield* warm.range(4)).toMatchObject({ kind: "completed", delivery: "executed",
        outcome: { documents: [{ name: "Beta" }, { name: "Charlie" }, { name: "Delta" }, { name: "Gamma" }], isDone: true } });
      yield* warm.patch(harness.alphaId, { name: "Echo" });
      expect(yield* warm.range(4)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Beta" }, { name: "Delta" }, { name: "Echo" }, { name: "Gamma" }], isDone: true } });
      yield* warm.patch(harness.alphaId, { name: "Alpha", padding: "first body" });
      expect(yield* warm.range(4)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Alpha", padding: "first body" }, { name: "Beta" }, { name: "Delta" }, { name: "Gamma" }], isDone: true } });
      // Both seeded creation times are 1, so matching names tie on the entire
      // encoded key. The pending Alpha identity must precede base Beta by ID.
      yield* warm.patch(harness.alphaId, { name: "Beta" });
      expect(yield* warm.range(4)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ _id: harness.alphaId, _creationTime: 1, name: "Beta", padding: "first body" },
          { _id: harness.betaId, _creationTime: 1, name: "Beta" }, { name: "Delta" }, { name: "Gamma" }], isDone: true } });
      yield* warm.patch(harness.alphaId, { name: "Alpha" });
      expect(yield* warm.range(4)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Alpha", padding: "first body" }, { name: "Beta" }, { name: "Delta" }, { name: "Gamma" }], isDone: true } });
      // Equal keys must replace bodies; an already warm index cannot make a
      // later temporary-invalid transition fail earlier than a cold index.
      yield* warm.patch(harness.alphaId, { padding: "second body" });
      expect(yield* warm.range(4)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Alpha", padding: "second body" }, { name: "Beta" }, { name: "Delta" }, { name: "Gamma" }], isDone: true } });
      yield* warm.patch(harness.alphaId, { name: "Y".repeat(3_000) });
      yield* warm.patch(harness.alphaId, { name: "Alpha", padding: "latest body" });
      for (let read = 0; read < 2; read++) expect(yield* warm.range(4)).toMatchObject({ kind: "completed", delivery: "executed",
        outcome: { documents: [{ name: "Alpha", padding: "latest body" }, { name: "Beta" }, { name: "Delta" }, { name: "Gamma" }], isDone: true } });
      const warmed = yield* harness.freeze(warmEntry);
      expect(warmed.view.graph.attempts).toHaveLength(9);
      expect(warmed.view.graph.attempts.every(attempt => attempt.documentId === harness.alphaId)).toBe(true);
      expect(warmed.view.rowIntents).toMatchObject([{ kind: "live", documentId: harness.alphaId,
        value: { name: "Alpha", padding: "latest body" } }]);
      expect(yield* harness.publisher.publishFinite(warmed.command)).toMatchObject({ kind: "published" });
      yield* pendingIndexOwnerScenario(native, harness, warmed.command.frozenAttempt);

      // Establish A/B observation order, then write in B/A order. Both latest
      // keys are invalid and outside this genuinely empty range. The first
      // typed key failure must still be A's rather than suffix-first B's.
      const invalidEntry = yield* harness.open();
      const invalid = finiteUserOperations(harness, invalidEntry);
      const emptyBounds = { endExclusive: decodeOrderedIndexBoundHexV1("00") };
      expect(yield* invalid.range(1, emptyBounds)).toMatchObject({ kind: "completed",
        outcome: { documents: [], isDone: true } });
      expect(yield* invalid.get(harness.alphaId)).toMatchObject({ kind: "completed", outcome: { kind: "present" } });
      expect(yield* invalid.get(harness.betaId)).toMatchObject({ kind: "completed", outcome: { kind: "present" } });
      yield* invalid.patch(harness.betaId, { name: "Z".repeat(4_000) });
      yield* invalid.patch(harness.alphaId, { name: "Y".repeat(3_000) });
      const failedBefore = yield* Effect.tryPromise(() => inventory(native));
      expect(yield* Effect.flip(invalid.range(1, emptyBounds))).toMatchObject({
        _tag: "OrderedIndexKeyTooLargeError", observedBytes: 3_002, maximumBytes: 2_048,
      });
      yield* harness.store.discardFiniteRootEffect(invalidEntry.attempt);
      expect(yield* Effect.tryPromise(() => inventory(native))).toEqual(failedBefore);

      const refillEntry = yield* harness.open();
      const refill = finiteUserOperations(harness, refillEntry);
      yield* refill.remove(harness.alphaId);
      yield* refill.remove(harness.betaId);
      // Live pending cardinality is zero, but both written base identities must
      // still suppress the first two rows and count toward compensation.
      expect(yield* refill.range(1)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Delta" }], isDone: false } });
      const zuluId = yield* refill.insert({ name: "Zulu" });
      expect(yield* refill.range(1)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Delta" }], isDone: false } });
      const ephemeralId = yield* refill.insert({ name: "Ephemeral" });
      expect(yield* refill.range(4)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Delta" }, { name: "Ephemeral" }, { name: "Gamma" }, { name: "Zulu" }], isDone: true } });
      yield* refill.remove(ephemeralId);
      expect(yield* refill.range(3)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Delta" }, { name: "Gamma" }, { name: "Zulu" }], isDone: true } });
      const refilled = yield* harness.freeze(refillEntry);
      expect(refilled.view.graph.noFinalRows).toEqual([ephemeralId]);
      expect(refilled.view.graph.attempts.filter(attempt => attempt.documentId === ephemeralId)
        .map(attempt => attempt.operation)).toEqual(["insert", "delete"]);
      expect(refilled.view.graph.attempts).toHaveLength(5);
      expect(refilled.view.rowIntents.map(row => row.documentId).toSorted()).toEqual(
        [harness.alphaId, harness.betaId, zuluId].toSorted());
      expect(yield* harness.publisher.publishFinite(refilled.command)).toMatchObject({ kind: "published" });
      const freshEntry = yield* harness.open();
      expect(yield* finiteUserOperations(harness, freshEntry).range(3)).toMatchObject({ kind: "completed",
        outcome: { documents: [{ name: "Delta" }, { name: "Gamma" }, { name: "Zulu" }], isDone: true } });
      yield* harness.store.discardFiniteRootEffect(freshEntry.attempt);
    }));
  },
);

function finiteUserOperations(harness: FiniteIndexedHarness, entry: FiniteIndexedEntry) {
  let sequence = 0n;
  const next = () => CommitSyscallSequenceV1Schema.make(++sequence);
  const patch = Effect.fn("FiniteIndexedQueries.patch")(function* (documentId: AppDocumentIdV1,
    fields: Readonly<{ name?: string; padding?: string }>) {
    expect(yield* harness.store.runPointOperationEffect(entry.table, { kind: "patch", syscallSequence: next(),
      documentId, patch: fields }, entry.validator)).toMatchObject({ kind: "completed", outcome: { kind: "unit", operation: "patch" } });
  });
  const remove = Effect.fn("FiniteIndexedQueries.delete")(function* (documentId: AppDocumentIdV1) {
    expect(yield* harness.store.runPointOperationEffect(entry.table, { kind: "delete", syscallSequence: next(),
      documentId }, entry.validator)).toMatchObject({ kind: "completed", outcome: { kind: "unit", operation: "delete" } });
  });
  const insert = Effect.fn("FiniteIndexedQueries.insert")(function* (fields: Readonly<{ name: string }>) {
    const result = yield* harness.store.runPointOperationEffect(entry.table, { kind: "insert", syscallSequence: next(), fields }, entry.validator);
    if (result.kind !== "completed" || result.outcome.kind !== "inserted") throw new Error("Missing finite inserted document");
    return result.outcome.documentId;
  });
  const get = (documentId: AppDocumentIdV1) => harness.store.runPointOperationEffect(entry.table,
    { kind: "get", syscallSequence: next(), documentId }, entry.validator);
  const range = (limit: number, bounds: OrderedIndexBoundsV1 = {}) => harness.store.runIndexedQueryEffect(entry.index,
    { kind: "indexRange", syscallSequence: next(), bounds, limit });
  return Object.freeze({ patch, remove, insert, get, range });
}

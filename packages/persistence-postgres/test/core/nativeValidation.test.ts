import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreTableDefinition } from "../../src/core/api";
import type { CorePersistenceIndexEntry, CoreWriteBatch } from "../../src/core/contracts";
import type { CoreNativeUniqueSlot } from "../../src/core/nativeObservations";
import { validateCoreNativeIndexes as validateIndexes, type CorePreparedNativeIndex } from "../../src/core/nativeValidation";

const id = (value: number) => Uint8Array.of(value);
const internalId = (value: number) => { const bytes = new Uint8Array(16); bytes[15] = value; return bytes; };
const table: CoreTableDefinition = { name: "news", number: 10001, tabletId: internalId(1), namespace: null,
  state: "active", indexes: [] };
const index = { name: "by_title", ref: { id: internalId(2) }, fields: ["title", "_creationTime"] };
const owner = (value: number) => Result.getOrThrow(encodeDocumentId(table.number, internalId(value)));
const slot = (owners: readonly string[]): CoreNativeUniqueSlot => ({ kind: "unique", table, index,
  interval: { start: id(10), end: id(20) }, owners });
const batch = (...indexes: readonly CorePersistenceIndexEntry[]): CoreWriteBatch => ({ documents: [], indexes });
const write = (key: number, value: number | null, ts = 1n): CorePersistenceIndexEntry => ({
  mode: "scanComplete", ts, index: index.ref, key: id(key), prev: null,
  value: value === null ? null : { tableId: table.tabletId, documentId: internalId(value) },
});
const prepared = (observation: CoreNativeUniqueSlot, entries: readonly [string, string][] = []): CorePreparedNativeIndex => ({
  observation, entries: new Map(entries),
});
const validateCoreNativeIndexes = (observations: readonly CorePreparedNativeIndex[], accepted: Iterable<CoreWriteBatch>,
  candidate: CoreWriteBatch) => validateIndexes(observations, accepted, candidate, 256);

describe("native terminal unique-owner validation", () => {
  it("accepts a published mismatch restored by a later accepted removal", () => {
    const state = prepared(slot([]), [["0a", owner(3)]]);
    expect(Result.isSuccess(validateCoreNativeIndexes([state], [batch(write(10, null))], batch()))).toBe(true);
    expect(state.entries.size).toBe(1);
  });

  it("folds complete ordered pending transitions before comparing exact owners", () => {
    const state = prepared(slot([]));
    const pending = [batch(write(10, 3)), batch(write(10, null), write(25, 3)),
      batch(write(11, 4)), batch(write(11, null))];
    const predecessors = Result.getOrThrow(validateCoreNativeIndexes([state], pending, batch(write(12, 5))));
    expect([...predecessors]).toEqual(pending);
    expect(Result.isFailure(validateCoreNativeIndexes([state], pending.slice(0, 3), batch()))).toBe(true);
  });

  it("requires exact owner identity and checks the candidate's final overlay", () => {
    const state = prepared(slot([owner(3)]), [["0a", owner(3)]]);
    expect(Result.isFailure(validateCoreNativeIndexes([state], [batch(write(10, null), write(11, 4))], batch()))).toBe(true);
    expect(Result.isFailure(validateCoreNativeIndexes([state], [], batch(write(11, 4))))).toBe(true);
    expect(Result.isSuccess(validateCoreNativeIndexes([state], [], batch(write(10, null), write(11, 4))))).toBe(true);
  });

  it("replays the complete accepted iterable for every observed slot", () => {
    const first = prepared(slot([]));
    const second = prepared(slot([]));
    function* accepted() { yield batch(write(10, 3)); }
    expect(Result.isFailure(validateCoreNativeIndexes([first, second], accepted(), batch()))).toBe(true);
    // A first slot outside the changed key must not consume the second slot's suffix.
    const outside = prepared({ ...slot([]), interval: { start: id(30), end: id(40) } });
    expect(Result.isFailure(validateCoreNativeIndexes([outside, second], accepted(), batch()))).toBe(true);
  });

  it("treats a pending target from another table as corruption", () => {
    const wrong = { ...write(10, 3), value: { tableId: internalId(9), documentId: internalId(3) } };
    const result = validateCoreNativeIndexes([
      prepared(slot([])),
    ], [batch(wrong)], batch());
    expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "corruptData" });
  });
});

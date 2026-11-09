import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option, Result } from "effect";
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreTableDefinition } from "../../src/core/api";
import { CorePersistenceError, type CoreHydratedIndexEntry, type CoreIndexScan, type CorePersistenceIndexEntry, type CorePersistenceSnapshot, type CoreWriteBatch } from "../../src/core/contracts";
import { CoreIndexRegistry } from "../../src/core/indexRegistry";
import type { CoreNativeRangeSlot } from "../../src/core/nativeObservations";
import { prepareCoreNativeIndexes, validateCoreNativeIndexes, type CorePreparedNativeIndex } from "../../src/core/nativeValidation";
import { CoreRegistry } from "../../src/core/registry";

const internalId = (value: number) => { const bytes = new Uint8Array(16); bytes[14] = value >> 8; bytes[15] = value; return bytes; };
const key = (value: number) => Uint8Array.of(value);
const index = { name: "by_amount", ref: { id: internalId(2) }, fields: ["amount"] };
const table: CoreTableDefinition = { name: "items", number: 10001, tabletId: internalId(1), namespace: null,
  state: "active", indexes: [index] };
const owner = (value: number) => Result.getOrThrow(encodeDocumentId(table.number, internalId(value)));
const range = (members: CoreNativeRangeSlot["members"] = []): CoreNativeRangeSlot => ({ kind: "range", table, index,
  interval: { start: key(10), end: key(30) }, members });
const batch = (...indexes: readonly CorePersistenceIndexEntry[]): CoreWriteBatch => ({ documents: [], indexes });
const write = (position: number, id: number | null, prev: bigint | null = null): CorePersistenceIndexEntry => ({
  mode: "scanComplete", ts: 1n, index: index.ref, key: key(position),
  prev: prev === null ? null : { ts: prev, documentId: internalId(id ?? 3) },
  value: id === null ? null : { tableId: table.tabletId, documentId: internalId(id) },
});
const prepared = (observation: CoreNativeRangeSlot, entries: readonly [string, string][] = []): CorePreparedNativeIndex => ({
  observation, entries: new Map(entries),
});
const registry = new CoreRegistry(new BTree([["items", { definition: table, id: table.tabletId, ts: 0n }]]),
  new Map(), new Map(), undefined, Result.getOrThrow(CoreIndexRegistry.empty().apply({ removed: [],
    added: [{ ...index, tableId: table.tabletId, state: { type: "Enabled" }, ts: 0n }] })));

describe("native complete ordinary-index validation", () => {
  it("rejects movement within one interval even when the owner ID is unchanged", () => {
    const observed = prepared(range([{ id: owner(3), key: key(10) }]), [["0a", owner(3)]]);
    expect(Result.isFailure(validateCoreNativeIndexes([observed], [batch(write(10, null), write(11, 3))], batch(), 256)))
      .toBe(true);
  });

  it("retains every overlapping batch as a prerequisite, including same-key revisions and restoring ABA", () => {
    const observed = prepared(range([{ id: owner(3), key: key(10) }]), [["0a", owner(3)]]);
    const sameKey = batch(write(10, 3, 1n));
    const remove = batch(write(10, null));
    const restore = batch(write(10, 3));
    const unrelated = batch(write(40, 4));
    expect([...Result.getOrThrow(validateCoreNativeIndexes([observed], [sameKey, remove, unrelated, restore], batch(), 256))])
      .toEqual([sameKey, remove, restore]);
    expect(observed.entries).toEqual(new Map([["0a", owner(3)]]));
  });

  it("accepts terminal empty ABA and keeps the root's own pending output separate", () => {
    const insert = batch(write(10, 3)), remove = batch(write(10, null));
    expect([...Result.getOrThrow(validateCoreNativeIndexes([prepared(range())], [insert, remove], batch(write(11, 4)), 256))])
      .toEqual([insert, remove]);
  });

  it("classifies accepted terminal overflow before equality but allows an intermediate overflow restored by the suffix", () => {
    const members = Array.from({ length: 257 }, (_, position) => ({ id: owner(position + 1),
      key: Uint8Array.of(10, position >> 8, position) }));
    const writes = members.map((member, position) => ({ ...write(10, position + 1), key: member.key }));
    const first = batch(...writes.slice(0, 128)), second = batch(...writes.slice(128));
    const overflow = validateCoreNativeIndexes([prepared(range())], [first, second], batch(), 256);
    expect(Result.isFailure(overflow) && overflow.failure).toMatchObject({ reason: "capacity",
      cause: { actual: 257, limit: 256 } });
    const last = members[256];
    if (last === undefined) throw new Error("Missing overflow member");
    const observed = prepared(range(members.slice(0, 256)), members.slice(0, 256).map(member =>
      [encodeBytesToLowercaseHex(member.key), member.id]));
    const insert = batch({ ...write(10, 257), key: last.key });
    const remove = batch({ ...write(10, null), key: last.key });
    expect([...Result.getOrThrow(validateCoreNativeIndexes([observed], [insert, remove], batch(), 256))])
      .toEqual([insert, remove]);
  });

  it("probes a partial physical cursor at the identity cap until true EOF or one extra member", async () => {
    for (const overflow of [false, true]) {
      const requests: number[] = [];
      const first: CoreHydratedIndexEntry = { key: key(10), document: { ts: 1n, tableId: table.tabletId,
        id: internalId(3), jsonValue: new Uint8Array(), deleted: false, prevTs: null } };
      const second: CoreHydratedIndexEntry = { ...first, key: key(11), document: { ...first.document, id: internalId(4) } };
      const snapshot: CorePersistenceSnapshot = { timestamp: 1n, get: () => Effect.succeed(Option.none()), preload: () => Effect.void, scan: request => {
        requests.push(request.maxResults);
        return Effect.succeed(requests.length === 1 ? { entries: [first], cursor: { kind: "after", key: key(10) } }
          : { entries: overflow ? [second] : [], cursor: { kind: "end" } });
      } };
      const result = await Effect.runPromise(Effect.result(prepareCoreNativeIndexes(snapshot, registry, [range()], 1)));
      expect(requests).toEqual([2, 1]);
      if (overflow) expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "capacity" });
      else expect(Result.getOrThrow(result)[0]?.entries.size).toBe(1);
    }
  });

  describe("batched first pages", () => {
    const other: CoreNativeRangeSlot = { ...range(), interval: { start: key(40), end: key(50) } };
    const stale: CoreNativeRangeSlot = { ...range(), index: { ...index, ref: { id: internalId(9) } } };
    const counting = (preload: CorePersistenceSnapshot["preload"]) => {
      const scans: CoreIndexScan[] = [];
      const snapshot: CorePersistenceSnapshot = { timestamp: 1n, get: () => Effect.succeed(Option.none()), preload,
        scan: request => { scans.push(request); return Effect.succeed({ entries: [], cursor: { kind: "end" } }); } };
      return { scans, snapshot };
    };

    it("preloads exactly the current first-page scans and leaves a stale index to the ordered loop", async () => {
      const preloaded: (readonly CoreIndexScan[])[] = [];
      const { scans, snapshot } = counting(requests => Effect.sync(() => { preloaded.push(requests); }));
      const result = await Effect.runPromise(Effect.result(prepareCoreNativeIndexes(snapshot, registry, [range(), other, stale], 256)));
      expect(Result.isFailure(result) && result.failure).toMatchObject({ reason: "conflict", cause: "Native index generation changed" });
      expect(preloaded).toHaveLength(1);
      expect(preloaded[0]).toEqual(scans);
      expect(scans.map(scan => scan.interval)).toEqual([range().interval, other.interval]);
    });

    it("does not batch one observation or more than the statement bound", async () => {
      let preloads = 0;
      const { scans, snapshot } = counting(() => Effect.sync(() => { preloads++; }));
      await Effect.runPromise(prepareCoreNativeIndexes(snapshot, registry, [range()], 256));
      await Effect.runPromise(prepareCoreNativeIndexes(snapshot, registry, Array.from({ length: 1025 }, () => range()), 256));
      expect(preloads).toBe(0);
      expect(scans).toHaveLength(1026);
    });

    it("lets every scan report its own outcome after a typed batch failure", async () => {
      const { scans, snapshot } = counting(() => Effect.fail(new CorePersistenceError({ reason: "corruptData" })));
      expect(await Effect.runPromise(prepareCoreNativeIndexes(snapshot, registry, [range(), other], 256))).toHaveLength(2);
      expect(scans).toHaveLength(2);
    });

    it("propagates a defect or interruption from the batch", async () => {
      const defect = new Error("preload defect");
      const { scans, snapshot } = counting(() => Effect.die(defect));
      const exit = await Effect.runPromiseExit(prepareCoreNativeIndexes(snapshot, registry, [range(), other], 256));
      expect(Exit.isFailure(exit) && exit.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
      expect(scans).toHaveLength(0);
    });
  });
});

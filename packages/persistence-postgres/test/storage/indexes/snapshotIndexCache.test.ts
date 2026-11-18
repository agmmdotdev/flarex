import { describe, expect, it } from "vitest";
import {
  createSnapshotIndexCache,
  type SnapshotIndexCacheEntry,
  type SnapshotIndexCacheLimits,
  type SnapshotIndexCut,
  type SnapshotIndexInterval,
} from "../../../src/storage/indexes/snapshotIndexCache";

interface Key { order: number; row: string }
interface Value { body: { name: string }; revision: number }

const key = (order: number, row = `row:${order}`): Key => ({ order, row });
const before = (value: Key): SnapshotIndexCut<Key> => ({ kind: "before", key: value });
const after = (value: Key): SnapshotIndexCut<Key> => ({ kind: "after", key: value });
const interval = (start: SnapshotIndexCut<Key>, end: SnapshotIndexCut<Key>): SnapshotIndexInterval<Key> => ({ start, end });
const point = (value: Key) => interval(before(value), after(value));
const span = (start: number, end: number) => interval(before(key(start)), before(key(end)));
const all: SnapshotIndexInterval<Key> = { start: { kind: "beforeAll" }, end: { kind: "afterAll" } };
const cache = (limits: Partial<SnapshotIndexCacheLimits> = {}) => createSnapshotIndexCache<string, Key, Value>({
  compareKeys: (left, right) => left.order - right.order || (left.row < right.row ? -1 : left.row === right.row ? 0 : 1),
  captureKey: value => ({ ...value }),
  captureValue: value => ({ body: { ...value.body }, revision: value.revision }),
  limits: { bodyBytes: 100, indexEntries: 100, intervals: 100, ...limits },
});
const entry = (order: number, documentId = `document:${order}`, row?: string): SnapshotIndexCacheEntry<Key, Value> => ({
  key: key(order, row), documentId, value: { body: { name: documentId }, revision: 41 }, bodyBytes: 1,
});
const miss = (range: SnapshotIndexInterval<Key>) => ({ kind: "miss", interval: range });
const document = (value: SnapshotIndexCacheEntry<Key, Value>) => ({
  kind: "document", key: value.key, documentId: value.documentId, value: value.value,
});

describe("operation-owned snapshot index coverage", () => {
  it("distinguishes a proven empty interval from an unknown cache miss", () => {
    const store = cache();
    expect(store.get("index", span(1, 5), "asc")).toEqual([miss(span(1, 5))]);
    expect(store.populate("index", [], span(1, 5))).toBe(true);
    expect(store.get("index", span(1, 5), "asc")).toEqual([]);
    expect(store.get("another-index", span(1, 5), "asc")).toEqual([miss(span(1, 5))]);
  });

  it("coalesces adjacent and intersecting coverage while retaining separated ranges", () => {
    const store = cache();
    for (const range of [span(1, 3), span(5, 7), span(3, 5), span(2, 6)]) {
      expect(store.populate("index", [], range)).toBe(true);
    }
    expect(store.stats().intervals).toBe(1);
    expect(store.get("index", span(1, 7), "asc")).toEqual([]);
    expect(store.populate("index", [], span(9, 10))).toBe(true);
    expect(store.stats().intervals).toBe(2);
    expect(store.get("index", span(1, 10), "asc")).toEqual([miss(span(7, 9))]);
  });

  it("keeps before(b)..after(b) unknown instead of merging away an unobserved key", () => {
    const store = cache();
    store.populate("index", [], span(1, 2));
    store.populate("index", [], interval(after(key(2)), before(key(3))));
    expect(store.stats().intervals).toBe(2);
    expect(store.get("index", span(1, 3), "asc")).toEqual([miss(point(key(2)))]);
  });

  it("treats empty and inverted intervals as empty without adding coverage", () => {
    const store = cache();
    for (const range of [span(2, 2), span(4, 1), interval(after(key(2)), before(key(2)))]) {
      expect(store.populate("index", [], range)).toBe(true);
      expect(store.get("index", range, "asc")).toEqual([]);
    }
    expect(store.stats()).toEqual({ bodyBytes: 0, bodies: 0, indexEntries: 0, intervals: 0 });
    expect(store.get("index", all, "asc")).toEqual([miss(all)]);
  });

  it("reuses full ranges and covered subranges in both orders", () => {
    const store = cache();
    const rows = [entry(2), entry(4), entry(6)];
    expect(store.populate("index", rows, span(1, 7))).toBe(true);
    expect(store.get("index", span(1, 7), "asc")).toEqual(rows.map(document));
    expect(store.get("index", span(3, 6), "asc")).toEqual([document(rows[1])]);
    expect(store.get("index", span(1, 7), "desc")).toEqual([...rows].reverse().map(document));
    expect(store.get("index", span(0, 8), "asc")).toEqual([
      miss(span(0, 1)), ...rows.map(document), miss(span(7, 8)),
    ]);
  });

  it("retains a partial-page prefix through the exact row, including duplicate logical keys", () => {
    const store = cache();
    const first = entry(7, "first", "r1");
    const second = entry(7, "second", "r2");
    const from = before(key(7, ""));
    const end = before(key(8, ""));
    expect(store.populate("index", [first], interval(from, after(first.key)))).toBe(true);
    expect(store.get("index", interval(from, end), "asc")).toEqual([
      document(first), miss(interval(after(first.key), end)),
    ]);
    expect(store.get("index", point(second.key), "asc")).toEqual([miss(point(second.key))]);
    expect(store.populate("index", [second], interval(after(first.key), end))).toBe(true);
    expect(store.get("index", interval(from, end), "asc")).toEqual([document(first), document(second)]);
    expect(store.stats().intervals).toBe(1);
  });

  it("supports unbounded coverage with an exact middle gap and later completion", () => {
    const store = cache();
    store.populate("index", [entry(1)], interval(all.start, before(key(3))));
    store.populate("index", [entry(5)], interval(after(key(3)), all.end));
    expect(store.get("index", all, "asc")).toEqual([
      document(entry(1)), miss(point(key(3))), document(entry(5)),
    ]);
    store.populate("index", [], point(key(3)));
    expect(store.stats().intervals).toBe(1);
    expect(store.get("index", all, "asc")).toEqual([document(entry(1)), document(entry(5))]);
  });

  it("uses only the first three ascending covered ranges before the pinned remaining miss", () => {
    const store = cache();
    for (const order of [1, 3, 5, 7]) store.populate("index", [entry(order)], point(key(order)));
    const expected = [
      miss(span(0, 1)), document(entry(1)),
      miss(interval(after(key(1)), before(key(3)))), document(entry(3)),
      miss(interval(after(key(3)), before(key(5)))), document(entry(5)),
      miss(interval(after(key(5)), before(key(9)))),
    ];
    expect(store.get("index", span(0, 9), "asc")).toEqual(expected);
    expect(store.get("index", span(0, 9), "desc")).toEqual([...expected].reverse());
    expect(store.get("index", point(key(7)), "asc")).toEqual([document(entry(7))]);
  });

  it("counts proven empty covered ranges toward the three-range fallback", () => {
    const store = cache();
    for (const order of [1, 3, 5, 7]) store.populate("index", [], span(order, order + 1));
    expect(store.get("index", span(0, 9), "asc")).toEqual([
      miss(span(0, 1)), miss(span(2, 3)), miss(span(4, 5)), miss(span(6, 9)),
    ]);
  });

  it("retains safe points but never declares full coverage after body-capacity refusal", () => {
    const store = cache({ bodyBytes: 1 });
    const requested = interval(before(key(1)), after(key(2)));
    expect(store.populate("index", [entry(1), entry(2)], requested)).toBe(false);
    expect(store.get("index", requested, "asc")).toEqual([
      document(entry(1)), miss(interval(after(key(1)), after(key(2)))),
    ]);
    expect(store.stats()).toEqual({ bodyBytes: 1, bodies: 1, indexEntries: 1, intervals: 1 });
    expect(store.get("index", point(key(2)), "asc")).toEqual([miss(point(key(2)))]);
  });

  it("charges a shared body once while separately bounding each index entry", () => {
    const store = cache({ bodyBytes: 8, indexEntries: 2 });
    const first = { ...entry(1, "same-body"), bodyBytes: 8 };
    const second = { ...first, key: key(9) };
    expect(store.populate("by-id", [first], point(first.key))).toBe(true);
    expect(store.populate("by-value", [second], point(second.key))).toBe(true);
    expect(store.stats()).toEqual({ bodyBytes: 8, bodies: 1, indexEntries: 2, intervals: 2 });
    expect(store.populate("third-index", [first], point(first.key))).toBe(false);
    expect(store.get("third-index", point(first.key), "asc")).toEqual([miss(point(first.key))]);
    expect(store.get("by-value", point(second.key), "asc")).toEqual([document(second)]);
  });

  it("bounds coverage metadata without dropping retained documents or inventing an empty range", () => {
    const store = cache({ intervals: 1 });
    expect(store.populate("index", [entry(1), entry(3)], span(0, 5))).toBe(false);
    expect(store.get("index", span(0, 5), "asc")).toEqual([
      miss(span(0, 1)), document(entry(1)), miss(interval(after(key(1)), before(key(5)))),
    ]);
    expect(store.stats()).toEqual({ bodyBytes: 1, bodies: 1, indexEntries: 1, intervals: 1 });
    expect(store.populate("empty-other-index", [], all)).toBe(false);
    expect(store.get("empty-other-index", all, "asc")).toEqual([miss(all)]);
  });

  it("can extend coalesced coverage even when the interval count is at capacity", () => {
    const store = cache({ intervals: 1 });
    expect(store.populate("index", [], span(1, 3))).toBe(true);
    expect(store.populate("index", [], span(3, 5))).toBe(true);
    expect(store.populate("index", [], span(2, 4))).toBe(true);
    expect(store.stats().intervals).toBe(1);
    expect(store.get("index", span(1, 5), "asc")).toEqual([]);
    expect(store.populate("index", [], span(7, 8))).toBe(false);
    expect(store.get("index", span(7, 8), "asc")).toEqual([miss(span(7, 8))]);
  });

  it("owns input keys/bodies and returns detached keys, values and missing bounds", () => {
    const store = cache();
    const input = entry(2);
    const start = key(1);
    const end = key(3);
    expect(store.populate("index", [input], interval(before(start), before(end)))).toBe(true);
    input.key.order = 99;
    input.value.body.name = "mutated input";
    start.order = 98;
    end.order = 97;
    const result = store.get("index", span(0, 4), "asc");
    expect(result).toEqual([miss(span(0, 1)), document(entry(2)), miss(span(3, 4))]);
    for (const component of result) {
      if (component.kind === "document") {
        component.key.order = 88;
        component.value.body.name = "mutated output";
      } else if (component.interval.start.kind === "before" || component.interval.start.kind === "after") {
        component.interval.start.key.order = 87;
      }
    }
    expect(store.get("index", span(0, 4), "asc")).toEqual([
      miss(span(0, 1)), document(entry(2)), miss(span(3, 4)),
    ]);
  });

  it("retains validated revision evidence and does not double-charge repeated population", () => {
    const store = cache();
    const original = { ...entry(2), value: { body: { name: "unchanged index membership" }, revision: 73 }, bodyBytes: 9 };
    expect(store.populate("index", [original], point(original.key))).toBe(true);
    expect(store.populate("index", [original], point(original.key))).toBe(true);
    expect(store.get("index", point(original.key), "asc")).toEqual([document(original)]);
    expect(store.stats()).toEqual({ bodyBytes: 9, bodies: 1, indexEntries: 1, intervals: 1 });
  });
});

describe("exclusive snapshot cache write application", () => {
  it("replaces a shared body and revision once for unchanged keys without mutating old materialized results", () => {
    const store = cache({ bodyBytes: 8, indexEntries: 2 });
    const original = { ...entry(2, "shared"), bodyBytes: 4 };
    const indexed = { ...original, key: key(6) };
    store.populate("by-id", [original], point(original.key));
    store.populate("by-value", [indexed], span(5, 9));
    const historical = store.get("by-value", span(5, 9), "asc");
    const updated = { value: { body: { name: "updated" }, revision: 74 }, bodyBytes: 8 };
    expect(store.applyWrite({ documentId: "shared", newDocument: updated, indexes: [
      { indexId: "by-id", oldKey: original.key, newKey: original.key },
      { indexId: "by-value", oldKey: indexed.key, newKey: indexed.key },
    ] })).toBe(true);
    updated.value.body.name = "mutated input";
    updated.value.revision = 99;
    for (const [indexId, position] of [["by-id", original.key], ["by-value", indexed.key]] as const) {
      expect(store.get(indexId, point(position), "asc")).toEqual([{
        kind: "document", key: position, documentId: "shared", value: { body: { name: "updated" }, revision: 74 },
      }]);
    }
    expect(historical).toEqual([document(indexed)]);
    expect(store.stats()).toEqual({ bodyBytes: 8, bodies: 1, indexEntries: 2, intervals: 2 });
  });

  it("moves a key inside known coverage and removes it when it moves outside without extending that coverage", () => {
    const store = cache();
    const original = entry(2, "moving", "stable-row");
    store.populate("index", [original], span(1, 5));
    const inside = { ...original, key: key(4, "stable-row"), value: { body: { name: "inside" }, revision: 42 } };
    expect(store.applyWrite({ documentId: "moving", newDocument: inside, indexes: [
      { indexId: "index", oldKey: original.key, newKey: inside.key },
    ] })).toBe(true);
    expect(store.get("index", span(1, 5), "asc")).toEqual([document(inside)]);
    expect(store.get("index", point(original.key), "asc")).toEqual([]);
    const outside = { ...inside, key: key(8, "stable-row"), value: { body: { name: "outside" }, revision: 43 } };
    expect(store.applyWrite({ documentId: "moving", newDocument: outside, indexes: [
      { indexId: "index", oldKey: inside.key, newKey: outside.key },
    ] })).toBe(true);
    expect(store.get("index", span(1, 5), "asc")).toEqual([]);
    expect(store.get("index", point(outside.key), "asc")).toEqual([miss(point(outside.key))]);
    expect(store.stats()).toEqual({ bodyBytes: 0, bodies: 0, indexEntries: 0, intervals: 1 });
  });

  it("applies an insertion to a completed empty range even when the cache retains zero bodies", () => {
    const store = cache();
    store.populate("index", [], span(1, 5));
    expect(store.stats().bodies).toBe(0);
    const inserted = entry(3);
    expect(store.applyWrite({ documentId: inserted.documentId, newDocument: inserted, indexes: [
      { indexId: "index", oldKey: null, newKey: inserted.key },
      { indexId: "untracked", oldKey: null, newKey: key(7) },
    ] })).toBe(true);
    expect(store.get("index", span(1, 5), "asc")).toEqual([document(inserted)]);
    expect(store.get("untracked", all, "asc")).toEqual([miss(all)]);
    expect(store.stats()).toEqual({ bodyBytes: 1, bodies: 1, indexEntries: 1, intervals: 1 });
  });

  it("deletes shared aliases while preserving complete intervals for a later reinsertion", () => {
    const store = cache();
    const original = entry(2, "shared");
    const indexed = { ...original, key: key(4) };
    store.populate("by-id", [original], point(original.key));
    store.populate("by-value", [indexed], span(1, 6));
    expect(store.applyWrite({ documentId: "shared", newDocument: null, indexes: [
      { indexId: "by-id", oldKey: original.key, newKey: null },
      { indexId: "by-value", oldKey: indexed.key, newKey: null },
    ] })).toBe(true);
    expect(store.stats()).toEqual({ bodyBytes: 0, bodies: 0, indexEntries: 0, intervals: 2 });
    expect(store.get("by-id", point(original.key), "asc")).toEqual([]);
    expect(store.get("by-value", span(1, 6), "asc")).toEqual([]);
    const reinserted = { ...original, value: { body: { name: "reinserted" }, revision: 84 }, bodyBytes: 7 };
    const newIndexKey = key(3);
    expect(store.applyWrite({ documentId: "shared", newDocument: reinserted, indexes: [
      { indexId: "by-id", oldKey: null, newKey: original.key },
      { indexId: "by-value", oldKey: null, newKey: newIndexKey },
    ] })).toBe(true);
    expect(store.get("by-id", point(original.key), "asc")).toEqual([document(reinserted)]);
    expect(store.get("by-value", span(1, 6), "asc")).toEqual([document({ ...reinserted, key: newIndexKey })]);
    expect(store.stats()).toEqual({ bodyBytes: 7, bodies: 1, indexEntries: 2, intervals: 2 });
  });

  it("drops unavailable index coverage and releases each shared body only after its last reference", () => {
    const store = cache();
    const shared = { ...entry(1, "shared"), bodyBytes: 3 };
    const separate = { ...entry(2), bodyBytes: 5 };
    const indexed = { ...shared, key: key(9) };
    store.populate("by-id", [shared, separate], all);
    store.populate("by-value", [indexed], point(indexed.key));
    expect(store.stats()).toEqual({ bodyBytes: 8, bodies: 2, indexEntries: 3, intervals: 2 });
    store.removeIndex("by-id");
    expect(store.get("by-id", all, "asc")).toEqual([miss(all)]);
    expect(store.get("by-value", point(indexed.key), "asc")).toEqual([document(indexed)]);
    expect(store.stats()).toEqual({ bodyBytes: 3, bodies: 1, indexEntries: 1, intervals: 1 });
    store.removeIndex("by-value");
    store.removeIndex("by-value");
    expect(store.stats()).toEqual({ bodyBytes: 0, bodies: 0, indexEntries: 0, intervals: 0 });
  });

  it("clears all reuse when a body replacement exceeds capacity instead of retaining stale complete ranges", () => {
    const store = cache({ bodyBytes: 2 });
    const original = entry(1);
    store.populate("index", [original], all);
    store.populate("other-index", [entry(2)], point(key(2)));
    store.populate("empty-index", [], all);
    const historical = store.get("index", all, "asc");
    expect(store.applyWrite({ documentId: original.documentId,
      newDocument: { value: { body: { name: "too large" }, revision: 42 }, bodyBytes: 2 }, indexes: [
        { indexId: "index", oldKey: original.key, newKey: original.key },
      ] })).toBe(false);
    expect(store.stats()).toEqual({ bodyBytes: 0, bodies: 0, indexEntries: 0, intervals: 0 });
    for (const indexId of ["index", "other-index", "empty-index"])
      expect(store.get(indexId, all, "asc")).toEqual([miss(all)]);
    expect(historical).toEqual([document(original)]);
  });

  it("clears all reuse when a covered insertion exceeds the distinct index-entry limit", () => {
    const store = cache({ indexEntries: 1 });
    store.populate("index", [entry(1)], all);
    const inserted = entry(2);
    expect(store.applyWrite({ documentId: inserted.documentId, newDocument: inserted, indexes: [
      { indexId: "index", oldKey: null, newKey: inserted.key },
    ] })).toBe(false);
    expect(store.stats()).toEqual({ bodyBytes: 0, bodies: 0, indexEntries: 0, intervals: 0 });
    expect(store.get("index", all, "asc")).toEqual([miss(all)]);
  });

  it("frees old aliases before checking a same-size replacement at exact body and entry capacity", () => {
    const store = cache({ bodyBytes: 8, indexEntries: 2, intervals: 2 });
    const original = { ...entry(2, "shared"), bodyBytes: 8 };
    const indexed = { ...original, key: key(6) };
    store.populate("by-id", [original], span(1, 5));
    store.populate("by-value", [indexed], span(5, 9));
    const updated = { value: { body: { name: "changed" }, revision: 42 }, bodyBytes: 8 };
    expect(store.applyWrite({ documentId: "shared", newDocument: updated, indexes: [
      { indexId: "by-id", oldKey: original.key, newKey: key(3) },
      { indexId: "by-value", oldKey: indexed.key, newKey: key(7) },
    ] })).toBe(true);
    expect(store.get("by-id", span(1, 5), "asc")).toEqual([document({ ...original, ...updated, key: key(3) })]);
    expect(store.get("by-value", span(5, 9), "asc")).toEqual([document({ ...original, ...updated, key: key(7) })]);
    expect(store.stats()).toEqual({ bodyBytes: 8, bodies: 1, indexEntries: 2, intervals: 2 });
  });

  it("does not insert into unknown gaps or excluded endpoints and preserves zero-body coverage", () => {
    const store = cache();
    store.populate("index", [], span(1, 3));
    store.populate("index", [], span(5, 7));
    for (const order of [3, 4, 7]) {
      const inserted = entry(order);
      expect(store.applyWrite({ documentId: inserted.documentId, newDocument: inserted, indexes: [
        { indexId: "index", oldKey: null, newKey: inserted.key },
      ] })).toBe(true);
      expect(store.get("index", point(inserted.key), "asc")).toEqual([miss(point(inserted.key))]);
    }
    expect(store.stats()).toEqual({ bodyBytes: 0, bodies: 0, indexEntries: 0, intervals: 2 });
    const included = entry(1);
    expect(store.applyWrite({ documentId: included.documentId, newDocument: included, indexes: [
      { indexId: "index", oldKey: null, newKey: included.key },
    ] })).toBe(true);
    expect(store.get("index", span(1, 3), "asc")).toEqual([document(included)]);
    expect(store.get("index", span(5, 7), "asc")).toEqual([]);
    expect(store.stats()).toEqual({ bodyBytes: 1, bodies: 1, indexEntries: 1, intervals: 2 });
  });

  it("reports impossible trusted writes as invariant failures rather than capacity refusals", () => {
    const store = cache();
    const original = entry(2);
    store.populate("index", [original], all);
    expect(() => store.applyWrite({ documentId: original.documentId, newDocument: null, indexes: [
      { indexId: "index", oldKey: original.key, newKey: original.key },
    ] })).toThrow("Snapshot cache deletion has a new key.");
    expect(() => store.applyWrite({ documentId: original.documentId, newDocument: original, indexes: [
      { indexId: "index", oldKey: original.key, newKey: original.key },
      { indexId: "index", oldKey: original.key, newKey: original.key },
    ] })).toThrow("Snapshot cache write repeats an index.");
    expect(() => store.applyWrite({ documentId: original.documentId, newDocument: null, indexes: [] }))
      .toThrow("Snapshot cache deletion retains an index reference.");
    expect(store.get("index", all, "asc")).toEqual([document(original)]);
    expect(store.stats()).toEqual({ bodyBytes: 1, bodies: 1, indexEntries: 1, intervals: 1 });
  });
});

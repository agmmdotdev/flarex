import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { decodeDocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey, MAX_INDEX_KEY_PREFIX_BYTES } from "flarex-protocol/index-key";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { isJson, isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistenceIndexEntry, type CorePersistenceSnapshot,
  type CoreRetentionValidator } from "../../src/core/contracts";
import { issuePostgresSnapshotFilter, type PostgresRelationalPredicateFailure } from "../../src/values/postgresRelationalPredicate";
import { prepareRelationalRead } from "../../src/values/relationalQuery";
import type { CorePersistenceFixture } from "./fixture";

const origin = { kind: "synthetic", sourceId: "snapshot-filter" } as const;
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId, tables: [{ tableId: "entry", origin, columns: [
  { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
  { columnId: "rank", type: "text", nullable: false, default: { kind: "none" }, origin },
  { columnId: "title", type: "text", nullable: true, default: { kind: "none" }, origin },
  { columnId: "flag", type: "boolean", nullable: true, default: { kind: "none" }, origin },
  { columnId: "at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
  { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
  { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
], constraints: [], relationships: [] }], capabilities: [] }));
const table = schema.tables[0];
if (table === undefined) throw new Error("Missing snapshot filter table");
class TestFailure extends Error {}
const failure: PostgresRelationalPredicateFailure<TestFailure> = (reason, cause) => new TestFailure(reason, { cause });

const tableId = identity(10), indexId = identity(20);
const utf8 = new TextEncoder();
function identity(value: number): Uint8Array {
  const id = new Uint8Array(16);
  new DataView(id.buffer).setUint32(12, value, false);
  return id;
}
const publicId = (ordinal: number) => Result.getOrThrow(encodeDocumentId(100, identity(1000 + ordinal)));
/** Stored exactly as given, so absent fields and wrongly typed values reach PostgreSQL. */
function document(ts: bigint, ordinal: number, body: JsonObject, prevTs: bigint | null = null): CoreDocumentLogEntry {
  return { ts, tableId, id: identity(1000 + ordinal), deleted: false, prevTs,
    jsonValue: utf8.encode(JSON.stringify({ _creationTime: ordinal, _id: publicId(ordinal), ...body })) };
}
const tombstone = (ts: bigint, ordinal: number, prevTs: bigint): CoreDocumentLogEntry =>
  ({ ts, tableId, id: identity(1000 + ordinal), deleted: true, prevTs, jsonValue: new Uint8Array() });
const key = (rank: Json, ordinal: number) => Result.getOrThrow(encodeIndexKey([rank], publicId(ordinal)));
function index(ts: bigint, rank: Json, ordinal: number, deleted = false): CorePersistenceIndexEntry {
  return { ts, index: { id: indexId }, key: key(rank, ordinal), mode: "scanComplete", prev: null,
    value: deleted ? null : { tableId, documentId: identity(1000 + ordinal) } };
}

const TITLES: readonly Json[] = ["abc", "ABC", "aXc", "a_c", "a%c", "back\\slash", "", "Ångström", "ÅNGSTRÖM", "ångström", "straße", "İstanbul",
  "💵 note", "é", "é", "Kelvin", "kelvin", "မြန်မာ", "x", "💵", null, null, 7, true, ["abc"], { nested: "abc" }];
// Three rows in seven store a wrongly typed time, which no comparison may match.
const TIMES: readonly Json[] = ["2024-01-01T00:00:00.000Z", "2024-06-15T12:30:00.000Z", "2025-01-01T00:00:00.000Z", null, 12, ["2024-06-15T12:30:00.000Z"], { at: "2024" }];
const longRank = (tail: string) => "L".repeat(MAX_INDEX_KEY_PREFIX_BYTES + 40) + tail;
const RANKS = ["a", "a", "a", "ab", "b", "B", "é", "é", "💵", "z", "", longRank("a"), longRank("b"), longRank("a")];

/** Deterministic rows: every title/time/flag combination appears with tied and long ranks. */
function body(ordinal: number): JsonObject {
  const title = TITLES[ordinal % TITLES.length], at = TIMES[ordinal % TIMES.length];
  const row: Record<string, Json> = { id: `row-${String(ordinal).padStart(3, "0")}`, rank: RANKS[(ordinal * 5) % RANKS.length] ?? "",
    flag: ordinal % 3 === 0 ? true : ordinal % 3 === 1 ? false : null,
    deleted_at: ordinal % 7 === 3 ? "2024-02-02T00:00:00.000Z" : null };
  // Every tenth row omits both optional fields; the others store them, null included.
  if (ordinal % 10 !== 9) { row.title = title ?? null; row.at = at ?? null; }
  return row;
}

const like = (pattern: string): JsonObject => ({ kind: "textLikeAscii", column: "title", pattern });
const PREDICATES: readonly JsonObject[] = [
  { kind: "and", children: [] }, { kind: "or", children: [] },
  ...["%a%", "%A%", "a_c", "A_C", "a%c", "a\\_c", "%\\%", "%å%", "%Å%", "%É%", "%é%", "_", "__", "%", "%%", "", "%💵%", "💵_note", "k%", "%ß%", "%မြန်%", "%_%", "_%_"].map(like),
  { kind: "in", column: "title", values: ["abc", null] }, { kind: "in", column: "title", values: [] },
  { kind: "in", column: "title", values: ["Ångström", "", "true", "7"] },
  { kind: "in", column: "flag", values: [true] }, { kind: "in", column: "flag", values: [false, true] },
  { kind: "in", column: "at", values: ["2024-06-15T12:30:00.000Z"] },
  { kind: "isNull", column: "title" }, { kind: "isNull", column: "flag" }, { kind: "isNull", column: "at" },
  { kind: "textNotEqual", column: "title", value: "abc" }, { kind: "textNotEqual", column: "title", value: "" },
  { kind: "greaterThan", column: "title", value: "a" }, { kind: "greaterThan", column: "title", value: "é" },
  { kind: "greaterThan", column: "at", value: "2024-01-01T00:00:00.000Z" }, { kind: "lessThan", column: "at", value: "2025-01-01T00:00:00.000Z" },
  { kind: "or", children: [like("%a%"), { kind: "isNull", column: "title" }] },
  { kind: "and", children: [like("%a%"), { kind: "in", column: "flag", values: [true] }] },
  { kind: "or", children: [{ kind: "and", children: [{ kind: "isNull", column: "at" }, like("%c")] }, { kind: "in", column: "flag", values: [false] }] },
  { kind: "and", children: [like("%zzz-none%")] },
];

interface Member { readonly key: Uint8Array; readonly id: string; readonly row: JsonObject; readonly creationTime: number }
/** The complete reference: every visible entry through the ordinary scan, decoded in JavaScript. */
const complete = Effect.fnUntraced(function* (snapshot: CorePersistenceSnapshot) {
  const page = yield* snapshot.scan({ index: { id: indexId }, tableId, interval: { start: null, end: null }, order: "asc", maxResults: 10_000 });
  if (page.cursor.kind !== "end") return yield* Effect.die(new Error("Reference scan was truncated"));
  return page.entries.map((entry): Member => {
    const decoded = Result.getOrThrow(decodeDocumentValue(entry.document.jsonValue));
    if (!isJson(decoded) || !isJsonObject(decoded)) throw new Error("Reference row is not JSON");
    const { _id, _creationTime, ...row } = decoded;
    if (typeof _id !== "string" || typeof _creationTime !== "number") throw new Error("Reference row lacks its identity");
    return { key: entry.key, id: _id, row, creationTime: _creationTime };
  });
});

function prepare(predicate: JsonObject, direction: "asc" | "desc") {
  const prepared = Result.getOrThrow(prepareRelationalRead(table, { order: { column: "rank", direction },
    predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, predicate] } }, 10_000, failure));
  const query = Result.getOrThrow(prepared.compile());
  if (prepared.snapshotPredicate === undefined) throw new Error("Predicate has no stored-document form");
  return { query, program: Result.getOrThrow(issuePostgresSnapshotFilter(table, prepared.snapshotPredicate, failure)) };
}
const filter = (snapshot: CorePersistenceSnapshot, request: Omit<Parameters<NonNullable<CorePersistenceSnapshot["filter"]>>[0], "index" | "tableId" | "maxExamined" | "maxBytes">
  & Partial<Readonly<{ maxExamined: number; maxBytes: number }>>) => {
  if (snapshot.filter === undefined) return Effect.die(new Error("Snapshot has no filter"));
  return snapshot.filter({ index: { id: indexId }, tableId, maxExamined: 32_000, maxBytes: 1 << 24, ...request });
};

const seed = Effect.fnUntraced(function* (fixture: CorePersistenceFixture, rows = 90) {
  const persistence = fixture.persistence;
  const lease = yield* persistence.acquireLease();
  const ordinals = Array.from({ length: rows }, (_, ordinal) => ordinal);
  yield* persistence.write(lease, { documents: ordinals.map(ordinal => document(1n, ordinal, body(ordinal))),
    indexes: ordinals.map(ordinal => index(1n, body(ordinal).rank ?? "", ordinal)) });
  // Timestamp 2 rewrites every fifth row under a new rank and tombstones every eleventh.
  const moved = ordinals.filter(ordinal => ordinal % 5 === 0 && ordinal % 11 !== 0), removed = ordinals.filter(ordinal => ordinal % 11 === 0);
  const revised = (ordinal: number): JsonObject => ({ ...body(ordinal), rank: `moved-${ordinal % 4}`, title: "Revised ABC" });
  yield* persistence.write(lease, {
    documents: [...moved.map(ordinal => document(2n, ordinal, revised(ordinal), 1n)), ...removed.map(ordinal => tombstone(2n, ordinal, 1n))],
    indexes: [...moved.flatMap(ordinal => [index(2n, body(ordinal).rank ?? "", ordinal, true), index(2n, revised(ordinal).rank ?? "", ordinal)]),
      ...removed.map(ordinal => index(2n, body(ordinal).rank ?? "", ordinal, true))] });
  // Timestamps 3 and 4 rewrite the same rows again under an unchanged key, so one key carries several revisions.
  for (const ts of [3n, 4n]) yield* persistence.write(lease, {
    documents: moved.map(ordinal => document(ts, ordinal, { ...revised(ordinal), title: ts === 3n ? "third abc" : null }, ts - 1n)),
    indexes: moved.map(ordinal => index(ts, revised(ordinal).rank ?? "", ordinal)) });
  return { persistence, lease };
});

export function registerSnapshotFilterScenarios(lane: string, create: () => Promise<CorePersistenceFixture>) {
  const run = (scenario: (fixture: CorePersistenceFixture) => Effect.Effect<void, CorePersistenceError>) => async () => {
    const fixture = await create();
    try { await Effect.runPromise(scenario(fixture)); } finally { await fixture.close(); }
  };
  describe(`snapshot predicate pushdown statement (${lane})`, () => {
    it("agrees with the JavaScript evaluator over the complete scan for match set, order, ties, count and windows at each snapshot", run(fixture => Effect.gen(function* () {
      const { persistence } = yield* seed(fixture);
      for (const at of [1n, 2n, 3n, 4n]) {
        const snapshot = yield* persistence.readSnapshot(at);
        const members = yield* complete(snapshot);
        expect(members.length).toBeGreaterThan(40);
        for (const predicate of PREDICATES) for (const direction of ["asc", "desc"] as const) {
          const { query, program } = prepare(predicate, direction);
          const matched = members.filter(member => Result.getOrThrow(query.inspect(member.row)).matches);
          // Index-key order is the JavaScript order: UTF-8 rank bytes, then the document identity, both in the direction.
          const ordered = matched.toSorted((left, right) => (compareBytesLexicographically(utf8.encode(String(left.row.rank)), utf8.encode(String(right.row.rank)))
            || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) * (direction === "asc" ? 1 : -1));
          expect(ordered.map(member => member.id), JSON.stringify(predicate)).toEqual(
            (direction === "asc" ? matched : matched.toReversed()).map(member => member.id));
          for (const [offset, limit] of [[0, 10_000], [0, 0], [0, 3], [2, 5], [ordered.length, 4], [ordered.length + 3, 4], [Math.max(0, ordered.length - 1), 9]] as const) {
            const page = yield* filter(snapshot, { predicate: program, order: direction, offset, limit });
            const label = `${JSON.stringify(predicate)} ${direction} ${offset}/${limit} @${at}`;
            expect(page.overBudget, label).toBe(false);
            expect(page.count, label).toBe(ordered.length);
            expect(page.examined, label).toBe(members.length);
            const expected = ordered.slice(offset, offset + limit);
            expect(page.entries.map(entry => Buffer.from(entry.key).toString("hex")), label)
              .toEqual(expected.map(member => Buffer.from(member.key).toString("hex")));
            for (const [position, entry] of page.entries.entries()) {
              const decoded = Result.getOrThrow(decodeDocumentValue(entry.document.jsonValue));
              expect(isJson(decoded) && isJsonObject(decoded) ? decoded._id : undefined, label).toBe(expected[position]?.id);
              expect(entry.document.ts <= at && !entry.document.deleted, label).toBe(true);
            }
          }
        }
      }
    })), 240_000);

    it("returns an empty window and a zero count for an empty index and for no match", run(fixture => Effect.gen(function* () {
      const persistence = fixture.persistence;
      yield* persistence.acquireLease();
      const empty = yield* persistence.readSnapshot(0n);
      const { program } = prepare(like("%a%"), "asc");
      expect(yield* filter(empty, { predicate: program, order: "asc", offset: 0, limit: 20 }))
        .toEqual({ entries: [], count: 0, examined: 0, bytes: 0, overBudget: false });
      yield* seed(fixture, 12);
      const snapshot = yield* persistence.readSnapshot(2n);
      const none = yield* filter(snapshot, { predicate: prepare(like("%zzz-none%"), "desc").program, order: "desc", offset: 0, limit: 20 });
      expect({ entries: none.entries, count: none.count, overBudget: none.overBudget }).toEqual({ entries: [], count: 0, overBudget: false });
      expect(none.examined).toBeGreaterThan(0);
    })), 120_000);

    it("reports over budget, with no entries and no count, when live entries or stored bytes exceed the request bounds", run(fixture => Effect.gen(function* () {
      const { persistence } = yield* seed(fixture, 30);
      const snapshot = yield* persistence.readSnapshot(1n);
      const { program } = prepare({ kind: "and", children: [] }, "asc");
      const admitted = yield* filter(snapshot, { predicate: program, order: "asc", offset: 0, limit: 5, maxExamined: 30 });
      expect({ examined: admitted.examined, overBudget: admitted.overBudget, entries: admitted.entries.length }).toEqual({ examined: 30, overBudget: false, entries: 5 });
      expect(admitted.count).toBeGreaterThan(5);
      const rows = yield* filter(snapshot, { predicate: program, order: "asc", offset: 0, limit: 5, maxExamined: 29 });
      expect(rows).toEqual({ entries: [], count: 0, examined: 30, bytes: rows.bytes, overBudget: true });
      const bytes = yield* filter(snapshot, { predicate: program, order: "asc", offset: 0, limit: 5, maxBytes: admitted.bytes - 1 });
      expect(bytes).toEqual({ entries: [], count: 0, examined: 30, bytes: admitted.bytes, overBudget: true });
      const exact = yield* filter(snapshot, { predicate: program, order: "asc", offset: 0, limit: 5, maxBytes: admitted.bytes });
      expect(exact.overBudget).toBe(false);
      // Tombstoned keys are walked but are not examined entries: timestamp 2 moved four rows and removed three.
      const later = yield* persistence.readSnapshot(2n);
      const visible = yield* filter(later, { predicate: program, order: "asc", offset: 0, limit: 0, maxExamined: 27 });
      expect({ examined: visible.examined, overBudget: visible.overBudget }).toEqual({ examined: 27, overBudget: false });
      expect((yield* filter(later, { predicate: program, order: "asc", offset: 0, limit: 0, maxExamined: 26 })).overBudget).toBe(true);
    })), 120_000);

    it("validates index retention before the statement and again before releasing its result", run(fixture => Effect.gen(function* () {
      const { persistence } = yield* seed(fixture, 12);
      const { program } = prepare(like("%a%"), "asc");
      let validations = 0, failAt = Number.POSITIVE_INFINITY;
      const retention: CoreRetentionValidator = { validateDocument: () => Effect.void, validateIndex: () => Effect.suspend(() =>
        ++validations >= failAt ? Effect.fail(new CorePersistenceError({ reason: "outOfRetention" })) : Effect.void) };
      const snapshot = yield* persistence.readSnapshot(2n, retention);
      expect(validations).toBe(1);
      expect((yield* filter(snapshot, { predicate: program, order: "asc", offset: 0, limit: 20 })).count).toBeGreaterThan(0);
      expect(validations).toBe(3);
      // The floor advances while the statement runs: its successful rows are withheld.
      failAt = 5;
      expect(yield* Effect.result(filter(snapshot, { predicate: program, order: "asc", offset: 0, limit: 20 })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "outOfRetention" } });
      expect(validations).toBe(5);
      failAt = 6;
      expect(yield* Effect.result(filter(snapshot, { predicate: program, order: "asc", offset: 0, limit: 20 })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "outOfRetention" } });
      expect(validations).toBe(6);
    })), 120_000);

    it("reports a visible entry without its exact revision as corrupt data", run(fixture => Effect.gen(function* () {
      const persistence = fixture.persistence;
      const lease = yield* persistence.acquireLease();
      const { program } = prepare({ kind: "and", children: [] }, "asc");
      yield* persistence.write(lease, { documents: [document(1n, 1, body(1))], indexes: [index(1n, "a", 1), index(1n, "b", 2)] });
      expect(yield* Effect.result(filter(yield* persistence.readSnapshot(1n), { predicate: program, order: "asc", offset: 0, limit: 5 })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });

    })), 120_000);

    it("never matches a stored tagged value, orders a tagged key by its index key, and folds a very long title", run(fixture => Effect.gen(function* () {
      const persistence = fixture.persistence;
      const lease = yield* persistence.acquireLease();
      const integer = { $integer: "AQAAAAAAAAA=" }, float = { $float: "AAAAAAAAAIA=" };
      const long = `${"x".repeat(200_000)} Long NEEDLE ${"y".repeat(1000)}`;
      const bodies: readonly JsonObject[] = [
        { id: "plain", rank: "a", title: "abc", flag: true, at: "2024-01-01T00:00:00.000Z", deleted_at: null },
        { id: "tagged", rank: "b", title: integer, flag: float, at: integer, deleted_at: null },
        { id: "tagged-rank", rank: integer, title: "abc", flag: false, at: null, deleted_at: null },
        { id: "long", rank: "c", title: long, flag: null, at: null, deleted_at: null },
      ];
      yield* persistence.write(lease, { documents: bodies.map((row, ordinal) => document(1n, ordinal, row)), indexes: [
        index(1n, "a", 0), index(1n, "b", 1),
        { ts: 1n, index: { id: indexId }, key: Result.getOrThrow(encodeIndexKey([1n], publicId(2))), mode: "scanComplete", prev: null,
          value: { tableId, documentId: identity(1002) } },
        index(1n, "c", 3)] });
      const snapshot = yield* persistence.readSnapshot(1n);
      const scanned = yield* snapshot.scan({ index: { id: indexId }, tableId, interval: { start: null, end: null }, order: "asc", maxResults: 100 });
      const ids = (page: { readonly entries: readonly { readonly document: CoreDocumentLogEntry }[] }) => page.entries.map(entry =>
        Number(new DataView(entry.document.id.buffer, entry.document.id.byteOffset).getUint32(12, false)) - 1000);
      const all = yield* filter(snapshot, { predicate: prepare({ kind: "and", children: [] }, "asc").program, order: "asc", offset: 0, limit: 10 });
      expect(ids(all)).toEqual(ids(scanned));
      expect(ids(all)).toHaveLength(4);
      for (const predicate of [like("%"), { kind: "in", column: "title", values: ["abc", "AQAAAAAAAAA="] }, { kind: "isNull", column: "title" },
        { kind: "textNotEqual", column: "title", value: "abc" }, { kind: "greaterThan", column: "title", value: "" },
        { kind: "lessThan", column: "at", value: "9999-01-01T00:00:00.000Z" }, { kind: "greaterThan", column: "at", value: "0001-01-01T00:00:00.000Z" },
        { kind: "isNull", column: "flag" }, { kind: "in", column: "flag", values: [true, false] }, { kind: "isNull", column: "at" },
      ] satisfies JsonObject[]) {
        const page = yield* filter(snapshot, { predicate: prepare(predicate, "asc").program, order: "asc", offset: 0, limit: 10 });
        expect(ids(page), JSON.stringify(predicate)).not.toContain(1);
      }
      const needle = prepare(like("%long needle%"), "asc");
      expect(Result.getOrThrow(needle.query.inspect(bodies[3] ?? {})).matches).toBe(true);
      expect(ids(yield* filter(snapshot, { predicate: needle.program, order: "asc", offset: 0, limit: 10 }))).toEqual([3]);
      expect(ids(yield* filter(snapshot, { predicate: prepare(like(`%${"x".repeat(240)}_long%`), "asc").program, order: "asc", offset: 0, limit: 10 }))).toEqual([3]);
    })), 120_000);

    it("reads a stored body only where a leaf needs it: a leafless statement passes an unreadable body, any leaf fails on it", run(fixture => Effect.gen(function* () {
      const persistence = fixture.persistence;
      const lease = yield* persistence.acquireLease();
      const prepared = Result.getOrThrow(prepareRelationalRead(table, { order: { column: "rank", direction: "asc" }, predicate: { kind: "and", children: [] } }, 100, failure));
      if (prepared.snapshotPredicate === undefined) return yield* Effect.die(new Error("Missing leafless predicate"));
      const leafless = Result.getOrThrow(issuePostgresSnapshotFilter(table, prepared.snapshotPredicate, failure));
      const leaf = prepare(like("%a%"), "asc").program;
      for (const [ts, bytes] of [[1n, Uint8Array.of(0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d)], [2n, utf8.encode("{not json")]] as const) {
        yield* persistence.write(lease, { documents: [document(ts, 1, { id: "plain", rank: "a", title: "abc", deleted_at: null }, ts === 1n ? null : 1n),
          { ...document(ts, 2, {}, ts === 1n ? null : 1n), jsonValue: bytes }], indexes: [index(ts, "a", 1), index(ts, "b", 2)] });
        const snapshot = yield* persistence.readSnapshot(ts);
        // No leaf reads the row, so PostgreSQL never parses the body: the count includes it.
        const counted = yield* filter(snapshot, { predicate: leafless, order: "asc", offset: 0, limit: 1 });
        expect({ count: counted.count, entries: counted.entries.length }).toEqual({ count: 2, entries: 1 });
        // Any leaf parses every examined body, so one unreadable body fails the read whatever its window.
        expect(yield* Effect.result(filter(snapshot, { predicate: leaf, order: "asc", offset: 0, limit: 1 })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
        expect(yield* Effect.result(filter(snapshot, { predicate: leaf, order: "asc", offset: 0, limit: 0 })))
          .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
      }
    })), 120_000);

    it("refuses a program this issuer did not register", run(fixture => Effect.gen(function* () {
      const { persistence } = yield* seed(fixture, 4);
      const snapshot = yield* persistence.readSnapshot(1n);
      // SAFETY: a deliberately forged token; only the issuer's exact identity is admitted.
      const forged = Object.freeze({}) as Parameters<typeof filter>[1]["predicate"];
      expect(yield* Effect.result(filter(snapshot, { predicate: forged, order: "asc", offset: 0, limit: 5 })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
    })), 120_000);
  });
}

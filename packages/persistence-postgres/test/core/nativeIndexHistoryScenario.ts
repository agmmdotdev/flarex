import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey, MAX_INDEX_KEY_PREFIX_BYTES, splitIndexKey } from "flarex-protocol/index-key";
import type { CoreDocumentLogEntry, CoreIndexHistoryCursor, CoreIndexHistoryPage, CoreIndexHistoryRequest, CorePersistenceIndexEntry } from "../../src/core/contracts";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";

function identity(value: number): Uint8Array {
  const id = new Uint8Array(16);
  new DataView(id.buffer).setUint32(12, value, false);
  return id;
}
const tableId = identity(10), index = { id: identity(20) }, documentId = identity(30);
const publicId = Result.getOrThrow(encodeDocumentId(100, documentId));
const key = Result.getOrThrow(encodeIndexKey(["same"], publicId));
const physicalKey = splitIndexKey(key);

function document(ts: bigint, value: string, prevTs: bigint | null = null, id = documentId): CoreDocumentLogEntry {
  return { ts, tableId, id, deleted: false, prevTs,
    jsonValue: Result.getOrThrow(encodeDocumentValue({ _id: Result.getOrThrow(encodeDocumentId(100, id)), _creationTime: 1, value })) };
}
function indexEntry(ts: bigint, fullKey = key, id = documentId, deleted = false): CorePersistenceIndexEntry {
  return { ts, index, key: fullKey, mode: "scanComplete", prev: null, value: deleted ? null : { tableId, documentId: id } };
}
function encodedKey(value: string, id = documentId): Uint8Array {
  return Result.getOrThrow(encodeIndexKey([value], Result.getOrThrow(encodeDocumentId(100, id))));
}
function cursor(fullKey: Uint8Array, ts: bigint): CoreIndexHistoryCursor {
  const split = splitIndexKey(fullKey);
  return { keyPrefix: split.keyPrefix, keySha256: split.keySha256, ts };
}
function request(overrides: Partial<CoreIndexHistoryRequest> = {}): CoreIndexHistoryRequest {
  return { index, tableId, interval: { start: null, end: null }, start: 0n, end: 100n,
    maxResults: 16, maxBytes: 1_048_576, maxDocumentBytes: 65_536, ...overrides };
}
function documentEvidence(value: CoreDocumentLogEntry) {
  return { ...value, tableId: encodeBytesToLowercaseHex(value.tableId), id: encodeBytesToLowercaseHex(value.id),
    jsonValue: encodeBytesToLowercaseHex(value.jsonValue) };
}
/** Evidence compares the byte domain, including pg Buffer, without changing any
 * timestamp, accounting, entry or cursor assertion. */
function pageEvidence(value: CoreIndexHistoryPage) {
  return { ...value, entries: value.entries.map(entry => ({ ...entry, key: encodeBytesToLowercaseHex(entry.key),
    document: entry.document === null ? null : documentEvidence(entry.document) })),
  cursor: value.cursor === null ? null : { ts: value.cursor.ts,
    keyPrefix: encodeBytesToLowercaseHex(value.cursor.keyPrefix), keySha256: encodeBytesToLowercaseHex(value.cursor.keySha256) } };
}
function expectPage(actual: CoreIndexHistoryPage, expected: CoreIndexHistoryPage): void {
  expect(pageEvidence(actual)).toEqual(pageEvidence(expected));
}
function expectedPage(overrides: Partial<CoreIndexHistoryPage> = {}): CoreIndexHistoryPage {
  return { entries: [], examined: 0, keyBytes: 0, documentBytes: 0, overBudget: false, cursor: null, done: true, ...overrides };
}
function requireCursor(page: CoreIndexHistoryPage): CoreIndexHistoryCursor {
  if (page.cursor === null) throw new Error("Nonterminal physical history page omitted its actual tuple cursor");
  return page.cursor;
}

export function registerNativeIndexHistoryScenarios(label: string,
  createFixture: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>) {
  const run = (body: (fixture: CorePersistenceFixture) => Promise<void>, options?: CorePersistenceFixtureOptions) => async () => {
    const fixture = await createFixture(options);
    try { await body(fixture); } finally { await fixture.close(); }
  };
  describe(`physical retained native-index history (${label})`, () => {
    it("charges and advances an out-of-window physical header before the next eligible version at B=1", async () => {
      const fixture = await createFixture();
      try {
        await Effect.runPromise(Effect.gen(function* () {
          const persistence = fixture.persistence, lease = yield* persistence.acquireLease();
          const old = document(1n, "outside-window"), eligible = document(2n, "eligible", 1n);
          yield* persistence.write(lease, { documents: [old], indexes: [indexEntry(1n)] });
          yield* persistence.write(lease, { documents: [eligible], indexes: [indexEntry(2n)] });
          const request: CoreIndexHistoryRequest = { index, tableId, interval: { start: null, end: null },
            start: 2n, end: 2n, maxResults: 1, maxBytes: 65_536, maxDocumentBytes: 65_536 };
          const first = yield* persistence.loadIndexHistory(request);
          expectPage(first, { entries: [], examined: 1, keyBytes: key.length, documentBytes: 0, overBudget: false,
            cursor: { keyPrefix: physicalKey.keyPrefix, keySha256: physicalKey.keySha256, ts: 1n }, done: false });
          if (first.cursor === null) return yield* Effect.die(new Error("Physical header page omitted its actual tuple cursor"));
          const second = yield* persistence.loadIndexHistory({ ...request, after: first.cursor });
          expectPage(second, { entries: [{ ts: 2n, key, document: eligible }], examined: 1, keyBytes: key.length,
            documentBytes: eligible.jsonValue.length, overBudget: false,
            cursor: { keyPrefix: physicalKey.keyPrefix, keySha256: physicalKey.keySha256, ts: 2n }, done: false });
          if (second.cursor === null) return yield* Effect.die(new Error("Eligible history page omitted its actual tuple cursor"));
          expectPage(yield* persistence.loadIndexHistory({ ...request, after: second.cursor }), { entries: [], examined: 0,
            keyBytes: 0, documentBytes: 0, overBudget: false, cursor: null, done: true });
        }));
      } finally { await fixture.close(); }
    }, 120_000);

    it("advances beyond the upper time bound without treating its physical cursor as value proof", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const eligible = document(1n, "eligible"), later = document(2n, "outside-window", 1n);
      await Effect.runPromise(persistence.write(lease, { documents: [eligible, later], indexes: [indexEntry(1n), indexEntry(2n)] }));
      const input = request({ start: 1n, end: 1n, maxResults: 1 });
      const first = await Effect.runPromise(persistence.loadIndexHistory(input));
      expectPage(first, expectedPage({ entries: [{ ts: 1n, key, document: eligible }], examined: 1, keyBytes: key.length,
        documentBytes: eligible.jsonValue.length, cursor: cursor(key, 1n), done: false }));
      const second = await Effect.runPromise(persistence.loadIndexHistory({ ...input, after: requireCursor(first) }));
      expectPage(second, expectedPage({ examined: 1, keyBytes: key.length, cursor: cursor(key, 2n), done: false }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory({ ...input, after: requireCursor(second) })), expectedPage());
    }), 120_000);

    it("orders same-key physical timestamps numerically across the 2-to-10 text boundary in one B=2 page", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const two = document(2n, "two"), ten = document(10n, "ten", 2n);
      await Effect.runPromise(persistence.write(lease, { documents: [two, ten], indexes: [indexEntry(2n), indexEntry(10n)] }));
      const input = request({ start: 0n, end: 10n, maxResults: 2 });
      const page = await Effect.runPromise(persistence.loadIndexHistory(input));
      expectPage(page, expectedPage({ entries: [{ ts: 2n, key, document: two }, { ts: 10n, key, document: ten }],
        examined: 2, keyBytes: key.length * 2, documentBytes: two.jsonValue.length + ten.jsonValue.length,
        cursor: cursor(key, 10n), done: false }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory({ ...input, after: requireCursor(page) })), expectedPage());
    }), 120_000);

    it("bounds duplicate-heavy retained versions before time filtering and continues without repeating a revision", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const revisions = Array.from({ length: 37 }, (_, n) => document(BigInt(n + 1), `revision-${n + 1}`, n === 0 ? null : BigInt(n)));
      await Effect.runPromise(persistence.write(lease, { documents: revisions, indexes: revisions.map(value => indexEntry(value.ts)) }));
      const input = request({ start: 18n, end: 19n, maxResults: 3 });
      let after: CoreIndexHistoryCursor | undefined, examined = 0, keyBytes = 0, documentBytes = 0;
      const entries: CoreIndexHistoryPage["entries"][number][] = [];
      for (let pageNumber = 0; pageNumber < 13; pageNumber++) {
        const page = await Effect.runPromise(persistence.loadIndexHistory({ ...input, ...(after === undefined ? {} : { after }) }));
        expect(page.examined).toBe(pageNumber === 12 ? 1 : 3);
        expect(page.overBudget).toBe(false);
        expect(page.done).toBe(pageNumber === 12);
        expect(pageEvidence(page).cursor).toEqual(pageEvidence(expectedPage({ cursor: cursor(key, BigInt(Math.min((pageNumber + 1) * 3, 37))) })).cursor);
        examined += page.examined; keyBytes += page.keyBytes; documentBytes += page.documentBytes; entries.push(...page.entries);
        after = requireCursor(page);
      }
      expect(examined).toBe(37); expect(keyBytes).toBe(37 * key.length);
      const eligible = revisions.filter(value => value.ts === 18n || value.ts === 19n);
      expect(documentBytes).toBe(eligible.reduce((sum, value) => sum + value.jsonValue.length, 0));
      expect(pageEvidence(expectedPage({ entries })).entries).toEqual(pageEvidence(expectedPage({
        entries: eligible.map(value => ({ ts: value.ts, key, document: value })),
      })).entries);
    }), 120_000);

    it("charges many keys with no in-window versions and terminates through empty entry pages", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const values = Array.from({ length: 13 }, (_, n) => {
        const id = identity(100 + n), value = `key-${String(n).padStart(2, "0")}`;
        return { key: encodedKey(value, id), document: document(1n, value, null, id) };
      });
      await Effect.runPromise(persistence.write(lease, { documents: values.map(value => value.document),
        indexes: values.map(value => indexEntry(1n, value.key, value.document.id)) }));
      const input = request({ start: 2n, end: 2n, maxResults: 2 });
      let after: CoreIndexHistoryCursor | undefined;
      for (let offset = 0; offset < values.length; offset += 2) {
        const selected = values.slice(offset, offset + 2), last = selected.at(-1);
        if (last === undefined) throw new Error("Missing genuine physical key fixture");
        const page = await Effect.runPromise(persistence.loadIndexHistory({ ...input, ...(after === undefined ? {} : { after }) }));
        expectPage(page, expectedPage({ examined: selected.length, keyBytes: selected.reduce((sum, value) => sum + value.key.length, 0),
          cursor: cursor(last.key, 1n), done: selected.length < 2 }));
        after = requireCursor(page);
      }
    }), 120_000);

    it("keeps timestamp zero and a canonical empty indexed value as real continuation positions", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const fullKey = encodedKey(""), first = document(0n, "zero"), second = document(1n, "one", 0n);
      await Effect.runPromise(persistence.write(lease, { documents: [first, second], indexes: [indexEntry(0n, fullKey), indexEntry(1n, fullKey)] }));
      const input = request({ start: 0n, end: 1n, maxResults: 1 });
      const page = await Effect.runPromise(persistence.loadIndexHistory(input));
      expectPage(page, expectedPage({ entries: [{ ts: 0n, key: fullKey, document: first }], examined: 1, keyBytes: fullKey.length,
        documentBytes: first.jsonValue.length, cursor: cursor(fullKey, 0n), done: false }));
      const continued = await Effect.runPromise(persistence.loadIndexHistory({ ...input, after: requireCursor(page) }));
      expectPage(continued, expectedPage({ entries: [{ ts: 1n, key: fullKey, document: second }], examined: 1, keyBytes: fullKey.length,
        documentBytes: second.jsonValue.length, cursor: cursor(fullKey, 1n), done: false }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory({ ...input, after: requireCursor(continued) })), expectedPage());
    }), 120_000);

    it("paginates every long-prefix coarse collision by digest and timestamp while charging its full suffix and body", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const values = ["d", "b", "a", "c"].map((suffix, n) => {
        const id = identity(200 + n), value = "p".repeat(2600) + suffix;
        return { key: encodedKey(value, id), document: document(1n, value, null, id) };
      }).toSorted((a, b) => compareBytesLexicographically(splitIndexKey(a.key).keySha256, splitIndexKey(b.key).keySha256));
      expect(values.every(value => splitIndexKey(value.key).keyPrefix.length === MAX_INDEX_KEY_PREFIX_BYTES)).toBe(true);
      expect(new Set(values.map(value => encodeBytesToLowercaseHex(splitIndexKey(value.key).keyPrefix))).size).toBe(1);
      await Effect.runPromise(persistence.write(lease, { documents: values.map(value => value.document),
        indexes: values.map(value => indexEntry(1n, value.key, value.document.id)) }));
      const selected = values[1];
      if (selected === undefined) throw new Error("Missing genuine narrow long-key bound");
      const end = new Uint8Array(selected.key.length + 1); end.set(selected.key);
      const input = request({ interval: { start: selected.key, end }, start: 1n, end: 1n, maxResults: 1 });
      let after: CoreIndexHistoryCursor | undefined;
      // Full-key interval acceptance belongs to the native consumer. All these
      // same-prefix coarse candidates are transported and charged by this port.
      for (const value of values) {
        const page = await Effect.runPromise(persistence.loadIndexHistory({ ...input, ...(after === undefined ? {} : { after }) }));
        expectPage(page, expectedPage({ entries: [{ ts: 1n, key: value.key, document: value.document }], examined: 1,
          keyBytes: value.key.length, documentBytes: value.document.jsonValue.length, cursor: cursor(value.key, 1n), done: false }));
        after = requireCursor(page);
      }
      if (after === undefined) throw new Error("Long-key physical cohort produced no continuation cursor");
      expectPage(await Effect.runPromise(persistence.loadIndexHistory({ ...input, after })), expectedPage());
    }), 120_000);

    it("honors the actual SQL page cap even when the logical request permits more rows", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const first = document(1n, "first"), second = document(2n, "second", 1n);
      await Effect.runPromise(persistence.write(lease, { documents: [first, second], indexes: [indexEntry(1n), indexEntry(2n)] }));
      const input = request({ maxResults: 100 });
      const page = await Effect.runPromise(persistence.loadIndexHistory(input));
      expectPage(page, expectedPage({ entries: [{ ts: 1n, key, document: first }], examined: 1, keyBytes: key.length,
        documentBytes: first.jsonValue.length, cursor: cursor(key, 1n), done: false }));
      const continuation = await Effect.runPromise(persistence.loadIndexHistory({ ...input, after: requireCursor(page) }));
      expectPage(continuation, expectedPage({ entries: [{ ts: 2n, key, document: second }], examined: 1, keyBytes: key.length,
        documentBytes: second.jsonValue.length, cursor: cursor(key, 2n), done: false }));
    }, { sqlPageSize: 1 }), 120_000);

    it("returns live revisions and index tombstones without hydrating a deleted anchor", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const live = document(1n, "live"), tombstone: CoreDocumentLogEntry = { ...document(2n, "unused", 1n), deleted: true, jsonValue: new Uint8Array() };
      await Effect.runPromise(persistence.write(lease, { documents: [live, tombstone], indexes: [indexEntry(1n), indexEntry(2n, key, documentId, true)] }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request())), expectedPage({
        entries: [{ ts: 1n, key, document: live }, { ts: 2n, key, document: null }], examined: 2, keyBytes: key.length * 2,
        documentBytes: live.jsonValue.length, cursor: cursor(key, 2n), done: true }));
    }), 120_000);

    for (const outside of ["older", "newer"] as const) {
      it(`does not hydrate an ${outside === "older" ? "actually pruned older" : "absent newer"} out-of-window anchor`, run(async fixture => {
        const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
        const retired = document(outside === "older" ? 1n : 3n, "retired"), eligible = document(2n, "eligible");
        await Effect.runPromise(persistence.write(lease, { documents: [retired, eligible], indexes: [indexEntry(retired.ts), indexEntry(2n)] }));
        // Disposable fixture maintenance: an old header may legitimately
        // outlive a pruned anchor. The newer control independently proves that
        // an unrequested future body is never consulted or used as proof.
        await fixture.query(`DELETE FROM "${fixture.namespace}"."documents" WHERE instance_name = $1 AND ts = $2 AND table_id = $3 AND id = $4`,
          [fixture.instanceName, retired.ts, tableId, documentId]);
        const input = request({ start: 2n, end: 2n });
        expectPage(await Effect.runPromise(persistence.loadIndexHistory(input)), expectedPage({ entries: [{ ts: 2n, key, document: eligible }],
          examined: 2, keyBytes: key.length * 2, documentBytes: eligible.jsonValue.length,
          cursor: cursor(key, outside === "older" ? 2n : 3n), done: true }));
      }), 120_000);
    }

    it("does not count or transfer an oversized out-of-window body against the eligible-body bound", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const large = document(1n, "x".repeat(8192));
      await Effect.runPromise(persistence.write(lease, { documents: [large], indexes: [indexEntry(1n)] }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request({ start: 2n, end: 2n,
        maxBytes: key.length + 128, maxDocumentBytes: 1 }))), expectedPage({ examined: 1, keyBytes: key.length, cursor: cursor(key, 1n) }));
    }), 120_000);

    for (const corruption of ["digest", "live-target", "tombstone-target"] as const) {
      it(`still rejects out-of-window ${corruption} header corruption before treating it as harmless ineligible work`, run(async fixture => {
        const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
        await Effect.runPromise(persistence.write(lease, { documents: [document(1n, "outside-window")],
          indexes: [indexEntry(1n, key, documentId, corruption === "tombstone-target")] }));
        if (corruption === "digest") {
          const changed = physicalKey.keySha256.slice(); changed[0] = (changed[0] ?? 0) ^ 255;
          await fixture.query(`UPDATE "${fixture.namespace}"."indexes" SET key_sha256 = $3 WHERE instance_name = $1 AND index_id = $2`,
            [fixture.instanceName, index.id, changed]);
        } else if (corruption === "live-target") {
          await fixture.query(`UPDATE "${fixture.namespace}"."indexes" SET table_id = NULL WHERE instance_name = $1 AND index_id = $2`,
            [fixture.instanceName, index.id]);
        } else {
          await fixture.query(`UPDATE "${fixture.namespace}"."indexes" SET table_id = $3, document_id = $4 WHERE instance_name = $1 AND index_id = $2`,
            [fixture.instanceName, index.id, tableId, documentId]);
        }
        const result = await Effect.runPromise(Effect.result(persistence.loadIndexHistory(request({ start: 2n, end: 2n }))));
        expect(Result.isFailure(result) ? result.failure : undefined).toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
      }), 120_000);
    }

    for (const corruption of ["missing", "wrong-table", "deleted", "latest-before-only"] as const) {
      it(`fails closed on an eligible ${corruption} anchor in a disposable physical fixture`, run(async fixture => {
        const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
        const old = document(1n, "old"), eligible = document(2n, "eligible", 1n);
        await Effect.runPromise(persistence.write(lease, { documents: [old, eligible], indexes: [indexEntry(1n), indexEntry(2n)] }));
        if (corruption === "wrong-table") {
          await fixture.query(`UPDATE "${fixture.namespace}"."indexes" SET table_id = $3 WHERE instance_name = $1 AND index_id = $2 AND ts = 2`,
            [fixture.instanceName, index.id, identity(99)]);
        } else if (corruption === "deleted") {
          await fixture.query(`UPDATE "${fixture.namespace}"."documents" SET deleted = true WHERE instance_name = $1 AND table_id = $2 AND id = $3 AND ts = 2`,
            [fixture.instanceName, tableId, documentId]);
        } else {
          await fixture.query(`DELETE FROM "${fixture.namespace}"."documents" WHERE instance_name = $1 AND table_id = $2 AND id = $3
            AND ${corruption === "missing" ? "ts IN (1,2)" : "ts = 2"}`, [fixture.instanceName, tableId, documentId]);
        }
        const result = await Effect.runPromise(Effect.result(persistence.loadIndexHistory(request({ start: 2n, end: 2n }))));
        expect(Result.isFailure(result) ? result.failure : undefined).toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
      }), 120_000);
    }

    for (const corruption of ["changed-suffix", "missing-suffix", "short-key-suffix", "changed-digest", "truncated-prefix"] as const) {
      it(`rejects ${corruption} corruption of a genuine persisted complete key`, run(async fixture => {
        const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
        const fullKey = corruption === "short-key-suffix" ? key : encodedKey("p".repeat(2600) + "suffix");
        await Effect.runPromise(persistence.write(lease, { documents: [document(1n, "key-integrity")], indexes: [indexEntry(1n, fullKey)] }));
        if (corruption === "changed-digest") {
          const changed = splitIndexKey(fullKey).keySha256.slice(); changed[0] = (changed[0] ?? 0) ^ 255;
          await fixture.query(`UPDATE "${fixture.namespace}"."indexes" SET key_sha256 = $3 WHERE instance_name = $1 AND index_id = $2`,
            [fixture.instanceName, index.id, changed]);
        } else if (corruption === "truncated-prefix") {
          await fixture.query(`UPDATE "${fixture.namespace}"."indexes" SET key_prefix = $3 WHERE instance_name = $1 AND index_id = $2`,
            [fixture.instanceName, index.id, splitIndexKey(fullKey).keyPrefix.slice(0, 10)]);
        } else {
          const suffix = corruption === "missing-suffix" ? null : Uint8Array.of(250, 251, 252);
          await fixture.query(`UPDATE "${fixture.namespace}"."indexes" SET key_suffix = $3 WHERE instance_name = $1 AND index_id = $2`,
            [fixture.instanceName, index.id, suffix]);
        }
        const result = await Effect.runPromise(Effect.result(persistence.loadIndexHistory(request())));
        expect(Result.isFailure(result) ? result.failure : undefined).toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
      }), 120_000);
    }

    for (const malformed of ["prefix", "digest", "timestamp"] as const) {
      it(`refuses a malformed ${malformed} request cursor through the exact input failure channel`, run(async fixture => {
        const after: CoreIndexHistoryCursor = { keyPrefix: malformed === "prefix" ? new Uint8Array(2501) : physicalKey.keyPrefix,
          keySha256: malformed === "digest" ? new Uint8Array(31) : physicalKey.keySha256, ts: malformed === "timestamp" ? -1n : 0n };
        const result = await Effect.runPromise(Effect.result(fixture.persistence.loadIndexHistory(request({ after }))));
        expect(Result.isFailure(result) ? result.failure : undefined).toMatchObject({ _tag: "CorePersistenceError", reason: "invalidTarget" });
      }), 120_000);
    }

    it("measures an oversized eligible body and returns the real physical cursor without transferring entries", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const large = document(1n, "x".repeat(8192));
      await Effect.runPromise(persistence.write(lease, { documents: [large], indexes: [indexEntry(1n)] }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request({ maxDocumentBytes: 512 }))), expectedPage({ examined: 1,
        keyBytes: key.length, documentBytes: large.jsonValue.length, overBudget: true, cursor: cursor(key, 1n) }));
    }), 120_000);

    it("counts every long tombstone suffix and header against the raw byte bound", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const fullKey = encodedKey("p".repeat(2600));
      await Effect.runPromise(persistence.write(lease, { documents: [], indexes: [indexEntry(1n, fullKey, documentId, true)] }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request({ maxBytes: fullKey.length + 127 }))), expectedPage({
        examined: 1, keyBytes: fullKey.length, overBudget: true, cursor: cursor(fullKey, 1n) }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request({ maxBytes: fullKey.length + 128 }))), expectedPage({
        entries: [{ ts: 1n, key: fullKey, document: null }], examined: 1, keyBytes: fullKey.length, cursor: cursor(fullKey, 1n) }));
    }), 120_000);

    it("enforces the combined physical key, body and header byte bound at its exact boundary", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const body = document(1n, "body"), bytes = key.length + body.jsonValue.length + 128;
      await Effect.runPromise(persistence.write(lease, { documents: [body], indexes: [indexEntry(1n)] }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request({ maxBytes: bytes - 1 }))), expectedPage({
        examined: 1, keyBytes: key.length, documentBytes: body.jsonValue.length, overBudget: true, cursor: cursor(key, 1n) }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request({ maxBytes: bytes }))), expectedPage({
        entries: [{ ts: 1n, key, document: body }], examined: 1, keyBytes: key.length, documentBytes: body.jsonValue.length,
        cursor: cursor(key, 1n) }));
    }), 120_000);

    it("accounts for the whole bounded physical page when its cumulative byte window is exceeded", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const first = document(1n, "first"), second = document(2n, "second", 1n);
      await Effect.runPromise(persistence.write(lease, { documents: [first, second], indexes: [indexEntry(1n), indexEntry(2n)] }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request({ maxBytes: key.length + first.jsonValue.length + 128 }))),
        expectedPage({ examined: 2, keyBytes: key.length * 2, documentBytes: first.jsonValue.length + second.jsonValue.length,
          overBudget: true, cursor: cursor(key, 2n) }));
    }), 120_000);

    it("returns a genuinely empty physical page under a zero remaining-byte bound", run(async fixture => {
      expectPage(await Effect.runPromise(fixture.persistence.loadIndexHistory(request({ maxBytes: 0 }))), expectedPage());
    }), 120_000);

    it("isolates the captured instance and index while refusing an eligible anchor for another tablet", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease()), body = document(1n, "owner");
      const other = { ...indexEntry(1n, encodedKey("other-index")), index: { id: identity(21) } };
      await Effect.runPromise(persistence.write(lease, { documents: [body], indexes: [indexEntry(1n), other] }));
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(request())), expectedPage({ entries: [{ ts: 1n, key, document: body }],
        examined: 1, keyBytes: key.length, documentBytes: body.jsonValue.length, cursor: cursor(key, 1n) }));
      const separate = await fixture.reopen("separate-history-instance");
      expectPage(await Effect.runPromise(separate.loadIndexHistory(request())), expectedPage());
      const wrongTable = await Effect.runPromise(Effect.result(persistence.loadIndexHistory(request({ tableId: identity(99) }))));
      expect(Result.isFailure(wrongTable) ? wrongTable.failure : undefined).toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
    }), 120_000);

    it("preserves byte ownership across returned entries, cursors and repeated continuation reads", run(async fixture => {
      const persistence = fixture.persistence, lease = await Effect.runPromise(persistence.acquireLease());
      const first = document(1n, "first"), second = document(2n, "second", 1n);
      await Effect.runPromise(persistence.write(lease, { documents: [first, second], indexes: [indexEntry(1n), indexEntry(2n)] }));
      const input = request({ maxResults: 1 }), page = await Effect.runPromise(persistence.loadIndexHistory(input));
      const saved = cursor(key, 1n), actual = requireCursor(page);
      actual.keyPrefix.fill(255); actual.keySha256.fill(255);
      expect(page.entries.map(entry => encodeBytesToLowercaseHex(entry.key))).toEqual([encodeBytesToLowercaseHex(key)]);
      const entry = page.entries[0];
      if (entry === undefined || entry.document === null) throw new Error("Missing genuine returned history body");
      entry.key.fill(254); entry.document.jsonValue.fill(254); entry.document.id.fill(254); entry.document.tableId.fill(254);
      const expected = expectedPage({ entries: [{ ts: 2n, key, document: second }], examined: 1, keyBytes: key.length,
        documentBytes: second.jsonValue.length, cursor: cursor(key, 2n), done: false });
      expectPage(await Effect.runPromise(persistence.loadIndexHistory({ ...input, after: saved })), expected);
      expectPage(await Effect.runPromise(persistence.loadIndexHistory({ ...input, after: saved })), expected);
      expectPage(await Effect.runPromise(persistence.loadIndexHistory(input)), expectedPage({ entries: [{ ts: 1n, key, document: first }],
        examined: 1, keyBytes: key.length, documentBytes: first.jsonValue.length, cursor: cursor(key, 1n), done: false }));
    }), 120_000);
  });
}

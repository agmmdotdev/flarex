import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import { compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey } from "flarex-protocol/index-key";
import type { CoreTableDefinition } from "../../src/core/api";
import type { CoreDocumentLogEntry, CorePersistenceIndexEntry, CoreWriteBatch } from "../../src/core/contracts";
import { CoreNativeReferenceSchema } from "../../src/core/nativePolicyTypes";
import { readCoreNativeMembership } from "../../src/core/nativeReferenceProjection";
import { coreNativeReferenceInterval, coreNativeReferenceTargets, validateCoreNativeReferences,
  type CoreNativeReferenceSelection, type CorePreparedNativeReferences } from "../../src/core/nativeReferences";

const internal = (value: number) => new Uint8Array(16).fill(value);
const source: CoreTableDefinition = { name: "posts", number: 10001, tabletId: internal(1), namespace: null, state: "active", indexes: [] };
const target: CoreTableDefinition = { name: "targets", number: 10002, tabletId: internal(2), namespace: null, state: "active", indexes: [] };
const membership: CoreTableDefinition = { name: "nativeMembers", number: 10003, tabletId: internal(3), namespace: null, state: "active", indexes: [] };
const index = { name: "by_target_source", ref: { id: internal(4) }, fields: ["targetId", "sourceId"] };
const sourceIndex = { name: "by_source_target", ref: { id: internal(5) }, fields: ["sourceId", "targetId"] };
const reference = Schema.decodeUnknownSync(CoreNativeReferenceSchema)({
  declaration: { format: "flarex.relation-declaration", version: 1,
    source: { table: "posts", path: [{ kind: "field", name: "relatedPosts" }], forwardName: "relatedPosts" },
    target: { table: "targets" }, value: { cardinality: "many", minItems: 0, maxItems: 32, ordered: true, duplicates: "forbid" },
    inverse: { cardinality: "many", name: null }, localized: false, onTargetDelete: "restrict" },
  reference: { kind: "manyMembership", name: "document-relation/payload/posts/relatedPosts", sourceKey: "payload" },
  sourceTable: "posts", targetTable: "targets", field: "relatedPosts", indexName: index.name,
  projection: { tableName: membership.name, bySourceIndex: sourceIndex.name, byTargetIndex: index.name },
});
const selection: CoreNativeReferenceSelection = { reference, source, target, index, projection: { table: membership, sourceIndex } };
const id = (table: CoreTableDefinition, value: number) => Result.getOrThrow(encodeDocumentId(table.number, internal(value)));
const targetId = id(target, 10), sourceId = id(source, 11), secondId = id(source, 12);
const interval = Result.getOrThrow(coreNativeReferenceInterval(selection, targetId));
const memberKey = (owner: string, value: number) => Result.getOrThrow(encodeIndexKey([targetId, owner], id(membership, value)));
const member = (owner: string, value: number, deleted = false): CoreDocumentLogEntry => ({ tableId: membership.tabletId,
  id: internal(value), ts: 2n, deleted, prevTs: null,
  jsonValue: deleted ? new Uint8Array() : Result.getOrThrow(encodeDocumentValue({ _id: id(membership, value), _creationTime: 1000,
    sourceId: owner, targetId })) });
const entry = (owner: string, value: number, deleted = false): CorePersistenceIndexEntry => ({ index: index.ref,
  key: memberKey(owner, value), mode: "scanComplete", ts: 2n, prev: null,
  value: deleted ? null : { tableId: membership.tabletId, documentId: internal(value) } });
const batch = (documents: readonly CoreDocumentLogEntry[] = [], indexes: readonly CorePersistenceIndexEntry[] = []): CoreWriteBatch => ({ documents, indexes });
const incoming = (...owners: readonly Readonly<{ id: string; member: number }>[]): CorePreparedNativeReferences => ({ reads: [], demands: [], maxIdentities: 64,
  incoming: [{ selection, targetId, interval,
    entries: new Map(owners.map(owner => [encodeBytesToLowercaseHex(memberKey(owner.id, owner.member)), owner.id])) }] });
const failure = (result: ReturnType<typeof validateCoreNativeReferences>) => Result.isFailure(result) ? result.failure : undefined;

describe("native many membership integrity", () => {
  it("keeps ordered distinct canonical targets without turning assignment into a body observation", () => {
    const ids = Array.from({ length: 32 }, (_, value) => id(target, value + 20));
    expect(Result.getOrThrow(coreNativeReferenceTargets(selection, { relatedPosts: ids.toReversed() }))).toEqual(ids.toReversed());
    for (const value of [null, [targetId, targetId], [sourceId], [1], Array.from({ length: 33 }, (_, n) => id(target, n + 40))]) {
      expect(Result.isFailure(coreNativeReferenceTargets(selection, { relatedPosts: value }))).toBe(true);
    }
    expect(Result.isFailure(coreNativeReferenceTargets(selection, {}))).toBe(true);
  });

  it("requires exact private document and endpoint identities", () => {
    const value = { _id: id(membership, 13), _creationTime: 1000, sourceId, targetId };
    expect(Result.getOrThrow(readCoreNativeMembership({ source, target, membership }, value)))
      .toEqual({ id: value._id, sourceId, targetId });
    for (const invalid of [{ ...value, sourceId: targetId }, { ...value, targetId: sourceId },
      { ...value, _id: sourceId }, { ...value, position: 1 }]) {
      expect(Result.isFailure(readCoreNativeMembership({ source, target, membership }, invalid))).toBe(true);
    }
  });

  it("uses private index membership to fold all accepted removals and final overlay", () => {
    const removed = batch([member(sourceId, 13, true)], [entry(sourceId, 13, true)]);
    const remaining = incoming({ id: sourceId, member: 13 }, { id: secondId, member: 14 });
    expect(failure(validateCoreNativeReferences(remaining, [removed], batch())))
      .toMatchObject({ reason: "relationDeleteRestricted", sourceId: secondId });
    const finalRemoval = batch([member(secondId, 14, true)], [entry(secondId, 14, true)]);
    expect([...Result.getOrThrow(validateCoreNativeReferences(remaining, [removed], finalRemoval))]).toEqual([removed]);
    const added = batch([member(sourceId, 13)], [entry(sourceId, 13)]);
    expect(failure(validateCoreNativeReferences(incoming(), [added], batch())))
      .toMatchObject({ reason: "relationDeleteRestricted", sourceId });
    expect(Result.isSuccess(validateCoreNativeReferences(incoming(), [added, removed], batch()))).toBe(true);
  });

  it("refuses duplicate or foreign physical children rather than treating them as extra business authorities", () => {
    const duplicated = batch([member(sourceId, 13), member(sourceId, 14)], [entry(sourceId, 13), entry(sourceId, 14)]);
    expect(failure(validateCoreNativeReferences(incoming(), [duplicated], batch())))
      .toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
    const noDocument = batch([], [entry(sourceId, 13)]);
    expect(failure(validateCoreNativeReferences(incoming(), [noDocument], batch())))
      .toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
  });

  it("orders same-table canonical source IDs exactly like the internal byte identity", () => {
    // Fixed table prefix + ordered base32 alphabet preserves the first differing
    // internal bit. Checksum bits follow every internal bit and cannot reverse it.
    const identities = [new Uint8Array(16), new Uint8Array(16).fill(255)];
    for (let position = 0; position < 16; position++) for (const byte of [1, 31, 32, 127, 128, 254]) {
      const value = new Uint8Array(16); value[position] = byte; identities.push(value);
      const carry = new Uint8Array(16).fill(255); carry[position] = byte; identities.push(carry);
    }
    let state = 0x81234567;
    for (let count = 0; count < 256; count++) {
      const value = new Uint8Array(16);
      for (let position = 0; position < value.length; position++) { state = Math.imul(state, 1664525) + 1013904223 | 0; value[position] = state >>> 24; }
      identities.push(value);
    }
    const expected = identities.toSorted(compareBytesLexicographically).map(value => encodeBytesToLowercaseHex(value));
    for (const table of [1, 127, 128, 10001, 16383, 16384, 0xffff_ffff]) {
      const encoded = identities.map(bytes => ({ bytes, id: Result.getOrThrow(encodeDocumentId(table, bytes)) }));
      expect(encoded.toSorted((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(value => encodeBytesToLowercaseHex(value.bytes)))
        .toEqual(expected);
    }
  });
});

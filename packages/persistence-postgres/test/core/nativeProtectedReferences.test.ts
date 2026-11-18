import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import type { CoreTableDefinition } from "../../src/core/api";
import type { CoreWriteBatch } from "../../src/core/contracts";
import { CoreNativeProtectedReferenceSchema } from "../../src/core/nativePolicyTypes";
import { validateCoreNativeProtectedReferences, type CorePreparedNativeProtectedReferences } from "../../src/core/nativeProtectedReferences";
import type { CoreNativeKeyProbe } from "../../src/core/nativeKeyProbe";

const id = (value: number) => { const bytes = new Uint8Array(16); bytes[15] = value; return bytes; };
const index = (value: number, field: string) => ({ name: `by_${field}`, fields: [field], ref: { id: id(value) } });
const source: CoreTableDefinition = { name: "articles", number: 10001, tabletId: id(1), namespace: null,
  state: "active", indexes: [index(11, "product")] };
const target: CoreTableDefinition = { name: "products", number: 10002, tabletId: id(2), namespace: null,
  state: "active", indexes: [index(12, "id")] };
const publicId = (table: CoreTableDefinition, value = 3) => Result.getOrThrow(encodeDocumentId(table.number, id(value)));
const descriptor = Result.getOrThrow(Schema.decodeUnknownResult(CoreNativeProtectedReferenceSchema)({
  reference: { name: "article_product", sourceKey: "payload", source: { table: { namespace: "app", logicalName: "articles" }, field: "product" },
    target: { table: { namespace: "app", logicalName: "products" }, field: "id" }, policy: "strongReference",
    liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
    onTargetSoftDelete: "retain", onTargetDelete: "restrict" },
  sourceTable: source.name, targetTable: target.name, field: "product", indexName: "by_product", targetField: "id", targetIndexName: "by_id",
  sourceIdentity: { sourceKey: "payload", sourceSha256: "a".repeat(64) }, targetIdentity: { sourceKey: "medusa", sourceSha256: "b".repeat(64) },
}));
const document = (table: CoreTableDefinition, deleted: boolean): DocumentObject => ({ _id: publicId(table), _creationTime: 1,
  ...(table === target ? { id: "native-product", deleted_at: deleted ? "2026-11-01T00:00:00.000Z" : null } : { product: "native-product" }) });
const probe = (table: CoreTableDefinition, deleted = false, present = true): CoreNativeKeyProbe => {
  const selected = table.indexes[0]; if (selected === undefined) throw new Error("Missing test index");
  return { table, index: selected, interval: { start: Uint8Array.of(10), end: Uint8Array.of(20) },
    entries: new Map(present ? [["0a", publicId(table)]] : []), documents: new Map(present ? [["0a", document(table, deleted)]] : []) };
};
const batch = (table?: CoreTableDefinition, deleted = false, remove = false): CoreWriteBatch => {
  if (table === undefined) return { documents: [], indexes: [] };
  const selected = table.indexes[0]; if (selected === undefined) throw new Error("Missing test index");
  return { documents: [{ tableId: table.tabletId, id: id(3), ts: 2n, prevTs: 1n, deleted: remove,
    jsonValue: remove ? new Uint8Array() : Result.getOrThrow(encodeDocumentValue(document(table, deleted))) }],
    indexes: [{ mode: "scanComplete", index: selected.ref, ts: 2n, prev: null, key: Uint8Array.of(10),
      value: remove ? null : { tableId: table.tabletId, documentId: id(3) } }] };
};
const prepared = (retained: boolean, targetDeleted = false): CorePreparedNativeProtectedReferences => ({ reads: [],
  demands: [{ selection: { reference: descriptor, source, target }, sourceId: publicId(source), targetId: "native-product", retained,
    target: probe(target, targetDeleted) }], releases: [], maxIdentities: 16, identities: [], sourceCaptures: [] });
const failure = (result: ReturnType<typeof validateCoreNativeProtectedReferences>) => Result.isFailure(result) ? result.failure : undefined;

describe("protected native assignment and retention", () => {
  it("requires an active new target while retaining an unchanged reference to a soft-deleted target", () => {
    expect(failure(validateCoreNativeProtectedReferences(prepared(false, true), [], batch())))
      .toMatchObject({ reason: "relationTargetMissing", targetId: "native-product" });
    expect(Result.isSuccess(validateCoreNativeProtectedReferences(prepared(true, true), [], batch()))).toBe(true);
  });

  it("applies target liveness to every accepted predecessor without importing a target-body observation", () => {
    const deleting = batch(target, true);
    expect(failure(validateCoreNativeProtectedReferences(prepared(false), [deleting], batch())))
      .toMatchObject({ reason: "relationTargetMissing" });
    const restoring = batch(target, false);
    expect([...Result.getOrThrow(validateCoreNativeProtectedReferences(prepared(false, true), [restoring], batch()))]).toEqual([restoring]);
    expect([...Result.getOrThrow(validateCoreNativeProtectedReferences(prepared(true), [deleting], batch()))]).toEqual([]);
  });

  it("retains reverse membership through soft deletion and restricts hard deletion until clearing", () => {
    const state: CorePreparedNativeProtectedReferences = { ...prepared(true), demands: [], releases: [{
      selection: { reference: descriptor, source, target }, targetId: "native-product", target: probe(target, true), incoming: probe(source),
    }] };
    expect(failure(validateCoreNativeProtectedReferences(state, [], batch(target, false, true))))
      .toMatchObject({ reason: "relationDeleteRestricted" });
    const clearing = batch(source, false, true);
    expect([...Result.getOrThrow(validateCoreNativeProtectedReferences(state, [clearing], batch(target, false, true)))]).toEqual([clearing]);
  });

  it("keeps the older protected soft-delete restriction distinct from article retention", () => {
    const { onTargetSoftDelete: _retain, ...restrictedDeclaration } = descriptor.reference;
    const restricted = { ...descriptor, reference: restrictedDeclaration };
    const state: CorePreparedNativeProtectedReferences = { ...prepared(false), demands: [], releases: [{
      selection: { reference: restricted, source, target }, targetId: "native-product", target: probe(target), incoming: probe(source),
    }] };
    expect(failure(validateCoreNativeProtectedReferences(state, [], batch(target, true))))
      .toMatchObject({ reason: "relationDeleteRestricted" });
  });
});

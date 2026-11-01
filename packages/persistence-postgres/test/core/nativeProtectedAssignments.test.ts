import { Effect, Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { bytesEqual, compareBytesLexicographically } from "@flarex/utils/bytes";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import type { CoreTableDefinition } from "../../src/core/api";
import type { CoreDocumentLogEntry, CorePersistenceSnapshot } from "../../src/core/contracts";
import { documentIndexKey } from "../../src/core/documentIndex";
import { CoreNativeProtectedReferenceSchema, CoreNativeTablePolicySchema } from "../../src/core/nativePolicyTypes";
import { prepareCoreNativeProtectedReferences, validateCoreNativeProtectedReferences } from "../../src/core/nativeProtectedReferences";
import { initialRegistry, publicDocumentId, readDocumentObject } from "../../src/core/registry";
import { CoreFinalizationVault, createCoreTransaction } from "../../src/core/transaction";
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import { keyInInterval } from "../../src/core/writeLog";

const bytes = (value: number) => new Uint8Array(16).fill(value);
const table = (name: string, number: number, identity: number): CoreTableDefinition => ({ name, number,
  tabletId: bytes(identity), namespace: null, state: "active", indexes: [
    { name: "by_id", fields: [], ref: { id: bytes(identity + 20) } },
    { name: "by_creation_time", fields: ["_creationTime"], ref: { id: bytes(identity + 40) } },
  ] });

function fixture() {
  const source = { ...table("articles", 10001, 1), indexes: [...table("articles", 10001, 1).indexes,
    { name: "by_product", fields: ["product"], ref: { id: bytes(71) } }] };
  const targetBase = { ...table("products", 10002, 2), indexes: [...table("products", 10002, 2).indexes,
    { name: "by_native_id", fields: ["id"], ref: { id: bytes(72) } }] };
  const schemas = { ...table("_schemas", 532, 3), indexes: [...table("_schemas", 532, 3).indexes,
    { name: "by_state", fields: ["state"], ref: { id: bytes(73) } }] };
  const reference = Schema.decodeUnknownSync(CoreNativeProtectedReferenceSchema)({
    reference: { name: "article_product", sourceKey: "application", source: { table: { namespace: "app", logicalName: "articles" }, field: "product" },
      target: { table: { namespace: "app", logicalName: "products" }, field: "id" }, policy: "strongReference",
      liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
      onTargetSoftDelete: "retain", onTargetDelete: "restrict" },
    sourceTable: source.name, targetTable: targetBase.name, field: "product", indexName: "by_product",
    targetField: "id", targetIndexName: "by_native_id",
    sourceIdentity: { sourceKey: "application", sourceSha256: "a".repeat(64) },
    targetIdentity: { sourceKey: "medusa", sourceSha256: "b".repeat(64) },
  });
  const target: CoreTableDefinition = { ...targetBase, nativePolicy: Schema.decodeUnknownSync(CoreNativeTablePolicySchema)({
    state: "active", schemaId: Result.getOrThrow(publicDocumentId(schemas, bytes(81))), applicationRead: false, uniqueConstraints: [],
    identity: { sourceKey: "medusa", sourceSha256: "b".repeat(64), configSha256: "c".repeat(64), provenanceSha256: "d".repeat(64),
      definitionHash: "e".repeat(64), scopeUuid: "1726a4fd-1e3f-4166-a276-72742040bd95", epochUuid: "21172004-bd8d-40f5-b735-825ec68c06bd" },
    protectedReferences: [reference],
  }) };
  const registry = Result.getOrThrow(initialRegistry([table("_tables", 513, 4), table("_index", 514, 5), schemas, source, target]));
  const sourceId = Result.getOrThrow(publicDocumentId(source, bytes(91)));
  const sourceDocument: DocumentObject = { _id: sourceId, _creationTime: 1, title: "retained", product: "product-a" };
  const targetDocument: DocumentObject = { _id: Result.getOrThrow(publicDocumentId(target, bytes(92))), _creationTime: 1,
    id: "product-a", deleted_at: "2026-11-01T00:00:00.000Z" };
  const documents: readonly CoreDocumentLogEntry[] = [{ table: source, document: sourceDocument, identity: 91 },
    { table: target, document: targetDocument, identity: 92 }].map(value => ({ tableId: value.table.tabletId, id: bytes(value.identity),
      ts: 1n, prevTs: null, deleted: false, jsonValue: Result.getOrThrow(encodeDocumentValue(value.document)) }));
  const scanned: string[] = [];
  const snapshot: CorePersistenceSnapshot = { timestamp: 1n, get: () => Effect.succeed(Option.none()), scan: request => Effect.sync(() => {
    const selected = registry.indexById(request.index.id);
    if (selected === undefined) throw new Error("Unknown selected test index");
    scanned.push(selected.table.name);
    const entries = documents.filter(document => bytesEqual(document.tableId, request.tableId)).map(document => ({ document,
      key: Result.getOrThrow(documentIndexKey(selected.index, Result.getOrThrow(readDocumentObject(document, selected.table)))) }))
      .filter(entry => keyInInterval(entry.key, request.interval)).toSorted((a, b) => compareBytesLexicographically(a.key, b.key));
    const page = entries.slice(0, request.maxResults), last = page.at(-1);
    return { entries: page, cursor: entries.length > page.length && last !== undefined
      ? { kind: "after" as const, key: last.key } : { kind: "end" as const } };
  }) };
  const vault = new CoreFinalizationVault();
  const context = createCoreTransaction({ snapshot, registry, vault, now: 1n,
    idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 1n)) });
  return { context, vault, sourceId, source, target, snapshot, registry, scanned };
}

describe("protected pending assignment history", () => {
  it("records clear then same-key reassignment without observing the target body during staging", async () => {
    const tested = fixture();
    await Effect.runPromise(tested.context.transaction.patch(tested.sourceId, { product: null }));
    await Effect.runPromise(tested.context.transaction.patch(tested.sourceId, { product: "product-a" }));
    const record = tested.vault.take(await Effect.runPromise(tested.context.transaction.finalize()));
    expect(tested.scanned).not.toContain(tested.target.name);
    expect(record?.changes[0]).toMatchObject({ protectedReferenceAssignments: [{ referenceName: "article_product", targetId: "product-a" }] });
  });

  it("rejects an ordinary Application assignment to an inactive protected native target", async () => {
    const tested = fixture();
    await Effect.runPromise(tested.context.transaction.patch(tested.sourceId, { product: null }));
    await Effect.runPromise(tested.context.transaction.patch(tested.sourceId, { product: "product-a" }));
    const record = tested.vault.take(await Effect.runPromise(tested.context.transaction.finalize()));
    if (record === undefined) throw new Error("Missing finalized source transaction");
    const prepared = await Effect.runPromise(prepareCoreNativeProtectedReferences(tested.snapshot, tested.registry, record));
    expect(validateCoreNativeProtectedReferences(prepared, [], { documents: [], indexes: [] }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "relationTargetMissing", targetId: "product-a" } });
  });
});

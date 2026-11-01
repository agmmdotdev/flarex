/**
 * Mechanisms translated from Convex crates/database/src/writes.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Result, Schema } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeIndexKey, encodeIndexValue } from "flarex-protocol/index-key";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { CoreTransactionError, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { INDEXES, TABLES, SCHEMAS, PROGRAMS, publicDocumentId, type CoreRegistry } from "./registry";
import { decodeCoreIndexMetadata } from "./indexState";
import type { CoreDocumentChange } from "./transaction";
import { CoreReadSetBuilder, pointInterval, type CoreIndexKeys, type CoreReadSet } from "./writeLog";
import { CoreNativeTablePolicySchema } from "./nativePolicyTypes";
import { decodeCoreSchemaMetadata, type CoreSchemaDefinition } from "./schemaTypes";
import { parseCoreSchema, serializeCoreSchema } from "./schemaJson";
import { coreProtectedNativePolicyMeaning } from "./protectedNativeMetadata";

/** Conflict-only _index.by_table_id, as Writes::record_reads_for_write; never persisted. */
function virtualIndexIdentity(registry: CoreRegistry): Result.Result<Uint8Array, CoreTransactionError> {
  const table = registry.table(INDEXES);
  if (table === undefined) return Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
  // Physical index identities have16bytes. This domain-separated logical name has17.
  const name = new Uint8Array(17);
  name[0] = 255;
  name.set(table.definition.tabletId, 1);
  return Result.succeed(name);
}

function semanticTableIndex(registry: CoreRegistry): Result.Result<Uint8Array, CoreTransactionError> {
  const table = registry.table(TABLES);
  if (table === undefined) return Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
  const id = new Uint8Array(17);
  id[0] = 254;
  id.set(table.definition.tabletId, 1);
  return Result.succeed(id);
}

/** Only consumed metadata is revalidated when a protected snapshot read
 * finishes. Ordinary business dependencies retain their selected snapshot. */
export function coreMetadataReadSet(registry: CoreRegistry, reads: CoreReadSet): Result.Result<CoreReadSet, CoreTransactionError> {
  return Result.gen(function* () {
    const semantic = yield* semanticTableIndex(registry), virtualIndexes = yield* virtualIndexIdentity(registry);
    return Object.freeze(reads.filter(read => bytesEqual(read.indexId, semantic) || bytesEqual(read.indexId, virtualIndexes)
      || [TABLES, INDEXES, PROGRAMS, SCHEMAS].includes(registry.indexById(read.indexId)?.table.name ?? "")));
  });
}

/** A protected profile consumes table/policy meaning independently of a
 * compatible schema-head handoff. Every metadata writer emits these keys. */
export function addTableSemanticDependency(reads: CoreReadSetBuilder, registry: CoreRegistry,
  table: CoreTableDefinition): Result.Result<void, CoreTransactionError> {
  return Result.gen(function* () {
    const key = yield* Result.mapError(encodeIndexValue(encodeBytesToLowercaseHex(table.tabletId)),
      cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(yield* semanticTableIndex(registry), pointInterval(key));
  });
}

const decodeNativePolicy = Schema.decodeUnknownResult(CoreNativeTablePolicySchema);
function semanticTableDocument(document: DocumentObject | null): Result.Result<Uint8Array | null, CoreTransactionError> {
  if (document === null) return Result.succeed(null);
  return Result.gen(function* () {
    const { _id, _creationTime, nativePolicy, ...body } = document;
    if (nativePolicy === undefined) return yield* Result.mapError(encodeDocumentValue(body),
      cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    const policy = yield* Result.mapError(decodeNativePolicy(nativePolicy),
      cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    return yield* Result.mapError(encodeDocumentValue({ ...body, nativePolicy: coreProtectedNativePolicyMeaning(policy) }),
      cause => new CoreTransactionError({ reason: "invalidValue", cause }));
  });
}

function prefixInterval(prefix: Uint8Array) {
  let position = prefix.length - 1;
  while (position >= 0 && prefix[position] === 255) position -= 1;
  if (position < 0) return { start: prefix, end: null };
  const end = prefix.slice(0, position + 1);
  end[position] = (end[position] ?? 0) + 1;
  return { start: prefix, end };
}

export function addIndexMetadataDependency(reads: CoreReadSetBuilder, registry: CoreRegistry,
  index: CoreIndexDefinition): Result.Result<void, CoreTransactionError> {
  return Result.gen(function* () {
    const table = registry.table(INDEXES)?.definition;
    const byId = table?.indexes.find(candidate => candidate.name === "by_id");
    if (table === undefined || byId === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
    const id = yield* publicDocumentId(table, index.ref.id);
    const key = yield* Result.mapError(encodeIndexKey([], id), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(byId.ref.id, pointInterval(key));
  });
}

export function addTableWriteDependencies(reads: CoreReadSetBuilder, registry: CoreRegistry,
  table: CoreTableDefinition, selectiveMetadata = false): Result.Result<void, CoreTransactionError> {
  return Result.gen(function* () {
    if (table.name === TABLES || table.name === INDEXES) {
      for (const name of [TABLES, INDEXES]) {
        const byId = registry.table(name)?.definition.indexes.find(index => index.name === "by_id");
        if (byId === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
        reads.add(byId.ref.id, { start: null, end: null });
      }
      return;
    }
    const metadata = registry.table(TABLES)?.definition;
    const byId = metadata?.indexes.find(index => index.name === "by_id");
    const record = registry.table(table.name, table.namespace);
    if (metadata === undefined || byId === undefined || record === undefined)
      return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
    if (selectiveMetadata) yield* addTableSemanticDependency(reads, registry, table);
    else {
      const tableId = yield* publicDocumentId(metadata, record.id);
      const tableKey = yield* Result.mapError(encodeIndexKey([], tableId), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
      reads.add(byId.ref.id, pointInterval(tableKey));
    }
    const virtual = yield* virtualIndexIdentity(registry);
    const key = yield* Result.mapError(encodeIndexValue(encodeBytesToLowercaseHex(table.tabletId)), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    reads.add(virtual, prefixInterval(key));
  });
}

export function metadataConflictKeys(registry: CoreRegistry,
  changes: readonly CoreDocumentChange[]): Result.Result<readonly CoreIndexKeys[], CoreTransactionError> {
  return Result.gen(function* () {
    const keys = new BTree<Uint8Array, true>(undefined, compareBytesLexicographically);
    const semantic = new BTree<Uint8Array, true>(undefined, compareBytesLexicographically);
    const schemaChanges = new Map<string, { before?: CoreSchemaDefinition; after?: CoreSchemaDefinition; namespace: CoreTableDefinition["namespace"] }>();
    for (const change of changes) {
      const tableCatalog = registry.table(TABLES);
      if (tableCatalog !== undefined && bytesEqual(change.table.tabletId, tableCatalog.definition.tabletId)) {
        const before = yield* semanticTableDocument(change.originalDocument), after = yield* semanticTableDocument(change.finalDocument);
        if (before === null || after === null || !bytesEqual(before, after)) {
          semantic.set(yield* Result.mapError(encodeIndexValue(encodeBytesToLowercaseHex(change.id)),
            cause => new CoreTransactionError({ reason: "invalidValue", cause })), true);
        }
      }
      if (change.table.name === SCHEMAS) {
        const key = JSON.stringify(change.table.namespace);
        const selected = schemaChanges.get(key) ?? { namespace: change.table.namespace };
        for (const [position, document] of [change.originalDocument, change.finalDocument].entries()) {
          if (document === null) continue;
          const metadata = yield* Result.mapError(decodeCoreSchemaMetadata(document), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
          if (metadata.state.state !== "active") continue;
          const schema = yield* Result.mapError(parseCoreSchema(metadata.schema), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
          if (position === 0) selected.before = schema;
          else selected.after = schema;
        }
        schemaChanges.set(key, selected);
      }
      const catalog = registry.table(INDEXES);
      if (catalog === undefined || encodeBytesToLowercaseHex(change.table.tabletId) !== encodeBytesToLowercaseHex(catalog.definition.tabletId)) continue;
      for (const document of [change.originalDocument, change.finalDocument]) {
        if (document === null) continue;
        const metadata = yield* Result.mapError(decodeCoreIndexMetadata(document), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
        const key = yield* Result.mapError(encodeIndexValue(metadata.table_id), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
        keys.set(key, true);
      }
    }
    for (const selected of schemaChanges.values()) {
      const names = new Set([...(selected.before?.tables ?? []), ...(selected.after?.tables ?? [])].map(table => table.tableName));
      for (const name of names) {
        const before = selected.before?.tables.find(table => table.tableName === name), after = selected.after?.tables.find(table => table.tableName === name);
        const table = registry.table(name, selected.namespace)?.definition;
        if (table === undefined) continue;
        // Source schema definitions are already canonical captured data. Their
        // semantic encoding preserves validators/index declarations without the
        // unrelated bundle/source metadata or active schema document identity.
        const left = before === undefined ? undefined : yield* Result.mapError(serializeCoreSchema({ tables: [before],
          schemaValidation: selected.before?.schemaValidation ?? true }), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
        const right = after === undefined ? undefined : yield* Result.mapError(serializeCoreSchema({ tables: [after],
          schemaValidation: selected.after?.schemaValidation ?? true }), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
        if (left !== right) semantic.set(yield* Result.mapError(encodeIndexValue(encodeBytesToLowercaseHex(table.tabletId)),
          cause => new CoreTransactionError({ reason: "invalidValue", cause })), true);
      }
    }
    const result: CoreIndexKeys[] = [];
    if (keys.size > 0) result.push({ indexId: yield* virtualIndexIdentity(registry), keys: Object.freeze([...keys.keys()]) });
    if (semantic.size > 0) result.push({ indexId: yield* semanticTableIndex(registry), keys: Object.freeze([...semantic.keys()]) });
    return Object.freeze(result);
  });
}

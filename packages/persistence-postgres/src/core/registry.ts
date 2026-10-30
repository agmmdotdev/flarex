/**
 * Mechanisms translated from Convex crates/database/src/database.rs, crates/indexing/src/index_registry.rs,
 * crates/common/src/bootstrap_model/schema_metadata.rs and crates/model/src/modules/module_versions.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Result, Schema } from "effect";
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import { SchemaManifestAppIdentifierSchema } from "flarex-protocol/schema-manifest";


import { CoreProgramIdentitySchema, CoreTransactionError, type CoreProgramDefinition, type CoreProgramIdentity, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreIndexPage, type CorePersistenceSnapshot } from "./contracts";
import { captureCoreDocument, captureCoreObject } from "./document";
import { CoreTableNamespaceSchema, coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import { CoreIndexRegistry } from "./indexRegistry";
import { parseCoreIndexRecord, type CoreIndexRecord } from "./indexState";
import { CoreSchemaRegistry } from "./schemaRegistry";
import type { CoreSystemDocument } from "./transaction";

export const TABLES = "_tables";
export const INDEXES = "_index";
export const PROGRAMS = "_programs";
export const REQUESTS = "_session_requests";

import { SCHEMAS, SCHEMA_VALIDATIONS, SCHEMA_VALIDATION_PROGRESS } from "./schemaTypes";
export { SCHEMAS, SCHEMA_VALIDATIONS, SCHEMA_VALIDATION_PROGRESS } from "./schemaTypes";
export const INDEX_BACKFILLS = "_index_backfills";
export const DATABASE_GLOBALS = "_db";
export const CORE_BUILTIN_TABLE_NUMBERS = new Map([
  [TABLES, 513], [INDEXES, 514], [SCHEMAS, 532], [INDEX_BACKFILLS, 548],
  [DATABASE_GLOBALS, 520], [SCHEMA_VALIDATIONS, 555], [SCHEMA_VALIDATION_PROGRESS, 549],
  [PROGRAMS, 9999], [REQUESTS, 9998],
]);
const TableName = SchemaManifestAppIdentifierSchema;
const StoredTableSchema = Schema.Struct({ name: TableName, number: Schema.BigInt.check(Schema.makeFilter(value =>
  value > 0n && value <= 0xffff_ffffn ? undefined : "Expected a table number")),
  state: Schema.Literals(["active", "hidden", "deleting"]), namespace: Schema.optionalKey(CoreTableNamespaceSchema),
});
const StoredProgramSchema = Schema.Struct({ kind: Schema.Literal("revision"), identity: CoreProgramIdentitySchema, metadata: Schema.String });
const StoredHeadSchema = Schema.Struct({ kind: Schema.Literal("head"), identity: CoreProgramIdentitySchema });
const StoredAuthoritySchema = Schema.Struct({ kind: Schema.Literal("authority"), epoch: Schema.BigInt });
const decodeStoredTable = Schema.decodeUnknownResult(StoredTableSchema);
const decodeStoredProgram = Schema.decodeUnknownResult(StoredProgramSchema);
const decodeStoredHead = Schema.decodeUnknownResult(StoredHeadSchema);
const decodeStoredAuthority = Schema.decodeUnknownResult(StoredAuthoritySchema);
const utf8 = new TextEncoder();

export function tableDocument(table: CoreTableDefinition): DocumentObject {
  return { name: table.name, number: BigInt(table.number), state: table.state,
    ...(table.namespace === null ? {} : { namespace: table.namespace }) };
}
export function coreQualifiedTableKey(namespace: CoreTableNamespace, name: string): string {
  return JSON.stringify([coreNamespaceKey(namespace), name]);
}
function qualifiedNumber(namespace: CoreTableNamespace, number: number): string {
  return JSON.stringify([coreNamespaceKey(namespace), number]);
}
export function programKey(identity: CoreProgramIdentity): string {
  return JSON.stringify([identity.functionPath, identity.programHash, identity.schemaHash]);
}

export interface CoreTableRecord { readonly definition: CoreTableDefinition; readonly id: Uint8Array; readonly ts: bigint | null }
export interface CoreProgramRecord { readonly definition: CoreProgramDefinition; readonly id: Uint8Array; readonly ts: bigint | null }
export interface CoreProgramHead { readonly identity: CoreProgramIdentity; readonly id: Uint8Array; readonly ts: bigint | null }
export interface CoreAuthorityRecord { readonly epoch: bigint; readonly id: Uint8Array; readonly ts: bigint | null }

export type CoreTableRecords = Pick<BTree<string, CoreTableRecord>, "get" | "has" | "values" | "entries" | "keys" | "size">;
interface CoreRegistryTableLookups {
  readonly byNumber: BTree<string, CoreTableRecord>;
  readonly byTablet: BTree<string, CoreTableRecord>;
}
function tableLookups(tables: CoreTableRecords): CoreRegistryTableLookups {
  return { byNumber: new BTree([...tables.values()].filter(record => record.definition.state === "active")
      .map(record => [qualifiedNumber(record.definition.namespace, record.definition.number), record])),
    byTablet: new BTree([...tables.values()].map(record => [encodeBytesToLowercaseHex(record.definition.tabletId), record])) };
}
function tableStorageKey(table: CoreTableDefinition): string {
  return table.state === "active" ? coreQualifiedTableKey(table.namespace, table.name)
    : `tablet:${encodeBytesToLowercaseHex(table.tabletId)}`;
}
/** Published immutable metadata view. Full index state is independent from enabled read selection. */
export class CoreRegistry {
  private readonly lookups: CoreRegistryTableLookups;
  readonly tables: CoreTableRecords;
  private readonly tableRoot: BTree<string, CoreTableRecord>;
  constructor(tables: CoreTableRecords,
    readonly programs: ReadonlyMap<string, CoreProgramRecord> = new Map(),
    readonly heads: ReadonlyMap<string, CoreProgramHead> = new Map(),
    readonly authority?: CoreAuthorityRecord,
    readonly indexes: CoreIndexRegistry = CoreIndexRegistry.empty(),
    readonly schemas: CoreSchemaRegistry = CoreSchemaRegistry.empty(),
    captured?: Readonly<{ tables: BTree<string, CoreTableRecord>; lookups: CoreRegistryTableLookups }>) {
    this.tableRoot = captured?.tables ?? new BTree([...tables.values()].map(record => {
      const enabled = indexes.forTablet(record.definition.tabletId).filter(index => index.state.type === "Enabled")
        .map(index => Object.freeze({ name: index.name, ref: index.ref, fields: index.fields }));
      const selected = { ...record, definition: Object.freeze({ ...record.definition, indexes: Object.freeze(enabled) }) };
      return [tableStorageKey(selected.definition), selected];
    }));
    this.tables = this.tableRoot;
    this.lookups = captured?.lookups ?? tableLookups(this.tables);
  }
  table(name: string, namespace: CoreTableNamespace = null): CoreTableRecord | undefined {
    return this.tables.get(coreQualifiedTableKey(namespace, name));
  }
  tableByNumber(number: number, namespace: CoreTableNamespace = null): CoreTableRecord | undefined {
    return this.lookups.byNumber.get(qualifiedNumber(namespace, number));
  }
  tableByTablet(id: Uint8Array): CoreTableRecord | undefined { return this.lookups.byTablet.get(encodeBytesToLowercaseHex(id)); }
  indexById(id: Uint8Array): Readonly<{ table: CoreTableDefinition; index: CoreIndexRecord }> | undefined {
    const index = this.indexes.byId(id);
    const table = index === undefined ? undefined : this.tableByTablet(index.tableId)?.definition;
    return index === undefined || table === undefined ? undefined : { table, index };
  }
  indexesForTablet(id: Uint8Array): readonly CoreIndexRecord[] { return this.indexes.forTablet(id); }
  program(identity: CoreProgramIdentity): CoreProgramRecord | undefined { return this.programs.get(programKey(identity)); }
  head(path: string): CoreProgramHead | undefined { return this.heads.get(path); }
  private replaceTableRoot(tables: BTree<string, CoreTableRecord>, lookups: CoreRegistryTableLookups,
    indexes = this.indexes): CoreRegistry {
    return new CoreRegistry(tables, this.programs, this.heads, this.authority, indexes, this.schemas, { tables, lookups });
  }
  withTable(record: CoreTableRecord): CoreRegistry {
    const tables = this.tableRoot.clone(), byNumber = this.lookups.byNumber.clone(), byTablet = this.lookups.byTablet.clone();
    const previous = this.tableByTablet(record.id);
    if (previous !== undefined) {
      tables.delete(tableStorageKey(previous.definition));
      if (previous.definition.state === "active") byNumber.delete(qualifiedNumber(previous.definition.namespace, previous.definition.number));
    }
    const definition = Object.freeze({ ...record.definition, indexes: Object.freeze(this.indexes.forTablet(record.definition.tabletId)
      .filter(index => index.state.type === "Enabled").map(index => ({ name: index.name, fields: index.fields, ref: index.ref }))) });
    const selected = { ...record, definition };
    tables.set(tableStorageKey(definition), selected); byTablet.set(encodeBytesToLowercaseHex(record.id), selected);
    if (definition.state === "active") byNumber.set(qualifiedNumber(definition.namespace, definition.number), selected);
    return this.replaceTableRoot(tables, { byNumber, byTablet });
  }
  withoutTable(id: Uint8Array): CoreRegistry {
    const previous = this.tableByTablet(id);
    if (previous === undefined) return this;
    const tables = this.tableRoot.clone(), byNumber = this.lookups.byNumber.clone(), byTablet = this.lookups.byTablet.clone();
    tables.delete(tableStorageKey(previous.definition)); byTablet.delete(encodeBytesToLowercaseHex(id));
    if (previous.definition.state === "active") byNumber.delete(qualifiedNumber(previous.definition.namespace, previous.definition.number));
    return this.replaceTableRoot(tables, { byNumber, byTablet });
  }
  withIndexes(indexes: CoreIndexRegistry): CoreRegistry {
    let registry = this.replaceTableRoot(this.tableRoot, this.lookups, indexes);
    for (const tablet of indexes.changedTabletsFrom(this.indexes)) {
      const record = registry.tableByTablet(tablet);
      if (record !== undefined) registry = registry.withTable(record);
    }
    return registry;
  }
  withIndex(record: CoreIndexRecord): Result.Result<CoreRegistry, CorePersistenceError> {
    const target = this.tableByTablet(record.tableId)?.definition;
    if (target?.namespace === null && target.name === INDEXES && record.name !== "by_id")
      return Result.fail(corrupt("The global index metadata table supports only by_id"));
    return Result.map(this.indexes.apply({ removed: [], added: [record] }), indexes => this.withIndexes(indexes));
  }
  withoutIndex(id: Uint8Array): CoreRegistry { return this.withIndexes(this.indexes.without(id)); }
  withSchemas(schemas: CoreSchemaRegistry): CoreRegistry {
    return new CoreRegistry(this.tables, this.programs, this.heads, this.authority, this.indexes, schemas, { tables: this.tableRoot, lookups: this.lookups });
  }
  withProgram(record: CoreProgramRecord): CoreRegistry {
    const programs = new Map(this.programs); programs.set(programKey(record.definition.identity), record);
    return new CoreRegistry(this.tables, programs, this.heads, this.authority, this.indexes, this.schemas, { tables: this.tableRoot, lookups: this.lookups });
  }
  withHead(record: CoreProgramHead): CoreRegistry {
    const heads = new Map(this.heads); heads.set(record.identity.functionPath, record);
    return new CoreRegistry(this.tables, this.programs, heads, this.authority, this.indexes, this.schemas, { tables: this.tableRoot, lookups: this.lookups });
  }
  withAuthority(authority: CoreAuthorityRecord): CoreRegistry {
    return new CoreRegistry(this.tables, this.programs, this.heads, authority, this.indexes, this.schemas, { tables: this.tableRoot, lookups: this.lookups });
  }
}
export function initialRegistry(definitions: readonly CoreTableDefinition[]): Result.Result<CoreRegistry, CorePersistenceError> {
  const records: CoreIndexRecord[] = definitions.flatMap(table => table.indexes.map(index => ({
    ...index, tableId: table.tabletId, state: { type: "Enabled" as const }, ts: 0n })));
  return Result.map(CoreIndexRegistry.empty().apply({ removed: [], added: records }), indexes =>
    new CoreRegistry(new Map(definitions.map(definition => [tableStorageKey(definition), {
      definition, id: definition.tabletId.slice(), ts: 0n }])), new Map(), new Map(), undefined, indexes));
}

function corrupt(cause?: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
}

export const parseCoreTableRecord = (document: CoreSystemDocument, ts: bigint | null)
  : Result.Result<CoreTableRecord, CorePersistenceError> => Result.gen(function* () {
    const metadata = yield* Result.mapError(decodeStoredTable(document.value), corrupt);
    const id = yield* Result.mapError(decodeDocumentId(document.id), corrupt);
    return { id: id.internalId.slice(), ts, definition: Object.freeze({ name: metadata.name, number: Number(metadata.number),
      state: metadata.state, namespace: metadata.namespace ?? null, tabletId: id.internalId.slice(), indexes: Object.freeze([]) }) };
  });
export interface CoreRegistryDecoders {
  readonly table: typeof parseCoreTableRecord;
  readonly index: (document: CoreSystemDocument, ts: bigint | null, registry: CoreRegistry) => Result.Result<CoreIndexRecord, CorePersistenceError>;
}
export const readDocumentObject = (entry: CoreDocumentLogEntry,
  expected?: Pick<CoreTableDefinition, "number" | "tabletId">): Result.Result<DocumentObject, CorePersistenceError> =>
  Result.gen(function* () {
    const value = yield* Result.mapError(decodeDocumentValue(entry.jsonValue), corrupt);
    const document = (yield* Result.mapError(captureCoreDocument(value, true), corrupt)).value;
    const id = yield* Result.mapError(decodeDocumentId(document._id), corrupt);
    if (!bytesEqual(id.internalId, entry.id) || (expected !== undefined
      && (id.tableNumber !== expected.number || !bytesEqual(entry.tableId, expected.tabletId))))
      return yield* Result.fail(corrupt());
    return document;
  });

/** Bootstrap discovery reads only trusted built-in by-ID indexes at this snapshot. */
export const loadCoreRegistry = Effect.fn("CoreRegistry.load")(function* (
  snapshot: CorePersistenceSnapshot, bootstrap: CoreRegistry, observe?: (entry: CoreDocumentLogEntry) => void,
  decoders: CoreRegistryDecoders = { table: parseCoreTableRecord, index: parseCoreIndexRecord },
) {
  // Bootstrap identities discover the catalogs; only rows present at S enter the loaded roots.
  let registry = new CoreRegistry(new Map());
  let foundTables = 0;
  for (const name of [TABLES, INDEXES, PROGRAMS]) {
    const builtin = (name === TABLES || name === INDEXES ? bootstrap : registry).table(name);
    const byId = builtin?.definition.indexes.find(index => index.name === "by_id");
    if (builtin === undefined || byId === undefined) return yield* Effect.fail(corrupt());
    let start: Uint8Array | null = null;
    while (true) {
      const page: CoreIndexPage = yield* snapshot.scan({ index: byId.ref, tableId: builtin.definition.tabletId,
        interval: { start, end: null }, order: "asc", maxResults: 128 });
      for (const entry of page.entries) {
        observe?.(entry.document);
        const document = yield* Effect.fromResult(readDocumentObject(entry.document, builtin.definition));
        if (name === TABLES) {
          const record = yield* Effect.fromResult(decoders.table({ id: String(document._id), creationTime: Number(document._creationTime), value: document }, entry.document.ts));
          const definition = record.definition;
          if (!bytesEqual(definition.tabletId, entry.document.id)) return yield* Effect.fail(corrupt());
          const existingName = definition.state === "active" ? registry.table(definition.name, definition.namespace) : undefined;
          if (existingName !== undefined && !bytesEqual(existingName.id, entry.document.id)) return yield* Effect.fail(corrupt());
          const existingNumber = definition.state === "active" ? registry.tableByNumber(definition.number, definition.namespace) : undefined;
          if (existingNumber !== undefined && existingNumber.definition.name !== definition.name) return yield* Effect.fail(corrupt());
          registry = registry.withTable(record); foundTables += 1;
        } else if (name === INDEXES) {
          const record = yield* Effect.fromResult(decoders.index({ id: String(document._id), creationTime: Number(document._creationTime), value: document }, entry.document.ts, registry));
          if (registry.tableByTablet(record.tableId) === undefined) return yield* Effect.fail(corrupt());
          registry = yield* Effect.fromResult(registry.withIndex(record));
        } else if (document.kind === "revision") {
          const stored = yield* Effect.fromResult(Result.mapError(decodeStoredProgram(document), corrupt));
          if (registry.program(stored.identity) !== undefined) return yield* Effect.fail(corrupt());
          const unpacked = yield* Effect.fromResult(Result.mapError(decodeDocumentValue(utf8.encode(stored.metadata)), corrupt));
          const metadata = (yield* Effect.fromResult(Result.mapError(captureCoreObject(unpacked, true), corrupt))).value;
          registry = registry.withProgram({ definition: { identity: stored.identity, metadata },
            id: entry.document.id.slice(), ts: entry.document.ts });
        } else if (document.kind === "head") {
          const stored = yield* Effect.fromResult(Result.mapError(decodeStoredHead(document), corrupt));
          if (registry.head(stored.identity.functionPath) !== undefined) return yield* Effect.fail(corrupt());
          registry = registry.withHead({ identity: stored.identity, id: entry.document.id.slice(), ts: entry.document.ts });
        } else {
          const stored = yield* Effect.fromResult(Result.mapError(decodeStoredAuthority(document), corrupt));
          if (registry.authority !== undefined) return yield* Effect.fail(corrupt());
          if (stored.epoch < 0n || stored.epoch > 0x7fff_ffff_ffff_ffffn) return yield* Effect.fail(corrupt());
          registry = registry.withAuthority({ epoch: stored.epoch, id: entry.document.id.slice(), ts: entry.document.ts });
        }
      }
      if (page.cursor.kind === "end") break;
      // Exclusive cursor, represented as the next inclusive byte position.
      start = new Uint8Array(page.cursor.key.length + 1);
      start.set(page.cursor.key);
    }
  }
  if (foundTables < 2 || registry.authority === undefined) return yield* Effect.fail(corrupt());
  for (const name of [TABLES, INDEXES]) {
    const expected = bootstrap.table(name)?.definition, loaded = registry.table(name)?.definition;
    if (expected === undefined || loaded === undefined || expected.number !== loaded.number
      || !bytesEqual(expected.tabletId, loaded.tabletId)) return yield* Effect.fail(corrupt("Missing bootstrap catalog identity"));
  }
  for (const table of registry.tables.values()) {
    if (!table.definition.indexes.some(index => index.name === "by_id")) return yield* Effect.fail(corrupt());
  }
  let schemas = CoreSchemaRegistry.empty();
  for (const record of registry.tables.values()) {
    if (record.definition.name !== SCHEMAS || record.definition.state !== "active") continue;
    const byId = record.definition.indexes.find(index => index.name === "by_id");
    if (byId === undefined) return yield* Effect.fail(corrupt());
    let start: Uint8Array | null = null;
    while (true) {
      const page: CoreIndexPage = yield* snapshot.scan({ index: byId.ref, tableId: record.definition.tabletId, interval: { start, end: null }, order: "asc", maxResults: 128 });
      for (const entry of page.entries) {
        observe?.(entry.document);
        const document = yield* Effect.fromResult(readDocumentObject(entry.document, record.definition));
        const { _id, _creationTime, ...value } = document;
        if (typeof _id !== "string" || typeof _creationTime !== "number") return yield* Effect.fail(corrupt());
        schemas = yield* Effect.fromResult(schemas.withDocument(record.definition.namespace, undefined, { id: _id, creationTime: _creationTime, value }));
      }
      if (page.cursor.kind === "end") break;
      start = new Uint8Array(page.cursor.key.length + 1); start.set(page.cursor.key);
    }
  }
  return registry.withSchemas(schemas);
});

export function publicDocumentId(table: CoreTableDefinition, internalId: Uint8Array): Result.Result<string, CoreTransactionError> {
  return Result.mapError(encodeDocumentId(table.number, internalId), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause }));
}

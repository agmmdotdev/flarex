/**
 * Mechanisms translated from Convex crates/database/src/database.rs, crates/indexing/src/index_registry.rs,
 * crates/common/src/bootstrap_model/schema_metadata.rs and crates/model/src/modules/module_versions.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Result, Schema } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { decodeDocumentId, encodeDocumentId } from "flarex-protocol/document-id";
import { ValidatorJsonV1, validatorJsonAdmissionIssueV1 } from "flarex-protocol/validator-json";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { CoreProgramIdentitySchema, CoreTransactionError, type CoreIndexDefinition, type CoreProgramDefinition, type CoreProgramIdentity, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreIndexPage, type CorePersistenceSnapshot } from "./contracts";
import { captureCoreDocument, captureCoreObject } from "./document";

export const TABLES = "_tables";
export const INDEXES = "_index";
export const PROGRAMS = "_programs";
export const REQUESTS = "_session_requests";

export const CORE_BUILTIN_TABLE_NUMBERS = new Map([
  [TABLES, 513], [INDEXES, 514], [PROGRAMS, 9999], [REQUESTS, 9998],
]);

const BytesHex = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{32}$/.test(value)
  ? undefined : "Expected a 16-byte canonical hex identity"));
const StoredIndexSchema = Schema.Struct({ name: Schema.String, id: BytesHex,
  persistenceIndexId: Schema.optional(Schema.BigInt), fields: Schema.Array(Schema.String), enabled: Schema.Boolean });
const TableFields = { name: Schema.String, number: Schema.Int, tabletId: BytesHex };
const StoredTableSchema = Schema.Struct({ ...TableFields, validator: Schema.String });
const FullTableDefinitionSchema = Schema.Struct({ ...TableFields, indexes: Schema.Array(StoredIndexSchema) });
const IndexMetadataSchema = Schema.Struct({ name: Schema.String, tableNumber: Schema.Int, fields: Schema.Array(Schema.String),
  enabled: Schema.Boolean, persistenceIndexId: Schema.optional(Schema.BigInt) });
const StoredProgramSchema = Schema.Struct({ kind: Schema.Literal("revision"), identity: CoreProgramIdentitySchema, metadata: Schema.String });
const StoredHeadSchema = Schema.Struct({ kind: Schema.Literal("head"), identity: CoreProgramIdentitySchema });
const StoredAuthoritySchema = Schema.Struct({ kind: Schema.Literal("authority"), epoch: Schema.BigInt });
const decodeStoredTable = Schema.decodeUnknownResult(StoredTableSchema);
const decodeFullTableDefinition = Schema.decodeUnknownResult(FullTableDefinitionSchema);
const decodeIndexMetadata = Schema.decodeUnknownResult(IndexMetadataSchema);
const decodeStoredProgram = Schema.decodeUnknownResult(StoredProgramSchema);
const decodeStoredHead = Schema.decodeUnknownResult(StoredHeadSchema);
const decodeStoredAuthority = Schema.decodeUnknownResult(StoredAuthoritySchema);
const decodeValidator = Schema.decodeUnknownResult(ValidatorJsonV1);
const utf8 = new TextEncoder();

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export function tableDocument(table: CoreTableDefinition): DocumentObject {
  const validator = encodeCanonicalJson(table.validator, issue => {
    throw new Error(`Validated table validator lost its canonical JSON contract: ${issue.reason}`);
  });
  return { name: table.name, number: table.number, tabletId: encodeBytesToLowercaseHex(table.tabletId), validator };
}

/** Ephemeral physical comparison value; index specifications are persisted only in _index. */
export function tableDefinitionValue(table: CoreTableDefinition): DocumentObject {
  return { ...tableDocument(table), indexes: table.indexes.toSorted((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(index => ({ name: index.name,
      id: encodeBytesToLowercaseHex(index.ref.id), fields: [...index.fields], enabled: index.enabled,
      ...(index.ref.persistenceIndexId === undefined ? {} : { persistenceIndexId: index.ref.persistenceIndexId }) })) };
}

export function programKey(identity: CoreProgramIdentity): string {
  return JSON.stringify([identity.functionPath, identity.programHash, identity.schemaHash]);
}

export interface CoreTableRecord { readonly definition: CoreTableDefinition; readonly id: Uint8Array; readonly ts: bigint | null }
export interface CoreProgramRecord { readonly definition: CoreProgramDefinition; readonly id: Uint8Array; readonly ts: bigint | null }
export interface CoreProgramHead { readonly identity: CoreProgramIdentity; readonly id: Uint8Array; readonly ts: bigint | null }
export interface CoreAuthorityRecord { readonly epoch: bigint; readonly id: Uint8Array; readonly ts: bigint | null }

interface CoreRegistryTableLookups {
  readonly byNumber: ReadonlyMap<number, CoreTableRecord>;
  readonly byTablet: ReadonlyMap<string, CoreTableRecord>;
  readonly byIndex: ReadonlyMap<string, Readonly<{ table: CoreTableDefinition; index: CoreIndexDefinition }>>;
}

function tableLookups(tables: ReadonlyMap<string, CoreTableRecord>): CoreRegistryTableLookups {
  return Object.freeze({
    byNumber: new Map([...tables.values()].map(record => [record.definition.number, record])),
    byTablet: new Map([...tables.values()].map(record => [encodeBytesToLowercaseHex(record.definition.tabletId), record])),
    byIndex: new Map([...tables.values()].flatMap(record => record.definition.indexes.map(index =>
      [encodeBytesToLowercaseHex(index.ref.id), { table: record.definition, index }] as const))),
  });
}

/** Published immutable metadata view. Mutations create a replacement, never edit an admitted view. */
export class CoreRegistry {
  constructor(
    readonly tables: ReadonlyMap<string, CoreTableRecord>,
    readonly programs: ReadonlyMap<string, CoreProgramRecord> = new Map(),
    readonly heads: ReadonlyMap<string, CoreProgramHead> = new Map(),
    readonly authority?: CoreAuthorityRecord,
    private readonly lookups: CoreRegistryTableLookups = tableLookups(tables),
  ) {}

  table(name: string): CoreTableRecord | undefined { return this.tables.get(name); }
  tableByNumber(number: number): CoreTableRecord | undefined {
    return this.lookups.byNumber.get(number);
  }
  tableByTablet(tabletId: Uint8Array): CoreTableRecord | undefined {
    return this.lookups.byTablet.get(encodeBytesToLowercaseHex(tabletId));
  }
  indexById(id: Uint8Array): Readonly<{ table: CoreTableDefinition; index: CoreIndexDefinition }> | undefined {
    return this.lookups.byIndex.get(encodeBytesToLowercaseHex(id));
  }
  program(identity: CoreProgramIdentity): CoreProgramRecord | undefined { return this.programs.get(programKey(identity)); }
  head(path: string): CoreProgramHead | undefined { return this.heads.get(path); }

  withTable(record: CoreTableRecord): CoreRegistry {
    const tables = new Map(this.tables);
    tables.set(record.definition.name, record);
    return new CoreRegistry(tables, this.programs, this.heads, this.authority);
  }
  withProgram(record: CoreProgramRecord): CoreRegistry {
    const programs = new Map(this.programs);
    programs.set(programKey(record.definition.identity), record);
    return new CoreRegistry(this.tables, programs, this.heads, this.authority, this.lookups);
  }
  withHead(record: CoreProgramHead): CoreRegistry {
    const heads = new Map(this.heads);
    heads.set(record.identity.functionPath, record);
    return new CoreRegistry(this.tables, this.programs, heads, this.authority, this.lookups);
  }
  withAuthority(authority: CoreAuthorityRecord): CoreRegistry {
    return new CoreRegistry(this.tables, this.programs, this.heads, authority, this.lookups);
  }
}

export function initialRegistry(definitions: readonly CoreTableDefinition[]): CoreRegistry {
  return new CoreRegistry(new Map(definitions.map(definition => [definition.name, {
    definition, id: definition.tabletId.slice(), ts: 0n,
  }])));
}

function corrupt(cause?: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
}

export const decodeTableDocument = (document: DocumentObject): Result.Result<CoreTableDefinition, CorePersistenceError> =>
  Result.gen(function* () {
    const table = yield* Result.mapError(decodeStoredTable(document), corrupt);
    if (table.number <= 0 || table.number > 0xffff_ffff) return yield* Result.fail(corrupt());
    const parsed = yield* Result.try({ try: (): unknown => JSON.parse(table.validator), catch: (cause: unknown) => {
      if (cause instanceof SyntaxError) return corrupt(cause);
      throw cause;
    } });
    const issue = validatorJsonAdmissionIssueV1(parsed);
    if (issue !== undefined) return yield* Result.fail(corrupt(issue));
    const validator = yield* Result.mapError(decodeValidator(parsed), corrupt);
    return Object.freeze({ name: table.name, number: table.number, tabletId: fromHex(table.tabletId), validator,
      indexes: Object.freeze([]) });
  });

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
) {
  let registry = bootstrap;
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
          const definition = yield* Effect.fromResult(decodeTableDocument(document));
          if (!bytesEqual(definition.tabletId, entry.document.id)) return yield* Effect.fail(corrupt());
          const existingName = registry.table(definition.name);
          if (existingName !== undefined && !bytesEqual(existingName.id, entry.document.id)) return yield* Effect.fail(corrupt());
          const existingNumber = registry.tableByNumber(definition.number);
          if (existingNumber !== undefined && existingNumber.definition.name !== definition.name) return yield* Effect.fail(corrupt());
          registry = registry.withTable({ definition, id: entry.document.id.slice(), ts: entry.document.ts });
          foundTables += 1;
        } else if (name === INDEXES) {
          const metadata = yield* Effect.fromResult(Result.mapError(decodeIndexMetadata(document), corrupt));
          const target = registry.tableByNumber(metadata.tableNumber);
          if (target === undefined || target.definition.indexes.some(index => index.name === metadata.name))
            return yield* Effect.fail(corrupt());
          registry = registry.withTable({ ...target, definition: { ...target.definition, indexes: Object.freeze([
            ...target.definition.indexes, Object.freeze({ name: metadata.name, fields: metadata.fields, enabled: metadata.enabled,
              ref: Object.freeze({ id: entry.document.id.slice(), ...(metadata.persistenceIndexId === undefined ? {} : { persistenceIndexId: metadata.persistenceIndexId }) }) }),
          ]) } });
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
  if (foundTables < CORE_BUILTIN_TABLE_NUMBERS.size || registry.authority === undefined) return yield* Effect.fail(corrupt());
  for (const table of registry.tables.values()) {
    if (!table.definition.indexes.some(index => index.name === "by_id" && index.enabled)) return yield* Effect.fail(corrupt());
  }
  return registry;
});

export function publicDocumentId(table: CoreTableDefinition, internalId: Uint8Array): Result.Result<string, CoreTransactionError> {
  return Result.mapError(encodeDocumentId(table.number, internalId), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause }));
}

export const validateTableDefinition = (table: CoreTableDefinition): Result.Result<CoreTableDefinition, CoreTransactionError> =>
  Result.gen(function* () {
    const issue = validatorJsonAdmissionIssueV1(table.validator);
    if (issue !== undefined) return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue", cause: issue }));
    const validator = yield* Result.mapError(decodeValidator(table.validator), cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    const decoded = yield* Result.mapError(decodeFullTableDefinition(tableDefinitionValue({ ...table, validator })),
      cause => new CoreTransactionError({ reason: "invalidValue", cause }));
    if (decoded.number <= 0 || decoded.number > 0xffff_ffff) return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
    if (new Set(decoded.indexes.map(index => index.name)).size !== decoded.indexes.length)
      return yield* Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
    return Object.freeze({ name: decoded.name, number: decoded.number, tabletId: fromHex(decoded.tabletId), validator,
      indexes: Object.freeze(decoded.indexes.map(index => Object.freeze({ name: index.name,
        ref: Object.freeze({ id: fromHex(index.id), ...(index.persistenceIndexId === undefined ? {} : { persistenceIndexId: index.persistenceIndexId }) }),
        fields: Object.freeze([...index.fields]), enabled: index.enabled }))) });
  });

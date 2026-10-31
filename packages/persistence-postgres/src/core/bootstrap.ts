/** Convex database bootstrap, with the explicit c554 logical-format migration. */
import { Effect, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentValue, encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { CoreTransactionError, type CoreDatabaseOptions, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistence, type CorePersistenceLease, type CorePersistenceSnapshot } from "./contracts";
import { CORE_BUILTIN_TABLE_NUMBERS, DATABASE_GLOBALS, INDEXES, INDEX_BACKFILLS, PROGRAMS, REQUESTS, SCHEMAS,
  SCHEMA_VALIDATIONS, SCHEMA_VALIDATION_PROGRESS, TABLES, initialRegistry, loadCoreRegistry, readDocumentObject, tableDocument, type CoreRegistry } from "./registry";
import { CoreFinalizationVault, createCoreTransaction, deriveCoreWriteBatch } from "./transaction";
import { makeCoreLeaderRetention } from "./retention";
import { CoreResidentIndexes } from "./residentIndex";
import { coreIndexMetadataValue, decodeCoreIndexMetadata } from "./indexState";
import { LEGACY_CORE_REGISTRY_DECODERS, decodeLegacyTable } from "./legacySchema";
import { captureCoreSchema } from "./schemaTypes";
import { serializeCoreSchema } from "./schemaJson";
import type { CoreTableNamespace } from "./namespace";
import { authenticateCoreNativeRegistry } from "./nativePolicy";

export const CORE_LOGICAL_DATABASE_VERSION = 1n;
export const CORE_SCHEMA_CUTOVER_GLOBAL = "flarex_schema_lifecycle_cutover_ts";
const HexId = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{32}$/.test(value) ? undefined : "Expected a canonical internal ID"));
const decodeHexId = Schema.decodeUnknownResult(HexId);
const LegacyBootstrapIndex = Schema.Struct({ name: Schema.Literal("by_id"), tableNumber: Schema.Int,
  enabled: Schema.Literal(true), fields: Schema.Array(Schema.String), persistenceIndexId: Schema.optionalKey(Schema.BigInt) });
const corrupt = (cause?: unknown) => new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });

export function allocateInternalId(effect: Effect.Effect<Uint8Array>): Effect.Effect<Uint8Array, CoreTransactionError> {
  return Effect.flatMap(effect, value => value instanceof Uint8Array && value.byteLength === 16
    ? Effect.succeed(value.slice()) : Effect.fail(new CoreTransactionError({ reason: "invalidDocumentId" })));
}
const anchor = Effect.fn("CoreBootstrap.anchor")(function* (persistence: CorePersistence, key: string) {
  const stored = yield* persistence.getGlobal(key);
  if (Option.isNone(stored)) return yield* corrupt();
  const value = yield* Effect.fromResult(Result.mapError(decodeDocumentValue(stored.value), corrupt));
  const hex = yield* Effect.fromResult(Result.mapError(decodeHexId(value), corrupt));
  return Uint8Array.from(hex.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
});
const putValue = Effect.fn("CoreBootstrap.putValue")(function* (persistence: CorePersistence, lease: CorePersistenceLease, key: string, value: import("flarex-protocol/document-value").DocumentValue) {
  yield* persistence.putGlobal(lease, key, yield* Effect.fromResult(Result.mapError(encodeDocumentValue(value), corrupt)));
});

/** One explicit decoder version selected from the table catalog's owning metadata. */
export const loadBootstrapRegistry = Effect.fn("CoreBootstrap.loadAnchors")(function* (
  persistence: CorePersistence, snapshot: CorePersistenceSnapshot, legacy = false,
) {
  const tablesId = yield* anchor(persistence, "tables_table_id");
  const indexesId = yield* anchor(persistence, "index_table_id");
  const tablesById = yield* anchor(persistence, "tables_by_id");
  const indexesById = yield* anchor(persistence, "index_by_id");
  const definitions: CoreTableDefinition[] = [];
  for (const [name, tabletId, indexId, number] of [[TABLES, tablesId, tablesById, 513], [INDEXES, indexesId, indexesById, 514]] as const) {
    const entry = yield* snapshot.get(indexesId, indexId);
    if (Option.isNone(entry) || entry.value.deleted) return yield* corrupt();
    const document = yield* Effect.fromResult(readDocumentObject(entry.value, { number: 514, tabletId: indexesId }));
    let persistenceIndexId: bigint | undefined;
    if (legacy) {
      const index = yield* Effect.fromResult(Result.mapError(Schema.decodeUnknownResult(LegacyBootstrapIndex)(document), corrupt));
      if (index.tableNumber !== number || index.fields.length !== 0) return yield* corrupt();
      persistenceIndexId = index.persistenceIndexId;
    } else {
      const index = yield* Effect.fromResult(Result.mapError(decodeCoreIndexMetadata(document), corrupt));
      if (index.table_id !== encodeBytesToLowercaseHex(tabletId) || index.descriptor !== "by_id"
        || index.config.fields.length !== 0 || index.config.onDiskState.type !== "Enabled") return yield* corrupt();
      persistenceIndexId = index.config.persistenceIndexId;
    }
    definitions.push({ name, number, tabletId, namespace: null, state: "active", indexes: [{
      name: "by_id", ref: { id: indexId, ...(persistenceIndexId === undefined ? {} : { persistenceIndexId }) }, fields: [],
    }] });
  }
  return yield* Effect.fromResult(initialRegistry(definitions));
});

export const allocateCoreBuiltinDefinitions = Effect.fn("CoreBootstrap.allocateBuiltins")(function* (
  options: CoreDatabaseOptions, names: readonly string[], namespace: CoreTableNamespace = null, firstPersistenceIndexId?: bigint,
) {
  const definitions: CoreTableDefinition[] = [];
  let nextPersistenceIndexId = firstPersistenceIndexId;
  for (const name of names) {
    const number = CORE_BUILTIN_TABLE_NUMBERS.get(name);
    if (number === undefined) return yield* corrupt();
    const specs: Array<readonly [string, readonly string[]]> = [["by_id", []]];
    if (name !== INDEXES) specs.push(["by_creation_time", ["_creationTime"]]);
    if (name === REQUESTS) specs.push(["by_key", ["key"]]);
    if (name === SCHEMAS) specs.push(["by_state", ["state"]]);
    if (name === INDEX_BACKFILLS) specs.push(["by_index_id", ["indexId"]]);
    if (name === SCHEMA_VALIDATIONS) specs.push(["by_schema_id_and_table_name", ["schemaId", "tableName", "_creationTime"]]);
    if (name === SCHEMA_VALIDATION_PROGRESS) specs.push(["by_validation_id", ["validationId", "_creationTime"]]);
    if (name === PROGRAMS) specs.push(["by_head_path", ["kind", "identity.functionPath"]],
      ["by_identity", ["kind", "identity.functionPath", "identity.programHash", "identity.schemaHash"]]);
    const indexes: CoreIndexDefinition[] = [];
    for (const [indexName, fields] of specs) {
      indexes.push({ name: indexName, fields, ref: { id: yield* allocateInternalId(options.newInternalId),
        ...(nextPersistenceIndexId === undefined ? {} : { persistenceIndexId: nextPersistenceIndexId++ }) } });
    }
    definitions.push({ name, number, tabletId: yield* allocateInternalId(options.newInternalId), namespace, state: "active", indexes });
  }
  const ids = definitions.flatMap(table => [table.tabletId, ...table.indexes.map(index => index.ref.id)]).map(encodeBytesToLowercaseHex);
  if (new Set(ids).size !== ids.length) return yield* new CoreTransactionError({ reason: "invalidDocumentId" });
  return definitions;
});

function globalsBody(secretBytes: Uint8Array): DocumentObject {
  const bytes = secretBytes.slice();
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = encodeBytesToLowercaseHex(bytes);
  return { version: CORE_LOGICAL_DATABASE_VERSION, awsPrefixSecret: `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`, storageType: null };
}

export const initializeCorePersistence = Effect.fn("CoreBootstrap.initialize")(function* (
  persistence: CorePersistence, lease: CorePersistenceLease, options: CoreDatabaseOptions,
) {
  const definitions = yield* allocateCoreBuiltinDefinitions(options, [...CORE_BUILTIN_TABLE_NUMBERS.keys()], null, 1n);
  let registry = yield* Effect.fromResult(initialRegistry(definitions));
  const tables = registry.table(TABLES)?.definition;
  const indexes = registry.table(INDEXES)?.definition;
  const tablesById = tables?.indexes.find(index => index.name === "by_id");
  const indexesById = indexes?.indexes.find(index => index.name === "by_id");
  if (tables === undefined || indexes === undefined || tablesById === undefined || indexesById === undefined) return yield* corrupt();
  for (const [key, id] of [["tables_table_id", tables.tabletId], ["index_table_id", indexes.tabletId],
    ["tables_by_id", tablesById.ref.id], ["index_by_id", indexesById.ref.id]] as const) yield* putValue(persistence, lease, key, encodeBytesToLowercaseHex(id));
  const vault = new CoreFinalizationVault();
  const transaction = createCoreTransaction({ snapshot: yield* persistence.readSnapshot(0n), registry, now: yield* options.now,
    newInternalId: options.newInternalId, vault });
  for (const table of definitions) yield* transaction.writePrivate(TABLES, table.tabletId, tableDocument(table));
  for (const index of registry.indexes.records.values()) yield* transaction.writePrivate(INDEXES, index.ref.id, coreIndexMetadataValue(index));
  yield* transaction.runSystem(transaction.insertSystem(DATABASE_GLOBALS, globalsBody(yield* allocateInternalId(options.newInternalId))));
  const authorityId = yield* allocateInternalId(options.newInternalId);
  yield* transaction.writePrivate(PROGRAMS, authorityId, { kind: "authority", epoch: 0n });
  registry = transaction.registry.withAuthority({ id: authorityId, epoch: 0n, ts: 0n });
  transaction.setRegistryAfter(registry);
  const finalized = vault.take(yield* transaction.transaction.finalize());
  if (finalized === undefined) return yield* new CoreTransactionError({ reason: "foreignFinalization" });
  yield* persistence.write(lease, yield* Effect.fromResult(deriveCoreWriteBatch(finalized, 0n)));
  yield* putValue(persistence, lease, CORE_SCHEMA_CUTOVER_GLOBAL, 0n);
});

const migrateLegacy = Effect.fn("CoreBootstrap.migrateLegacy")(function* (
  persistence: CorePersistence, lease: CorePersistenceLease, options: CoreDatabaseOptions, timestamp: bigint,
  snapshot: CorePersistenceSnapshot, registry: CoreRegistry, revisions: readonly CoreDocumentLogEntry[],
) {
  const tables: unknown[] = [];
  const catalog = registry.table(TABLES)?.definition;
  if (catalog === undefined) return yield* corrupt();
  for (const record of registry.tables.values()) if (!record.definition.name.startsWith("_")) {
    const entry = revisions.find(candidate => encodeBytesToLowercaseHex(candidate.id) === encodeBytesToLowercaseHex(record.id)
      && encodeBytesToLowercaseHex(candidate.tableId) === encodeBytesToLowercaseHex(catalog.tabletId));
    if (entry === undefined) return yield* corrupt();
    const document = yield* Effect.fromResult(readDocumentObject(entry, catalog));
    const legacy = yield* Effect.fromResult(decodeLegacyTable({ id: String(document._id), creationTime: Number(document._creationTime), value: document }));
    const declared = registry.indexesForTablet(record.id).filter(index => !["by_id", "by_creation_time"].includes(index.name));
    tables.push({ tableName: record.definition.name, documentType: legacy.validator,
      indexes: declared.filter(index => index.state.type === "Enabled").map(index => ({ indexDescriptor: index.name, fields: index.fields })),
      // Old disabled catalog entries preserve visibility and maintenance, without inventing a source staged-schema declaration.
      stagedDbIndexes: [] });
  }
  const schema = yield* Effect.fromResult(captureCoreSchema({ tables, schemaValidation: true }));
  const definitions = yield* allocateCoreBuiltinDefinitions(options, [...CORE_BUILTIN_TABLE_NUMBERS.keys()].filter(name => registry.table(name) === undefined));
  for (const table of definitions) {
    registry = registry.withTable({ definition: table, id: table.tabletId, ts: null });
    for (const index of table.indexes) registry = yield* Effect.fromResult(registry.withIndex({ ...index, tableId: table.tabletId, state: { type: "Enabled" }, ts: null }));
  }
  const vault = new CoreFinalizationVault();
  const transaction = createCoreTransaction({ snapshot, registry, now: yield* options.now, newInternalId: options.newInternalId, vault });
  for (const record of registry.tables.values()) yield* transaction.writePrivate(TABLES, record.id, tableDocument(record.definition));
  for (const index of registry.indexes.records.values()) yield* transaction.writePrivate(INDEXES, index.ref.id, coreIndexMetadataValue(index));
  for (const index of registry.indexesForTablet(catalog.tabletId)) if (index.name === "by_name" || index.name === "by_number")
    yield* transaction.writePrivate(INDEXES, index.ref.id, null);
  yield* transaction.runSystem(transaction.insertSystem(SCHEMAS, { state: { state: "active" }, schema: yield* Effect.fromResult(serializeCoreSchema(schema)) }));
  yield* transaction.runSystem(transaction.insertSystem(DATABASE_GLOBALS, globalsBody(yield* allocateInternalId(options.newInternalId))));
  const finalized = vault.take(yield* transaction.transaction.finalize());
  if (finalized === undefined) return yield* new CoreTransactionError({ reason: "foreignFinalization" });
  const now = yield* options.now;
  const migratedAt = now > timestamp ? now : timestamp + 1n;
  yield* persistence.write(lease, yield* Effect.fromResult(deriveCoreWriteBatch(finalized, migratedAt)));
  yield* putValue(persistence, lease, CORE_SCHEMA_CUTOVER_GLOBAL, migratedAt);
});

export const bootstrapCore = Effect.fn("CoreBootstrap.open")(function* (
  persistence: CorePersistence, lease: CorePersistenceLease, options: CoreDatabaseOptions,
) {
  const retention = makeCoreLeaderRetention(yield* persistence.readRetentionBounds(lease));
  if (yield* persistence.isFresh(lease)) {
    yield* retention.validateIndex(0n);
    yield* retention.validateDocument(0n);
    yield* initializeCorePersistence(persistence, lease, options);
  }
  let timestamp = yield* persistence.latestTimestamp(lease);
  yield* retention.validateIndex(timestamp);
  yield* retention.validateDocument(timestamp);
  let snapshot = yield* persistence.readSnapshot(timestamp, retention);
  const catalogId = yield* anchor(persistence, "tables_table_id");
  const catalogRow = yield* snapshot.get(catalogId, catalogId);
  if (Option.isNone(catalogRow) || catalogRow.value.deleted) return yield* corrupt();
  const catalogBody = yield* Effect.fromResult(readDocumentObject(catalogRow.value, { number: 513, tabletId: catalogId }));
  const legacy = typeof catalogBody.validator === "string" && catalogBody.state === undefined;
  const revisions: CoreDocumentLogEntry[] = [];
  let registry = yield* loadCoreRegistry(snapshot, yield* loadBootstrapRegistry(persistence, snapshot, legacy), entry => { revisions.push(entry); },
    legacy ? LEGACY_CORE_REGISTRY_DECODERS : undefined);
  if (legacy) {
    yield* migrateLegacy(persistence, lease, options, timestamp, snapshot, registry, revisions);
    timestamp = yield* persistence.latestTimestamp(lease);
    snapshot = yield* persistence.readSnapshot(timestamp, retention);
    revisions.length = 0;
    registry = yield* loadCoreRegistry(snapshot, yield* loadBootstrapRegistry(persistence, snapshot), entry => { revisions.push(entry); });
  }
  for (const name of CORE_BUILTIN_TABLE_NUMBERS.keys()) if (registry.table(name) === undefined) return yield* corrupt();
  const db = registry.table(DATABASE_GLOBALS)?.definition;
  const byId = db?.indexes.find(index => index.name === "by_id");
  if (db === undefined || byId === undefined) return yield* corrupt();
  const globals = yield* snapshot.scan({ index: byId.ref, tableId: db.tabletId, interval: { start: null, end: null }, order: "asc", maxResults: 2 });
  const global = globals.entries[0];
  if (globals.entries.length !== 1 || global === undefined || globals.cursor.kind !== "end") return yield* corrupt();
  const body = yield* Effect.fromResult(readDocumentObject(global.document, db));
  if (body.version !== CORE_LOGICAL_DATABASE_VERSION) return yield* corrupt("Unsupported logical schema version");
  const marker = yield* persistence.getGlobal(CORE_SCHEMA_CUTOVER_GLOBAL);
  if (Option.isNone(marker)) yield* putValue(persistence, lease, CORE_SCHEMA_CUTOVER_GLOBAL, global.document.ts);
  yield* authenticateCoreNativeRegistry(registry);
  const resident = yield* Effect.fromResult(CoreResidentIndexes.create(registry, revisions));
  return { timestamp, registry, retention, resident };
});

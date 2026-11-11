/** Convex database bootstrap over the current logical metadata format. */
import { Effect, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentValue, encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { CoreTransactionError, type CoreDatabaseOptions, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistence, type CorePersistenceLease, type CorePersistenceSnapshot } from "./contracts";
import { CORE_BUILTIN_TABLE_NUMBERS, DATABASE_GLOBALS, INDEXES, INDEX_BACKFILLS, PROGRAMS, REQUESTS, SCHEMAS,
  SCHEMA_VALIDATIONS, SCHEMA_VALIDATION_PROGRESS, TABLES, initialRegistry, loadCoreRegistry, readDocumentObject, tableDocument } from "./registry";
import { CoreFinalizationVault, createCoreTransaction, deriveCoreWriteBatch, prepareCoreTransactionIds } from "./transaction";
import { makeCoreLeaderRetention } from "./retention";
import { CoreResidentIndexes } from "./residentIndex";
import { coreIndexMetadataValue, decodeCoreIndexMetadata } from "./indexState";
import type { CoreTableNamespace } from "./namespace";
import { authenticateCoreNativeRegistry } from "./nativePolicy";
import { captureCoreEntropy, type CoreTransactionIdGenerator } from "./transactionIdGenerator";

export const CORE_LOGICAL_DATABASE_VERSION = 1n;
const HexId = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{32}$/.test(value) ? undefined : "Expected a canonical internal ID"));
const decodeHexId = Schema.decodeUnknownResult(HexId);
const corrupt = (cause?: unknown) => new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });

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

/** Bootstrap anchors identify the current table and index metadata catalogs. */
export const loadBootstrapRegistry = Effect.fn("CoreBootstrap.loadAnchors")(function* (
  persistence: CorePersistence, snapshot: CorePersistenceSnapshot,
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
    const index = yield* Effect.fromResult(Result.mapError(decodeCoreIndexMetadata(document), corrupt));
    if (index.table_id !== encodeBytesToLowercaseHex(tabletId) || index.descriptor !== "by_id"
      || index.config.fields.length !== 0 || index.config.onDiskState.type !== "Enabled") return yield* corrupt();
    const persistenceIndexId = index.config.persistenceIndexId;
    definitions.push({ name, number, tabletId, namespace: null, state: "active", indexes: [{
      name: "by_id", ref: { id: indexId, ...(persistenceIndexId === undefined ? {} : { persistenceIndexId }) }, fields: [],
    }] });
  }
  return yield* Effect.fromResult(initialRegistry(definitions));
});

export const allocateCoreBuiltinDefinitions = Effect.fn("CoreBootstrap.allocateBuiltins")(function* (
  idGenerator: CoreTransactionIdGenerator, names: readonly string[], namespace: CoreTableNamespace = null, firstPersistenceIndexId?: bigint,
) {
  const definitions: CoreTableDefinition[] = [];
  let nextPersistenceIndexId = firstPersistenceIndexId;
  const allocateIndex = (name: string, fields: readonly string[]): CoreIndexDefinition => ({ name, fields,
    ref: { id: idGenerator.nextInternalId(),
      ...(nextPersistenceIndexId === undefined ? {} : { persistenceIndexId: nextPersistenceIndexId++ }) } });
  for (const name of names) {
    const number = CORE_BUILTIN_TABLE_NUMBERS.get(name);
    if (number === undefined) return yield* corrupt();
    definitions.push({ name, number, tabletId: idGenerator.nextInternalId(), namespace, state: "active", indexes: [] });
  }
  // Source reserves tablet identities, then intrinsic indexes, then declared system indexes.
  for (const [position, definition] of definitions.entries()) {
    const indexes = [allocateIndex("by_id", [])];
    if (definition.name !== INDEXES) indexes.push(allocateIndex("by_creation_time", ["_creationTime"]));
    definitions[position] = { ...definition, indexes };
  }
  for (const [position, definition] of definitions.entries()) {
    const { name } = definition;
    const specs: Array<readonly [string, readonly string[]]> = [];
    if (name === REQUESTS) specs.push(["by_key", ["key"]]);
    if (name === SCHEMAS) specs.push(["by_state", ["state"]]);
    if (name === INDEX_BACKFILLS) specs.push(["by_index_id", ["indexId"]]);
    if (name === SCHEMA_VALIDATIONS) specs.push(["by_schema_id_and_table_name", ["schemaId", "tableName", "_creationTime"]]);
    if (name === SCHEMA_VALIDATION_PROGRESS) specs.push(["by_validation_id", ["validationId", "_creationTime"]]);
    if (name === PROGRAMS) specs.push(["by_head_path", ["kind", "identity.functionPath"]],
      ["by_identity", ["kind", "identity.functionPath", "identity.programHash", "identity.schemaHash"]]);
    const indexes = [...definition.indexes, ...specs.map(([indexName, fields]) => allocateIndex(indexName, fields))];
    definitions[position] = { ...definition, indexes };
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
  const ids = yield* prepareCoreTransactionIds(options);
  // UUID entropy is separate from the document stream and captured before any durable anchor.
  const secret = yield* Effect.fromResult(captureCoreEntropy(yield* options.randomBytes(16), 16));
  const definitions = yield* allocateCoreBuiltinDefinitions(ids.idGenerator, [...CORE_BUILTIN_TABLE_NUMBERS.keys()], null, 1n);
  let registry = yield* Effect.fromResult(initialRegistry(definitions));
  const tables = registry.table(TABLES)?.definition;
  const indexes = registry.table(INDEXES)?.definition;
  const tablesById = tables?.indexes.find(index => index.name === "by_id");
  const indexesById = indexes?.indexes.find(index => index.name === "by_id");
  if (tables === undefined || indexes === undefined || tablesById === undefined || indexesById === undefined) return yield* corrupt();
  const vault = new CoreFinalizationVault();
  const transaction = createCoreTransaction({ snapshot: yield* persistence.readSnapshot(0n), registry, ...ids, vault });
  for (const table of definitions) {
    yield* transaction.insertPrivate(TABLES, table.tabletId, tableDocument(table));
    for (const declaration of table.indexes.filter(index => index.name === "by_id" || index.name === "by_creation_time")) {
      const index = registry.indexes.byId(declaration.ref.id);
      if (index === undefined) return yield* corrupt();
      yield* transaction.insertPrivate(INDEXES, index.ref.id, coreIndexMetadataValue(index));
    }
  }
  for (const table of definitions) for (const declaration of table.indexes.filter(index => index.name !== "by_id" && index.name !== "by_creation_time")) {
    const index = registry.indexes.byId(declaration.ref.id);
    if (index === undefined) return yield* corrupt();
    yield* transaction.insertPrivate(INDEXES, index.ref.id, coreIndexMetadataValue(index));
  }
  yield* transaction.runSystem(transaction.insertSystem(DATABASE_GLOBALS, globalsBody(secret)));
  const authorityId = transaction.idGenerator.nextInternalId();
  yield* transaction.insertPrivate(PROGRAMS, authorityId, { kind: "authority", epoch: 0n });
  registry = transaction.registry.withAuthority({ id: authorityId, epoch: 0n, ts: 0n });
  transaction.setRegistryAfter(registry);
  const finalized = vault.take(yield* transaction.transaction.finalize());
  if (finalized === undefined) return yield* new CoreTransactionError({ reason: "foreignFinalization" });
  const batch = yield* Effect.fromResult(deriveCoreWriteBatch(finalized, 0n));
  for (const [key, id] of [["tables_table_id", tables.tabletId], ["index_table_id", indexes.tabletId],
    ["tables_by_id", tablesById.ref.id], ["index_by_id", indexesById.ref.id]] as const) yield* putValue(persistence, lease, key, encodeBytesToLowercaseHex(id));
  yield* persistence.write(lease, batch);
});

export const bootstrapCore = Effect.fn("CoreBootstrap.open")(function* (
  persistence: CorePersistence, lease: CorePersistenceLease, options: CoreDatabaseOptions,
) {
  const capturedRetentionBounds = yield* persistence.readRetentionBounds(lease);
  const retentionBounds = Object.freeze({ ...capturedRetentionBounds });
  const retention = makeCoreLeaderRetention(retentionBounds);
  if (yield* persistence.isFresh(lease)) {
    yield* retention.validateIndex(0n);
    yield* retention.validateDocument(0n);
    yield* initializeCorePersistence(persistence, lease, options);
  }
  const timestamp = yield* persistence.latestTimestamp(lease);
  yield* retention.validateIndex(timestamp);
  yield* retention.validateDocument(timestamp);
  const snapshot = yield* persistence.readSnapshot(timestamp, retention);
  const revisions: CoreDocumentLogEntry[] = [];
  const registry = yield* loadCoreRegistry(snapshot, yield* loadBootstrapRegistry(persistence, snapshot), entry => { revisions.push(entry); });
  for (const name of CORE_BUILTIN_TABLE_NUMBERS.keys()) if (registry.table(name) === undefined) return yield* corrupt();
  const db = registry.table(DATABASE_GLOBALS)?.definition;
  const byId = db?.indexes.find(index => index.name === "by_id");
  if (db === undefined || byId === undefined) return yield* corrupt();
  const globals = yield* snapshot.scan({ index: byId.ref, tableId: db.tabletId, interval: { start: null, end: null }, order: "asc", maxResults: 2 });
  const global = globals.entries[0];
  if (globals.entries.length !== 1 || global === undefined || globals.cursor.kind !== "end") return yield* corrupt();
  const body = yield* Effect.fromResult(readDocumentObject(global.document, db));
  if (body.version !== CORE_LOGICAL_DATABASE_VERSION) return yield* corrupt("Unsupported logical schema version");
  yield* authenticateCoreNativeRegistry(registry, undefined, options.schemaBundles);
  const resident = yield* Effect.fromResult(CoreResidentIndexes.create(registry, revisions));
  return { timestamp, registry, retention, retentionBounds, resident };
});

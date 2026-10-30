/**
 * Mechanisms translated from Convex crates/database/src/database.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentValue, encodeDocumentValue } from "flarex-protocol/document-value";
import { CoreTransactionError, type CoreDatabaseOptions, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistence, type CorePersistenceLease, type CorePersistenceSnapshot } from "./contracts";
import { CORE_BUILTIN_TABLE_NUMBERS, INDEXES, PROGRAMS, REQUESTS, TABLES,
  initialRegistry, loadCoreRegistry, readDocumentObject, tableDocument } from "./registry";
import { CoreFinalizationVault, createCoreTransaction, deriveCoreWriteBatch } from "./transaction";
import { makeCoreLeaderRetention } from "./retention";
import { CoreResidentIndexes } from "./residentIndex";

const HexId = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{32}$/.test(value) ? undefined : "Expected a canonical internal ID"));
const decodeHexId = Schema.decodeUnknownResult(HexId);
const BootstrapIndex = Schema.Struct({ name: Schema.Literal("by_id"), tableNumber: Schema.Int,
  enabled: Schema.Literal(true), fields: Schema.Array(Schema.String), persistenceIndexId: Schema.optional(Schema.BigInt) });
const decodeBootstrapIndex = Schema.decodeUnknownResult(BootstrapIndex);

export function allocateInternalId(effect: Effect.Effect<Uint8Array>): Effect.Effect<Uint8Array, CoreTransactionError> {
  return Effect.flatMap(effect, value => value instanceof Uint8Array && value.byteLength === 16
    ? Effect.succeed(value.slice()) : Effect.fail(new CoreTransactionError({ reason: "invalidDocumentId" })));
}

const anchor = Effect.fn("CoreBootstrap.anchor")(function* (persistence: CorePersistence, key: string) {
  const stored = yield* persistence.getGlobal(key);
  if (Option.isNone(stored)) return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
  const value = yield* Effect.fromResult(Result.mapError(decodeDocumentValue(stored.value), cause => new CorePersistenceError({ reason: "corruptData", cause })));
  const hex = yield* Effect.fromResult(Result.mapError(decodeHexId(value), cause => new CorePersistenceError({ reason: "corruptData", cause })));
  const id = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) id[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return id;
});

/** Resolve each bootstrap index's own metadata at S, rather than from a new catalog head. */
export const loadBootstrapRegistry = Effect.fn("CoreBootstrap.loadAnchors")(function* (
  persistence: CorePersistence, snapshot: CorePersistenceSnapshot,
) {
  const tablesId = yield* anchor(persistence, "tables_table_id");
  const indexesId = yield* anchor(persistence, "index_table_id");
  const tablesById = yield* anchor(persistence, "tables_by_id");
  const indexesById = yield* anchor(persistence, "index_by_id");
  const definitions: CoreTableDefinition[] = [];
  for (const [name, tabletId, indexId, number] of [
    [TABLES, tablesId, tablesById, 513], [INDEXES, indexesId, indexesById, 514],
  ] as const) {
    const entry = yield* snapshot.get(indexesId, indexId);
    if (Option.isNone(entry) || entry.value.deleted) return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
    const document = yield* Effect.fromResult(readDocumentObject(entry.value, { number: 514, tabletId: indexesId }));
    const index = yield* Effect.fromResult(Result.mapError(decodeBootstrapIndex(document), cause => new CorePersistenceError({ reason: "corruptData", cause })));
    if (index.tableNumber !== number || index.fields.length !== 0) return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
    definitions.push({ name, number, tabletId, validator: { type: "any" }, indexes: [{
      name: "by_id", ref: { id: indexId, ...(index.persistenceIndexId === undefined ? {} : { persistenceIndexId: index.persistenceIndexId }) },
      fields: [], enabled: true,
    }] });
  }
  return initialRegistry(definitions);
});

/** db914cf06 Database::initialize: random internal IDs, four small anchors, one initial log batch. */
export const initializeCorePersistence = Effect.fn("CoreBootstrap.initialize")(function* (
  persistence: CorePersistence, lease: CorePersistenceLease, options: CoreDatabaseOptions,
) {
  const definitions: CoreTableDefinition[] = [];
  let nextPersistenceIndexId = 1n;
  for (const [name, number] of CORE_BUILTIN_TABLE_NUMBERS) {
    const indexes: CoreIndexDefinition[] = [{ name: "by_id",
      ref: { id: yield* allocateInternalId(options.newInternalId), persistenceIndexId: nextPersistenceIndexId++ }, fields: [], enabled: true }];
    if (name !== INDEXES) indexes.push({ name: "by_creation_time",
      ref: { id: yield* allocateInternalId(options.newInternalId), persistenceIndexId: nextPersistenceIndexId++ },
      fields: ["_creationTime"], enabled: true });
    if (name === REQUESTS) indexes.push({ name: "by_key",
      ref: { id: yield* allocateInternalId(options.newInternalId), persistenceIndexId: nextPersistenceIndexId++ }, fields: ["key"], enabled: true });
    if (name === TABLES) {
      for (const [indexName, fields] of [["by_name", ["name"]], ["by_number", ["number"]]] as const)
        indexes.push({ name: indexName, ref: { id: yield* allocateInternalId(options.newInternalId), persistenceIndexId: nextPersistenceIndexId++ }, fields, enabled: true });
    }
    if (name === PROGRAMS) {
      for (const [indexName, fields] of [["by_head_path", ["kind", "identity.functionPath"]],
        ["by_identity", ["kind", "identity.functionPath", "identity.programHash", "identity.schemaHash"]]] as const)
        indexes.push({ name: indexName, ref: { id: yield* allocateInternalId(options.newInternalId), persistenceIndexId: nextPersistenceIndexId++ }, fields, enabled: true });
    }
    definitions.push({ name, number, tabletId: yield* allocateInternalId(options.newInternalId), validator: { type: "any" }, indexes });
  }
  const identities = definitions.flatMap(table => [table.tabletId, ...table.indexes.map(index => index.ref.id)]).map(encodeBytesToLowercaseHex);
  if (new Set(identities).size !== identities.length) return yield* Effect.fail(new CoreTransactionError({ reason: "invalidDocumentId" }));
  let registry = initialRegistry(definitions);
  const tables = registry.table(TABLES);
  const indexes = registry.table(INDEXES);
  const tablesById = tables?.definition.indexes.find(index => index.name === "by_id");
  const indexesById = indexes?.definition.indexes.find(index => index.name === "by_id");
  if (tables === undefined || indexes === undefined || tablesById === undefined || indexesById === undefined)
    return yield* Effect.fail(new CorePersistenceError({ reason: "corruptData" }));
  for (const [key, id] of [["tables_table_id", tables.definition.tabletId], ["index_table_id", indexes.definition.tabletId],
    ["tables_by_id", tablesById.ref.id], ["index_by_id", indexesById.ref.id]] as const) {
    const value = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(encodeBytesToLowercaseHex(id)), cause => new CoreTransactionError({ reason: "invalidValue", cause })));
    yield* persistence.putGlobal(lease, key, value);
  }
  const vault = new CoreFinalizationVault();
  const snapshot = yield* persistence.readSnapshot(0n);
  const transaction = createCoreTransaction({ snapshot, registry, now: yield* options.now,
    newInternalId: options.newInternalId, vault });
  for (const table of definitions) {
    yield* transaction.writePrivate(TABLES, table.tabletId, tableDocument(table));
    for (const index of table.indexes) yield* transaction.writePrivate(INDEXES, index.ref.id, {
      name: index.name, tableNumber: table.number, fields: [...index.fields], enabled: index.enabled,
      ...(index.ref.persistenceIndexId === undefined ? {} : { persistenceIndexId: index.ref.persistenceIndexId }),
    });
  }
  const authorityId = yield* allocateInternalId(options.newInternalId);
  yield* transaction.writePrivate(PROGRAMS, authorityId, { kind: "authority", epoch: 0n });
  registry = registry.withAuthority({ id: authorityId, epoch: 0n, ts: 0n });
  const finalized = vault.take(yield* transaction.transaction.finalize());
  if (finalized === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "foreignFinalization" }));
  const batch = yield* Effect.fromResult(deriveCoreWriteBatch(finalized, 0n));
  yield* persistence.write(lease, batch);
  return registry;
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
  const timestamp = yield* persistence.latestTimestamp(lease);
  yield* retention.validateIndex(timestamp);
  yield* retention.validateDocument(timestamp);
  const snapshot = yield* persistence.readSnapshot(timestamp, retention);
  const bootstrap = yield* loadBootstrapRegistry(persistence, snapshot);
  const revisions: CoreDocumentLogEntry[] = [];
  const registry = yield* loadCoreRegistry(snapshot, bootstrap, entry => { revisions.push(entry); });
  const resident = yield* Effect.fromResult(CoreResidentIndexes.create(registry, revisions));
  return { timestamp, registry, retention, resident };
});

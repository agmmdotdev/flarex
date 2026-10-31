/**
 * Mechanisms translated from Convex crates/database/src/{transaction,transaction_index,writes}.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Effect, Option, Result, Schema, Semaphore } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { SchemaManifestAppTableNameSchema } from "flarex-protocol/schema-manifest";
import { decodeDocumentId, normalizeDocumentId } from "flarex-protocol/document-id";
import { captureDocumentObject, captureDocumentPatch, encodeDocumentValue, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey, encodeIndexValue } from "flarex-protocol/index-key";
import { captureLogicalQuery, compileIndexRange, fingerprintQuery, incrementIndexKeyPrefix, indexRangeIsEmpty, splitIndexRangeAfter } from "flarex-protocol/index-range";
import { CoreNativeUniqueConflict, CoreQueryInputError, CoreTransactionError, issueFinalizedTransaction, type CoreError, type CoreFinalizedTransaction,
  type CoreIndexDefinition, type CoreTableDefinition, type CoreTransaction, type CoreTransactionLimits, type CoreTransactionUsage,
  type CoreReadToken, type CoreProgramDefinition, type CoreNativeOperations } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreIndexPage, type CoreIndexScan, type CoreInterval, type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import { CoreRegistry, TABLES, INDEXES, SCHEMAS, PROGRAMS, publicDocumentId, readDocumentObject, tableDocument, parseCoreTableRecord } from "./registry";
import { coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import { CoreSchemaModel } from "./schemaModel";
import type { CoreSchemaRegistry } from "./schemaRegistry";
import { coreIndexMetadataValue, coreIndexWriteMode, parseCoreIndexRecord, type CoreIndexRecord } from "./indexState";
import { CoreReadSetBuilder, pointInterval, type CoreReadSet } from "./writeLog";
import { CORE_TRANSACTION_REFERENCE_LIMITS, CoreAccounting } from "./accounting";
import { captureCoreDocument, captureCoreObject } from "./document";
import { addIndexMetadataDependency, addTableWriteDependencies } from "./dependencies";
import { createCoreEmptyQuery, createCoreQuery } from "./query";
import { createCoreIndexSnapshot } from "./indexSnapshot";
import type { CoreTableCounts } from "./tableCounts";
import { documentIndexKey } from "./documentIndex";
import { authenticateCoreNativeRegistry, checkCoreNativeAuthority, checkCoreTableAccess, coreNativeMetadataReads, type CoreNativeAuthority } from "./nativePolicy";
import { CoreNativeObservationState, type CoreNativeDocumentObservation, type CoreNativeMembership,
  type CoreNativeObservations } from "./nativeObservations";

export interface CoreDocumentChange {
  readonly table: CoreTableDefinition;
  readonly id: Uint8Array;
  readonly original: CoreDocumentLogEntry | undefined;
  readonly originalDocument: DocumentObject | null;
  readonly finalDocument: DocumentObject | null;
}

export interface CoreFinalizedState {
  readonly timestamp: bigint;
  readonly reads: CoreReadSet;
  readonly changes: readonly CoreDocumentChange[];
  readonly registry: CoreRegistry;
  readonly registryAfter?: CoreRegistry;
  readonly claim?: import("./api").CoreRequestClaim;
  readonly usage: CoreTransactionUsage;
  readonly admissionDeadlineUnixMilliseconds?: number;
  readonly nativeObservations?: CoreNativeObservations;
}

export interface CoreTransactionInternals {
  readonly namespace: CoreTableNamespace;
  readonly timestamp: bigint;
  readonly registry: CoreRegistry;
  readonly schemaRegistry: CoreSchemaRegistry;
  readonly transaction: CoreTransaction;
  readonly nativeOperations?: CoreNativeOperations;
  readonly count: (tableId:Uint8Array) => Effect.Effect<Option.Option<bigint>,CoreError>;
  readonly runSystem: <A>(body: Effect.Effect<A, CoreError>) => Effect.Effect<A, CoreError>;
  readonly getSystem: (table: string, id: string) => Effect.Effect<Option.Option<CoreSystemDocument>, CoreError>;
  readonly querySystem: (table: string, index: string, eqValues: readonly DocumentValue[]) => Effect.Effect<readonly CoreSystemDocument[], CoreError>;
  readonly insertSystem: (table: string, body: DocumentObject) => Effect.Effect<string, CoreError>;
  readonly replaceSystem: (table: string, id: string, body: DocumentObject) => Effect.Effect<void, CoreError>;
  readonly deleteSystem: (table: string, id: string) => Effect.Effect<void, CoreError>;
  readonly ensureUserTable: (name: string) => Effect.Effect<CoreTableDefinition, CoreError>;
  readonly tableExists: (name: string) => boolean;
  readonly schemaTableStateIndex: () => import("./contracts").CoreIndexRef;
  readonly finishRead: () => Effect.Effect<CoreReadToken, CoreError>;
  readonly readPrivate: (table: string, id: Uint8Array) => Effect.Effect<Option.Option<DocumentObject>, CoreError>;
  readonly writePrivate: (table: string, id: Uint8Array, body: DocumentObject | null) => Effect.Effect<void, CoreError>;
  readonly setRegistryAfter: (registry: CoreRegistry) => void;
  readonly addIndexRead: (indexId: Uint8Array, interval: CoreInterval) => void;
}

/** Parsed system document; value contains the body without intrinsic fields. */
export interface CoreSystemDocument {
  readonly id: string;
  readonly creationTime: number;
  readonly value: DocumentObject;
}

function systemDocument(document: DocumentObject): Result.Result<CoreSystemDocument, CorePersistenceError> {
  const { _id, _creationTime, ...value } = document;
  return typeof _id === "string" && typeof _creationTime === "number"
    ? Result.succeed({ id: _id, creationTime: _creationTime, value })
    : Result.fail(new CorePersistenceError({ reason: "corruptData" }));
}

export class CoreFinalizationVault {
  private readonly records = new WeakMap<CoreFinalizedTransaction, CoreFinalizedState>();
  issue(record: CoreFinalizedState): CoreFinalizedTransaction {
    const handle = issueFinalizedTransaction();
    this.records.set(handle, record);
    return handle;
  }
  take(handle: CoreFinalizedTransaction): CoreFinalizedState | undefined {
    const record = this.records.get(handle);
    if (record !== undefined) this.records.delete(handle);
    return record;
  }
}

function invalid(cause?: unknown): CoreTransactionError {
  return new CoreTransactionError({ reason: "invalidValue", ...(cause === undefined ? {} : { cause }) });
}

function nextUp(value: number): number {
  if (value === 0) return Number.MIN_VALUE;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + 1n);
  return view.getFloat64(0);
}

/** The source snapshot and explicit native observations share one write and resource owner. */
export function createCoreTransaction(input: Readonly<{
  snapshot: CorePersistenceSnapshot;
  residentReader?: (request: CoreIndexScan) => CoreIndexPage | undefined;
  operationCacheMaxBytes?: number;
  registry: CoreRegistry;
  namespace?: CoreTableNamespace;
  counts?: CoreTableCounts;
  now: bigint;
  newInternalId: Effect.Effect<Uint8Array>;
  vault: CoreFinalizationVault;
  claim?: import("./api").CoreRequestClaim;
  limits?: CoreTransactionLimits;
  readonly?: boolean;
  assertOwnerOpen?: Effect.Effect<void, CoreError>;
  onClosed?: () => void;
  native?: Readonly<{
    authority: CoreNativeAuthority;
    visibility: "command" | "snapshot";
    capture: () => Effect.Effect<Readonly<{ snapshot: CorePersistenceSnapshot; registry: CoreRegistry;
      residentReader?: (request: CoreIndexScan) => CoreIndexPage | undefined }>, CoreError>;
  }>;
}>): CoreTransactionInternals {
  const { snapshot } = input;
  let registry = input.registry;
  const namespace = input.namespace ?? null;
  const indexSnapshot = createCoreIndexSnapshot({ snapshot, registry,
    ...(input.residentReader === undefined ? {} : { resident: input.residentReader }),
    ...(input.operationCacheMaxBytes === undefined ? {} : { maxBytes: input.operationCacheMaxBytes }) });
  const reads = new CoreReadSetBuilder();
  const writes = new Map<string, CoreDocumentChange>();
  const pendingIndexes = new Map<string, BTree<Uint8Array, DocumentObject | null>>();
  const accounting = new CoreAccounting(input.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS);
  const nativeObservations = input.native === undefined ? undefined : new CoreNativeObservationState();
  // Rust's &mut Transaction excludes interleaving while a syscall awaits persistence.
  const operations = Semaphore.makeUnsafe(1);
  const documentSizes = new WeakMap<DocumentObject, number>();
  let registryAfter: CoreRegistry | undefined;
  let closed = false;
  let inflight = 0;
  const snapshotCeilMillis = Number((snapshot.timestamp + 999_999n) / 1_000_000n);
  let creationTime = Math.max(snapshotCeilMillis, Number(input.now) / 1_000_000);
  const unixTime = Math.floor(creationTime);

  const assertOpen = () => Effect.suspend(() => closed
    ? Effect.fail(new CoreTransactionError({ reason: "closed" })) : input.assertOwnerOpen ?? Effect.void);
  const markClosed = () => { closed = true; };
  const operation = <A>(body: Effect.Effect<A, CoreError>): Effect.Effect<A, CoreError> => Effect.acquireUseRelease(
    Effect.andThen(assertOpen(), Effect.sync(() => {
      inflight += 1;
    })),
    () => operations.withPermits(1)(Effect.andThen(assertOpen(), body).pipe(
      Effect.tap(() => assertOpen()))),
    () => Effect.sync(() => { inflight -= 1; }),
  );


  const tableByName = (name: string, privateAccess: boolean): Result.Result<CoreTableDefinition, CoreTransactionError> => {
    const record = registry.table(name, systemNamespace(name));
    if (record === undefined || (!privateAccess && name.startsWith("_"))) return Result.fail(new CoreTransactionError({ reason: "missingTable" }));
    return Result.gen(function* () {
      if (!privateAccess) yield* checkCoreTableAccess(record.definition, "read", input.native?.authority);
      if (input.native === undefined) yield* mappingRead();
      else if (privateAccess) {
        const tables = registry.table(TABLES)?.definition;
        const byId = tables?.indexes.find(index => index.name === "by_id");
        if (tables === undefined || byId === undefined) return yield* Result.fail(invalid());
        const id = yield* publicDocumentId(tables, record.id);
        const key = yield* Result.mapError(encodeIndexKey([], id), invalid);
        reads.add(byId.ref.id, pointInterval(key));
      }
      return record.definition;
    });
  };

  function systemNamespace(name: string): CoreTableNamespace {
    return [TABLES, INDEXES, PROGRAMS, "_session_requests", "_index_backfills", "_db"].includes(name) ? null : namespace;
  }

  function mappingRead(): Result.Result<void, CoreTransactionError> {
    const index = registry.table(TABLES)?.definition.indexes.find(value => value.name === "by_id");
    if (index === undefined) return Result.fail(invalid());
    reads.add(index.ref.id, { start: null, end: null });
    return Result.succeed(undefined);
  }

  function chargePointQuery(table: CoreTableDefinition, id: Uint8Array): Result.Result<void, CoreTransactionError> {
    return Result.gen(function* () {
      const byId = table.indexes.find(index => index.name === "by_id");
      if (byId === undefined) return yield* Result.fail(invalid());
      if (input.native === undefined || table.name.startsWith("_")) yield* addIndexMetadataDependency(reads, registry, byId);
      const developerId = yield* publicDocumentId(table, id);
      const key = yield* Result.mapError(encodeIndexKey([], developerId), invalid);
      yield* accounting.query(byId.ref.id, pointInterval(key));
    });
  }

  function chargeDocument(table: CoreTableDefinition, document: DocumentObject | null): Result.Result<void, CoreTransactionError> {
    if (document === null) return Result.succeed(undefined);
    return Result.gen(function* () {
      let size = documentSizes.get(document);
      if (size === undefined) {
        const measured = yield* Result.mapError(captureCoreDocument(document, table.name.startsWith("_")), invalid);
        size = measured.semanticSizeBytes;
        documentSizes.set(document, size);
      }
      yield* accounting.read(table.name.startsWith("_"), size);
    });
  }

  const resolve = (id: string, privateAccess: boolean) => Result.gen(function* () {
    const decoded = yield* Result.mapError(decodeDocumentId(id), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause }));
    const record = registry.tableByNumber(decoded.tableNumber, namespace);
    if (record === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "missingTable" }));
    const table = yield* tableByName(record.definition.name, privateAccess);
    return { table, internalId: decoded.internalId };
  });

  const captureObservation = Effect.fn("CoreTransaction.captureObservation")(function* (
    table: CoreTableDefinition, found: CoreDocumentLogEntry | undefined,
  ) {
    const original = found === undefined ? undefined : Object.freeze({ ...found,
      tableId: found.tableId.slice(), id: found.id.slice(), jsonValue: found.jsonValue.slice() });
    let document: DocumentObject | null = null;
    if (original !== undefined && !original.deleted) {
      const decoded = yield* Effect.fromResult(readDocumentObject(original, table));
      const measured = yield* Effect.fromResult(Result.mapError(captureCoreDocument(decoded, table.name.startsWith("_")), invalid));
      document = measured.value;
      documentSizes.set(document, measured.semanticSizeBytes);
    }
    return Object.freeze({ original, document });
  });

  const nativeCapture = Effect.fn("CoreTransaction.nativeCapture")(function* (table: CoreTableDefinition) {
    const native = input.native;
    if (native === undefined || nativeObservations === undefined) return yield* invalid();
    // The database provider retains fixed data for standalone reads and advances
    // command frontiers, while checking the current authority in either case.
    const selected = yield* native.capture();
    yield* assertOpen();
    yield* Effect.fromResult(checkCoreNativeAuthority(selected.registry, native.authority, table.name));
    const metadata = yield* Effect.fromResult(coreNativeMetadataReads(selected.registry, native.authority, table.name));
    nativeObservations.addReads(selected.snapshot.timestamp, metadata);
    return { ...selected, indexSnapshot: createCoreIndexSnapshot({ snapshot: selected.snapshot, registry: selected.registry,
      ...(selected.residentReader === undefined ? {} : { resident: selected.residentReader }),
      ...(input.operationCacheMaxBytes === undefined ? {} : { maxBytes: input.operationCacheMaxBytes }) }) };
  });

  function nativeRead(timestamp: bigint, index: CoreIndexDefinition, interval: CoreInterval): void {
    nativeObservations?.addReads(timestamp, [{ indexId: index.ref.id, intervals: [interval] }]);
  }

  const nativeObserve = Effect.fn("CoreTransaction.nativeObserve")(function* (table: CoreTableDefinition, id: Uint8Array) {
    if (nativeObservations === undefined) return yield* invalid();
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const previous = nativeObservations.original(developerId);
    if (previous !== undefined) return previous;
    if (nativeObservations.hasTable(table)) return nativeObservations.remember(table, developerId, Object.freeze({ original: undefined, document: null }));
    const selected = yield* nativeCapture(table);
    const byId = table.indexes.find(index => index.name === "by_id");
    if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
    const key = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], developerId), invalid));
    const interval = pointInterval(key);
    const page = yield* selected.indexSnapshot.scan({ index: byId.ref, tableId: table.tabletId,
      interval, order: "asc", maxResults: 2 });
    if (page.entries.length > 1 || page.cursor.kind !== "end") return yield* new CorePersistenceError({ reason: "corruptData" });
    yield* assertOpen();
    const observation = yield* captureObservation(table, page.entries[0]?.document);
    nativeRead(selected.snapshot.timestamp, byId, interval);
    return nativeObservations.remember(table, developerId, observation);
  });

  const nativeMembership = Effect.fn("CoreTransaction.nativeMembership")(function* (
    table: CoreTableDefinition, index: CoreIndexDefinition, interval: CoreInterval, charged?: Set<DocumentObject>,
  ) {
    const selected = yield* nativeCapture(table);
    yield* Effect.fromResult(accounting.query(index.ref.id, interval));
    let remaining = interval;
    const rows: Array<Readonly<{ id: string; observation: CoreNativeDocumentObservation }>> = [];
    while (true) {
      const page = yield* selected.indexSnapshot.scan({ index: index.ref, tableId: table.tabletId,
        interval: remaining, order: "asc", maxResults: 128 });
      yield* assertOpen();
      for (const entry of page.entries) {
        const observation = yield* captureObservation(table, entry.document);
        if (observation.document === null) return yield* new CorePersistenceError({ reason: "corruptData" });
        yield* Effect.fromResult(chargeDocument(table, observation.document));
        charged?.add(observation.document);
        rows.push(Object.freeze({ id: yield* Effect.fromResult(publicDocumentId(table, entry.document.id)), observation }));
      }
      if (page.cursor.kind === "end") break;
      const progress = splitIndexRangeAfter({ start: remaining.start ?? new Uint8Array(), end: remaining.end }, page.cursor.key, "asc");
      if (indexRangeIsEmpty(progress.observed)) return yield* invalid("Persistence scan did not advance");
      remaining = progress.remaining;
    }
    yield* assertOpen();
    return Object.freeze({ timestamp: selected.snapshot.timestamp, rows: Object.freeze(rows) }) satisfies CoreNativeMembership;
  });

  const nativeSlotSelection = (table: CoreTableDefinition, field: string, value: string) => Result.gen(function* () {
    const constraint = table.nativePolicy?.uniqueConstraints.find(candidate => candidate.field === field);
    if (constraint === undefined) return yield* Result.fail(new CoreQueryInputError({ reason: "invalidQuery" }));
    const index = table.indexes.find(candidate => candidate.name === constraint.indexName);
    if (index === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    const prefix = yield* Result.mapError(encodeIndexValue(value), invalid);
    return { constraint, index, interval: { start: prefix, end: incrementIndexKeyPrefix(prefix) } };
  });

  const nativeSlot = Effect.fn("CoreTransaction.nativeSlot")(function* (
    table: CoreTableDefinition, field: string, value: string, charged?: Set<DocumentObject>, releaseOnly = false,
  ) {
    if (nativeObservations === undefined) return yield* invalid();
    const { constraint, index, interval } = yield* Effect.fromResult(nativeSlotSelection(table, field, value));
    let membership = nativeObservations.slot(index, interval, releaseOnly);
    if (membership === undefined) {
      membership = yield* nativeMembership(table, index, interval, charged);
      if (!releaseOnly) {
        const byId = table.indexes.find(candidate => candidate.name === "by_id");
        if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
        for (const row of membership.rows) {
          const previous = nativeObservations.original(row.id);
          // The native slot grants membership only for its exact owner revision.
          // A previously remembered point cannot be refreshed to manufacture it.
          if (previous !== undefined && previous.original?.ts !== row.observation.original?.ts)
            return yield* new CoreTransactionError({ reason: "conflict" });
          if (previous === undefined) {
            nativeObservations.remember(table, row.id, row.observation);
            const key = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], row.id), invalid));
            nativeRead(membership.timestamp, byId, pointInterval(key));
          }
        }
      }
      nativeObservations.rememberSlot({ table, index, interval, owners: membership.rows.map(row => row.id) }, membership, !releaseOnly);
    }
    yield* Effect.fromResult(accounting.query(index.ref.id, interval));
    return { constraint, index, interval, membership };
  });

  const nativeConstraints = Effect.fn("CoreTransaction.nativeConstraints")(function* (
    table: CoreTableDefinition, developerId: string, previous: DocumentObject | null, next: DocumentObject | null,
  ) {
    for (const constraint of table.nativePolicy?.uniqueConstraints ?? []) {
      const oldValue = previous?.[constraint.field];
      const newValue = next?.[constraint.field];
      if (typeof oldValue === "string" && oldValue !== newValue) yield* nativeSlot(table, constraint.field, oldValue, undefined, true);
      if (next === null) continue;
      if (typeof newValue !== "string") return yield* new CoreTransactionError({ reason: "documentValidation" });
      const selected = yield* nativeSlot(table, constraint.field, newValue);
      const owners = new Set(selected.membership.rows.map(row => row.id));
      // Checkpoint uniqueness inspects every already observed current row even
      // when a cached query membership deliberately excludes that row.
      for (const row of nativeObservations?.remembered(table) ?? [])
        if (row.observation.document?.[constraint.field] === newValue) owners.add(row.id);
      for (const [id, change] of writes) {
        if (!bytesEqual(change.table.tabletId, table.tabletId)) continue;
        owners.delete(id);
        if (change.finalDocument?.[constraint.field] === newValue) owners.add(id);
      }
      owners.delete(developerId);
      owners.add(developerId);
      if (owners.size > 1) return yield* new CoreNativeUniqueConflict({ tableName: table.name,
        descriptor: constraint.descriptor, fields: Object.freeze([constraint.field]) });
    }
  });

  const observe = Effect.fn("CoreTransaction.observe")(function* (table: CoreTableDefinition, id: Uint8Array) {
    yield* assertOpen();
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const pending = writes.get(developerId);
    if (pending !== undefined) return { original: pending.original, document: pending.originalDocument };
    if (input.native !== undefined && !table.name.startsWith("_")) return yield* nativeObserve(table, id);
    const byId = table.indexes.find(index => index.name === "by_id");
    if (byId === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    const key = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], developerId), invalid));
    reads.add(byId.ref.id, pointInterval(key));
    const page = yield* indexSnapshot.scan({ index: byId.ref, tableId: table.tabletId,
      interval: pointInterval(key), order: "asc", maxResults: 2 });
    if (page.entries.length > 1 || page.cursor.kind !== "end")
      return yield* new CorePersistenceError({ reason: "corruptData" });
    const found = page.entries[0]?.document;
    yield* assertOpen();
    return yield* captureObservation(table, found);
  });

  const read = Effect.fn("CoreTransaction.read")(function* (table: CoreTableDefinition, id: Uint8Array) {
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const pending = writes.get(developerId);
    if (pending !== undefined) return pending.finalDocument;
    return (yield* observe(table, id)).document;
  });

  const stage = Effect.fn("CoreTransaction.stage")(function* (table: CoreTableDefinition, id: Uint8Array, document: DocumentObject | null) {
    if (input.readonly) return yield* new CoreTransactionError({ reason: "readonly" });
    if (!table.name.startsWith("_")) yield* Effect.fromResult(checkCoreTableAccess(table, "write", input.native?.authority));
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const pending = writes.get(developerId);
    const original = yield* observe(table, id);
    const previous = pending === undefined ? original.document : pending.finalDocument;
    yield* assertOpen();
    const captured = document === null ? null : yield* Effect.fromResult(Result.mapError(captureCoreDocument(document, table.name.startsWith("_")), invalid));
    const next = captured?.value ?? null;
    if (captured !== null) documentSizes.set(captured.value, captured.semanticSizeBytes);
    if (input.native !== undefined && !table.name.startsWith("_")) yield* nativeConstraints(table, developerId, previous, next);
    yield* Effect.fromResult(addTableWriteDependencies(reads, registry, table));
    const pendingUpdates: Array<Readonly<{ index: CoreIndexDefinition; oldKey?: Uint8Array; newKey?: Uint8Array }>> = [];
    for (const index of registry.indexesForTablet(table.tabletId)) {
      const oldKey = previous === null ? undefined : yield* Effect.fromResult(documentIndexKey(index, previous));
      const newKey = next === null ? undefined : yield* Effect.fromResult(documentIndexKey(index, next));
      pendingUpdates.push({ index, ...(oldKey === undefined ? {} : { oldKey }), ...(newKey === undefined ? {} : { newKey }) });
    }
    yield* Effect.suspend(() => {
      if (closed) return Effect.fail(new CoreTransactionError({ reason: "closed" }));
      return Effect.fromResult(Result.map(accounting.write(table.name.startsWith("_"), captured?.semanticSizeBytes ?? 0), () => {
      writes.set(developerId, Object.freeze({ table, id: id.slice(), original: original.original,
        originalDocument: original.document, finalDocument: next }));
      for (const update of pendingUpdates) {
        const name = encodeBytesToLowercaseHex(update.index.ref.id);
        let tree = pendingIndexes.get(name);
        if (tree === undefined) {
          tree = new BTree<Uint8Array, DocumentObject | null>(undefined, compareBytesLexicographically);
          pendingIndexes.set(name, tree);
        }
        if (update.oldKey !== undefined) tree.set(update.oldKey, null);
        if (update.newKey !== undefined) tree.set(update.newKey, next);
      }
      }));
    });
  });

  const validateUserBody = Effect.fn("CoreTransaction.validateDocument")(function* (table: CoreTableDefinition, value: unknown) {
      const body = yield* Effect.fromResult(Result.mapError(captureDocumentObject(value), invalid));
      if (Object.hasOwn(body, "_id") || Object.hasOwn(body, "_creationTime")) return yield* invalid();
      yield* new CoreSchemaModel(internals).enforceDocument(table.name, body, {
        mode: "tableAware", check: (name, id) => {
          const expected = registry.table(name, namespace);
          if (expected === undefined) return "unavailable";
          return Result.match(decodeDocumentId(id), { onFailure: () => "invalid" as const,
            onSuccess: decoded => decoded.tableNumber === expected.definition.number ? "valid" as const : "invalid" as const });
        },
      });
      return body;
  });

  const selectIndex = (tableName: string, indexName: string) => Result.gen(function* () {
    const table = yield* tableByName(tableName, false);
    const index = table.indexes.find(value => value.name === indexName);
    if (index === undefined) return yield* Result.fail(new CoreTransactionError({ reason: registry.indexes.byName(table.tabletId,indexName).pending===undefined?"missingIndex":"indexUnavailable" }));
    yield* addIndexMetadataDependency(reads, registry, index);
    return { table, index };
  });

  const scanner = (table: CoreTableDefinition, index: CoreIndexDefinition, interval: CoreInterval,
    order: import("./contracts").CoreOrder, limit?: number, queryFingerprint: Uint8Array = new Uint8Array(),
    initialPosition?: import("./contracts").CoreIndexCursor, withinOperation = false) => createCoreQuery({
    snapshot: indexSnapshot, table, index, interval, order, ...(limit === undefined ? {} : { limit }), queryFingerprint,
    ...(initialPosition === undefined ? {} : { initialPosition }),
    pendingIndex: () => pendingIndexes.get(encodeBytesToLowercaseHex(index.ref.id)),
    recordRead: consumed => { reads.add(index.ref.id, consumed); return accounting.query(index.ref.id, consumed); },
    chargeDocument: (document, size) => { documentSizes.set(document, size); return accounting.read(table.name.startsWith("_"), size); }, assertOpen,
    operation: withinOperation ? body => body : operation,
  });

  const writeSystem = Effect.fn("CoreTransaction.writeSystem")(function* (name: string, id: Uint8Array, body: DocumentObject | null) {
    const table = yield* Effect.fromResult(tableByName(name, true));
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const previous = yield* read(table, id);
    const document = body === null ? null : { ...body, _id: developerId,
      _creationTime: previous?._creationTime ?? creationTime };
    if (previous === null && document !== null) creationTime = nextUp(creationTime);
    yield* stage(table, id, document);
    if (name === TABLES && document !== null) {
      registry = registry.withTable(yield* Effect.fromResult(parseCoreTableRecord(yield* Effect.fromResult(systemDocument(document)), null)));
    } else if (name === INDEXES) {
      registry = registry.withoutIndex(id);
      if (document !== null) registry = yield* Effect.fromResult(registry.withIndex(
        yield* Effect.fromResult(parseCoreIndexRecord(yield* Effect.fromResult(systemDocument(document)), null))));
    } else if (name === SCHEMAS) {
      registry = registry.withSchemas(yield* Effect.fromResult(registry.schemas.withDocument(namespace,
        previous === null ? undefined : yield* Effect.fromResult(systemDocument(previous)),
        document === null ? undefined : yield* Effect.fromResult(systemDocument(document)))));
    }
    if(name===TABLES||name===INDEXES||name===SCHEMAS)registryAfter = registry;
  });

  const ensureUserTable = Effect.fn("CoreTransaction.ensureUserTable")(function* (name: string) {
    yield* Schema.decodeUnknownEffect(SchemaManifestAppTableNameSchema)(name).pipe(Effect.mapError(invalid));
    yield* Effect.fromResult(mappingRead());
    const existing = registry.table(name, namespace);
    if (existing !== undefined) return existing.definition;
    const active = [...registry.tables.values()].filter(record => record.definition.state === "active"
      && !record.definition.name.startsWith("_"));
    if (active.length >= 10000) return yield* new CoreTransactionError({ reason: "tooManyTables", cause: { limit: 10000 } });
    let number = 10001;
    for (const record of registry.tables.values()) if (coreNamespaceKey(record.definition.namespace) === coreNamespaceKey(namespace)
      && record.definition.number >= number) number = record.definition.number + 1;
    if (number > 0xffff_ffff) return yield* new CoreTransactionError({ reason: "capacity" });
    const tabletId = (yield* input.newInternalId).slice();
    const definition: CoreTableDefinition = { name, number, tabletId, namespace, state: "active", indexes: [] };
    registry = registry.withTable({ definition, id: tabletId.slice(), ts: null });
    const created: CoreIndexRecord[] = [];
    for (const [indexName, fields] of [["by_id", []], ["by_creation_time", ["_creationTime"]]] as const) {
      const record: CoreIndexRecord = { ref: { id: (yield* input.newInternalId).slice() }, tableId: tabletId,
        name: indexName, fields, state: { type: "Enabled" }, ts: null };
      created.push(record);
      registry = yield* Effect.fromResult(registry.withIndex(record));
    }
    yield* writeSystem(TABLES, tabletId, tableDocument(definition));
    for (const index of created) yield* writeSystem(INDEXES, index.ref.id, coreIndexMetadataValue(index));
    registryAfter = registry;
    const selected = registry.table(name, namespace);
    if (selected === undefined) return yield* new CorePersistenceError({ reason: "corruptData" });
    return selected.definition;
  });

  const getSystem = Effect.fn("CoreTransaction.getSystem")(function* (name: string, id: string) {
    const table = yield* Effect.fromResult(tableByName(name, true));
    const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), invalid));
    if (decoded.tableNumber !== table.number) return yield* invalid();
    yield* Effect.fromResult(chargePointQuery(table, decoded.internalId));
    const document = yield* read(table, decoded.internalId);
    return document === null ? Option.none<CoreSystemDocument>() : Option.some(yield* Effect.fromResult(systemDocument(document)));
  });

  const querySystem = Effect.fn("CoreTransaction.querySystem")(function* (name: string, indexName: string, eqValues: readonly DocumentValue[]) {
    const table = yield* Effect.fromResult(tableByName(name, true));
    const index = table.indexes.find(candidate => candidate.name === indexName);
    if (index === undefined) return yield* new CorePersistenceError({ reason: "corruptData" });
    const parts: Uint8Array[] = [];
    for (const value of eqValues) parts.push(yield* Effect.fromResult(Result.mapError(encodeIndexValue(value), invalid)));
    const start = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) { start.set(part, offset); offset += part.length; }
    let last = start.length - 1;
    while (last >= 0 && start[last] === 255) last -= 1;
    const end = last < 0 ? null : start.slice(0, last + 1);
    if (end !== null) end[last] = (end[last] ?? 0) + 1;
    const query = scanner(table, index, { start, end }, "asc", undefined, undefined, undefined, true);
    const rows: CoreSystemDocument[] = [];
    while (true) {
      const page = yield* query.nextPage({ maxResults: 128, maxBytes: Number.MAX_SAFE_INTEGER });
      for (const document of page.documents) rows.push(yield* Effect.fromResult(systemDocument(document)));
      if (page.done) break;
    }
    return rows;
  });

  const transaction: CoreTransaction = Object.freeze({
    timestamp: snapshot.timestamp, unixTime,
    usage: Effect.sync(() => accounting.snapshot()),
    tableMappings: operation(Effect.gen(function* () {
      yield* Effect.fromResult(mappingRead());
      return Object.freeze([...registry.tables.values()].filter(record => record.definition.state === "active"
        && !record.definition.name.startsWith("_") && coreNamespaceKey(record.definition.namespace) === coreNamespaceKey(namespace))
        .map(record => Object.freeze({ tableId: record.definition.number, logicalName: record.definition.name })));
    })),
    selectProgram: Effect.fn("CoreTransaction.selectProgram")((path: string) => operation(Effect.gen(function* () {
      const head = registry.head(path);
      const program = head === undefined ? undefined : registry.program(head.identity);
      if (program === undefined || head === undefined)
        return yield* new CoreTransactionError({ reason: "programUnavailable" });
      const table = yield* Effect.fromResult(tableByName(PROGRAMS, true));
      for (const id of [head.id, program.id]) {
        yield* Effect.fromResult(chargePointQuery(table, id));
        yield* Effect.fromResult(chargeDocument(table, yield* read(table, id)));
      }
      return Object.freeze({ identity: Object.freeze({ ...program.definition.identity }),
        metadata: (yield* Effect.fromResult(Result.mapError(captureCoreObject(program.definition.metadata, true), invalid))).value,
      }) satisfies CoreProgramDefinition;
    }))),
    tableNumber: Effect.fn("CoreTransaction.tableNumber")((name: string) => operation(Effect.gen(function* () {
      return (yield* Effect.fromResult(tableByName(name, false))).number;
    }))),
    normalizeId: Effect.fn("CoreTransaction.normalizeId")((name: string, id: unknown) => operation(Effect.gen(function* () {
      if (input.native === undefined) yield* Effect.fromResult(mappingRead());
      const table = registry.table(name,namespace)?.definition;
      if(table===undefined)return Option.none<string>();
      yield* Effect.fromResult(checkCoreTableAccess(table, "read", input.native?.authority));
      return yield* Effect.fromResult(Result.mapError(normalizeDocumentId(table.number, id), invalid));
    }))),
    get: Effect.fn("CoreTransaction.get")((id: string) => operation(Effect.gen(function* () {
      const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause })));
      if (input.native === undefined) yield* Effect.fromResult(mappingRead());
      if (registry.tableByNumber(decoded.tableNumber, namespace) === undefined) return Option.none();
      const selected = yield* Effect.fromResult(resolve(id, false));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      const document = yield* read(selected.table, selected.internalId);
      yield* Effect.fromResult(chargeDocument(selected.table, document));
      return document === null ? Option.none() : Option.some(yield* Effect.fromResult(Result.mapError(captureDocumentObject(document), invalid)));
    }))),
    insert: Effect.fn("CoreTransaction.insert")((tableName: string, value: unknown) => operation(Effect.gen(function* () {
      const table = input.native === undefined ? yield* ensureUserTable(tableName)
        : yield* Effect.fromResult(tableByName(tableName, false));
      yield* Effect.fromResult(checkCoreTableAccess(table, "write", input.native?.authority));
      const body = yield* validateUserBody(table, value);
      const internalId = (yield* input.newInternalId).slice();
      const id = yield* Effect.fromResult(publicDocumentId(table, internalId));
      if ((yield* read(table, internalId)) !== null) return yield* Effect.fail(new CoreTransactionError({ reason: "conflict" }));
      const document = { ...body, _id: id, _creationTime: creationTime };
      creationTime = nextUp(creationTime);
      yield* stage(table, internalId, document);
      return id;
    }))),
    patch: Effect.fn("CoreTransaction.patch")((id: string, value: unknown) => operation(Effect.gen(function* () {
      const selected = yield* Effect.fromResult(resolve(id, false));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      const patch = yield* Effect.fromResult(Result.mapError(captureDocumentPatch(value), invalid));
      if (Object.hasOwn(patch, "_id") || Object.hasOwn(patch, "_creationTime")) return yield* Effect.fail(invalid());
      const document = yield* read(selected.table, selected.internalId);
      yield* Effect.fromResult(chargeDocument(selected.table, document));
      if (document === null) return yield* Effect.fail(new CoreTransactionError({ reason: "missingDocument" }));
      const { _id: originalId, _creationTime: originalTime, ...remainingFields } = document;
      if (originalId === undefined || originalTime === undefined)
        return yield* Effect.die(new Error("Validated core document lost its system fields"));
      const body = Object.fromEntries(Object.entries(remainingFields));
      for (const [key, next] of Object.entries(patch)) {
        if (next === undefined) delete body[key];
        else body[key] = next;
      }
      const captured = yield* validateUserBody(selected.table, body);
      yield* stage(selected.table, selected.internalId, { ...captured, _id: originalId, _creationTime: originalTime });
    }))),
    replace: Effect.fn("CoreTransaction.replace")((id: string, value: unknown) => operation(Effect.gen(function* () {
      const selected = yield* Effect.fromResult(resolve(id, false));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      const body = yield* validateUserBody(selected.table, value);
      const previous = yield* read(selected.table, selected.internalId);
      yield* Effect.fromResult(chargeDocument(selected.table, previous));
      if (previous === null) return yield* Effect.fail(new CoreTransactionError({ reason: "missingDocument" }));
      const { _id: originalId, _creationTime: originalTime } = previous;
      if (originalId === undefined || originalTime === undefined)
        return yield* Effect.die(new Error("Validated core document lost its system fields"));
      yield* stage(selected.table, selected.internalId, { ...body, _id: originalId, _creationTime: originalTime });
    }))),
    delete: Effect.fn("CoreTransaction.delete")((id: string) => operation(Effect.gen(function* () {
      const selected = yield* Effect.fromResult(resolve(id, false));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      yield* Effect.fromResult(chargeDocument(selected.table, yield* read(selected.table, selected.internalId)));
      yield* stage(selected.table, selected.internalId, null);
    }))),
    startQuery: Effect.fn("CoreTransaction.startQuery")((request: import("./api").CoreQueryRequest) => operation(Effect.gen(function* () {
      const query = yield* Effect.fromResult(Result.mapError(captureLogicalQuery(request.query),
        cause => new CoreQueryInputError({ reason: "invalidQuery", cause })));
      const source = query.source;
      const separator = source.type === "IndexRange" ? source.indexName.indexOf(".") : -1;
      if (source.type === "IndexRange" && (separator <= 0 || separator === source.indexName.length - 1))
        return yield* Effect.fail(new CoreQueryInputError({ reason: "invalidQuery" }));
      const tableName = source.type === "FullTableScan" ? source.tableName : source.indexName.slice(0, separator);
      const indexName = source.type === "FullTableScan" ? "by_creation_time" : source.indexName.slice(separator + 1);
      if(source.type==="FullTableScan"&&registry.table(tableName,namespace)===undefined){
        yield* Effect.fromResult(mappingRead());
        const queryFingerprint=fingerprintQuery(query,["_creationTime"]);
        if(request.cursor!==undefined&&!bytesEqual(request.cursor.queryFingerprint,queryFingerprint))return yield* new CoreQueryInputError({reason:"invalidCursor"});
        return createCoreEmptyQuery({queryFingerprint,operation,...(request.cursor===undefined?{}:{initialPosition:request.cursor.position}),
          ...(query.operators.length===0?{}:{limit:Math.min(...query.operators.map(operator=>operator.limit))})});
      }
      const { table, index } = yield* Effect.fromResult(Result.mapError(selectIndex(tableName, indexName), error =>
        error.reason === "missingTable" || error.reason === "missingIndex" || error.reason === "indexUnavailable"
          ? new CoreQueryInputError({ reason: "invalidQuery", cause: error }) : error));
      const original = source.type === "FullTableScan" ? { start: new Uint8Array(), end: null }
        : yield* Effect.fromResult(Result.mapError(compileIndexRange(source.range, index.fields),
          cause => new CoreQueryInputError({ reason: "invalidQuery", cause })));
      const queryFingerprint = fingerprintQuery(query, index.fields);
      const cursor = request.cursor;
      if (cursor !== undefined && !bytesEqual(cursor.queryFingerprint, queryFingerprint))
        return yield* Effect.fail(new CoreQueryInputError({ reason: "invalidCursor" }));
      let interval: CoreInterval = original;
      if (cursor?.position.kind === "end") interval = { start: new Uint8Array(), end: new Uint8Array() };
      else if (cursor?.position.kind === "after") {
        const key = cursor.position.key;
        if (source.order === "asc") {
          if (original.end !== null && compareBytesLexicographically(key, original.end) >= 0)
            interval = { start: new Uint8Array(), end: new Uint8Array() };
          else if (compareBytesLexicographically(key, original.start) >= 0)
            interval = splitIndexRangeAfter(original, key, source.order).remaining;
        } else if (compareBytesLexicographically(key, original.start) <= 0)
          interval = { start: new Uint8Array(), end: new Uint8Array() };
        else if (original.end === null || compareBytesLexicographically(key, original.end) < 0)
          interval = splitIndexRangeAfter(original, key, source.order).remaining;
      }
      const limit = query.operators.length === 0 ? undefined : Math.min(...query.operators.map(operator => operator.limit));
      return scanner(table, index, interval, source.order, limit, queryFingerprint, cursor?.position);
    }))),
    scan: Effect.fn("CoreTransaction.scan")((tableName: string, indexName: string, options = {}) => operation(Effect.gen(function* () {
      const { table, index } = yield* Effect.fromResult(selectIndex(tableName, indexName));
      const order = options.order ?? "asc";
      const limit = options.limit ?? Math.min((input.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS).documentsRead + 1, Number.MAX_SAFE_INTEGER);
      if (!Number.isSafeInteger(limit) || limit < 0) return yield* Effect.fail(invalid());
      const query = scanner(table, index, options.interval ?? { start: null, end: null }, order,
        limit, undefined, undefined, true);
      const results: DocumentObject[] = [];
      while (true) {
        const page = yield* query.nextPage({ maxResults: 128, maxBytes: Number.MAX_SAFE_INTEGER });
        results.push(...page.documents);
        if (page.done) break;
      }
      return Object.freeze(results);
    }))),
    finalize: Effect.fn("CoreTransaction.finalize")(() => Effect.gen(function* () {
      yield* assertOpen();
      if (input.readonly) return yield* new CoreTransactionError({ reason: "readonly" });
      if (inflight !== 0) return yield* new CoreTransactionError({ reason: "inflight" });
      markClosed();
      input.onClosed?.();
      if (registryAfter !== undefined) yield* authenticateCoreNativeRegistry(registryAfter, input.registry);
      return input.vault.issue(Object.freeze({ timestamp: snapshot.timestamp, reads: reads.snapshot(),
        changes: Object.freeze([...writes.values()]), registry: input.registry,
        ...(nativeObservations === undefined ? {} : { nativeObservations: nativeObservations.snapshot() }),
        ...(registryAfter === undefined ? {} : { registryAfter }),
        ...(input.claim === undefined ? {} : { claim: input.claim }), usage: accounting.snapshot() }));
    })),
    abort: Effect.fn("CoreTransaction.abort")(() => Effect.andThen(Effect.sync(markClosed),
      operations.withPermits(1)(Effect.sync(() => input.onClosed?.())))),
  });

  const nativeFind: CoreNativeOperations["find"] = Effect.fn("CoreTransaction.nativeFind")((tableName, selection) => operation(Effect.gen(function* () {
    if (nativeObservations === undefined) return yield* invalid();
    const table = yield* Effect.fromResult(tableByName(tableName, false));
    if (selection.kind === "id") {
      const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(selection.id), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause })));
      if (decoded.tableNumber !== table.number) return Object.freeze([]);
      yield* Effect.fromResult(chargePointQuery(table, decoded.internalId));
      const document = yield* read(table, decoded.internalId);
      yield* Effect.fromResult(chargeDocument(table, document));
      return Object.freeze(document === null ? [] : [document]);
    }
    const charged = new Set<DocumentObject>();
    let capturedOwners: ReadonlySet<string> | undefined;
    if (selection.kind === "all") {
      if (!nativeObservations.hasTable(table)) {
        const byId = table.indexes.find(index => index.name === "by_id");
        if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
        const interval = { start: null, end: null };
        const membership = yield* nativeMembership(table, byId, interval, charged);
        nativeRead(membership.timestamp, byId, interval);
        nativeObservations.rememberTable(table, membership);
      }
    } else {
      const { index, interval } = yield* Effect.fromResult(nativeSlotSelection(table, selection.field, selection.value));
      // A complete table replaces future storage selection, but does not widen
      // any key membership that was captured before that table scan.
      if (!nativeObservations.hasTable(table) || nativeObservations.slot(index, interval) !== undefined) {
        const selected = yield* nativeSlot(table, selection.field, selection.value, charged);
        capturedOwners = new Set(selected.membership.rows.map(row => row.id));
      }
    }
    const candidates = new Map(nativeObservations.remembered(table)
      .filter(row => capturedOwners === undefined || capturedOwners.has(row.id)).map(row => [row.id, row.observation.document]));
    for (const [id, change] of writes) if (bytesEqual(change.table.tabletId, table.tabletId)) candidates.set(id, change.finalDocument);
    const result: DocumentObject[] = [];
    for (const [id, document] of [...candidates].toSorted(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
      if (document === null || (selection.kind === "equal" && document[selection.field] !== selection.value)) continue;
      if (!charged.has(document)) yield* Effect.fromResult(chargeDocument(table, document));
      if (document._id !== id) return yield* new CorePersistenceError({ reason: "corruptData" });
      result.push(document);
    }
    return Object.freeze(result);
  })));

  const nativeOperations: CoreNativeOperations | undefined = input.native === undefined ? undefined : Object.freeze({
    get: transaction.get, insert: transaction.insert, patch: transaction.patch, replace: transaction.replace,
    delete: transaction.delete, normalizeId: transaction.normalizeId, find: nativeFind,
  });

  const internals: CoreTransactionInternals = {
    namespace, timestamp: snapshot.timestamp,
    get registry() { return registry; },
    get schemaRegistry() { return registry.schemas; },
    transaction,
    ...(nativeOperations === undefined ? {} : { nativeOperations }),
    count: Effect.fn("CoreTransaction.count")(function*(tableId:Uint8Array){
      const table=registry.tableByTablet(tableId)?.definition;
      const byId=table?.indexes.find(index=>index.name==="by_id");
      if(table===undefined||byId===undefined)return yield* invalid();
      reads.add(byId.ref.id,{start:null,end:null});
      if(input.counts===undefined)return Option.none<bigint>();
      let count=input.counts.count(tableId);
      for(const change of writes.values())if(bytesEqual(change.table.tabletId,tableId)) count+=BigInt(change.finalDocument===null?0:1)-BigInt(change.originalDocument===null?0:1);
      if(count<0n||count>0xffff_ffff_ffff_ffffn)return yield* new CorePersistenceError({reason:"corruptData",cause:"Table count overflow or underflow"});
      return Option.some(count);
    }),
    runSystem: operation,
    getSystem, querySystem,
    insertSystem: Effect.fn("CoreTransaction.insertSystem")(function* (name: string, body: DocumentObject) {
      const id = (yield* input.newInternalId).slice();
      yield* writeSystem(name, id, body);
      return yield* Effect.fromResult(publicDocumentId(yield* Effect.fromResult(tableByName(name, true)), id));
    }),
    replaceSystem: Effect.fn("CoreTransaction.replaceSystem")(function* (name: string, id: string, body: DocumentObject) {
      const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), invalid));
      if (decoded.tableNumber !== (yield* Effect.fromResult(tableByName(name, true))).number) return yield* invalid();
      yield* writeSystem(name, decoded.internalId, body);
    }),
    deleteSystem: Effect.fn("CoreTransaction.deleteSystem")(function* (name: string, id: string) {
      const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), invalid));
      if (decoded.tableNumber !== (yield* Effect.fromResult(tableByName(name, true))).number) return yield* invalid();
      yield* writeSystem(name, decoded.internalId, null);
    }),
    ensureUserTable,
    tableExists: name => { if(input.native===undefined){const result=mappingRead(); if(Result.isFailure(result))throw new Error("Missing table mapping index");} return registry.table(name, namespace) !== undefined; },
    schemaTableStateIndex: () => {
      const index = registry.table(SCHEMAS, namespace)?.definition.indexes.find(candidate => candidate.name === "by_state");
      if (index === undefined) throw new Error("Schema system table is not initialized");
      return index.ref;
    },
    finishRead: Effect.fn("CoreTransaction.finishRead")(() => Effect.gen(function* () {
      yield* assertOpen();
      if (inflight !== 0) return yield* new CoreTransactionError({ reason: "inflight" });
      if (writes.size !== 0 || registryAfter !== undefined || input.claim !== undefined)
        return yield* new CoreTransactionError({ reason: "readonly" });
      markClosed();
      input.onClosed?.();
      // Standalone native reads use one fixed data snapshot. Their completion
      // token retains conservative source dependencies for every selected slot.
      if (nativeObservations !== undefined) {
        const packet = nativeObservations.snapshot();
        for (const group of packet.dependencies) for (const dependency of group.reads)
          for (const interval of dependency.intervals) reads.add(dependency.indexId, interval);
        for (const slot of packet.uniqueSlots) reads.add(slot.index.ref.id, slot.interval);
      }
      return Object.freeze({ timestamp: snapshot.timestamp, get reads() { return reads.snapshot(); } });
    })),
    readPrivate: (tableName, id) => operation(Effect.gen(function* () {
      const table = yield* Effect.fromResult(tableByName(tableName, true));
      yield* Effect.fromResult(chargePointQuery(table, id));
      const document = yield* read(table, id);
      yield* Effect.fromResult(chargeDocument(table, document));
      return Option.fromNullOr(document);
    })),
    writePrivate: (tableName, id, body) => operation(writeSystem(tableName, id, body)),
    setRegistryAfter: value => { registry = value; registryAfter = value; },
    addIndexRead: (indexId, interval) => reads.add(indexId, interval),
  };
  return internals;
}

/** Coalesced first-original/final writes; unchanged ordinary keys still get a live revision. */
export function deriveCoreWriteBatch(transaction: CoreFinalizedState, timestamp: bigint): Result.Result<CoreWriteBatch, CoreTransactionError> {
  return Result.gen(function* () {
    const documents: CoreDocumentLogEntry[] = [];
    const indexes = new Map<string, import("./contracts").CorePersistenceIndexEntry>();
    for (const change of transaction.changes.toSorted((a, b) => a.table.number - b.table.number)) {
      if (change.originalDocument === null && change.finalDocument === null) continue;
      const jsonValue = change.finalDocument === null ? new Uint8Array()
        : yield* Result.mapError(encodeDocumentValue(change.finalDocument), invalid);
      documents.push(Object.freeze({ ts: timestamp, tableId: change.table.tabletId.slice(), id: change.id.slice(),
        jsonValue, deleted: change.finalDocument === null, prevTs: change.original?.ts ?? null }));
      for (const index of (transaction.registryAfter ?? transaction.registry).indexesForTablet(change.table.tabletId)) {
        if (change.originalDocument !== null) {
          const key = yield* documentIndexKey(index, change.originalDocument);
          indexes.set(`${encodeBytesToLowercaseHex(index.ref.id)}:${encodeBytesToLowercaseHex(key)}`, Object.freeze({
            mode: coreIndexWriteMode(index), ts: timestamp, index: index.ref, key, value: null,
            prev: change.original === undefined ? null : { ts: change.original.ts, documentId: change.id.slice() },
          }));
        }
        if (change.finalDocument !== null) {
          const key = yield* documentIndexKey(index, change.finalDocument);
          const identity = `${encodeBytesToLowercaseHex(index.ref.id)}:${encodeBytesToLowercaseHex(key)}`;
          const old = indexes.get(identity);
          indexes.set(identity, Object.freeze({ mode: coreIndexWriteMode(index), ts: timestamp, index: index.ref, key,
            value: { tableId: change.table.tabletId.slice(), documentId: change.id.slice() }, prev: old?.prev ?? null }));
        }
      }
    }
    return Object.freeze({ documents: Object.freeze(documents), indexes: Object.freeze([...indexes.values()]) });
  });
}

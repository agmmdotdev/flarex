/**
 * Mechanisms translated from Convex crates/database/src/{transaction,transaction_index,writes}.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Effect, Option, Result, Semaphore } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { captureDocumentObject, captureDocumentPatch, encodeDocumentValue, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { captureLogicalQuery, compileIndexRange, fingerprintQuery, splitIndexRangeAfter } from "flarex-protocol/index-range";
import { validateValidatorValueV1 } from "flarex-protocol/validator-engine";
import { isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/internal/value-runtime-core";
import { CoreQueryInputError, CoreTransactionError, issueFinalizedTransaction, type CoreError, type CoreFinalizedTransaction,
  type CoreIndexDefinition, type CoreTableDefinition, type CoreTransaction, type CoreTransactionLimits, type CoreTransactionUsage,
  type CoreReadToken, type CoreProgramDefinition } from "./api";
import type { CoreDocumentLogEntry, CoreInterval, CorePersistenceSnapshot, CoreWriteBatch } from "./contracts";
import { CoreRegistry, TABLES, PROGRAMS, publicDocumentId, readDocumentObject } from "./registry";
import { CoreReadSetBuilder, pointInterval, type CoreReadSet } from "./writeLog";
import { CORE_TRANSACTION_REFERENCE_LIMITS, CoreAccounting } from "./accounting";
import { captureCoreDocument, captureCoreObject } from "./document";
import { addIndexMetadataDependency, addTableWriteDependencies } from "./dependencies";
import { createCoreQuery } from "./query";

interface Observation {
  readonly original: CoreDocumentLogEntry | undefined;
  readonly document: DocumentObject | null;
}

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
}

export interface CoreTransactionInternals {
  readonly transaction: CoreTransaction;
  readonly finishRead: () => Effect.Effect<CoreReadToken, CoreError>;
  readonly readPrivate: (table: string, id: Uint8Array) => Effect.Effect<Option.Option<DocumentObject>, CoreError>;
  readonly writePrivate: (table: string, id: Uint8Array, body: DocumentObject | null) => Effect.Effect<void, CoreError>;
  readonly setRegistryAfter: (registry: CoreRegistry) => void;
  readonly addIndexRead: (indexId: Uint8Array, interval: CoreInterval) => void;
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

function field(document: DocumentObject, path: string): DocumentValue | undefined {
  let value: DocumentValue | undefined = document;
  for (const part of path.split(".")) {
    if (value === undefined || !isCanonicalFlarexRuntimeObjectV1(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

export function documentIndexKey(index: CoreIndexDefinition, document: DocumentObject): Result.Result<Uint8Array, CoreTransactionError> {
  const id = document._id;
  if (typeof id !== "string") return Result.fail(invalid());
  return Result.mapError(encodeIndexKey(index.fields.map(path => field(document, path)), id), invalid);
}

/** One operation, one metadata/data snapshot. No SQL or host object enters its state. */
export function createCoreTransaction(input: Readonly<{
  snapshot: CorePersistenceSnapshot;
  registry: CoreRegistry;
  now: bigint;
  newInternalId: Effect.Effect<Uint8Array>;
  vault: CoreFinalizationVault;
  claim?: import("./api").CoreRequestClaim;
  limits?: CoreTransactionLimits;
  readonly?: boolean;
  assertOwnerOpen?: Effect.Effect<void, CoreError>;
  onClosed?: () => void;
}>): CoreTransactionInternals {
  const { snapshot, registry } = input;
  const reads = new CoreReadSetBuilder();
  const observations = new Map<string, Observation>();
  const writes = new Map<string, CoreDocumentChange>();
  const pendingIndexes = new Map<string, BTree<Uint8Array, DocumentObject | null>>();
  const accounting = new CoreAccounting(input.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS);
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

  function metadataRead(table: CoreTableDefinition): Result.Result<void, CoreTransactionError> {
    const tables = registry.table(TABLES);
    const index = tables?.definition.indexes.find(value => value.name === "by_id");
    const record = registry.table(table.name);
    if (tables === undefined || index === undefined || record === undefined) return Result.fail(invalid());
    return Result.gen(function* () {
      const id = yield* publicDocumentId(tables.definition, record.id);
      const key = yield* Result.mapError(encodeIndexKey([], id), invalid);
      reads.add(index.ref.id, pointInterval(key));
    });
  }

  const tableByName = (name: string, privateAccess: boolean): Result.Result<CoreTableDefinition, CoreTransactionError> => {
    const record = registry.table(name);
    if (record === undefined || (!privateAccess && name.startsWith("_"))) return Result.fail(new CoreTransactionError({ reason: "missingTable" }));
    return Result.map(metadataRead(record.definition), () => record.definition);
  };

  function chargePointQuery(table: CoreTableDefinition, id: Uint8Array): Result.Result<void, CoreTransactionError> {
    return Result.gen(function* () {
      const byId = table.indexes.find(index => index.name === "by_id");
      if (byId === undefined) return yield* Result.fail(invalid());
      yield* addIndexMetadataDependency(reads, registry, byId);
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
    const record = registry.tableByNumber(decoded.tableNumber);
    if (record === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "missingTable" }));
    const table = yield* tableByName(record.definition.name, privateAccess);
    return { table, internalId: decoded.internalId };
  });

  const observe = Effect.fn("CoreTransaction.observe")(function* (table: CoreTableDefinition, id: Uint8Array) {
    yield* assertOpen();
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const cached = observations.get(developerId);
    if (cached !== undefined) return cached;
    const byId = table.indexes.find(index => index.name === "by_id");
    if (byId === undefined || !byId.enabled) return yield* Effect.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    const key = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], developerId), invalid));
    reads.add(byId.ref.id, pointInterval(key));
    const found = yield* snapshot.get(table.tabletId, id);
    yield* assertOpen();
    const borrowed = Option.getOrUndefined(found);
    const original = borrowed === undefined ? undefined : Object.freeze({ ...borrowed,
      tableId: borrowed.tableId.slice(), id: borrowed.id.slice(), jsonValue: borrowed.jsonValue.slice() });
    let document: DocumentObject | null = null;
    if (original !== undefined && !original.deleted) {
      const decoded = yield* Effect.fromResult(readDocumentObject(original, table));
      const measured = yield* Effect.fromResult(Result.mapError(captureCoreDocument(decoded, table.name.startsWith("_")), invalid));
      document = measured.value;
      documentSizes.set(document, measured.semanticSizeBytes);
    }
    const observed = { original, document };
    observations.set(developerId, observed);
    return observed;
  });

  const read = Effect.fn("CoreTransaction.read")(function* (table: CoreTableDefinition, id: Uint8Array) {
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const pending = writes.get(developerId);
    if (pending !== undefined) return pending.finalDocument;
    return (yield* observe(table, id)).document;
  });

  const stage = Effect.fn("CoreTransaction.stage")(function* (table: CoreTableDefinition, id: Uint8Array, document: DocumentObject | null) {
    if (input.readonly) return yield* new CoreTransactionError({ reason: "readonly" });
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const previous = yield* read(table, id);
    const original = yield* observe(table, id);
    yield* assertOpen();
    const captured = document === null ? null : yield* Effect.fromResult(Result.mapError(captureCoreDocument(document, table.name.startsWith("_")), invalid));
    const next = captured?.value ?? null;
    if (captured !== null) documentSizes.set(captured.value, captured.semanticSizeBytes);
    yield* Effect.fromResult(addTableWriteDependencies(reads, registry, table));
    const pendingUpdates: Array<Readonly<{ index: CoreIndexDefinition; oldKey?: Uint8Array; newKey?: Uint8Array }>> = [];
    for (const index of table.indexes) {
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

  function validateUserBody(table: CoreTableDefinition, value: unknown): Result.Result<DocumentObject, CoreTransactionError> {
    return Result.gen(function* () {
      const body = yield* Result.mapError(captureDocumentObject(value), invalid);
      if (Object.hasOwn(body, "_id") || Object.hasOwn(body, "_creationTime")) return yield* Result.fail(invalid());
      yield* Result.mapError(validateValidatorValueV1(table.validator, body, { idPolicy: {
        mode: "tableAware", check: (name, id) => {
          const expected = registry.table(name);
          if (expected === undefined) return "unavailable";
          return Result.match(decodeDocumentId(id), { onFailure: () => "invalid" as const,
            onSuccess: decoded => decoded.tableNumber === expected.definition.number ? "valid" as const : "invalid" as const });
        },
      } }), cause => new CoreTransactionError({ reason: "documentValidation", cause }));
      return body;
    });
  }

  const selectIndex = (tableName: string, indexName: string) => Result.gen(function* () {
    const table = yield* tableByName(tableName, false);
    const index = table.indexes.find(value => value.name === indexName);
    if (index === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "missingIndex" }));
    if (!index.enabled) return yield* Result.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    yield* addIndexMetadataDependency(reads, registry, index);
    return { table, index };
  });

  const scanner = (table: CoreTableDefinition, index: CoreIndexDefinition, interval: CoreInterval,
    order: import("./contracts").CoreOrder, limit?: number, queryFingerprint: Uint8Array = new Uint8Array(),
    initialPosition?: import("./contracts").CoreIndexCursor, withinOperation = false) => createCoreQuery({
    snapshot, table, index, interval, order, ...(limit === undefined ? {} : { limit }), queryFingerprint,
    ...(initialPosition === undefined ? {} : { initialPosition }),
    pendingIndex: () => pendingIndexes.get(encodeBytesToLowercaseHex(index.ref.id)),
    recordRead: consumed => { reads.add(index.ref.id, consumed); return accounting.query(index.ref.id, consumed); },
    chargeDocument: (document, size) => { documentSizes.set(document, size); return accounting.read(false, size); }, assertOpen,
    operation: withinOperation ? body => body : operation,
  });

  const transaction: CoreTransaction = Object.freeze({
    timestamp: snapshot.timestamp, unixTime,
    usage: Effect.sync(() => accounting.snapshot()),
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
      const table = yield* Effect.fromResult(tableByName(name, false));
      return Result.match(decodeDocumentId(id), { onFailure: () => Option.none<string>(),
        onSuccess: decoded => decoded.tableNumber === table.number ? Option.some(decoded.id) : Option.none<string>() });
    }))),
    get: Effect.fn("CoreTransaction.get")((id: string) => operation(Effect.gen(function* () {
      const selected = yield* Effect.fromResult(resolve(id, false));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      const document = yield* read(selected.table, selected.internalId);
      yield* Effect.fromResult(chargeDocument(selected.table, document));
      return document === null ? Option.none() : Option.some(yield* Effect.fromResult(Result.mapError(captureDocumentObject(document), invalid)));
    }))),
    insert: Effect.fn("CoreTransaction.insert")((tableName: string, value: unknown) => operation(Effect.gen(function* () {
      const table = yield* Effect.fromResult(tableByName(tableName, false));
      const body = yield* Effect.fromResult(validateUserBody(table, value));
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
      const captured = yield* Effect.fromResult(validateUserBody(selected.table, body));
      yield* stage(selected.table, selected.internalId, { ...captured, _id: originalId, _creationTime: originalTime });
    }))),
    replace: Effect.fn("CoreTransaction.replace")((id: string, value: unknown) => operation(Effect.gen(function* () {
      const selected = yield* Effect.fromResult(resolve(id, false));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      const body = yield* Effect.fromResult(validateUserBody(selected.table, value));
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
      const { table, index } = yield* Effect.fromResult(Result.mapError(selectIndex(tableName, indexName), error =>
        error.reason === "missingTable" || error.reason === "missingIndex"
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
      return input.vault.issue(Object.freeze({ timestamp: snapshot.timestamp, reads: reads.snapshot(),
        changes: Object.freeze([...writes.values()]), registry,
        ...(registryAfter === undefined ? {} : { registryAfter }),
        ...(input.claim === undefined ? {} : { claim: input.claim }), usage: accounting.snapshot() }));
    })),
    abort: Effect.fn("CoreTransaction.abort")(() => Effect.andThen(Effect.sync(markClosed),
      operations.withPermits(1)(Effect.sync(() => input.onClosed?.())))),
  });

  return {
    transaction,
    finishRead: Effect.fn("CoreTransaction.finishRead")(() => Effect.gen(function* () {
      yield* assertOpen();
      if (inflight !== 0) return yield* new CoreTransactionError({ reason: "inflight" });
      if (writes.size !== 0 || registryAfter !== undefined || input.claim !== undefined)
        return yield* new CoreTransactionError({ reason: "readonly" });
      markClosed();
      input.onClosed?.();
      return Object.freeze({ timestamp: snapshot.timestamp, get reads() { return reads.snapshot(); } });
    })),
    readPrivate: (tableName, id) => operation(Effect.gen(function* () {
      const table = yield* Effect.fromResult(tableByName(tableName, true));
      yield* Effect.fromResult(chargePointQuery(table, id));
      const document = yield* read(table, id);
      yield* Effect.fromResult(chargeDocument(table, document));
      return Option.fromNullOr(document);
    })),
    writePrivate: (tableName, id, body) => operation(Effect.gen(function* () {
      const table = yield* Effect.fromResult(tableByName(tableName, true));
      const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
      const previous = yield* read(table, id);
      const document = body === null ? null : { ...body, _id: developerId,
        _creationTime: previous?._creationTime ?? creationTime };
      if (previous === null && document !== null) creationTime = nextUp(creationTime);
      yield* stage(table, id, document);
    })),
    setRegistryAfter: value => { registryAfter = value; },
    addIndexRead: (indexId, interval) => reads.add(indexId, interval),
  };
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
      for (const index of change.table.indexes) {
        if (change.originalDocument !== null) {
          const key = yield* documentIndexKey(index, change.originalDocument);
          indexes.set(`${encodeBytesToLowercaseHex(index.ref.id)}:${encodeBytesToLowercaseHex(key)}`, Object.freeze({
            mode: "scanComplete", ts: timestamp, index: index.ref, key, value: null,
            prev: change.original === undefined ? null : { ts: change.original.ts, documentId: change.id.slice() },
          }));
        }
        if (change.finalDocument !== null) {
          const key = yield* documentIndexKey(index, change.finalDocument);
          const identity = `${encodeBytesToLowercaseHex(index.ref.id)}:${encodeBytesToLowercaseHex(key)}`;
          const old = indexes.get(identity);
          indexes.set(identity, Object.freeze({ mode: "scanComplete", ts: timestamp, index: index.ref, key,
            value: { tableId: change.table.tabletId.slice(), documentId: change.id.slice() }, prev: old?.prev ?? null }));
        }
      }
    }
    return Object.freeze({ documents: Object.freeze(documents), indexes: Object.freeze([...indexes.values()]) });
  });
}

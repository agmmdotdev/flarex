/**
 * Mechanisms translated from Convex crates/database/src/{transaction,transaction_index,writes}.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Effect, Exit, Option, Result, Schema, Semaphore } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { SchemaManifestAppTableNameSchema } from "flarex-protocol/schema-manifest";
import { decodeDocumentId, normalizeDocumentId } from "flarex-protocol/document-id";
import { captureDocumentObject, captureDocumentPatch, encodeDocumentValue, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey, encodeIndexValue } from "flarex-protocol/index-key";
import { captureLogicalQuery, compileIndexRange, fingerprintQuery, incrementIndexKeyPrefix, splitIndexRangeAfter } from "flarex-protocol/index-range";
import { CoreNativeQueryError, CoreNativeUniqueConflict, CoreNativeReferencePlanError, CoreNativeSetNullIntentSchema, CoreQueryInputError, CoreTransactionError, issueFinalizedTransaction, issueCoreNativePendingDelete, type CoreNativePendingDelete, type CoreError, type CoreFinalizedTransaction,
  type CoreIndexDefinition, type CoreTableDefinition, type CoreTransaction, type CoreTransactionLimits, type CoreTransactionUsage,
  type CoreReadToken, type CoreProgramDefinition, type CoreNativeOperations, type CoreNativeLimits, type CoreDatabaseOptions } from "./api";
import type { CoreApplicationInsertOperations, CoreApplicationReadOperations, CoreNativeSetNullIntent, CoreNativeReferenceReplacement } from "./api";
import { CorePersistenceError, CoreTimestampSchema, type CoreDocumentLogEntry, type CoreHydratedIndexEntry, type CoreIndexPage, type CoreIndexScan, type CoreInterval, type CorePersistence, type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import { CoreRegistry, TABLES, INDEXES, SCHEMAS, PROGRAMS, publicDocumentId, readDocumentObject, tableDocument, parseCoreTableRecord } from "./registry";
import { coreNamespaceKey, type CoreTableNamespace } from "./namespace";
import type { CoreNativeScopeExclusionGrant, CoreSettlementAuthorization } from "./nativeScopeExclusion";
import { CoreSchemaModel } from "./schemaModel";
import type { CoreSchemaRegistry } from "./schemaRegistry";
import { coreIndexMetadataValue, coreIndexWriteMode, isCoreIndexEnabled, parseCoreIndexRecord, type CoreIndexRecord } from "./indexState";
import { CoreReadSetBuilder, keyInInterval, pointInterval, type CoreReadSet, type CoreWriteLogSnapshot } from "./writeLog";
import { CORE_TRANSACTION_REFERENCE_LIMITS, CoreAccounting } from "./accounting";
import { captureCoreDocument, captureCoreObject, incrementCoreCreationTime } from "./document";
import { addIndexMetadataDependency, addTableSemanticDependency, addTableWriteDependencies, coreMetadataReadSet } from "./dependencies";
import { captureCoreIndexRange, createCoreEmptyQuery, createCoreQuery } from "./query";
import { createCoreIndexSnapshot } from "./indexSnapshot";
import type { CoreTableCounts } from "./tableCounts";
import { documentIndexKey } from "./documentIndex";
import { authenticateCoreNativeRegistry, assertCoreHistoricalNativeTable, checkCoreNativeAuthority, checkCoreTableAccess, coreNativeMetadataReads,
  checkCoreApplicationInsertAuthority, coreApplicationInsertMetadataReads, coreNativeRelationalRows,
  checkCoreApplicationReadAuthority, coreApplicationReadMetadataReads,
  coreNativeConstraintFields, coreNativeEligibilityMatches, sameCoreNativeIdentity, type CoreApplicationInsertAuthority, type CoreApplicationReadAuthority, type CoreNativeAuthority,
  type CoreNativeProtectedReference } from "./nativePolicy";
import type { CoreSchemaBundle } from "./schemaBundle";
import { encodeCanonicalJson, isJson, isJsonObject, type JsonObject } from "flarex-protocol/json";
import { decodeCoreSchemaMetadata } from "./schemaTypes";
import { parseCoreSchema } from "./schemaJson";
import { capturePrivateJsonData, useCapturedPrivateJsonData } from "../values/privateJsonData";
import { preparePostgresRelationalBatch, inspectPostgresRelationalBatch, decodePostgresRelationalMatches,
  type PostgresRelationalPredicateFailure } from "../values/postgresRelationalPredicate";
import { inspectRelationalRealNormalization } from "../values/relationalRows";
import { retainRelationalFailure } from "../values/relationalFailure";
import { CoreNativeActivityOwner } from "./nativeActivity";
import { coreNativeRelationalRow } from "./nativeRelationalQuery";
import { CoreNativeObservationState, type CoreNativeMembership,
  type CoreNativeObservations } from "./nativeObservations";
import { captureCoreNativeWhere, coreNativeUniqueSelection, coreNativeUniqueValues, planCoreNativeQuery,
  coreNativePageInterval, coreNativePendingIndexDocuments, prepareCoreNativePredicate, type CoreNativeScalar } from "./nativeQuery";
import { captureCoreNativeIndexWindow } from "./nativePage";
import { captureCoreEntropy, createTransactionIdGenerator, type CoreTransactionIdGenerator } from "./transactionIdGenerator";
import { coreNativeReferenceIndexTable, coreNativeReferenceInterval, coreNativeReferenceTargets, selectCoreNativeReference, type CoreNativeReferenceSelection } from "./nativeReferences";
import { isCoreNativeObservedTable, isCoreSystemTable } from "./nativeTableAccess";
import { isCoreNativeManyReference, readCoreNativeMembership } from "./nativeReferenceProjection";
import { coreNativeForeignKeyError, coreNativeKeyInterval, coreNativeKeyTuple, coreNativeKeyWhere, sameCoreNativeKeyTuple, selectCoreNativeForeignKey,
  type CoreNativeForeignKeySelection, type CoreNativeKeyValue } from "./nativeForeignKeys";

export interface CoreDocumentChange {
  readonly table: CoreTableDefinition;
  readonly id: Uint8Array;
  readonly original: CoreDocumentLogEntry | undefined;
  readonly originalDocument: DocumentObject | null;
  readonly finalDocument: DocumentObject | null;
  /** Successful effective protected-edge assignments in this pending graph. */
  readonly protectedReferenceAssignments?: readonly Readonly<{ referenceName: string; targetId: string }>[];
}

export interface CoreFinalizedState {
  readonly namespace: CoreTableNamespace;
  /** Only the trusted database owner may classify request control or global publication. */
  readonly settlementAuthorization?: CoreSettlementAuthorization;
  readonly scopeExclusion?: CoreNativeScopeExclusionGrant;
  readonly timestamp: bigint;
  readonly reads: CoreReadSet;
  /** Exact resource-accounted query intervals, separate from metadata dependencies. */
  readonly queryReads?: CoreReadSet;
  readonly changes: readonly CoreDocumentChange[];
  readonly registry: CoreRegistry;
  readonly registryAfter?: CoreRegistry;
  readonly claim?: import("./api").CoreRequestClaim;
  readonly usage: CoreTransactionUsage;
  readonly limits?: CoreTransactionLimits;
  readonly admissionDeadlineUnixMilliseconds?: number;
  readonly nativeObservations?: CoreNativeObservations;
}

export interface CoreTransactionInternals {
  /** Shared only with trusted metadata owners; never part of the public transaction. */
  readonly idGenerator: CoreTransactionIdGenerator;
  readonly namespace: CoreTableNamespace;
  readonly timestamp: bigint;
  readonly registry: CoreRegistry;
  readonly schemaRegistry: CoreSchemaRegistry;
  readonly transaction: CoreTransaction;
  readonly nativeOperations?: CoreNativeOperations;
  readonly nativeFor: (access: Extract<CoreTransactionNativeAccess, { kind: "native" }>) => Effect.Effect<CoreNativeOperations, CoreError>;
  readonly applicationInsertFor: (access: Extract<CoreTransactionNativeAccess, { kind: "applicationInsert" }>) => Effect.Effect<CoreApplicationInsertOperations, CoreError>;
  readonly applicationReadFor: (access: Extract<CoreTransactionNativeAccess, { kind: "applicationRead" }>) => Effect.Effect<CoreApplicationReadOperations, CoreError>;
  readonly count: (tableId:Uint8Array) => Effect.Effect<Option.Option<bigint>,CoreError>;
  readonly runSystem: <A>(body: Effect.Effect<A, CoreError>) => Effect.Effect<A, CoreError>;
  readonly getSystem: (table: string, id: string) => Effect.Effect<Option.Option<CoreSystemDocument>, CoreError>;
  readonly querySystem: (table: string, index: string, eqValues: readonly DocumentValue[]) => Effect.Effect<readonly CoreSystemDocument[], CoreError>;
  readonly insertSystem: (table: string, body: DocumentObject) => Effect.Effect<string, CoreError>;
  readonly replaceSystem: (table: string, id: string, body: DocumentObject) => Effect.Effect<void, CoreError>;
  readonly deleteSystem: (table: string, id: string) => Effect.Effect<void, CoreError>;
  readonly ensureUserTable: (name: string) => Effect.Effect<CoreTableDefinition, CoreError>;
  readonly tableExists: (name: string) => boolean;
  readonly applicationSchemaRetained: (schemaId: string) => Result.Result<boolean, CorePersistenceError>;
  readonly schemaTableStateIndex: () => import("./contracts").CoreIndexRef;
  readonly finishRead: () => Effect.Effect<CoreReadToken, CoreError>;
  readonly readPrivate: (table: string, id: Uint8Array) => Effect.Effect<Option.Option<DocumentObject>, CoreError>;
  /** Source insertion with a predetermined internal ID, under the trusted control owner. */
  readonly insertPrivate: (table: string, id: Uint8Array, body: DocumentObject) => Effect.Effect<void, CoreError>;
  readonly writePrivate: (table: string, id: Uint8Array, body: DocumentObject | null) => Effect.Effect<void, CoreError>;
  readonly setRegistryAfter: (registry: CoreRegistry) => void;
  readonly addIndexRead: (indexId: Uint8Array, interval: CoreInterval) => void;
}

/** Database-owned immutable child access. A structural copy is not a root participant. */
export type CoreTransactionNativeAccess =
  | Readonly<{ kind: "native"; authority: CoreNativeAuthority; limits: CoreNativeLimits; readonly?: boolean }>
  | Readonly<{ kind: "applicationInsert"; authority: CoreApplicationInsertAuthority; limits: CoreNativeLimits }>
  | Readonly<{ kind: "applicationRead"; authority: CoreApplicationReadAuthority; limits: CoreNativeLimits }>;

interface CoreNativeHistory {
  readonly minimumTimestamp: bigint;
  readonly validate: Effect.Effect<void, CoreError>;
  readonly page: (request: Omit<import("./contracts").CoreIndexHistoryRequest, "start" | "end">) =>
    Effect.Effect<import("./contracts").CoreIndexHistoryPage, CoreError>;
  readonly get: (at: bigint, tableId: Uint8Array, id: Uint8Array) => Effect.Effect<Option.Option<CoreDocumentLogEntry>, CoreError>;
}
interface CoreNativeCapture {
  readonly snapshot: CorePersistenceSnapshot;
  readonly registry: CoreRegistry;
  readonly writeLog: CoreWriteLogSnapshot;
  readonly residentReader?: (request: CoreIndexScan) => CoreIndexPage | undefined;
  readonly metadata?: Readonly<{ registry: CoreRegistry; timestamp: bigint }>;
  readonly history?: CoreNativeHistory;
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
const nativeRelationalPredicateFailure: PostgresRelationalPredicateFailure<CoreError> = (reason, cause) => reason === "storedCorruption"
  ? new CorePersistenceError({ reason: "corruptData", cause }) : reason === "limitExceeded"
    ? new CoreTransactionError({ reason: "capacity", cause }) : reason === "invalidAuthority"
      ? new CoreTransactionError({ reason: "authorityRevoked", cause }) : new CoreNativeQueryError({ reason: "invalidInput", cause });
const encodeNativeRecordedRow = (row: JsonObject): string => encodeCanonicalJson(row, issue => {
  throw new Error("Captured native row lost canonical JSON", { cause: issue });
});

const sameNativeTuple = (left: readonly CoreNativeScalar[], right: readonly CoreNativeScalar[]) =>
  left.length === right.length && left.every((value, position) => Object.is(value, right[position]));
const NativePageCount = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
  ? undefined : "Expected a nonnegative safe native page count"));
const decodeNativePageOptions = Schema.decodeUnknownEffect(Schema.Struct({ indexName: Schema.NonEmptyString,
  offset: NativePageCount, limit: NativePageCount, order: Schema.optionalKey(Schema.Literal("asc")),
}).annotate({ parseOptions: { onExcessProperty: "error" } }));
const decodeNativeIncomingOptions = Schema.decodeUnknownEffect(Schema.Struct({ limit: NativePageCount })
  .annotate({ parseOptions: { onExcessProperty: "error" } }));
const decodeProtectedPageOptions = Schema.decodeUnknownEffect(Schema.Struct({ limit: NativePageCount.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
  position: Schema.optionalKey(Schema.Uint8Array), generation: Schema.optionalKey(NativePageCount),
}).annotate({ parseOptions: { onExcessProperty: "error" } }));
const decodeNativeBatchIds = Schema.decodeUnknownEffect(Schema.Array(Schema.String));
const decodeNativeWriteInvocation = Schema.decodeUnknownEffect(Schema.UndefinedOr(Schema.Struct({
  insertValidation: Schema.optionalKey(Schema.Literal("entityBatch")),
}).annotate({ parseOptions: { onExcessProperty: "error" } })));
const decodeNativeLifecycleInvocation = Schema.decodeUnknownEffect(Schema.UndefinedOr(Schema.Struct({
  allowActiveRestoreUpdate: Schema.optionalKey(Schema.Literal(true)),
}).annotate({ parseOptions: { onExcessProperty: "error" } })));
const decodeNativeReferenceReplacement = Schema.decodeUnknownEffect(Schema.Struct({
  sourceTable: Schema.NonEmptyString, sourceColumn: Schema.NonEmptyString, targetTable: Schema.NonEmptyString,
  targetColumn: Schema.NonEmptyString, targetKey: Schema.NonEmptyString,
  desiredKeys: Schema.Array(Schema.NonEmptyString).check(Schema.isMaxLength(256)),
}).annotate({ parseOptions: { onExcessProperty: "error" } }));
const decodeNativeSetNull = Schema.decodeUnknownEffect(CoreNativeSetNullIntentSchema);
const decodeCreationTimestamp = Schema.decodeUnknownEffect(CoreTimestampSchema);
const decodeAppTableName = Schema.decodeUnknownEffect(SchemaManifestAppTableNameSchema);

function nativeUniqueFailure(table: CoreTableDefinition, descriptor: string, fields: readonly string[],
  candidate: DocumentObject, origin: "input" | "row", access: CoreTransactionNativeAccess | undefined) {
  return Result.gen(function* () {
    const failure = new CoreNativeUniqueConflict({ tableName: table.name, descriptor, fields: Object.freeze([...fields]) });
    const policy = access?.kind === "native" ? coreNativeRelationalRows(access.authority.definition, table.name) : undefined;
    if (policy === undefined) return failure;
    const body = yield* coreNativeRelationalRow(candidate);
    const captured = yield* useCapturedPrivateJsonData(body, Number.MAX_SAFE_INTEGER,
      (reason, cause) => new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause }));
    if (!isJsonObject(captured.value)) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
    const values = yield* coreNativeKeyTuple(captured.value, fields);
    if (values === null) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
    const key = policy.table.keys.find(candidateKey => candidateKey.identity.keyId === descriptor);
    const index = policy.table.indexes.find(candidateIndex => candidateIndex.identity.indexId === descriptor && candidateIndex.kind === "uniqueBtree");
    const declaration = key !== undefined ? { kind: "key" as const, identity: key.identity }
      : index !== undefined ? { kind: "index" as const, identity: index.identity } : undefined;
    if (declaration === undefined) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
    retainRelationalFailure(failure, { origin, kind: "unique", table: policy.table.identity, candidate: captured.value,
      columns: fields, values, key: origin === "input" && key?.kind === "primary" ? { kind: "primary", identity: key.identity }
        : { kind: "nativeUnique", declaration } });
    return failure;
  });
}

/** Source draws entropy before reading its own raw day clock. */
export const prepareCoreTransactionIdGenerator = Effect.fn("CoreTransaction.prepareIdGenerator")(function* (
  options: Pick<CoreDatabaseOptions, "randomBytes" | "now">,
) {
  const seed = yield* Effect.fromResult(captureCoreEntropy(yield* options.randomBytes(32), 32));
  const rawDayTime = yield* options.now;
  return yield* Effect.fromResult(createTransactionIdGenerator(seed, rawDayTime));
});

/** Bootstrap/snapshot construction reads its creation clock separately after the generator. */
export const prepareCoreTransactionIds = Effect.fn("CoreTransaction.prepareIds")(function* (
  options: Pick<CoreDatabaseOptions, "randomBytes" | "now">,
) {
  const idGenerator = yield* prepareCoreTransactionIdGenerator(options);
  const now = yield* decodeCreationTimestamp(yield* options.now).pipe(Effect.mapError(invalid));
  return { now, idGenerator };
});

/** The source snapshot and explicit native observations share one write and resource owner. */
export function createCoreTransaction(input: Readonly<{
  snapshot: CorePersistenceSnapshot;
  residentReader?: (request: CoreIndexScan) => CoreIndexPage | undefined;
  operationCacheMaxBytes?: number;
  registry: CoreRegistry;
  namespace?: CoreTableNamespace;
  counts?: CoreTableCounts;
  now: bigint;
  idGenerator: CoreTransactionIdGenerator;
  vault: CoreFinalizationVault;
  claim?: import("./api").CoreRequestClaim;
  limits?: CoreTransactionLimits;
  readonly?: boolean;
  assertOwnerOpen?: Effect.Effect<void, CoreError>;
  onClosed?: () => void;
  scopeExclusion?: CoreNativeScopeExclusionGrant;
  schemaBundles?: readonly CoreSchemaBundle[];
  nativeRoot?: Readonly<{
    accesses: readonly CoreTransactionNativeAccess[];
    limits: CoreNativeLimits;
    maxFinalUserDocuments: number;
    chargeRetained: (bytes: number) => Effect.Effect<void, CoreError>;
    remainingBytes: () => number;
    evaluateRelational: CorePersistence["evaluateRelational"];
    capture: () => Effect.Effect<CoreNativeCapture, CoreError>;
  }>;
  native?: Readonly<{
    authority: CoreNativeAuthority;
    limits: CoreNativeLimits;
    chargeRetained: (bytes: number) => Effect.Effect<void, CoreError>;
    remainingBytes: () => number;
    evaluateRelational: CorePersistence["evaluateRelational"];
    visibility: "command" | "snapshot";
    capture: () => Effect.Effect<CoreNativeCapture, CoreError>;
  }>;
}>): CoreTransactionInternals {
  const { snapshot, idGenerator } = input;
  let registry = input.registry;
  const namespace = input.namespace ?? null;
  const indexSnapshot = createCoreIndexSnapshot({ snapshot, registry,
    ...(input.residentReader === undefined ? {} : { resident: input.residentReader }),
    ...(input.operationCacheMaxBytes === undefined ? {} : { maxBytes: input.operationCacheMaxBytes }) });
  const reads = new CoreReadSetBuilder();
  const writes = new Map<string, CoreDocumentChange>();
  const deletedBy = new Map<string, CoreTransactionNativeAccess>();
  const deletedDocuments = new Map<string, DocumentObject>();
  const membershipIdentities = new Map<string, Readonly<{ id: string; internalId: Uint8Array; creationTime: number; allocated: boolean }>>();
  const deletionEvidence = new WeakMap<CoreNativePendingDelete, Readonly<{ access: CoreTransactionNativeAccess; id: string; change: CoreDocumentChange }>>();
  let referenceReplacement: Readonly<{ access: CoreTransactionNativeAccess; source: CoreTableDefinition;
    ids: readonly string[]; selection: CoreNativeReferenceReplacement }> | undefined;
  const setNullPlans: Array<Readonly<{ access: Extract<CoreTransactionNativeAccess, { readonly kind: "native" }>;
    selection: CoreNativeSetNullIntent; foreignKey: CoreNativeForeignKeySelection }>> = [];
  let setNullPrepared = false;
  const nativeReferenceTouches: Array<Readonly<{ sourceTable: string; descriptor: string; values: readonly CoreNativeKeyValue[] }>> = [];
  const pendingIndexes = new Map<string, BTree<Uint8Array, DocumentObject | null>>();
  const pendingGenerations = new Map<string, number>();
  const accounting = new CoreAccounting(input.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS);
  const native = input.nativeRoot ?? input.native;
  const nativeActivity = new CoreNativeActivityOwner(bytes => native === undefined ? Effect.void : native.chargeRetained(bytes));
  const nativeActivityRows = new WeakMap<DocumentObject, JsonObject>();
  const defaultAccess: CoreTransactionNativeAccess | undefined = input.native === undefined ? undefined : Object.freeze({
    kind: "native", authority: input.native.authority, limits: input.native.limits,
    readonly: input.readonly ?? false,
  });
  const nativeAccesses = new Set(input.nativeRoot?.accesses ?? (defaultAccess === undefined ? [] : [defaultAccess]));
  const selectiveMetadata = input.native?.authority.selectiveMetadata === true || (input.nativeRoot?.accesses.some(access => access.kind !== "applicationInsert"
    && access.authority.selectiveMetadata === true) ?? false);
  const nativeObservations = native === undefined ? undefined : new CoreNativeObservationState(native.limits,
    input.nativeRoot?.accesses.map(access => ({ sourceKey: access.kind === "native"
      ? access.authority.definition.identity.sourceKey : access.kind === "applicationRead" ? `${access.authority.sourceKey}:read` : access.authority.sourceKey,
    tables: access.kind === "native" ? access.authority.tables : [access.authority.table], limits: access.limits })));
  // Rust's &mut Transaction excludes interleaving while a syscall awaits persistence.
  const operations = Semaphore.makeUnsafe(1);
  const documentSizes = new WeakMap<DocumentObject, number>();
  let registryAfter: CoreRegistry | undefined;
  let closed = false;
  let inflight = 0;
  const snapshotCeilMillis = Number((snapshot.timestamp + 999_999n) / 1_000_000n);
  const wallMillis = Number(input.now / 1_000_000n) + Number(input.now % 1_000_000n) * 1e-6;
  let creationTime = Math.max(snapshotCeilMillis, wallMillis);
  const unixTime = Math.floor(creationTime);
  const takeCreationTime = () => Result.gen(function* () {
    const advanced = yield* Result.mapError(incrementCoreCreationTime(creationTime), invalid);
    creationTime = advanced.next;
    return advanced.value;
  });

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

  const requireNativeDalOpen = (access: CoreTransactionNativeAccess | undefined) => Effect.suspend(() => {
    const privateEvents = access?.kind === "native" && access.authority.definition.tables.length > 0
      && access.authority.definition.tables.every(table => table.privateEvent !== undefined);
    const sourceSealed = access?.kind === "native" && setNullPlans.some(plan =>
      sameCoreNativeIdentity(plan.access.authority.definition.identity, access.authority.definition.identity));
    return access?.kind === "native" && !privateEvents && (sourceSealed || referenceReplacement !== undefined)
      ? Effect.fail(new CoreNativeReferencePlanError({ reason: "invalidAuthority" }))
      : Effect.void;
  });
  const nativeOperation = <A>(access: CoreTransactionNativeAccess | undefined, body: Effect.Effect<A, CoreError>) =>
    operation(Effect.andThen(requireNativeDalOpen(access), body));


  const checkAccess = (table: CoreTableDefinition, mode: "read" | "write", access: CoreTransactionNativeAccess | undefined = defaultAccess) => Result.gen(function* () {
    if (access === undefined) return input.nativeRoot === undefined ? yield* checkCoreTableAccess(table, mode)
      : yield* Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    if (!nativeAccesses.has(access)) return yield* Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    if (access.kind === "native") {
      if (mode === "write" && access.readonly === true) return yield* Result.fail(new CoreTransactionError({ reason: "readonly" }));
      return yield* checkCoreTableAccess(table, mode, access.authority);
    }
    if (access.kind === "applicationRead") {
      if (mode === "write") return yield* Result.fail(new CoreTransactionError({ reason: "readonly" }));
      yield* checkCoreApplicationReadAuthority(registry, access.authority);
    } else yield* checkCoreApplicationInsertAuthority(registry, access.authority);
    const expected = access.authority.table;
    if (table.number !== expected.number || !bytesEqual(table.tabletId, expected.tabletId)
      || coreNamespaceKey(table.namespace) !== coreNamespaceKey(expected.namespace))
      return yield* Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
  });

  const tableByName = (name: string, privateAccess: boolean, access: CoreTransactionNativeAccess | undefined = defaultAccess): Result.Result<CoreTableDefinition, CoreError> => {
    const record = registry.table(name, systemNamespace(name));
    if (record === undefined || (!privateAccess && name.startsWith("_"))) return Result.fail(new CoreTransactionError({ reason: "missingTable" }));
    return Result.gen(function* () {
      if (!privateAccess) yield* checkAccess(record.definition, "read", access);
      if (native === undefined) yield* mappingRead();
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
      if (native === undefined || isCoreSystemTable(table)) yield* addIndexMetadataDependency(reads, registry, byId);
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
        const measured = yield* Result.mapError(captureCoreDocument(document, isCoreSystemTable(table)), invalid);
        size = measured.semanticSizeBytes;
        documentSizes.set(document, size);
      }
      yield* accounting.read(isCoreSystemTable(table), size);
    });
  }

  const resolve = (id: string, privateAccess: boolean, access: CoreTransactionNativeAccess | undefined = defaultAccess) => Result.gen(function* () {
    const decoded = yield* Result.mapError(decodeDocumentId(id), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause }));
    const record = registry.tableByNumber(decoded.tableNumber, namespace);
    if (record === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "missingTable" }));
    const table = yield* tableByName(record.definition.name, privateAccess, access);
    return { table, internalId: decoded.internalId };
  });

  const captureObservation = Effect.fn("CoreTransaction.captureObservation")(function* (
    table: CoreTableDefinition, found: CoreDocumentLogEntry | undefined, observedAt = snapshot.timestamp, access: CoreTransactionNativeAccess | undefined = defaultAccess,
  ) {
    const original = found === undefined ? undefined : Object.freeze({ ...found,
      tableId: found.tableId.slice(), id: found.id.slice(), jsonValue: found.jsonValue.slice() });
    let document: DocumentObject | null = null;
    if (original !== undefined && !original.deleted) {
      const decoded = yield* Effect.fromResult(readDocumentObject(original, table));
      const policy = access?.kind === "native" ? coreNativeRelationalRows(access.authority.definition, table.name) : undefined;
      if (policy !== undefined) {
        const { _id, _creationTime, ...body } = decoded;
        if (!isJson(body) || !isJsonObject(body)) return yield* new CorePersistenceError({ reason: "corruptData" });
        yield* Effect.fromResult(policy.rows.validate(body, "storedCorruption"));
      }
      const measured = yield* Effect.fromResult(Result.mapError(captureCoreDocument(decoded, isCoreSystemTable(table)), invalid));
      document = measured.value;
      documentSizes.set(document, measured.semanticSizeBytes);
    }
    return Object.freeze({ original, document, observedAt });
  });

  function nativeBodyBytes(table: CoreTableDefinition, document: DocumentObject | null): Result.Result<number, CoreError> {
    return Result.gen(function* () {
      const bytes = document === null ? 0 : (yield* Result.mapError(encodeDocumentValue(document), invalid)).byteLength;
      const limit = nativeObservations === undefined ? undefined : yield* nativeObservations.limitsFor(table);
      if (limit !== undefined && bytes > limit.maxDocumentBytes)
        return yield* Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native document byte limit" }));
      return bytes;
    });
  }

  const nativeRemember = Effect.fn("CoreTransaction.nativeRemember")(function* (
    table: CoreTableDefinition, id: string, observation: CoreNativeMembership["rows"][number]["observation"],
  ) {
    if (nativeObservations === undefined || native === undefined) return yield* invalid();
    const previous = nativeObservations.original(id);
    if (previous !== undefined) return previous;
    const bytes = yield* Effect.fromResult(nativeBodyBytes(table, observation.document));
    if (bytes > 0) yield* native.chargeRetained(bytes);
    return nativeObservations.remember(table, id, observation);
  });

  const nativeCapture = Effect.fn("CoreTransaction.nativeCapture")(function* (table: CoreTableDefinition, access: CoreTransactionNativeAccess | undefined = defaultAccess,
    index?: CoreIndexDefinition, indexedTable: CoreTableDefinition = table) {
    if (native === undefined || nativeObservations === undefined) return yield* invalid();
    // The database provider retains fixed data for standalone reads and advances
    // command frontiers, while checking the current authority in either case.
    const selected = yield* native.capture();
    if (selected.writeLog.timestamp !== selected.snapshot.timestamp) return yield* new CorePersistenceError({ reason: "invalidTarget" });
    yield* assertOpen();
    if (access === undefined || !nativeAccesses.has(access)) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const metadataRegistry = selected.metadata?.registry ?? selected.registry;
    const metadataTimestamp = selected.metadata?.timestamp ?? selected.snapshot.timestamp;
    const metadata = access.kind === "native" ? yield* Effect.gen(function* () {
      yield* Effect.fromResult(checkCoreNativeAuthority(metadataRegistry, access.authority, table.name));
      return yield* Effect.fromResult(coreNativeMetadataReads(metadataRegistry, access.authority, table.name));
    }) : yield* Effect.fromResult(access.kind === "applicationRead"
      ? coreApplicationReadMetadataReads(metadataRegistry, access.authority)
      : coreApplicationInsertMetadataReads(metadataRegistry, access.authority));
    nativeObservations.addReads(metadataTimestamp, metadata);
    if (index !== undefined) {
      const currentTable = metadataRegistry.tableByTablet(indexedTable.tabletId)?.definition;
      const current = currentTable?.indexes.find(candidate => candidate.name === index.name);
      const generation = current === undefined ? undefined : metadataRegistry.indexes.records.get(encodeBytesToLowercaseHex(current.ref.id));
      if (current === undefined || generation === undefined || !isCoreIndexEnabled(generation)
        || !bytesEqual(current.ref.id, index.ref.id) || !bytesEqual(generation.tableId, indexedTable.tabletId)
        || current.ref.persistenceIndexId !== index.ref.persistenceIndexId
        || current.fields.length !== index.fields.length || current.fields.some((field, position) => field !== index.fields[position]))
        return yield* new CoreTransactionError({ reason: "indexUnavailable" });
      const dependency = new CoreReadSetBuilder();
      yield* Effect.fromResult(addIndexMetadataDependency(dependency, metadataRegistry, current));
      nativeObservations.addReads(metadataTimestamp, dependency.snapshot());
    }
    return { ...selected, registry: metadataRegistry, indexSnapshot: createCoreIndexSnapshot({ snapshot: selected.snapshot, registry: metadataRegistry,
      ...(selected.residentReader === undefined ? {} : { resident: selected.residentReader }),
      ...(input.operationCacheMaxBytes === undefined ? {} : { maxBytes: input.operationCacheMaxBytes }) }) };
  });

  function nativeRead(timestamp: bigint, index: CoreIndexDefinition, interval: CoreInterval): void {
    nativeObservations?.addReads(timestamp, [{ indexId: index.ref.id, intervals: [interval] }]);
  }

  const observeProtectedTraversalTarget = (selected: Effect.Success<ReturnType<typeof nativeCapture>>, source: CoreTableDefinition,
    reference: CoreNativeProtectedReference) => Result.gen(function* () {
    const target = selected.registry.table(reference.targetTable, source.namespace)?.definition;
    if (target?.state !== "active" || target.nativePolicy?.state !== "active" || target.nativePolicy.bindingSelected === false)
      return yield* Result.fail(new CoreTransactionError({ reason: "authorityRevoked", cause: "Protected reference target binding is withdrawn" }));
    const dependency = new CoreReadSetBuilder();
    yield* addTableSemanticDependency(dependency, selected.registry, target);
    nativeObservations?.addReads(selected.metadata?.timestamp ?? selected.snapshot.timestamp, dependency.snapshot());
  });

  const nativeObserve = Effect.fn("CoreTransaction.nativeObserve")(function* (table: CoreTableDefinition, id: Uint8Array, access: CoreTransactionNativeAccess | undefined = defaultAccess) {
    if (nativeObservations === undefined) return yield* invalid();
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    yield* Effect.fromResult(nativeObservations.reserve(table, [developerId]));
    const previous = nativeObservations.original(developerId);
    if (previous !== undefined) return previous;
    if (nativeObservations.hasTable(table)) return yield* nativeRemember(table, developerId,
      Object.freeze({ original: undefined, document: null, observedAt: snapshot.timestamp }));
    const byId = table.indexes.find(index => index.name === "by_id");
    if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
    const selected = yield* nativeCapture(table, access, byId);
    const key = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], developerId), invalid));
    const interval = pointInterval(key);
    const page = yield* selected.indexSnapshot.scan({ index: byId.ref, tableId: table.tabletId,
      interval, order: "asc", maxResults: 2 });
    if (page.entries.length > 1 || page.cursor.kind !== "end") return yield* new CorePersistenceError({ reason: "corruptData" });
    yield* assertOpen();
    const observation = yield* captureObservation(table, page.entries[0]?.document, selected.snapshot.timestamp, access);
    nativeRead(selected.snapshot.timestamp, byId, interval);
    return yield* nativeRemember(table, developerId, observation);
  });

  const nativeMembership = Effect.fn("CoreTransaction.nativeMembership")(function* (
    table: CoreTableDefinition, index: CoreIndexDefinition, interval: CoreInterval, charged?: Set<DocumentObject>, observeRows = true, access: CoreTransactionNativeAccess | undefined = defaultAccess,
  ) {
    if (nativeObservations === undefined || native === undefined) return yield* invalid();
    const selected = yield* nativeCapture(table, access, index);
    const captureLimits = yield* Effect.fromResult(nativeObservations.limitsFor(table));
    yield* Effect.fromResult(accounting.query(index.ref.id, interval));
    const entries = yield* captureCoreIndexRange({ snapshot: selected.indexSnapshot, table, index, interval,
      maxEntries: captureLimits.maxIdentities, assertOpen });
    const ids = yield* Effect.forEach(entries, entry => Effect.fromResult(publicDocumentId(table, entry.document.id)));
    // Complete physical overflow and the root-wide identity budget precede any
    // first-row coherence verdict, including pending-hidden/residual candidates.
    yield* Effect.fromResult(nativeObservations.reserve(table, ids));
    const byId = table.indexes.find(candidate => candidate.name === "by_id");
    if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
    const rows: Array<CoreNativeMembership["rows"][number]> = [];
    for (const [position, entry] of entries.entries()) {
      const observation = yield* captureObservation(table, entry.document, selected.snapshot.timestamp, access);
      if (observation.document === null) return yield* new CorePersistenceError({ reason: "corruptData" });
      yield* Effect.fromResult(chargeDocument(table, observation.document));
      charged?.add(observation.document);
      const id = ids[position];
      if (id === undefined) return yield* new CorePersistenceError({ reason: "corruptData" });
      if (observeRows && nativeObservations.original(id) === undefined) {
        yield* nativeRemember(table, id, observation);
        const key = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], id), invalid));
        nativeRead(selected.snapshot.timestamp, byId, pointInterval(key));
      }
      rows.push(Object.freeze({ id, key: entry.key.slice(), observation }));
    }
    yield* assertOpen();
    return { membership: Object.freeze({ timestamp: selected.snapshot.timestamp, rows: Object.freeze(rows) }) satisfies CoreNativeMembership,
      writeLog: selected.writeLog };
  });

  type NativeConstraint = NonNullable<CoreTableDefinition["nativePolicy"]>["uniqueConstraints"][number];

  const nativeSlot = Effect.fn("CoreTransaction.nativeSlot")(function* (
    table: CoreTableDefinition, constraint: NativeConstraint, values: readonly CoreNativeScalar[],
    charged?: Set<DocumentObject>, releaseOnly = false, access: CoreTransactionNativeAccess | undefined = defaultAccess,
  ) {
    if (nativeObservations === undefined) return yield* invalid();
    const { index, interval } = yield* Effect.fromResult(coreNativeUniqueSelection(table, constraint, values));
    let membership = nativeObservations.slot(index, interval, releaseOnly);
    if (membership === undefined) {
      const captured = (yield* nativeMembership(table, index, interval, charged, !releaseOnly, access)).membership;
      if (!releaseOnly) {
        for (const row of captured.rows) {
          const previous = nativeObservations.original(row.id);
          // The native slot grants membership only for its exact owner revision.
          // A previously remembered point cannot be refreshed to manufacture it.
          if (previous !== undefined && previous.original?.ts !== row.observation.original?.ts)
            return yield* new CoreTransactionError({ reason: "conflict" });
        }
      }
      membership = Object.freeze({ timestamp: captured.timestamp,
        members: Object.freeze(captured.rows.map(row => Object.freeze({ id: row.id, key: row.key }))) });
      nativeObservations.rememberSlot({ kind: "unique", table, index, interval,
        maxIdentities: (yield* Effect.fromResult(nativeObservations.limitsFor(table))).maxIdentities,
        owners: membership.members.map(member => member.id) }, membership, !releaseOnly);
    }
    yield* Effect.fromResult(accounting.query(index.ref.id, interval));
    return { constraint, index, interval, membership };
  });

  const nativeConstraints = Effect.fn("CoreTransaction.nativeConstraints")(function* (
    table: CoreTableDefinition, developerId: string, previous: DocumentObject | null, next: DocumentObject | null, access: CoreTransactionNativeAccess | undefined = defaultAccess,
  ) {
    for (const constraint of table.nativePolicy?.uniqueConstraints ?? []) {
      const oldValues = previous === null ? null : yield* Effect.fromResult(coreNativeUniqueValues(constraint, previous));
      const newValues = next === null ? null : yield* Effect.fromResult(coreNativeUniqueValues(constraint, next));
      if (oldValues !== null && (newValues === null || !sameNativeTuple(oldValues, newValues)))
        yield* nativeSlot(table, constraint, oldValues, undefined, true, access);
      if (newValues === null) continue;
      const selected = yield* nativeSlot(table, constraint, newValues, undefined, false, access);
      const owners = new Set(selected.membership.members.map(member => member.id));
      // Checkpoint uniqueness inspects every already observed current row even
      // when a cached query membership deliberately excludes that row.
      for (const row of nativeObservations?.remembered(table) ?? []) {
        if (row.observation.document === null) continue;
        const values = yield* Effect.fromResult(coreNativeUniqueValues(constraint, row.observation.document));
        if (values !== null && sameNativeTuple(values, newValues)) owners.add(row.id);
      }
      // Written identities replace their originals even when their final key
      // moved out of this slot. The existing pending index supplies only the
      // live final members, rather than revalidating every unrelated write.
      for (const id of owners) if (writes.has(id)) owners.delete(id);
      for (const document of coreNativePendingIndexDocuments(
        pendingIndexes.get(encodeBytesToLowercaseHex(selected.index.ref.id)), selected.interval,
      )) {
        if (typeof document._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
        const values = yield* Effect.fromResult(coreNativeUniqueValues(constraint, document));
        if (values !== null && sameNativeTuple(values, newValues)) owners.add(document._id);
      }
      owners.delete(developerId);
      owners.add(developerId);
      if (owners.size > 1) {
        if (next === null) return yield* new CorePersistenceError({ reason: "corruptData" });
        const failure = yield* Effect.fromResult(nativeUniqueFailure(table, constraint.descriptor,
          coreNativeConstraintFields(constraint), next, "row", access));
        return yield* failure;
      }
    }
  });

  const nativeRange = Effect.fn("CoreTransaction.nativeRange")(function* (
    table: CoreTableDefinition, index: CoreIndexDefinition, interval: CoreInterval, charged: Set<DocumentObject>, access: CoreTransactionNativeAccess | undefined = defaultAccess,
  ) {
    if (nativeObservations === undefined) return yield* invalid();
    const cached = nativeObservations.range(index, interval);
    if (cached !== undefined) {
      yield* Effect.fromResult(accounting.query(index.ref.id, interval));
      return cached;
    }
    const { membership, writeLog } = yield* nativeMembership(table, index, interval, charged, true, access);
    // Inspect the complete PHYSICAL set before written-ID tombstones can mask
    // members. Only a physical row with an earlier original needs this proof.
    for (const row of membership.rows) {
      const previous = nativeObservations.original(row.id);
      if (previous === undefined) continue;
      if (previous.document === null) return yield* new CoreTransactionError({ reason: "conflict" });
      const oldKey = yield* Effect.fromResult(documentIndexKey(index, previous.document));
      if (!bytesEqual(oldKey, row.key)) return yield* new CoreTransactionError({ reason: "conflict" });
      const transition = yield* Effect.fromResult(writeLog.nativeKeyTransition(index.ref.id, row.key, previous.observedAt));
      if (transition !== undefined) return yield* new CoreTransactionError({ reason: "conflict", cause: transition });
    }
    const slot = Object.freeze({ kind: "range" as const, table, index, interval,
      maxIdentities: (yield* Effect.fromResult(nativeObservations.limitsFor(table))).maxIdentities,
      members: Object.freeze(membership.rows.map(row => Object.freeze({ id: row.id, key: row.key }))) });
    nativeObservations.rememberRange(slot);
    return slot;
  });

  const observe = Effect.fn("CoreTransaction.observe")(function* (table: CoreTableDefinition, id: Uint8Array, access: CoreTransactionNativeAccess | undefined = defaultAccess) {
    yield* assertOpen();
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const pending = writes.get(developerId);
    if (pending !== undefined) return { original: pending.original, document: pending.originalDocument };
    if (native !== undefined && table.nativePolicy?.privateReference !== undefined) {
      const original = nativeObservations?.original(developerId);
      if (original === undefined) return yield* new CorePersistenceError({ reason: "corruptData", cause: "Unprepared native membership mutation" });
      return original;
    }
    if (native !== undefined && isCoreNativeObservedTable(table)) return yield* nativeObserve(table, id, access);
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
    return yield* captureObservation(table, found, snapshot.timestamp, access);
  });

  const markNativeUse = (table: CoreTableDefinition, document: DocumentObject | null,
    access: CoreTransactionNativeAccess | undefined) => {
    if (access?.kind === "native" && nativeActivity.active(access) && document !== null && typeof document._id === "string")
      nativeActivity.mark(access, table.name, document._id);
  };

  const read = Effect.fn("CoreTransaction.read")(function* (table: CoreTableDefinition, id: Uint8Array, access: CoreTransactionNativeAccess | undefined = defaultAccess) {
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const pending = writes.get(developerId);
    const document = pending === undefined ? (yield* observe(table, id, access)).document : pending.finalDocument;
    markNativeUse(table, document, access);
    return document;
  });

  /** Source pending-graph checkpoints restore attempted writes only. Actual
   * observations, charged work and ID/time reservations are never rewound. */
  const withPendingRollback = <A>(body: Effect.Effect<A, CoreError>): Effect.Effect<A, CoreError> => Effect.suspend(() => {
    const savedWrites = new Map(writes), savedDeleted = new Map(deletedBy), savedDeletedDocuments = new Map(deletedDocuments);
    const savedIndexes = new Map([...pendingIndexes].map(([key, value]) => [key, value.clone()]));
    const savedGenerations = new Map(pendingGenerations), savedReplacement = referenceReplacement,
      savedSetNull = setNullPlans.length, savedSetNullPrepared = setNullPrepared, savedReferenceTouches = nativeReferenceTouches.length;
    const restoreActivity = nativeActivity.checkpoint();
    return body.pipe(Effect.onExit(exit => Exit.isFailure(exit) ? Effect.sync(() => {
      restoreActivity();
      writes.clear(); for (const [key, value] of savedWrites) writes.set(key, value);
      deletedBy.clear(); for (const [key, value] of savedDeleted) deletedBy.set(key, value);
      deletedDocuments.clear(); for (const [key, value] of savedDeletedDocuments) deletedDocuments.set(key, value);
      pendingIndexes.clear(); for (const [key, value] of savedIndexes) pendingIndexes.set(key, value);
      pendingGenerations.clear(); for (const [key, value] of savedGenerations) pendingGenerations.set(key, value);
      referenceReplacement = savedReplacement;
      setNullPlans.length = savedSetNull;
      setNullPrepared = savedSetNullPrepared;
      nativeReferenceTouches.length = savedReferenceTouches;
    }) : Effect.void));
  });
  const nativeBatch = <A>(access: CoreTransactionNativeAccess | undefined, body: Effect.Effect<A, CoreError>, terminal = false) =>
    operation(Effect.andThen(terminal ? Effect.void : requireNativeDalOpen(access), withPendingRollback(body)));

  const stageDocument = Effect.fn("CoreTransaction.stageDocument")(function* (table: CoreTableDefinition, id: Uint8Array, document: DocumentObject | null,
    access: CoreTransactionNativeAccess | undefined = defaultAccess, mode: "insert" | "update" = "update") {
    if (input.readonly) return yield* new CoreTransactionError({ reason: "readonly" });
    if (isCoreNativeObservedTable(table)) yield* Effect.fromResult(checkAccess(table, "write", access));
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const pending = writes.get(developerId);
    const original = mode === "insert" ? { original: undefined, document: null } : yield* observe(table, id, access);
    if (mode === "insert" && nativeObservations !== undefined && isCoreNativeObservedTable(table))
      yield* Effect.fromResult(nativeObservations.reserve(table, [developerId]));
    const previous = pending === undefined ? original.document : pending.finalDocument;
    yield* assertOpen();
    const captured = document === null ? null : yield* Effect.fromResult(Result.mapError(captureCoreDocument(document, isCoreSystemTable(table)), invalid));
    const next = captured?.value ?? null;
    const protectedReferenceAssignments = new Map((pending?.protectedReferenceAssignments ?? []).map(value => [value.referenceName, value]));
    const protectedReferences = new Map<string, CoreNativeProtectedReference>();
    for (const { definition: owner } of registry.tables.values()) {
      if (coreNamespaceKey(owner.namespace) !== coreNamespaceKey(table.namespace)) continue;
      for (const reference of owner.nativePolicy?.protectedReferences ?? [])
        if (reference.sourceTable === table.name) protectedReferences.set(reference.reference.name, reference);
    }
    for (const reference of protectedReferences.values()) {
      const liveness = reference.reference.liveness.source;
      const wasLive = previous !== null && (liveness.kind === "current" || previous[liveness.field] === null);
      const isLive = next !== null && (liveness.kind === "current" || next[liveness.field] === null);
      const targetId = isLive ? next?.[reference.field] : undefined;
      if (typeof targetId !== "string") protectedReferenceAssignments.delete(reference.reference.name);
      else if (!wasLive || previous?.[reference.field] !== targetId)
        protectedReferenceAssignments.set(reference.reference.name, Object.freeze({ referenceName: reference.reference.name, targetId }));
    }
    // Assignment validates the target ID's table, without observing target liveness/body.
    if (next !== null && access?.kind === "native") for (const reference of table.nativePolicy?.references ?? []) {
      if (reference.sourceTable !== table.name) continue;
      const selection = yield* Effect.fromResult(selectCoreNativeReference(registry, table, reference));
      yield* Effect.fromResult(coreNativeReferenceTargets(selection, next));
    }
    if (captured !== null) documentSizes.set(captured.value, captured.semanticSizeBytes);
    const retainedBytes = native === undefined || isCoreSystemTable(table) && table.nativePolicy?.privateReference === undefined
      && table.nativePolicy?.privateEvent === undefined ? 0
      : table.nativePolicy?.privateReference !== undefined ? next === null ? 0 : (yield* Effect.fromResult(Result.mapError(encodeDocumentValue(next), invalid))).byteLength
        : yield* Effect.fromResult(nativeBodyBytes(table, next));
    if (native !== undefined && isCoreNativeObservedTable(table)) yield* nativeConstraints(table, developerId, previous, next, access);
    yield* Effect.fromResult(addTableWriteDependencies(reads, registry, table, selectiveMetadata));
    const pendingUpdates: Array<Readonly<{ index: CoreIndexDefinition; oldKey?: Uint8Array; newKey?: Uint8Array }>> = [];
    for (const index of registry.indexesForTablet(table.tabletId)) {
      const oldKey = previous === null ? undefined : yield* Effect.fromResult(documentIndexKey(index, previous));
      const newKey = next === null ? undefined : yield* Effect.fromResult(documentIndexKey(index, next));
      pendingUpdates.push({ index, ...(oldKey === undefined ? {} : { oldKey }), ...(newKey === undefined ? {} : { newKey }) });
    }
    if (retainedBytes > 0 && native !== undefined) yield* native.chargeRetained(retainedBytes);
    if (mode === "insert") {
      if (pending !== undefined) return yield* Effect.die(new Error("Duplicate insert"));
      const byId = table.indexes.find(index => index.name === "by_id");
      if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
      const key = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], developerId), invalid));
      reads.add(byId.ref.id, pointInterval(key));
    }
    yield* Effect.suspend(() => {
      if (closed) return Effect.fail(new CoreTransactionError({ reason: "closed" }));
      return Effect.fromResult(Result.map(accounting.write(isCoreSystemTable(table), captured?.semanticSizeBytes ?? 0), () => {
      writes.set(developerId, Object.freeze({ table, id: id.slice(), original: original.original,
        originalDocument: original.document, finalDocument: next,
        ...(protectedReferenceAssignments.size === 0 ? {} : { protectedReferenceAssignments: Object.freeze([...protectedReferenceAssignments.values()]) }) }));
      const tablet = encodeBytesToLowercaseHex(table.tabletId);
      pendingGenerations.set(tablet, (pendingGenerations.get(tablet) ?? 0) + 1);
      if (next === null && access?.kind === "native") {
        deletedBy.set(developerId, access);
        if (previous !== null) deletedDocuments.set(developerId, previous);
      } else { deletedBy.delete(developerId); deletedDocuments.delete(developerId); }
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

  /** One public write and all of its derived records stage atomically. Accounting,
   * actual observations and generator reservations survive a refused attempt. */
  const stage = Effect.fn("CoreTransaction.stage")(function* (table: CoreTableDefinition, id: Uint8Array, document: DocumentObject | null,
    access: CoreTransactionNativeAccess | undefined = defaultAccess, mode: "insert" | "update" = "update") {
    const references = table.nativePolicy?.references?.filter(reference => reference.sourceTable === table.name
      && isCoreNativeManyReference(reference)) ?? [];
    if (access?.kind !== "native" || references.length === 0) return yield* stageDocument(table, id, document, access, mode);
    const previous = mode === "insert" ? null : yield* read(table, id, access);
    yield* withPendingRollback(Effect.gen(function* () {
      yield* stageDocument(table, id, document, access, mode);
      const sourceId = yield* Effect.fromResult(publicDocumentId(table, id));
      const next = writes.get(sourceId)?.finalDocument ?? null;
      for (const reference of references) {
        const selection = yield* Effect.fromResult(selectCoreNativeReference(registry, table, reference));
        yield* maintainNativeMemberships(selection, sourceId, previous, next, access);
      }
    }));
  });

  const enforceUserSchema = Effect.fn("CoreTransaction.enforceSchema")((table: CoreTableDefinition, body: DocumentObject) =>
    new CoreSchemaModel(internals).enforceDocument(table.name, body, {
      mode: "tableAware", check: (name, id) => {
        const expected = registry.table(name, namespace);
        if (expected === undefined) return "unavailable";
        return Result.match(decodeDocumentId(id), { onFailure: () => "invalid" as const,
          onSuccess: decoded => decoded.tableNumber === expected.definition.number ? "valid" as const : "invalid" as const });
      },
    }));

  const validateUserBody = Effect.fn("CoreTransaction.validateDocument")(function* (
    table: CoreTableDefinition, value: unknown, previous: DocumentObject | null = null, access: CoreTransactionNativeAccess | undefined = defaultAccess,
    managedUpdate: "advance" | "preserve" = "advance",
  ) {
      let body = yield* Effect.fromResult(Result.mapError(captureDocumentObject(value), invalid));
      if (Object.hasOwn(body, "_id") || Object.hasOwn(body, "_creationTime")) return yield* invalid();
      const policy = access?.kind === "native" ? coreNativeRelationalRows(access.authority.definition, table.name) : undefined;
      if (policy !== undefined) {
        const { _id, _creationTime, ...previousBody } = previous ?? {};
        if (!isJson(body) || !isJsonObject(body) || !isJson(previousBody) || !isJsonObject(previousBody))
          return yield* new CoreTransactionError({ reason: "documentValidation" });
        body = yield* Effect.fromResult(policy.rows.normalize(body, previous === null ? null : previousBody, new Date(unixTime).toISOString(), managedUpdate));
        if (previous !== null && policy.rows.keyColumns.some(key => body[key] !== previousBody[key]))
          return yield* new CoreTransactionError({ reason: "documentValidation", cause: "Native primary identity is immutable" });
      }
      yield* enforceUserSchema(table, body);
      return body;
  });

  const selectIndex = (tableName: string, indexName: string, access: CoreTransactionNativeAccess | undefined = defaultAccess) => Result.gen(function* () {
    const table = yield* tableByName(tableName, false, access);
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
    chargeDocument: (document, size) => { documentSizes.set(document, size); return accounting.read(isCoreSystemTable(table), size); }, assertOpen,
    operation: withinOperation ? body => body : operation,
  });

  const writeSystem = Effect.fn("CoreTransaction.writeSystem")(function* (name: string, id: Uint8Array, body: DocumentObject | null,
    mode: "insert" | "update" = "update") {
    yield* assertOpen();
    const table = yield* Effect.fromResult(tableByName(name, true));
    const developerId = yield* Effect.fromResult(publicDocumentId(table, id));
    const previous = mode === "insert" ? null : yield* read(table, id);
    if (previous === null && body === null) return;
    const document = body === null ? null : { ...body, _id: developerId,
      _creationTime: previous?._creationTime ?? (yield* Effect.fromResult(takeCreationTime())) };
    yield* stage(table, id, document, defaultAccess, mode);
    if (name === TABLES) {
      registry = document === null ? registry.withoutTable(id)
        : registry.withTable(yield* Effect.fromResult(parseCoreTableRecord(yield* Effect.fromResult(systemDocument(document)), null)));
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
    yield* decodeAppTableName(name).pipe(Effect.mapError(invalid));
    yield* Effect.fromResult(mappingRead());
    const existing = registry.table(name, namespace);
    if (existing !== undefined) return existing.definition;
    const active = [...registry.tables.values()].filter(record => record.definition.state === "active"
      && !isCoreSystemTable(record.definition));
    if (active.length >= 10000) return yield* new CoreTransactionError({ reason: "tooManyTables", cause: { limit: 10000 } });
    let number = 10001;
    for (const record of registry.tables.values()) if (coreNamespaceKey(record.definition.namespace) === coreNamespaceKey(namespace)
      && record.definition.number >= number) number = record.definition.number + 1;
    if (number > 0xffff_ffff) return yield* new CoreTransactionError({ reason: "capacity" });
    const tabletId = idGenerator.nextInternalId();
    const definition: CoreTableDefinition = { name, number, tabletId, namespace, state: "active", indexes: [] };
    yield* writeSystem(TABLES, tabletId, tableDocument(definition), "insert");
    for (const [indexName, fields] of [["by_id", []], ["by_creation_time", ["_creationTime"]]] as const) {
      const record: CoreIndexRecord = { ref: { id: idGenerator.nextInternalId() }, tableId: tabletId,
        name: indexName, fields, state: { type: "Enabled" }, ts: null };
      yield* writeSystem(INDEXES, record.ref.id, coreIndexMetadataValue(record), "insert");
    }
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

  /** Reuse Source's ordinary query/pending merge. Captured prefetch is separate
   * from the exact consumed prefix and its inspected membership accounting. */
  const queryNativeReferenceIndex = Effect.fn("CoreTransaction.queryNativeReferenceIndex")(function* (
    selection: CoreNativeReferenceSelection, table: CoreTableDefinition, index: CoreIndexDefinition,
    interval: CoreInterval, maximum: number, access: CoreTransactionNativeAccess,
  ) {
    if (native === undefined || nativeObservations === undefined) return yield* invalid();
    const selected = yield* nativeCapture(selection.source, access, index, table);
    const currentSource = selected.registry.tableByTablet(selection.source.tabletId)?.definition;
    if (currentSource === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const current = yield* Effect.fromResult(selectCoreNativeReference(selected.registry, currentSource, selection.reference));
    const currentTable = selected.registry.tableByTablet(table.tabletId)?.definition;
    const currentIndex = currentTable?.indexes.find(value => bytesEqual(value.ref.id, index.ref.id));
    if (currentTable === undefined || currentIndex === undefined
      || !bytesEqual(coreNativeReferenceIndexTable(current).tabletId, coreNativeReferenceIndexTable(selection).tabletId))
      return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const physical = new Map<string, CoreHydratedIndexEntry>();
    const consumed = new CoreReadSetBuilder();
    const query = createCoreQuery({ snapshot: { timestamp: selected.indexSnapshot.timestamp,
      scan: request => selected.indexSnapshot.scan(request).pipe(Effect.tap(page => Effect.sync(() => {
        for (const entry of page.entries) physical.set(encodeBytesToLowercaseHex(entry.key), entry);
      }))) }, table: currentTable, index: currentIndex, interval, order: "asc", limit: maximum,
      queryFingerprint: new Uint8Array(), pendingIndex: () => pendingIndexes.get(encodeBytesToLowercaseHex(index.ref.id)),
      recordRead: observed => {
        consumed.add(index.ref.id, observed);
        nativeRead(selected.snapshot.timestamp, index, observed);
        return accounting.query(index.ref.id, observed);
      }, chargeDocument: (document, size) => {
        documentSizes.set(document, size);
        return accounting.read(isCoreSystemTable(table), size);
      }, assertOpen, operation: body => body });
    const documents: DocumentObject[] = [];
    try {
      while (documents.length < maximum) {
        const page = yield* query.nextPage({ maxResults: Math.min(128, maximum - documents.length),
          maxBytes: CORE_TRANSACTION_REFERENCE_LIMITS.systemBytesWritten });
        documents.push(...page.documents);
        if (page.done) break;
      }
    } finally { yield* query.close(); }
    const observed = consumed.snapshot().flatMap(dependency => dependency.intervals);
    const examined = new Set<string>();
    for (const [key, entry] of physical) if (observed.some(part => keyInInterval(entry.key, part))) {
      if (entry.document.deleted || entry.document.ts > selected.snapshot.timestamp || !bytesEqual(entry.document.tableId, table.tabletId))
        return yield* new CorePersistenceError({ reason: "corruptData" });
      const document = yield* Effect.fromResult(readDocumentObject(entry.document, table));
      if (!bytesEqual(yield* Effect.fromResult(documentIndexKey(index, document)), entry.key))
        return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native reference index differs from its document" });
      examined.add(key);
    }
    const pending = pendingIndexes.get(encodeBytesToLowercaseHex(index.ref.id));
    if (pending !== undefined) for (const [key] of pending.entries(interval.start ?? undefined)) {
      if (interval.end !== null && compareBytesLexicographically(key, interval.end) >= 0) break;
      if (observed.some(part => keyInInterval(key, part))) examined.add(encodeBytesToLowercaseHex(key));
    }
    yield* native.chargeRetained(128 + physical.size * 128);
    return { documents: Object.freeze(documents), selected, physical, inspectedMemberships: examined.size };
  });

  const rememberNativeMembership = Effect.fn("CoreTransaction.rememberNativeMembership")(function* (
    selection: CoreNativeReferenceSelection, selected: Effect.Success<ReturnType<typeof nativeCapture>>,
    document: DocumentObject,
  ) {
    if (native === undefined || nativeObservations === undefined || selection.projection === undefined)
      return yield* invalid();
    const table = selection.projection.table;
    const member = yield* Effect.fromResult(readCoreNativeMembership({ source: selection.source, target: selection.target, membership: table }, document));
    const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(member.id), cause => new CorePersistenceError({ reason: "corruptData", cause })));
    if (writes.has(member.id)) return member;
    const byId = table.indexes.find(index => index.name === "by_id");
    if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
    yield* Effect.fromResult(chargePointQuery(table, decoded.internalId));
    const found = yield* selected.snapshot.get(table.tabletId, decoded.internalId);
    if (Option.isNone(found) || found.value.deleted)
      return yield* new CorePersistenceError({ reason: "corruptData", cause: "Missing native membership document" });
    if (!bytesEqual(found.value.tableId, table.tabletId) || !bytesEqual(found.value.id, decoded.internalId))
      return yield* new CorePersistenceError({ reason: "corruptData" });
    const observation = yield* captureObservation(table, found.value, selected.snapshot.timestamp);
    if (observation.document === null) return yield* new CorePersistenceError({ reason: "corruptData" });
    const current = yield* Effect.fromResult(readCoreNativeMembership({ source: selection.source, target: selection.target, membership: table }, observation.document));
    if (current.id !== member.id || current.sourceId !== member.sourceId || current.targetId !== member.targetId)
      return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native membership index differs from its document" });
    const previous = nativeObservations.original(member.id);
    if (previous !== undefined && previous.original?.ts !== observation.original?.ts)
      return yield* new CoreTransactionError({ reason: "conflict", cause: "Native membership revision changed" });
    if (previous === undefined) {
      yield* native.chargeRetained((yield* Effect.fromResult(Result.mapError(encodeDocumentValue(observation.document), invalid))).byteLength);
      nativeObservations.remember(table, member.id, observation);
      nativeRead(selected.snapshot.timestamp, byId, pointInterval(yield* Effect.fromResult(Result.mapError(encodeIndexKey([], member.id), invalid))));
    }
    return member;
  });

  const maintainNativeMemberships = Effect.fn("CoreTransaction.maintainNativeMemberships")(function* (
    selection: CoreNativeReferenceSelection, sourceId: string, previous: DocumentObject | null, next: DocumentObject | null,
    access: CoreTransactionNativeAccess,
  ) {
    if (selection.projection === undefined || !isCoreNativeManyReference(selection.reference)) return yield* invalid();
    const table = selection.projection.table, index = selection.projection.sourceIndex;
    const expected = new Set(previous === null ? [] : yield* Effect.fromResult(Result.mapError(coreNativeReferenceTargets(selection, previous),
      cause => new CorePersistenceError({ reason: "corruptData", cause }))));
    const desired = new Set(next === null ? [] : yield* Effect.fromResult(coreNativeReferenceTargets(selection, next)));
    // A reorder or unrelated source-body update changes no memberships. Neither
    // child rows nor their stable allocated IDs need another write/read cycle.
    if (expected.size === desired.size && [...expected].every(targetId => desired.has(targetId))) return;
    const interval = yield* Effect.fromResult(Result.mapError(compileIndexRange([{ op: "eq", field: "sourceId", value: sourceId }], index.fields), invalid));
    const selected = yield* queryNativeReferenceIndex(selection, table, index, interval, 33, access);
    if (selected.documents.length > 32)
      return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native source membership bound exceeded" });
    const existing = new Map<string, DocumentObject>();
    const identity = (targetId: string) => `${selection.reference.reference.name}:${sourceId}:${targetId}`;
    for (const document of selected.documents) {
      const member = yield* rememberNativeMembership(selection, selected.selected, document);
      if (member.sourceId !== sourceId || existing.has(member.targetId))
        return yield* new CorePersistenceError({ reason: "corruptData", cause: "Duplicate or foreign native membership" });
      existing.set(member.targetId, document);
      const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(member.id), invalid));
      const time = document._creationTime;
      if (typeof time !== "number") return yield* new CorePersistenceError({ reason: "corruptData" });
      const key = identity(member.targetId);
      membershipIdentities.set(key, { id: member.id, internalId: decoded.internalId,
        creationTime: time, allocated: membershipIdentities.get(key)?.allocated ?? false });
    }
    if (existing.size !== expected.size || [...expected].some(target => !existing.has(target))) {
      // A fresh projection capture cannot refresh an older public observation.
      // Distinguish that real source race from an incoherent stored projection.
      const original = nativeObservations?.original(sourceId);
      if (original !== undefined) {
        const sourceIdentity = yield* Effect.fromResult(Result.mapError(decodeDocumentId(sourceId), invalid));
        yield* Effect.fromResult(chargePointQuery(selection.source, sourceIdentity.internalId));
        const current = yield* selected.selected.snapshot.get(selection.source.tabletId, sourceIdentity.internalId);
        const revision = Option.isNone(current) ? undefined : current.value.ts;
        if (revision !== original.original?.ts || Option.isSome(current) && current.value.deleted !== (original.document === null))
          return yield* new CoreTransactionError({ reason: "conflict", cause: "Native source changed before membership maintenance" });
      }
      return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native source membership inventory differs from its array" });
    }
    for (const [targetId, document] of existing) if (!desired.has(targetId)) {
      const member = yield* Effect.fromResult(readCoreNativeMembership({ source: selection.source, target: selection.target, membership: table }, document));
      const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(member.id), invalid));
      yield* stageDocument(table, decoded.internalId, null, access);
    }
    for (const targetId of desired) if (!existing.has(targetId)) {
      const key = identity(targetId);
      let member = membershipIdentities.get(key);
      if (member === undefined) {
        const internalId = idGenerator.nextInternalId();
        member = { internalId, id: yield* Effect.fromResult(publicDocumentId(table, internalId)),
          creationTime: yield* Effect.fromResult(takeCreationTime()), allocated: true };
        membershipIdentities.set(key, member);
        if (native !== undefined) yield* native.chargeRetained(96 + key.length * 2);
      }
      const document = { sourceId, targetId, _id: member.id, _creationTime: member.creationTime };
      yield* stageDocument(table, member.internalId, document, access,
        member.allocated && !writes.has(member.id) ? "insert" : "update");
    }
  });

  /** A reverse lookup observes its sources at the same capture frontier. It
   * never refreshes an earlier semantic original from another operation. */
  const hydrateNativeReferenceSource = Effect.fn("CoreTransaction.hydrateNativeReferenceSource")(function* (
    selection: CoreNativeReferenceSelection, selected: Effect.Success<ReturnType<typeof nativeCapture>>,
    sourceId: string, access: CoreTransactionNativeAccess,
  ) {
    if (nativeObservations === undefined) return yield* invalid();
    const table = selection.source;
    yield* Effect.fromResult(nativeObservations.reserve(table, [sourceId]));
    const pending = writes.get(sourceId);
    if (pending !== undefined) {
      if (pending.finalDocument === null || !bytesEqual(pending.table.tabletId, table.tabletId))
        return yield* new CorePersistenceError({ reason: "corruptData", cause: "Pending native membership has no source" });
      if (selection.projection !== undefined) yield* Effect.fromResult(chargeDocument(table, pending.finalDocument));
      return pending.finalDocument;
    }
    const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(sourceId), cause => new CorePersistenceError({ reason: "corruptData", cause })));
    if (decoded.tableNumber !== table.number) return yield* new CorePersistenceError({ reason: "corruptData" });
    const byId = table.indexes.find(index => index.name === "by_id");
    if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
    yield* Effect.fromResult(chargePointQuery(table, decoded.internalId));
    const found = yield* selected.snapshot.get(table.tabletId, decoded.internalId);
    if (Option.isNone(found) || found.value.deleted)
      return yield* new CorePersistenceError({ reason: "corruptData", cause: "Orphan native membership" });
    if (!bytesEqual(found.value.tableId, table.tabletId) || !bytesEqual(found.value.id, decoded.internalId))
      return yield* new CorePersistenceError({ reason: "corruptData" });
    let original = nativeObservations.original(sourceId);
    if (original === undefined) {
      original = yield* nativeRemember(table, sourceId,
        yield* captureObservation(table, found.value, selected.snapshot.timestamp, access));
      nativeRead(selected.snapshot.timestamp, byId,
        pointInterval(yield* Effect.fromResult(Result.mapError(encodeIndexKey([], sourceId), invalid))));
    }
    if (original.document === null || original.original === undefined || original.original.ts < found.value.ts)
      return yield* new CoreTransactionError({ reason: "conflict", cause: "Native incoming source revision changed" });
    if (selection.projection !== undefined) yield* Effect.fromResult(chargeDocument(table, original.document));
    return original.document;
  });

  const prepareNativeMutation = Effect.fn("CoreTransaction.prepareNativeMutation")(function* (
    access: CoreTransactionNativeAccess | undefined, table: CoreTableDefinition,
    kind: "insert" | "patch" | "replace" | "delete", before: DocumentObject | null, after: DocumentObject | null,
    normalizationSource?: DocumentObject, recordActivity = true,
  ) {
    if (access?.kind !== "native" || coreNativeRelationalRows(access.authority.definition, table.name) === undefined) return () => {};
    const touches: Array<Readonly<{ sourceTable: string; descriptor: string; values: readonly CoreNativeKeyValue[] }>> = [];
    for (const foreignKey of table.nativePolicy?.foreignKeys ?? []) {
      if (foreignKey.sourceTable !== table.name) continue;
      for (const document of [before, after]) {
        if (document === null) continue;
        const values = yield* Effect.fromResult(coreNativeKeyTuple(document, foreignKey.sourceFields, true));
        if (values !== null && !touches.some(touch => touch.descriptor === foreignKey.descriptor && sameCoreNativeKeyTuple(touch.values, values)))
          touches.push(Object.freeze({ sourceTable: table.name, descriptor: foreignKey.descriptor, values: Object.freeze([...values]) }));
      }
    }
    if (native !== undefined && touches.length > 0) yield* native.chargeRetained(touches.reduce((bytes, touch) => bytes + 128 + touch.values.length * 8, 0));
    const commitTouches = () => { nativeReferenceTouches.push(...touches); };
    if (!recordActivity || !nativeActivity.active(access)) return commitTouches;
    const previous = before === null ? null : yield* Effect.fromResult(coreNativeRelationalRow(before));
    const next = after === null ? null : yield* Effect.fromResult(coreNativeRelationalRow(after));
    const documentId = after?._id ?? before?._id;
    if (typeof documentId !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
    const realNormalization = inspectRelationalRealNormalization(normalizationSource);
    const record = yield* nativeActivity.prepareMutation(access, { table: table.name, operation: kind, before: previous, after: next,
      ...(realNormalization === undefined ? {} : { realNormalization }) }, documentId);
    return () => { commitTouches(); record(); };
  });

  const userOperations = (access: CoreTransactionNativeAccess | undefined = defaultAccess, withinOperation = false,
    managedUpdate: "advance" | "preserve" = "advance", recordActivity = true): Pick<CoreTransaction, "normalizeId" | "get" | "insert" | "patch" | "replace" | "delete"> => {
    const run = withinOperation ? <Value>(body: Effect.Effect<Value, CoreError>) => body
      : <Value>(body: Effect.Effect<Value, CoreError>) => nativeOperation(access, body);
    return Object.freeze({
    normalizeId: Effect.fn("CoreTransaction.normalizeId")((name: string, id: unknown) => run(Effect.gen(function* () {
      if (native === undefined) yield* Effect.fromResult(mappingRead());
      const table = native === undefined ? registry.table(name, namespace)?.definition
        : yield* Effect.fromResult(tableByName(name, false, access));
      if(table===undefined)return Option.none<string>();
      yield* Effect.fromResult(checkAccess(table, "read", access));
      return yield* Effect.fromResult(Result.mapError(normalizeDocumentId(table.number, id), invalid));
    }))),
    get: Effect.fn("CoreTransaction.get")((id: string) => run(Effect.gen(function* () {
      const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause })));
      if (native === undefined) yield* Effect.fromResult(mappingRead());
      if (registry.tableByNumber(decoded.tableNumber, namespace) === undefined) return Option.none();
      const selected = yield* Effect.fromResult(resolve(id, false, access));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      const document = yield* read(selected.table, selected.internalId, access);
      yield* Effect.fromResult(chargeDocument(selected.table, document));
      return document === null ? Option.none() : Option.some(yield* Effect.fromResult(Result.mapError(captureDocumentObject(document), invalid)));
    }))),
    insert: Effect.fn("CoreTransaction.insert")((tableName: string, value: unknown) => run(Effect.gen(function* () {
      if (native === undefined) {
        // Syscall representation admission precedes Source's ID/time reservation.
        const captured = yield* Effect.fromResult(Result.mapError(captureCoreObject(value, true), invalid));
        yield* decodeAppTableName(tableName).pipe(Effect.mapError(invalid));
        const internalId = idGenerator.nextInternalId();
        const reservedTime = yield* Effect.fromResult(takeCreationTime());
        const table = yield* ensureUserTable(tableName);
        yield* Effect.fromResult(checkAccess(table, "write", access));
        const id = yield* Effect.fromResult(publicDocumentId(table, internalId));
        if ((Object.hasOwn(captured.value, "_id") && captured.value._id !== id)
          || (Object.hasOwn(captured.value, "_creationTime") && captured.value._creationTime !== reservedTime))
          return yield* invalid();
        // Construct/validate the document before schema; its user-size check follows schema.
        const constructed = yield* Effect.fromResult(Result.mapError(captureCoreDocument({ ...captured.value,
          _id: id, _creationTime: reservedTime }, true), invalid));
        const { _id, _creationTime, ...body } = constructed.value;
        yield* enforceUserSchema(table, body);
        const document = yield* Effect.fromResult(Result.mapError(captureCoreDocument(constructed.value, false), invalid));
        yield* stage(table, internalId, document.value, access, "insert");
        return id;
      }
      const table = yield* Effect.fromResult(tableByName(tableName, false, access));
      yield* Effect.fromResult(checkAccess(table, "write", access));
      const body = yield* validateUserBody(table, value, null, access);
      const internalId = idGenerator.nextInternalId();
      const id = yield* Effect.fromResult(publicDocumentId(table, internalId));
      const document = { ...body, _id: id, _creationTime: yield* Effect.fromResult(takeCreationTime()) };
      const record = yield* prepareNativeMutation(access, table, "insert", null, document, body, recordActivity);
      yield* stage(table, internalId, document, access, "insert");
      record();
      markNativeUse(table, document, access);
      return id;
    }))),
    patch: Effect.fn("CoreTransaction.patch")((id: string, value: unknown) => run(Effect.gen(function* () {
      const selected = yield* Effect.fromResult(resolve(id, false, access));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      const patch = yield* Effect.fromResult(Result.mapError(captureDocumentPatch(value), invalid));
      if (Object.hasOwn(patch, "_id") || Object.hasOwn(patch, "_creationTime")) return yield* Effect.fail(invalid());
      const document = yield* read(selected.table, selected.internalId, access);
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
      const captured = yield* validateUserBody(selected.table, body, document, access, managedUpdate);
      const next = { ...captured, _id: originalId, _creationTime: originalTime };
      const record = yield* prepareNativeMutation(access, selected.table, "patch", document, next, captured, recordActivity);
      yield* stage(selected.table, selected.internalId, next, access);
      record();
      markNativeUse(selected.table, next, access);
    }))),
    replace: Effect.fn("CoreTransaction.replace")((id: string, value: unknown) => run(Effect.gen(function* () {
      const selected = yield* Effect.fromResult(resolve(id, false, access));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      // Keep ordinary Source replacement validation before storage demand.
      const capturedBody = access?.kind === "native" && coreNativeRelationalRows(access.authority.definition, selected.table.name) !== undefined
        ? undefined : yield* validateUserBody(selected.table, value, null, access);
      const previous = yield* read(selected.table, selected.internalId, access);
      const body = capturedBody ?? (yield* validateUserBody(selected.table, value, previous, access, managedUpdate));
      yield* Effect.fromResult(chargeDocument(selected.table, previous));
      if (previous === null) return yield* Effect.fail(new CoreTransactionError({ reason: "missingDocument" }));
      const { _id: originalId, _creationTime: originalTime } = previous;
      if (originalId === undefined || originalTime === undefined)
        return yield* Effect.die(new Error("Validated core document lost its system fields"));
      const next = { ...body, _id: originalId, _creationTime: originalTime };
      const record = yield* prepareNativeMutation(access, selected.table, "replace", previous, next, body, recordActivity);
      yield* stage(selected.table, selected.internalId, next, access);
      record();
      markNativeUse(selected.table, next, access);
    }))),
    delete: Effect.fn("CoreTransaction.delete")((id: string) => run(Effect.gen(function* () {
      const selected = yield* Effect.fromResult(resolve(id, false, access));
      yield* Effect.fromResult(chargePointQuery(selected.table, selected.internalId));
      const previous = yield* read(selected.table, selected.internalId, access);
      yield* Effect.fromResult(chargeDocument(selected.table, previous));
      if (previous === null) return;
      const record = yield* prepareNativeMutation(access, selected.table, "delete", previous, null, undefined, recordActivity);
      yield* stage(selected.table, selected.internalId, null, access);
      record();
    }))),
    });
  };

  const transaction: CoreTransaction = Object.freeze({
    timestamp: snapshot.timestamp, unixTime,
    usage: Effect.sync(() => accounting.snapshot()),
    tableMappings: operation(Effect.gen(function* () {
      yield* Effect.fromResult(mappingRead());
      return Object.freeze([...registry.tables.values()].filter(record => record.definition.state === "active"
        && !isCoreSystemTable(record.definition) && coreNamespaceKey(record.definition.namespace) === coreNamespaceKey(namespace))
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
    ...userOperations(),
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
      input.scopeExclusion?.finalized();
      markClosed();
      input.onClosed?.();
      if (input.nativeRoot !== undefined) {
        const finalUserDocuments = [...writes.values()].filter(change => !isCoreSystemTable(change.table)
          && (change.originalDocument !== null || change.finalDocument !== null)).length;
        if (finalUserDocuments > input.nativeRoot.maxFinalUserDocuments)
          return yield* new CoreTransactionError({ reason: "capacity", cause: "Native final user document limit" });
      }
      if (registryAfter !== undefined) yield* authenticateCoreNativeRegistry(registryAfter, input.registry, input.schemaBundles);
      return input.vault.issue(Object.freeze({ namespace, timestamp: snapshot.timestamp, reads: reads.snapshot(), queryReads: accounting.queryReads(),
        ...(input.scopeExclusion === undefined ? {} : { scopeExclusion: input.scopeExclusion }),
        changes: Object.freeze([...writes.values()]), registry: input.registry,
        ...(nativeObservations === undefined ? {} : { nativeObservations: Object.freeze({ ...nativeObservations.snapshot(),
          ...(selectiveMetadata ? { selectiveMetadata: true as const } : {}) }) }),
        ...(registryAfter === undefined ? {} : { registryAfter }),
        ...(input.claim === undefined ? {} : { claim: input.claim }), usage: accounting.snapshot(),
        limits: Object.freeze({ ...(input.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS) }) }));
    })),
    abort: Effect.fn("CoreTransaction.abort")(() => Effect.uninterruptible(Effect.andThen(Effect.sync(markClosed),
      operations.withPermits(1)(Effect.sync(() => input.onClosed?.()))).pipe(Effect.andThen(input.scopeExclusion?.drain ?? Effect.void)))),
  });

  const nativeFind = (access: CoreTransactionNativeAccess | undefined = defaultAccess, withinOperation = false): CoreNativeOperations["find"] => {
    const run = withinOperation ? <Value>(body: Effect.Effect<Value, CoreError>) => body
      : <Value>(body: Effect.Effect<Value, CoreError>) => nativeOperation(access, body);
    return Effect.fn("CoreTransaction.nativeFind")((tableName, inputWhere) => run(Effect.gen(function* () {
    if (nativeObservations === undefined) return yield* invalid();
    const table = yield* Effect.fromResult(tableByName(tableName, false, access));
    const where = yield* Effect.fromResult(captureCoreNativeWhere(inputWhere));
    const selection = yield* Effect.fromResult(planCoreNativeQuery(table, where));
    const matches = prepareCoreNativePredicate(where);
    if (selection.kind === "id") {
      const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(selection.id), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause })));
      if (decoded.tableNumber !== table.number) return yield* new CoreTransactionError({ reason: "invalidDocumentId" });
      yield* Effect.fromResult(chargePointQuery(table, decoded.internalId));
      const document = yield* read(table, decoded.internalId, access);
      yield* Effect.fromResult(chargeDocument(table, document));
      return Object.freeze(document === null || !(yield* Effect.fromResult(matches(document))) ? [] : [document]);
    }
    const charged = new Set<DocumentObject>();
    let capturedOwners: ReadonlySet<string> | undefined;
    if (selection.kind === "all") {
      if (!nativeObservations.hasTable(table)) {
        const byId = table.indexes.find(index => index.name === "by_id");
        if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
        const interval = { start: null, end: null };
        const { membership } = yield* nativeMembership(table, byId, interval, charged, true, access);
        nativeRead(membership.timestamp, byId, interval);
        nativeObservations.rememberTable(table, membership);
      }
    } else if (selection.kind === "unique") {
      const { index, interval } = selection;
      // A complete table replaces future storage selection, but does not widen
      // any key membership that was captured before that table scan.
      if (!nativeObservations.hasTable(table) || nativeObservations.slot(index, interval) !== undefined) {
        const selected = yield* nativeSlot(table, selection.constraint, selection.values, charged, false, access);
        capturedOwners = new Set(selected.membership.members.map(member => member.id));
      }
    } else if (!nativeObservations.hasTable(table) || nativeObservations.range(selection.index, selection.interval) !== undefined) {
      const selected = yield* nativeRange(table, selection.index, selection.interval, charged, access);
      capturedOwners = new Set(selected.members.map(member => member.id));
    }
    // First capture freezes only physical membership. Unwritten originals keep
    // their first observation; every written identity suppresses its original.
    // Source's incrementally maintained pending index supplies final members of
    // this interval, including rows moved in after the physical capture.
    const candidates = new Map(nativeObservations.remembered(table)
      .filter(row => !writes.has(row.id) && (capturedOwners === undefined || capturedOwners.has(row.id)))
      .map(row => [row.id, row.observation.document]));
    if (selection.kind === "all") {
      for (const [id, change] of writes) if (bytesEqual(change.table.tabletId, table.tabletId)) candidates.set(id, change.finalDocument);
    } else for (const document of coreNativePendingIndexDocuments(
      pendingIndexes.get(encodeBytesToLowercaseHex(selection.index.ref.id)), selection.interval,
    )) {
      if (typeof document._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
      candidates.set(document._id, document);
    }
    const result: DocumentObject[] = [];
    for (const [id, document] of [...candidates].toSorted(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) {
      if (document === null) continue;
      if (selection.kind === "unique" || selection.kind === "range") {
        const key = yield* Effect.fromResult(documentIndexKey(selection.index, document));
        if (!keyInInterval(key, selection.interval)) continue;
      }
      if (!charged.has(document)) yield* Effect.fromResult(chargeDocument(table, document));
      if (document._id !== id) return yield* new CorePersistenceError({ reason: "corruptData" });
      if (yield* Effect.fromResult(matches(document))) {
        markNativeUse(table, document, access);
        result.push(document);
      }
    }
    return Object.freeze(result);
    })));
  };

  const nativeFindPage = (access: CoreTransactionNativeAccess | undefined = defaultAccess, withinOperation = false): CoreNativeOperations["findPage"] => Effect.fn("CoreTransaction.nativeFindPage")((tableName, inputWhere, inputOptions) => (withinOperation ? <A>(body: Effect.Effect<A, CoreError>) => body : <A>(body: Effect.Effect<A, CoreError>) => nativeOperation(access, body))(Effect.gen(function* () {
    if (nativeObservations === undefined || native === undefined) return yield* invalid();
    const options = yield* decodeNativePageOptions(inputOptions).pipe(Effect.mapError(cause => new CoreNativeQueryError({ reason: "invalidInput", cause })));
    const { table, index } = yield* Effect.fromResult(selectIndex(tableName, options.indexName, access));
    const where = yield* Effect.fromResult(captureCoreNativeWhere(inputWhere));
    const prefix = access?.kind === "native" ? access.authority.definition.tables.find(declaration => declaration.name === table.name)
      ?.indexes?.find(declaration => declaration.indexName === index.name)?.requiredPrefix : undefined;
    if (prefix !== undefined && !coreNativeEligibilityMatches(prefix, where))
      return yield* new CoreNativeQueryError({ reason: "invalidInput", cause: "Native index requires its declared predicate prefix" });
    const interval = yield* Effect.fromResult(coreNativePageInterval(index, where));
    const matches = prepareCoreNativePredicate(where);
    const captureLimits = yield* Effect.fromResult(nativeObservations.limitsFor(table));
    if (options.offset >= captureLimits.maxIdentities)
      return yield* new CoreTransactionError({ reason: "capacity", cause: "Native page offset limit" });
    const needed = options.offset + options.limit + 1;
    if (!Number.isSafeInteger(needed)) return yield* new CoreNativeQueryError({ reason: "invalidInput" });
    const matched = new Map<string, Readonly<{ document: DocumentObject; key: Uint8Array }>>();
    let examined = 0;
    const add = (id: string, document: DocumentObject, key: Uint8Array) => Effect.gen(function* () {
      if (document._id !== id) return yield* new CorePersistenceError({ reason: "corruptData" });
      if (!keyInInterval(key, interval)) return;
      markNativeUse(table, document, access);
      if (yield* Effect.fromResult(matches(document))) matched.set(id, Object.freeze({ document, key }));
    });
    // Every attempted pending identity counts, even a tombstone or a row outside
    // this range. The same shared writes map supplies the sole overlay.
    for (const [id, change] of writes) if (bytesEqual(change.table.tabletId, table.tabletId)) {
      if (++examined > captureLimits.maxIdentities)
        return yield* new CoreTransactionError({ reason: "capacity", cause: "Native page examined identity limit" });
      yield* native.chargeRetained(64);
      if (change.finalDocument !== null) {
        yield* Effect.fromResult(chargeDocument(table, change.finalDocument));
        yield* add(id, change.finalDocument, yield* Effect.fromResult(documentIndexKey(index, change.finalDocument)));
      }
    }
    let remaining = interval;
    let result: readonly Readonly<{ document: DocumentObject; key: Uint8Array }>[] = [];
    while (true) {
      const available = captureLimits.maxIdentities - examined;
      if (available < 1) return yield* new CoreTransactionError({ reason: "capacity", cause: "Native page examined identity limit" });
      const limit = Math.min(128, Math.max(16, needed - matched.size), available);
      const selected = yield* nativeCapture(table, access, index);
      yield* Effect.fromResult(accounting.query(index.ref.id, remaining));
      const window = yield* captureCoreNativeIndexWindow({ snapshot: selected.indexSnapshot, table, index,
        interval: remaining, maxEntries: limit, assertOpen });
      examined += window.examined;
      if (examined > captureLimits.maxIdentities)
        return yield* new CoreTransactionError({ reason: "capacity", cause: "Native page examined identity limit" });
      yield* native.chargeRetained(128 + window.entries.reduce((bytes, entry) => bytes + 128 + entry.key.length, 0));
      const ids = yield* Effect.forEach(window.entries, entry => Effect.fromResult(publicDocumentId(table, entry.document.id)));
      yield* Effect.fromResult(nativeObservations.reserve(table, ids));
      const byId = table.indexes.find(candidate => candidate.name === "by_id");
      if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
      const observations: Array<Readonly<{ id: string; key: Uint8Array; revision: bigint }>> = [];
      // Capture the complete bounded window before a remembered-body coherence
      // refusal. The physical guard never becomes an original or ById read.
      for (const [position, entry] of window.entries.entries()) {
        const id = ids[position];
        if (id === undefined) return yield* new CorePersistenceError({ reason: "corruptData" });
        let original = nativeObservations.original(id);
        if (original === undefined) {
          if (nativeObservations.hasTable(table)) {
            // A complete earlier table already established this identity's
            // absence. A later index page cannot import a fresh body into it.
            original = yield* nativeRemember(table, id, { original: undefined, document: null, observedAt: snapshot.timestamp });
          } else {
            const observation = yield* captureObservation(table, entry.document, selected.snapshot.timestamp, access);
            if (observation.document === null) return yield* new CorePersistenceError({ reason: "corruptData" });
            original = yield* nativeRemember(table, id, observation);
            const key = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], id), invalid));
            nativeRead(selected.snapshot.timestamp, byId, pointInterval(key));
          }
        }
        // Existing originals are neither refreshed nor revalidated as a new
        // body. The fresh index revision below authenticates their coherence.
        yield* Effect.fromResult(chargeDocument(table, original.document));
        observations.push({ id, key: entry.key, revision: entry.document.ts });
      }
      nativeObservations.rememberPage({ kind: "range", table, index, interval: window.observed,
        maxIdentities: captureLimits.maxIdentities, members: observations.map(row => ({ id: row.id, key: row.key })) });
      for (const row of observations) {
        const original = nativeObservations.original(row.id);
        const revision = original?.original?.ts;
        if (original?.document === null || original?.document === undefined || revision === undefined
          || revision < row.revision || !bytesEqual(yield* Effect.fromResult(documentIndexKey(index, original.document)), row.key))
          return yield* new CoreTransactionError({ reason: "conflict", cause: "Native page owner revision changed" });
        if (!writes.has(row.id)) yield* add(row.id, original.document, row.key);
      }
      result = [...matched.values()].toSorted((left, right) => compareBytesLexicographically(left.key, right.key));
      const frontier = result[needed - 1];
      const witness = window.entries.at(-1);
      // Pending-only output still needs a committed successor or observed EOF.
      if (window.isDone || frontier !== undefined && witness !== undefined
        && compareBytesLexicographically(frontier.key, witness.key) <= 0) break;
      if (window.cursor === null) return yield* new CorePersistenceError({ reason: "corruptData" });
      remaining = splitIndexRangeAfter({ start: remaining.start ?? new Uint8Array(), end: remaining.end }, window.cursor, "asc").remaining;
    }
    const documents = Object.freeze(result.slice(options.offset, options.offset + options.limit).map(member => member.document));
    return Object.freeze({ documents,
      hasMore: result.length > options.offset + options.limit });
  })));

  const prepareNativeRowBatch = Effect.fn("CoreTransaction.prepareNativeRowBatch")(function* (
    tableName: string, inputRows: unknown, deleting: boolean, access: CoreTransactionNativeAccess | undefined,
    entityBatch = false,
  ) {
    if (access?.kind !== "native" || native === undefined || nativeObservations === undefined)
      return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const table = yield* Effect.fromResult(tableByName(tableName, false, access));
    yield* Effect.fromResult(checkAccess(table, "write", access));
    const policy = coreNativeRelationalRows(access.authority.definition, table.name);
    if (policy === undefined) return yield* new CoreNativeQueryError({ reason: "invalidInput", cause: "A relational source is required" });
    const captured = yield* Effect.fromResult(capturePrivateJsonData(inputRows, CORE_TRANSACTION_REFERENCE_LIMITS.bytesRead,
      (reason, cause) => reason === "limitExceeded" ? new CoreTransactionError({ reason: "capacity", cause })
        : new CoreNativeQueryError({ reason: "invalidInput", cause })));
    yield* native.chargeRetained(captured.bytes);
    if (!Array.isArray(captured.value)) return yield* new CoreNativeQueryError({ reason: "invalidInput" });
    const captureLimits = yield* Effect.fromResult(nativeObservations.limitsFor(table));
    if (captured.value.length > captureLimits.maxIdentities)
      return yield* new CoreTransactionError({ reason: "capacity", cause: "Native row batch identity limit" });
    const rows: Array<Readonly<{ identity: Record<string, string>; row: JsonObject }>> = [];
    const identities = new Set<string>();
    for (const item of captured.value) {
      const singleKey = policy.rows.keyColumns.length === 1 ? policy.rows.keyColumns[0] : undefined;
      const row = deleting && typeof item === "string" && singleKey !== undefined ? { [singleKey]: item } : item;
      if (!isJsonObject(row)) return yield* new CoreNativeQueryError({ reason: "invalidInput" });
      yield* Effect.fromResult(policy.rows.validateInput(row, entityBatch ? "defer" : undefined));
      if (deleting && (Object.keys(row).length !== policy.rows.keyColumns.length
        || Object.keys(row).some(key => !policy.rows.keyColumns.some(column => column === key))))
        return yield* new CoreNativeQueryError({ reason: "invalidInput" });
      const identity: Record<string, string> = {};
      for (const key of policy.rows.keyColumns) {
        const value = row[key];
        if (typeof value !== "string" || value.length === 0) return yield* new CoreNativeQueryError({ reason: "invalidInput" });
        identity[key] = value;
      }
      const key = JSON.stringify(policy.rows.keyColumns.map(column => identity[column]));
      if (identities.has(key)) return yield* new CoreNativeQueryError({ reason: "invalidInput", cause: "Duplicate native row identity" });
      identities.add(key);
      rows.push(Object.freeze({ row, identity: Object.freeze(identity) }));
    }
    return { table, policy, rows };
  });

  const nativeWriteRows = (access: CoreTransactionNativeAccess | undefined = defaultAccess): CoreNativeOperations["writeRows"] => Effect.fn("CoreTransaction.nativeWriteRows")((tableName, mode, inputRows, invocation) => nativeBatch(access, Effect.gen(function* () {
    if (mode !== "insert" && mode !== "upsert" && mode !== "upsertPreservingDeletion" && mode !== "update") return yield* new CoreNativeQueryError({ reason: "invalidInput" });
    // This complete preflight precedes the first selected original. In
    // particular a later malformed/duplicate row cannot follow an earlier write.
    const selectedInvocation = yield* decodeNativeWriteInvocation(invocation)
      .pipe(Effect.mapError(cause => new CoreNativeQueryError({ reason: "invalidInput", cause })));
    const entityBatch = mode === "insert" && selectedInvocation?.insertValidation === "entityBatch";
    const { table, policy, rows } = yield* prepareNativeRowBatch(tableName, inputRows, false, access, entityBatch);
    if (entityBatch) for (const { row } of rows)
      yield* Effect.fromResult(policy.rows.validateInsertRequired(row, new Date(unixTime).toISOString()));
    const find = nativeFind(access, true);
    const methods = userOperations(access, true, mode === "upsert" || mode === "upsertPreservingDeletion" ? "preserve" : "advance");
    const result: DocumentObject[] = [];
    for (const { identity, row } of rows) {
      const selected = yield* find(table.name, identity);
      if (selected.length > 1) return yield* new CorePersistenceError({ reason: "corruptData" });
      const previous = selected[0];
      if (previous === undefined && mode === "update") continue;
      if (previous !== undefined && mode === "insert") {
        if (entityBatch) yield* Effect.fromResult(policy.rows.normalize(row, null, new Date(unixTime).toISOString()));
        const primary = policy.table.keys.find(key => key.kind === "primary");
        if (primary === undefined) return yield* new CorePersistenceError({ reason: "corruptData" });
        const failure = yield* Effect.fromResult(nativeUniqueFailure(table, primary.identity.keyId, policy.rows.keyColumns,
          row, "input", access));
        return yield* failure;
      }
      let id: string;
      if (previous === undefined) id = yield* methods.insert(table.name, row);
      else {
        if (typeof previous._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
        id = previous._id;
        const supplied = mode === "upsert" && policy.rows.deletedAt !== undefined ? { ...row, [policy.rows.deletedAt]: null } : row;
        yield* methods.patch(id, supplied);
      }
      const written = writes.get(id)?.finalDocument;
      if (written === undefined || written === null) return yield* new CorePersistenceError({ reason: "corruptData" });
      result.push(written);
    }
    return Object.freeze(result);
  })));

  const nativeReplayRows = (access: Extract<CoreTransactionNativeAccess, { readonly kind: "native" }>): CoreNativeOperations["replayRows"] =>
    Effect.fn("CoreTransaction.nativeReplayRows")((tableName, inputRows) => nativeBatch(access, Effect.gen(function* () {
      if (native === undefined || nativeObservations === undefined) return yield* invalid();
      const { table, policy, rows } = yield* prepareNativeRowBatch(tableName, inputRows, false, access);
      // Replay admits complete values before any lookup. Defaults and numeric
      // conversions cannot turn a partial DTO into recorded-content proof.
      for (const { row } of rows) yield* Effect.fromResult(policy.rows.validate(row, "documentInvalid"));
      if ((yield* nativeCapture(table, access)).history === undefined)
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const limits = yield* Effect.fromResult(nativeObservations.limitsFor(table));
      const methods = userOperations(access, true, "preserve");
      const result: DocumentObject[] = [];
      const provenRevisions = new Set<bigint>();
      for (const { identity, row } of rows) {
        const current = yield* nativeFind(access, true)(table.name, identity);
        if (current.length > 1) return yield* new CoreNativeQueryError({ reason: "invalidInput", cause: "Conflicting replay destinations" });
        let destination = current[0];
        if (destination === undefined) for (const [id, document] of deletedDocuments) {
          const pending = writes.get(id);
          if (pending === undefined || pending.finalDocument !== null || !bytesEqual(pending.table.tabletId, table.tabletId)) continue;
          if (deletedBy.get(id) !== access || !policy.rows.keyColumns.every(key => document[key] === identity[key])) continue;
          if (destination !== undefined) return yield* new CoreNativeQueryError({ reason: "invalidInput", cause: "Conflicting pending replay destinations" });
          destination = document;
        }
        const primary = policy.table.keys.find(key => key.kind === "primary");
        const constraint = table.nativePolicy?.uniqueConstraints.find(key => key.descriptor === primary?.identity.keyId);
        if (constraint === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
        const { index, interval } = yield* Effect.fromResult(coreNativeUniqueSelection(table, constraint,
          policy.rows.keyColumns.map(key => identity[key])));
        const selected = yield* nativeCapture(table, access, index);
        const history = selected.history;
        if (history === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
        yield* history.validate;
        const activeSchema = yield* Effect.fromResult(selected.registry.schemas.nativeByState(table.namespace, "active"));
        if (Option.isNone(activeSchema)) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
        const encoded = encodeNativeRecordedRow(row);
        let proven = false;
        const proveRevision = Effect.fn("CoreTransaction.proveRecordedNativeSource")(function* (revision: CoreDocumentLogEntry) {
          if (provenRevisions.has(revision.ts)) return;
          const tables = selected.registry.table(TABLES)?.definition;
          const schemas = selected.registry.table(SCHEMAS, table.namespace)?.definition;
          if (tables === undefined || schemas === undefined) return yield* new CorePersistenceError({ reason: "corruptData" });
          const readMetadata = Effect.fn("CoreTransaction.readRecordedNativeMetadata")(function* (owner: CoreTableDefinition, id: Uint8Array) {
            const found = yield* history.get(revision.ts, owner.tabletId, id);
            if (Option.isNone(found) || found.value.deleted) return yield* new CorePersistenceError({ reason: "corruptData", cause: "Missing historical native metadata" });
            yield* native.chargeRetained(found.value.jsonValue.length + 128);
            yield* Effect.fromResult(accounting.read(true, found.value.jsonValue.length));
            return yield* Effect.fromResult(readDocumentObject(found.value, owner));
          });
          const tableBody = yield* readMetadata(tables, table.tabletId);
          const historical = yield* Effect.fromResult(parseCoreTableRecord(yield* Effect.fromResult(systemDocument(tableBody)), revision.ts));
          const schemaId = historical.definition.nativePolicy?.schemaId;
          if (schemaId === undefined) return yield* new CorePersistenceError({ reason: "corruptData" });
          const decodedId = yield* Effect.fromResult(Result.mapError(decodeDocumentId(schemaId), cause => new CorePersistenceError({ reason: "corruptData", cause })));
          if (decodedId.tableNumber !== schemas.number) return yield* new CorePersistenceError({ reason: "corruptData" });
          const schemaBody = yield* readMetadata(schemas, decodedId.internalId);
          const schemaDocument = yield* Effect.fromResult(systemDocument(schemaBody));
          const metadata = yield* Effect.fromResult(Result.mapError(decodeCoreSchemaMetadata(schemaDocument.value), cause => new CorePersistenceError({ reason: "corruptData", cause })));
          const schema = yield* Effect.fromResult(Result.mapError(parseCoreSchema(metadata.schema), cause => new CorePersistenceError({ reason: "corruptData", cause })));
          yield* Effect.fromResult(assertCoreHistoricalNativeTable(access.authority.definition, table, historical.definition,
            { id: schemaDocument.id, metadata, schema }, activeSchema.value.schema));
          provenRevisions.add(revision.ts);
        });
        const assertProvingGeneration = Effect.fn("CoreTransaction.assertRecordedNativeGeneration")(function* (id: string) {
          const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), invalid));
          yield* Effect.fromResult(chargePointQuery(table, decoded.internalId));
          const live = yield* read(table, decoded.internalId, access);
          if (live !== null) {
            yield* Effect.fromResult(chargeDocument(table, live));
            if (!policy.rows.keyColumns.every(key => live[key] === identity[key]))
              return yield* new CoreNativeQueryError({ reason: "invalidInput", cause: "Recorded generation has a different live native key" });
          }
        });
        const acceptDocument = Effect.fn("CoreTransaction.acceptRecordedNativeDocument")(function* (document: DocumentObject | null,
          revision?: CoreDocumentLogEntry) {
          if (document === null) return;
          const body = yield* Effect.fromResult(coreNativeRelationalRow(document));
          if (encodeNativeRecordedRow(body) !== encoded) return;
          if (revision !== undefined) yield* proveRevision(revision);
          if (typeof document._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
          yield* assertProvingGeneration(document._id);
          proven = true;
        });
        for (const change of writes.values()) {
          if (!bytesEqual(change.table.tabletId, table.tabletId)) continue;
          yield* acceptDocument(change.finalDocument);
          yield* acceptDocument(change.originalDocument, change.original);
          yield* acceptDocument(deletedDocuments.get(yield* Effect.fromResult(publicDocumentId(table, change.id))) ?? null);
        }
        for (const remembered of nativeObservations.remembered(table))
          yield* acceptDocument(remembered.observation.document, remembered.observation.original);
        for (const entry of nativeActivity.recordedRows(access, table.name)) {
          if (encodeNativeRecordedRow(entry.row) !== encoded) continue;
          yield* assertProvingGeneration(entry.documentId);
          proven = true;
        }
        if (!proven) {
          const maximum = Math.min(limits.maxIdentities * limits.maxIdentities,
            (input.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS).documentsRead);
          const revisions = new Map<string, number>();
          let examined = 0, after: import("./contracts").CoreIndexHistoryCursor | undefined;
          while (true) {
            const page = yield* history.page({ index: index.ref, tableId: table.tabletId, interval,
              maxResults: Math.min(limits.maxIdentities, maximum - examined + 1), maxBytes: native.remainingBytes(),
              maxDocumentBytes: limits.maxDocumentBytes, ...(after === undefined ? {} : { after }) });
            for (let ordinal = 0; ordinal < page.examined; ordinal++)
              yield* Effect.fromResult(accounting.read(false, ordinal === 0 ? page.keyBytes + page.documentBytes : 0));
            yield* native.chargeRetained(page.examined * 128 + page.keyBytes + page.documentBytes);
            examined += page.examined;
            if (examined > maximum || page.overBudget) return yield* new CoreTransactionError({ reason: "capacity", cause: "Native retained history limit" });
            for (const entry of page.entries) {
              if (entry.document === null) continue;
              const id = yield* Effect.fromResult(publicDocumentId(table, entry.document.id));
              yield* Effect.fromResult(nativeObservations.reserve(table, [id]));
              const count = (revisions.get(id) ?? 0) + 1;
              revisions.set(id, count);
              if (count > limits.maxIdentities) return yield* new CoreTransactionError({ reason: "capacity", cause: "Native retained revision limit" });
              const document = yield* Effect.fromResult(readDocumentObject(entry.document, table));
              const key = yield* Effect.fromResult(documentIndexKey(index, document));
              if (!bytesEqual(key, entry.key)) return yield* new CorePersistenceError({ reason: "corruptData", cause: "Historical index key differs from its canonical revision" });
              if (!keyInInterval(key, interval)) continue;
              const body = yield* Effect.fromResult(coreNativeRelationalRow(document));
              yield* Effect.fromResult(policy.rows.validate(body, "storedCorruption"));
              yield* acceptDocument(document, entry.document);
            }
            if (page.done) break;
            if (page.cursor === null || page.examined === 0) return yield* new CorePersistenceError({ reason: "corruptData" });
            after = page.cursor;
          }
        }
        yield* history.validate;
        yield* nativeCapture(table, access, index);
        if (!proven) return yield* (history.minimumTimestamp > 0n ? new CorePersistenceError({ reason: "outOfRetention" })
          : new CoreNativeQueryError({ reason: "invalidInput", cause: "Native row was not recorded" }));
        let id: string;
        if (destination === undefined) id = yield* methods.insert(table.name, row);
        else {
          if (typeof destination._id !== "string" || typeof destination._creationTime !== "number")
            return yield* new CorePersistenceError({ reason: "corruptData" });
          id = destination._id;
          const pending = writes.get(id);
          if (pending?.finalDocument === null) {
            yield* enforceUserSchema(table, row);
            const next = { ...row, _id: id, _creationTime: destination._creationTime };
            const record = yield* prepareNativeMutation(access, table, "insert", null, next, row);
            yield* stage(table, pending.id, next, access);
            record(); markNativeUse(table, next, access);
          } else yield* methods.replace(id, row);
        }
        const written = writes.get(id)?.finalDocument;
        if (written === undefined || written === null) return yield* new CorePersistenceError({ reason: "corruptData" });
        result.push(written);
      }
      yield* nativeCapture(table, access);
      return Object.freeze(result);
    })));

  const nativeCheckpointReferences = (access: CoreTransactionNativeAccess | undefined = defaultAccess): CoreNativeOperations["checkpointReferences"] =>
    Effect.fn("CoreTransaction.checkpointReferences")((tableName) => nativeOperation(access, Effect.gen(function* () {
      if (access?.kind !== "native" || native === undefined || nativeObservations === undefined)
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const table = yield* Effect.fromResult(tableByName(tableName, false, access));
      yield* Effect.fromResult(checkAccess(table, "write", access));
      const policy = coreNativeRelationalRows(access.authority.definition, table.name);
      if (policy === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const find = nativeFind(access, true);
      for (const [id, change] of writes) {
        if (change.finalDocument === null || !bytesEqual(change.table.tabletId, table.tabletId)) continue;
        for (const foreignKey of table.nativePolicy?.foreignKeys ?? []) {
          if (foreignKey.sourceTable !== table.name) continue;
          const selected = yield* Effect.fromResult(selectCoreNativeForeignKey(registry, table, foreignKey));
          const tuple = yield* Effect.fromResult(coreNativeKeyTuple(change.finalDocument, foreignKey.sourceFields, true));
          if (tuple === null) continue;
          const where = yield* Effect.fromResult(coreNativeKeyWhere(foreignKey.targetFields, tuple));
          if ((yield* find(selected.target.name, where)).length > 0) continue;
          const target = coreNativeRelationalRows(access.authority.definition, selected.target.name);
          if (target === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          return yield* coreNativeForeignKeyError(foreignKey, "targetMissing", { storage: "core", origin: "checkpoint",
            descriptor: foreignKey.descriptor, child: { identity: policy.table.identity, tableName: policy.table.identity.tableId,
              documentId: id }, sourceColumns: foreignKey.sourceFields,
            target: { identity: target.table.identity, tableName: target.table.identity.tableId,
              columns: foreignKey.targetFields, values: tuple } });
        }
      }
    })));

  const nativeDeleteRows = (access: CoreTransactionNativeAccess | undefined = defaultAccess): CoreNativeOperations["deleteRows"] => Effect.fn("CoreTransaction.nativeDeleteRows")((tableName, inputKeys) => nativeBatch(access, Effect.gen(function* () {
    const { table, rows } = yield* prepareNativeRowBatch(tableName, inputKeys, true, access);
    const find = nativeFind(access, true), methods = userOperations(access, true);
    const result: DocumentObject[] = [];
    for (const { identity } of rows) {
      const selected = yield* find(table.name, identity);
      if (selected.length > 1) return yield* new CorePersistenceError({ reason: "corruptData" });
      const previous = selected[0];
      if (previous === undefined) continue;
      if (typeof previous._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
      yield* methods.delete(previous._id);
      result.push(previous);
    }
    return Object.freeze(result);
  })));

  const nativeLifecycle = (access: CoreTransactionNativeAccess | undefined = defaultAccess): CoreNativeOperations["lifecycle"] => Effect.fn("CoreTransaction.nativeLifecycle")((tableName, mode, inputKeys, invocation) => nativeBatch(access, Effect.gen(function* () {
    if (mode !== "softDelete" && mode !== "restore") return yield* new CoreNativeQueryError({ reason: "invalidInput" });
    const selectedInvocation = yield* decodeNativeLifecycleInvocation(invocation)
      .pipe(Effect.mapError(cause => new CoreNativeQueryError({ reason: "invalidInput", cause })));
    const { table, policy, rows } = yield* prepareNativeRowBatch(tableName, inputKeys, true, access);
    if (policy.rows.deletedAt === undefined) return yield* new CoreNativeQueryError({ reason: "invalidInput", cause: "Soft deletion is not admitted" });
    const find = nativeFind(access, true), methods = userOperations(access, true);
    const recordLifecycle = Effect.fn("CoreTransaction.recordNativeLifecycle")(function* (
      identity: Readonly<Record<string, string>>, before: DocumentObject, after: DocumentObject, changed: boolean,
    ) {
      if (access?.kind !== "native" || !nativeActivity.active(access)) return;
      const deletedAt = policy.rows.deletedAt;
      const previous = deletedAt === undefined ? undefined : before[deletedAt], next = deletedAt === undefined ? undefined : after[deletedAt];
      if (previous !== null && typeof previous !== "string" || next !== null && typeof next !== "string")
        return yield* new CorePersistenceError({ reason: "corruptData" });
      const rowAtOperation = changed ? null : yield* Effect.fromResult(coreNativeRelationalRow(after));
      yield* nativeActivity.lifecycle(access, { table: table.name, key: identity, operation: mode,
        beforeDeletedAt: previous, afterDeletedAt: next, rowAtOperation }, changed);
    });
    const result: DocumentObject[] = [];
    for (const { identity } of rows) for (const previous of yield* find(table.name, identity)) {
      if (typeof previous._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
      // The default preserves an active row; a selected native policy can
      // require a real update through the same managed-field write owner.
      if (mode === "restore" && selectedInvocation?.allowActiveRestoreUpdate !== true && previous[policy.rows.deletedAt] === null) {
        yield* recordLifecycle(identity, previous, previous, false);
        result.push(previous); continue;
      }
      yield* methods.patch(previous._id, { [policy.rows.deletedAt]: mode === "restore" ? null : new Date(unixTime).toISOString() });
      const document = writes.get(previous._id)?.finalDocument;
      if (document === undefined || document === null) return yield* new CorePersistenceError({ reason: "corruptData" });
      yield* recordLifecycle(identity, previous, document, true);
      result.push(document);
    }
    return Object.freeze(result);
  })));

  const nativePlanSetNull = (access: CoreTransactionNativeAccess | undefined = defaultAccess): CoreNativeOperations["planSetNullReferences"] =>
    Effect.fn("CoreTransaction.planSetNullReferences")((inputSelection) => nativeBatch(access, Effect.gen(function* () {
      if (access?.kind !== "native" || native === undefined || setNullPrepared || referenceReplacement !== undefined)
        return yield* new CoreNativeReferencePlanError({ reason: "invalidAuthority" });
      if (setNullPlans.filter(plan => sameCoreNativeIdentity(plan.access.authority.definition.identity, access.authority.definition.identity)).length >= 16)
        return yield* new CoreTransactionError({ reason: "capacity", cause: "Native source set-null intent limit" });
      const captured = yield* Effect.fromResult(capturePrivateJsonData(inputSelection, CORE_TRANSACTION_REFERENCE_LIMITS.bytesRead,
        (reason, cause) => reason === "limitExceeded" ? new CoreTransactionError({ reason: "capacity", cause }) : new CoreNativeQueryError({ reason: "invalidInput", cause })));
      yield* native.chargeRetained(captured.bytes);
      const selection = yield* decodeNativeSetNull(captured.value).pipe(Effect.mapError(() => new CoreNativeReferencePlanError({ reason: "invalidAuthority" })));
      const source = yield* Effect.fromResult(tableByName(selection.sourceTable, false, access));
      const target = yield* Effect.fromResult(tableByName(selection.targetTable, false, access));
      yield* Effect.fromResult(checkAccess(source, "write", access));
      yield* Effect.fromResult(checkAccess(target, "write", access));
      const foreignKey = source.nativePolicy?.foreignKeys?.find(key => key.sourceTable === source.name && key.targetTable === target.name
        && key.sourceFields.length === 1 && key.sourceFields[0] === selection.sourceColumn
        && key.targetFields.length === 1 && key.targetFields[0] === selection.targetColumn && key.onDelete === "noAction");
      const policy = coreNativeRelationalRows(access.authority.definition, source.name);
      if (foreignKey === undefined || policy?.table.columns.find(column => column.identity.columnId === selection.sourceColumn)?.nullable !== true
        || setNullPlans.some(plan => plan.selection.sourceTable === source.name && plan.selection.sourceColumn === selection.sourceColumn
          && plan.selection.targetTable === target.name && plan.selection.targetColumn === selection.targetColumn && plan.selection.targetKey === selection.targetKey))
        return yield* new CoreNativeReferencePlanError({ reason: "invalidAuthority" });
      const selected = yield* Effect.fromResult(selectCoreNativeForeignKey(registry, source, foreignKey));
      const roots = [...writes].filter(([id, change]) => bytesEqual(change.table.tabletId, target.tabletId)
        && change.finalDocument === null && deletedBy.get(id) === access && deletedDocuments.get(id)?.[selection.targetColumn] === selection.targetKey);
      const replacement = [...writes.values()].some(change => bytesEqual(change.table.tabletId, target.tabletId)
        && change.finalDocument?.[selection.targetColumn] === selection.targetKey);
      const sourceEdited = nativeReferenceTouches.some(touch => touch.sourceTable === source.name && touch.descriptor === foreignKey.descriptor
        && sameCoreNativeKeyTuple(touch.values, [selection.targetKey]));
      if (roots.length !== 1 || replacement || sourceEdited) return yield* new CoreNativeReferencePlanError({ reason: "invalidAuthority" });
      yield* native.chargeRetained(128 + selection.targetKey.length * 2);
      const intent = Object.freeze({ ...selection });
      setNullPlans.push(Object.freeze({ access, selection: intent, foreignKey: selected }));
      nativeActivity.setNull(access, intent);
    }), true));

  const prepareNativeSetNull = Effect.fn("CoreTransaction.prepareNativeSetNull")(function* () {
    if (setNullPrepared || setNullPlans.length === 0) return;
    for (const plan of setNullPlans) {
      const { access, selection, foreignKey } = plan;
      const find = nativeFind(access, true), methods = userOperations(access, true, selection.managedUpdate, false);
      for (const document of yield* find(foreignKey.source.name, { [selection.sourceColumn]: selection.targetKey })) {
        if (typeof document._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
        yield* methods.patch(document._id, { [selection.sourceColumn]: null });
      }
    }
    setNullPrepared = true;
  });

  const nativePrepareDeleteClosure = (access: CoreTransactionNativeAccess | undefined = defaultAccess): CoreNativeOperations["prepareDeleteClosure"] => Effect.fn("CoreTransaction.nativePrepareDeleteClosure")(() => nativeBatch(access, Effect.gen(function* () {
    if (access?.kind !== "native") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    yield* prepareNativeSetNull();
    const find = nativeFind(access, true), methods = userOperations(access, true, "advance", false);
    const visited = new Set<string>();
    // Cascade to a fixed point before checking noAction branches: a sibling
    // cascade can remove a row that would otherwise restrict another edge.
    while (true) {
      let expanded = false;
      const pendingChanges = [...writes];
      for (const [id, change] of pendingChanges) {
        if (change.finalDocument !== null
          || !access.authority.tables.some(table => bytesEqual(table.tabletId, change.table.tabletId))) continue;
        const preimages = [change.originalDocument, deletedDocuments.get(id)].filter(document => document !== null && document !== undefined);
        for (const document of preimages) for (const foreignKey of change.table.nativePolicy?.foreignKeys ?? []) {
          if (foreignKey.targetTable !== change.table.name || foreignKey.onDelete !== "cascade") continue;
          const selected = yield* Effect.fromResult(selectCoreNativeForeignKey(registry, change.table, foreignKey));
          const tuple = yield* Effect.fromResult(coreNativeKeyTuple(document, foreignKey.targetFields));
          if (tuple === null) return yield* new CorePersistenceError({ reason: "corruptData" });
          const key = `${encodeBytesToLowercaseHex(selected.target.tabletId)}:${foreignKey.descriptor}:${JSON.stringify(tuple)}`;
          if (visited.has(key)) continue;
          const targetWhere = yield* Effect.fromResult(coreNativeKeyWhere(foreignKey.targetFields, tuple));
          // Final replacement under the same native key preserves its children.
          if ((yield* find(selected.target.name, targetWhere)).length > 0) continue;
          visited.add(key);
          const sourceWhere = yield* Effect.fromResult(coreNativeKeyWhere(foreignKey.sourceFields, tuple));
          for (const child of yield* find(selected.source.name, sourceWhere)) {
            if (typeof child._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
            yield* methods.delete(child._id);
            expanded = true;
          }
        }
      }
      if (!expanded) break;
    }
    for (const change of writes.values()) {
      if (change.originalDocument === null || !access.authority.tables.some(table => bytesEqual(table.tabletId, change.table.tabletId))) continue;
      for (const foreignKey of change.table.nativePolicy?.foreignKeys ?? []) {
        if (foreignKey.targetTable !== change.table.name) continue;
        const selected = yield* Effect.fromResult(selectCoreNativeForeignKey(registry, change.table, foreignKey));
        const tuple = yield* Effect.fromResult(coreNativeKeyTuple(change.originalDocument, foreignKey.targetFields));
        const next = change.finalDocument === null ? null : yield* Effect.fromResult(coreNativeKeyTuple(change.finalDocument, foreignKey.targetFields));
        if (tuple === null) return yield* new CorePersistenceError({ reason: "corruptData" });
        if (next !== null && sameCoreNativeKeyTuple(tuple, next)) continue;
        const targetWhere = yield* Effect.fromResult(coreNativeKeyWhere(foreignKey.targetFields, tuple));
        if ((yield* find(selected.target.name, targetWhere)).length > 0) continue;
        const sourceWhere = yield* Effect.fromResult(coreNativeKeyWhere(foreignKey.sourceFields, tuple));
        if ((yield* find(selected.source.name, sourceWhere)).length > 0)
          return yield* coreNativeForeignKeyError(foreignKey, change.finalDocument === null ? "deleteRestricted" : "updateRestricted");
      }
    }
    for (const change of writes.values()) {
      if (change.finalDocument === null || !access.authority.tables.some(table => bytesEqual(table.tabletId, change.table.tabletId))) continue;
      for (const foreignKey of change.table.nativePolicy?.foreignKeys ?? []) {
        if (foreignKey.sourceTable !== change.table.name) continue;
        const selected = yield* Effect.fromResult(selectCoreNativeForeignKey(registry, change.table, foreignKey));
        const tuple = yield* Effect.fromResult(coreNativeKeyTuple(change.finalDocument, foreignKey.sourceFields, true));
        if (tuple === null) continue;
        const where = yield* Effect.fromResult(coreNativeKeyWhere(foreignKey.targetFields, tuple));
        if ((yield* find(selected.target.name, where)).length === 0) return yield* coreNativeForeignKeyError(foreignKey, "targetMissing");
      }
    }
    return Object.freeze([...writes].flatMap(([id, change]) => change.originalDocument !== null && change.finalDocument === null
      && access.authority.tables.some(table => bytesEqual(table.tabletId, change.table.tabletId))
      ? [Object.freeze({ table: change.table.name, document: deletedDocuments.get(id) ?? change.originalDocument })] : []));
  }), true));

  const nativeIsEmpty = (access: CoreTransactionNativeAccess | undefined = defaultAccess): CoreNativeOperations["isEmpty"] => Effect.fn("CoreTransaction.nativeIsEmpty")((tableName) => nativeOperation(access, Effect.gen(function* () {
    if (nativeObservations === undefined) return yield* invalid();
    const { table, index } = yield* Effect.fromResult(selectIndex(tableName, "by_id", access));
    for (const change of writes.values()) if (bytesEqual(change.table.tabletId, table.tabletId) && change.finalDocument !== null)
      return false;
    const selected = yield* nativeCapture(table, access, index);
    const captureLimits = yield* Effect.fromResult(nativeObservations.limitsFor(table));
    const interval: CoreInterval = { start: null, end: null };
    const members: Array<Readonly<{ id: string; key: Uint8Array }>> = [];
    let remaining = interval;
    yield* Effect.fromResult(accounting.query(index.ref.id, interval));
    while (true) {
      // A boolean key probe must not hydrate or validate an entire native row
      // cohort merely to distinguish an empty table from one with 129 rows.
      const page = yield* selected.snapshot.scan({ tableId: table.tabletId, index: index.ref,
        interval: remaining, order: "asc", maxResults: 1 });
      yield* assertOpen();
      const entry = page.entries[0];
      if (entry === undefined) {
        if (page.cursor.kind !== "end") return yield* new CorePersistenceError({ reason: "corruptData" });
        nativeObservations.rememberRange({ kind: "range", table, index, interval, members, maxIdentities: captureLimits.maxIdentities });
        return true;
      }
      if (entry.document.deleted || !bytesEqual(entry.document.tableId, table.tabletId)
        || entry.document.ts > selected.snapshot.timestamp || !keyInInterval(entry.key, remaining))
        return yield* new CorePersistenceError({ reason: "corruptData" });
      const id = yield* Effect.fromResult(publicDocumentId(table, entry.document.id));
      const expectedKey = yield* Effect.fromResult(Result.mapError(encodeIndexKey([], id), invalid));
      if (!bytesEqual(expectedKey, entry.key)) return yield* new CorePersistenceError({ reason: "corruptData" });
      yield* Effect.fromResult(nativeObservations.reserve(table, [id]));
      const member = { id, key: entry.key };
      if (writes.get(id)?.finalDocument !== null) {
        // The positive witness is key presence, not a body/revision read.
        nativeObservations.rememberRange({ kind: "range", table, index, interval: pointInterval(entry.key),
          members: [member], maxIdentities: captureLimits.maxIdentities });
        return false;
      }
      members.push(member);
      if (page.entries.length === 1 && page.cursor.kind === "end") {
        nativeObservations.rememberRange({ kind: "range", table, index, interval, members, maxIdentities: captureLimits.maxIdentities });
        return true;
      }
      remaining = splitIndexRangeAfter({ start: remaining.start ?? new Uint8Array(), end: remaining.end }, entry.key, "asc").remaining;
    }
  })));

  const nativeReplaceReferenceSet = (access: CoreTransactionNativeAccess | undefined = defaultAccess): CoreNativeOperations["replaceReferenceSet"] => Effect.fn("CoreTransaction.nativeReplaceReferenceSet")((inputSelection) => nativeBatch(access, Effect.gen(function* () {
    if (access?.kind !== "native" || native === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    if (referenceReplacement !== undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked", cause: "Only one native reference replacement is admitted" });
    const captured = yield* Effect.fromResult(capturePrivateJsonData(inputSelection, CORE_TRANSACTION_REFERENCE_LIMITS.bytesRead,
      (reason, cause) => reason === "limitExceeded" ? new CoreTransactionError({ reason: "capacity", cause }) : new CoreNativeQueryError({ reason: "invalidInput", cause })));
    yield* native.chargeRetained(captured.bytes);
    const selection = yield* decodeNativeReferenceReplacement(captured.value).pipe(Effect.mapError(cause => new CoreNativeQueryError({ reason: "invalidInput", cause })));
    const source = yield* Effect.fromResult(tableByName(selection.sourceTable, false, access));
    const foreignKey = source.nativePolicy?.foreignKeys?.find(key => key.sourceTable === source.name && key.sourceFields.length === 1
      && key.sourceFields[0] === selection.sourceColumn && key.targetTable === selection.targetTable && key.targetFields.length === 1
      && key.targetFields[0] === selection.targetColumn && key.onDelete === "noAction");
    const policy = coreNativeRelationalRows(access.authority.definition, source.name);
    const sourceKey = policy?.rows.keyColumns.length === 1 ? policy.rows.keyColumns[0] : undefined;
    if (foreignKey === undefined || policy === undefined || sourceKey === undefined
      || policy.table.columns.find(column => column.identity.columnId === selection.sourceColumn)?.nullable !== true
      || policy.table.keys.some(key => key.columns.some(column => column.columnId === selection.sourceColumn)))
      return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const selected = yield* Effect.fromResult(selectCoreNativeForeignKey(registry, source, foreignKey));
    // This trusted native command replaces membership for a target it actually
    // changed in this root, preserving the former confined command contract.
    if (![...writes.values()].some(change => bytesEqual(change.table.tabletId, selected.target.tabletId)
      && change.originalDocument !== null && change.finalDocument?.[selection.targetColumn] === selection.targetKey))
      return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const desired = new Set(selection.desiredKeys), changes = new Map<string, Readonly<{ id: string; value: string | null }>>();
    const find = nativeFind(access, true), methods = userOperations(access, true, "advance", false);
    for (const document of yield* find(source.name, { [selection.sourceColumn]: selection.targetKey })) {
      if (policy.rows.deletedAt !== undefined && document[policy.rows.deletedAt] !== null) continue;
      const key = document[sourceKey];
      if (typeof key !== "string" || typeof document._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
      if (!desired.has(key)) changes.set(document._id, { id: document._id, value: null });
    }
    for (const key of desired) for (const document of yield* find(source.name, { [sourceKey]: key })) {
      if (policy.rows.deletedAt !== undefined && document[policy.rows.deletedAt] !== null) continue;
      if (typeof document._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
      changes.set(document._id, { id: document._id, value: selection.targetKey });
    }
    if (changes.size > 255) return yield* new CoreTransactionError({ reason: "capacity", cause: "Native reference replacement row limit" });
    for (const change of changes.values()) yield* methods.patch(change.id, { [selection.sourceColumn]: change.value });
    const intent = Object.freeze({ ...selection, desiredKeys: Object.freeze([...desired]) });
    referenceReplacement = Object.freeze({ access, source, ids: Object.freeze([...changes.keys()]), selection: intent });
    nativeActivity.referenceReplacement(access, intent);
    return Object.freeze(nativeReferenceReplacementDocuments(access));
  })));

  const nativeReferenceReplacementDocuments = (access: CoreTransactionNativeAccess | undefined): DocumentObject[] => {
    const replacement = referenceReplacement;
    if (replacement === undefined || replacement.access !== access) return [];
    return replacement.ids.flatMap(id => {
      const change = writes.get(id);
      return change?.finalDocument !== null && change?.finalDocument !== undefined ? [change.finalDocument] : [];
    });
  };

  const nativeMatchRelational = (access: Extract<CoreTransactionNativeAccess, { readonly kind: "native" }>): CoreNativeOperations["matchRelational"] =>
    Effect.fn("CoreTransaction.matchRelational")((tableName, program, rows) => nativeOperation(access, Effect.gen(function* () {
      if (native === undefined || nativeObservations === undefined) return yield* invalid();
      const table = yield* Effect.fromResult(tableByName(tableName, false, access));
      const policy = coreNativeRelationalRows(access.authority.definition, table.name);
      if (policy === undefined) return yield* new CoreNativeQueryError({ reason: "invalidInput" });
      // Membership and originals were already captured by find. This source
      // capture validates admission even for cached, pending-only or empty rows.
      yield* nativeCapture(table, access);
      const limits = yield* Effect.fromResult(nativeObservations.limitsFor(table));
      const batch = yield* Effect.fromResult(preparePostgresRelationalBatch(program, policy.table, table, rows,
        { rows: limits.maxIdentities, bytes: native.remainingBytes() }, nativeRelationalPredicateFailure));
      const inspected = yield* Effect.fromResult(inspectPostgresRelationalBatch(batch, table, nativeRelationalPredicateFailure));
      yield* native.chargeRetained(inspected.inputBytes);
      const raw = yield* native.evaluateRelational(batch);
      const decoded = yield* Effect.fromResult(decodePostgresRelationalMatches(batch, table, raw, nativeRelationalPredicateFailure));
      yield* native.chargeRetained(decoded.bytes);
      // Success-only source validation preserves the complete original Cause
      // when planning, transport, decoding or the byte owner refuses the body.
      yield* nativeCapture(table, access);
      return decoded.matches;
    })));

  const nativeOperationsFor = (access: Extract<CoreTransactionNativeAccess, { readonly kind: "native" }>): CoreNativeOperations => Object.freeze({
    ...userOperations(access), find: nativeFind(access), findPage: nativeFindPage(access), matchRelational: nativeMatchRelational(access),
    nativeActivityCursor: () => nativeActivity.cursor(access),
    nativeActivitySince: cursor => operation(Effect.gen(function* () {
      if (access?.kind !== "native" || !nativeAccesses.has(access) || native === undefined || nativeObservations === undefined)
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const activity = yield* Effect.fromResult(nativeActivity.since(access, cursor));
      const uses = yield* Effect.fromResult(nativeActivity.usesSince(access, cursor));
      const observedRows: Array<Readonly<{ table: string; row: JsonObject }>> = [];
      for (const use of uses) {
        const pending = writes.get(use.id);
        const document = pending === undefined ? nativeObservations.original(use.id)?.document : pending.finalDocument;
        if (document === undefined || document === null) continue;
        let row = nativeActivityRows.get(document);
        if (row === undefined) {
          const body = yield* Effect.fromResult(coreNativeRelationalRow(document));
          const captured = yield* Effect.fromResult(useCapturedPrivateJsonData(body, Number.MAX_SAFE_INTEGER,
            (reason, cause) => new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause })));
          if (!isJsonObject(captured.value)) return yield* new CorePersistenceError({ reason: "corruptData" });
          yield* native.chargeRetained(captured.bytes + 96);
          row = captured.value;
          nativeActivityRows.set(document, row);
        }
        observedRows.push(Object.freeze({ table: use.table, row }));
      }
      return Object.freeze({ ...activity, observedRows: Object.freeze(observedRows) });
    })),
    writeRows: nativeWriteRows(access), deleteRows: nativeDeleteRows(access), lifecycle: nativeLifecycle(access),
    replayRows: nativeReplayRows(access),
    checkpointReferences: nativeCheckpointReferences(access),
    planSetNullReferences: nativePlanSetNull(access),
    prepareDeleteClosure: nativePrepareDeleteClosure(access), isEmpty: nativeIsEmpty(access),
    replaceReferenceSet: nativeReplaceReferenceSet(access),
    referenceReplacementChanges: Effect.fn("CoreTransaction.nativeReferenceReplacementChanges")(() => operation(Effect.gen(function* () {
      if (access?.kind !== "native") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      return referenceReplacement?.access !== access ? [] : Object.freeze([Object.freeze({ sourceTable: referenceReplacement.source.name,
        documents: Object.freeze(nativeReferenceReplacementDocuments(access)) })]);
    }))),
    protectedReferencePage: Effect.fn("CoreTransaction.nativeProtectedReferencePage")((name, targetId, inputOptions) => nativeOperation(access, Effect.gen(function* () {
      if (access?.kind !== "native" || native === undefined || nativeObservations === undefined || typeof targetId !== "string")
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const options = yield* decodeProtectedPageOptions(inputOptions).pipe(Effect.mapError(cause => new CoreNativeQueryError({ reason: "invalidInput", cause })));
      const candidates = access.authority.tables.flatMap(table => (table.nativePolicy?.protectedReferences ?? [])
        .filter(reference => reference.sourceTable === table.name && (reference.reference.name === name || reference.field === name))
        .map(reference => ({ table, reference })));
      if (candidates.length !== 1) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const candidate = candidates[0];
      if (candidate === undefined || candidate.reference.reference.liveness.source.kind !== "current")
        return yield* new CoreNativeQueryError({ reason: "invalidInput" });
      const table = yield* Effect.fromResult(tableByName(candidate.table.name, false, access));
      const index = table.indexes.find(value => value.name === candidate.reference.indexName);
      if (index === undefined || index.fields[0] !== candidate.reference.field) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
      const selected = yield* nativeCapture(table, access, index);
      yield* Effect.fromResult(observeProtectedTraversalTarget(selected, table, candidate.reference));
      const interval = yield* Effect.fromResult(coreNativeKeyInterval(index, [candidate.reference.field], [targetId]));
      const generation = pendingGenerations.get(encodeBytesToLowercaseHex(table.tabletId)) ?? 0;
      if (options.generation !== undefined && options.generation !== generation
        || options.position !== undefined && (options.generation === undefined || !keyInInterval(options.position, interval)))
        return yield* new CoreTransactionError({ reason: "conflict", cause: "Protected reference page generation changed" });
      const start = options.position === undefined ? interval.start
        : splitIndexRangeAfter({ start: interval.start ?? new Uint8Array(), end: interval.end }, options.position, "asc").remaining.start;
      let remaining: CoreInterval = { start, end: interval.end };
      const matches = new Map<string, Readonly<{ id: string; key: Uint8Array }>>();
      const pending = pendingIndexes.get(encodeBytesToLowercaseHex(index.ref.id));
      if (pending !== undefined) for (const [key, document] of pending.entries(remaining.start ?? undefined)) {
        if (remaining.end !== null && compareBytesLexicographically(key, remaining.end) >= 0) break;
        if (document === null) continue;
        if (typeof document._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
        matches.set(document._id, { id: document._id, key });
      }
      const captureLimits = yield* Effect.fromResult(nativeObservations.limitsFor(table));
      let inspectedMemberships = 0, complete = false;
      while (true) {
        const window = yield* captureCoreNativeIndexWindow({ snapshot: selected.indexSnapshot, table, index, interval: remaining,
          maxEntries: options.limit + 1, assertOpen });
        inspectedMemberships += window.examined;
        if (inspectedMemberships > Math.min(256, captureLimits.maxIdentities))
          return yield* new CoreTransactionError({ reason: "capacity", cause: "Protected reference examined identity limit" });
        const members = yield* Effect.forEach(window.entries, entry => Effect.gen(function* () {
          const id = yield* Effect.fromResult(publicDocumentId(table, entry.document.id));
          yield* Effect.fromResult(nativeObservations.reserve(table, [id]));
          if (!writes.has(id)) matches.set(id, { id, key: entry.key });
          return { id, key: entry.key };
        }));
        yield* Effect.fromResult(accounting.query(index.ref.id, window.observed));
        nativeObservations.rememberPage({ kind: "range", table, index, interval: window.observed, members,
          maxIdentities: captureLimits.maxIdentities });
        yield* native.chargeRetained(128 + members.reduce((bytes, member) => bytes + 128 + member.key.length, 0));
        complete = window.isDone;
        const ordered = [...matches.values()].toSorted((left, right) => compareBytesLexicographically(left.key, right.key));
        const frontier = ordered[options.limit], witness = window.entries.at(-1);
        if (complete || frontier !== undefined && witness !== undefined && compareBytesLexicographically(frontier.key, witness.key) <= 0) break;
        if (window.cursor === null) return yield* new CorePersistenceError({ reason: "corruptData" });
        remaining = splitIndexRangeAfter({ start: remaining.start ?? new Uint8Array(), end: remaining.end }, window.cursor, "asc").remaining;
      }
      const ordered = [...matches.values()].toSorted((left, right) => compareBytesLexicographically(left.key, right.key));
      const returned = ordered.slice(0, options.limit), hasMore = ordered.length > options.limit || !complete;
      const position = hasMore ? returned.at(-1)?.key.slice() ?? null : null;
      return Object.freeze({ ids: Object.freeze(returned.map(member => member.id)), hasMore, position, generation, inspectedMemberships });
    }))),
    assertProtectedReferenceGeneration: Effect.fn("CoreTransaction.nativeAssertProtectedReferenceGeneration")((name, generation) => nativeOperation(access, Effect.gen(function* () {
      if (access?.kind !== "native") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const candidates = access.authority.tables.flatMap(table => (table.nativePolicy?.protectedReferences ?? [])
        .filter(reference => reference.sourceTable === table.name && (reference.reference.name === name || reference.field === name))
        .map(reference => ({ table, reference })));
      const candidate = candidates[0];
      if (candidates.length !== 1 || candidate === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const table = candidate.table;
      const selected = yield* Effect.fromResult(tableByName(table.name, false, access));
      const index = selected.indexes.find(value => value.name === candidate.reference.indexName);
      if (index === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
      // Buffered continuations recheck the consumed index and source authority
      // without importing a source body or another membership window.
      const captured = yield* nativeCapture(selected, access, index);
      yield* Effect.fromResult(observeProtectedTraversalTarget(captured, selected, candidate.reference));
      if (generation !== (pendingGenerations.get(encodeBytesToLowercaseHex(table.tabletId)) ?? 0))
        return yield* new CoreTransactionError({ reason: "conflict", cause: "Protected reference page generation changed" });
    }))),
    getMany: Effect.fn("CoreTransaction.nativeGetMany")((tableName: string, ids: readonly string[]) => nativeOperation(access, Effect.gen(function* () {
      if (nativeObservations === undefined || native === undefined || access?.kind !== "native")
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const table = yield* Effect.fromResult(tableByName(tableName, false, access));
      if (!access.authority.definition.references.some(reference => reference.targetTable === table.name))
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const limit = yield* Effect.fromResult(nativeObservations.limitsFor(table));
      const capturedInput = yield* Effect.fromResult(capturePrivateJsonData(ids, CORE_TRANSACTION_REFERENCE_LIMITS.bytesRead,
        (reason, cause) => reason === "limitExceeded" ? new CoreTransactionError({ reason: "capacity", cause })
          : new CoreNativeQueryError({ reason: "invalidInput", cause })));
      const captured = yield* decodeNativeBatchIds(capturedInput.value).pipe(
        Effect.mapError(cause => new CoreNativeQueryError({ reason: "invalidInput", cause })));
      if (captured.length > limit.maxIdentities) return yield* new CoreTransactionError({ reason: "capacity" });
      yield* native.chargeRetained(capturedInput.bytes);
      // Validate the complete loader batch before importing any first observation.
      for (const id of captured) {
        const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause })));
        if (decoded.tableNumber !== table.number) return yield* new CoreTransactionError({ reason: "invalidDocumentId" });
      }
      const result: Array<DocumentObject | null> = [];
      const methods = userOperations(access, true);
      for (const id of captured) result.push(Option.getOrNull(yield* methods.get(id)));
      return Object.freeze(result);
    }))),
    incomingReferences: Effect.fn("CoreTransaction.nativeIncomingReferences")((forwardName: string, targetId: string, options: Readonly<{ limit: number }>) => nativeOperation(access, Effect.gen(function* () {
      if (access?.kind !== "native") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const captured = yield* decodeNativeIncomingOptions(options).pipe(
        Effect.mapError(cause => new CoreNativeQueryError({ reason: "invalidInput", cause })));
      const reference = access.authority.definition.references.find(value => value.declaration.source.forwardName === forwardName);
      if (reference === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const source = yield* Effect.fromResult(tableByName(reference.sourceTable, false, access));
      const selection = yield* Effect.fromResult(selectCoreNativeReference(registry, source, reference));
      const selectedTarget = yield* Effect.fromResult(Result.mapError(decodeDocumentId(targetId), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause })));
      if (selectedTarget.tableNumber !== selection.target.number) return yield* new CoreTransactionError({ reason: "invalidDocumentId" });
      const captureLimits = nativeObservations === undefined ? undefined : yield* Effect.fromResult(nativeObservations.limitsFor(source));
      if (captureLimits === undefined) return yield* invalid();
      const needed = captured.limit + 1;
      if (!Number.isSafeInteger(needed)) return yield* new CoreNativeQueryError({ reason: "invalidInput" });
      const indexed = coreNativeReferenceIndexTable(selection);
      const interval = yield* Effect.fromResult(coreNativeReferenceInterval(selection, targetId));
      const page = yield* queryNativeReferenceIndex(selection, indexed, selection.index, interval,
        Math.min(needed, captureLimits.maxIdentities + 1), access);
      if (page.documents.length > captureLimits.maxIdentities)
        return yield* new CoreTransactionError({ reason: "capacity", cause: "Native incoming identity limit" });
      const ids: string[] = [];
      for (const document of page.documents) {
        if (typeof document._id !== "string") return yield* new CorePersistenceError({ reason: "corruptData" });
        const member = selection.projection === undefined ? undefined : yield* rememberNativeMembership(selection, page.selected, document);
        if (member !== undefined && member.targetId !== targetId)
          return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native membership target differs from its index interval" });
        const sourceId = member?.sourceId ?? document._id;
        if (ids.includes(sourceId))
          return yield* new CorePersistenceError({ reason: "corruptData", cause: "Duplicate native incoming source" });
        const body = yield* hydrateNativeReferenceSource(selection, page.selected, sourceId, access);
        const targets = yield* Effect.fromResult(Result.mapError(coreNativeReferenceTargets(selection, body),
          cause => new CorePersistenceError({ reason: "corruptData", cause })));
        if (!targets.includes(targetId))
          return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native membership differs from its source" });
        ids.push(sourceId);
      }
      return Object.freeze({ ids: Object.freeze(ids.slice(0, captured.limit)), hasMore: ids.length > captured.limit,
        inspectedMemberships: page.inspectedMemberships });
    }))),
    pendingDelete: Effect.fn("CoreTransaction.nativePendingDelete")((tableName: string, id: string) => nativeOperation(access, Effect.gen(function* () {
      if (access?.kind !== "native") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const table = yield* Effect.fromResult(tableByName(tableName, false, access));
      const selected = yield* Effect.fromResult(resolve(id, false, access));
      const change = writes.get(id);
      if (!bytesEqual(table.tabletId, selected.table.tabletId) || change?.finalDocument !== null || deletedBy.get(id) !== access)
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const evidence = issueCoreNativePendingDelete();
      deletionEvidence.set(evidence, { access, id, change });
      return evidence;
    }))),
    assertPendingDelete: Effect.fn("CoreTransaction.nativeAssertPendingDelete")((tableName: string, id: string, evidence: CoreNativePendingDelete) => nativeOperation(access, Effect.gen(function* () {
      if (access?.kind !== "native") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const table = yield* Effect.fromResult(tableByName(tableName, false, access));
      const selected = yield* Effect.fromResult(resolve(id, false, access));
      const record = deletionEvidence.get(evidence), change = writes.get(id);
      if (!bytesEqual(table.tabletId, selected.table.tabletId) || record?.access !== access || record.id !== id
        || record.change !== change || change?.finalDocument !== null || deletedBy.get(id) !== access)
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    }))),
  });
  const nativeOperations = defaultAccess === undefined ? undefined : nativeOperationsFor(defaultAccess);
  const applicationInserts = new Map<CoreTransactionNativeAccess, CoreApplicationInsertOperations>();
  const applicationReads = new Map<CoreTransactionNativeAccess, CoreApplicationReadOperations>();

  const internals: CoreTransactionInternals = {
    idGenerator, namespace, timestamp: snapshot.timestamp,
    get registry() { return registry; },
    get schemaRegistry() { return registry.schemas; },
    transaction,
    ...(nativeOperations === undefined ? {} : { nativeOperations }),
    nativeFor: Effect.fn("CoreTransaction.nativeFor")(function* (access) {
      yield* assertOpen();
      if (!nativeAccesses.has(access) || access.kind !== "native") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      yield* Effect.fromResult(checkCoreNativeAuthority(registry, access.authority));
      return nativeOperationsFor(access);
    }),
    applicationInsertFor: Effect.fn("CoreTransaction.applicationInsertFor")(function* (access) {
      yield* assertOpen();
      if (!nativeAccesses.has(access) || access.kind !== "applicationInsert") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      yield* Effect.fromResult(checkCoreApplicationInsertAuthority(registry, access.authority));
      const previous = applicationInserts.get(access);
      if (previous !== undefined) return previous;
      const inserted = new Set<string>();
      const methods = userOperations(access);
      const pendingMethods = userOperations(access, true);
      const granted = Object.freeze({
        insert: Effect.fn("CoreTransaction.applicationInsert")(function* (value: unknown) {
          const id = yield* methods.insert(access.authority.table.name, value);
          inserted.add(id);
          return id;
        }),
        patchPending: Effect.fn("CoreTransaction.applicationPatchPending")((id: string, value: unknown) => nativeBatch(access, Effect.gen(function* () {
          yield* Effect.fromResult(checkCoreApplicationInsertAuthority(registry, access.authority));
          if (!inserted.has(id)) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          const pending = writes.get(id);
          if (pending === undefined || pending.originalDocument !== null || pending.finalDocument === null
            || !bytesEqual(pending.table.tabletId, access.authority.table.tabletId)
            || coreNamespaceKey(pending.table.namespace) !== coreNamespaceKey(access.authority.table.namespace))
            return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          yield* nativeCapture(pending.table, access);
          yield* pendingMethods.patch(id, value);
        }))),
        readPending: Effect.fn("CoreTransaction.applicationReadPending")((id: string) => operation(Effect.gen(function* () {
          yield* Effect.fromResult(checkCoreApplicationInsertAuthority(registry, access.authority));
          if (!inserted.has(id)) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          const pending = writes.get(id);
          if (pending === undefined || pending.finalDocument === null || !bytesEqual(pending.table.tabletId, access.authority.table.tabletId))
            return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          yield* Effect.fromResult(chargeDocument(pending.table, pending.finalDocument));
          return Option.some(pending.finalDocument);
        }))),
      });
      applicationInserts.set(access, granted);
      return granted;
    }),
    applicationReadFor: Effect.fn("CoreTransaction.applicationReadFor")(function* (access) {
      yield* assertOpen();
      if (!nativeAccesses.has(access) || access.kind !== "applicationRead") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      yield* Effect.fromResult(checkCoreApplicationReadAuthority(registry, access.authority));
      const previous = applicationReads.get(access);
      if (previous !== undefined) return previous;
      const methods = userOperations(access, true);
      const granted = Object.freeze({ get: Effect.fn("CoreTransaction.applicationRead")((id: string) => operation(Effect.gen(function* () {
        const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause })));
        if (decoded.tableNumber !== access.authority.table.number) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
        return yield* methods.get(id);
      }))) });
      applicationReads.set(access, granted);
      return granted;
    }),
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
      yield* assertOpen();
      if (!name.startsWith("_")) return yield* invalid();
      const id = idGenerator.nextInternalId();
      yield* writeSystem(name, id, body, "insert");
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
    tableExists: name => { if(native===undefined){const result=mappingRead(); if(Result.isFailure(result))throw new Error("Missing table mapping index");} return registry.table(name, namespace) !== undefined; },
    applicationSchemaRetained: schemaId => Result.gen(function* () {
      const index = registry.table(PROGRAMS)?.definition.indexes.find(candidate => candidate.name === "by_identity");
      if (index === undefined) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
      const start = yield* encodeIndexValue("applicationDeployment").pipe(Result.mapError(cause =>
        new CorePersistenceError({ reason: "corruptData", cause })));
      reads.add(index.ref.id, { start, end: incrementIndexKeyPrefix(start) });
      return [...registry.applicationDeployments.values()].some(record => record.value.schemaId === schemaId);
    }),
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
      const metadataReadFrontiers: Array<Readonly<{ timestamp: bigint; reads: CoreReadSet }>> = [];
      if (selectiveMetadata) {
        const metadataReads = yield* Effect.fromResult(coreMetadataReadSet(registry, reads.snapshot()));
        if (metadataReads.length > 0) metadataReadFrontiers.push({ timestamp: snapshot.timestamp, reads: metadataReads });
      }
      if (nativeObservations !== undefined) {
        const packet = nativeObservations.snapshot();
        if (selectiveMetadata) for (const group of packet.dependencies) {
          const metadataReads = yield* Effect.fromResult(coreMetadataReadSet(registry, group.reads));
          if (metadataReads.length > 0) metadataReadFrontiers.push({ timestamp: group.timestamp, reads: metadataReads });
        }
        for (const group of packet.dependencies) for (const dependency of group.reads)
          for (const interval of dependency.intervals) reads.add(dependency.indexId, interval);
        for (const slot of packet.indexes) reads.add(slot.index.ref.id, slot.interval);
      }
      return Object.freeze({ timestamp: snapshot.timestamp, get reads() { return reads.snapshot(); },
        ...(selectiveMetadata ? { metadataReadFrontiers: Object.freeze(metadataReadFrontiers) } : {}) });
    })),
    readPrivate: (tableName, id) => operation(Effect.gen(function* () {
      const table = yield* Effect.fromResult(tableByName(tableName, true));
      yield* Effect.fromResult(chargePointQuery(table, id));
      const document = yield* read(table, id);
      yield* Effect.fromResult(chargeDocument(table, document));
      return Option.fromNullOr(document);
    })),
    insertPrivate: Effect.fn("CoreTransaction.insertPrivate")(function* (tableName: string, id: Uint8Array, body: DocumentObject) {
      if (!tableName.startsWith("_")) return yield* invalid();
      yield* writeSystem(tableName, id, body, "insert");
    }),
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

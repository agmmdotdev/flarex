/**
 * Private outcome packing translated from Convex crates/model/src/session_requests/types.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318: JsonPackedValue is stored as an internal-JSON string.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Cause, Effect, Exit, Option, Result, Schema, Semaphore } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { encodeCanonicalJson, isJsonObject, type Json } from "flarex-protocol/json";
import { decodeDocumentValue, encodeDocumentValue, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { encodeIndexValue } from "flarex-protocol/index-key";
import { CoreProgramIdentitySchema, CoreNativeRootIdentitySchema, CoreSchemaWorkerOptionsSchema, CoreTransactionLimitsSchema, CoreTransactionError, issueCoreClaim, issueCoreNativeBinding,
  issueCoreNativeRootBinding, issueCoreApplicationInsertBinding, issueCoreNativeInitializationBinding,
  type CoreDatabase, type CoreDatabaseOptions, type CoreError,
  type CoreProgramPublication, type CoreSchemaProposal, type CoreSchemaStatus, type CoreProgramDefinition, type CoreRequestAcquisition,
  type CoreNativeBinding, type CoreNativeCommandDefinition, type CoreNativeCommandIdentity, type CoreNativeOperation,
  type CoreRequestClaim, type CoreRequestIdentity, type CoreRequestResolution, type CoreTableDefinition,
  type CoreNativeRootBindingMetadata, type CoreApplicationInsertBinding,
  type CoreNativeRootIdentity, type CoreNativeLimits } from "./api";
import { CorePersistenceError, CoreTimestampSchema, type CoreDocumentLogEntry, type CoreIndexScan, type CoreInterval, type CorePersistence, type CorePersistenceSnapshot } from "./contracts";
import { allocateCoreBuiltinDefinitions, bootstrapCore } from "./bootstrap";
import { makeCoreCommitter } from "./committer";
import { INDEXES, PROGRAMS, REQUESTS, TABLES, programKey, readDocumentObject,
  tableDocument, SCHEMAS, SCHEMA_VALIDATIONS, SCHEMA_VALIDATION_PROGRESS, publicDocumentId, type CoreRegistry } from "./registry";
import { CoreFinalizationVault, createCoreTransaction, prepareCoreTransactionIdGenerator, type CoreDocumentChange, type CoreFinalizedState,
  type CoreTransactionInternals, type CoreTransactionNativeAccess } from "./transaction";
import { CORE_TRANSACTION_REFERENCE_LIMITS, CoreAccounting } from "./accounting";
import { captureCoreDocument, captureCoreObject } from "./document";
import { addTableWriteDependencies } from "./dependencies";
import { CoreReadSetBuilder } from "./writeLog";
import { captureCoreTableNamespace, coreNamespaceKey,type CoreTableNamespace } from "./namespace";
import { CoreSchemaModel } from "./schemaModel";
import { captureCoreSchema, checkCoreSchemaIndexReferences, CoreSchemaError } from "./schemaTypes";
import { serializeCoreSchema } from "./schemaJson";
import { coreIndexMetadataValue,type CoreIndexRecord } from "./indexState";
import { planCoreIndexes,prepareCoreIndexChanges,finishCoreIndexChanges,type CoreIndexChanges } from "./indexModel";
import { makeCoreSchemaWorker } from "./schemaWorker";
import { makeCoreTableSummaryWorker } from "./tableSummary";
import { CoreNativeIdentitySchema, checkCoreNativeAuthority, coreNativeMetadataReads, requireCoreNativeDefinition,
  coreNativeSchemaIncludes, sameCoreNativeIdentity, sameCoreNativeTablePolicy,
  checkCoreApplicationInsertAuthority, coreApplicationInsertMetadataReads,
  type CoreNativeAuthority, type CoreNativeDefinition, type CoreNativeTablePolicy } from "./nativePolicy";
import { requireCoreSchemaBundle, type CoreSchemaBundle } from "./schemaBundle";
import { capturePrivateJsonData } from "../values/privateJsonData";

const NativeLimitsSchema = Schema.Struct({ maxIdentities: Schema.Int.check(Schema.isBetween({ minimum: 1,
  maximum: CORE_TRANSACTION_REFERENCE_LIMITS.documentsRead })), maxDocumentBytes: Schema.Int.check(Schema.isBetween({ minimum: 1,
  maximum: CORE_TRANSACTION_REFERENCE_LIMITS.bytesRead })) });
const decodeNativeLimits = Schema.decodeUnknownEffect(NativeLimitsSchema);


const RequestFields = { key: Schema.String, requestHash: Schema.String, leaseToken: Schema.BigInt,
  abandonedByLease: Schema.optionalKey(Schema.BigInt) };
const NativeCommandIdentitySchema = Schema.Struct({ source: CoreNativeIdentitySchema, name: Schema.NonEmptyString,
  mode: Schema.Literals(["read", "write"]) });
const RequestRecordFields = { ...RequestFields, kind: Schema.optionalKey(Schema.Literal("application")), program: CoreProgramIdentitySchema };
const NativeRequestFields = { ...RequestFields, kind: Schema.Literal("native"), native: NativeCommandIdentitySchema };
const NativeRootRequestFields = { ...RequestFields, kind: Schema.Literal("nativeRoot"), root: CoreNativeRootIdentitySchema };
const RequestRecord = Schema.Union([
  Schema.Struct({ ...RequestRecordFields, state: Schema.Literals(["claimed", "failed"]) }),
  Schema.Struct({ ...RequestRecordFields, state: Schema.Literal("committed"), result: Schema.String }),
  Schema.Struct({ ...NativeRequestFields, state: Schema.Literals(["claimed", "failed"]) }),
  Schema.Struct({ ...NativeRequestFields, state: Schema.Literal("committed"), result: Schema.String }),
  Schema.Struct({ ...NativeRootRequestFields, state: Schema.Literals(["claimed", "failed"]) }),
  Schema.Struct({ ...NativeRootRequestFields, state: Schema.Literal("committed"), result: Schema.String }),
]);
const decodeRequestRecord = Schema.decodeUnknownResult(RequestRecord, { onExcessProperty: "error" });
const decodeProgramIdentity = Schema.decodeUnknownResult(CoreProgramIdentitySchema);
const decodeNativeRegistrations = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ name: Schema.NonEmptyString,
  mode: Schema.Literals(["read", "write"]) })).check(Schema.isMinLength(1), Schema.isMaxLength(128)));
const decodeOperationCacheBytes = Schema.decodeUnknownEffect(Schema.Int.check(Schema.makeFilter(value =>
  Number.isSafeInteger(value) && value >= 0 ? undefined : "Expected a nonnegative safe cache size")));
const decodeCreationTimestamp = Schema.decodeUnknownEffect(CoreTimestampSchema);
const utf8 = new TextEncoder();
const utf8Decoder = new TextDecoder();

interface RequestRecordBase {
  readonly id: Uint8Array;
  readonly revision: CoreDocumentLogEntry;
  readonly document: DocumentObject;
  readonly leaseToken: bigint;
}
type RequestRecordData = RequestRecordBase & (
  | Readonly<{ state: "claimed" | "failed" }>
  | Readonly<{ state: "committed"; result: DocumentValue }>
);
interface ClaimData {
  readonly identity: CoreRequestIdentity;
  readonly record: RequestRecordData;
  active: boolean;
}
type NativeRootAccess = Extract<CoreTransactionNativeAccess, { kind: "native" }>;
type ApplicationInsertAccess = Extract<CoreTransactionNativeAccess, { kind: "applicationInsert" }>;
type RequestBinding = NonNullable<Parameters<CoreDatabase["claimRequest"]>[1]>;
interface NativeRootData {
  readonly metadata: CoreNativeRootBindingMetadata;
  readonly bundle: CoreSchemaBundle;
  readonly natives: ReadonlyMap<CoreNativeBinding, NativeRootAccess>;
  readonly applicationInserts: ReadonlyMap<CoreApplicationInsertBinding, ApplicationInsertAccess>;
  readonly accesses: readonly CoreTransactionNativeAccess[];
  readonly limits: CoreNativeLimits;
  readonly maxFinalUserDocuments: number;
}

function invalid(cause?: unknown): CoreTransactionError {
  return new CoreTransactionError({ reason: "invalidValue", ...(cause === undefined ? {} : { cause }) });
}
function corrupt(cause?: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
}
const rootHash = makeLivePrivateSha256V1<CoreError>({
  invalidBudget: () => invalid(), invalidBytes: () => invalid(), inputBytesExceeded: () => invalid(),
  unavailable: () => new CoreSchemaError({ reason: "hashFailure", message: "Native root digest unavailable" }),
  nativeRejected: cause => new CoreSchemaError({ reason: "hashFailure", message: "Native root digest rejected", cause }),
  invalidDigestOutput: () => new Error("Native root digest output invariant"),
});
const nativeRootIdentity = Effect.fn("CoreDatabase.nativeRootIdentity")(function* (frame: Json) {
  const captured = yield* Effect.fromResult(capturePrivateJsonData(frame, 1_048_576,
    (reason, cause) => new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause }),
    { canonicalNumbers: true, wellFormedUnicode: true }));
  const canonical = encodeCanonicalJson(captured.value, issue => { throw new Error("Native root frame invariant", { cause: issue }); });
  const bytes = utf8.encode(canonical);
  const digest = yield* rootHash(bytes, { maximumInputBytes: 1_048_576 });
  return Object.freeze({ definitionHash: encodeBytesToLowercaseHex(digest) });
});
const copyTableDefinition = (table: CoreTableDefinition): CoreTableDefinition => Object.freeze({ ...table,
  tabletId: table.tabletId.slice(), indexes: Object.freeze(table.indexes.map(index => Object.freeze({ ...index,
    ref: Object.freeze({ ...index.ref, id: index.ref.id.slice() }) }))) });
/** Keep source capabilities and the selected publication list stable across lifecycle I/O. */
const ownPublicationFrame = (publication: CoreProgramPublication): CoreProgramPublication => Object.freeze({ ...publication,
  programs: Object.freeze([...publication.programs]) });
const checkNativeRoot = (registry: CoreRegistry, data: NativeRootData): Result.Result<void, CoreError> => Result.gen(function* () {
  for (const access of data.accesses) {
    if (access.kind === "native") yield* checkCoreNativeAuthority(registry, access.authority);
    else yield* checkCoreApplicationInsertAuthority(registry, access.authority);
  }
});
const nativeRootMetadataReads = (registry: CoreRegistry, data: NativeRootData) => Result.gen(function* () {
  const reads = new CoreReadSetBuilder();
  for (const access of data.accesses) {
    const selected = yield* access.kind === "native" ? coreNativeMetadataReads(registry, access.authority)
      : coreApplicationInsertMetadataReads(registry, access.authority);
    for (const read of selected) for (const interval of read.intervals) reads.add(read.indexId, interval);
  }
  return reads.snapshot();
});

function equalityInterval(prefix: Uint8Array): CoreInterval {
  let last = prefix.length - 1;
  while (last >= 0 && prefix[last] === 255) last -= 1;
  if (last < 0) return { start: prefix.slice(), end: null };
  const end = prefix.slice(0, last + 1);
  end[last] = (end[last] ?? 0) + 1;
  return { start: prefix.slice(), end };
}

function withoutSystemFields(document: DocumentObject): DocumentObject {
  const { _id, _creationTime, ...body } = document;
  return body;
}

function requestRecord(entry: CoreDocumentLogEntry, table: CoreTableDefinition,
  identity: CoreRequestIdentity): Result.Result<RequestRecordData, CoreError> {
  return Result.gen(function* () {
    const document = yield* readDocumentObject(entry, table);
    const record = yield* Result.mapError(decodeRequestRecord(withoutSystemFields(document)), corrupt);
    const matches = identity.kind === "native" ? record.kind === "native" && sameNativeCommand(record.native, identity.native)
      : identity.kind === "nativeRoot" ? record.kind === "nativeRoot" && sameNativeRoot(record.root, identity.root)
        : record.kind !== "native" && record.kind !== "nativeRoot" && record.program.functionPath === identity.program.functionPath;
    if (record.key !== identity.key || record.requestHash !== identity.requestHash || !matches)
      return yield* Result.fail(new CoreTransactionError({ reason: "requestMismatch" }));
    const base = { id: entry.id.slice(), revision: entry, document, leaseToken: record.leaseToken };
    if (record.state === "committed") {
      const result = yield* Result.mapError(decodeDocumentValue(utf8.encode(record.result)), corrupt);
      return { ...base, state: "committed" as const, result };
    }
    return { ...base, state: record.state };
  });
}
function sameNativeCommand(left: CoreNativeCommandIdentity, right: CoreNativeCommandIdentity): boolean {
  return left.name === right.name && left.mode === right.mode && sameCoreNativeIdentity(left.source, right.source);
}
function sameNativeRoot(left: CoreNativeRootIdentity, right: CoreNativeRootIdentity): boolean {
  return left.definitionHash === right.definitionHash;
}
function requestActor(identity: CoreRequestIdentity): DocumentObject {
  return identity.kind === "native" ? { kind: "native", native: { source: { ...identity.native.source }, name: identity.native.name, mode: identity.native.mode } }
    : identity.kind === "nativeRoot" ? { kind: "nativeRoot", root: { ...identity.root } } : { program: { ...identity.program } };
}
function ownRequestIdentity(identity: CoreRequestIdentity): CoreRequestIdentity {
  return identity.kind === "native" ? Object.freeze({ ...identity, native: Object.freeze({ ...identity.native,
    source: Object.freeze({ ...identity.native.source }) }) }) : identity.kind === "nativeRoot"
      ? Object.freeze({ ...identity, root: Object.freeze({ ...identity.root }) })
      : Object.freeze({ ...identity, program: Object.freeze({ ...identity.program }) });
}

function existingResolution(record: RequestRecordData): Result.Result<Exclude<CoreRequestResolution, { kind: "missing" }>, CoreError> {
  if (record.state === "committed") return Result.succeed({ kind: "committed", timestamp: record.revision.ts, result: record.result });
  return Result.succeed({ kind: record.state === "claimed" ? "busy" : "failed" });
}

function resolution(record: RequestRecordData | undefined): Result.Result<CoreRequestResolution, CoreError> {
  return record === undefined ? Result.succeed({ kind: "missing" }) : existingResolution(record);
}

function ownedProgram(definition: CoreProgramDefinition): Result.Result<CoreProgramDefinition, CoreTransactionError> {
  return Result.gen(function* () {
    const identity = yield* Result.mapError(decodeProgramIdentity(definition.identity), invalid);
    const metadata = (yield* Result.mapError(captureCoreObject(definition.metadata, true), invalid)).value;
    return Object.freeze({ identity: Object.freeze(identity), metadata });
  });
}
const nativeUnsupported = (message: string) => new CoreSchemaError({ reason: "unsupportedCapability", message });
const userTables = (registry: CoreRegistry, namespace: CoreTableNamespace) => [...registry.tables.values()]
  .map(record => record.definition).filter(table => !table.name.startsWith("_")
    && coreNamespaceKey(table.namespace) === coreNamespaceKey(namespace));

function trackMetadataEquality(context: CoreTransactionInternals, registry: CoreRegistry,
  tableName: string, indexName: string, values: readonly DocumentValue[]): Result.Result<void, CoreError> {
  return Result.gen(function* () {
    const index = registry.table(tableName)?.definition.indexes.find(candidate => candidate.name === indexName);
    if (index === undefined) return yield* Result.fail(corrupt());
    const parts: Uint8Array[] = [];
    for (const value of values) parts.push(yield* Result.mapError(encodeIndexValue(value), invalid));
    const prefix = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) { prefix.set(part, offset); offset += part.length; }
    context.addIndexRead(index.ref.id, equalityInterval(prefix));
  });
}

/** One trusted persistence instance. No legacy database facade is constructed here. */
export const openCoreDatabase = Effect.fn("CoreDatabase.open")(function* (
  persistence: CorePersistence, options: CoreDatabaseOptions,
) {
  const schemaWorkerOptions=yield* Schema.decodeUnknownEffect(CoreSchemaWorkerOptionsSchema)(options.schemaWorker).pipe(Effect.mapError(invalid));
  const schemaBundles = Object.freeze([...(options.schemaBundles ?? [])]);
  for (const bundle of schemaBundles) yield* Effect.fromResult(requireCoreSchemaBundle(bundle));
  options={...options,schemaWorker:Object.freeze({...schemaWorkerOptions}),schemaBundles};
  const limits = yield* Schema.decodeUnknownEffect(CoreTransactionLimitsSchema)({
    ...CORE_TRANSACTION_REFERENCE_LIMITS, ...options.transactionLimits,
  }).pipe(Effect.mapError(invalid));
  const operationCacheMaxBytes = yield* decodeOperationCacheBytes(options.operationCacheMaxBytes ?? 16 * 1024 * 1024)
    .pipe(Effect.mapError(invalid));
  const lease = yield* persistence.acquireLease();
  const initial = yield* bootstrapCore(persistence, lease, options);
  const committer = yield* makeCoreCommitter(persistence, lease, initial.timestamp, initial.registry, initial.resident, options, initial.retention);
  const vault = new CoreFinalizationVault();
  const claims = new WeakMap<CoreRequestClaim, ClaimData>();
  const nativeBindings = new WeakMap<object, CoreNativeAuthority & { readonly commands: readonly CoreNativeCommandDefinition[] }>();
  const nativeInitializationBindings = new WeakMap<object, Readonly<{ binding: CoreNativeBinding; command: CoreNativeCommandDefinition }>>();
  const nativeRootBindings = new WeakMap<object, NativeRootData>();
  const borrowed = new Set<CoreTransactionInternals>();
  let closed = false;
  let drainSchemaWork:Effect.Effect<void>=Effect.void;
  const closing = Semaphore.makeUnsafe(1);
  const assertOpen = Effect.suspend(() => closed
    ? Effect.fail(new CoreTransactionError({ reason: "closed" })) : committer.assertReady);
  const close = Effect.fn("CoreDatabase.close")(() => closing.withPermits(1)(Effect.gen(function* () {
    closed = true;
    committer.indexCache.close();
    yield* drainSchemaWork;
    const sessions = [...borrowed];
    for (const context of sessions) yield* context.transaction.abort();
  })));
  yield* Effect.addFinalizer(() => close());

  const openSnapshot = Effect.fn("CoreDatabase.openSnapshot")(function* (timestamp: bigint, registry: CoreRegistry) {
    const physicalSnapshot = yield* persistence.readSnapshot(timestamp, initial.retention);
    const snapshot: CorePersistenceSnapshot = Object.freeze({ ...physicalSnapshot,
      scan: (request: CoreIndexScan) => committer.indexCache.scan({ snapshot: physicalSnapshot, registry, request }),
    });
    yield* assertOpen;
    return snapshot;
  });
  const start = Effect.fn("CoreDatabase.start")(function* (at?: bigint) {
    yield* assertOpen;
    const selected = yield* Effect.fromResult(committer.selectSnapshot(at));
    return { ...selected, snapshot: yield* openSnapshot(selected.timestamp, selected.registry) };
  });
  const startNative = Effect.fn("CoreDatabase.startNative")(function* () {
    yield* assertOpen;
    // Registry, data timestamp and COW history are selected together before I/O.
    const selected = yield* Effect.fromResult(committer.selectNativeSnapshot());
    return { ...selected, snapshot: yield* openSnapshot(selected.timestamp, selected.registry) };
  });

  const make = Effect.fn("CoreDatabase.transaction")(function* (at?: bigint, claim?: CoreRequestClaim, readonly = false, namespace:CoreTableNamespace = null, system = false) {
    namespace=yield* Effect.fromResult(Result.mapError(captureCoreTableNamespace(namespace),invalid));
    const selected = yield* start(at);
    const minimum = yield* decodeCreationTimestamp((yield* committer.publishedTimestamp) + 1n).pipe(Effect.mapError(invalid));
    const wallClock = yield* decodeCreationTimestamp(yield* options.now).pipe(Effect.mapError(invalid));
    const now = wallClock > minimum ? wallClock : minimum;
    const idGenerator = yield* prepareCoreTransactionIdGenerator(options);
    yield* assertOpen;
    const context = createCoreTransaction({ snapshot: selected.snapshot, registry: selected.registry,
      residentReader: request => selected.resident.scan(request), operationCacheMaxBytes,
      now, idGenerator, vault, limits: system ? CORE_TRANSACTION_REFERENCE_LIMITS : limits, readonly, namespace, ...(selected.counts===undefined?{}:{counts:selected.counts}), assertOwnerOpen: assertOpen,
      schemaBundles,
      onClosed: () => borrowed.delete(context), ...(claim === undefined ? {} : { claim }) });
    return { ...selected, context };
  });

  const registerBorrow = Effect.fn("CoreDatabase.registerBorrow")(<Selected extends Readonly<{ context: CoreTransactionInternals }>>(
    selected: Selected, guard?: () => Result.Result<void, CoreError>,
  ) => Effect.andThen(committer.assertReady, Effect.suspend(() => {
    if (closed) return Effect.fail(new CoreTransactionError({ reason: "closed" }));
    // Guard and registration share one synchronous callback, with no I/O boundary.
    return Result.match(guard?.() ?? Result.succeed(undefined), {
      onFailure: error => Effect.fail(error),
      onSuccess: () => { borrowed.add(selected.context); return Effect.succeed(selected); },
    });
  })));

  // Preparation owns only detached heap state and remains interruptible in the
  // caller's current mode. Only borrow registration is a masked acquisition.
  // Dispose every non-transferred
  // operation on its full Exit, including defects and interruption. Disposal
  // never changes a durable request/outcome, even after an uncertain save.
  const useTransaction = Effect.fn("CoreDatabase.useTransaction")(<Value>(
    prepare: ReturnType<typeof make>,
    use: (selected: Effect.Success<ReturnType<typeof make>>) => Effect.Effect<Value, CoreError>,
    transferOnSuccess = false,
  ) => Effect.flatMap(prepare, prepared => Effect.acquireUseRelease(registerBorrow(prepared), use, (selected, exit) =>
    transferOnSuccess && Exit.isSuccess(exit) ? Effect.void : selected.context.transaction.abort())));

  const findRequest = Effect.fn("CoreDatabase.findRequest")(function* (
    selected: Effect.Success<ReturnType<typeof start>>, identity: CoreRequestIdentity, transaction?: CoreTransactionInternals,
  ) {
    const table = selected.registry.table(REQUESTS)?.definition;
    const index = table?.indexes.find(value => value.name === "by_key");
    if (table === undefined || index === undefined) return yield* Effect.fail(corrupt());
    const prefix = yield* Effect.fromResult(Result.mapError(encodeIndexValue(identity.key), invalid));
    const interval = equalityInterval(prefix);
    transaction?.addIndexRead(index.ref.id, interval);
    const page = yield* selected.snapshot.scan({ index: index.ref, tableId: table.tabletId,
      interval, order: "asc", maxResults: 2 });
    if (page.entries.length > 1) return yield* Effect.fail(corrupt());
    const entry = page.entries[0];
    if (entry === undefined) return undefined;
    return yield* Effect.fromResult(requestRecord(entry.document, table, identity));
  });
  const requireClaimRevision = Effect.fn("CoreDatabase.requireClaimRevision")(function* (
    selected: Effect.Success<ReturnType<typeof start>>, data: ClaimData, context: CoreTransactionInternals,
  ) {
    const record = yield* findRequest(selected, data.identity, context);
    if (record === undefined || record.state !== "claimed" || !bytesEqual(record.id, data.record.id)
      || record.revision.ts !== data.record.revision.ts || record.leaseToken !== data.record.leaseToken)
      return yield* new CoreTransactionError({ reason: "foreignClaim" });
    return record;
  });

  const consume = (handle: import("./api").CoreFinalizedTransaction): Effect.Effect<CoreFinalizedState, CoreTransactionError> => {
    const record = typeof handle === "object" && handle !== null ? vault.take(handle) : undefined;
    return record === undefined ? Effect.fail(new CoreTransactionError({ reason: "foreignFinalization" })) : Effect.succeed(record);
  };

  const writePrograms = Effect.fn("CoreDatabase.writePrograms")(function* (selected:Effect.Success<ReturnType<typeof make>>,publication:CoreProgramPublication) {
      let registry=selected.context.registry;
      for (const inputProgram of publication.programs) {
        const definition = yield* Effect.fromResult(ownedProgram(inputProgram));
        yield* Effect.fromResult(trackMetadataEquality(selected.context, registry, PROGRAMS, "by_identity", [
          "revision", definition.identity.functionPath, definition.identity.programHash, definition.identity.schemaHash,
        ]));
        yield* Effect.fromResult(trackMetadataEquality(selected.context, registry, PROGRAMS, "by_head_path", ["head", definition.identity.functionPath]));
        const existing = registry.program(definition.identity);
        const id = existing?.id ?? selected.context.idGenerator.nextInternalId();
        const previous = existing === undefined ? undefined
          : yield* Effect.fromResult(Result.mapError(encodeDocumentValue(existing.definition.metadata), invalid));
        const next = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(definition.metadata), invalid));
        if (previous === undefined || !bytesEqual(previous, next)) {
          const body = { kind: "revision", identity: { ...definition.identity }, metadata: utf8Decoder.decode(next) };
          if (existing === undefined) yield* selected.context.insertPrivate(PROGRAMS, id, body);
          else yield* selected.context.writePrivate(PROGRAMS, id, body);
          registry = registry.withProgram({ definition, id, ts: null });
        }
        const oldHead = registry.head(definition.identity.functionPath);
        if (oldHead === undefined || programKey(oldHead.identity) !== programKey(definition.identity)) {
          const headId = oldHead?.id ?? selected.context.idGenerator.nextInternalId();
          const body = { kind: "head", identity: { ...definition.identity } };
          if (oldHead === undefined) yield* selected.context.insertPrivate(PROGRAMS, headId, body);
          else yield* selected.context.writePrivate(PROGRAMS, headId, body);
          registry = registry.withHead({ identity: definition.identity, id: headId, ts: null });
        }
      }
      if (publication.authorityEpoch !== undefined) {
        const authority = registry.authority;
        const epoch = publication.authorityEpoch;
        if (authority === undefined) return yield* Effect.fail(corrupt());
        if (epoch < authority.epoch || epoch > 0x7fff_ffff_ffff_ffffn) return yield* Effect.fail(invalid());
        if (epoch !== authority.epoch) {
          yield* selected.context.writePrivate(PROGRAMS, authority.id, { kind: "authority", epoch });
          registry = registry.withAuthority({ id: authority.id, epoch, ts: null });
        }
      }
      selected.context.setRegistryAfter(registry);
  });

  const settle=Effect.fn("CoreDatabase.settleSystem")(function*(selected:Effect.Success<ReturnType<typeof make>>){
    return yield* committer.submit(yield* consume(yield* selected.context.transaction.finalize()));
  });
  const admin = <A>(namespace:CoreTableNamespace,use:(selected:Effect.Success<ReturnType<typeof make>>)=>Effect.Effect<A,CoreError>)=>
    useTransaction(make(undefined,undefined,false,namespace,true),use);
  const guardNativeLifecycle = Effect.fn("CoreDatabase.guardNativeLifecycle")(function* (
    context: CoreTransactionInternals, definition?: CoreNativeDefinition, bundle?: CoreSchemaBundle,
  ) {
    const tables = userTables(context.registry, context.namespace);
    if (bundle !== undefined) {
      yield* Effect.fromResult(requireCoreSchemaBundle(bundle));
      if (definition !== undefined || coreNamespaceKey(bundle.namespace) !== coreNamespaceKey(context.namespace)
        || !schemaBundles.some(expected => expected.metadata === bundle.metadata))
        return yield* nativeUnsupported("Composed installation requires its expected target proof");
      const model = new CoreSchemaModel(context);
      let existingSource = false;
      for (const state of ["active", "pending", "validated"] as const) {
        const selected = yield* model.getByState(state);
        if (Option.isNone(selected)) continue;
        if (selected.value.metadata.native !== bundle.metadata)
          return yield* nativeUnsupported("Changed composed sources and ownership transfer are not supported");
        existingSource = true;
      }
      for (const table of tables) {
        if (table.state !== "active" || !bundle.schema.tables.some(declaration => declaration.tableName === table.name)
          || !existingSource)
          return yield* nativeUnsupported("Fresh composition cannot replace an unrelated retained table");
        const native = bundle.nativeDefinitions.find(source => source.tables.some(declaration => declaration.name === table.name));
        if (native === undefined ? table.nativePolicy !== undefined : table.nativePolicy === undefined
          || !sameCoreNativeIdentity(table.nativePolicy.identity, native.identity))
          return yield* nativeUnsupported("Composed table ownership differs from its source");
      }
      return;
    }
    if (definition === undefined) {
      if (tables.some(table => table.nativePolicy !== undefined))
        return yield* nativeUnsupported("Application schema replacement of native-owned tables requires an admitted composed producer");
      return;
    }
    yield* Effect.fromResult(requireCoreNativeDefinition(definition));
    if (definition.source.definition.kind === "relational")
      return yield* nativeUnsupported("Relational native installation requires an authenticated schema bundle");
    const model = new CoreSchemaModel(context);
    for (const state of ["active", "pending", "validated"] as const) {
      const selected = yield* model.getByState(state);
      if (Option.isSome(selected) && selected.value.metadata.native !== definition.metadata)
        return yield* nativeUnsupported("Native schema changes and cross-profile replacement are not supported");
    }
    for (const selected of definition.tables) {
      if (tables.some(table => table.name === selected.name && table.state !== "active"))
        return yield* nativeUnsupported("A retained inactive table identity prevents fresh native installation");
      const table = context.registry.table(selected.name, context.namespace)?.definition;
      if (table === undefined) continue;
      if (table.nativePolicy === undefined || !sameCoreNativeIdentity(table.nativePolicy.identity, definition.identity))
        return yield* nativeUnsupported("Native installation requires a new table; existing ownership cannot transfer");
      const schema = yield* model.get(table.nativePolicy.schemaId);
      if (Option.isNone(schema) || schema.value.metadata.native !== definition.metadata
        || !["pending", "validated", "active"].includes(schema.value.metadata.state.state))
        return yield* nativeUnsupported("This interrupted native installation cannot be resumed");
    }
    if (tables.some(table => !definition.tables.some(selected => selected.name === table.name)))
      return yield* nativeUnsupported("A native-only schema cannot replace unrelated Application or native tables");
  });
  const assertEmptyNativeTable = Effect.fn("CoreDatabase.assertEmptyNativeTable")(function* (
    selected: Effect.Success<ReturnType<typeof make>>, table: CoreTableDefinition,
  ) {
    const byId = table.indexes.find(index => index.name === "by_id");
    if (byId === undefined) return yield* corrupt();
    selected.context.addIndexRead(byId.ref.id, { start: null, end: null });
    const page = yield* selected.snapshot.scan({ index: byId.ref, tableId: table.tabletId,
      interval: { start: null, end: null }, order: "asc", maxResults: 1 });
    if (page.entries.length !== 0 || page.cursor.kind !== "end")
      return yield* nativeUnsupported("Native constraint preparation requires a proven empty table");
  });
  const applyIndexes=Effect.fn("CoreDatabase.applyIndexChanges")(function*(context:CoreTransactionInternals,changes:CoreIndexChanges){
    const table=context.registry.table(INDEXES)?.definition;
    if(table===undefined)return yield* corrupt();
    for(const id of changes.removed)yield* context.deleteSystem(INDEXES,yield* Effect.fromResult(publicDocumentId(table,id)));
    for(const write of changes.writes){
      const index=write.index;
      if(write.kind==="insert")yield* context.insertPrivate(INDEXES,index.ref.id,coreIndexMetadataValue(index));
      else yield* context.replaceSystem(INDEXES,yield* Effect.fromResult(publicDocumentId(table,index.ref.id)),coreIndexMetadataValue(index));
    }
  });
  const ensureNamespace=Effect.fn("CoreDatabase.ensureNamespace")(function*(context:CoreTransactionInternals){
    const names=[SCHEMAS,SCHEMA_VALIDATIONS,SCHEMA_VALIDATION_PROGRESS].filter(name=>context.registry.table(name,context.namespace)===undefined);
    if(names.length===0)return;
    const definitions=yield* allocateCoreBuiltinDefinitions(context.idGenerator,names,context.namespace);
    for(const table of definitions)yield* context.insertPrivate(TABLES,table.tabletId,tableDocument(table));
    for(const table of definitions)for(const index of table.indexes)yield* context.insertPrivate(INDEXES,index.ref.id,
      coreIndexMetadataValue({...index,tableId:table.tabletId,state:{type:"Enabled"},ts:null}));
  });
  const schemaStatus=Effect.fn("CoreDatabase.schemaStatus")((proposal:CoreSchemaProposal)=>admin(proposal.namespace,selected=>selected.context.runSystem(Effect.gen(function*(){
    const found=yield* new CoreSchemaModel(selected.context).get(proposal.id);
    if(Option.isNone(found))return yield* new CoreSchemaError({reason:"schemaNotFound",message:"Schema proposal does not exist"});
    const state=found.value.metadata.state,plan=planCoreIndexes(selected.context.registry,proposal.namespace,found.value.schema);
    const indexesReady=plan.added.length===0&&[...plan.identical.filter(index=>index.state.type!=="Backfilling"||!index.state.backfillState.staged),...plan.enabled]
      .every(index=>index.state.type!=="Backfilling");
    return {proposal,state:state.state,indexesReady,...(state.state==="failed"?{error:state.error,...(state.table_name===null?{}:{tableName:state.table_name})}:{})} satisfies CoreSchemaStatus;
  }))));
  const prepareSchema:CoreDatabase["prepareSchema"]=Effect.fn("CoreDatabase.prepareSchema")((requested)=>{
    const input = Object.freeze({ ...requested });
    return admin(input.namespace??input.bundle?.namespace??null,selected=>Effect.gen(function*(){
    if (input.bundle !== undefined && (input.native !== undefined || input.schema !== undefined))
      return yield* nativeUnsupported("Composed schema is derived only from its authenticated sources");
    if (input.native !== undefined) yield* Effect.fromResult(requireCoreNativeDefinition(input.native));
    if (input.bundle !== undefined) yield* Effect.fromResult(requireCoreSchemaBundle(input.bundle));
    const schema=yield* Effect.fromResult(captureCoreSchema(input.bundle?.schema ?? input.native?.schema ?? input.schema));
    if (input.native !== undefined && input.schema !== undefined) {
      const supplied = yield* Effect.fromResult(captureCoreSchema(input.schema));
      if ((yield* Effect.fromResult(serializeCoreSchema(supplied))) !== (yield* Effect.fromResult(serializeCoreSchema(schema))))
        return yield* nativeUnsupported("Native schema must be derived from the authenticated producer");
    }
    yield* Effect.fromResult(checkCoreSchemaIndexReferences(schema));
    const result=yield* selected.context.runSystem(Effect.gen(function*(){
      yield* ensureNamespace(selected.context);
      yield* guardNativeLifecycle(selected.context, input.native, input.bundle);
      const pendingProposal=yield* new CoreSchemaModel(selected.context).submitPending(schema, input.bundle?.metadata ?? input.native?.metadata);
      const definitions = input.bundle?.nativeDefinitions ?? (input.native === undefined ? [] : [input.native]);
      for (const definition of definitions) for (const declaration of definition.tables) {
        const table = selected.context.registry.table(declaration.name, selected.context.namespace)?.definition;
        if (table === undefined) return yield* corrupt();
        const previous = table.nativePolicy;
        if (previous !== undefined && previous.schemaId !== pendingProposal.id)
          return yield* nativeUnsupported("Native installation cannot replace a reserved schema identity");
        if (previous?.state !== "active") yield* assertEmptyNativeTable(selected, table);
        const nativePolicy: CoreNativeTablePolicy = Object.freeze({ state: previous?.state ?? "reserved",
          schemaId: pendingProposal.id, identity: definition.identity, applicationRead: definition.applicationRead,
          uniqueConstraints: declaration.uniqueConstraints });
        if (previous !== undefined && sameCoreNativeTablePolicy(previous, nativePolicy)) continue;
        const catalog = selected.context.registry.table(TABLES)?.definition;
        if (catalog === undefined) return yield* corrupt();
        yield* selected.context.replaceSystem(TABLES, yield* Effect.fromResult(publicDocumentId(catalog, table.tabletId)),
          tableDocument({ ...table, nativePolicy }));
      }
      const plan=planCoreIndexes(selected.context.registry,selected.context.namespace,schema);
      const allocated:CoreIndexRecord[]=[];
      for(const declaration of plan.added)allocated.push({ref:{id:selected.context.idGenerator.nextInternalId()},tableId:declaration.tableId,name:declaration.name,fields:declaration.fields,
        ts:null,state:{type:"Backfilling",backfillState:{indexCreatedLowerBound:selected.timestamp,retentionStarted:false,staged:declaration.staged}}});
      yield* applyIndexes(selected.context,prepareCoreIndexChanges(plan,allocated));
      return pendingProposal;
    }));
    yield* settle(selected);
    return Object.freeze({namespace:selected.context.namespace,id:result.id});
  }));
  });
  const summaryWorker=yield* makeCoreTableSummaryWorker({persistence,lease,retention:initial.retention,options,
    publishedTimestamp:committer.publishedTimestamp,publishCounts:committer.publishCounts});
  const schemaWorker=makeCoreSchemaWorker({persistence,lease,retention:initial.retention,options,publishedTimestamp:committer.publishedTimestamp,assertOwnerOpen:assertOpen,currentRegistry:committer.currentRegistry,countsPending:summaryWorker.hasMore,
    admin:(namespace,use)=>admin(namespace,selected=>use(selected.context)),
    settle:Effect.fn("CoreDatabase.settleWorker")(function*(context:CoreTransactionInternals){return yield* committer.submit(yield* consume(yield* context.transaction.finalize()));}),warmCounts:summaryWorker.advance});
  drainSchemaWork=schemaWorker.close;
  const advanceSchema:CoreDatabase["advanceSchema"]=Effect.fn("CoreDatabase.advanceSchema")(function*(proposal,work){
    yield* schemaWorker.advance(proposal,work);
    return yield* schemaStatus(proposal);
  });
  const activateSchema:CoreDatabase["activateSchema"]=Effect.fn("CoreDatabase.activateSchema")((requestedProposal,requestedPublication)=>{
    const proposal = Object.freeze({ ...requestedProposal }), publication = ownPublicationFrame(requestedPublication);
    return admin(proposal.namespace,selected=>Effect.gen(function*(){
    yield* selected.context.runSystem(Effect.gen(function*(){
      yield* guardNativeLifecycle(selected.context, publication.native, publication.bundle);
      const model=new CoreSchemaModel(selected.context),schema=yield* model.getValidatedOrActive(proposal.id);
      if (schema.metadata.native !== (publication.bundle?.metadata ?? publication.native?.metadata))
        return yield* nativeUnsupported("Schema activation requires its authenticated producer");
      const definitions = publication.bundle?.nativeDefinitions ?? (publication.native === undefined ? [] : [publication.native]);
      if (publication.native !== undefined || publication.bundle !== undefined) {
        if (publication.programs.length !== 0) return yield* nativeUnsupported("Composed Application/native activation is not supported");
        for (const definition of definitions) for (const declaration of definition.tables) {
          const table = selected.context.registry.table(declaration.name, proposal.namespace)?.definition;
          if (table?.nativePolicy === undefined || table.nativePolicy.schemaId !== proposal.id
            || !sameCoreNativeIdentity(table.nativePolicy.identity, definition.identity))
            return yield* nativeUnsupported("Native reservation no longer matches the proposal");
          if (table.nativePolicy.state !== "active") yield* assertEmptyNativeTable(selected, table);
        }
      }
      const changes=yield* Effect.fromResult(Result.mapError(finishCoreIndexChanges(planCoreIndexes(selected.context.registry,proposal.namespace,schema.schema)),error=>error.reason==="unavailable"?new CoreTransactionError({reason:"indexUnavailable",cause:error}):error));
      yield* applyIndexes(selected.context,changes);
      yield* model.markActive(proposal.id);
      for (const definition of definitions) for (const declaration of definition.tables) {
        const table = selected.context.registry.table(declaration.name, proposal.namespace)?.definition;
        const catalog = selected.context.registry.table(TABLES)?.definition;
        if (table?.nativePolicy === undefined || catalog === undefined) return yield* corrupt();
        if (table.nativePolicy.state !== "active") yield* selected.context.replaceSystem(TABLES,
          yield* Effect.fromResult(publicDocumentId(catalog, table.tabletId)),
          tableDocument({ ...table, nativePolicy: { ...table.nativePolicy, state: "active" } }));
      }
    }));
    yield* writePrograms(selected,publication);
    const timestamp=yield* settle(selected);
    return {timestamp,tables:[...selected.context.registry.tables.values()].map(record=>record.definition).filter(table=>!table.name.startsWith("_")&&coreNamespaceKey(table.namespace)===coreNamespaceKey(proposal.namespace))};
  }));
  });
  const publishPrograms:CoreDatabase["publishPrograms"]=Effect.fn("CoreDatabase.publishPrograms")((requested)=>{
    const publication = ownPublicationFrame(requested);
    return admin(publication.namespace??null,selected=>Effect.gen(function*(){
    yield* guardNativeLifecycle(selected.context, publication.native, publication.bundle);
    if (publication.native !== undefined || publication.bundle !== undefined) return yield* nativeUnsupported("Native command publication uses shared schema activation");
    yield* selected.context.runSystem(new CoreSchemaModel(selected.context).active());
    yield* writePrograms(selected,publication);
    const timestamp=yield* settle(selected);
    return {timestamp,tables:[...selected.context.registry.tables.values()].map(record=>record.definition).filter(table=>!table.name.startsWith("_")&&coreNamespaceKey(table.namespace)===coreNamespaceKey(publication.namespace??null))};
  }));
  });

  const readAuthorityEpoch = Effect.gen(function* () {
    yield* assertOpen;
    const authority = committer.currentRegistry().authority;
    if (authority === undefined) return yield* Effect.fail(corrupt());
    return authority.epoch;
  });

  const nativeAuthority = Effect.fn("CoreDatabase.nativeAuthority")(function* (binding: RequestBinding) {
    yield* assertOpen;
    const authority = nativeBindings.get(binding);
    if (authority === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    yield* Effect.fromResult(checkCoreNativeAuthority(committer.currentRegistry(), authority));
    return authority;
  });
  const bindNative: CoreDatabase["bindNative"] = Effect.fn("CoreDatabase.bindNative")(function* (requested) {
    const input = Object.freeze({ ...requested, ...(requested.commands === undefined ? {} : {
      commands: Object.freeze(requested.commands.map(command => Object.freeze({ ...command }))),
    }) });
    yield* assertOpen;
    yield* Effect.fromResult(requireCoreNativeDefinition(input.definition));
    const namespace = yield* Effect.fromResult(Result.mapError(captureCoreTableNamespace(input.namespace ?? null), invalid));
    const selected = yield* start();
    const schemaTable = selected.registry.table(SCHEMAS, namespace)?.definition;
    const state = schemaTable?.indexes.find(index => index.name === "by_state");
    if (schemaTable === undefined || state === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const active = yield* Effect.fromResult(selected.registry.schemas.getByState(namespace, "active", state.ref, () => {}));
    const epoch = selected.registry.authority?.epoch;
    if (Option.isNone(active) || !coreNativeSchemaIncludes(selected.registry, active.value.metadata.native, input.definition) || epoch === undefined)
      return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const tables: CoreTableDefinition[] = [];
    for (const declaration of input.definition.tables) {
      const table = selected.registry.table(declaration.name, namespace)?.definition;
      if (table === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      tables.push(table);
    }
    const registrations = yield* decodeNativeRegistrations(input.commands ?? input.definition.commands)
      .pipe(Effect.mapError(invalid));
    if (new Set(registrations.map(command => command.name)).size !== registrations.length) return yield* invalid();
    const commands = Object.freeze(registrations.map(({ name, mode }) => Object.freeze({ name, mode,
      identity: Object.freeze({ source: input.definition.identity, name, mode }) })));
    const authority = Object.freeze({ definition: input.definition, namespace, schemaId: active.value.id,
      authorityEpoch: epoch, tables: Object.freeze(tables), commands });
    yield* Effect.fromResult(checkCoreNativeAuthority(selected.registry, authority));
    const binding = issueCoreNativeBinding();
    nativeBindings.set(binding, authority);
    return binding;
  });
  const readNativeBinding: CoreDatabase["readNativeBinding"] = Effect.fn("CoreDatabase.readNativeBinding")(function* (binding) {
    const authority = yield* nativeAuthority(binding);
    return Object.freeze({ ...authority, tables: Object.freeze(authority.tables.map(copyTableDefinition)) });
  });
  const bindNativeInitialization: CoreDatabase["bindNativeInitialization"] = Effect.fn("CoreDatabase.bindNativeInitialization")(function* (input) {
    const binding = input.binding, commandName = input.commandName;
    const authority = yield* nativeAuthority(binding);
    const command = authority.commands.find(candidate => candidate.name === commandName);
    if (command?.mode !== "write") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const initialization = issueCoreNativeInitializationBinding();
    nativeInitializationBindings.set(initialization, Object.freeze({ binding, command }));
    return initialization;
  });
  const nativeRootAuthority = Effect.fn("CoreDatabase.nativeRootAuthority")(function* (binding: RequestBinding) {
    yield* assertOpen;
    const data = nativeRootBindings.get(binding);
    if (data === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    yield* Effect.fromResult(checkNativeRoot(committer.currentRegistry(), data));
    return data;
  });
  const bindNativeRoot: CoreDatabase["bindNativeRoot"] = Effect.fn("CoreDatabase.bindNativeRoot")(function* (input) {
    // Keep exact opaque handles, but own every mutable wrapper before the first
    // asynchronous snapshot/hash. A later caller mutation cannot retarget proof.
    const bundle = input.bundle;
    const maxFinalUserDocuments = input.maxFinalUserDocuments;
    if (input.participants.length === 0 || input.participants.length > 64
      || input.participants.some(participant => participant.commands.length === 0 || participant.commands.length > 128))
      return yield* invalid("Invalid native root participant closure");
    const requestedParticipants = input.participants.map(participant => Object.freeze({ binding: participant.binding,
      commands: Object.freeze([...participant.commands]), limits: Object.freeze({ ...participant.limits }) }));
    const requestedApplication = input.applicationInsert === undefined ? undefined : Object.freeze({ ...input.applicationInsert });
    const contract = capturePrivateJsonData(input.contract, 1_048_576,
      (reason, cause) => new CoreTransactionError({ reason: reason === "limitExceeded" ? "capacity" : "invalidValue", cause }),
      { canonicalNumbers: true, wellFormedUnicode: true });
    yield* assertOpen;
    const capturedContract = yield* Effect.fromResult(contract);
    if (!isJsonObject(capturedContract.value)) return yield* invalid("Native root contract must be an object");
    yield* Effect.fromResult(requireCoreSchemaBundle(bundle));
    if (!schemaBundles.some(expected => expected.metadata === bundle.metadata)
      || requestedParticipants.length === 0 || requestedParticipants.length > 64
      || !Number.isSafeInteger(maxFinalUserDocuments) || maxFinalUserDocuments < 1
      || maxFinalUserDocuments > CORE_TRANSACTION_REFERENCE_LIMITS.documentsWritten)
      return yield* invalid("Invalid native root contract");
    const selected = yield* start();
    const namespace = bundle.namespace;
    const schemaTable = selected.registry.table(SCHEMAS, namespace)?.definition;
    const state = schemaTable?.indexes.find(index => index.name === "by_state");
    if (state === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const active = yield* Effect.fromResult(selected.registry.schemas.getByState(namespace, "active", state.ref, () => {}));
    const authorityEpoch = selected.registry.authority?.epoch;
    if (Option.isNone(active) || active.value.metadata.native !== bundle.metadata || authorityEpoch === undefined)
      return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    const natives = new Map<CoreNativeBinding, NativeRootAccess>();
    const applicationInserts = new Map<CoreApplicationInsertBinding, ApplicationInsertAccess>();
    const participants: CoreNativeRootBindingMetadata["participants"][number][] = [];
    const sources = new Set<string>();
    for (const participant of requestedParticipants) {
      const authority = yield* nativeAuthority(participant.binding);
      if (sources.has(authority.definition.identity.sourceKey) || natives.has(participant.binding)
        || authority.schemaId !== active.value.id || authority.authorityEpoch !== authorityEpoch
        || coreNamespaceKey(authority.namespace) !== coreNamespaceKey(namespace))
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      sources.add(authority.definition.identity.sourceKey);
      const nativeLimits = Object.freeze(yield* decodeNativeLimits(participant.limits).pipe(Effect.mapError(invalid)));
      if (participant.commands.length === 0 || participant.commands.length > 128
        || new Set(participant.commands).size !== participant.commands.length) return yield* invalid("Invalid native child commands");
      const commands: CoreNativeCommandDefinition[] = [];
      for (const name of participant.commands) {
        const command = authority.commands.find(candidate => candidate.name === name);
        if (command === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
        commands.push(command);
      }
      commands.sort((left, right) => compareUtf16Strings(left.name, right.name));
      natives.set(participant.binding, Object.freeze({ kind: "native", authority, limits: nativeLimits,
        readonly: commands.every(command => command.mode === "read") }));
      participants.push(Object.freeze({ binding: participant.binding, commands: Object.freeze(commands),
        definition: authority.definition, limits: nativeLimits }));
    }
    participants.sort((left, right) => compareUtf16Strings(left.definition.identity.sourceKey, right.definition.identity.sourceKey));
    let applicationInsert: CoreNativeRootBindingMetadata["applicationInsert"];
    let applicationIdentity: Json = null;
    if (requestedApplication !== undefined) {
      const binding = bundle.bindings.find(candidate => candidate.sourceKey === "application"
        && candidate.localName === requestedApplication.table);
      const source = bundle.sources.find(candidate => candidate.kind === "application" && candidate.definition.source.key === "application");
      const table = binding === undefined ? undefined : selected.registry.table(binding.coreTableName, namespace)?.definition;
      if (binding === undefined || source === undefined || table === undefined)
        return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const applicationLimits = Object.freeze(yield* decodeNativeLimits({ maxIdentities: 1,
        maxDocumentBytes: requestedApplication.maxDocumentBytes }).pipe(Effect.mapError(invalid)));
      const authority = Object.freeze({ kind: "applicationInsert" as const, sourceKey: "application" as const, namespace,
        schemaId: active.value.id, authorityEpoch, table, bundle });
      yield* Effect.fromResult(checkCoreApplicationInsertAuthority(selected.registry, authority));
      const grant = issueCoreApplicationInsertBinding();
      applicationInserts.set(grant, Object.freeze({ kind: "applicationInsert", authority, limits: applicationLimits }));
      applicationInsert = Object.freeze({ binding: grant, table, limits: applicationLimits });
      applicationIdentity = { sourceKey: "application", sourceSha256: source.definition.source.sourceSha256,
        table: { ...binding.table }, localName: binding.localName, limits: { ...applicationLimits } };
    }
    const accesses = Object.freeze([...natives.values(), ...applicationInserts.values()]);
    const rootLimits = Object.freeze(yield* decodeNativeLimits({ maxIdentities: accesses.reduce((sum, access) => sum + access.limits.maxIdentities, 0),
      maxDocumentBytes: Math.max(...accesses.map(access => access.limits.maxDocumentBytes)) }).pipe(Effect.mapError(invalid)));
    const identity = yield* nativeRootIdentity({ format: "flarex.core-native-root", version: 1, namespace,
      contract: capturedContract.value, participants: participants.map(participant => ({ source: { ...participant.definition.identity },
        commands: participant.commands.map(command => ({ name: command.name, mode: command.mode })), limits: { ...participant.limits } })),
      applicationInsert: applicationIdentity, maxFinalUserDocuments });
    const metadata: CoreNativeRootBindingMetadata = Object.freeze({ identity, namespace, schemaId: active.value.id, authorityEpoch,
      limits: rootLimits, maxFinalUserDocuments,
      participants: Object.freeze(participants), ...(applicationInsert === undefined ? {} : { applicationInsert }) });
    const data: NativeRootData = Object.freeze({ metadata, bundle, natives, applicationInserts,
      accesses, limits: rootLimits, maxFinalUserDocuments });
    yield* Effect.fromResult(checkNativeRoot(selected.registry, data));
    const root = issueCoreNativeRootBinding();
    nativeRootBindings.set(root, data);
    return root;
  });
  const readNativeRootBinding: CoreDatabase["readNativeRootBinding"] = Effect.fn("CoreDatabase.readNativeRootBinding")(function* (binding) {
    const { metadata } = yield* nativeRootAuthority(binding);
    return Object.freeze({ ...metadata, ...(metadata.applicationInsert === undefined ? {} : {
      applicationInsert: Object.freeze({ ...metadata.applicationInsert, table: copyTableDefinition(metadata.applicationInsert.table) }),
    }) });
  });
  const beginNative: CoreDatabase["beginNative"] = Effect.fn("CoreDatabase.beginNative")((binding, beginOptions) =>
    Effect.flatMap(Effect.gen(function* () {
      const authority = yield* nativeAuthority(binding);
      const command = authority.commands.find(candidate => candidate.name === beginOptions.commandName);
      if (command === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
      const nativeLimits = Object.freeze(yield* decodeNativeLimits(beginOptions.limits).pipe(Effect.mapError(invalid)));
      if (typeof beginOptions.chargeRetained !== "function") return yield* invalid("Native retained-byte owner is required");
      const claimData = beginOptions.claim === undefined ? undefined : claims.get(beginOptions.claim);
      if (beginOptions.claim !== undefined && (claimData === undefined || !claimData.active
        || claimData.identity.kind !== "native" || !sameNativeCommand(claimData.identity.native, command.identity)))
        return yield* new CoreTransactionError({ reason: "foreignClaim" });
      if (command.mode === "read" && beginOptions.claim !== undefined) return yield* new CoreTransactionError({ reason: "foreignClaim" });
      const selected = yield* startNative();
      yield* Effect.fromResult(checkCoreNativeAuthority(selected.registry, authority));
      const assertNativeOpen = Effect.andThen(assertOpen, Effect.suspend(() =>
        Effect.fromResult(checkCoreNativeAuthority(committer.currentRegistry(), authority))));
      const capture = Effect.fn("CoreDatabase.captureNative")(function* () {
        yield* assertNativeOpen;
        const observed = command.mode === "read" ? selected : yield* startNative();
        yield* Effect.fromResult(checkCoreNativeAuthority(observed.registry, authority));
        return { snapshot: observed.snapshot, registry: observed.registry, writeLog: observed.writeLog,
          residentReader: (request: CoreIndexScan) => observed.resident.scan(request) };
      });
      const now = yield* decodeCreationTimestamp(yield* options.now).pipe(Effect.mapError(invalid));
      const idGenerator = yield* prepareCoreTransactionIdGenerator(options);
      yield* assertNativeOpen;
      const context = createCoreTransaction({ snapshot: selected.snapshot, registry: selected.registry,
        residentReader: request => selected.resident.scan(request), operationCacheMaxBytes, now, idGenerator,
        vault, limits, namespace: authority.namespace, schemaBundles,
        readonly: command.mode === "read", native: { authority, visibility: command.mode === "read" ? "snapshot" : "command", capture,
          limits: nativeLimits, chargeRetained: beginOptions.chargeRetained },
        assertOwnerOpen: assertNativeOpen, onClosed: () => borrowed.delete(context),
        ...(beginOptions.claim === undefined ? {} : { claim: beginOptions.claim }) });
      return { selected, context, command, authority, claimData };
    }), prepared => Effect.acquireUseRelease(registerBorrow(prepared,
      () => checkCoreNativeAuthority(committer.currentRegistry(), prepared.authority)), selected => Effect.gen(function* () {
      const metadataReads = yield* Effect.fromResult(coreNativeMetadataReads(selected.selected.registry, selected.authority));
      for (const read of metadataReads) for (const interval of read.intervals) selected.context.addIndexRead(read.indexId, interval);
      if (selected.claimData !== undefined) {
        yield* requireClaimRevision(selected.selected, selected.claimData, selected.context);
      }
      const operations = selected.context.nativeOperations;
      if (operations === undefined) return yield* corrupt("Native transaction facade is unavailable");
      return Object.freeze({ unixTime: selected.context.transaction.unixTime, command: selected.command, operations, finishRead: selected.context.finishRead,
        finalize: selected.context.transaction.finalize, abort: selected.context.transaction.abort }) satisfies CoreNativeOperation;
    }), (selected, exit) => Exit.isSuccess(exit) ? Effect.void : selected.context.transaction.abort())));

  const beginNativeRoot: CoreDatabase["beginNativeRoot"] = Effect.fn("CoreDatabase.beginNativeRoot")((binding, beginOptions) =>
    Effect.flatMap(Effect.gen(function* () {
      const data = yield* nativeRootAuthority(binding);
      const claimData = claims.get(beginOptions.claim);
      if (claimData === undefined || !claimData.active || claimData.identity.kind !== "nativeRoot"
        || !sameNativeRoot(claimData.identity.root, data.metadata.identity))
        return yield* new CoreTransactionError({ reason: "foreignClaim" });
      if (typeof beginOptions.chargeRetained !== "function") return yield* invalid("Native retained-byte owner is required");
      const selected = yield* startNative();
      yield* Effect.fromResult(checkNativeRoot(selected.registry, data));
      const assertNativeOpen = Effect.andThen(assertOpen, Effect.suspend(() =>
        Effect.fromResult(checkNativeRoot(committer.currentRegistry(), data))));
      const capture = Effect.fn("CoreDatabase.captureNativeRoot")(function* () {
        yield* assertNativeOpen;
        const observed = yield* startNative();
        yield* Effect.fromResult(checkNativeRoot(observed.registry, data));
        return { snapshot: observed.snapshot, registry: observed.registry, writeLog: observed.writeLog,
          residentReader: (request: CoreIndexScan) => observed.resident.scan(request) };
      });
      const now = yield* decodeCreationTimestamp(yield* options.now).pipe(Effect.mapError(invalid));
      const idGenerator = yield* prepareCoreTransactionIdGenerator(options);
      yield* assertNativeOpen;
      const context = createCoreTransaction({ snapshot: selected.snapshot, registry: selected.registry,
        residentReader: request => selected.resident.scan(request), operationCacheMaxBytes, now, idGenerator,
        vault, limits, namespace: data.metadata.namespace, schemaBundles,
        nativeRoot: { accesses: data.accesses, limits: data.limits, maxFinalUserDocuments: data.maxFinalUserDocuments,
          chargeRetained: beginOptions.chargeRetained, capture }, assertOwnerOpen: assertNativeOpen,
        onClosed: () => borrowed.delete(context), claim: beginOptions.claim });
      return { selected, context, data, claimData };
    }), prepared => Effect.acquireUseRelease(registerBorrow(prepared,
      () => checkNativeRoot(committer.currentRegistry(), prepared.data)), selected => Effect.gen(function* () {
      const metadataReads = yield* Effect.fromResult(nativeRootMetadataReads(selected.selected.registry, selected.data));
      for (const read of metadataReads) for (const interval of read.intervals) selected.context.addIndexRead(read.indexId, interval);
      yield* requireClaimRevision(selected.selected, selected.claimData, selected.context);
      const native = Effect.fn("CoreNativeRoot.native")(function* (childBinding: CoreNativeBinding) {
        const access = selected.data.natives.get(childBinding);
        if (access === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
        return yield* selected.context.nativeFor(access);
      });
      const applicationInsert = Effect.fn("CoreNativeRoot.applicationInsert")(function* (childBinding: CoreApplicationInsertBinding) {
        const access = selected.data.applicationInserts.get(childBinding);
        if (access === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
        return yield* selected.context.applicationInsertFor(access);
      });
      return Object.freeze({ unixTime: selected.context.transaction.unixTime, native, applicationInsert,
        finalize: selected.context.transaction.finalize, abort: selected.context.transaction.abort });
    }), (selected, exit) => Exit.isSuccess(exit) ? Effect.void : selected.context.transaction.abort())));

  const database: CoreDatabase = {
    assertOpen,
    close,
    beginQuery: Effect.fn("CoreDatabase.beginQuery")((path) =>
      useTransaction(make(undefined, undefined, true), selected => Effect.gen(function* () {
        const transaction = selected.context.transaction;
        const program = yield* transaction.selectProgram(path);
        const { timestamp, unixTime, usage, selectProgram, tableNumber, tableMappings, normalizeId, get, startQuery, scan } = transaction;
        return Object.freeze({ program,
          transaction: Object.freeze({ timestamp, unixTime, usage, selectProgram, tableNumber, tableMappings, normalizeId, get, startQuery, scan }),
          finish: selected.context.finishRead, abort: transaction.abort });
      }), true)),
    prepareSchema,schemaStatus,advanceSchema,advanceSchemaWork:schemaWorker.advanceWork,activateSchema,publishPrograms,
    bindNative, readNativeBinding, beginNative, bindNativeInitialization,
    bindNativeRoot, readNativeRootBinding, beginNativeRoot,
    selectProgram: Effect.fn("CoreDatabase.selectProgram")(function* (path) {
      yield* assertOpen;
      const registry = committer.currentRegistry();
      const head = registry.head(path);
      const program = head === undefined ? undefined : registry.program(head.identity);
      if (program === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "programUnavailable" }));
      return yield* Effect.fromResult(ownedProgram(program.definition));
    }),
    lookupProgram: Effect.fn("CoreDatabase.lookupProgram")(function* (identity) {
      yield* assertOpen;
      const program = committer.currentRegistry().program(identity);
      if (program === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "programUnavailable" }));
      return yield* Effect.fromResult(ownedProgram(program.definition));
    }),
    resolveRequest: Effect.fn("CoreDatabase.resolveRequest")(function* (requested) {
      const identity = ownRequestIdentity(requested);
      return yield* Effect.fromResult(resolution(yield* findRequest(yield* start(), identity)));
    }),
    recoverRequest: Effect.fn("CoreDatabase.recoverRequest")((requested) => {
      const identity = ownRequestIdentity(requested);
      return useTransaction(make(), selected => Effect.gen(function* () {
        const record = yield* findRequest(selected, identity, selected.context);
        if (record === undefined || record.state !== "claimed") {
          return yield* Effect.fromResult(resolution(record));
        }
        if (record.leaseToken === lease.token) {
          return { kind: "busy" as const };
        }
        if (record.leaseToken > lease.token) return yield* Effect.fail(new CorePersistenceError({ reason: "leaseLost" }));
        // New owner was fenced before start(): all predecessor writes have settled,
        // and the single request revision proves no committed outcome exists.
        // Discovery uses authenticated path/request correlation, as replay does;
        // terminalization preserves the stored original program and mints no body authority.
        yield* selected.context.writePrivate(REQUESTS, record.id, { ...withoutSystemFields(record.document),
          state: "failed", abandonedByLease: lease.token });
        yield* committer.submit(yield* consume(yield* selected.context.transaction.finalize()));
        return { kind: "failed" as const };
      }));
    }),
    claimRequest: Effect.fn("CoreDatabase.claimRequest")((requested, binding) => {
      const identity = ownRequestIdentity(requested);
      return useTransaction(make(), selected => Effect.gen(function* (): Generator<Effect.Effect<unknown, CoreError>, CoreRequestAcquisition, unknown> {
        let initialization: Readonly<{ binding: CoreNativeBinding; command: CoreNativeCommandDefinition }> | undefined;
        if (identity.kind === "nativeRoot") {
          if (binding === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          const data = yield* nativeRootAuthority(binding);
          if (!sameNativeRoot(data.metadata.identity, identity.root)) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          const metadataReads = yield* Effect.fromResult(nativeRootMetadataReads(selected.registry, data));
          for (const read of metadataReads) for (const interval of read.intervals) selected.context.addIndexRead(read.indexId, interval);
        } else if (identity.kind === "native") {
          if (binding === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          initialization = nativeInitializationBindings.get(binding);
          if (initialization !== undefined && !sameNativeCommand(initialization.command.identity, identity.native))
            return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          const authority = yield* nativeAuthority(initialization?.binding ?? binding);
          const command = authority.commands.find(candidate => sameNativeCommand(candidate.identity, identity.native));
          if (command?.mode !== "write") return yield* new CoreTransactionError({ reason: "authorityRevoked" });
          const metadataReads = yield* Effect.fromResult(coreNativeMetadataReads(selected.registry, authority));
          for (const read of metadataReads) for (const interval of read.intervals) selected.context.addIndexRead(read.indexId, interval);
        } else {
          const program = selected.registry.program(identity.program);
          if (program === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "programUnavailable" }));
        }
        const existing = yield* findRequest(selected, identity, selected.context);
        if (existing !== undefined && existing.leaseToken > lease.token)
          return yield* new CorePersistenceError({ reason: "leaseLost" });
        if (existing !== undefined && (existing.state !== "failed" || initialization === undefined)) {
          return yield* Effect.fromResult(existingResolution(existing));
        }
        const id = existing?.id ?? selected.context.idGenerator.nextInternalId();
        const requestBody = { key: identity.key, requestHash: identity.requestHash,
          ...requestActor(identity), state: "claimed", leaseToken: lease.token };
        if (existing === undefined) yield* selected.context.insertPrivate(REQUESTS, id, requestBody);
        else yield* selected.context.writePrivate(REQUESTS, id, requestBody);
        const body = yield* selected.context.readPrivate(REQUESTS, id);
        if (Option.isNone(body)) return yield* Effect.fail(corrupt());
        const finalized = yield* consume(yield* selected.context.transaction.finalize());
        const table = selected.registry.table(REQUESTS)?.definition;
        if (table === undefined) return yield* Effect.fail(corrupt());
        return yield* Effect.matchCauseEffect(committer.submit(finalized), { onFailure: cause => Effect.gen(function* () {
          // Only this claim's proven nonacceptance can consult pending request data.
          // An accepted request is never retried or turned into another body claim.
          const reason = cause.reasons[0];
          if (cause.reasons.length !== 1 || reason === undefined || !Cause.isFailReason(reason)
            || reason.error._tag !== "CoreTransactionError" || reason.error.reason !== "conflict") return yield* Effect.failCause(cause);
          const byKey = table.indexes.find(index => index.name === "by_key");
          if (byKey === undefined) return yield* Effect.fail(corrupt());
          const prefix = yield* Effect.fromResult(Result.mapError(encodeIndexValue(identity.key), invalid));
          const pending = yield* committer.pendingDocuments(byKey.ref.id, equalityInterval(prefix));
          if (pending.length > 1) return yield* Effect.fail(corrupt());
          const pendingEntry = pending[0];
          if (pendingEntry !== undefined) {
            yield* Effect.fromResult(requestRecord(pendingEntry, table, identity));
            return { kind: "busy" as const };
          }
          const published = yield* findRequest(yield* start(), identity);
          if (published !== undefined) return yield* Effect.fromResult(existingResolution(published));
          return yield* Effect.failCause(cause);
        }), onSuccess: timestamp => Effect.gen(function* () {
          const jsonValue = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(body.value), invalid));
          const claim = issueCoreClaim();
          claims.set(claim, { identity, active: true, record: {
            id, document: body.value, state: "claimed", leaseToken: lease.token, revision: { ts: timestamp, tableId: table.tabletId.slice(), id: id.slice(),
              jsonValue, deleted: false, prevTs: existing?.revision.ts ?? null },
          } });
          return { kind: "claimed" as const, claim };
        }) });
      }));
    }),
    begin: Effect.fn("CoreDatabase.begin")(function* (beginOptions = {}) {
      const claimData = beginOptions.claim === undefined ? undefined : claims.get(beginOptions.claim);
      if (beginOptions.claim !== undefined && (claimData === undefined || !claimData.active))
        return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
      if (claimData?.identity.kind === "native" || claimData?.identity.kind === "nativeRoot")
        return yield* new CoreTransactionError({ reason: "foreignClaim" });
      if (claimData !== undefined && beginOptions.program !== undefined
        && programKey(claimData.identity.program) !== programKey(beginOptions.program))
        return yield* Effect.fail(new CoreTransactionError({ reason: "requestMismatch" }));
      const programIdentity = claimData?.identity.program ?? beginOptions.program;
      return yield* useTransaction(make(beginOptions.at, beginOptions.claim, false, beginOptions.namespace ?? null), selected => Effect.gen(function* () {
        if (programIdentity !== undefined) {
          const program = selected.registry.program(programIdentity);
          const head = selected.registry.head(programIdentity.functionPath);
          if (program === undefined || head === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "programUnavailable" }));
          yield* selected.context.readPrivate(PROGRAMS, program.id);
          yield* selected.context.readPrivate(PROGRAMS, head.id);
        }
        if (beginOptions.authorityEpoch !== undefined) {
          const authority = selected.registry.authority;
          if (authority === undefined) return yield* Effect.fail(corrupt());
          if (authority.epoch !== beginOptions.authorityEpoch) return yield* Effect.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
          yield* selected.context.readPrivate(PROGRAMS, authority.id);
        }
        if (claimData !== undefined) {
          if (selected.timestamp < claimData.record.revision.ts) return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
          yield* requireClaimRevision(selected, claimData, selected.context);
        }
        return selected.context.transaction;
      }), true);
    }),
    commit: Effect.fn("CoreDatabase.commit")(function* (handle, commitOptions = {}) {
      yield* assertOpen;
      let finalized = yield* consume(handle);
      const admissionDeadlineUnixMilliseconds = commitOptions.admissionDeadlineUnixMilliseconds;
      if (admissionDeadlineUnixMilliseconds !== undefined) {
        if (!Number.isSafeInteger(admissionDeadlineUnixMilliseconds)) return yield* Effect.fail(invalid());
        finalized = { ...finalized, admissionDeadlineUnixMilliseconds };
      }
      if (finalized.claim !== commitOptions.claim) return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
      let claimData: ClaimData | undefined;
      if (commitOptions.claim !== undefined) {
        claimData = claims.get(commitOptions.claim);
        if (claimData === undefined || !claimData.active) return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
        const table = finalized.registry.table(REQUESTS)?.definition;
        if (table === undefined) return yield* Effect.fail(corrupt());
        const encodedResult = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(commitOptions.result ?? null), invalid));
        const result = utf8Decoder.decode(encodedResult);
        const captured = yield* Effect.fromResult(Result.mapError(captureCoreDocument({ ...claimData.record.document, state: "committed", result }, true), invalid));
        const accounting = new CoreAccounting(limits, finalized.usage);
        yield* Effect.fromResult(accounting.write(true, captured.semanticSizeBytes));
        const finalDocument = captured.value;
        const outcomeChange: CoreDocumentChange = { table, id: claimData.record.id.slice(), original: claimData.record.revision,
          originalDocument: claimData.record.document, finalDocument };
        const reads = new CoreReadSetBuilder();
        for (const read of finalized.reads) for (const interval of read.intervals) reads.add(read.indexId, interval);
        yield* Effect.fromResult(addTableWriteDependencies(reads, finalized.registry, table));
        finalized = { ...finalized, reads: reads.snapshot(), changes: Object.freeze([...finalized.changes, outcomeChange]), usage: accounting.snapshot() };
      }
      const timestamp = yield* committer.submit(finalized);
      // A closed owner cannot disclose success; its already committed correlated
      // outcome remains authoritative and must be reconciled, never aborted.
      yield* assertOpen.pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause,
        failure => new CorePersistenceError({ reason: "uncertainWrite", cause: failure })))));
      if (claimData !== undefined) claimData.active = false;
      return timestamp;
    }),
    abortRequest: Effect.fn("CoreDatabase.abortRequest")(function* (claim) {
      const data = claims.get(claim);
      if (data === undefined || !data.active) return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
      return yield* useTransaction(make(), selected => Effect.gen(function* () {
        const current = yield* requireClaimRevision(selected, data, selected.context);
        yield* selected.context.writePrivate(REQUESTS, data.record.id, { ...withoutSystemFields(current.document), state: "failed" });
        const finalized = yield* consume(yield* selected.context.transaction.finalize());
        yield* Effect.uninterruptible(Effect.gen(function* () {
          yield* committer.submit(finalized);
          data.active = false;
        }));
      }));
    }),
    publishedTimestamp: committer.publishedTimestamp,
    readAuthorityEpoch,
    advanceAuthorityEpoch: Effect.fn("CoreDatabase.advanceAuthorityEpoch")((epoch) =>
      useTransaction(make(), selected => Effect.gen(function* () {
        const authority = selected.registry.authority;
        if (authority === undefined) return yield* Effect.fail(corrupt());
        if (epoch < authority.epoch || epoch < 0n || epoch > 0x7fff_ffff_ffff_ffffn) return yield* Effect.fail(invalid());
        if (epoch === authority.epoch) return;
        yield* selected.context.writePrivate(PROGRAMS, authority.id, { kind: "authority", epoch });
        selected.context.setRegistryAfter(selected.registry.withAuthority({ id: authority.id, epoch, ts: null }));
        yield* committer.submit(yield* consume(yield* selected.context.transaction.finalize()));
      }))),
  };
  return Object.freeze(database);
});

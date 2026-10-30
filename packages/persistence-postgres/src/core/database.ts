/**
 * Private outcome packing translated from Convex crates/model/src/session_requests/types.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318: JsonPackedValue is stored as an internal-JSON string.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Cause, Effect, Exit, Option, Result, Schema, Semaphore } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentValue, encodeDocumentValue, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { encodeIndexValue } from "flarex-protocol/index-key";
import { CoreProgramIdentitySchema, CoreSchemaWorkerOptionsSchema, CoreTransactionLimitsSchema, CoreTransactionError, issueCoreClaim, type CoreDatabase, type CoreDatabaseOptions, type CoreError,
  type CoreProgramPublication, type CoreSchemaProposal, type CoreSchemaStatus, type CoreProgramDefinition, type CoreRequestAcquisition,
  type CoreRequestClaim, type CoreRequestIdentity, type CoreRequestResolution, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreIndexScan, type CoreInterval, type CorePersistence, type CorePersistenceSnapshot } from "./contracts";
import { allocateCoreBuiltinDefinitions, allocateInternalId, bootstrapCore } from "./bootstrap";
import { makeCoreCommitter } from "./committer";
import { INDEXES, PROGRAMS, REQUESTS, TABLES, programKey, readDocumentObject,
  tableDocument, SCHEMAS, SCHEMA_VALIDATIONS, SCHEMA_VALIDATION_PROGRESS, publicDocumentId, type CoreRegistry } from "./registry";
import { CoreFinalizationVault, createCoreTransaction, type CoreDocumentChange, type CoreFinalizedState,
  type CoreTransactionInternals } from "./transaction";
import { CORE_TRANSACTION_REFERENCE_LIMITS, CoreAccounting } from "./accounting";
import { captureCoreDocument, captureCoreObject } from "./document";
import { addTableWriteDependencies } from "./dependencies";
import { CoreReadSetBuilder } from "./writeLog";
import { captureCoreTableNamespace, coreNamespaceKey,type CoreTableNamespace } from "./namespace";
import { CoreSchemaModel } from "./schemaModel";
import { captureCoreSchema, checkCoreSchemaIndexReferences, CoreSchemaError } from "./schemaTypes";
import { coreIndexMetadataValue,type CoreIndexRecord } from "./indexState";
import { planCoreIndexes,prepareCoreIndexChanges,finishCoreIndexChanges,type CoreIndexChanges } from "./indexModel";
import { makeCoreSchemaWorker } from "./schemaWorker";
import { makeCoreTableSummaryWorker } from "./tableSummary";


const RequestRecordFields = { key: Schema.String, requestHash: Schema.String, program: CoreProgramIdentitySchema,
  leaseToken: Schema.BigInt };
const RequestRecord = Schema.Union([
  Schema.Struct({ ...RequestRecordFields, state: Schema.Literals(["claimed", "failed"]) }),
  Schema.Struct({ ...RequestRecordFields, state: Schema.Literal("committed"), result: Schema.String }),
]);
const decodeRequestRecord = Schema.decodeUnknownResult(RequestRecord);
const decodeProgramIdentity = Schema.decodeUnknownResult(CoreProgramIdentitySchema);
const decodeOperationCacheBytes = Schema.decodeUnknownEffect(Schema.Int.check(Schema.makeFilter(value =>
  Number.isSafeInteger(value) && value >= 0 ? undefined : "Expected a nonnegative safe cache size")));
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

function invalid(cause?: unknown): CoreTransactionError {
  return new CoreTransactionError({ reason: "invalidValue", ...(cause === undefined ? {} : { cause }) });
}
function corrupt(cause?: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
}

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
    const record = yield* Result.mapError(decodeRequestRecord(document), corrupt);
    if (record.key !== identity.key || record.requestHash !== identity.requestHash
      || record.program.functionPath !== identity.program.functionPath)
      return yield* Result.fail(new CoreTransactionError({ reason: "requestMismatch" }));
    const base = { id: entry.id.slice(), revision: entry, document, leaseToken: record.leaseToken };
    if (record.state === "committed") {
      const result = yield* Result.mapError(decodeDocumentValue(utf8.encode(record.result)), corrupt);
      return { ...base, state: "committed" as const, result };
    }
    return { ...base, state: record.state };
  });
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
  options={...options,schemaWorker:Object.freeze({...schemaWorkerOptions})};
  const limits = yield* Schema.decodeUnknownEffect(CoreTransactionLimitsSchema)({
    ...CORE_TRANSACTION_REFERENCE_LIMITS, ...options.transactionLimits,
  }).pipe(Effect.mapError(invalid));
  const operationCacheMaxBytes = yield* decodeOperationCacheBytes(options.operationCacheMaxBytes ?? 16 * 1024 * 1024)
    .pipe(Effect.mapError(invalid));
  const lease = yield* persistence.acquireLease();
  const initial = yield* bootstrapCore(persistence, lease, options);
  const committer = yield* makeCoreCommitter(persistence, lease, initial.timestamp, initial.registry, initial.resident, options);
  const vault = new CoreFinalizationVault();
  const claims = new WeakMap<CoreRequestClaim, ClaimData>();
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

  const start = Effect.fn("CoreDatabase.start")(function* (at?: bigint) {
    yield* assertOpen;
    const { timestamp, registry, resident, counts } = yield* Effect.fromResult(committer.selectSnapshot(at));
    const physicalSnapshot = yield* persistence.readSnapshot(timestamp, initial.retention);
    const snapshot: CorePersistenceSnapshot = Object.freeze({ ...physicalSnapshot,
      scan: (request: CoreIndexScan) => committer.indexCache.scan({ snapshot: physicalSnapshot, registry, request }),
    });
    yield* assertOpen;
    return { timestamp, snapshot, registry, resident, counts };
  });

  const make = Effect.fn("CoreDatabase.transaction")(function* (at?: bigint, claim?: CoreRequestClaim, readonly = false, namespace:CoreTableNamespace = null, system = false) {
    namespace=yield* Effect.fromResult(Result.mapError(captureCoreTableNamespace(namespace),invalid));
    const selected = yield* start(at);
    const now = yield* options.now;
    yield* assertOpen;
    const context = createCoreTransaction({ snapshot: selected.snapshot, registry: selected.registry,
      residentReader: request => selected.resident.scan(request), operationCacheMaxBytes,
      now, newInternalId: options.newInternalId, vault, limits: system ? CORE_TRANSACTION_REFERENCE_LIMITS : limits, readonly, namespace, ...(selected.counts===undefined?{}:{counts:selected.counts}), assertOwnerOpen: assertOpen,
      onClosed: () => borrowed.delete(context), ...(claim === undefined ? {} : { claim }) });
    borrowed.add(context);
    return { ...selected, context };
  });

  // make registers a borrow before validation. Dispose every non-transferred
  // operation on its full Exit, including defects and interruption. Disposal
  // never changes a durable request/outcome, even after an uncertain save.
  const useTransaction = Effect.fn("CoreDatabase.useTransaction")(<Value>(
    acquire: ReturnType<typeof make>,
    use: (selected: Effect.Success<ReturnType<typeof make>>) => Effect.Effect<Value, CoreError>,
    transferOnSuccess = false,
  ) => Effect.acquireUseRelease(acquire, use, (selected, exit) =>
    transferOnSuccess && Exit.isSuccess(exit) ? Effect.void : selected.context.transaction.abort()));

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
        const id = existing?.id ?? (yield* allocateInternalId(options.newInternalId));
        const previous = existing === undefined ? undefined
          : yield* Effect.fromResult(Result.mapError(encodeDocumentValue(existing.definition.metadata), invalid));
        const next = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(definition.metadata), invalid));
        if (previous === undefined || !bytesEqual(previous, next)) {
          yield* selected.context.writePrivate(PROGRAMS, id, { kind: "revision", identity: { ...definition.identity }, metadata: utf8Decoder.decode(next) });
          registry = registry.withProgram({ definition, id, ts: null });
        }
        const oldHead = registry.head(definition.identity.functionPath);
        if (oldHead === undefined || programKey(oldHead.identity) !== programKey(definition.identity)) {
          const headId = oldHead?.id ?? (yield* allocateInternalId(options.newInternalId));
          yield* selected.context.writePrivate(PROGRAMS, headId, { kind: "head", identity: { ...definition.identity } });
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
  const applyIndexes=Effect.fn("CoreDatabase.applyIndexChanges")(function*(context:CoreTransactionInternals,changes:CoreIndexChanges){
    const table=context.registry.table(INDEXES)?.definition;
    if(table===undefined)return yield* corrupt();
    for(const id of changes.removed)yield* context.deleteSystem(INDEXES,yield* Effect.fromResult(publicDocumentId(table,id)));
    for(const index of changes.added)yield* context.replaceSystem(INDEXES,yield* Effect.fromResult(publicDocumentId(table,index.ref.id)),coreIndexMetadataValue(index));
  });
  const ensureNamespace=Effect.fn("CoreDatabase.ensureNamespace")(function*(context:CoreTransactionInternals){
    const names=[SCHEMAS,SCHEMA_VALIDATIONS,SCHEMA_VALIDATION_PROGRESS].filter(name=>context.registry.table(name,context.namespace)===undefined);
    if(names.length===0)return;
    const definitions=yield* allocateCoreBuiltinDefinitions(options,names,context.namespace);
    let registry=context.registry;
    for(const table of definitions){
      registry=registry.withTable({definition:table,id:table.tabletId,ts:null});
      for(const index of table.indexes)registry=yield* Effect.fromResult(registry.withIndex({...index,tableId:table.tabletId,state:{type:"Enabled"},ts:null}));
    }
    context.setRegistryAfter(registry);
    for(const table of definitions)yield* context.replaceSystem(TABLES,yield* Effect.fromResult(publicDocumentId(context.registry.table(TABLES)!.definition,table.tabletId)),tableDocument(table));
    for(const table of definitions)for(const index of context.registry.indexesForTablet(table.tabletId))yield* context.replaceSystem(INDEXES,
      yield* Effect.fromResult(publicDocumentId(context.registry.table(INDEXES)!.definition,index.ref.id)),coreIndexMetadataValue(index));
  });
  const schemaStatus=Effect.fn("CoreDatabase.schemaStatus")((proposal:CoreSchemaProposal)=>admin(proposal.namespace,selected=>selected.context.runSystem(Effect.gen(function*(){
    const found=yield* new CoreSchemaModel(selected.context).get(proposal.id);
    if(Option.isNone(found))return yield* new CoreSchemaError({reason:"schemaNotFound",message:"Schema proposal does not exist"});
    const state=found.value.metadata.state,plan=planCoreIndexes(selected.context.registry,proposal.namespace,found.value.schema);
    const indexesReady=plan.added.length===0&&[...plan.identical.filter(index=>index.state.type!=="Backfilling"||!index.state.backfillState.staged),...plan.enabled]
      .every(index=>index.state.type!=="Backfilling");
    return {proposal,state:state.state,indexesReady,...(state.state==="failed"?{error:state.error,...(state.table_name===null?{}:{tableName:state.table_name})}:{})} satisfies CoreSchemaStatus;
  }))));
  const prepareSchema:CoreDatabase["prepareSchema"]=Effect.fn("CoreDatabase.prepareSchema")((input)=>admin(input.namespace??null,selected=>Effect.gen(function*(){
    const schema=yield* Effect.fromResult(captureCoreSchema(input.schema));
    yield* Effect.fromResult(checkCoreSchemaIndexReferences(schema));
    const result=yield* selected.context.runSystem(Effect.gen(function*(){
      yield* ensureNamespace(selected.context);
      const pendingProposal=yield* new CoreSchemaModel(selected.context).submitPending(schema);
      const plan=planCoreIndexes(selected.context.registry,input.namespace??null,schema);
      const allocated:CoreIndexRecord[]=[];
      for(const declaration of plan.added)allocated.push({ref:{id:yield* allocateInternalId(options.newInternalId)},tableId:declaration.tableId,name:declaration.name,fields:declaration.fields,
        ts:null,state:{type:"Backfilling",backfillState:{indexCreatedLowerBound:selected.timestamp,retentionStarted:false,staged:declaration.staged}}});
      yield* applyIndexes(selected.context,prepareCoreIndexChanges(plan,allocated));
      return pendingProposal;
    }));
    yield* settle(selected);
    return Object.freeze({namespace:selected.context.namespace,id:result.id});
  })));
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
  const activateSchema:CoreDatabase["activateSchema"]=Effect.fn("CoreDatabase.activateSchema")((proposal,publication)=>admin(proposal.namespace,selected=>Effect.gen(function*(){
    yield* selected.context.runSystem(Effect.gen(function*(){
      const model=new CoreSchemaModel(selected.context),schema=yield* model.getValidatedOrActive(proposal.id);
      const changes=yield* Effect.fromResult(Result.mapError(finishCoreIndexChanges(planCoreIndexes(selected.context.registry,proposal.namespace,schema.schema)),error=>error.reason==="unavailable"?new CoreTransactionError({reason:"indexUnavailable",cause:error}):error));
      yield* applyIndexes(selected.context,changes);
      yield* model.markActive(proposal.id);
    }));
    yield* writePrograms(selected,publication);
    const timestamp=yield* settle(selected);
    return {timestamp,tables:[...selected.context.registry.tables.values()].map(record=>record.definition).filter(table=>!table.name.startsWith("_")&&coreNamespaceKey(table.namespace)===coreNamespaceKey(proposal.namespace))};
  })));
  const publishPrograms:CoreDatabase["publishPrograms"]=Effect.fn("CoreDatabase.publishPrograms")((publication)=>admin(publication.namespace??null,selected=>Effect.gen(function*(){
    yield* selected.context.runSystem(new CoreSchemaModel(selected.context).active());
    yield* writePrograms(selected,publication);
    const timestamp=yield* settle(selected);
    return {timestamp,tables:[...selected.context.registry.tables.values()].map(record=>record.definition).filter(table=>!table.name.startsWith("_")&&coreNamespaceKey(table.namespace)===coreNamespaceKey(publication.namespace??null))};
  })));

  const readAuthorityEpoch = Effect.gen(function* () {
    yield* assertOpen;
    const authority = committer.currentRegistry().authority;
    if (authority === undefined) return yield* Effect.fail(corrupt());
    return authority.epoch;
  });

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
    resolveRequest: Effect.fn("CoreDatabase.resolveRequest")(function* (identity) {
      return yield* Effect.fromResult(resolution(yield* findRequest(yield* start(), identity)));
    }),
    recoverRequest: Effect.fn("CoreDatabase.recoverRequest")((identity) =>
      useTransaction(make(), selected => Effect.gen(function* () {
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
      }))),
    claimRequest: Effect.fn("CoreDatabase.claimRequest")((identity) =>
      useTransaction(make(), selected => Effect.gen(function* (): Generator<Effect.Effect<unknown, CoreError>, CoreRequestAcquisition, unknown> {
        const program = selected.registry.program(identity.program);
        if (program === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "programUnavailable" }));
        const existing = yield* findRequest(selected, identity, selected.context);
        if (existing !== undefined) {
          return yield* Effect.fromResult(existingResolution(existing));
        }
        const id = yield* allocateInternalId(options.newInternalId);
        yield* selected.context.writePrivate(REQUESTS, id, { key: identity.key, requestHash: identity.requestHash,
          program: { ...identity.program }, state: "claimed", leaseToken: lease.token });
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
          claims.set(claim, { identity: { ...identity, program: { ...identity.program } }, active: true, record: {
            id, document: body.value, state: "claimed", leaseToken: lease.token, revision: { ts: timestamp, tableId: table.tabletId.slice(), id: id.slice(),
              jsonValue, deleted: false, prevTs: null },
          } });
          return { kind: "claimed" as const, claim };
        }) });
      }))),
    begin: Effect.fn("CoreDatabase.begin")(function* (beginOptions = {}) {
      const claimData = beginOptions.claim === undefined ? undefined : claims.get(beginOptions.claim);
      if (beginOptions.claim !== undefined && (claimData === undefined || !claimData.active))
        return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
      if (claimData !== undefined && beginOptions.program !== undefined
        && programKey(claimData.identity.program) !== programKey(beginOptions.program))
        return yield* Effect.fail(new CoreTransactionError({ reason: "requestMismatch" }));
      return yield* useTransaction(make(beginOptions.at, beginOptions.claim, false, beginOptions.namespace ?? null), selected => Effect.gen(function* () {
        const programIdentity = claimData?.identity.program ?? beginOptions.program;
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
          const record = yield* selected.context.readPrivate(REQUESTS, claimData.record.id);
          if (Option.isNone(record) || record.value.state !== "claimed") return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
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
        const current = yield* selected.context.readPrivate(REQUESTS, data.record.id);
        if (Option.isNone(current) || current.value.state !== "claimed") return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
        yield* selected.context.writePrivate(REQUESTS, data.record.id, { ...withoutSystemFields(current.value), state: "failed" });
        yield* committer.submit(yield* consume(yield* selected.context.transaction.finalize()));
        data.active = false;
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

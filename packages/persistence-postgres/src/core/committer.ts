/**
 * Mechanisms translated from Convex crates/database/src/{committer,write_batcher,snapshot_manager}.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Cause, Clock, Deferred, Duration, Effect, Exit, Option, Queue, Result, Schema, Semaphore } from "effect";
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CoreTransactionError, type CoreDatabaseOptions, type CoreError } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreInterval, type CorePersistence, type CorePersistenceIndexEntry, type CorePersistenceLease, type CoreRetentionValidator, type CoreWriteBatch } from "./contracts";
import { CoreRegistry, SCHEMAS } from "./registry";
import { CoreTableCounts, type CoreTableCountDelta } from "./tableCounts";
import type { CoreSchemaRegistryUpdate } from "./schemaRegistry";
import type { CoreSystemDocument } from "./transaction";
import { deriveCoreWriteBatch, type CoreFinalizedState } from "./transaction";
import { CorePendingWrites, CoreWriteLog, indexKeysFromWrites, indexTransitionsFromWrites, type CoreIndexKeys, type CoreWriteLogSnapshot } from "./writeLog";
import { metadataConflictKeys } from "./dependencies";
import { makeCoreIndexCache, type CoreIndexCache } from "./indexCache";
import type { CoreResidentIndexes } from "./residentIndex";
import { prepareCoreNativeIndexes, validateCoreNativeIndexes } from "./nativeValidation";
import { checkCoreNativeRegistryTransition } from "./nativePolicy";

interface CorePublishedSnapshot {
  readonly registry: CoreRegistry;
  readonly resident: CoreResidentIndexes;
  readonly counts?: CoreTableCounts;
  readonly countDelta?:CoreTableCountDelta;
}

interface DurableCommit {
  readonly timestamp: bigint;
  readonly completion: Deferred.Deferred<void, CoreError>;
}

interface AcceptedCommit {
  readonly timestamp: bigint;
  readonly transaction: CoreFinalizedState;
  readonly batch: CoreWriteBatch;
  readonly changes: readonly CoreIndexKeys[];
  readonly keyTransitions: readonly CoreIndexKeys[];
  readonly documents: ReadonlyMap<string, CoreDocumentLogEntry>;
  readonly indexEntries: ReadonlyMap<string, CorePersistenceIndexEntry>;
  readonly ack: Deferred.Deferred<bigint, CoreError>;
  readonly durability: DurableCommit;
  readonly predecessors: readonly DurableCommit[];
  result?: Exit.Exit<void, CoreError>;
}

function externalPredecessors(members: readonly AcceptedCommit[]): readonly DurableCommit[] {
  const ownTimestamps = new Set(members.map(member => member.timestamp));
  const predecessors = new Map<bigint, DurableCommit>();
  for (const member of members) for (const predecessor of member.predecessors)
    if (!ownTimestamps.has(predecessor.timestamp)) predecessors.set(predecessor.timestamp, predecessor);
  return [...predecessors.values()];
}
const waitForDurability = Effect.fn("CoreWriteBatcher.waitForDurability")(function* (predecessors: readonly DurableCommit[]) {
  for (const predecessor of predecessors) yield* Deferred.await(predecessor.completion);
});
const readyToSave = Effect.fn("CoreWriteBatcher.readyToSave")(function* (members: readonly AcceptedCommit[]) {
  for (const predecessor of externalPredecessors(members))
    if (!(yield* Deferred.isDone(predecessor.completion))) return false;
  return true;
});

const PositiveLimit = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value > 0
  ? undefined : "Expected a positive safe limit"));
const CommitterConfig = Schema.Struct({ maxInflight: PositiveLimit, maxConcurrentSaves: PositiveLimit,
  maxBatchDocuments: PositiveLimit, maxBatchBytes: PositiveLimit, maxConcurrentPrevalidations: PositiveLimit,
  batchWriteThreshold: PositiveLimit, maxBatchDelayMilliseconds: Schema.Int.check(Schema.makeFilter(value =>
    Number.isSafeInteger(value) && value >= 0 ? undefined : "Expected a nonnegative safe delay")) });
const decodeCommitterConfig = Schema.decodeUnknownEffect(CommitterConfig);

/** db914cf06 committer.rs + write_batcher.rs: bounded saves, acceptance and publication differ. */
export interface CoreCommitter {
  readonly submit: (transaction: CoreFinalizedState) => Effect.Effect<bigint, CoreError>;
  readonly publishedTimestamp: Effect.Effect<bigint>;
  readonly selectSnapshot: (at?: bigint) => Result.Result<CorePublishedSnapshot & Readonly<{ timestamp: bigint }>, CoreError>;
  /** Freeze current native data and retained history in one synchronous selection. */
  readonly selectNativeSnapshot: () => Result.Result<CorePublishedSnapshot & Readonly<{ timestamp: bigint; writeLog: CoreWriteLogSnapshot }>, CoreError>;
  readonly indexCache: CoreIndexCache;
  readonly currentRegistry: () => CoreRegistry;
  readonly publishCounts: (at:bigint,counts:CoreTableCounts) => Effect.Effect<boolean,CoreError>;
  readonly assertReady: Effect.Effect<void, CoreError>;
  /** Trusted request discovery only: accepted records remain unpublished and confer no body authority. */
  readonly pendingDocuments: (indexId: Uint8Array, interval: CoreInterval) => Effect.Effect<readonly CoreDocumentLogEntry[], CoreError>;
}

export const makeCoreCommitter = Effect.fn("CoreCommitter.make")(function* (
  persistence: CorePersistence,
  lease: CorePersistenceLease,
  initialTimestamp: bigint,
  initialRegistry: CoreRegistry,
  initialResident: CoreResidentIndexes,
  options: CoreDatabaseOptions,
  retention?: CoreRetentionValidator,
) {
  const config = yield* decodeCommitterConfig({ maxInflight: options.maxInflight ?? 512,
    maxConcurrentSaves: options.maxConcurrentSaves ?? 1, maxBatchDocuments: options.maxBatchDocuments ?? 64,
    maxBatchBytes: options.maxBatchBytes ?? 1 << 16, maxBatchDelayMilliseconds: options.maxBatchDelayMilliseconds ?? 1,
    batchWriteThreshold: options.batchWriteThreshold ?? 3, maxConcurrentPrevalidations: options.maxConcurrentPrevalidations ?? 32,
  }).pipe(Effect.mapError(cause => new CoreTransactionError({ reason: "invalidValue", cause })));
  const { maxInflight, maxConcurrentSaves, maxBatchDocuments, maxBatchBytes,
    maxBatchDelayMilliseconds, maxConcurrentPrevalidations } = config;
  const batchWriteThreshold = Math.min(maxConcurrentSaves, config.batchWriteThreshold);
  const mutex = yield* Semaphore.make(1);
  const saveSlots = yield* Semaphore.make(maxConcurrentSaves);
  const prevalidationSlots = yield* Semaphore.make(maxConcurrentPrevalidations);
  const ownerScope = yield* Effect.scope;
  const queue = yield* Queue.bounded<AcceptedCommit>(maxInflight);
  const log = new CoreWriteLog(initialTimestamp);
  const indexCache = yield* makeCoreIndexCache(options.indexCache ?? {}, Effect.sync(() => log.snapshot()));
  yield* Effect.addFinalizer(() => Effect.sync(() => { indexCache.close(); }));
  const pending = new CorePendingWrites();
  const accepted = new BTree<bigint, AcceptedCommit>();
  const snapshots = new BTree<bigint, CorePublishedSnapshot>([[initialTimestamp, { registry: initialRegistry, resident: initialResident }]]);
  let counts: CoreTableCounts | undefined;
  let registry = initialRegistry;
  let resident = initialResident;
  let published = initialTimestamp;
  let assigned = initialTimestamp;
  let jobs = 0;
  let activeSaves = 0;
  let stopped: Cause.Cause<CoreError> | undefined;

  const stop = (cause: Cause.Cause<CoreError>) => Effect.gen(function* () {
    if (stopped === undefined) stopped = cause;
    for (const [, commit] of accepted.entries()) {
      yield* Deferred.failCause(commit.durability.completion, stopped);
      yield* Deferred.failCause(commit.ack, stopped);
    }
    accepted.clear();
    jobs = 0;
  });

  const publishReady = Effect.gen(function* () {
    while (true) {
      const firstTs = accepted.minKey();
      const first = firstTs === undefined ? undefined : accepted.get(firstTs);
      if (first === undefined || first.result === undefined) return;
      if (Exit.isFailure(first.result)) {
        yield* stop(first.result.cause);
        return;
      }
      const nextRegistry = first.transaction.registryAfter === undefined ? registry : yield* Effect.fromResult(applyRegistryChanges(
        first.transaction, registry, first.timestamp,
      ));
      const countDelta=yield* Effect.fromResult(CoreTableCounts.changes(nextRegistry,first.transaction.changes));
      const nextCounts = counts === undefined ? undefined : yield* Effect.fromResult(counts.applyDelta(countDelta));
      const nextResident = yield* Effect.fromResult(resident.apply(nextRegistry, first.batch.documents));
      pending.pop(first.timestamp);
      log.append(first.timestamp, first.changes, batchBytes(first.batch), first.keyTransitions);
      indexCache.invalidate(first.batch, registry, nextRegistry);
      registry = nextRegistry;
      counts = nextCounts;
      resident = nextResident;
      published = first.timestamp;
      snapshots.set(published, Object.freeze({ registry, resident, countDelta, ...(counts === undefined ? {} : { counts }) }));
      // Retain a version until its successor has left the pinned 10-second window.
      while (snapshots.size > 1) {
        const oldest = snapshots.minKey();
        if (oldest === undefined) break;
        const successor = snapshots.nextHigherPair(oldest);
        if (successor === undefined || published - successor[0] <= 10_000_000_000n) break;
        snapshots.delete(oldest);
      }
      accepted.delete(first.timestamp);
      jobs -= 1;
      yield* Deferred.succeed(first.ack, first.timestamp);
    }
  }).pipe(Effect.catchCause(cause => Effect.andThen(stop(cause), Effect.failCause(cause))));

  const saveBatch = Effect.fn("CoreWriteBatcher.save")(function* (members: readonly AcceptedCommit[], permitHeld: boolean) {
    const batch: CoreWriteBatch = {
      documents: members.flatMap(member => member.batch.documents),
      indexes: members.flatMap(member => member.batch.indexes),
    };
    let ownsPermit = permitHeld;
    let saving = permitHeld;
    yield* Effect.ensuring(Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const result = yield* Effect.exit(Effect.gen(function* () {
        // A dependency wait owns neither a save permit nor a SQL transaction.
        // Same-batch predecessors settle atomically in this one fenced write.
        yield* restore(waitForDurability(externalPredecessors(members)));
        if (!ownsPermit) {
          yield* restore(saveSlots.take(1));
          ownsPermit = true;
          activeSaves += 1;
          saving = true;
        }
        if (stopped !== undefined) return yield* Effect.failCause(stopped);
        // Once foreign settlement starts, caller interruption cannot abandon it.
        yield* persistence.write(lease, batch);
      }));
      // Confirm actual persistence before publication, retaining every Cause.
      for (const member of members) {
        if (Exit.isFailure(result)) yield* Deferred.failCause(member.durability.completion, result.cause);
        else yield* Deferred.succeed(member.durability.completion, undefined);
      }
      yield* mutex.withPermits(1)(Effect.gen(function* () {
        if (stopped !== undefined) return;
        for (const member of members) member.result = result;
        if (Exit.isFailure(result)) yield* stop(result.cause);
        else yield* publishReady;
      }));
    })), Effect.gen(function* () {
      if (saving) activeSaves -= 1;
      if (ownsPermit) yield* saveSlots.release(1);
    }));
  });

  const saveLoop = Effect.fn("CoreWriteBatcher.run")(function* () {
    let lookahead: AcceptedCommit | undefined;
    while (true) {
      yield* saveSlots.take(1);
      let handedToSave = false;
      yield* Effect.ensuring(Effect.gen(function* () {
        const first = lookahead ?? (yield* Queue.take(queue));
        lookahead = undefined;
        if (stopped !== undefined) return;
        if (!(yield* readyToSave([first]))) {
          // Defer this FIFO singleton, never merge it into a later batch. This
          // keeps an independent queued commit out of its predecessor wait.
          yield* saveSlots.release(1);
          handedToSave = true;
          yield* Effect.forkIn(saveBatch([first], false), ownerScope);
          return;
        }
        const members = [first];
        let rows = first.batch.documents.length;
        let bytes = batchBytes(first.batch);
        // One batching owner, as upstream: existing saves determine whether to combine.
        if (activeSaves + 1 >= batchWriteThreshold) {
          const deadline = (yield* Clock.monotonicTimeNanos) + BigInt(maxBatchDelayMilliseconds) * 1_000_000n;
          while (rows < maxBatchDocuments && bytes < maxBatchBytes) {
            const remaining = deadline - (yield* Clock.monotonicTimeNanos);
            if (remaining <= 0n) break;
            const next = yield* Effect.timeoutOption(Queue.take(queue), Duration.nanos(remaining));
            if (Option.isNone(next)) break;
            if (!(yield* readyToSave([...members, next.value]))) {
              lookahead = next.value;
              break;
            }
            members.push(next.value);
            rows += next.value.batch.documents.length;
            bytes += batchBytes(next.value.batch);
          }
        }
        activeSaves += 1;
        handedToSave = true;
        yield* Effect.forkIn(saveBatch(members, true), ownerScope);
      }), Effect.gen(function* () { if (!handedToSave) yield* saveSlots.release(1); }));
      if (stopped !== undefined) return;
    }
  });

  yield* Effect.forkScoped(saveLoop());
  yield* Effect.addFinalizer(() => mutex.withPermits(1)(Effect.gen(function* () {
    yield* stop(Cause.fail(new CoreTransactionError({ reason: "unavailable" })));
    yield* Queue.shutdown(queue);
  })));

  const submit = Effect.fn("CoreCommitter.submit")(function* (transaction: CoreFinalizedState) {
    if (stopped !== undefined) return yield* Effect.failCause(stopped);
    if (transaction.changes.length === 0 && transaction.nativeObservations === undefined) return transaction.timestamp;
    if (jobs >= maxInflight) return yield* Effect.fail(new CoreTransactionError({ reason: "capacity" }));
    jobs += 1;
    let ownedBySave = false;
    const work = Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const groups = [
        ...(transaction.nativeObservations !== undefined && transaction.reads.length === 0 ? []
          : [{ timestamp: transaction.timestamp, reads: transaction.reads }]),
        ...transaction.nativeObservations?.dependencies ?? [],
      ];
      const indexes = transaction.nativeObservations?.indexes ?? [];
      const indexReads = indexes.map(observation => ({ indexId: observation.index.ref.id, intervals: [observation.interval] }));
      const checkDeadline = Effect.gen(function* () {
        const deadline = transaction.admissionDeadlineUnixMilliseconds;
        if (deadline !== undefined && (yield* Clock.currentTimeMillis) >= deadline)
          return yield* new CoreTransactionError({ reason: "admissionExpired" });
      });
      const ack = yield* Deferred.make<bigint, CoreError>();
      let noWritePredecessors: readonly DurableCommit[] | undefined;
      while (true) {
        // Every refresh uses the original dependency timestamps and admission
        // deadline. Only pure validation repeats; native callbacks never do.
        const prepared = yield* restore(prevalidationSlots.withPermits(1)(Effect.gen(function* () {
          yield* checkDeadline;
          const snapshot = log.snapshot();
          const publishedRegistry = registry;
          for (const group of groups) {
            const conflict = yield* Effect.fromResult(snapshot.conflict(group.reads, group.timestamp));
            if (conflict !== undefined) return yield* new CoreTransactionError({ reason: "conflict", cause: conflict });
          }
          const nativeIndexes = transaction.nativeObservations === undefined || indexes.length === 0 ? [] : yield* prepareCoreNativeIndexes(
            yield* persistence.readSnapshot(snapshot.timestamp, retention), publishedRegistry, indexes,
            transaction.nativeObservations.limits.maxIdentities);
          yield* Effect.yieldNow;
          return { timestamp: snapshot.timestamp, nativeIndexes };
        })));
        const acceptedHere = yield* mutex.withPermits(1)(Effect.gen(function* () {
          if (stopped !== undefined) return yield* Effect.failCause(stopped);
          yield* checkDeadline;
          const snapshot = log.snapshot();
          for (const group of groups) {
            const after = prepared.timestamp > group.timestamp ? prepared.timestamp : group.timestamp;
            const suffixConflict = yield* Effect.fromResult(snapshot.conflict(group.reads, after));
            const pendingConflict = pending.conflict(group.reads);
            if (suffixConflict !== undefined || pendingConflict !== undefined)
              return yield* new CoreTransactionError({ reason: "conflict", cause: suffixConflict ?? pendingConflict });
          }
          // A native index event invalidates preparation, rather than establishing a
          // conflict. Lost suffix history likewise needs fresh pure preparation.
          if (indexes.length > 0 && !Result.match(snapshot.conflict(indexReads, prepared.timestamp), {
            onFailure: () => false, onSuccess: conflict => conflict === undefined,
          })) return false;
          const now = yield* options.now;
          const timestamp = now > assigned ? now : assigned + 1n;
          if (timestamp < 0n || timestamp > 0x7fff_ffff_ffff_ffffn) return yield* new CoreTransactionError({ reason: "capacity" });
          const batch = yield* Effect.fromResult(deriveCoreWriteBatch(transaction, timestamp));
          const contributingBatches = transaction.nativeObservations === undefined ? new Set<CoreWriteBatch>()
            : yield* Effect.fromResult(validateCoreNativeIndexes(prepared.nativeIndexes,
            (function* () { for (const [, commit] of accepted.entries()) yield commit.batch; })(), batch,
            transaction.nativeObservations.limits.maxIdentities));
          const predecessors = [...accepted.values()].filter(commit => contributingBatches.has(commit.batch))
            .map(commit => commit.durability);
          if (batch.documents.length === 0) {
            yield* checkDeadline;
            noWritePredecessors = predecessors;
            return true;
          }
          const virtualKeys = yield* Effect.fromResult(metadataConflictKeys(transaction.registryAfter ?? transaction.registry, transaction.changes));
          const changes = [...indexKeysFromWrites(batch.indexes), ...virtualKeys];
          const keyTransitions = yield* Effect.fromResult(nativeIndexTransitions(transaction.registryAfter ?? transaction.registry, batch));
          const documents = new Map(batch.documents.map(document => [documentIdentity(document.tableId, document.id), document]));
          const indexEntries = new Map(batch.indexes.map(entry => [indexEntryIdentity(entry.index.id, entry.key), entry]));
          const durability = { timestamp, completion: yield* Deferred.make<void, CoreError>() };
          const commit: AcceptedCommit = { timestamp, transaction, batch, changes, keyTransitions, documents, indexEntries, ack,
            durability, predecessors };
          // The trusted profile's signed deadline governs acceptance, not save completion.
          yield* checkDeadline;
          pending.push(timestamp, changes);
          accepted.set(timestamp, commit);
          assigned = timestamp;
          ownedBySave = true;
          yield* Queue.offer(queue, commit);
          return true;
        }));
        if (acceptedHere) break;
      }
      if (noWritePredecessors !== undefined) {
        yield* restore(waitForDurability(noWritePredecessors));
        if (stopped !== undefined) return yield* Effect.failCause(stopped);
        yield* Deferred.succeed(ack, transaction.timestamp);
      }
      return yield* restore(Deferred.await(ack));
    }));
    return yield* Effect.ensuring(Effect.catchCause(work, cause => Effect.gen(function* () {
      if (cause.reasons.some(Cause.isDieReason)) yield* mutex.withPermits(1)(stop(cause));
      return yield* Effect.failCause(cause);
    })), Effect.sync(() => { if (!ownedBySave && jobs > 0) jobs -= 1; }));
  });
  return {
    submit,
    publishedTimestamp: Effect.sync(() => published),
    selectSnapshot: (at?: bigint): Result.Result<CorePublishedSnapshot & Readonly<{ timestamp: bigint }>, CoreError> => {
      const timestamp = at ?? published;
      if (timestamp < 0n || timestamp > published) return Result.fail(new CoreTransactionError({ reason: "invalidValue" }));
      const selected = snapshots.get(timestamp) ?? snapshots.nextLowerPair(timestamp)?.[1];
      return selected === undefined ? Result.fail(new CorePersistenceError({ reason: "outOfRetention" }))
        : Result.succeed({ timestamp, ...selected });
    },
    selectNativeSnapshot: (): Result.Result<CorePublishedSnapshot & Readonly<{ timestamp: bigint; writeLog: CoreWriteLogSnapshot }>, CoreError> => {
      const selected = snapshots.get(published);
      return selected === undefined ? Result.fail(new CorePersistenceError({ reason: "outOfRetention" }))
        : Result.succeed({ timestamp: published, ...selected, writeLog: log.snapshot() });
    },
    indexCache,
    currentRegistry: () => registry,
    publishCounts: (at:bigint, initialCounts:CoreTableCounts) => mutex.withPermits(1)(Effect.gen(function* () {
      if(stopped !== undefined) return yield* Effect.failCause(stopped);
      const base = snapshots.get(at) ?? snapshots.nextLowerPair(at)?.[1];
      if(base === undefined || at > published) return false;
      let current = initialCounts;
      for(const [ts, state] of snapshots.entries(at)) {
        if(ts > at) {
          const delta=state.countDelta;
          if(delta === undefined) return yield* Effect.die(new Error("Missing retained count publication delta"));
          current=yield* Effect.fromResult(current.applyDelta(delta));
        }
        snapshots.set(ts,Object.freeze({...state,counts:current}));
      }
      counts=current;
      return true;
    })),
    assertReady: Effect.suspend(() => stopped === undefined ? Effect.void : Effect.failCause(stopped)),
    pendingDocuments: (indexId: Uint8Array, interval: CoreInterval) => mutex.withPermits(1)(Effect.suspend(() => {
      if (stopped !== undefined) return Effect.failCause(stopped);
      const documents: CoreDocumentLogEntry[] = [];
      for (const reference of pending.range(indexId, interval, 2)) {
        const commit = accepted.get(reference.timestamp);
        const target = commit?.indexEntries.get(indexEntryIdentity(indexId, reference.key))?.value;
        if (target === null || target === undefined) continue;
        const document = commit?.documents.get(documentIdentity(target.tableId, target.documentId));
        if (document === undefined) return Effect.die(new Error("Pending index target is absent from its accepted write batch"));
        documents.push(document);
      }
      return Effect.succeed(documents);
    })),
  };
});

function documentIdentity(tableId: Uint8Array, id: Uint8Array): string {
  return `${encodeBytesToLowercaseHex(tableId)}:${encodeBytesToLowercaseHex(id)}`;
}

function indexEntryIdentity(indexId: Uint8Array, key: Uint8Array): string {
  return `${encodeBytesToLowercaseHex(indexId)}:${encodeBytesToLowercaseHex(key)}`;
}

/** Source-owned indexes need no native membership certificates or second retained key tree. */
function nativeIndexTransitions(registry: CoreRegistry, batch: CoreWriteBatch): Result.Result<readonly CoreIndexKeys[], CoreError> {
  return Result.gen(function* () {
    const selected = new Map<string, boolean>();
    const writes: CorePersistenceIndexEntry[] = [];
    for (const entry of batch.indexes) {
      const identity = encodeBytesToLowercaseHex(entry.index.id);
      let native = selected.get(identity);
      if (native === undefined) {
        const index = registry.indexById(entry.index.id);
        if (index === undefined) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
        native = index.table.nativePolicy?.state === "active";
        selected.set(identity, native);
      }
      if (native) writes.push(entry);
    }
    return indexTransitionsFromWrites(writes);
  });
}

const parseSchemaDocument=(document:import("flarex-protocol/document-value").DocumentObject):CoreSystemDocument=>{
      const {_id,_creationTime,...value}=document;
      if(typeof _id!=="string"||typeof _creationTime!=="number")throw new Error("Validated schema document lost intrinsic fields");
      return {id:_id,creationTime:_creationTime,value};
    };

function applyRegistryChanges(transaction:CoreFinalizedState,current:CoreRegistry,timestamp:bigint):Result.Result<CoreRegistry,CoreError> {
  return Result.gen(function*(){
    const base=transaction.registry,changes=transaction.registryAfter;
    if(changes === undefined)return current;
    let next=current;
    for(const record of changes.tables.values()) if(record.ts === null) next=next.withTable({...record,ts:timestamp});
    const removed=[...base.indexes.records.values()].filter(index=>!changes.indexes.records.has(encodeBytesToLowercaseHex(index.ref.id))).map(index=>index.ref.id);
    const added=[...changes.indexes.records.values()].filter(index=>index.ts===null).map(index=>({...index,ts:timestamp}));
    next=next.withIndexes(yield* current.indexes.apply({removed,added}));
    const schemaUpdates:CoreSchemaRegistryUpdate[]=[];
    for(const change of transaction.changes)if(change.table.name===SCHEMAS) schemaUpdates.push({namespace:change.table.namespace,
      ...(change.originalDocument===null?{}:{oldDocument:parseSchemaDocument(change.originalDocument)}),
      ...(change.finalDocument===null?{}:{newDocument:parseSchemaDocument(change.finalDocument)})});
    if(schemaUpdates.length>0)next=next.withSchemas(yield* current.schemas.apply(schemaUpdates));
    for(const [name,record]of changes.programs)if(base.programs.get(name)!==record)next=next.withProgram({...record,ts:timestamp});
    for(const [name,record]of changes.heads)if(base.heads.get(name)!==record)next=next.withHead({...record,ts:timestamp});
    if(changes.authority!==undefined&&changes.authority!==base.authority)next=next.withAuthority({...changes.authority,ts:timestamp});
    yield* checkCoreNativeRegistryTransition(next,current,changes);
    return next;
  });
}

function batchBytes(batch: CoreWriteBatch): number {
  let bytes = 0;
  for (const document of batch.documents) bytes += document.jsonValue.byteLength + 64;
  for (const index of batch.indexes) bytes += index.key.byteLength + 64;
  return bytes;
}

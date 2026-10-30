/**
 * Mechanisms translated from Convex crates/database/src/{committer,write_batcher,snapshot_manager}.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Cause, Clock, Deferred, Duration, Effect, Exit, Option, Queue, Schema, Semaphore } from "effect";
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CoreTransactionError, type CoreDatabaseOptions, type CoreError } from "./api";
import type { CoreDocumentLogEntry, CoreInterval, CorePersistence, CorePersistenceIndexEntry, CorePersistenceLease, CoreWriteBatch } from "./contracts";
import { CoreRegistry } from "./registry";
import { deriveCoreWriteBatch, type CoreFinalizedState } from "./transaction";
import { CorePendingWrites, CoreWriteLog, indexKeysFromWrites, type CoreIndexKeys } from "./writeLog";
import { metadataConflictKeys } from "./dependencies";

interface AcceptedCommit {
  readonly timestamp: bigint;
  readonly transaction: CoreFinalizedState;
  readonly batch: CoreWriteBatch;
  readonly changes: readonly CoreIndexKeys[];
  readonly documents: ReadonlyMap<string, CoreDocumentLogEntry>;
  readonly indexEntries: ReadonlyMap<string, CorePersistenceIndexEntry>;
  readonly ack: Deferred.Deferred<bigint, CoreError>;
  result?: Exit.Exit<void, CoreError>;
}

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
  readonly registryAt: (at: bigint) => CoreRegistry | undefined;
  readonly currentRegistry: () => CoreRegistry;
  readonly assertReady: Effect.Effect<void, CoreError>;
  /** Trusted request discovery only: accepted records remain unpublished and confer no body authority. */
  readonly pendingDocuments: (indexId: Uint8Array, interval: CoreInterval) => Effect.Effect<readonly CoreDocumentLogEntry[], CoreError>;
}

export const makeCoreCommitter = Effect.fn("CoreCommitter.make")(function* (
  persistence: CorePersistence,
  lease: CorePersistenceLease,
  initialTimestamp: bigint,
  initialRegistry: CoreRegistry,
  options: CoreDatabaseOptions,
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
  const pending = new CorePendingWrites();
  const accepted = new BTree<bigint, AcceptedCommit>();
  const snapshots = new BTree<bigint, CoreRegistry>([[initialTimestamp, initialRegistry]]);
  let registry = initialRegistry;
  let published = initialTimestamp;
  let assigned = initialTimestamp;
  let jobs = 0;
  let activeSaves = 0;
  let stopped: Cause.Cause<CoreError> | undefined;

  const stop = (cause: Cause.Cause<CoreError>) => Effect.gen(function* () {
    if (stopped === undefined) stopped = cause;
    for (const [, commit] of accepted.entries()) yield* Deferred.failCause(commit.ack, stopped);
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
      pending.pop(first.timestamp);
      log.append(first.timestamp, first.changes, batchBytes(first.batch));
      if (first.transaction.registryAfter !== undefined) registry = applyRegistryChanges(
        first.transaction.registry, first.transaction.registryAfter, registry, first.timestamp,
      );
      published = first.timestamp;
      snapshots.set(published, registry);
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
  });

  const saveBatch = Effect.fn("CoreWriteBatcher.save")(function* (members: readonly AcceptedCommit[]) {
    const batch: CoreWriteBatch = {
      documents: members.flatMap(member => member.batch.documents),
      indexes: members.flatMap(member => member.batch.indexes),
    };
    // Once foreign settlement starts, caller interruption cannot abandon it.
    const result = yield* Effect.exit(Effect.uninterruptible(persistence.write(lease, batch)));
    yield* mutex.withPermits(1)(Effect.gen(function* () {
      if (stopped !== undefined) return;
      for (const member of members) member.result = result;
      if (Exit.isFailure(result)) yield* stop(result.cause);
      else yield* publishReady;
    }));
  });

  const saveLoop = Effect.fn("CoreWriteBatcher.run")(function* () {
    while (true) {
      yield* saveSlots.take(1);
      let handedToSave = false;
      yield* Effect.ensuring(Effect.gen(function* () {
        const first = yield* Queue.take(queue);
        if (stopped !== undefined) return;
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
            members.push(next.value);
            rows += next.value.batch.documents.length;
            bytes += batchBytes(next.value.batch);
          }
        }
        activeSaves += 1;
        handedToSave = true;
        yield* Effect.forkIn(Effect.ensuring(saveBatch(members), Effect.gen(function* () {
          activeSaves -= 1;
          yield* saveSlots.release(1);
        })), ownerScope);
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
    if (transaction.changes.length === 0) return transaction.timestamp;
    if (jobs >= maxInflight) return yield* Effect.fail(new CoreTransactionError({ reason: "capacity" }));
    jobs += 1;
    let ownedBySave = false;
    const work = Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      // Frozen published-log prevalidation happens outside the ordering section.
      const validatedThrough = yield* restore(prevalidationSlots.withPermits(1)(Effect.gen(function* () {
        const snapshot = log.snapshot();
        const conflict = yield* Effect.fromResult(snapshot.conflict(transaction.reads, transaction.timestamp));
        if (conflict !== undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "conflict", cause: conflict }));
        yield* Effect.yieldNow;
        return snapshot.timestamp;
      })));
      const ack = yield* Deferred.make<bigint, CoreError>();
      yield* mutex.withPermits(1)(Effect.gen(function* () {
        if (stopped !== undefined) return yield* Effect.failCause(stopped);
        const suffixConflict = yield* Effect.fromResult(log.snapshot().conflict(transaction.reads, validatedThrough));
        const pendingConflict = pending.conflict(transaction.reads);
        if (suffixConflict !== undefined || pendingConflict !== undefined) return yield* Effect.fail(new CoreTransactionError({
          reason: "conflict", cause: suffixConflict ?? pendingConflict,
        }));
        const now = yield* options.now;
        const timestamp = now > assigned ? now : assigned + 1n;
        if (timestamp < 0n || timestamp > 0x7fff_ffff_ffff_ffffn) return yield* Effect.fail(new CoreTransactionError({ reason: "capacity" }));
        const batch = yield* Effect.fromResult(deriveCoreWriteBatch(transaction, timestamp));
        if (batch.documents.length === 0) {
          yield* Deferred.succeed(ack, transaction.timestamp);
          return;
        }
        const virtualKeys = yield* Effect.fromResult(metadataConflictKeys(transaction.registryAfter ?? transaction.registry, transaction.changes));
        const changes = [...indexKeysFromWrites(batch.indexes), ...virtualKeys];
        const documents = new Map(batch.documents.map(document => [documentIdentity(document.tableId, document.id), document]));
        const indexEntries = new Map(batch.indexes.map(entry => [indexEntryIdentity(entry.index.id, entry.key), entry]));
        const commit: AcceptedCommit = { timestamp, transaction, batch, changes, documents, indexEntries, ack };
        // The trusted profile's signed deadline governs acceptance, not save completion.
        // Keep this after every await/work preparation and immediately before pending ownership.
        const deadline = transaction.admissionDeadlineUnixMilliseconds;
        if (deadline !== undefined && (yield* Clock.currentTimeMillis) >= deadline)
          return yield* Effect.fail(new CoreTransactionError({ reason: "admissionExpired" }));
        pending.push(timestamp, changes);
        accepted.set(timestamp, commit);
        assigned = timestamp;
        ownedBySave = true;
        yield* Queue.offer(queue, commit);
      }));
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
    registryAt: (at: bigint) => {
      const exact = snapshots.get(at);
      return exact ?? snapshots.nextLowerPair(at)?.[1];
    },
    currentRegistry: () => registry,
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

function applyRegistryChanges(base: CoreRegistry, changes: CoreRegistry, current: CoreRegistry, timestamp: bigint): CoreRegistry {
  let next = current;
  for (const [name, record] of changes.tables) if (base.tables.get(name) !== record)
    next = next.withTable({ ...record, ts: timestamp });
  for (const [name, record] of changes.programs) if (base.programs.get(name) !== record)
    next = next.withProgram({ ...record, ts: timestamp });
  for (const [name, record] of changes.heads) if (base.heads.get(name) !== record)
    next = next.withHead({ ...record, ts: timestamp });
  if (changes.authority !== undefined && changes.authority !== base.authority)
    next = next.withAuthority({ ...changes.authority, ts: timestamp });
  return next;
}

function batchBytes(batch: CoreWriteBatch): number {
  let bytes = 0;
  for (const document of batch.documents) bytes += document.jsonValue.byteLength + 64;
  for (const index of batch.indexes) bytes += index.key.byteLength + 64;
  return bytes;
}

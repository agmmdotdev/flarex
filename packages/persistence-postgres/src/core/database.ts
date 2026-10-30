/**
 * Private outcome packing translated from Convex crates/model/src/session_requests/types.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318: JsonPackedValue is stored as an internal-JSON string.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Option, Result, Schema } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentValue, encodeDocumentValue, type DocumentObject, type DocumentValue } from "flarex-protocol/document-value";
import { encodeIndexValue } from "flarex-protocol/index-key";
import { CoreProgramIdentitySchema, CoreTransactionLimitsSchema, CoreTransactionError, issueCoreClaim, type CoreDatabase, type CoreDatabaseOptions, type CoreError,
  type CoreInstallation, type CoreProgramDefinition, type CoreRequestAcquisition,
  type CoreRequestClaim, type CoreRequestIdentity, type CoreRequestResolution, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreInterval, type CorePersistence } from "./contracts";
import { allocateInternalId, bootstrapCore, loadBootstrapRegistry } from "./bootstrap";
import { makeCoreCommitter } from "./committer";
import { INDEXES, PROGRAMS, REQUESTS, TABLES, loadCoreRegistry, programKey, readDocumentObject,
  tableDefinitionValue, tableDocument, validateTableDefinition, type CoreRegistry } from "./registry";
import { CoreFinalizationVault, createCoreTransaction, type CoreDocumentChange, type CoreFinalizedState,
  type CoreTransactionInternals } from "./transaction";
import { CORE_TRANSACTION_REFERENCE_LIMITS, CoreAccounting } from "./accounting";
import { captureCoreDocument, captureCoreObject } from "./document";
import { addTableWriteDependencies } from "./dependencies";
import { CoreReadSetBuilder } from "./writeLog";

const RequestRecordFields = { key: Schema.String, requestHash: Schema.String, program: CoreProgramIdentitySchema,
  leaseToken: Schema.BigInt };
const RequestRecord = Schema.Union([
  Schema.Struct({ ...RequestRecordFields, state: Schema.Literals(["claimed", "failed"]) }),
  Schema.Struct({ ...RequestRecordFields, state: Schema.Literal("committed"), result: Schema.String }),
]);
const decodeRequestRecord = Schema.decodeUnknownResult(RequestRecord);
const decodeProgramIdentity = Schema.decodeUnknownResult(CoreProgramIdentitySchema);
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
    if (index === undefined || !index.enabled) return yield* Result.fail(corrupt());
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
  const limits = yield* Schema.decodeUnknownEffect(CoreTransactionLimitsSchema)({
    ...CORE_TRANSACTION_REFERENCE_LIMITS, ...options.transactionLimits,
  }).pipe(Effect.mapError(invalid));
  const lease = yield* persistence.acquireLease();
  const initial = yield* bootstrapCore(persistence, lease, options);
  const committer = yield* makeCoreCommitter(persistence, lease, initial.timestamp, initial.registry, options);
  const vault = new CoreFinalizationVault();
  const claims = new WeakMap<CoreRequestClaim, ClaimData>();

  const start = Effect.fn("CoreDatabase.start")(function* (at?: bigint) {
    yield* committer.assertReady;
    const latest = yield* committer.publishedTimestamp;
    const timestamp = at ?? latest;
    if (timestamp < 0n || timestamp > latest) return yield* Effect.fail(invalid());
    const snapshot = yield* persistence.readSnapshot(timestamp);
    let registry = committer.registryAt(timestamp);
    if (registry === undefined) registry = yield* loadCoreRegistry(snapshot, yield* loadBootstrapRegistry(persistence, snapshot));
    return { timestamp, snapshot, registry };
  });

  const make = Effect.fn("CoreDatabase.transaction")(function* (at?: bigint, claim?: CoreRequestClaim) {
    const selected = yield* start(at);
    return { ...selected, context: createCoreTransaction({ snapshot: selected.snapshot, registry: selected.registry,
      now: yield* options.now, newInternalId: options.newInternalId, vault, limits, ...(claim === undefined ? {} : { claim }) }) };
  });

  const findRequest = Effect.fn("CoreDatabase.findRequest")(function* (
    selected: Effect.Success<ReturnType<typeof start>>, identity: CoreRequestIdentity, transaction?: CoreTransactionInternals,
  ) {
    const table = selected.registry.table(REQUESTS)?.definition;
    const index = table?.indexes.find(value => value.name === "by_key");
    if (table === undefined || index === undefined || !index.enabled) return yield* Effect.fail(corrupt());
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

  const install = Effect.fn("CoreDatabase.install")(function* (installation: CoreInstallation) {
    const selected = yield* make();
    let registry = selected.registry;
    const seenNumbers = new Set<number>();
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();
    for (const inputTable of installation.tables) {
      const table = yield* Effect.fromResult(validateTableDefinition(inputTable));
      if (table.number < 10000 || table.name.startsWith("_") || seenNumbers.has(table.number) || seenNames.has(table.name))
        return yield* Effect.fail(invalid());
      seenNumbers.add(table.number);
      seenNames.add(table.name);
      const existing = registry.table(table.name);
      const numberOwner = registry.tableByNumber(table.number);
      if (numberOwner !== undefined && numberOwner.definition.name !== table.name) return yield* Effect.fail(invalid());
      for (const record of registry.tables.values()) if (record.definition.name !== table.name
        && bytesEqual(record.definition.tabletId, table.tabletId)) return yield* Effect.fail(invalid());
      yield* Effect.fromResult(trackMetadataEquality(selected.context, registry, TABLES, "by_name", [table.name]));
      yield* Effect.fromResult(trackMetadataEquality(selected.context, registry, TABLES, "by_number", [table.number]));
      const indexes = [...table.indexes];
      for (const intrinsic of ["by_id", "by_creation_time"]) {
        const supplied = indexes.find(index => index.name === intrinsic);
        const expectedFields = intrinsic === "by_id" ? [] : ["_creationTime"];
        if (supplied !== undefined && (supplied.fields.join("\u0000") !== expectedFields.join("\u0000") || !supplied.enabled))
          return yield* Effect.fail(invalid());
        if (supplied === undefined) {
          const previous = existing?.definition.indexes.find(index => index.name === intrinsic);
          indexes.push(previous ?? { name: intrinsic, ref: { id: yield* allocateInternalId(options.newInternalId) }, fields: expectedFields, enabled: true });
        }
      }
      const definition: CoreTableDefinition = { ...table, indexes: Object.freeze(indexes) };
      for (const index of indexes) {
        const id = encodeBytesToLowercaseHex(index.ref.id);
        if (seenIds.has(id)) return yield* Effect.fail(invalid());
        seenIds.add(id);
        for (const other of registry.tables.values()) if (other.definition.name !== table.name
          && other.definition.indexes.some(candidate => bytesEqual(candidate.ref.id, index.ref.id)))
          return yield* Effect.fail(invalid());
      }
      if (existing !== undefined) {
        if (!bytesEqual(existing.definition.tabletId, definition.tabletId) || existing.definition.number !== definition.number)
          return yield* Effect.fail(invalid());
        const previous = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(tableDefinitionValue(existing.definition)), invalid));
        const next = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(tableDefinitionValue(definition)), invalid));
        if (bytesEqual(previous, next)) continue;
        {
          // Populated index/schema evolution needs the common backfill/staged-validation owner.
          const byId = existing.definition.indexes.find(index => index.name === "by_id");
          if (byId === undefined) return yield* Effect.fail(corrupt());
          selected.context.addIndexRead(byId.ref.id, { start: null, end: null });
          const page = yield* selected.snapshot.scan({ index: byId.ref, tableId: existing.definition.tabletId,
            interval: { start: null, end: null }, order: "asc", maxResults: 1 });
          if (page.entries.length !== 0) return yield* Effect.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
        }
        for (const oldIndex of existing.definition.indexes) if (!indexes.some(index => bytesEqual(index.ref.id, oldIndex.ref.id)))
          yield* selected.context.writePrivate(INDEXES, oldIndex.ref.id, null);
      }
      yield* selected.context.writePrivate(TABLES, definition.tabletId, tableDocument(definition));
      for (const index of indexes) yield* selected.context.writePrivate(INDEXES, index.ref.id, {
        name: index.name, tableNumber: definition.number, fields: [...index.fields], enabled: index.enabled,
        ...(index.ref.persistenceIndexId === undefined ? {} : { persistenceIndexId: index.ref.persistenceIndexId }),
      });
      registry = registry.withTable({ definition, id: definition.tabletId.slice(), ts: null });
    }
    for (const inputProgram of installation.programs) {
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
    if (installation.authorityEpoch !== undefined) {
      const authority = registry.authority;
      const epoch = installation.authorityEpoch;
      if (authority === undefined) return yield* Effect.fail(corrupt());
      if (epoch < authority.epoch || epoch > 0x7fff_ffff_ffff_ffffn) return yield* Effect.fail(invalid());
      if (epoch !== authority.epoch) {
        yield* selected.context.writePrivate(PROGRAMS, authority.id, { kind: "authority", epoch });
        registry = registry.withAuthority({ id: authority.id, epoch, ts: null });
      }
    }
    selected.context.setRegistryAfter(registry);
    yield* committer.submit(yield* consume(yield* selected.context.transaction.finalize()));
  });

  const readAuthorityEpoch = Effect.gen(function* () {
    yield* committer.assertReady;
    const authority = committer.currentRegistry().authority;
    if (authority === undefined) return yield* Effect.fail(corrupt());
    return authority.epoch;
  });

  const database: CoreDatabase = {
    install,
    selectProgram: Effect.fn("CoreDatabase.selectProgram")(function* (path) {
      yield* committer.assertReady;
      const registry = committer.currentRegistry();
      const head = registry.head(path);
      const program = head === undefined ? undefined : registry.program(head.identity);
      if (program === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "programUnavailable" }));
      return yield* Effect.fromResult(ownedProgram(program.definition));
    }),
    lookupProgram: Effect.fn("CoreDatabase.lookupProgram")(function* (identity) {
      yield* committer.assertReady;
      const program = committer.currentRegistry().program(identity);
      if (program === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "programUnavailable" }));
      return yield* Effect.fromResult(ownedProgram(program.definition));
    }),
    resolveRequest: Effect.fn("CoreDatabase.resolveRequest")(function* (identity) {
      return yield* Effect.fromResult(resolution(yield* findRequest(yield* start(), identity)));
    }),
    recoverRequest: Effect.fn("CoreDatabase.recoverRequest")(function* (identity) {
      const selected = yield* make();
      const record = yield* findRequest(selected, identity, selected.context);
      if (record === undefined || record.state !== "claimed") {
        yield* selected.context.transaction.abort();
        return yield* Effect.fromResult(resolution(record));
      }
      if (record.leaseToken === lease.token) {
        yield* selected.context.transaction.abort();
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
    }),
    claimRequest: Effect.fn("CoreDatabase.claimRequest")(function* (identity): Generator<Effect.Effect<unknown, CoreError>, CoreRequestAcquisition, unknown> {
      const selected = yield* make();
      const program = selected.registry.program(identity.program);
      if (program === undefined) return yield* Effect.fail(new CoreTransactionError({ reason: "programUnavailable" }));
      const existing = yield* findRequest(selected, identity, selected.context);
      if (existing !== undefined) {
        yield* selected.context.transaction.abort();
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
      const submitted = yield* Effect.result(committer.submit(finalized));
      return yield* Result.match(submitted, { onFailure: failure => Effect.gen(function* () {
        // Only this claim's proven nonacceptance can consult pending request data.
        // An accepted request is never retried or turned into another body claim.
        if (failure._tag !== "CoreTransactionError" || failure.reason !== "conflict") return yield* Effect.fail(failure);
        const byKey = table.indexes.find(index => index.name === "by_key");
        if (byKey === undefined || !byKey.enabled) return yield* Effect.fail(corrupt());
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
        return yield* Effect.fail(failure);
      }), onSuccess: timestamp => Effect.gen(function* () {
        const jsonValue = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(body.value), invalid));
        const claim = issueCoreClaim();
        claims.set(claim, { identity: { ...identity, program: { ...identity.program } }, active: true, record: {
          id, document: body.value, state: "claimed", leaseToken: lease.token, revision: { ts: timestamp, tableId: table.tabletId.slice(), id: id.slice(),
            jsonValue, deleted: false, prevTs: null },
        } });
        return { kind: "claimed" as const, claim };
      }) });
    }),
    begin: Effect.fn("CoreDatabase.begin")(function* (beginOptions = {}) {
      const claimData = beginOptions.claim === undefined ? undefined : claims.get(beginOptions.claim);
      if (beginOptions.claim !== undefined && (claimData === undefined || !claimData.active))
        return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
      if (claimData !== undefined && beginOptions.program !== undefined
        && programKey(claimData.identity.program) !== programKey(beginOptions.program))
        return yield* Effect.fail(new CoreTransactionError({ reason: "requestMismatch" }));
      const selected = yield* make(beginOptions.at, beginOptions.claim);
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
    }),
    commit: Effect.fn("CoreDatabase.commit")(function* (handle, commitOptions = {}) {
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
      if (claimData !== undefined) claimData.active = false;
      return timestamp;
    }),
    abortRequest: Effect.fn("CoreDatabase.abortRequest")(function* (claim) {
      const data = claims.get(claim);
      if (data === undefined || !data.active) return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
      const selected = yield* make();
      const current = yield* selected.context.readPrivate(REQUESTS, data.record.id);
      if (Option.isNone(current) || current.value.state !== "claimed") return yield* Effect.fail(new CoreTransactionError({ reason: "foreignClaim" }));
      yield* selected.context.writePrivate(REQUESTS, data.record.id, { ...withoutSystemFields(current.value), state: "failed" });
      yield* committer.submit(yield* consume(yield* selected.context.transaction.finalize()));
      data.active = false;
    }),
    publishedTimestamp: committer.publishedTimestamp,
    readAuthorityEpoch,
    advanceAuthorityEpoch: Effect.fn("CoreDatabase.advanceAuthorityEpoch")(function* (epoch) {
      const selected = yield* make();
      const authority = selected.registry.authority;
      if (authority === undefined) return yield* Effect.fail(corrupt());
      if (epoch < authority.epoch || epoch < 0n || epoch > 0x7fff_ffff_ffff_ffffn) return yield* Effect.fail(invalid());
      if (epoch === authority.epoch) { yield* selected.context.transaction.abort(); return; }
      yield* selected.context.writePrivate(PROGRAMS, authority.id, { kind: "authority", epoch });
      selected.context.setRegistryAfter(selected.registry.withAuthority({ id: authority.id, epoch, ts: null }));
      yield* committer.submit(yield* consume(yield* selected.context.transaction.finalize()));
    }),
  };
  return Object.freeze(database);
});

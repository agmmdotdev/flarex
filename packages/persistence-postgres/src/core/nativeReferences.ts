/** Optional-one native integrity over ordinary Source document/index state.
 * Preparation is deliberately separate from native first observations. */
import { Effect, Option, Result } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { compileIndexRange } from "flarex-protocol/index-range";
import type { DocumentObject } from "flarex-protocol/document-value";
import { CoreNativeReferenceError, CoreTransactionError, type CoreError, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreInterval, type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import { CoreAccounting, CORE_TRANSACTION_REFERENCE_LIMITS } from "./accounting";
import { captureCoreDocument } from "./document";
import { documentIndexKey } from "./documentIndex";
import { addIndexMetadataDependency, addTableWriteDependencies } from "./dependencies";
import { isCoreIndexEnabled } from "./indexState";
import { sameCoreNativeIdentity, type CoreNativeReference } from "./nativePolicy";
import { isCorePrivateTable, isCoreSystemTable } from "./nativeTableAccess";
import { coreNativeManyTargets, isCoreNativeManyReference, readCoreNativeMembership } from "./nativeReferenceProjection";
import { publicDocumentId, readDocumentObject, type CoreRegistry } from "./registry";
import type { CoreFinalizedState } from "./transaction";
import { CoreReadSetBuilder, keyInInterval, pointInterval, type CoreReadSet } from "./writeLog";

export interface CoreNativeReferenceSelection {
  readonly reference: CoreNativeReference;
  readonly source: CoreTableDefinition;
  readonly target: CoreTableDefinition;
  readonly index: CoreIndexDefinition;
  readonly projection?: Readonly<{ table: CoreTableDefinition; sourceIndex: CoreIndexDefinition }>;
}

/** The registry was authenticated by its schema owner. Recheck exact active endpoints/generation. */
export function selectCoreNativeReference(registry: CoreRegistry, owner: CoreTableDefinition,
  reference: CoreNativeReference): Result.Result<CoreNativeReferenceSelection, CoreError> {
  return Result.gen(function* () {
    const source = registry.table(reference.sourceTable, owner.namespace)?.definition;
    const target = registry.table(reference.targetTable, owner.namespace)?.definition;
    const policy = owner.nativePolicy;
    if (policy?.state !== "active" || source?.state !== "active" || target?.state !== "active"
      || source.nativePolicy?.state !== "active" || target.nativePolicy?.state !== "active"
      || !sameCoreNativeIdentity(policy.identity, source.nativePolicy.identity)
      || !sameCoreNativeIdentity(policy.identity, target.nativePolicy.identity)
      || source.nativePolicy.schemaId !== policy.schemaId || target.nativePolicy.schemaId !== policy.schemaId
      || !source.nativePolicy.references?.some(value => value.reference.name === reference.reference.name)
      || !target.nativePolicy.references?.some(value => value.reference.name === reference.reference.name))
      return yield* Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    const projection = isCoreNativeManyReference(reference)
      ? registry.table(reference.projection.tableName, owner.namespace)?.definition : undefined;
    if (isCoreNativeManyReference(reference) && (projection === undefined || projection.state !== "active"
      || !isCorePrivateTable(projection) || projection.nativePolicy?.state !== "active"
      || projection.nativePolicy.privateReference?.referenceName !== reference.reference.name
      || !sameCoreNativeIdentity(policy.identity, projection.nativePolicy.identity)
      || projection.nativePolicy.schemaId !== policy.schemaId || projection.nativePolicy.applicationRead))
      return yield* Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    const indexed = projection ?? source;
    const index = indexed.indexes.find(value => value.name === reference.indexName);
    const generation = index === undefined ? undefined : registry.indexes.records.get(encodeBytesToLowercaseHex(index.ref.id));
    if (index === undefined || generation === undefined || !isCoreIndexEnabled(generation)
      || !bytesEqual(generation.tableId, indexed.tabletId)
      || (projection === undefined ? index.fields.length !== 1 || index.fields[0] !== reference.field
        : index.fields.length !== 2 || index.fields[0] !== "targetId" || index.fields[1] !== "sourceId")
      || generation.ref.persistenceIndexId !== index.ref.persistenceIndexId)
      return yield* Result.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    if (projection === undefined || !isCoreNativeManyReference(reference)) return { reference, source, target, index };
    const sourceIndex = projection.indexes.find(value => value.name === reference.projection.bySourceIndex);
    const sourceGeneration = sourceIndex === undefined ? undefined : registry.indexes.records.get(encodeBytesToLowercaseHex(sourceIndex.ref.id));
    if (sourceIndex === undefined || sourceGeneration === undefined || !isCoreIndexEnabled(sourceGeneration)
      || !bytesEqual(sourceGeneration.tableId, projection.tabletId) || sourceIndex.fields.length !== 2
      || sourceIndex.fields[0] !== "sourceId" || sourceIndex.fields[1] !== "targetId"
      || sourceGeneration.ref.persistenceIndexId !== sourceIndex.ref.persistenceIndexId)
      return yield* Result.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    return { reference, source, target, index, projection: { table: projection, sourceIndex } };
  });
}

export function coreNativeReferenceInterval(selection: CoreNativeReferenceSelection, targetId: string): Result.Result<CoreInterval, CoreError> {
  return Result.mapError(compileIndexRange([{ op: "eq", field: selection.projection === undefined ? selection.reference.field : "targetId", value: targetId }], selection.index.fields),
    cause => new CoreTransactionError({ reason: "invalidValue", cause }));
}

/** Absence/null are the optional relation's only no-demand values. ID validity is independent of liveness. */
export function coreNativeReferenceTarget(selection: CoreNativeReferenceSelection, document: DocumentObject): Result.Result<string | null, CoreError> {
  if (isCoreNativeManyReference(selection.reference))
    return Result.fail(new CoreTransactionError({ reason: "documentValidation" }));
  const value = document[selection.reference.field];
  if (value === undefined || value === null) return Result.succeed(null);
  if (typeof value !== "string") return Result.fail(new CoreTransactionError({ reason: "documentValidation" }));
  return Result.flatMap(Result.mapError(decodeDocumentId(value), cause => new CoreTransactionError({ reason: "documentValidation", cause })),
    decoded => decoded.tableNumber === selection.target.number ? Result.succeed(value)
      : Result.fail(new CoreTransactionError({ reason: "documentValidation" })));
}

export function coreNativeReferenceTargets(selection: CoreNativeReferenceSelection, document: DocumentObject): Result.Result<readonly string[], CoreError> {
  return isCoreNativeManyReference(selection.reference)
    ? coreNativeManyTargets(selection.reference, selection.target, document)
    : Result.map(coreNativeReferenceTarget(selection, document), target => target === null ? [] : [target]);
}

export function coreNativeReferenceIndexTable(selection: CoreNativeReferenceSelection): CoreTableDefinition {
  return selection.projection?.table ?? selection.source;
}

function incomingSource(selection: CoreNativeReferenceSelection, document: DocumentObject): Result.Result<string, CoreError> {
  return selection.projection === undefined ? typeof document._id === "string" ? Result.succeed(document._id)
    : Result.fail(new CorePersistenceError({ reason: "corruptData" }))
    : Result.map(readCoreNativeMembership({ source: selection.source, target: selection.target, membership: selection.projection.table }, document), member => member.sourceId);
}

interface ReferenceDemand {
  readonly selection: CoreNativeReferenceSelection;
  readonly sourceId: string;
  readonly targetId: string;
  readonly targetInternalId: Uint8Array;
  readonly exists: boolean;
}
interface IncomingProbe {
  readonly selection: CoreNativeReferenceSelection;
  readonly targetId: string;
  readonly interval: CoreInterval;
  readonly entries: ReadonlyMap<string, string>;
}
export interface CorePreparedNativeReferences {
  readonly reads: CoreReadSet;
  readonly demands: readonly ReferenceDemand[];
  readonly incoming: readonly IncomingProbe[];
  readonly maxIdentities: number;
  readonly capturedIdentities?: readonly string[];
  readonly sourceCaptures?: readonly Readonly<{ tablets: readonly string[]; maxIdentities: number; identities: readonly string[] }>[];
}

export const prepareCoreNativeReferences = Effect.fn("CoreNativeReferences.prepare")(function* (
  snapshot: CorePersistenceSnapshot, registry: CoreRegistry, transaction: CoreFinalizedState,
) {
  const observations = transaction.nativeObservations;
  const reads = new CoreReadSetBuilder();
  const demands: ReferenceDemand[] = [], incoming: IncomingProbe[] = [];
  const maxIdentities = observations?.limits.maxIdentities ?? 0;
  const identities = new Set(observations?.identities ?? []);
  const sourceCaptures = observations?.sourceCaptures?.map(source => ({ ...source, captured: new Set(source.identities) })) ?? [];
  const limits = transaction.limits ?? CORE_TRANSACTION_REFERENCE_LIMITS;
  const accounting = new CoreAccounting(limits, transaction.usage);
  const queries = new CoreReadSetBuilder();
  const query = (index: CoreIndexDefinition, interval: CoreInterval) => {
    queries.add(index.ref.id, interval);
    return transaction.usage.databaseQueries + queries.intervalCount > limits.databaseQueries
      ? Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native reference query limit" })) : Result.succeed(undefined);
  };
  const charge = (table: CoreTableDefinition, entry: import("./contracts").CoreDocumentLogEntry) => Result.gen(function* () {
    const document = yield* readDocumentObject(entry, table);
    const captured = yield* Result.mapError(captureCoreDocument(document, isCoreSystemTable(table)), cause => new CorePersistenceError({ reason: "corruptData", cause }));
    yield* accounting.read(isCoreSystemTable(table), captured.semanticSizeBytes);
    return document;
  });
  const reserve = (table: CoreTableDefinition, id: string) => {
    identities.add(id);
    if (identities.size > maxIdentities) return Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native reference identity limit" }));
    const source = sourceCaptures.find(capture => capture.tablets.includes(encodeBytesToLowercaseHex(table.tabletId)));
    if (sourceCaptures.length > 0 && source === undefined) return Result.fail(new CoreTransactionError({ reason: "authorityRevoked" }));
    source?.captured.add(id);
    return source !== undefined && source.captured.size > source.limits.maxIdentities
      ? Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native source reference identity limit" })) : Result.succeed(undefined);
  };
  const demandKeys = new Map<string, boolean>();
  const probes = new Set<string>();
  if (observations !== undefined) for (const change of transaction.changes) {
    if (change.table.nativePolicy?.state !== "active") continue;
    const currentOwner = registry.tableByTablet(change.table.tabletId)?.definition;
    if (currentOwner === undefined) return yield* new CoreTransactionError({ reason: "authorityRevoked" });
    for (const reference of change.table.nativePolicy.references ?? []) {
      const selection = yield* Effect.fromResult(selectCoreNativeReference(registry, currentOwner, reference));
      yield* Effect.fromResult(addTableWriteDependencies(reads, registry, selection.source));
      yield* Effect.fromResult(addTableWriteDependencies(reads, registry, selection.target));
      if (selection.projection !== undefined)
        yield* Effect.fromResult(addTableWriteDependencies(reads, registry, selection.projection.table));
      yield* Effect.fromResult(addIndexMetadataDependency(reads, registry, selection.index));
      if (bytesEqual(change.table.tabletId, selection.source.tabletId) && change.finalDocument !== null) {
        for (const targetId of yield* Effect.fromResult(coreNativeReferenceTargets(selection, change.finalDocument))) {
          yield* Effect.fromResult(reserve(selection.target, targetId));
          const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(targetId), cause => new CoreTransactionError({ reason: "invalidDocumentId", cause })));
          const key = identity(selection.target.tabletId, decoded.internalId);
          let exists = demandKeys.get(key);
          const byId = selection.target.indexes.find(index => index.name === "by_id");
          if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
          const targetInterval = pointInterval(yield* Effect.fromResult(Result.mapError(encodeIndexKey([], targetId),
            cause => new CoreTransactionError({ reason: "invalidValue", cause }))));
          if (exists === undefined) {
            yield* Effect.fromResult(query(byId, targetInterval));
            const found = yield* snapshot.get(selection.target.tabletId, decoded.internalId);
            exists = Option.isSome(found) && !found.value.deleted;
            if (Option.isSome(found)) {
              if (!bytesEqual(found.value.tableId, selection.target.tabletId) || !bytesEqual(found.value.id, decoded.internalId))
                return yield* new CorePersistenceError({ reason: "corruptData" });
              if (!found.value.deleted) yield* Effect.fromResult(charge(selection.target, found.value));
            }
            demandKeys.set(key, exists);
          }
          reads.add(byId.ref.id, targetInterval);
          demands.push({ selection, sourceId: yield* Effect.fromResult(publicDocumentId(change.table, change.id)), targetId,
            targetInternalId: decoded.internalId, exists });
        }
      }
      if (bytesEqual(change.table.tabletId, selection.target.tabletId) && change.finalDocument === null) {
        const targetId = yield* Effect.fromResult(publicDocumentId(change.table, change.id));
        const probeKey = `${reference.reference.name}:${targetId}`;
        if (probes.has(probeKey)) continue;
        probes.add(probeKey);
        const interval = yield* Effect.fromResult(coreNativeReferenceInterval(selection, targetId));
        const entries = new Map<string, string>();
        let remaining = interval;
        while (true) {
          yield* Effect.fromResult(query(selection.index, remaining));
          const indexed = coreNativeReferenceIndexTable(selection);
          const page = yield* snapshot.scan({ tableId: indexed.tabletId, index: selection.index.ref,
            interval: remaining, order: "asc", maxResults: Math.min(128, maxIdentities + 1 - entries.size) });
          for (const entry of page.entries) {
            if (entry.document.deleted || !bytesEqual(entry.document.tableId, indexed.tabletId)
              || !keyInInterval(entry.key, remaining)) return yield* new CorePersistenceError({ reason: "corruptData" });
            const key = encodeBytesToLowercaseHex(entry.key);
            if (entries.has(key)) return yield* new CorePersistenceError({ reason: "corruptData" });
            const document = yield* Effect.fromResult(charge(indexed, entry.document));
            const id = yield* Effect.fromResult(incomingSource(selection, document));
            if ([...entries.values()].includes(id)) return yield* new CorePersistenceError({ reason: "corruptData", cause: "Duplicate native membership" });
            yield* Effect.fromResult(reserve(selection.source, id));
            if (selection.projection !== undefined) {
              const decoded = yield* Effect.fromResult(Result.mapError(decodeDocumentId(id), cause => new CorePersistenceError({ reason: "corruptData", cause })));
              const byId = selection.source.indexes.find(index => index.name === "by_id");
              if (byId === undefined) return yield* new CoreTransactionError({ reason: "indexUnavailable" });
              yield* Effect.fromResult(query(byId, pointInterval(yield* Effect.fromResult(Result.mapError(encodeIndexKey([], id),
                cause => new CorePersistenceError({ reason: "corruptData", cause }))))));
              const source = yield* snapshot.get(selection.source.tabletId, decoded.internalId);
              if (Option.isNone(source) || source.value.deleted)
                return yield* new CorePersistenceError({ reason: "corruptData", cause: "Orphan native membership" });
              if (!bytesEqual(source.value.tableId, selection.source.tabletId) || !bytesEqual(source.value.id, decoded.internalId))
                return yield* new CorePersistenceError({ reason: "corruptData" });
              const sourceDocument = yield* Effect.fromResult(charge(selection.source, source.value));
              if (!(yield* Effect.fromResult(Result.mapError(coreNativeReferenceTargets(selection, sourceDocument),
                cause => new CorePersistenceError({ reason: "corruptData", cause })))).includes(targetId))
                return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native membership differs from its source" });
            }
            if (!bytesEqual(yield* Effect.fromResult(documentIndexKey(selection.index, document)), entry.key))
              return yield* new CorePersistenceError({ reason: "corruptData" });
            entries.set(key, id);
          }
          if (page.cursor.kind === "end") break;
          const last = page.entries.at(-1);
          if (last === undefined || !bytesEqual(last.key, page.cursor.key)) return yield* new CorePersistenceError({ reason: "corruptData" });
          const start = new Uint8Array(last.key.length + 1); start.set(last.key);
          if (remaining.start !== null && compareBytesLexicographically(start, remaining.start) <= 0)
            return yield* new CorePersistenceError({ reason: "corruptData" });
          remaining = { start, end: interval.end };
        }
        // Only observed EOF certifies absence; preparation never uses a public page limit.
        reads.add(selection.index.ref.id, interval);
        incoming.push({ selection, targetId, interval, entries });
      }
    }
  }
  return { reads: reads.snapshot(), demands, incoming, maxIdentities, capturedIdentities: [...identities],
    sourceCaptures: sourceCaptures.map(source => ({ tablets: source.tablets, maxIdentities: source.limits.maxIdentities,
      identities: [...source.captured] })) } satisfies CorePreparedNativeReferences;
});

/** Fold the full accepted-unsaved prefix, then the whole candidate final overlay. */
export function validateCoreNativeReferences(prepared: CorePreparedNativeReferences, accepted: Iterable<CoreWriteBatch>,
  candidate: CoreWriteBatch): Result.Result<ReadonlySet<CoreWriteBatch>, CoreError> {
  return Result.gen(function* () {
    const batches = [...accepted], predecessors = new Set<CoreWriteBatch>();
    const captured = new Set(prepared.capturedIdentities ?? []);
    const sources = prepared.sourceCaptures?.map(source => ({ ...source, captured: new Set(source.identities) })) ?? [];
    const reserve = (table: CoreTableDefinition, id: string) => {
      captured.add(id);
      const source = sources.find(value => value.tablets.includes(encodeBytesToLowercaseHex(table.tabletId)));
      source?.captured.add(id);
      return captured.size > prepared.maxIdentities || source !== undefined && source.captured.size > source.maxIdentities
        ? Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native accepted reference identity limit" })) : Result.succeed(undefined);
    };
    for (const demand of prepared.demands) {
      let exists = demand.exists;
      let predecessor: CoreWriteBatch | undefined;
      for (const batch of batches) for (const document of batch.documents) {
        if (!bytesEqual(document.tableId, demand.selection.target.tabletId) || !bytesEqual(document.id, demand.targetInternalId)) continue;
        if (exists !== !document.deleted) predecessor = batch;
        exists = !document.deleted;
      }
      for (const document of candidate.documents) if (bytesEqual(document.tableId, demand.selection.target.tabletId)
        && bytesEqual(document.id, demand.targetInternalId)) { exists = !document.deleted; predecessor = undefined; }
      if (!exists) return yield* Result.fail(referenceError("relationTargetMissing", demand.selection, demand.sourceId, demand.targetId));
      if (predecessor !== undefined) predecessors.add(predecessor);
    }
    for (const probe of prepared.incoming) {
      const entries = new Map(probe.entries), removals = new Map<string, CoreWriteBatch>();
      const indexed = coreNativeReferenceIndexTable(probe.selection);
      const sourceFromBatch = (batch: CoreWriteBatch, value: NonNullable<CoreWriteBatch["indexes"][number]["value"]>) => Result.gen(function* () {
        if (!bytesEqual(value.tableId, indexed.tabletId)) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
        if (probe.selection.projection === undefined) return yield* publicDocumentId(probe.selection.source, value.documentId);
        const written = batch.documents.find(document => bytesEqual(document.tableId, indexed.tabletId)
          && bytesEqual(document.id, value.documentId));
        if (written === undefined || written.deleted) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
        const document = yield* readDocumentObject(written, indexed);
        const member = yield* readCoreNativeMembership({ source: probe.selection.source, target: probe.selection.target, membership: indexed }, document);
        if (member.targetId !== probe.targetId) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
        return member.sourceId;
      });
      for (const batch of batches) for (const entry of batch.indexes) {
        if (!bytesEqual(entry.index.id, probe.selection.index.ref.id) || !keyInInterval(entry.key, probe.interval)) continue;
        const key = encodeBytesToLowercaseHex(entry.key);
        if (entry.value === null) { if (entries.delete(key)) removals.set(key, batch); }
        else {
          const id = yield* sourceFromBatch(batch, entry.value);
          yield* reserve(probe.selection.source, id);
          entries.set(key, id); removals.delete(key);
        }
      }
      for (const entry of candidate.indexes) {
        if (!bytesEqual(entry.index.id, probe.selection.index.ref.id) || !keyInInterval(entry.key, probe.interval)) continue;
        const key = encodeBytesToLowercaseHex(entry.key);
        removals.delete(key);
        if (entry.value === null) entries.delete(key);
        else {
          const id = yield* sourceFromBatch(candidate, entry.value);
          yield* reserve(probe.selection.source, id);
          entries.set(key, id);
        }
      }
      if (entries.size > prepared.maxIdentities) return yield* Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native reference identity limit" }));
      if (new Set(entries.values()).size !== entries.size)
        return yield* Result.fail(new CorePersistenceError({ reason: "corruptData", cause: "Duplicate native membership" }));
      const sourceId = entries.values().next().value;
      if (sourceId !== undefined) return yield* Result.fail(referenceError("relationDeleteRestricted", probe.selection, sourceId, probe.targetId));
      for (const batch of removals.values()) predecessors.add(batch);
    }
    return predecessors;
  });
}

function identity(tableId: Uint8Array, id: Uint8Array): string {
  return `${encodeBytesToLowercaseHex(tableId)}:${encodeBytesToLowercaseHex(id)}`;
}
function referenceError(reason: CoreNativeReferenceError["reason"], selection: CoreNativeReferenceSelection, sourceId: string, targetId: string) {
  return new CoreNativeReferenceError({ reason, forwardName: selection.reference.declaration.source.forwardName,
    sourceTable: selection.source.name, targetTable: selection.target.name, sourceId, targetId });
}

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
import { publicDocumentId, readDocumentObject, type CoreRegistry } from "./registry";
import type { CoreFinalizedState } from "./transaction";
import { CoreReadSetBuilder, keyInInterval, pointInterval, type CoreReadSet } from "./writeLog";

export interface CoreNativeReferenceSelection {
  readonly reference: CoreNativeReference;
  readonly source: CoreTableDefinition;
  readonly target: CoreTableDefinition;
  readonly index: CoreIndexDefinition;
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
    const index = source.indexes.find(value => value.name === reference.indexName);
    const generation = index === undefined ? undefined : registry.indexes.records.get(encodeBytesToLowercaseHex(index.ref.id));
    if (index === undefined || generation === undefined || !isCoreIndexEnabled(generation)
      || !bytesEqual(generation.tableId, source.tabletId) || index.fields.length !== 1 || index.fields[0] !== reference.field
      || generation.ref.persistenceIndexId !== index.ref.persistenceIndexId)
      return yield* Result.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    return { reference, source, target, index };
  });
}

export function coreNativeReferenceInterval(selection: CoreNativeReferenceSelection, targetId: string): Result.Result<CoreInterval, CoreError> {
  return Result.mapError(compileIndexRange([{ op: "eq", field: selection.reference.field, value: targetId }], selection.index.fields),
    cause => new CoreTransactionError({ reason: "invalidValue", cause }));
}

/** Absence/null are the optional relation's only no-demand values. ID validity is independent of liveness. */
export function coreNativeReferenceTarget(selection: CoreNativeReferenceSelection, document: DocumentObject): Result.Result<string | null, CoreError> {
  const value = document[selection.reference.field];
  if (value === undefined || value === null) return Result.succeed(null);
  if (typeof value !== "string") return Result.fail(new CoreTransactionError({ reason: "documentValidation" }));
  return Result.flatMap(Result.mapError(decodeDocumentId(value), cause => new CoreTransactionError({ reason: "documentValidation", cause })),
    decoded => decoded.tableNumber === selection.target.number ? Result.succeed(value)
      : Result.fail(new CoreTransactionError({ reason: "documentValidation" })));
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
    const captured = yield* Result.mapError(captureCoreDocument(document, false), cause => new CorePersistenceError({ reason: "corruptData", cause }));
    yield* accounting.read(false, captured.semanticSizeBytes);
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
      yield* Effect.fromResult(addIndexMetadataDependency(reads, registry, selection.index));
      if (bytesEqual(change.table.tabletId, selection.source.tabletId) && change.finalDocument !== null) {
        const targetId = yield* Effect.fromResult(coreNativeReferenceTarget(selection, change.finalDocument));
        if (targetId !== null) {
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
          const page = yield* snapshot.scan({ tableId: selection.source.tabletId, index: selection.index.ref,
            interval: remaining, order: "asc", maxResults: Math.min(128, maxIdentities + 1 - entries.size) });
          for (const entry of page.entries) {
            if (entry.document.deleted || !bytesEqual(entry.document.tableId, selection.source.tabletId)
              || !keyInInterval(entry.key, remaining)) return yield* new CorePersistenceError({ reason: "corruptData" });
            const key = encodeBytesToLowercaseHex(entry.key);
            if (entries.has(key)) return yield* new CorePersistenceError({ reason: "corruptData" });
            const id = yield* Effect.fromResult(publicDocumentId(selection.source, entry.document.id));
            yield* Effect.fromResult(reserve(selection.source, id));
            const document = yield* Effect.fromResult(charge(selection.source, entry.document));
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
      for (const batch of batches) for (const entry of batch.indexes) {
        if (!bytesEqual(entry.index.id, probe.selection.index.ref.id) || !keyInInterval(entry.key, probe.interval)) continue;
        const key = encodeBytesToLowercaseHex(entry.key);
        if (entry.value === null) { if (entries.delete(key)) removals.set(key, batch); }
        else {
          if (!bytesEqual(entry.value.tableId, probe.selection.source.tabletId)) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
          const id = yield* publicDocumentId(probe.selection.source, entry.value.documentId);
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
          if (!bytesEqual(entry.value.tableId, probe.selection.source.tabletId)) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
          const id = yield* publicDocumentId(probe.selection.source, entry.value.documentId);
          yield* reserve(probe.selection.source, id);
          entries.set(key, id);
        }
      }
      if (entries.size > prepared.maxIdentities) return yield* Result.fail(new CoreTransactionError({ reason: "capacity", cause: "Native reference identity limit" }));
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

import { Effect, Result } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CoreTransactionError, type CoreError } from "./api";
import { CorePersistenceError, type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import type { CoreNativeIndexObservation } from "./nativeObservations";
import { publicDocumentId, type CoreRegistry } from "./registry";
import { isCoreIndexEnabled } from "./indexState";
import { keyInInterval } from "./writeLog";

/** Published full-key state, prepared outside the committer's ordering section. */
export interface CorePreparedNativeIndex {
  readonly observation: CoreNativeIndexObservation;
  readonly entries: ReadonlyMap<string, string>;
}

export const prepareCoreNativeIndexes = Effect.fn("CoreNativeValidation.prepare")(function* (
  snapshot: CorePersistenceSnapshot,
  registry: CoreRegistry,
  observations: readonly CoreNativeIndexObservation[],
  maxIdentities: number,
) {
  const prepared: CorePreparedNativeIndex[] = [];
  for (const observation of observations) {
    const { table, index } = observation;
    const captureLimit = Math.min(maxIdentities, observation.maxIdentities ?? maxIdentities);
    const currentTable = registry.tableByTablet(table.tabletId)?.definition;
    const currentIndex = registry.indexes.records.get(encodeBytesToLowercaseHex(index.ref.id));
    if (currentTable === undefined || currentTable.number !== table.number || currentTable.state !== "active"
      || currentIndex === undefined || !isCoreIndexEnabled(currentIndex)
      || !bytesEqual(currentIndex.tableId, table.tabletId)
      || currentIndex.ref.persistenceIndexId !== index.ref.persistenceIndexId
      || currentIndex.fields.length !== index.fields.length
      || currentIndex.fields.some((field, position) => field !== index.fields[position]))
      return yield* new CoreTransactionError({ reason: "conflict", cause: "Native index generation changed" });
    const entries = new Map<string, string>();
    let interval = observation.interval;
    while (true) {
      const page = yield* snapshot.scan({ tableId: table.tabletId, index: index.ref,
        interval, order: "asc", maxResults: Math.min(128, captureLimit + 1 - entries.size) });
      for (const entry of page.entries) {
        if (entry.document.deleted || !bytesEqual(entry.document.tableId, table.tabletId)
          || !keyInInterval(entry.key, interval))
          return yield* new CorePersistenceError({ reason: "corruptData" });
        const key = encodeBytesToLowercaseHex(entry.key);
        if (entries.has(key)) return yield* new CorePersistenceError({ reason: "corruptData" });
        entries.set(key,
          yield* Effect.fromResult(publicDocumentId(table, entry.document.id)));
        if (entries.size > captureLimit)
          return yield* new CoreTransactionError({ reason: "capacity", cause: {
            budget: "nativeIdentities", actual: entries.size, limit: captureLimit,
          } });
      }
      if (page.cursor.kind === "end") break;
      const key = page.cursor.key;
      if (!keyInInterval(key, interval)) return yield* new CorePersistenceError({ reason: "corruptData" });
      const start = new Uint8Array(key.length + 1);
      start.set(key);
      interval = { start, end: interval.end };
    }
    prepared.push({ observation, entries });
  }
  return prepared;
});

function applyBatch(slot: CoreNativeIndexObservation, entries: Map<string, string>,
  batch: CoreWriteBatch): Result.Result<boolean, CoreError> {
  return Result.gen(function* () {
    let touched = false;
    for (const entry of batch.indexes) {
      if (!bytesEqual(entry.index.id, slot.index.ref.id) || !keyInInterval(entry.key, slot.interval)) continue;
      touched = true;
      const key = encodeBytesToLowercaseHex(entry.key);
      if (entry.value === null) entries.delete(key);
      else {
        if (!bytesEqual(entry.value.tableId, slot.table.tabletId))
          return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
        entries.set(key, yield* publicDocumentId(slot.table, entry.value.documentId));
      }
    }
    return touched;
  });
}

/** Every accepted batch participates, including removals absent from request discovery. */
export function validateCoreNativeIndexes(prepared: readonly CorePreparedNativeIndex[],
  accepted: Iterable<CoreWriteBatch>, candidate: CoreWriteBatch, maxIdentities: number): Result.Result<ReadonlySet<CoreWriteBatch>, CoreError> {
  if (prepared.length === 0) return Result.succeed(new Set<CoreWriteBatch>());
  return Result.gen(function* () {
    // Materialize the iterable once: every slot must fold the complete ordered suffix.
    const batches = [...accepted];
    const predecessors = new Set<CoreWriteBatch>();
    for (const slot of prepared) {
      const captureLimit = Math.min(maxIdentities, slot.observation.maxIdentities ?? maxIdentities);
      const entries = new Map(slot.entries);
      for (const batch of batches) if (yield* applyBatch(slot.observation, entries, batch)) predecessors.add(batch);
      if (entries.size > captureLimit) return yield* Result.fail(new CoreTransactionError({ reason: "capacity", cause: {
        budget: "nativeIdentities", actual: entries.size, limit: captureLimit,
      } }));
      switch (slot.observation.kind) {
        case "unique": {
          const actual = new Set(entries.values());
          const expected = new Set(slot.observation.owners);
          if (actual.size !== expected.size || [...actual].some(owner => !expected.has(owner)))
            return yield* Result.fail(new CoreTransactionError({ reason: "conflict", cause: "Native unique owner changed" }));
          yield* applyBatch(slot.observation, entries, candidate);
          if (new Set(entries.values()).size > 1)
            return yield* Result.fail(new CoreTransactionError({ reason: "conflict", cause: "Native unique owner collision" }));
          break;
        }
        case "range": {
          if (entries.size !== slot.observation.members.length || slot.observation.members.some(member =>
            entries.get(encodeBytesToLowercaseHex(member.key)) !== member.id))
            return yield* Result.fail(new CoreTransactionError({ reason: "conflict", cause: "Native index membership changed" }));
          break;
        }
        default: {
          const unhandled: never = slot.observation;
          return yield* Result.fail(new CorePersistenceError({ reason: "corruptData", cause: unhandled }));
        }
      }
    }
    return predecessors;
  });
}

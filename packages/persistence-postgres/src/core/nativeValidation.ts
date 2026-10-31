import { Effect, Result } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CoreTransactionError, type CoreError } from "./api";
import { CorePersistenceError, type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import type { CoreNativeUniqueSlot } from "./nativeObservations";
import { publicDocumentId, type CoreRegistry } from "./registry";
import { isCoreIndexEnabled } from "./indexState";
import { keyInInterval } from "./writeLog";

/** Published full-key state, prepared outside the committer's ordering section. */
export interface CorePreparedNativeSlot {
  readonly observation: CoreNativeUniqueSlot;
  readonly entries: ReadonlyMap<string, string>;
}

export const prepareCoreNativeSlots = Effect.fn("CoreNativeValidation.prepare")(function* (
  snapshot: CorePersistenceSnapshot,
  registry: CoreRegistry,
  slots: readonly CoreNativeUniqueSlot[],
) {
  const prepared: CorePreparedNativeSlot[] = [];
  for (const observation of slots) {
    const { table, index } = observation;
    const currentTable = registry.tableByTablet(table.tabletId)?.definition;
    const currentIndex = registry.indexes.records.get(encodeBytesToLowercaseHex(index.ref.id));
    if (currentTable === undefined || currentTable.number !== table.number || currentTable.state !== "active"
      || currentIndex === undefined || !isCoreIndexEnabled(currentIndex)
      || !bytesEqual(currentIndex.tableId, table.tabletId)
      || currentIndex.ref.persistenceIndexId !== index.ref.persistenceIndexId
      || currentIndex.fields.length !== index.fields.length
      || currentIndex.fields.some((field, position) => field !== index.fields[position]))
      return yield* new CoreTransactionError({ reason: "conflict", cause: "Native unique index generation changed" });
    const entries = new Map<string, string>();
    let interval = observation.interval;
    while (true) {
      const page = yield* snapshot.scan({ tableId: table.tabletId, index: index.ref,
        interval, order: "asc", maxResults: 128 });
      for (const entry of page.entries) {
        if (entry.document.deleted || !bytesEqual(entry.document.tableId, table.tabletId)
          || !keyInInterval(entry.key, interval))
          return yield* new CorePersistenceError({ reason: "corruptData" });
        entries.set(encodeBytesToLowercaseHex(entry.key),
          yield* Effect.fromResult(publicDocumentId(table, entry.document.id)));
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

function applyBatch(slot: CoreNativeUniqueSlot, entries: Map<string, string>,
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
export function validateCoreNativeSlots(prepared: readonly CorePreparedNativeSlot[],
  accepted: Iterable<CoreWriteBatch>, candidate: CoreWriteBatch): Result.Result<ReadonlySet<CoreWriteBatch>, CoreError> {
  if (prepared.length === 0) return Result.succeed(new Set<CoreWriteBatch>());
  return Result.gen(function* () {
    // Materialize the iterable once: every slot must fold the complete ordered suffix.
    const batches = [...accepted];
    const predecessors = new Set<CoreWriteBatch>();
    for (const slot of prepared) {
      const entries = new Map(slot.entries);
      for (const batch of batches) if (yield* applyBatch(slot.observation, entries, batch)) predecessors.add(batch);
      const actual = new Set(entries.values());
      const expected = new Set(slot.observation.owners);
      if (actual.size !== expected.size || [...actual].some(owner => !expected.has(owner)))
        return yield* Result.fail(new CoreTransactionError({ reason: "conflict", cause: "Native unique owner changed" }));
      yield* applyBatch(slot.observation, entries, candidate);
      if (new Set(entries.values()).size > 1)
        return yield* Result.fail(new CoreTransactionError({ reason: "conflict", cause: "Native unique owner collision" }));
    }
    return predecessors;
  });
}

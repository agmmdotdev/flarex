import { Effect } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import type { CoreDatabase } from "../../src/core/api";
import type { CoreDocumentLogCursor, CoreInterval, CorePersistence } from "../../src/core/contracts";
import { readDocumentObject, REQUESTS } from "../../src/core/registry";
import { readCoreFixtureRegistry } from "./fixture";

export interface CoreNativeFixtureInventory {
  readonly rows: readonly Readonly<{ table: string; timestamp: bigint; value: DocumentObject }>[];
  readonly revisions: readonly Readonly<{ table: string; id: string; timestamp: bigint; previous: bigint | null;
    deleted: boolean; value: DocumentObject | null }>[];
  readonly indexes: readonly Readonly<{ table: string; name: string; key: string; id: string; timestamp: bigint }>[];
  readonly outcomes: readonly Readonly<{ timestamp: bigint; value: DocumentObject }>[];
}

/** Read evidence through the real registry and snapshot, without rebuilding any
 * schema readiness, constraint, dependency or publication logic in a fixture. */
export const readCoreNativeFixtureInventory = Effect.fn("CoreNativeFixture.inventory")(function* (
  database: CoreDatabase, persistence: CorePersistence,
): Effect.fn.Return<CoreNativeFixtureInventory, Effect.Error<ReturnType<typeof readCoreFixtureRegistry>>> {
  const timestamp = yield* database.publishedTimestamp;
  const registry = yield* readCoreFixtureRegistry({ persistence }, timestamp);
  const snapshot = yield* persistence.readSnapshot(timestamp);
  const rows: CoreNativeFixtureInventory["rows"][number][] = [];
  const revisions: CoreNativeFixtureInventory["revisions"][number][] = [];
  const indexes: CoreNativeFixtureInventory["indexes"][number][] = [];
  const outcomes: CoreNativeFixtureInventory["outcomes"][number][] = [];
  for (const { definition: table } of registry.tables.values()) {
    if (table.name.startsWith("_") && table.name !== REQUESTS) continue;
    for (const index of table.indexes) {
      let interval: CoreInterval = { start: null, end: null };
      while (true) {
        const page = yield* snapshot.scan({ tableId: table.tabletId, index: index.ref, interval, order: "asc", maxResults: 128 });
        for (const entry of page.entries) {
          if (table.name !== REQUESTS) indexes.push({ table: table.name, name: index.name,
            key: encodeBytesToLowercaseHex(entry.key), id: encodeBytesToLowercaseHex(entry.document.id), timestamp: entry.document.ts });
          if (index.name === "by_id") {
            const value = yield* Effect.fromResult(readDocumentObject(entry.document, table));
            if (table.name === REQUESTS) outcomes.push({ timestamp: entry.document.ts, value });
            else rows.push({ table: table.name, timestamp: entry.document.ts, value });
          }
        }
        if (page.cursor.kind === "end") break;
        const start = new Uint8Array(page.cursor.key.length + 1); start.set(page.cursor.key);
        interval = { start, end: null };
      }
    }
    if (table.name === REQUESTS) continue;
    let after: CoreDocumentLogCursor | undefined;
    while (true) {
      const page = yield* persistence.loadDocuments({ start: 0n, end: timestamp, order: "asc", maxResults: 128,
        tableId: table.tabletId, ...(after === undefined ? {} : { after }) });
      for (const entry of page.documents) revisions.push({ table: table.name, id: encodeBytesToLowercaseHex(entry.id),
        timestamp: entry.ts, previous: entry.prevTs, deleted: entry.deleted,
        value: entry.deleted ? null : yield* Effect.fromResult(readDocumentObject(entry, table)) });
      if (page.done) break;
      if (page.cursor === null) return yield* Effect.die(new Error("Nonterminal fixture history page has no cursor"));
      after = page.cursor;
    }
  }
  return { rows, revisions, indexes, outcomes: outcomes.toSorted((left, right) => left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0) };
});

export const coreNativeFixtureData = (inventory: CoreNativeFixtureInventory) => ({
  rows: inventory.rows, revisions: inventory.revisions, indexes: inventory.indexes,
});

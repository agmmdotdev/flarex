/** Native examined windows reuse Source consumed-prefix/EOF interval ownership. */
import { Effect } from "effect";
import { bytesEqual, compareBytesLexicographically } from "@flarex/utils/bytes";
import { indexRangeIsEmpty, splitIndexRangeAfter } from "flarex-protocol/index-range";
import { CoreTransactionError, type CoreError, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreHydratedIndexEntry, type CoreInterval } from "./contracts";
import type { CoreIndexSnapshot } from "./indexSnapshot";
import { copyInterval, keyInInterval } from "./writeLog";

/** One captured snapshot supplies the window and its extra non-EOF guard.
 * Cache prefetch can over-return; only the requested prefix and one guard enter
 * this bounded native result. No body observation or semantic read is issued. */
export const captureCoreNativeIndexWindow = Effect.fn("CoreNativePage.captureWindow")(function* (input: Readonly<{
  snapshot: CoreIndexSnapshot;
  table: CoreTableDefinition;
  index: CoreIndexDefinition;
  interval: CoreInterval;
  maxEntries: number;
  assertOpen: () => Effect.Effect<void, CoreError>;
}>) {
  if (!Number.isSafeInteger(input.maxEntries) || input.maxEntries < 1)
    return yield* new CoreTransactionError({ reason: "invalidValue" });
  const collected: CoreHydratedIndexEntry[] = [];
  let remaining = copyInterval(input.interval);
  let complete = false;
  while (collected.length <= input.maxEntries && !complete) {
    const page = yield* input.snapshot.scan({ tableId: input.table.tabletId, index: input.index.ref,
      interval: remaining, order: "asc", maxResults: input.maxEntries + 1 - collected.length });
    yield* input.assertOpen();
    const previousLength = collected.length;
    for (const entry of page.entries) {
      if (collected.length > input.maxEntries) break;
      const previous = collected.at(-1);
      if (entry.document.deleted || !bytesEqual(entry.document.tableId, input.table.tabletId)
        || !keyInInterval(entry.key, remaining)
        || previous !== undefined && compareBytesLexicographically(previous.key, entry.key) >= 0)
        return yield* new CorePersistenceError({ reason: "corruptData" });
      collected.push(entry);
    }
    if (collected.length > input.maxEntries) break;
    if (page.cursor.kind === "end") { complete = true; break; }
    const last = collected.at(-1);
    if (last === undefined || collected.length === previousLength || !bytesEqual(page.cursor.key, last.key))
      return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native page did not advance" });
    const split = splitIndexRangeAfter({ start: remaining.start ?? new Uint8Array(), end: remaining.end }, last.key, "asc");
    if (indexRangeIsEmpty(split.observed))
      return yield* new CorePersistenceError({ reason: "corruptData", cause: "Native page did not consume a prefix" });
    remaining = split.remaining;
  }
  const entries = Object.freeze(collected.slice(0, input.maxEntries));
  const last = entries.at(-1);
  if (complete) return Object.freeze({ entries, isDone: true, observed: copyInterval(input.interval),
    cursor: null, examined: entries.length });
  if (last === undefined) return yield* new CorePersistenceError({ reason: "corruptData" });
  const observed = splitIndexRangeAfter({ start: input.interval.start ?? new Uint8Array(), end: input.interval.end }, last.key, "asc").observed;
  return Object.freeze({ entries, isDone: false, observed, cursor: last.key.slice(), examined: entries.length + 1 });
});

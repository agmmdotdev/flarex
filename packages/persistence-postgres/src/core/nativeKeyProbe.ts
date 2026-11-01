/** Shared bounded native-key membership capture. Ordinary index state remains
 * authoritative; bodies are retained only for declared liveness predicates. */
import { Effect, Result } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import { type CoreError, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreInterval, type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import { documentIndexKey } from "./documentIndex";
import { publicDocumentId, readDocumentObject } from "./registry";
import { keyInInterval } from "./writeLog";

export interface CoreNativeKeyProbe {
  readonly table: CoreTableDefinition;
  readonly index: CoreIndexDefinition;
  readonly interval: CoreInterval;
  readonly entries: ReadonlyMap<string, string>;
  readonly documents?: ReadonlyMap<string, DocumentObject>;
}

export const captureCoreNativeKeyProbe = Effect.fn("CoreNativeKeyProbe.capture")(function* (input: Readonly<{
  snapshot: CorePersistenceSnapshot; table: CoreTableDefinition; index: CoreIndexDefinition; interval: CoreInterval;
  maxIdentities: number;
  chargeQuery: (interval: CoreInterval) => Result.Result<void, CoreError>;
  chargeDocument: (id: string, document: DocumentObject) => Result.Result<void, CoreError>;
}>) {
  const entries = new Map<string, string>(), documents = new Map<string, DocumentObject>();
  let remaining = input.interval;
  while (true) {
    yield* Effect.fromResult(input.chargeQuery(remaining));
    const page = yield* input.snapshot.scan({ tableId: input.table.tabletId, index: input.index.ref, interval: remaining,
      order: "asc", maxResults: Math.min(128, input.maxIdentities + 1 - entries.size) });
    for (const entry of page.entries) {
      if (entry.document.deleted || !bytesEqual(entry.document.tableId, input.table.tabletId) || !keyInInterval(entry.key, remaining))
        return yield* new CorePersistenceError({ reason: "corruptData" });
      const id = yield* Effect.fromResult(publicDocumentId(input.table, entry.document.id));
      const document = yield* Effect.fromResult(readDocumentObject(entry.document, input.table));
      yield* Effect.fromResult(input.chargeDocument(id, document));
      if (!bytesEqual(yield* Effect.fromResult(documentIndexKey(input.index, document)), entry.key))
        return yield* new CorePersistenceError({ reason: "corruptData" });
      const key = encodeBytesToLowercaseHex(entry.key);
      if (entries.has(key)) return yield* new CorePersistenceError({ reason: "corruptData" });
      entries.set(key, id); documents.set(key, document);
    }
    if (page.cursor.kind === "end") break;
    const last = page.entries.at(-1);
    if (last === undefined || !bytesEqual(last.key, page.cursor.key)) return yield* new CorePersistenceError({ reason: "corruptData" });
    const start = new Uint8Array(last.key.length + 1); start.set(last.key);
    if (remaining.start !== null && compareBytesLexicographically(start, remaining.start) <= 0)
      return yield* new CorePersistenceError({ reason: "corruptData" });
    remaining = { start, end: input.interval.end };
  }
  return { table: input.table, index: input.index, interval: input.interval, entries, documents } satisfies CoreNativeKeyProbe;
});

export interface CoreNativeKeyState {
  readonly entries: ReadonlyMap<string, string>;
  readonly origins: ReadonlyMap<string, CoreWriteBatch>;
  readonly removals: ReadonlySet<CoreWriteBatch>;
}

/** Only actual final contributors become durability prerequisites. A liveness
 * predicate is native policy, applied equally to committed and accepted rows. */
export function foldCoreNativeKeyProbe(probe: CoreNativeKeyProbe, accepted: readonly CoreWriteBatch[], candidate: CoreWriteBatch,
  reserve: (table: CoreTableDefinition, id: string) => Result.Result<void, CoreError>,
  eligible?: (document: DocumentObject) => boolean): Result.Result<CoreNativeKeyState, CoreError> {
  return Result.gen(function* () {
    const entries = new Map<string, string>(), origins = new Map<string, CoreWriteBatch>(), removals = new Map<string, CoreWriteBatch>();
    for (const [key, id] of probe.entries) {
      if (eligible === undefined) entries.set(key, id);
      else {
        const document = probe.documents?.get(key);
        if (document === undefined) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
        if (eligible(document)) entries.set(key, id);
      }
    }
    const apply = (batch: CoreWriteBatch, own: boolean) => Result.gen(function* () {
      for (const entry of batch.indexes) {
        if (!bytesEqual(entry.index.id, probe.index.ref.id) || !keyInInterval(entry.key, probe.interval)) continue;
        const key = encodeBytesToLowercaseHex(entry.key);
        let member: string | undefined;
        if (entry.value !== null) {
          const value = entry.value;
          if (!bytesEqual(value.tableId, probe.table.tabletId)) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
          const id = yield* publicDocumentId(probe.table, value.documentId);
          yield* reserve(probe.table, id);
          if (eligible === undefined) member = id;
          else {
            const written = batch.documents.find(document => bytesEqual(document.tableId, probe.table.tabletId)
              && bytesEqual(document.id, value.documentId));
            if (written === undefined || written.deleted) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
            const document = yield* readDocumentObject(written, probe.table);
            if (eligible(document)) member = id;
          }
        }
        if (member === undefined) {
          const removed = entries.has(key);
          entries.delete(key); origins.delete(key);
          if (own) removals.delete(key); else if (removed) removals.set(key, batch);
        } else {
          const existing = entries.get(key);
          entries.set(key, member); removals.delete(key);
          if (own) origins.delete(key); else if (existing !== member) origins.set(key, batch);
        }
      }
    });
    for (const batch of accepted) yield* apply(batch, false);
    yield* apply(candidate, true);
    return { entries, origins, removals: new Set(removals.values()) };
  });
}

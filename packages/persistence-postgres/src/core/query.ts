/**
 * Stream/Limit mechanisms translated from Convex crates/database/src/query/{index_range,limit}.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Effect, Option, Result } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { indexRangeIsEmpty, splitIndexRangeAfter } from "flarex-protocol/index-range";
import { CoreTransactionError, type CoreError, type CoreIndexDefinition, type CoreQuery,
  type CoreQueryPage, type CoreTableDefinition } from "./api";
import type { CoreHydratedIndexEntry, CoreIndexCursor, CoreInterval, CoreOrder } from "./contracts";
import { captureCoreDocument } from "./document";
import type { CoreIndexSnapshot } from "./indexSnapshot";
import { readDocumentObject } from "./registry";
import { copyInterval, keyInInterval } from "./writeLog";

const invalid = (cause?: unknown) => new CoreTransactionError({ reason: "invalidValue", cause });
const boundedInterval = (interval: CoreInterval) => ({ start: interval.start ?? new Uint8Array(), end: interval.end });
const copyPosition = (position: CoreIndexCursor | null): CoreIndexCursor | null => position?.kind === "after"
  ? Object.freeze({ kind: "after", key: position.key.slice() }) : position;

/** Complete physical consumption for the bounded native profile, before pending masking.
 * This is not logical Limit exhaustion and does not itself record semantic reads. */
export const captureCoreIndexRange = Effect.fn("CoreQuery.captureIndexRange")(function* (input: Readonly<{
  snapshot: CoreIndexSnapshot;
  table: CoreTableDefinition;
  index: CoreIndexDefinition;
  interval: CoreInterval;
  maxEntries: number;
  assertOpen: () => Effect.Effect<void, CoreError>;
}>) {
  const entries: CoreHydratedIndexEntry[] = [];
  let remaining = copyInterval(input.interval);
  while (true) {
    const page = yield* input.snapshot.scan({ index: input.index.ref, tableId: input.table.tabletId,
      interval: remaining, order: "asc", maxResults: Math.min(128, input.maxEntries + 1 - entries.length) });
    yield* input.assertOpen();
    entries.push(...page.entries);
    if (entries.length > input.maxEntries) return yield* new CoreTransactionError({ reason: "capacity",
      cause: "Native complete index capture limit" });
    if (page.cursor.kind === "end") return Object.freeze(entries);
    const progress = splitIndexRangeAfter(boundedInterval(remaining), page.cursor.key, "asc");
    if (indexRangeIsEmpty(progress.observed)) return yield* invalid("Persistence scan did not advance");
    remaining = progress.remaining;
  }
});

/** The transaction supplies the sole operation owner and live pending index; no SQL transaction survives a call. */
export function createCoreQuery(input: Readonly<{
  snapshot: CoreIndexSnapshot;
  table: CoreTableDefinition;
  index: CoreIndexDefinition;
  interval: CoreInterval;
  order: CoreOrder;
  limit?: number;
  queryFingerprint: Uint8Array;
  initialPosition?: CoreIndexCursor;
  pendingIndex: () => BTree<Uint8Array, DocumentObject | null> | undefined;
  recordRead: (interval: CoreInterval) => Result.Result<void, CoreTransactionError>;
  chargeDocument: (document: DocumentObject, semanticSizeBytes: number) => Result.Result<void, CoreTransactionError>;
  assertOpen: () => Effect.Effect<void, CoreError>;
  operation: <A>(effect: Effect.Effect<A, CoreError>) => Effect.Effect<A, CoreError>;
}>): CoreQuery {
  const initialInterval = copyInterval(input.interval);
  let remaining = initialInterval;
  let position: CoreIndexCursor | null = copyPosition(input.initialPosition ?? null);
  let buffer: Readonly<{ coverage: CoreInterval; cursor: CoreIndexCursor;
    documents: readonly Readonly<{ key: Uint8Array; document: DocumentObject }>[] }> | undefined;
  let emitted = 0;
  let closed = false;
  let failure: CoreError | undefined;
  let done = input.initialPosition?.kind === "end" || input.limit === 0;

  const result = (documents: readonly DocumentObject[]): CoreQueryPage => Object.freeze({
    documents: Object.freeze(documents), position: copyPosition(position), done,
  });

  const next = Effect.fn("CoreQuery.nextPage")(function* (options: Parameters<CoreQuery["nextPage"]>[0]) {
    if (closed) return yield* Effect.fail(new CoreTransactionError({ reason: "closed" }));
    if (failure !== undefined) return yield* Effect.fail(failure);
    if (!Number.isSafeInteger(options.maxResults) || options.maxResults < 0
      || !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0) return yield* Effect.fail(invalid());
    const pageOverflow=(nextPosition:CoreIndexCursor|null,encodedBytes:number,semanticBytes:number)=>
      queryPageOverflow(options,nextPosition,encodedBytes,semanticBytes);
    const documents: DocumentObject[] = [];
    let candidates: Array<Readonly<{ key: Uint8Array; document: DocumentObject }>> | undefined;
    let bytes = 2; // JSON array brackets; each document uses the authoritative internal JSON encoding.
    let semanticBytes = 2; // The authoritative value owner charges two bytes for the array itself.
    const initialOverflow = yield* Effect.fromResult(pageOverflow(position, bytes, semanticBytes));
    if (Option.isSome(initialOverflow)) return yield* Effect.fail(initialOverflow.value);
    const finish = Effect.gen(function* () {
      const nextPosition: CoreIndexCursor = Object.freeze({ kind: "end" });
      const overflow = yield* Effect.fromResult(pageOverflow(nextPosition, bytes, semanticBytes));
      if (Option.isSome(overflow)) {
        if (documents.length !== 0) return;
        return yield* Effect.fail(overflow.value);
      }
      yield* Effect.fromResult(input.recordRead(initialInterval));
      position = nextPosition;
      done = true;
    });
    while (!done && documents.length < options.maxResults) {
      if (input.limit !== undefined && emitted >= input.limit) { done = true; break; }
      if (indexRangeIsEmpty(boundedInterval(remaining))) {
        yield* finish;
        break;
      }
      if (buffer === undefined) {
        const page = yield* input.snapshot.scan({ index: input.index.ref, tableId: input.table.tabletId,
          interval: remaining, order: input.order, maxResults: Math.min(128, options.maxResults - documents.length,
            input.limit === undefined ? Number.MAX_SAFE_INTEGER : input.limit - emitted) });
        yield* input.assertOpen();
        const coverage = page.cursor.kind === "end" ? remaining
          : splitIndexRangeAfter(boundedInterval(remaining), page.cursor.key, input.order).observed;
        if (page.cursor.kind !== "end" && indexRangeIsEmpty(boundedInterval(coverage)))
          return yield* Effect.fail(invalid("Persistence scan did not advance"));
        const decoded: Array<Readonly<{ key: Uint8Array; document: DocumentObject }>> = [];
        for (const entry of page.entries) decoded.push(Object.freeze({ key: entry.key.slice(),
          document: yield* Effect.fromResult(readDocumentObject(entry.document, input.table)) }));
        buffer = { coverage: copyInterval(coverage), cursor: page.cursor, documents: decoded };
      }

      // Rebuild from current pending writes, including changes made between pages.
      // Physical prefetch coverage remains separate from the consumed read frontier.
      if (candidates === undefined) {
        const merged = new BTree<Uint8Array, DocumentObject | null>(undefined, compareBytesLexicographically);
        const pending = input.pendingIndex();
        for (const entry of buffer.documents) if (keyInInterval(entry.key, remaining)) {
          const current = pending?.get(entry.key);
          merged.set(entry.key, current === undefined ? entry.document : current);
        }
        const pendingEntries = input.order === "asc" ? pending?.entries(remaining.start ?? undefined)
          : pending?.entriesReversed(remaining.end ?? undefined);
        let pendingCount = 0;
        if (pendingEntries !== undefined) for (const [key, document] of pendingEntries) {
          if (input.order === "asc" && buffer.coverage.end !== null
            && compareBytesLexicographically(key, buffer.coverage.end) >= 0) break;
          if (input.order === "desc" && buffer.coverage.start !== null
            && compareBytesLexicographically(key, buffer.coverage.start) < 0) break;
          if (document !== null && keyInInterval(key, remaining) && keyInInterval(key, buffer.coverage)) {
            merged.set(key, document);
            pendingCount += 1;
            if (pendingCount >= options.maxResults - documents.length) break;
          }
        }
        const entries = input.order === "asc" ? merged.entries() : merged.entriesReversed();
        candidates = [];
        for (const [key, document] of entries) if (document !== null) candidates.push({ key, document });
      }
      const selected = candidates.shift();
      if (selected === undefined) {
        if (buffer.cursor.kind === "end") {
          yield* finish;
          break;
        } else {
          remaining = splitIndexRangeAfter(boundedInterval(remaining), buffer.cursor.key, input.order).remaining;
          buffer = undefined;
          candidates = undefined;
        }
        continue;
      }
      const measured = yield* Effect.fromResult(Result.mapError(captureCoreDocument(selected.document, false), invalid));
      const encoded = yield* Effect.fromResult(Result.mapError(encodeDocumentValue(measured.value), invalid));
      const nextPosition: CoreIndexCursor = Object.freeze({ kind: "after", key: selected.key.slice() });
      const nextBytes = bytes + encoded.byteLength + (documents.length === 0 ? 0 : 1);
      const nextSemanticBytes = semanticBytes + measured.semanticSizeBytes;
      const overflow = yield* Effect.fromResult(pageOverflow(nextPosition, nextBytes, nextSemanticBytes));
      if (Option.isSome(overflow)) {
        if (documents.length !== 0) break;
        return yield* Effect.fail(overflow.value);
      }
      yield* Effect.fromResult(input.chargeDocument(measured.value, measured.semanticSizeBytes));
      yield* Effect.fromResult(input.recordRead(splitIndexRangeAfter(boundedInterval(initialInterval), selected.key, input.order).observed));
      remaining = splitIndexRangeAfter(boundedInterval(remaining), selected.key, input.order).remaining;
      position = nextPosition;
      emitted += 1;
      bytes = nextBytes;
      semanticBytes = nextSemanticBytes;
      documents.push(measured.value);
      if (input.limit !== undefined && emitted >= input.limit) done = true;
    }
    return result(documents);
  });

  return Object.freeze({
    get queryFingerprint() { return input.queryFingerprint.slice(); },
    nextPage: (options: Parameters<CoreQuery["nextPage"]>[0]) => input.operation(next(options).pipe(Effect.tapError(error => Effect.sync(() => { failure ??= error; })))),
    close: () => input.operation(Effect.sync(() => { closed = true; buffer = undefined; })),
  });
}

function queryPageOverflow(options:Parameters<CoreQuery["nextPage"]>[0],nextPosition:CoreIndexCursor|null,encodedBytes:number,semanticBytes:number):Result.Result<Option.Option<CoreTransactionError>,CoreTransactionError> {
      const size = options.positionSize?.(copyPosition(nextPosition)) ?? { encodedBytes: 0, semanticBytes: 0 };
      if (!Number.isSafeInteger(size.encodedBytes) || size.encodedBytes < 0
        || !Number.isSafeInteger(size.semanticBytes) || size.semanticBytes < 0) return Result.fail(invalid());
      const totalBytes = encodedBytes + size.encodedBytes;
      if (totalBytes > options.maxBytes) return Result.succeed(Option.some(new CoreTransactionError({
        reason: "capacity", cause: { budget: "queryPageBytes", actual: totalBytes, limit: options.maxBytes },
      })));
      const totalSemanticBytes = semanticBytes + size.semanticBytes;
      if (totalSemanticBytes > options.maxBytes) return Result.succeed(Option.some(new CoreTransactionError({
        reason: "capacity", cause: { budget: "queryPageSemanticBytes", actual: totalSemanticBytes, limit: options.maxBytes },
      })));
      return Result.succeed(Option.none());
}

/** An absent table is an empty source; the transaction already captured its full mapping dependency. */
export function createCoreEmptyQuery(input:Readonly<{
  queryFingerprint:Uint8Array;initialPosition?:CoreIndexCursor;limit?:number;
  operation:<A>(effect:Effect.Effect<A,CoreError>)=>Effect.Effect<A,CoreError>;
}>):CoreQuery {
  let position:CoreIndexCursor|null=copyPosition(input.initialPosition??null);
  let done=input.initialPosition?.kind==="end"||input.limit===0,closed=false;
  let failure:CoreError|undefined;
  const next=Effect.fn("CoreEmptyQuery.nextPage")(function*(options:Parameters<CoreQuery["nextPage"]>[0]){
    if(closed)return yield* new CoreTransactionError({reason:"closed"});
    if(failure!==undefined)return yield* failure;
    if(!Number.isSafeInteger(options.maxResults)||options.maxResults<0||!Number.isSafeInteger(options.maxBytes)||options.maxBytes<0)return yield* invalid();
    const initial=yield* Effect.fromResult(queryPageOverflow(options,position,2,2));
    if(Option.isSome(initial))return yield* initial.value;
    if(!done&&options.maxResults>0){
      const end:CoreIndexCursor={kind:"end"};
      const final=yield* Effect.fromResult(queryPageOverflow(options,end,2,2));
      if(Option.isSome(final))return yield* final.value;
      position=end;done=true;
    }
    return Object.freeze({documents:Object.freeze([]),position:copyPosition(position),done});
  });
  return Object.freeze({get queryFingerprint(){return input.queryFingerprint.slice();},
    nextPage:(options:Parameters<CoreQuery["nextPage"]>[0])=>input.operation(next(options).pipe(Effect.tapError(error=>Effect.sync(()=>{failure??=error;})))),
    close:()=>input.operation(Effect.sync(()=>{closed=true;}))});
}

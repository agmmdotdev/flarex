/** Convex database_index_workers/index_writer + bootstrap_model/index_backfills at db914cf06.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md). */
import { Effect, Result, Schema, Stream } from "effect";
import { bytesEqual } from "@flarex/utils/bytes";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";
import { CorePersistenceError, CoreTimestampSchema, type CoreDocumentLogEntry, type CorePersistence,
  type CorePersistenceIndexEntry, type CorePersistenceLease } from "./contracts";
import { coreIndexWriteMode, type CoreIndexRecord } from "./indexState";
import { documentIndexKey } from "./documentIndex";
import { readDocumentObject } from "./registry";
import type { CoreTableDefinition, CoreError } from "./api";

const Counter = Schema.BigInt.check(Schema.makeFilter(value => value >= 0n && value <= 0x7fff_ffff_ffff_ffffn
  ? undefined : "Expected a source signed-int64 progress counter"));
export const CoreIndexBackfillMetadataSchema = Schema.Struct({
  indexId: DeveloperDocumentIdSchema, numDocsIndexed: Counter, totalDocs: Schema.NullOr(Counter),
  cursor: Schema.NullOr(Schema.Struct({ snapshotTs: CoreTimestampSchema, cursor: Schema.NullOr(DeveloperDocumentIdSchema) })),
});
export type CoreIndexBackfillMetadata = typeof CoreIndexBackfillMetadataSchema.Type;
export const decodeCoreIndexBackfillMetadata = Schema.decodeUnknownResult(CoreIndexBackfillMetadataSchema);

/** Source deliberately does not write even a cursor when both count views are unknown. */
export function advanceCoreIndexBackfillProgress(metadata: CoreIndexBackfillMetadata, additional: bigint,
  cursor: typeof DeveloperDocumentIdSchema.Type | null, knownCount: bigint | null): Result.Result<CoreIndexBackfillMetadata, CorePersistenceError> {
  const totalDocs = metadata.totalDocs ?? knownCount;
  if (totalDocs === null) return Result.succeed(metadata);
  return Result.mapError(decodeCoreIndexBackfillMetadata({ ...metadata, totalDocs,
    numDocsIndexed: metadata.numDocsIndexed + additional,
    cursor: metadata.cursor === null ? null : { ...metadata.cursor, cursor } }), cause =>
    new CorePersistenceError({ reason: "corruptData", cause }));
}

/** Snapshot backfill revision pairs intentionally have no previous body. */
export function coreIndexBackfillEntries(table: CoreTableDefinition, indexes: readonly CoreIndexRecord[],
  documents: readonly CoreDocumentLogEntry[]): Result.Result<readonly CorePersistenceIndexEntry[], CoreError> {
  return Result.gen(function* () {
    const entries: CorePersistenceIndexEntry[] = [];
    for (const document of documents) {
      if (document.deleted || !bytesEqual(document.tableId, table.tabletId)) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
      const value = yield* readDocumentObject(document, table);
      for (const index of indexes) {
        if (!bytesEqual(index.tableId, table.tabletId)) return yield* Result.fail(new CorePersistenceError({ reason: "corruptData" }));
        const key = yield* documentIndexKey(index, value);
        entries.push({ mode: coreIndexWriteMode(index), ts: document.ts, index: index.ref, key,
          value: { tableId: table.tabletId, documentId: document.id }, prev: null });
      }
    }
    return entries;
  });
}

/** Ordered buffered completions: no checkpoint can cover an unconfirmed earlier physical chunk. */
export const writeCoreIndexBackfillChunks = Effect.fn("CoreIndexBackfill.writeChunks")(function* (options: Readonly<{
  persistence: Pick<CorePersistence, "writeIndexBackfill">; lease: CorePersistenceLease; table: CoreTableDefinition;
  indexes: readonly CoreIndexRecord[]; documents: readonly CoreDocumentLogEntry[];
  chunkDocuments: number; concurrency: number;
  checkpoint: (chunk: readonly CoreDocumentLogEntry[]) => Effect.Effect<void, CoreError>;
}>) {
  if (!Number.isSafeInteger(options.chunkDocuments) || options.chunkDocuments <= 0
    || !Number.isSafeInteger(options.concurrency) || options.concurrency <= 0)
    return yield* Effect.fail(new CorePersistenceError({ reason: "invalidTarget" }));
  const chunks: (readonly CoreDocumentLogEntry[])[] = [];
  for (let offset = 0; offset < options.documents.length; offset += options.chunkDocuments)
    chunks.push(options.documents.slice(offset, offset + options.chunkDocuments));
  yield* Stream.fromIterable(chunks).pipe(Stream.mapEffect(chunk => Effect.gen(function* () {
    const entries = yield* Effect.fromResult(coreIndexBackfillEntries(options.table, options.indexes, chunk));
    if (entries.length > 0) yield* options.persistence.writeIndexBackfill(options.lease, entries);
    return chunk;
  }), { concurrency: options.concurrency }), Stream.runForEach(options.checkpoint));
});

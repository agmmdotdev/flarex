import { Effect, Option, Result } from "effect";
import { and, asc, eq, inArray } from "drizzle-orm";
import { appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { fxSystemCommitAppRowChanges } from "../schema";
import { readBindingActiveReferenceProjection, readBindingHeadProjection } from "../frameworkSchema/binding/repository";
import { ScopePublicationCorruptionError, ScopePublicationSqlFailure, type ScopePublicationClock, type ScopePublicationOptions } from "./scopePublicationModel";
import { validateStrongReferenceFinalState } from "./strongReferenceValidation";

/** All row publishers pass this shared gate after lowering and before clock
 * advancement. Only the authenticated final transaction state is inspected. */
export const requireStrongReferencePublication = Effect.fn("ScopePublication.requireStrongReferences")(
  function* (tx: FlarexMetadataTransaction, clock: ScopePublicationClock,
    commitSeq: CommitSeq, options: ScopePublicationOptions = {}) {
    const head = yield* readBindingHeadProjection(tx, clock.record, query =>
      options.observeQuery?.({ name: "readBindingHead", ...query })).pipe(Effect.mapError(cause =>
      cause.reason === "resourceFailure"
        ? new ScopePublicationSqlFailure({ operation: "readBindingHead", cause })
        : new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid", cause })));
    if (Option.isNone(head)) {
      if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "counts", owner: "references", counts: { endpoints: 0, affectedRows: 0 } });
      return;
    }
    const endpoints = head.value.frame.strongReferenceTableIds.map(id => CatalogTableIdSchema.make(id));
    if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "counts", owner: "references", counts: { endpoints: endpoints.length } });
    if (endpoints.length === 0) return;
    // The committed fact prefix is the publisher's authenticated row set.
    // Commerce appends these facts in pages while its contribution has no row
    // intents, so admission must inspect the finished prefix, not its input.
    const query = tx.select({ tableId: fxSystemCommitAppRowChanges.tableId })
      .from(fxSystemCommitAppRowChanges)
      .where(and(eq(fxSystemCommitAppRowChanges.scopeUuid, clock.scopeUuid),
        eq(fxSystemCommitAppRowChanges.commitSeq, commitSeq),
        inArray(fxSystemCommitAppRowChanges.tableId, endpoints)))
      .limit(1);
    options.observeQuery?.({ name: "readStrongReferenceFacts", ...query.toSQL() });
    const rows = yield* Effect.tryPromise({
      try: () => query,
      catch: cause => new ScopePublicationSqlFailure({ operation: "readStrongReferenceFacts", cause }),
    });
    if (rows.length === 0) {
      if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "counts", owner: "references", counts: { affectedRows: 0 } });
      return;
    }
    const references = yield* readBindingActiveReferenceProjection(tx, clock.record, head.value)
      .pipe(Effect.mapError(cause => cause.reason === "resourceFailure"
        ? new ScopePublicationSqlFailure({ operation: "readStrongReferenceProjection", cause })
        : new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid", cause })));
    const facts = tx.select({ tableId: fxSystemCommitAppRowChanges.tableId,
      rowId: fxSystemCommitAppRowChanges.rowId })
      .from(fxSystemCommitAppRowChanges)
      .where(and(eq(fxSystemCommitAppRowChanges.scopeUuid, clock.scopeUuid),
        eq(fxSystemCommitAppRowChanges.epochUuid, clock.epochUuid),
        eq(fxSystemCommitAppRowChanges.commitSeq, commitSeq),
        inArray(fxSystemCommitAppRowChanges.tableId, endpoints)))
      .orderBy(asc(fxSystemCommitAppRowChanges.changeOrdinal)).limit(16_001);
    options.observeQuery?.({ name: "readStrongReferenceFullFacts", ...facts.toSQL() });
    const affected = yield* Effect.tryPromise({ try: () => facts,
      catch: cause => new ScopePublicationSqlFailure({ operation: "readStrongReferenceFullFacts", cause }) });
    if (affected.length > 16_000) return yield* Effect.fail(new ScopePublicationCorruptionError({
      reason: "publicationInvariantInvalid", cause: "reference fact prefix exceeds the commit limit",
    }));
    if (options.publicationObservation?.detail) options.publicationObservation.record({ kind: "counts", owner: "references", counts: { affectedRows: affected.length } });
    const changes = yield* Effect.forEach(affected, fact => Effect.fromResult(
      appRowIdHexV1FromBytesResult(fact.rowId).pipe(Result.mapError(cause =>
        new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid", cause })))).pipe(
      Effect.map(rowId => ({ tableId: fact.tableId, rowId }))));
    if (new Set(changes.map(change => `${change.tableId}/${change.rowId}`)).size !== changes.length)
      return yield* Effect.fail(new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid",
        cause: "reference endpoint has duplicate row facts" }));
    yield* validateStrongReferenceFinalState(tx, clock.record, commitSeq, references, changes);
  },
);

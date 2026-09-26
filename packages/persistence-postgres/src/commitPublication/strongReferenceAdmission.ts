import { Effect, Option } from "effect";
import { and, eq, inArray } from "drizzle-orm";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import { fxSystemCommitAppRowChanges } from "../schema";
import { readBindingHeadProjection } from "../frameworkSchema/binding/repository";
import { ScopePublicationCorruptionError, ScopePublicationSqlFailure, ScopePublicationUnsupportedProfileError, type ScopePublicationClock, type ScopePublicationOptions } from "./scopePublicationModel";

/** All row publishers pass this shared gate after lowering and before clock
 * advancement. Until runtime enforcement exists, every affected endpoint
 * remains closed, including legacy Application point commits. */
export const requireStrongReferencePublication = Effect.fn("ScopePublication.requireStrongReferences")(
  function* (tx: FlarexMetadataTransaction, clock: ScopePublicationClock,
    commitSeq: CommitSeq, options: ScopePublicationOptions = {}) {
    const head = yield* readBindingHeadProjection(tx, clock.record, query =>
      options.observeQuery?.({ name: "readBindingHead", ...query })).pipe(Effect.mapError(cause =>
      cause.reason === "resourceFailure"
        ? new ScopePublicationSqlFailure({ operation: "readBindingHead", cause })
        : new ScopePublicationCorruptionError({ reason: "publicationInvariantInvalid", cause })));
    if (Option.isNone(head)) return;
    const endpoints = head.value.frame.strongReferenceTableIds.map(id => CatalogTableIdSchema.make(id));
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
    if (rows.length !== 0)
      return yield* Effect.fail(new ScopePublicationUnsupportedProfileError({ reason: "strongReferenceUnenforced" }));
  },
);

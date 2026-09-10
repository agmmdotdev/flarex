import { Effect } from "effect";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { runOwnedPromise } from "../ownedPromise";
import { ScopePublicationCorruptionError, ScopePublicationResourceError, ScopePublicationSqlFailure } from "../commitPublication/scopePublicationModel";
import { commerceError, type CommerceTransactionError } from "./model";

/** Preserve the shared publisher's categories at this Commerce-owned bridge. */
export const publishCommerceAtoms = Effect.fn("CommerceCommit.publishAtoms")(<Value>(
  work: (signal: AbortSignal) => Promise<Value>,
): Effect.Effect<Value, CommerceTransactionError> => runOwnedPromise(work, cause => cause).pipe(
  // oxlint-disable-next-line flarex/prefer-tagged-effect-recovery -- REVIEW: compatibility - classifies the complete unknown shared-publisher rejection channel and preserves unexpected causes as defects
  Effect.catch(cause => {
    if (cause instanceof ScopePublicationCorruptionError) return Effect.fail(commerceError("storedCorruption", cause));
    if (cause instanceof ScopePublicationResourceError) return Effect.fail(commerceError("resourceFailure", cause));
    // The existing relational-fact atom rejects with the persistence driver's
    // raw query error; keep its supported SQL category at this foreign seam.
    if (cause instanceof ScopePublicationSqlFailure || cause instanceof DrizzleQueryError) return Effect.fail(commerceError("statementFailure", cause));
    return Effect.die(cause);
  }),
));

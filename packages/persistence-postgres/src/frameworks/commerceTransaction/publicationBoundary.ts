import { Cause, Effect } from "effect";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { runOwnedPromise } from "../../values/ownedPromise";
import { ScopePublicationCorruptionError, ScopePublicationReferenceCapacityError, ScopePublicationReferenceConstraintError,
  ScopePublicationResourceError, ScopePublicationSqlFailure, ScopePublicationUnsupportedProfileError } from "../../commit/publication/scopePublicationModel";
import { commerceError, type CommerceTransactionError } from "./model";

function projectCommercePublicationFailure(cause: unknown): CommerceTransactionError | undefined {
    if (cause instanceof ScopePublicationUnsupportedProfileError) return commerceError("unsupportedProfile", cause);
    if (cause instanceof ScopePublicationReferenceConstraintError) return commerceError("invalidInput", cause);
    if (cause instanceof ScopePublicationReferenceCapacityError) return commerceError("limitExceeded", cause);
    if (cause instanceof ScopePublicationCorruptionError) return commerceError("storedCorruption", cause);
    if (cause instanceof ScopePublicationResourceError) return commerceError("resourceFailure", cause);
    // The existing relational-fact atom rejects with the persistence driver's
    // raw query error; keep its supported SQL category at this foreign seam.
    if (cause instanceof ScopePublicationSqlFailure || cause instanceof DrizzleQueryError) return commerceError("statementFailure", cause);
    return undefined;
}
/** Project every typed reason without dropping sibling defects/interruption.
 * Unknown foreign rejections retain the established defect classification. */
export const acceptCommercePublication = <Value, Failure>(work: Effect.Effect<Value, Failure>): Effect.Effect<Value, CommerceTransactionError> => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.fromReasons(cause.reasons.map(reason => {
    if (!Cause.isFailReason(reason)) return reason;
    const failure = projectCommercePublicationFailure(reason.error);
    const projected = failure === undefined ? Cause.makeDieReason(reason.error) : Cause.makeFailReason(failure);
    return projected.annotate(Cause.reasonAnnotations(reason));
  })))),
);
export const publishCommerceAtoms = Effect.fn("CommerceCommit.publishAtoms")(<Value>(
  work: (signal: AbortSignal) => Promise<Value>,
): Effect.Effect<Value, CommerceTransactionError> => acceptCommercePublication(runOwnedPromise(work, cause => cause)));

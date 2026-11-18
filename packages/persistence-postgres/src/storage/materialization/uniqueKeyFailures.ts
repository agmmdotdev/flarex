import type {
  Effect,
} from "effect";
import type {
  prepareAppUniqueCanonicalMutationApplicationEffect,
  applyPreparedAppUniqueMutationApplicationEffect,
} from "../unique/appUniqueKeys";
import {
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  CanonicalAppUniqueKeyHashCollisionError,
  AppUniqueKeyPersistenceError,
} from "../unique/appUniqueKeyErrors";
import {
  PointCommitSqlFailureMarkerV1,
} from "../../commit/point/sqlFailures";
import {
  corruption,
} from "../../commit/point/errors";

export function mapPointCommitUniqueKeyFailure(
  failure: Effect.Error<
    ReturnType<typeof prepareAppUniqueCanonicalMutationApplicationEffect> | ReturnType<typeof applyPreparedAppUniqueMutationApplicationEffect>
  >,
) {
  if (
    failure instanceof AppUniqueKeyConflictError ||
    failure instanceof AppUniqueKeyHashError ||
    failure instanceof CanonicalAppUniqueKeyHashCollisionError
  )
    return failure;
  if (failure instanceof AppUniqueKeyPersistenceError) {
    return new PointCommitSqlFailureMarkerV1("writeUniqueKey", failure.cause);
  }
  return corruption("uniqueKeyTransitionInvalid");
}

import { pointCommitSqlCallFailure } from "../pointCommitErrors";

import {
  PointCommitResourceExhaustionV1Error,
  PointCommitUnsupportedProfileV1Error,
  corruption,
} from "../pointCommitErrors";

import {
  allocateScopePublicationResult,
  readScopePublicationDatabaseTime,
  writeScopePublicationPrefix as writeSharedPublicationPrefix,
  reproveScopePublicationPrefix as reproveSharedPublicationPrefix,
  advanceScopePublicationClock as advanceSharedPublicationClock,
  requireScopePublicationStrongReferences as requireSharedPublicationStrongReferences,
} from "./publication";
import {
  ScopePublicationCorruptionError,
  ScopePublicationResourceError,
  ScopePublicationSqlFailure,
  ScopePublicationUnsupportedProfileError,
} from "./scopePublicationModel";

import { Cause, Effect, Result } from "effect";

import { type ScopeClockRecord } from "../../scope/scopeClock";

// Native and CMS retain their established kernel error channel. No mechanics are duplicated here.
export const allocatePointCommitKernelResult = (
  clock: { readonly record: ScopeClockRecord },
  now: number,
) =>
  allocateScopePublicationResult(clock, now).pipe(
    Result.mapError(
      (error) =>
        new PointCommitResourceExhaustionV1Error({
          dimension: error.dimension,
          maximum: error.maximum,
        }),
    ),
  );

export const readPointCommitDatabaseTime: typeof readScopePublicationDatabaseTime =
  (...args) =>
    readScopePublicationDatabaseTime(...args).catch(rethrowPublicationFailure);

export const writeScopePublicationPrefix: typeof writeSharedPublicationPrefix =
  (...args) =>
    writeSharedPublicationPrefix(...args).catch(rethrowPublicationFailure);

export const reproveScopePublicationPrefix: typeof reproveSharedPublicationPrefix =
  (...args) => reproveSharedPublicationPrefix(...args).catch(rethrowPublicationFailure);

export const advanceScopePublicationClock = (...args: Parameters<typeof advanceSharedPublicationClock>) =>
  advanceSharedPublicationClock(...args).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectPublicationFailure))));
export const requireScopePublicationStrongReferences = (...args: Parameters<typeof requireSharedPublicationStrongReferences>) =>
  requireSharedPublicationStrongReferences(...args).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectPublicationFailure))));

function projectPublicationFailure<Failure>(cause: Failure) {
  if (cause instanceof ScopePublicationUnsupportedProfileError)
    return new PointCommitUnsupportedProfileV1Error({ reason: cause.reason });
  if (cause instanceof ScopePublicationCorruptionError)
    return corruption(cause.reason);
  if (cause instanceof ScopePublicationResourceError)
    return new PointCommitResourceExhaustionV1Error({
      dimension: cause.dimension,
      maximum: cause.maximum,
    });
  if (cause instanceof ScopePublicationSqlFailure)
    return pointCommitSqlCallFailure(cause.operation, cause.cause);
  return cause;
}
export function rethrowPublicationFailure(cause: unknown): never {
  throw projectPublicationFailure(cause);
}

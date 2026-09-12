import { pointCommitSqlCallFailure } from "../pointCommitErrors";

import {
  PointCommitResourceExhaustionV1Error,
  corruption,
} from "../pointCommitErrors";

import {
  allocateScopePublicationResult,
  readScopePublicationDatabaseTime,
  writeScopePublicationPrefix as writeSharedPublicationPrefix,
  advanceScopePublicationClock as advanceSharedPublicationClock,
} from "../commitPublication/publication";
import {
  ScopePublicationCorruptionError,
  ScopePublicationResourceError,
  ScopePublicationSqlFailure,
} from "../commitPublication/scopePublicationModel";

import { Result } from "effect";

import { type ScopeClockRecord } from "../scopeClock";

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

export const advanceScopePublicationClock: typeof advanceSharedPublicationClock =
  (...args) =>
    advanceSharedPublicationClock(...args).catch(rethrowPublicationFailure);

export function rethrowPublicationFailure(cause: unknown): never {
  if (cause instanceof ScopePublicationCorruptionError)
    throw corruption(cause.reason);
  if (cause instanceof ScopePublicationResourceError)
    throw new PointCommitResourceExhaustionV1Error({
      dimension: cause.dimension,
      maximum: cause.maximum,
    });
  if (cause instanceof ScopePublicationSqlFailure)
    throw pointCommitSqlCallFailure(cause.operation, cause.cause);
  throw cause;
}

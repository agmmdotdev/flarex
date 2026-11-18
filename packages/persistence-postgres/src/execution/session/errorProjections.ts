import { ApplicationActivationError } from "../../application/activation/errors";
import { reconcileEffectTransactionFailure } from "../../database/effectTransactionFailure";
import { ScopeExecutionAuthorityError } from "../../scope/execution/Errors";
import {
  TrustedScopeAuthorityPortError,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionError,
} from "../../scope/scopeAuthorityResolution";
import {
  TransactionExecutionClaimCorruptionV1Error,
  TransactionExecutionClaimStaleV1Error,
} from "../claims/transactionExecutionClaimErrors";
import { LocatedReadCommittedTransactionFailureV1 } from "../readCommittedTransactionFailure";
import {
  type ExactRunningAttemptTransactionV1Error,
  PointMutationSessionActivationPersistenceV1Error,
  PointMutationSessionActivationV1Error,
  PointMutationSessionAttemptLoadPersistenceV1Error,
  PointMutationSessionAttemptLoadV1Error,
  PointMutationSessionAuthorityCorruptionV1Error,
  activationError,
  attemptLoadError,
  corruptionError,
} from "./errors";
import type { Cause, Effect } from "effect";

export function mapActivationTransactionError(
  cause: unknown,
): PointMutationSessionActivationV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionActivationPersistenceV1Error {
  if (cause instanceof ScopeExecutionAuthorityError) {
    return activationError({
      reason: cause.reason === "targetPlacementMismatch" ||
          cause.reason === "scopeMismatch"
        ? "scopeMismatch"
        : cause.reason,
    });
  }
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack"
  ) {
    return mapActivationTransactionError(cause.issue.callbackCause);
  }
  if (
    cause instanceof PointMutationSessionActivationV1Error ||
    cause instanceof PointMutationSessionAuthorityCorruptionV1Error ||
    cause instanceof PointMutationSessionActivationPersistenceV1Error
  ) {
    return cause;
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return activationError({ reason: "executionClaimUnavailable" });
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return corruptionError(cause.scopeId, "executionClaimInvalid", cause);
  }
  return new PointMutationSessionActivationPersistenceV1Error({
    operation: "activationTransaction",
    cause,
  });
}

export function mapApplicationActivationTransactionError(
  cause: unknown,
): PointMutationSessionActivationV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionActivationPersistenceV1Error |
  ApplicationActivationError {
  if (
    cause instanceof LocatedReadCommittedTransactionFailureV1 &&
    cause.issue.kind === "callbackRolledBack"
  ) return mapApplicationActivationTransactionError(
    cause.issue.callbackCause,
  );
  if (cause instanceof ApplicationActivationError) return cause;
  return mapActivationTransactionError(cause);
}

export function mapAttemptLoadTransactionError(
  cause: unknown,
): PointMutationSessionAttemptLoadV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionAttemptLoadPersistenceV1Error {
  if (
    cause instanceof PointMutationSessionAttemptLoadV1Error ||
    cause instanceof PointMutationSessionAuthorityCorruptionV1Error
  ) {
    return cause;
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return attemptLoadError({ reason: "executionClaimUnavailable" });
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return corruptionError(cause.scopeId, "executionClaimInvalid", cause);
  }
  return new PointMutationSessionAttemptLoadPersistenceV1Error({
    operation: "attemptLoadTransaction",
    cause,
  });
}

export function reconcileExactRunningAttemptTransactionFailureV1<Failure>(
  failure: ExactRunningAttemptTransactionV1Error,
  callbackCause: Cause.Cause<Failure> | undefined,
  rollbackSignal: unknown,
): Effect.Effect<never, Failure | ExactRunningAttemptTransactionV1Error> {
  return reconcileEffectTransactionFailure(
    failure,
    callbackCause,
    rollbackSignal,
  );
}

export function mapActivationAuthorityError(
  error: TrustedScopeAuthorityError,
): TrustedScopeAuthorityResolutionError |
  PointMutationSessionActivationPersistenceV1Error {
  return error instanceof TrustedScopeAuthorityPortError
    ? new PointMutationSessionActivationPersistenceV1Error({
        operation: error.operation,
        cause: error.cause,
      })
    : error;
}

import { Data, Effect } from "effect";
import { CmsTransactionError } from "../../frameworks/cmsTransaction/model";
import { LocatedReadCommittedTransactionFailureV1 } from "../../execution/readCommittedTransactionFailure";
import {
  corruption,
  PointMutationAttemptReplacementCommittedOutcomeV1Error,
  PointMutationAttemptReplacementConflictNoLongerPresentV1Error,
  PointMutationAttemptReplacementRequestKeyReuseV1Error,
  PointMutationAttemptReplacementCorruptionV1Error,
  PointMutationAttemptReplacementStaleAuthorityV1Error,
  PointMutationAttemptReplacementResourceExhaustionV1Error,
  PointCommitConflictV1Error,
  PointCommitStaleAuthorityV1Error,
  PointCommitCorruptionV1Error,
  PointCommitSqlErrorV1,
  PointFiniteAttemptRetryBudgetExhaustedError,
  PointMutationAttemptReplacementFiniteEntryError,
  PointMutationAttemptReplacementSqlErrorV1,
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitDecisionUncertainV1Error,
  AppDocumentInsertionConflictError,
  PointCommitResourceExhaustionV1Error,
  PointCommitUnsupportedProfileV1Error,
  PointCommitIntrinsicIndexDefinitionUnavailableV1Error,
  PointCommitDeveloperIndexMaintenanceUnavailableV1Error,
  PointCommitUniqueConstraintMaintenanceUnavailableV1Error,
} from "./errors";
import type {
  PointMutationAttemptReplacementSqlOperationV1,
  PointCommitSqlOperationV1,
  PointMutationAttemptReplacementV1Error,
  PointCommitFinishingTransitionV1Error,
  PointCommitPublicationV1Error,
  PointCommitConfirmedPreDecisionSqlStateV1,
  PointCommitDecisionUncertainOutcomeCheckV1,
  PointMutationAttemptReplacementCorruptionReasonV1,
  PointCommitStaleAuthorityReasonV1,
  PointCommitRollbackProofV1Error,
} from "./errors";
import type { FiniteAttemptAnchorError } from "../../execution/finiteAttemptAnchor";
import type {
  PointMutationAttemptReplacementOptionsV1,
  PointMutationAttemptReplacementProofStepV1,
  PointCommitTransactionProofOptionsV1,
} from "./constructionContracts";
import type { PreparedPointCommitAuthorityCommandV1 } from "./preparedCommands";
import { observeDrizzleQuery as observeCompiledDrizzleQuery } from "../../database/drizzleQueryObservation";
import {
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeCorruptionErrorV1,
} from "../committedPointOutcomeErrors";
import type { CommittedPointOutcomeCorruptionReasonV1 } from "../committedPointOutcomeErrors";
import {
  TrustedScopeAuthorityPortError,
  TrustedScopeAuthorityResolutionError,
} from "../../scope/scopeAuthorityResolution";
import type { TrustedScopeAuthorityError } from "../../scope/scopeAuthorityResolution";
import {
  TransactionExecutionClaimCorruptionV1Error,
  TransactionExecutionClaimStaleV1Error,
} from "../../execution/claims/transactionExecutionClaimErrors";
import {
  ScopeClockCorruptionError,
  ScopeClockNotFoundError,
} from "../../scope/scopeClockErrors";
import { isAppendAppRowRevisionV1Error } from "../../storage/documents/appRowErrors";
import type { ResolveCommittedPointOutcomeInputV1 } from "../committedPointOutcome";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import {
  ScopePublicationReferenceConstraintError,
  ScopePublicationReferenceCapacityError,
} from "../publication/scopePublicationModel";
import {
  ApplicationRelationCommitUnavailableError,
  ApplicationRelationConstraintError,
  ApplicationRelationCommitResourceExhaustionError,
  ApplicationRelationTargetNotLiveError,
  ApplicationRelationTargetDeleteRestrictedError,
  ApplicationRelationCommitCorruptionError,
} from "../../application/relations/commit/Model";
import { AppSchemaCandidateWriteGuardError } from "../../storage/catalog/appSchemaCandidateWriteGuardErrors";
import {
  AppUniqueKeyConflictError,
  AppUniqueKeyHashError,
  CanonicalAppUniqueKeyHashCollisionError,
} from "../../storage/unique/appUniqueKeyErrors";
import { isAppendAppIndexEntryRevisionV1Error } from "../../storage/indexes/appIndexEntryErrors";
import { isNonArrayRecord } from "@flarex/utils/records";

export class PointCommitTransactionDecisionUncertainV1Error extends Data.TaggedError(
  "PointCommitTransactionDecisionUncertainV1Error",
)<{
  readonly cause: LocatedReadCommittedTransactionFailureV1;
}> {}

export class PointMutationAttemptReplacementSqlFailureMarkerV1 {
  constructor(
    readonly operation: PointMutationAttemptReplacementSqlOperationV1,
    readonly cause: unknown,
  ) {}
}

export function finiteCommitSqlFailure(
  operation: PointCommitSqlOperationV1,
  cause: unknown
) {
  return mapPointCommitCallbackFailure(
    new PointCommitSqlFailureMarkerV1(operation, cause)
  );
}

export function mapFiniteAnchorFailure(error: FiniteAttemptAnchorError) {
  switch (error.reason) {
    case "resourceFailure":
      return finiteCommitSqlFailure("lockSession", error.cause ?? error);
    case "attemptMissing":
      return stale("attemptMissing");
    case "attemptReplaced":
      return stale("attemptReplaced");
    case "ownershipChanged":
      return stale("lifecycleChanged");
    case "expired":
      return stale("expired");
    case "lifecycleChanged":
      return stale("lifecycleChanged");
    case "invalidInput":
    case "storedCorruption":
      return corruption("sessionInvalid");
  }
}

export async function emitReplacementStep(
  options: PointMutationAttemptReplacementOptionsV1,
  command: PreparedPointCommitAuthorityCommandV1,
  step: PointMutationAttemptReplacementProofStepV1,
): Promise<void> {
  await options.afterReplacementStep?.(
    Object.freeze({
      scopeId: command.authorityPins.scopeId,
      step,
    })
  );
}

export function observeDrizzleQuery(
  name: PointCommitSqlOperationV1,
  query: Readonly<{
    toSQL: () => Readonly<{
      sql: string;
      params: ReadonlyArray<unknown>;
    }>;
  }>,
  options: PointCommitTransactionProofOptionsV1,
): void {
  observeCompiledDrizzleQuery(name, query, options.observeQuery);
}

export function observeReplacementQuery(
  name: PointMutationAttemptReplacementSqlOperationV1,
  query: Readonly<{
    toSQL: () => Readonly<{
      sql: string;
      params: ReadonlyArray<unknown>;
    }>;
  }>,
  options: PointMutationAttemptReplacementOptionsV1,
): void {
  observeCompiledDrizzleQuery(name, query, options.observeQuery);
}

export async function replacementSqlCall<Value>(
  operation: PointMutationAttemptReplacementSqlOperationV1,
  call: () => PromiseLike<Value>,
): Promise<Value> {
  try {
    return await call();
  } catch (cause) {
    if (
      cause instanceof PointMutationAttemptReplacementCommittedOutcomeV1Error ||
      cause instanceof
        PointMutationAttemptReplacementConflictNoLongerPresentV1Error ||
      cause instanceof PointMutationAttemptReplacementRequestKeyReuseV1Error ||
      cause instanceof PointMutationAttemptReplacementCorruptionV1Error ||
      cause instanceof PointMutationAttemptReplacementStaleAuthorityV1Error ||
      cause instanceof
        PointMutationAttemptReplacementResourceExhaustionV1Error ||
      cause instanceof PointCommitConflictV1Error ||
      cause instanceof PointCommitStaleAuthorityV1Error ||
      cause instanceof PointCommitCorruptionV1Error ||
      cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
      cause instanceof CommittedPointOutcomeCorruptionErrorV1
    ) {
      throw cause;
    }
    throw new PointMutationAttemptReplacementSqlFailureMarkerV1(
      operation,
      cause,
    );
  }
}

export function mapPointMutationAttemptReplacementSharedError(
  cause:
    | PointCommitStaleAuthorityV1Error
    | PointCommitCorruptionV1Error
    | PointCommitSqlErrorV1,
): PointMutationAttemptReplacementV1Error {
  if (cause instanceof PointCommitStaleAuthorityV1Error) {
    return new PointMutationAttemptReplacementStaleAuthorityV1Error({
      reason: cause.reason,
    });
  }
  if (cause instanceof PointCommitCorruptionV1Error) {
    return replacementCorruption(cause.reason);
  }
  return replacementSqlError(cause.operation, cause.cause);
}

export function routeAuthorityResolutionFailure(
  cause: TrustedScopeAuthorityError,
): Effect.Effect<never, PointCommitFinishingTransitionV1Error> {
  const underlyingCause =
    cause instanceof TrustedScopeAuthorityPortError ? cause.cause : cause;
  if (underlyingCause instanceof TrustedScopeAuthorityResolutionError) {
    const failure = underlyingCause.failure;
    switch (failure.reason) {
      case "scopeClockTargetResolutionFailed":
        return Effect.fail(
          sqlError("resolveAuthority", failure.resolutionCause),
        );
      case "scopeClockTargetInvalid":
      case "scopeClockScopeMismatch":
        return Effect.fail(corruption("scopeClockInvalid"));
      case "scopeMetadataMissing":
      case "scopeMetadataAmbiguous":
      case "scopeDeploymentMismatch":
      case "splitProvisioningReceiptMissing":
      case "splitProvisioningReceiptScopeMismatch":
      case "splitProvisioningReceiptNotReady":
      case "splitProvisioningReceiptPlacementMismatch":
      case "scopeClockTargetPlacementMismatch":
      case "scopeClockMissing":
        return Effect.fail(stale("placementChanged"));
      default:
        return unexpectedAuthorityResolutionFailure(failure);
    }
  }
  const sqlState = findSqlState(underlyingCause);
  if (sqlState !== undefined) {
    return Effect.fail(sqlError("resolveAuthority", underlyingCause));
  }
  return Effect.die(underlyingCause);
}

export function unexpectedAuthorityResolutionFailure(failure: never): never {
  throw failure;
}

export function mapFinishingTransitionFailure(
  cause: unknown,
): PointCommitFinishingTransitionV1Error {
  if (
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitSqlErrorV1
  ) {
    return cause;
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return corruption("finishingTransitionInvalid");
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return stale(
      cause.reason === "claimExpired" ? "expired" : "lifecycleChanged",
    );
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause !== cause
    ) {
      return mapFinishingTransitionFailure(cause.issue.callbackCause);
    }
    return sqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return sqlError(cause.operation, cause.cause);
  }
  if (
    cause instanceof ScopeClockCorruptionError ||
    cause instanceof ScopeClockNotFoundError
  ) {
    return corruption("scopeClockInvalid");
  }
  const sqlState = findSqlState(cause);
  if (sqlState !== undefined) {
    return sqlError("beginOrRollback", cause);
  }
  throw cause;
}

export function mapPointMutationAttemptReplacementTransactionFailure(
  cause: unknown,
): PointMutationAttemptReplacementV1Error {
  if (
    cause instanceof PointFiniteAttemptRetryBudgetExhaustedError ||
    cause instanceof PointMutationAttemptReplacementFiniteEntryError ||
    cause instanceof PointMutationAttemptReplacementCommittedOutcomeV1Error ||
    cause instanceof
      PointMutationAttemptReplacementConflictNoLongerPresentV1Error ||
    cause instanceof PointMutationAttemptReplacementRequestKeyReuseV1Error ||
    cause instanceof PointMutationAttemptReplacementCorruptionV1Error ||
    cause instanceof PointMutationAttemptReplacementStaleAuthorityV1Error ||
    cause instanceof PointMutationAttemptReplacementResourceExhaustionV1Error ||
    cause instanceof PointMutationAttemptReplacementSqlErrorV1
  ) {
    return cause;
  }
  if (cause instanceof PointCommitConfirmedPreDecisionRollbackV1Error)
    return replacementSqlError(cause.operation, cause.cause);
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) {
    return new PointMutationAttemptReplacementRequestKeyReuseV1Error({
      mismatches: Object.freeze([...cause.mismatches]),
    });
  }
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) {
    return replacementCorruption("committedOutcomeInvalid");
  }
  if (
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitSqlErrorV1
  ) {
    return mapPointMutationAttemptReplacementSharedError(cause);
  }
  if (cause instanceof PointCommitConflictV1Error) {
    return replacementCorruption("occEvidenceInvalid");
  }
  if (cause instanceof TransactionExecutionClaimCorruptionV1Error) {
    return replacementCorruption("replacementConvergenceInvalid");
  }
  if (cause instanceof TransactionExecutionClaimStaleV1Error) {
    return new PointMutationAttemptReplacementStaleAuthorityV1Error({
      reason: cause.reason === "claimExpired" ? "expired" : "lifecycleChanged",
    });
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause !== cause
    ) {
      return mapPointMutationAttemptReplacementTransactionFailure(
        cause.issue.callbackCause,
      );
    }
    return replacementSqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointMutationAttemptReplacementSqlFailureMarkerV1) {
    return replacementSqlError(cause.operation, cause.cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return replacementSqlError(cause.operation, cause.cause);
  }
  if (
    cause instanceof ScopeClockCorruptionError ||
    cause instanceof ScopeClockNotFoundError
  ) {
    return replacementCorruption("scopeClockInvalid");
  }
  if (isAppendAppRowRevisionV1Error(cause)) {
    return replacementCorruption("rowHeadInvalid");
  }
  const sqlState = findSqlState(cause);
  if (sqlState !== undefined) {
    return replacementSqlError("beginOrRollback", cause);
  }
  throw cause;
}

export function mapPublicationTransactionFailure(
  cause: unknown,
):
   PointCommitPublicationV1Error
  | PointCommitTransactionDecisionUncertainV1Error {
  if (
    cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
    cause instanceof CommittedPointOutcomeCorruptionErrorV1
  ) {
    return cause;
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (cause.issue.kind === "decisionUncertain") {
      return new PointCommitTransactionDecisionUncertainV1Error({ cause });
    }
    if (cause.issue.kind === "callbackRolledBack") {
      return mapPointCommitCallbackFailure(cause.issue.callbackCause);
    }
  }
  return mapTransactionFailure(cause);
}

export function mapPointCommitCallbackFailure(
  cause: unknown
): PointCommitPublicationV1Error {
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    const sqlState = confirmedPreDecisionSqlState(cause.cause);
    if (sqlState !== undefined)
      return new PointCommitConfirmedPreDecisionRollbackV1Error({
        operation: cause.operation,
        sqlState,
        cause: cause.cause,
      });
  }
  return mapTransactionFailure(cause);
}

export function confirmedPreDecisionSqlState(
  cause: unknown,
): PointCommitConfirmedPreDecisionSqlStateV1 | undefined {
  const sqlState = findSqlState(cause);
  return sqlState === "40001" || sqlState === "40P01" ? sqlState : undefined;
}

export function decisionUncertain(
  cause: LocatedReadCommittedTransactionFailureV1,
  outcomeCheck: PointCommitDecisionUncertainOutcomeCheckV1,
): PointCommitDecisionUncertainV1Error {
  return new PointCommitDecisionUncertainV1Error({
    phase: "commitOrRelease",
    cause,
    outcomeCheck,
  });
}

export function committedOutcomeCorruption(
  input: ResolveCommittedPointOutcomeInputV1,
  reason: CommittedPointOutcomeCorruptionReasonV1,
  commitSeq?: CommitSeq,
): CommittedPointOutcomeCorruptionErrorV1 {
  return new CommittedPointOutcomeCorruptionErrorV1({
    scopeUuid: input.scopeUuid,
    reason,
    ...(commitSeq === undefined ? {} : { commitSeq }),
  });
}

export function replacementCorruption(
  reason: PointMutationAttemptReplacementCorruptionReasonV1,
): PointMutationAttemptReplacementCorruptionV1Error {
  return new PointMutationAttemptReplacementCorruptionV1Error({ reason });
}

export function replacementSqlError(
  operation: PointMutationAttemptReplacementSqlOperationV1,
  cause: unknown,
): PointMutationAttemptReplacementSqlErrorV1 {
  const sqlState = findSqlState(cause);
  return new PointMutationAttemptReplacementSqlErrorV1({
    operation,
    cause,
    ...(sqlState === undefined ? {} : { sqlState }),
  });
}

export function stale(
  reason: PointCommitStaleAuthorityReasonV1,
): PointCommitStaleAuthorityV1Error {
  return new PointCommitStaleAuthorityV1Error({ reason });
}

export class PointCommitSqlFailureMarkerV1 {
  constructor(
    readonly operation: PointCommitSqlOperationV1,
    readonly cause: unknown,
  ) {}
}

export function mapTransactionFailure(
  cause: unknown,
): PointCommitRollbackProofV1Error {
  if (
    cause instanceof CmsTransactionError ||
    cause instanceof PointCommitConflictV1Error ||
    cause instanceof AppDocumentInsertionConflictError ||
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitResourceExhaustionV1Error ||
    cause instanceof PointCommitSqlErrorV1 ||
    cause instanceof PointCommitUnsupportedProfileV1Error ||
    cause instanceof ScopePublicationReferenceConstraintError ||
    cause instanceof ScopePublicationReferenceCapacityError ||
    cause instanceof PointCommitIntrinsicIndexDefinitionUnavailableV1Error ||
    cause instanceof PointCommitDeveloperIndexMaintenanceUnavailableV1Error ||
    cause instanceof PointCommitUniqueConstraintMaintenanceUnavailableV1Error ||
    cause instanceof ApplicationRelationCommitUnavailableError ||
    cause instanceof ApplicationRelationConstraintError ||
    cause instanceof ApplicationRelationCommitResourceExhaustionError ||
    cause instanceof ApplicationRelationTargetNotLiveError ||
    cause instanceof ApplicationRelationTargetDeleteRestrictedError ||
    cause instanceof AppSchemaCandidateWriteGuardError ||
    cause instanceof AppUniqueKeyConflictError ||
    cause instanceof AppUniqueKeyHashError ||
    cause instanceof CanonicalAppUniqueKeyHashCollisionError ||
    isAppendAppIndexEntryRevisionV1Error(cause)
  ) {
    return cause;
  }
  if (cause instanceof ApplicationRelationCommitCorruptionError) {
    return corruption("relationTransitionInvalid");
  }
  if (cause instanceof LocatedReadCommittedTransactionFailureV1) {
    if (
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause !== cause
    ) {
      return mapTransactionFailure(cause.issue.callbackCause);
    }
    return sqlError("beginOrRollback", cause);
  }
  if (cause instanceof PointCommitSqlFailureMarkerV1) {
    return sqlError(cause.operation, cause.cause);
  }
  if (isAppendAppRowRevisionV1Error(cause)) {
    return corruption("rowWriteInvalid");
  }
  if (
    cause instanceof ScopeClockCorruptionError ||
    cause instanceof ScopeClockNotFoundError
  ) {
    return corruption("scopeClockInvalid");
  }
  const sqlState = findSqlState(cause);
  if (sqlState !== undefined) {
    return sqlError("beginOrRollback", cause);
  }
  throw cause;
}

export function sqlError(
  operation: PointCommitSqlOperationV1,
  cause: unknown,
): PointCommitSqlErrorV1 {
  const sqlState = findSqlState(cause);
  return new PointCommitSqlErrorV1({
    operation,
    cause,
    ...(sqlState === undefined ? {} : { sqlState }),
  });
}

export function findSqlState(cause: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isNonArrayRecord(cause)) return undefined;
  const code = cause.code;
  if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    return code;
  }
  const nested = cause.cause;
  return nested === cause ? undefined : findSqlState(nested, depth + 1);
}

export async function sqlCall<Value>(
  operation: PointCommitSqlOperationV1,
  call: () => PromiseLike<Value>,
): Promise<Value> {
  try {
    return await call();
  } catch (cause) {
    throw pointCommitSqlCallFailure(operation, cause);
  }
}

export function pointCommitSqlCallFailure(
  operation: PointCommitSqlOperationV1,
  cause: unknown,
) {
  if (
    cause instanceof PointCommitConflictV1Error ||
    cause instanceof AppDocumentInsertionConflictError ||
    cause instanceof PointCommitStaleAuthorityV1Error ||
    cause instanceof PointCommitCorruptionV1Error ||
    cause instanceof PointCommitResourceExhaustionV1Error ||
    isAppendAppIndexEntryRevisionV1Error(cause) ||
    cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1 ||
    cause instanceof CommittedPointOutcomeCorruptionErrorV1
  ) {
    return cause;
  }

  return new PointCommitSqlFailureMarkerV1(operation, cause);
}

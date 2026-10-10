import type { PreparedHostRuntimeError } from "../../execution/preparation/preparedHostRuntime";
import type { PreparedMetadataEpochError } from "../../execution/preparation/preparedMetadataEpoch";
import type {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  TrustedScopeAuthorityError,
} from "../../scope/scopeAuthorityResolution";
import type {
  lockScopeClockForOrdinaryWriteInTransactionEffect,
  lockScopeClockForSnapshotReadInTransactionEffect,
  LockScopeClockForUpdateError,
} from "../../scope/scopeClock";
import type {
  captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect,
  readAppSchemaCandidateWriteGuardPlanningHeadIdentity,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type { ApplicationActiveHeadStateError } from "../activeHead/errors";
import type { ReadApplicationReadinessError } from "../readiness/errors";
import type {
  ReadApplicationRelationReadinessFoldError,
  SettleApplicationRelationReadinessFoldError,
} from "../relations/applicationRelationReadinessFold";
import { Data, Effect } from "effect";

export class ApplicationActivationError extends Data.TaggedError(
  "ApplicationActivationError",
)<{
  readonly operation: "activate" | "read" | "validateSelection";
  readonly reason:
    | "invalidInput"
    | "invalidComposition"
    | "notReady"
    | "activeMissing"
    | "alreadyActive"
    | "expectedHead"
    | "scopeAuthority"
    | "concurrentHead"
    | "storedState"
    | "decisionUncertain"
    | "resourceFailure";
  readonly revisionId?: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type BindingPreparationError = ApplicationActivationError | ReadApplicationReadinessError |
  ReadApplicationRelationReadinessFoldError | TrustedScopeAuthorityError | LockScopeClockForUpdateError;

export type CurrentApplicationEntryFailure = ApplicationActivationError | ApplicationActiveHeadStateError | PreparedMetadataEpochError |
  TrustedScopeAuthorityError | LockScopeClockForUpdateError |
  Effect.Error<ReturnType<typeof lockScopeClockForSnapshotReadInTransactionEffect>> |
  Effect.Error<ReturnType<typeof lockScopeClockForOrdinaryWriteInTransactionEffect>> |
  Effect.Error<ReturnType<typeof captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect>> |
  Effect.Error<ReturnType<typeof readAppSchemaCandidateWriteGuardPlanningHeadIdentity>>;

export type CurrentApplicationPreparationFailure = BindingPreparationError | CurrentApplicationEntryFailure | PreparedHostRuntimeError |
  Effect.Error<ReturnType<typeof resolveLocatedTrustedScopeAuthorityByIdEffect>>;

export type ValidateApplicationRelationActiveSelectionError =
  | ApplicationActivationError
  | SettleApplicationRelationReadinessFoldError
  | TrustedScopeAuthorityError
  | LockScopeClockForUpdateError;

export type ValidateApplicationRelationActiveSelectionInTransactionError =
  | ApplicationActivationError
  | SettleApplicationRelationReadinessFoldError;

export function activationFailure(
  operation: ApplicationActivationError["operation"],
  reason: ApplicationActivationError["reason"],
  revisionId?: string,
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationActivationError> {
  return Effect.fail(activationError(
    operation,
    reason,
    revisionId,
    retryable,
    cause,
  ));
}

export function activationError(
  operation: ApplicationActivationError["operation"],
  reason: ApplicationActivationError["reason"],
  revisionId?: string,
  retryable = false,
  cause?: unknown,
): ApplicationActivationError {
  return new ApplicationActivationError({
    operation,
    reason,
    retryable,
    ...(revisionId === undefined ? {} : { revisionId }),
    ...(cause === undefined ? {} : { cause }),
  });
}

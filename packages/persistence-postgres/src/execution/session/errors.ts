import type { ApplicationActivationError } from "../../application/activation/errors";
import type {
  ApplicationMutationAdmissionError,
  PreparedFiniteApplicationMutationAdmissionAcceptanceError,
} from "../../application/applicationMutationAdmission";
import type {
  TrustedScopeAuthorityPortOperation,
  TrustedScopeAuthorityResolutionError,
} from "../../scope/scopeAuthorityResolution";
import type { SessionJournalStorePersistence } from "../journal/contracts";
import type { runPreparedFiniteSessionJournalEntryEffect } from "../journal/finiteEntryActivation";
import type { PointMutationSessionTerminalLifecycleV1 } from "./contracts";
import { Data, Result, type Cause, type Effect } from "effect";
import type {
  ApplicationMutationExecutionAuthorityV1Error,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { TransactionSessionLifecycleV1 } from "flarex-protocol/transaction-session";

export type FiniteApplicationMutationSessionActivationError =
  | PointMutationSessionActivationEffectErrorV1
  | ApplicationActivationError
  | ApplicationMutationAdmissionError
  | ApplicationMutationExecutionAuthorityV1Error
  | PreparedFiniteApplicationMutationAdmissionAcceptanceError
  | Effect.Error<ReturnType<SessionJournalStorePersistence["prepareFiniteEntryEffect"]>>
  | Effect.Error<ReturnType<typeof runPreparedFiniteSessionJournalEntryEffect>>;

export type PointMutationSessionActivationConfigurationIssueV1 =
  | { readonly reason: "invalidLeaseDuration" }
  | { readonly reason: "invalidExecutionClaimDuration" }
  | { readonly reason: "invalidGeneratedSessionId"; readonly value: string }
  | { readonly reason: "sessionIdGenerationFailed"; readonly cause: unknown }
  | { readonly reason: "invalidGeneratedExecutionClaimOwner"; readonly value: string }
  | {
      readonly reason: "executionClaimOwnerGenerationFailed";
      readonly cause: unknown;
    };

export class PointMutationSessionActivationConfigurationV1Error extends Error {
  readonly _tag = "PointMutationSessionActivationConfigurationV1Error";
  readonly name = "PointMutationSessionActivationConfigurationV1Error";

  constructor(
    readonly issue: PointMutationSessionActivationConfigurationIssueV1,
  ) {
    super(`Point-mutation session activation configuration failed: ${issue.reason}.`);
  }
}

export type PointMutationSessionActivationIssueV1 =
  | { readonly reason: "scopeMismatch" }
  | { readonly reason: "unsupportedStorageGeneration" }
  | { readonly reason: "storageGenerationChanged" }
  | { readonly reason: "storageGenerationFenceChanged" }
  | { readonly reason: "scopeEpochChanged" }
  | { readonly reason: "snapshotCommitSeqChanged" }
  | { readonly reason: "authorizationRevocationEpochChanged" }
  | { readonly reason: "invalidPreparedEvidence" }
  | { readonly reason: "authorizationGrantExpired" }
  | { readonly reason: "requestKeyConflict" }
  | {
      readonly reason: "terminalRequest";
      readonly lifecycle: Exclude<TransactionSessionLifecycleV1, "running">;
    }
  | { readonly reason: "activeAttemptExpired" }
  | { readonly reason: "executionClaimUnavailable" }
  | { readonly reason: "sessionIdCollision" };

export class PointMutationSessionActivationV1Error extends Error {
  readonly _tag = "PointMutationSessionActivationV1Error";
  readonly name = "PointMutationSessionActivationV1Error";

  constructor(readonly issue: PointMutationSessionActivationIssueV1) {
    super(`Point-mutation session activation failed: ${issue.reason}.`);
  }
}

export type PointMutationSessionAttemptLoadIssueV1 =
  | { readonly reason: "invalidSelector"; readonly cause: unknown }
  | { readonly reason: "selectorScopeMismatch" }
  | { readonly reason: "sessionMissing" }
  | { readonly reason: "staleAttemptFence" }
  | {
      readonly reason: "attemptNotRunning";
      readonly lifecycle: Exclude<TransactionSessionLifecycleV1, "running">;
    }
  | { readonly reason: "unsupportedStorageGeneration" }
  | { readonly reason: "storageGenerationChanged" }
  | { readonly reason: "storageGenerationFenceChanged" }
  | { readonly reason: "scopeEpochChanged" }
  | { readonly reason: "authorizationRevocationEpochChanged" }
  | { readonly reason: "activeAttemptExpired" }
  | { readonly reason: "executionClaimUnavailable" };

export class PointMutationSessionAttemptLoadV1Error extends Error {
  readonly _tag = "PointMutationSessionAttemptLoadV1Error";
  readonly name = "PointMutationSessionAttemptLoadV1Error";

  constructor(readonly issue: PointMutationSessionAttemptLoadIssueV1) {
    super(`Point-mutation session attempt load failed: ${issue.reason}.`);
  }
}

export type PointMutationSessionAttemptTerminalizationIssueV1 =
  | { readonly reason: "invalidSelector"; readonly cause: unknown }
  | { readonly reason: "invalidAbortSnapshot"; readonly cause: unknown }
  | { readonly reason: "invalidAbortExecutionClaim"; readonly cause: unknown }
  | { readonly reason: "selectorScopeMismatch" }
  | { readonly reason: "sessionMissing" }
  | { readonly reason: "staleAttemptFence" }
  | {
      readonly reason: "attemptNotTerminalizable";
      readonly lifecycle: Exclude<
        TransactionSessionLifecycleV1,
        "running" |
          PointMutationSessionTerminalLifecycleV1
      >;
    }
  | { readonly reason: "unsupportedStorageGeneration" }
  | { readonly reason: "storageGenerationChanged" }
  | { readonly reason: "storageGenerationFenceChanged" }
  | { readonly reason: "scopeEpochChanged" }
  | { readonly reason: "authorizationRevocationEpochChanged" }
  | {
      readonly reason: "attemptStillLive";
      readonly effectiveExpiresAt: string;
    }
  | { readonly reason: "executionClaimUnavailable" };

export class PointMutationSessionAttemptTerminalizationV1Error extends Error {
  readonly _tag = "PointMutationSessionAttemptTerminalizationV1Error";
  readonly name = "PointMutationSessionAttemptTerminalizationV1Error";

  constructor(
    readonly issue: PointMutationSessionAttemptTerminalizationIssueV1,
  ) {
    super(`Point-mutation attempt terminalization failed: ${issue.reason}.`);
  }
}

export type PointMutationSessionAuthorityCorruptionIssueV1 =
  | "scopeClockNativeProjectionInvalid"
  | "databaseClockInvalid"
  | "duplicateRequestAnchors"
  | "sessionRecordInvalid"
  | "snapshotLeaseMissing"
  | "snapshotLeaseInvalid"
  | "snapshotAheadOfScopeClock"
  | "terminalSnapshotLeasePresent"
  | "activeJournalRootMissing"
  | "journalRootInvalid"
  | "terminalJournalRootPresent"
  | "attemptSnapshotChanged"
  | "executionClaimInvalid"
  | "terminalizationWriteMismatch";

export class PointMutationSessionAuthorityCorruptionV1Error extends Error {
  readonly _tag = "PointMutationSessionAuthorityCorruptionV1Error";
  readonly name = "PointMutationSessionAuthorityCorruptionV1Error";

  constructor(
    readonly scopeId: ScopeId,
    readonly issue: PointMutationSessionAuthorityCorruptionIssueV1,
    options?: ErrorOptions,
  ) {
    super(`Point-mutation session authority is corrupt for ${scopeId}: ${issue}.`, options);
  }
}

export class PointMutationSessionActivationTargetV1Error extends Error {
  readonly _tag = "PointMutationSessionActivationTargetV1Error";
  readonly name = "PointMutationSessionActivationTargetV1Error";

  constructor(readonly scopeId: ScopeId) {
    super(`Located scope target cannot activate point-mutation sessions: ${scopeId}.`);
  }
}

export class PointMutationSessionAttemptLoadTargetV1Error extends Error {
  readonly _tag = "PointMutationSessionAttemptLoadTargetV1Error";
  readonly name = "PointMutationSessionAttemptLoadTargetV1Error";

  constructor(readonly scopeId: ScopeId) {
    super(`Located scope target cannot load point-mutation attempts: ${scopeId}.`);
  }
}

export class PointMutationSessionAttemptTerminalizationTargetV1Error
  extends Error {
  readonly _tag = "PointMutationSessionAttemptTerminalizationTargetV1Error";
  readonly name = "PointMutationSessionAttemptTerminalizationTargetV1Error";

  constructor(readonly scopeId: ScopeId) {
    super(
      `Located scope target cannot terminalize point-mutation attempts: ${scopeId}.`,
    );
  }
}

export type PointMutationSessionActivationPersistenceOperationV1 =
  | TrustedScopeAuthorityPortOperation
  | "activationTransaction";

export class PointMutationSessionActivationPersistenceV1Error
  extends Data.TaggedError("PointMutationSessionActivationPersistenceV1Error")<{
    readonly operation: PointMutationSessionActivationPersistenceOperationV1;
    readonly cause: unknown;
  }> {}

export type PointMutationSessionActivationEffectErrorV1 =
  | TrustedScopeAuthorityResolutionError
  | PointMutationSessionActivationConfigurationV1Error
  | PointMutationSessionActivationV1Error
  | PointMutationSessionAuthorityCorruptionV1Error
  | PointMutationSessionActivationTargetV1Error
  | PointMutationSessionActivationPersistenceV1Error;

export type PointMutationSessionAttemptLoadPersistenceOperationV1 =
  | TrustedScopeAuthorityPortOperation
  | "attemptLoadTransaction";

export class PointMutationSessionAttemptLoadPersistenceV1Error
  extends Data.TaggedError("PointMutationSessionAttemptLoadPersistenceV1Error")<{
    readonly operation: PointMutationSessionAttemptLoadPersistenceOperationV1;
    readonly cause: unknown;
  }> {}

export type PointMutationSessionAttemptLoadEffectErrorV1 =
  | TrustedScopeAuthorityResolutionError
  | PointMutationSessionAttemptLoadV1Error
  | PointMutationSessionAuthorityCorruptionV1Error
  | PointMutationSessionAttemptLoadTargetV1Error
  | PointMutationSessionAttemptLoadPersistenceV1Error;

export type PointMutationSessionAttemptTerminalizationPersistenceOperationV1 =
  | TrustedScopeAuthorityPortOperation
  | "attemptAbortTransaction"
  | "attemptExpireTransaction";

export class PointMutationSessionAttemptTerminalizationPersistenceV1Error
  extends Data.TaggedError(
    "PointMutationSessionAttemptTerminalizationPersistenceV1Error",
  )<{
    readonly operation:
      PointMutationSessionAttemptTerminalizationPersistenceOperationV1;
    readonly cause: unknown;
  }> {}

export type PointMutationSessionAttemptTerminalizationEffectErrorV1 =
  | TrustedScopeAuthorityResolutionError
  | PointMutationSessionAttemptTerminalizationV1Error
  | PointMutationSessionAuthorityCorruptionV1Error
  | PointMutationSessionAttemptTerminalizationTargetV1Error
  | PointMutationSessionAttemptTerminalizationPersistenceV1Error;

export function activationError(
  issue: PointMutationSessionActivationIssueV1,
): PointMutationSessionActivationV1Error {
  return new PointMutationSessionActivationV1Error(issue);
}

export function attemptLoadError(
  issue: PointMutationSessionAttemptLoadIssueV1,
): PointMutationSessionAttemptLoadV1Error {
  return new PointMutationSessionAttemptLoadV1Error(issue);
}

export function attemptTerminalizationError(
  issue: PointMutationSessionAttemptTerminalizationIssueV1,
): PointMutationSessionAttemptTerminalizationV1Error {
  return new PointMutationSessionAttemptTerminalizationV1Error(issue);
}

export function corruptionError(
  scopeId: ScopeId,
  issue: PointMutationSessionAuthorityCorruptionIssueV1,
  cause?: unknown,
): PointMutationSessionAuthorityCorruptionV1Error {
  return new PointMutationSessionAuthorityCorruptionV1Error(
    scopeId,
    issue,
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Temporary projection owned by Drizzle 0.45's Promise transaction callbacks.
 * Delete it when activation, acquisition, reload, and terminalization yield
 * Result or Effect failures directly from an Effect-native transaction client.
 */
export function projectTransactionSessionActivationResult<A, E>(
  result: Result.Result<A, E>,
): A {
  // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: transaction - native Drizzle callbacks require rejection with the exact Result failure to trigger rollback and preserve nominal failure projection
  return Result.getOrThrow(result);
}

export class ExactRunningAttemptTransactionV1Error extends Data.TaggedError(
  "ExactRunningAttemptTransactionV1Error",
)<{
  readonly cause: unknown;
  readonly callbackCause: Cause.Cause<unknown> | undefined;
}> {}

import type { ApplicationActiveSelection } from "../../application/activation/contracts";
import type { ApplicationActivationError } from "../../application/activation/errors";
import type {
  LOCATED_READ_COMMITTED_RUNNER_V1,
  RunLocatedReadCommittedTransactionV1,
} from "../../database/locatedTransactionIdentity";
import type {
  PreparedCoLocatedReadInstallation,
  PreparedInstallation,
} from "../../installation/installationLifecycle";
import type { INSTALLED_SCOPE_AUTHORITY_TARGET } from "../../scope/scopeAuthorityControlRead";
import type {
  ExactScopeMetadataReader,
  LocatedScopeClockReader,
  ScopeClockTargetReaderResolver,
  ScopeMetadataReader,
  ScopeProvisioningReceiptReader,
  TrustedScopeAuthority,
} from "../../scope/scopeAuthorityResolution";
import type {
  PointMutationExecutionClaimAcquisitionV1Error,
} from "../claims/transactionExecutionClaimErrors";
import type {
  LocatedPointMutationExecutionClaimLivenessTargetV1,
} from "../claims/transactionExecutionClaimLiveness";
import type {
  TransactionExecutionClaimOwnerV1,
  TransactionExecutionClaimPinV1,
} from "../claims/transactionExecutionClaimModel";
import type {
  FiniteStorageCaptureProfile,
  FiniteStorageCaptureTarget,
} from "../finiteStorageCapture";
import type { PreparedFiniteSessionJournalEntry } from "../journal/finiteEntry";
import type { runPreparedFiniteSessionJournalEntryEffect } from "../journal/finiteEntryActivation";
import type { ProtectedMetadataPreparation } from "../preparation/preparedMetadataEpoch";
import type {
  LocatedPointMutationAttemptDiscoveryTargetV1,
} from "../recovery/pointMutationAttemptDiscovery";
import type {
  PointMutationExecutionClaimAcquisitionResultV1,
  PointMutationSessionActivationResultV1,
  PointMutationSessionAttemptLoadResultV1,
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationResultV1,
  PreparedFiniteApplicationMutationSessionActivation,
  PreparedStoredMutationSessionActivationV1,
} from "./contracts";
import {
  PointMutationSessionActivationTargetV1Error,
  PointMutationSessionAttemptLoadTargetV1Error,
  PointMutationSessionAttemptTerminalizationTargetV1Error,
  type FiniteApplicationMutationSessionActivationError,
  type PointMutationSessionActivationPersistenceV1Error,
  type PointMutationSessionActivationV1Error,
  type PointMutationSessionAttemptLoadPersistenceV1Error,
  type PointMutationSessionAttemptLoadV1Error,
  type PointMutationSessionAttemptTerminalizationPersistenceV1Error,
  type PointMutationSessionAttemptTerminalizationV1Error,
  type PointMutationSessionAuthorityCorruptionV1Error,
} from "./errors";
import type {
  LocatedExactRunningAttemptKernelV1,
  LocatedExactRunningAttemptReadSyscallKernelV1,
  LocatedPointCommitPublicationTargetV1,
} from "./kernelContracts";
import { Result, type Effect } from "effect";
import type { ScopeId, SnapshotToken } from "flarex-protocol/storage-authority";
import type { TransactionSessionIdV1 } from "flarex-protocol/transaction-session";

export const ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.activatePreparedPointMutationSessionEffectV1",
);

export const ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.activateApplicationMutationSessionEffectV1",
);

export const ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT = Symbol(
  "flarex.persistence-postgres.activateFiniteApplicationMutationSession",
);

export const LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.loadExactPointMutationSessionAttemptEffectV1",
);

export const TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.terminalizeExactPointMutationSessionAttemptEffectV1",
);

export const ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1 = Symbol(
  "flarex.persistence-postgres.acquirePointMutationExecutionClaimEffectV1",
);

export interface PointMutationSessionAuthorityResolutionPortsV1 {
  readonly scopeMetadata: ExactScopeMetadataReader & ScopeMetadataReader;
  readonly provisioningReceipts: ScopeProvisioningReceiptReader;
  readonly scopeSessionTargets: ScopeClockTargetReaderResolver;
}

export type PointMutationSessionActivationResolutionPortsV1 =
  PointMutationSessionAuthorityResolutionPortsV1;

export interface PointMutationSessionActivationPersistenceOptionsV1 {
  readonly leaseDurationMilliseconds: number;
  readonly randomUuid?: () => string;
  readonly executionClaimDurationMilliseconds?: number;
  readonly randomExecutionClaimOwner?: () => string;
}

export interface PointMutationExecutionClaimAcquisitionOptionsV1 {
  readonly durationMilliseconds: number;
  readonly randomOwner?: () => string;
}

export type PointMutationSessionActivationWriteStepV1 =
  | "sessionInserted"
  | "leaseInserted"
  | "journalRootInserted"
  | "executionClaimInserted";

export type PointMutationSessionAttemptLoadLockStepV1 =
  | "clockLocked"
  | "sessionLocked"
  | "leaseLocked"
  | "attemptTailLocked"
  | "journalRootLocked"
  | "executionClaimLocked";

export type PointMutationSessionAttemptTerminalizationOperationV1 =
  | "abort"
  | "expire";

export type PointMutationSessionAttemptTerminalizationEventV1 =
  | {
      readonly phase: "lock";
      readonly operation: PointMutationSessionAttemptTerminalizationOperationV1;
      readonly step: PointMutationSessionAttemptLoadLockStepV1;
    }
  | {
      readonly phase: "write";
      readonly operation: PointMutationSessionAttemptTerminalizationOperationV1;
      readonly step:
        | "journalDeleted"
        | "leaseDeleted"
        | "sessionTerminalized";
    };

/** Installed captures borrow only the construction-owned implicit-read driver. */
export const FINITE_STORAGE_CAPTURE_DRIVER: unique symbol = Symbol("FlarexDB/finiteStorageCaptureDriver");

export const FINITE_STORAGE_CAPTURE_AUTHORITY: unique symbol = Symbol("FlarexDB/finiteStorageCaptureAuthority");

export interface LocatedPointMutationSessionActivationTargetOptionsV1 {
  readonly directInstallation?: PreparedInstallation;
  readonly [FINITE_STORAGE_CAPTURE_DRIVER]?: Extract<FiniteStorageCaptureProfile, { kind: "installed" }>["driver"];
  readonly [FINITE_STORAGE_CAPTURE_AUTHORITY]?: Extract<FiniteStorageCaptureProfile, { kind: "fullArtifact" }>["authority"];
  readonly managedInstallation?: Readonly<{ installation: PreparedCoLocatedReadInstallation;
    controlProtection: ProtectedMetadataPreparation }>;
  /** Internal connected-client runner; its symbol is not package-exported. */
  readonly [LOCATED_READ_COMMITTED_RUNNER_V1]?:
    RunLocatedReadCommittedTransactionV1;
  /** Construction-bound instrumentation used by focused rollback proofs. */
  readonly afterWrite?: (
    step: PointMutationSessionActivationWriteStepV1,
  ) => void | Promise<void>;
  /** Construction-bound instrumentation used by focused lock-order proofs. */
  readonly afterLoadLock?: (
    step: PointMutationSessionAttemptLoadLockStepV1,
  ) => void | Promise<void>;
  /** Construction-bound instrumentation used by focused B2b1 proofs. */
  readonly afterTerminalizationEvent?: (
    event: PointMutationSessionAttemptTerminalizationEventV1,
  ) => void | Promise<void>;
  /** Construction-bound instrumentation used by focused b1a proofs. */
  readonly afterExecutionClaimLivenessEvent?: (
    event: PointMutationExecutionClaimLivenessEventV1,
  ) => void | Promise<void>;
}

export type PointMutationExecutionClaimLivenessEventV1 =
  | Readonly<{
      readonly phase: "lock";
      readonly step:
        | "clockLocked"
        | "sessionLocked"
        | "leaseLocked"
        | "journalRootLocked"
        | "executionClaimLocked";
    }>
  | Readonly<{
      readonly phase: "write";
      readonly step: "leaseRenewed" | "executionClaimRenewed";
    }>;

export interface LocatedPointMutationSessionActivationTargetV1
  extends LocatedScopeClockReader {
  readonly [INSTALLED_SCOPE_AUTHORITY_TARGET]?: true;
  readonly [ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1]: (
    input: LocatedPointMutationSessionActivationInputV1,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    | PointMutationSessionActivationV1Error
    | PointMutationSessionAuthorityCorruptionV1Error
    | PointMutationSessionActivationPersistenceV1Error
  >;
  readonly [ACTIVATE_APPLICATION_MUTATION_SESSION_EFFECT_V1]: (
    input: LocatedPointMutationSessionActivationInputV1,
    selection: ApplicationActiveSelection,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    | PointMutationSessionActivationV1Error
    | PointMutationSessionAuthorityCorruptionV1Error
    | PointMutationSessionActivationPersistenceV1Error
    | ApplicationActivationError
  >;
  readonly [ACTIVATE_FINITE_APPLICATION_MUTATION_SESSION_EFFECT]: (
    input: LocatedPointMutationSessionActivationInputV1,
    prepared: PreparedFiniteApplicationMutationSessionActivation,
    entry: PreparedFiniteSessionJournalEntry,
  ) => Effect.Effect<Readonly<{
    activation: PointMutationSessionActivationResultV1;
    capture?: Effect.Success<ReturnType<typeof runPreparedFiniteSessionJournalEntryEffect>>;
  }>, FiniteApplicationMutationSessionActivationError>;
}

interface LocatedPointMutationSessionAttemptLoadTargetV1
  extends LocatedScopeClockReader {
  readonly [LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]: (
    input: LocatedPointMutationSessionAttemptLoadInputV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptLoadResultV1,
    | PointMutationSessionAttemptLoadV1Error
    | PointMutationSessionAuthorityCorruptionV1Error
    | PointMutationSessionAttemptLoadPersistenceV1Error
  >;
}

interface LocatedPointMutationSessionAttemptTerminalizationTargetV1
  extends LocatedScopeClockReader {
  readonly [TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1]: (
    input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptTerminalizationResultV1,
    | PointMutationSessionAttemptTerminalizationV1Error
    | PointMutationSessionAuthorityCorruptionV1Error
    | PointMutationSessionAttemptTerminalizationPersistenceV1Error
  >;
}

export interface LocatedPointMutationExecutionClaimAcquisitionTargetV1
  extends LocatedScopeClockReader {
  readonly [ACQUIRE_POINT_MUTATION_EXECUTION_CLAIM_EFFECT_V1]: (
    input: Readonly<{
      readonly selector: PointMutationSessionAttemptSelectorV1;
      readonly preliminaryAuthority: TrustedScopeAuthority;
      readonly durationMilliseconds: number;
      readonly randomOwner: () => string;
    }>,
  ) => Effect.Effect<
    PointMutationExecutionClaimAcquisitionResultV1,
    PointMutationExecutionClaimAcquisitionV1Error
  >;
}

export interface LocatedPointMutationSessionTargetV1
  extends LocatedPointMutationSessionActivationTargetV1,
    LocatedPointMutationSessionAttemptLoadTargetV1,
    LocatedPointMutationSessionAttemptTerminalizationTargetV1,
    LocatedPointMutationExecutionClaimAcquisitionTargetV1,
    LocatedPointMutationAttemptDiscoveryTargetV1,
    LocatedPointMutationExecutionClaimLivenessTargetV1,
    LocatedExactRunningAttemptKernelV1,
    LocatedExactRunningAttemptReadSyscallKernelV1,
    FiniteStorageCaptureTarget,
    LocatedPointCommitPublicationTargetV1 {}

export interface LocatedPointMutationSessionActivationInputV1 {
  readonly prepared: PreparedStoredMutationSessionActivationV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly candidateSessionId: TransactionSessionIdV1;
  readonly leaseDurationMilliseconds: number;
  readonly executionClaimDurationMilliseconds: number;
  readonly executionClaimOwner: TransactionExecutionClaimOwnerV1;
}

export interface LocatedPointMutationSessionAttemptLoadInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
}

export type PreparedPointMutationSessionAttemptTerminalizationInputV1 =
  | {
      readonly operation: "abort";
      readonly selector: PointMutationSessionAttemptSelectorV1;
      readonly expectedSnapshotToken: SnapshotToken;
      readonly executionClaim: TransactionExecutionClaimPinV1;
    }
  | {
      readonly operation: "expire";
      readonly selector: PointMutationSessionAttemptSelectorV1;
    };

export type LocatedPointMutationSessionAttemptTerminalizationInputV1 =
  PreparedPointMutationSessionAttemptTerminalizationInputV1 & {
    readonly preliminaryAuthority: TrustedScopeAuthority;
  };

export function requireActivationTarget(
  target: LocatedScopeClockReader,
  scopeId: ScopeId,
): Result.Result<
  LocatedPointMutationSessionActivationTargetV1,
  PointMutationSessionActivationTargetV1Error
> {
  if (!isActivationTarget(target)) {
    return Result.fail(
      new PointMutationSessionActivationTargetV1Error(scopeId),
    );
  }
  return Result.succeed(target);
}

export function requireAttemptLoadTarget(
  target: LocatedScopeClockReader,
  scopeId: ScopeId,
): Result.Result<
  LocatedPointMutationSessionAttemptLoadTargetV1,
  PointMutationSessionAttemptLoadTargetV1Error
> {
  if (!isAttemptLoadTarget(target)) {
    return Result.fail(new PointMutationSessionAttemptLoadTargetV1Error(scopeId));
  }
  return Result.succeed(target);
}

export function requireAttemptTerminalizationTarget(
  target: LocatedScopeClockReader,
  scopeId: ScopeId,
): Result.Result<
  LocatedPointMutationSessionAttemptTerminalizationTargetV1,
  PointMutationSessionAttemptTerminalizationTargetV1Error
> {
  if (!isAttemptTerminalizationTarget(target)) {
    return Result.fail(
      new PointMutationSessionAttemptTerminalizationTargetV1Error(scopeId),
    );
  }
  return Result.succeed(target);
}

function isActivationTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationSessionActivationTargetV1 {
  return typeof Reflect.get(
    target,
    ACTIVATE_PREPARED_POINT_MUTATION_SESSION_EFFECT_V1,
  ) === "function";
}

function isAttemptLoadTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationSessionAttemptLoadTargetV1 {
  return typeof Reflect.get(
    target,
    LOAD_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1,
  ) === "function";
}

function isAttemptTerminalizationTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationSessionAttemptTerminalizationTargetV1 {
  return typeof Reflect.get(
    target,
    TERMINALIZE_EXACT_POINT_MUTATION_SESSION_ATTEMPT_EFFECT_V1,
  ) === "function";
}

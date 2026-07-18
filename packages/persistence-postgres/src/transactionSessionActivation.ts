import { bytesEqual } from "@flarex/utils/bytes";
import {
  copyFiniteDate,
  finiteDateMilliseconds,
} from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { and, asc, eq, sql } from "drizzle-orm";
import { Data, Effect, Exit, Result, Schema } from "effect";
import type { Cause } from "effect/Cause";

import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
} from "flarex-protocol/commit-protocol";
import {
  isJsonArray,
  isJsonObject,
  isJsonObjectFromUnknown,
  jsonEqual,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import {
  decodeCatalogSchemaVersionId,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  ReplacementScopeIdV1Schema,
  decodeReplacementScopeEpochV1,
  decodeReplacementScopeIdV1,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
  replacementScopeEpochV1FromUuid,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ReplacementScopeIdV1,
  type ScopeEpoch,
  type ScopeEpochUuidV1,
  type ScopeId,
  type ScopeUuidV1,
  type SnapshotToken,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  CanonicalTransactionArgumentsBytesV1Schema,
  CanonicalTransactionAuthorizationGrantBytesV1Schema,
  TransactionAttemptFenceSchema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationGrantSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSessionIdV1Schema,
  type TransactionAttemptFence,
  type TransactionAuthorizationRevocationEpoch,
  type TransactionSessionLifecycleV1,
  type TransactionRequestKeyV1,
  type TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";

import type { FlarexMetadataDatabase } from "./deployments";
import type { AppRowTransaction } from "./appRows";
import {
  createCommittedPointOutcomeResolverV1,
} from "./committedPointOutcome";
import {
  getScopeClock,
  decodeScopeClockRecord,
  ScopeClockNotFoundError,
  type ScopeClockRecord,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  TrustedScopeAuthorityPortError,
  type LocatedScopeClockReader,
  type ScopeClockTargetReaderResolver,
  type ScopeMetadataReader,
  type ScopeProvisioningReceiptReader,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityPortOperation,
  type TrustedScopeAuthorityResolutionError,
} from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import {
  resolvePinnedPointTableIdV1Effect,
} from "./pinnedPointTableResolution";
import {
  fxSystemScopeClocks,
  fxSystemSnapshotLeases,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalWriteEvents,
  fxSystemTransactionJournals,
  fxSystemTransactionSessions,
} from "./schema";
import {
  buildFreshTransactionAttemptFacetV1,
  isPristineFreshTransactionAttemptJournalRootV1,
} from "./transactionSessionAttemptFacet";
import {
  RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1,
  RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
  ExactRunningAttemptTransactionV1Error,
  LocatedReadCommittedTransactionFailureV1,
  RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1,
  RUN_LOCATED_READ_COMMITTED_V1,
  RUN_LOCATED_REPEATABLE_READ_V1,
  reconcileExactRunningAttemptTransactionFailureV1,
  type ExactRunningAttemptKernelContextV1,
  type ExactRunningAttemptEffectWorkV1,
  type ExactRunningAttemptKernelInputV1,
  type LocatedExactRunningAttemptKernelV1,
  type LocatedPointCommitPublicationTargetV1,
} from "./transactionSessionAttemptKernel";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const INITIAL_ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(1n);

const decodeAttemptDeploymentIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionGrantDeploymentIdV1Schema),
);
const decodeAttemptScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ReplacementScopeIdV1Schema),
);
const decodeAttemptSessionIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionSessionIdV1Schema),
);
const decodeAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);
const decodeAttemptSnapshotTokenResult = Schema.decodeUnknownResult(
  Schema.toType(SnapshotTokenSchema),
);

export interface PointMutationSessionAuthorityResolutionPortsV1 {
  readonly scopeMetadata: ScopeMetadataReader;
  readonly provisioningReceipts: ScopeProvisioningReceiptReader;
  readonly scopeSessionTargets: ScopeClockTargetReaderResolver;
}

export type PointMutationSessionActivationResolutionPortsV1 =
  PointMutationSessionAuthorityResolutionPortsV1;

export interface PointMutationSessionActivationPersistenceOptionsV1 {
  readonly leaseDurationMilliseconds: number;
  readonly randomUuid?: () => string;
}

type TransactionSessionInsert =
  typeof fxSystemTransactionSessions.$inferInsert;
type TransactionSessionRow =
  typeof fxSystemTransactionSessions.$inferSelect;
type SnapshotLeaseRow = typeof fxSystemSnapshotLeases.$inferSelect;

export type PreparedPointMutationSessionEvidenceV1 = Readonly<
  Pick<
    TransactionSessionInsert,
    | "packageId"
    | "artifactRuntime"
    | "artifactId"
    | "sourcePackageHash"
    | "executionModule"
    | "functionPath"
    | "functionKind"
    | "schemaVersionId"
    | "policyVersion"
    | "identityAccessPolicySha256"
    | "validatedArgsJson"
    | "validatedArgsValueCodecVersion"
    | "validatedArgsCanonicalBytes"
    | "validatedArgsSha256"
    | "authorizationGrantId"
    | "authorizationGrantJson"
    | "authorizationGrantValueCodecVersion"
    | "authorizationGrantCanonicalBytes"
    | "authorizationGrantSha256"
    | "authorizationRevocationEpoch"
    | "authorizationGrantExpiresAt"
    | "requestKey"
    | "requestSha256"
  >
>;

export interface PreparedPointMutationSessionActivationV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly evidence: PreparedPointMutationSessionEvidenceV1;
}

export interface PointMutationSessionAttemptSelectorV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
}

export interface PointMutationSessionAnchorV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly requestKey: TransactionRequestKeyV1;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly attemptFence: TransactionAttemptFence;
  readonly snapshotToken: SnapshotToken;
  readonly hardExpiresAt: string;
  readonly leaseExpiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PointMutationSessionActivationResultV1 =
  | {
      readonly status: "created";
      readonly anchor: PointMutationSessionAnchorV1;
    }
  | {
      readonly status: "replayed";
      readonly anchor: PointMutationSessionAnchorV1;
    };

export interface PointMutationSessionAttemptLoadResultV1 {
  readonly status: "loaded";
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionPin: PointMutationSessionAttemptExecutionPinV1;
  /** Temporal, non-authorizing evidence captured under the exact root lock. */
  readonly attemptFacet: PointMutationSessionAttemptFacetObservationV1;
}

export interface PointMutationSessionAttemptFacetObservationV1 {
  readonly kind: "pristineOpen" | "nonPristine";
}

/** Private execution input reloaded from the authoritative exact attempt. */
export interface PointMutationSessionAttemptExecutionPinV1 {
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export type PointMutationSessionActiveLifecycleV1 = Extract<
  TransactionSessionLifecycleV1,
  "running" | "finishing"
>;

export type PointMutationSessionTerminalLifecycleV1 = Extract<
  TransactionSessionLifecycleV1,
  "committed" | "aborted" | "expired"
>;

export type PointMutationSessionTerminalizedLifecycleV1 = Extract<
  PointMutationSessionTerminalLifecycleV1,
  "aborted" | "expired"
>;

export interface PointMutationSessionTerminalObservationV1<
  Lifecycle extends PointMutationSessionTerminalLifecycleV1 =
    PointMutationSessionTerminalLifecycleV1,
> extends PointMutationSessionAttemptSelectorV1 {
  readonly lifecycle: Lifecycle;
  readonly terminalizedAt: string;
}

export type PointMutationSessionAttemptTerminalizationResultV1 =
  | {
      readonly status: "terminalized";
      readonly terminal: PointMutationSessionTerminalObservationV1<
        PointMutationSessionTerminalizedLifecycleV1
      >;
    }
  | {
      readonly status: "observed";
      readonly terminal: PointMutationSessionTerminalObservationV1;
    };

export interface PointMutationSessionAttemptAbortInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly expectedSnapshotToken: SnapshotToken;
}

export interface PointMutationSessionActivationPersistenceV1 {
  readonly activateEffect: (
    input: PreparedPointMutationSessionActivationV1,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    PointMutationSessionActivationEffectErrorV1
  >;
}

export interface PointMutationSessionAttemptLoadPersistenceV1 {
  readonly loadEffect: (
    selector: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptLoadResultV1,
    PointMutationSessionAttemptLoadEffectErrorV1
  >;
}

export interface PointMutationSessionAttemptTerminalizationPersistenceV1 {
  readonly abortEffect: (
    input: PointMutationSessionAttemptAbortInputV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  >;
  readonly expireEffect: (
    selector: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  >;
}

export type PointMutationSessionActivationConfigurationIssueV1 =
  | { readonly reason: "invalidLeaseDuration" }
  | { readonly reason: "invalidGeneratedSessionId"; readonly value: string }
  | { readonly reason: "sessionIdGenerationFailed"; readonly cause: unknown };

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
  | { readonly reason: "activeAttemptExpired" };

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
  | { readonly reason: "selectorScopeMismatch" }
  | { readonly reason: "sessionMissing" }
  | { readonly reason: "staleAttemptFence" }
  | {
      readonly reason: "attemptNotTerminalizable";
      readonly lifecycle: Exclude<
        TransactionSessionLifecycleV1,
        PointMutationSessionActiveLifecycleV1 |
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
    };

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

export type PointMutationSessionActivationWriteStepV1 =
  | "sessionInserted"
  | "leaseInserted"
  | "journalRootInserted";

export type PointMutationSessionAttemptLoadLockStepV1 =
  | "clockLocked"
  | "sessionLocked"
  | "leaseLocked"
  | "journalRootLocked";

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

export interface LocatedPointMutationSessionActivationTargetOptionsV1 {
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
}

interface LocatedPointMutationSessionActivationTargetV1
  extends LocatedScopeClockReader {
  readonly activatePreparedPointMutationSession: (
    input: LocatedPointMutationSessionActivationInputV1,
  ) => Promise<PointMutationSessionActivationResultV1>;
}

interface LocatedPointMutationSessionAttemptLoadTargetV1
  extends LocatedScopeClockReader {
  readonly loadExactPointMutationSessionAttempt: (
    input: LocatedPointMutationSessionAttemptLoadInputV1,
  ) => Promise<PointMutationSessionAttemptLoadResultV1>;
}

interface LocatedPointMutationSessionAttemptTerminalizationTargetV1
  extends LocatedScopeClockReader {
  readonly terminalizeExactPointMutationSessionAttempt: (
    input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
  ) => Promise<PointMutationSessionAttemptTerminalizationResultV1>;
}

interface LocatedPointMutationSessionTargetV1
  extends LocatedPointMutationSessionActivationTargetV1,
    LocatedPointMutationSessionAttemptLoadTargetV1,
    LocatedPointMutationSessionAttemptTerminalizationTargetV1,
    LocatedExactRunningAttemptKernelV1,
    LocatedPointCommitPublicationTargetV1 {}

interface LocatedPointMutationSessionActivationInputV1 {
  readonly prepared: PreparedPointMutationSessionActivationV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
  readonly candidateSessionId: TransactionSessionIdV1;
  readonly leaseDurationMilliseconds: number;
}

interface LocatedPointMutationSessionAttemptLoadInputV1 {
  readonly selector: PointMutationSessionAttemptSelectorV1;
  readonly preliminaryAuthority: TrustedScopeAuthority;
}

type PreparedPointMutationSessionAttemptTerminalizationInputV1 =
  | {
      readonly operation: "abort";
      readonly selector: PointMutationSessionAttemptSelectorV1;
      readonly expectedSnapshotToken: SnapshotToken;
    }
  | {
      readonly operation: "expire";
      readonly selector: PointMutationSessionAttemptSelectorV1;
    };

type LocatedPointMutationSessionAttemptTerminalizationInputV1 =
  PreparedPointMutationSessionAttemptTerminalizationInputV1 & {
    readonly preliminaryAuthority: TrustedScopeAuthority;
  };

interface LockedPointMutationSessionClockV1 {
  readonly record: ScopeClockRecord;
  readonly scopeUuid: ScopeUuidV1;
  readonly epochUuid: ScopeEpochUuidV1;
  readonly authorizationRevocationEpoch:
    TransactionAuthorizationRevocationEpoch;
}

export function createPointMutationSessionActivationPersistenceV1(
  ports: PointMutationSessionActivationResolutionPortsV1,
  options: PointMutationSessionActivationPersistenceOptionsV1,
): PointMutationSessionActivationPersistenceV1 {
  const leaseDurationMilliseconds = requireLeaseDuration(
    options.leaseDurationMilliseconds,
  );
  const randomUuid = options.randomUuid ?? (() => crypto.randomUUID());

  const activateEffect = Effect.fn("PointMutationSessionActivation.activate")(
    function* (
      input: PreparedPointMutationSessionActivationV1,
    ): Effect.fn.Return<
      PointMutationSessionActivationResultV1,
      PointMutationSessionActivationEffectErrorV1
    > {
      const prepared = yield* Effect.fromResult(
        capturePreparedActivation(input),
      );
      const candidateSessionId = yield* generateSessionIdEffect(randomUuid);
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        prepared.deploymentId,
        {
          scopeMetadata: ports.scopeMetadata,
          provisioningReceipts: ports.provisioningReceipts,
          scopeClockTargets: ports.scopeSessionTargets,
        },
      ).pipe(Effect.mapError(mapActivationAuthorityError));
      if (located.authority.scopeId !== prepared.scopeId) {
        return yield* Effect.fail(activationError({ reason: "scopeMismatch" }));
      }
      const target = yield* Effect.fromResult(requireActivationTarget(
        located.target,
        prepared.scopeId,
      ));
      return yield* Effect.uninterruptible(Effect.tryPromise({
        try: () => target.activatePreparedPointMutationSession({
          prepared,
          preliminaryAuthority: located.authority,
          candidateSessionId,
          leaseDurationMilliseconds,
        }),
        catch: mapActivationTransactionError,
      }));
    },
  );

  return Object.freeze({ activateEffect });
}

export function createPointMutationSessionAttemptLoadPersistenceV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): PointMutationSessionAttemptLoadPersistenceV1 {
  const loadEffect = Effect.fn("PointMutationSessionAttemptLoad.load")(
    function* (
      input: PointMutationSessionAttemptSelectorV1,
    ): Effect.fn.Return<
      PointMutationSessionAttemptLoadResultV1,
      PointMutationSessionAttemptLoadEffectErrorV1
    > {
      const selector = yield* Effect.fromResult(captureAttemptSelector(input));
      const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
        selector.deploymentId,
        {
          scopeMetadata: ports.scopeMetadata,
          provisioningReceipts: ports.provisioningReceipts,
          scopeClockTargets: ports.scopeSessionTargets,
        },
      ).pipe(Effect.mapError(mapAttemptLoadAuthorityError));
      if (located.authority.scopeId !== selector.scopeId) {
        return yield* Effect.fail(
          attemptLoadError({ reason: "selectorScopeMismatch" }),
        );
      }
      const target = yield* Effect.fromResult(
        requireAttemptLoadTarget(located.target, selector.scopeId),
      );
      return yield* Effect.uninterruptible(
        Effect.tryPromise({
          try: () => target.loadExactPointMutationSessionAttempt({
            selector,
            preliminaryAuthority: located.authority,
          }),
          catch: mapAttemptLoadTransactionError,
        }),
      );
    },
  );

  return Object.freeze({ loadEffect });
}

export function createPointMutationSessionAttemptTerminalizationPersistenceV1(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
): PointMutationSessionAttemptTerminalizationPersistenceV1 {
  const terminalize = Effect.fn(function* (
    input: PreparedPointMutationSessionAttemptTerminalizationInputV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      input.selector.deploymentId,
      {
        scopeMetadata: ports.scopeMetadata,
        provisioningReceipts: ports.provisioningReceipts,
        scopeClockTargets: ports.scopeSessionTargets,
      },
    ).pipe(Effect.mapError(mapAttemptTerminalizationAuthorityError));
    if (located.authority.scopeId !== input.selector.scopeId) {
      return yield* Effect.fail(
        attemptTerminalizationError({ reason: "selectorScopeMismatch" }),
      );
    }
    const target = yield* Effect.fromResult(
      requireAttemptTerminalizationTarget(
        located.target,
        input.selector.scopeId,
      ),
    );
    return yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () => target.terminalizeExactPointMutationSessionAttempt({
          ...input,
          preliminaryAuthority: located.authority,
        }),
        catch: (cause) => mapAttemptTerminalizationTransactionError(
          input.operation,
          cause,
        ),
      }),
    );
  });

  const abortEffect = Effect.fn(
    "PointMutationSessionAttemptTerminalization.abort",
  )(function* (
    input: PointMutationSessionAttemptAbortInputV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const captured = yield* Effect.fromResult(captureAttemptAbortInput(input));
    return yield* terminalize({
      operation: "abort",
      selector: captured.selector,
      expectedSnapshotToken: captured.expectedSnapshotToken,
    });
  });

  const expireEffect = Effect.fn(
    "PointMutationSessionAttemptTerminalization.expire",
  )(function* (
    input: PointMutationSessionAttemptSelectorV1,
  ): Effect.fn.Return<
    PointMutationSessionAttemptTerminalizationResultV1,
    PointMutationSessionAttemptTerminalizationEffectErrorV1
  > {
    const selector = yield* Effect.fromResult(
      captureTerminalizationAttemptSelector(input),
    );
    return yield* terminalize({
      operation: "expire",
      selector,
    });
  });

  return Object.freeze({ abortEffect, expireEffect });
}

export function createLocatedPointMutationSessionActivationTargetV1(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): LocatedScopeClockReader {
  const capturedLocator = captureScopePhysicalLocator(physicalLocator);
  const afterWrite = options.afterWrite;
  const afterLoadLock = options.afterLoadLock;
  const afterTerminalizationEvent = options.afterTerminalizationEvent;
  const committedOutcomeResolver = createCommittedPointOutcomeResolverV1(db);
  const target = Object.freeze({
    physicalLocator: capturedLocator,
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    activatePreparedPointMutationSession: (
      input: LocatedPointMutationSessionActivationInputV1,
    ) => db.transaction((tx) => activateInTransaction(tx, input, afterWrite)),
    loadExactPointMutationSessionAttempt: (
      input: LocatedPointMutationSessionAttemptLoadInputV1,
    ) => db.transaction((tx) =>
      loadAttemptInTransaction(tx, input, afterLoadLock)),
    [RUN_EXACT_RUNNING_POINT_MUTATION_ATTEMPT_EFFECT_V1]: <Result, Failure>(
      input: ExactRunningAttemptKernelInputV1,
      work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
    ): Effect.Effect<
      Result,
      Failure | ExactRunningAttemptTransactionV1Error
    > => runExactRunningAttemptEffectTransaction(
      db,
      input,
      work,
      afterLoadLock,
    ),
    [RESOLVE_PINNED_POINT_TABLE_ID_EFFECT_V1]:
      resolvePinnedPointTableIdV1Effect.bind(
        undefined,
        db,
      ),
    [RUN_LOCATED_REPEATABLE_READ_V1]: <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => db.transaction(async (tx) => {
      await tx.setTransaction({
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
      return work(tx);
    }),
    [RUN_LOCATED_READ_COMMITTED_V1]: <Result>(
      work: (tx: AppRowTransaction) => Promise<Result>,
    ): Promise<Result> => {
      let callbackRejected = false;
      let callbackCause: unknown;
      const run = db.transaction(async (tx) => {
        await tx.setTransaction({ isolationLevel: "read committed" });
        try {
          return await work(tx);
        } catch (cause) {
          callbackRejected = true;
          callbackCause = cause;
          throw cause;
        }
      });
      return run.catch((cause: unknown) => {
        if (callbackRejected && cause === callbackCause) {
          throw cause;
        }
        throw new LocatedReadCommittedTransactionFailureV1(
          cause,
          callbackRejected ? callbackCause : undefined,
        );
      });
    },
    [RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1]:
      committedOutcomeResolver.resolve,
    terminalizeExactPointMutationSessionAttempt: (
      input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
    ) => db.transaction((tx) =>
      terminalizeAttemptInTransaction(
        tx,
        input,
        afterTerminalizationEvent,
      )),
  } satisfies LocatedPointMutationSessionTargetV1);
  return target;
}

// Keep this driver-callback runner as a plain named boundary so the workspace
// runtime audit attributes its sole Effect.runPromise call exactly here.
function runExactRunningAttemptEffectTransaction<Result, Failure>(
  db: FlarexMetadataDatabase,
  input: ExactRunningAttemptKernelInputV1,
  work: ExactRunningAttemptEffectWorkV1<Result, Failure>,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
): Effect.Effect<Result, Failure | ExactRunningAttemptTransactionV1Error> {
  return Effect.suspend(() => {
    let callbackCause: Cause<Failure> | undefined;
    const rollbackSignal = new Error(
      "Effect exact-attempt work failed; roll back the transaction.",
    );
    return Effect.uninterruptible(
      Effect.tryPromise({
        try: () => db.transaction(async (tx): Promise<Result> => {
          const context = await loadExactRunningAttemptForKernelInTransaction(
            tx,
            input,
            afterLoadLock,
          );
          const exit = await Effect.runPromise(Effect.exit(
            Effect.uninterruptible(Effect.suspend(() => work(tx, context))),
          ));
          if (Exit.isFailure(exit)) {
            callbackCause = exit.cause;
            throw rollbackSignal;
          }
          return exit.value;
        }),
        catch: (cause) => new ExactRunningAttemptTransactionV1Error({
          cause,
          callbackCause,
        }),
      }).pipe(
        Effect.catch((failure) =>
          reconcileExactRunningAttemptTransactionFailureV1(
            failure,
            callbackCause,
            rollbackSignal,
          )),
      ),
    );
  });
}

async function activateInTransaction(
  tx: FlarexMetadataDatabase,
  input: LocatedPointMutationSessionActivationInputV1,
  afterWrite:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]
    | undefined,
): Promise<PointMutationSessionActivationResultV1> {
  const clock = await lockPointMutationSessionClock(
    tx,
    input.prepared.scopeId,
  );
  requireStableAuthority(clock, input);
  const matchingSessions = await tx
    .select()
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(
        fxSystemTransactionSessions.requestKey,
        input.prepared.evidence.requestKey,
      ),
    ))
    .orderBy(asc(fxSystemTransactionSessions.sessionId))
    .limit(2)
    .for("update");

  if (matchingSessions.length > 1) {
    throw corruptionError(
      input.prepared.scopeId,
      "duplicateRequestAnchors",
    );
  }
  const existing = matchingSessions[0];
  if (existing !== undefined) {
    return replayExistingSession(
      tx,
      input.prepared,
      clock,
      existing,
    );
  }

  if (
    clock.record.lastCommitSeq !==
    input.preliminaryAuthority.lastCommitSeq
  ) {
    throw activationError({ reason: "snapshotCommitSeqChanged" });
  }
  const databaseNow = await readDatabaseNow(tx, input.prepared.scopeId);
  return createSession(
    tx,
    input,
    clock,
    databaseNow,
    afterWrite,
  );
}

async function createSession(
  tx: FlarexMetadataDatabase,
  input: LocatedPointMutationSessionActivationInputV1,
  clock: LockedPointMutationSessionClockV1,
  databaseNow: Date,
  afterWrite:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterWrite"]
    | undefined,
): Promise<PointMutationSessionActivationResultV1> {
  const evidence = input.prepared.evidence;
  const hardExpiresAt = cloneValidDate(evidence.authorizationGrantExpiresAt);
  const leaseExpiresAt = deriveInitialLeaseExpiry(
    databaseNow,
    hardExpiresAt,
    input.leaseDurationMilliseconds,
  );
  const inserted = await tx
    .insert(fxSystemTransactionSessions)
    .values({
      scopeUuid: clock.scopeUuid,
      sessionId: input.candidateSessionId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.record.storageGenerationFence,
      ...evidence,
      lifecycle: "running",
      attemptFence: INITIAL_ATTEMPT_FENCE,
      protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      hardExpiresAt,
      createdAt: databaseNow,
      updatedAt: databaseNow,
    })
    .onConflictDoNothing({
      target: [
        fxSystemTransactionSessions.scopeUuid,
        fxSystemTransactionSessions.sessionId,
      ],
    })
    .returning({ sessionId: fxSystemTransactionSessions.sessionId });
  if (inserted[0] === undefined) {
    throw activationError({ reason: "sessionIdCollision" });
  }
  await afterWrite?.("sessionInserted");

  await tx.insert(fxSystemSnapshotLeases).values({
    scopeUuid: clock.scopeUuid,
    sessionId: input.candidateSessionId,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    snapshotEpochUuid: clock.epochUuid,
    snapshotCommitSeq: clock.record.lastCommitSeq,
    leaseExpiresAt,
  });
  await afterWrite?.("leaseInserted");

  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (databaseNowMilliseconds === undefined) {
    throw corruptionError(input.prepared.scopeId, "databaseClockInvalid");
  }
  const creationTimeSeed = decodeAppCreationTimeV1(databaseNowMilliseconds);
  await tx.insert(fxSystemTransactionJournals).values({
    scopeUuid: clock.scopeUuid,
    sessionId: input.candidateSessionId,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    state: "open",
    lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(0n),
    creationTimeSeed,
    nextCreationTime: creationTimeSeed,
    readDocuments: 0,
    readSemanticBytes: 0,
    pointDependencyCount: 0,
    writeOperations: 0,
    writeSemanticBytes: 0,
    materialWriteEventEvidenceBytes:
      CommitMaterialWriteEventEvidenceBytesV1Schema.make(0),
    createdAt: databaseNow,
    updatedAt: databaseNow,
  });
  await afterWrite?.("journalRootInserted");

  return activationResult("created", {
    deploymentId: input.prepared.deploymentId,
    scopeId: input.prepared.scopeId,
    sessionId: input.candidateSessionId,
    requestKey: evidence.requestKey,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: clock.record.storageGenerationFence,
    attemptFence: INITIAL_ATTEMPT_FENCE,
    snapshotToken: SnapshotTokenSchema.make({
      scopeId: input.prepared.scopeId,
      epoch: clock.record.epoch,
      commitSeq: clock.record.lastCommitSeq,
    }),
    hardExpiresAt: hardExpiresAt.toISOString(),
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    createdAt: databaseNow.toISOString(),
    updatedAt: databaseNow.toISOString(),
  });
}

async function replayExistingSession(
  tx: FlarexMetadataDatabase,
  prepared: PreparedPointMutationSessionActivationV1,
  clock: LockedPointMutationSessionClockV1,
  session: typeof fxSystemTransactionSessions.$inferSelect,
): Promise<PointMutationSessionActivationResultV1> {
  if (!sessionEvidenceMatches(session, prepared.evidence)) {
    throw activationError({ reason: "requestKeyConflict" });
  }
  const loaded = await loadLockedRunningAttempt(
    tx,
    {
      deploymentId: prepared.deploymentId,
      scopeId: prepared.scopeId,
      failures: activationAttemptFailures,
      afterLeaseLock: undefined,
    },
    clock,
    session,
  );
  return activationResult("replayed", loaded.anchor);
}

async function loadAttemptInTransaction(
  tx: FlarexMetadataDatabase,
  input: LocatedPointMutationSessionAttemptLoadInputV1,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
): Promise<PointMutationSessionAttemptLoadResultV1> {
  const loaded = await loadExactRunningAttemptForKernelInTransaction(
    tx,
    input,
    afterLoadLock,
  );
  return attemptLoadResult(loaded);
}

async function loadExactRunningAttemptForKernelInTransaction(
  tx: FlarexMetadataDatabase,
  input: ExactRunningAttemptKernelInputV1,
  afterLoadLock:
    | LocatedPointMutationSessionActivationTargetOptionsV1["afterLoadLock"]
    | undefined,
): Promise<ExactRunningAttemptKernelContextV1> {
  const selector = input.selector;
  const clock = await lockPointMutationSessionClock(tx, selector.scopeId);
  await afterLoadLock?.("clockLocked");
  requireStableAttemptLoadAuthority(clock, input);
  const session = await lockExactPointMutationSession(
    tx,
    selector,
    clock,
    attemptLoadExactSessionFailures,
    afterLoadLock,
  );

  return loadLockedRunningAttempt(
    tx,
    {
      deploymentId: selector.deploymentId,
      scopeId: selector.scopeId,
      failures: attemptLoadFailures,
      afterLeaseLock: afterLoadLock,
    },
    clock,
    session,
  );
}

interface PointMutationSessionAttemptAuthorityFailureFactoryV1 {
  readonly unsupportedStorageGeneration: () => Error;
  readonly storageGenerationFenceChanged: () => Error;
  readonly authorizationRevocationEpochChanged: () => Error;
  readonly scopeEpochChanged: () => Error;
}

interface PointMutationSessionAttemptFailureFactoryV1
  extends PointMutationSessionAttemptAuthorityFailureFactoryV1 {
  readonly terminal: (
    lifecycle: Exclude<TransactionSessionLifecycleV1, "running">,
  ) => Error;
  readonly activeAttemptExpired: () => Error;
}

interface PointMutationSessionExactSessionFailureFactoryV1 {
  readonly sessionMissing: () => Error;
  readonly staleAttemptFence: () => Error;
}

async function lockExactPointMutationSession(
  tx: FlarexMetadataDatabase,
  selector: PointMutationSessionAttemptSelectorV1,
  clock: LockedPointMutationSessionClockV1,
  failures: PointMutationSessionExactSessionFailureFactoryV1,
  afterSessionLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined,
): Promise<TransactionSessionRow> {
  const sessions = await tx
    .select()
    .from(fxSystemTransactionSessions)
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, selector.sessionId),
    ))
    .limit(2)
    .for("update");
  const session = sessions[0];
  if (session === undefined) {
    throw failures.sessionMissing();
  }
  if (sessions.length !== 1) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid");
  }
  await afterSessionLock?.("sessionLocked");

  let persistedAttemptFence: TransactionAttemptFence;
  try {
    persistedAttemptFence = TransactionAttemptFenceSchema.make(
      session.attemptFence,
    );
  } catch (cause) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid", cause);
  }
  if (persistedAttemptFence !== selector.attemptFence) {
    throw failures.staleAttemptFence();
  }
  return session;
}

interface LockedPointMutationSessionAttemptLoadV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly failures: PointMutationSessionAttemptFailureFactoryV1;
  readonly afterLeaseLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined;
}

async function loadLockedRunningAttempt(
  tx: FlarexMetadataDatabase,
  input: LockedPointMutationSessionAttemptLoadV1,
  clock: LockedPointMutationSessionClockV1,
  session: TransactionSessionRow,
): Promise<ExactRunningAttemptKernelContextV1> {
  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    input,
    clock,
    session,
  );
  if (session.lifecycle !== "running") {
    throw input.failures.terminal(session.lifecycle);
  }
  if (locked.leaseState === "absent") {
    throw corruptionError(input.scopeId, "snapshotLeaseMissing");
  }

  const databaseNow = await readDatabaseNow(tx, input.scopeId);
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    databaseNowMilliseconds === undefined
  ) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }
  if (
    authorizationGrantExpiresAtMilliseconds <= databaseNowMilliseconds ||
    hardExpiresAtMilliseconds <= databaseNowMilliseconds ||
    locked.leaseExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    throw input.failures.activeAttemptExpired();
  }

  const journalRoot = await requireExactPointMutationSessionJournalRoot(
    tx,
    input.scopeId,
    clock.scopeUuid,
    locked.sessionId,
    locked.attemptFence,
    input.afterLeaseLock,
  );
  const attemptFacet = await observePointMutationSessionAttemptFacet(
    tx,
    clock,
    session,
    locked,
    journalRoot,
  );

  let schemaVersionId: CatalogSchemaVersionId;
  try {
    schemaVersionId = decodeCatalogSchemaVersionId(session.schemaVersionId);
  } catch (cause) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid", cause);
  }

  return Object.freeze({
    scopeUuid: clock.scopeUuid,
    anchor: Object.freeze({
      deploymentId: input.deploymentId,
      scopeId: input.scopeId,
      sessionId: locked.sessionId,
      requestKey: session.requestKey,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: locked.storageGenerationFence,
      attemptFence: locked.attemptFence,
      snapshotToken: SnapshotTokenSchema.make({
        scopeId: input.scopeId,
        epoch: locked.snapshotEpoch,
        commitSeq: locked.snapshotCommitSeq,
      }),
      hardExpiresAt: session.hardExpiresAt.toISOString(),
      leaseExpiresAt: locked.lease.leaseExpiresAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
    } satisfies PointMutationSessionAnchorV1),
    executionPin: Object.freeze({ schemaVersionId }),
    databaseNow,
    journalRoot: Object.freeze({ ...journalRoot }),
    attemptFacet,
  } satisfies ExactRunningAttemptKernelContextV1);
}

async function requireExactPointMutationSessionJournalRoot(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
  scopeUuid: ScopeUuidV1,
  sessionId: TransactionSessionIdV1,
  attemptFence: TransactionAttemptFence,
  afterRootLock:
    | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
        void | Promise<void>)
    | undefined,
): Promise<typeof fxSystemTransactionJournals.$inferSelect> {
  const roots = await tx
    .select()
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, sessionId),
      eq(fxSystemTransactionJournals.attemptFence, attemptFence),
    ))
    .limit(2)
    .for("update");
  const root = roots[0];
  if (root === undefined) {
    throw corruptionError(scopeId, "activeJournalRootMissing");
  }
  if (roots.length !== 1) {
    throw corruptionError(scopeId, "journalRootInvalid");
  }
  await afterRootLock?.("journalRootLocked");
  return root;
}

async function observePointMutationSessionAttemptFacet(
  tx: FlarexMetadataDatabase,
  clock: LockedPointMutationSessionClockV1,
  session: TransactionSessionRow,
  locked: Extract<
    LockedPointMutationSessionAttemptStructureV1,
    { readonly leaseState: "present" }
  >,
  root: typeof fxSystemTransactionJournals.$inferSelect,
): Promise<PointMutationSessionAttemptFacetObservationV1> {
  const sessionUpdatedAtMilliseconds = finiteDateMilliseconds(
    session.updatedAt,
  );
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  if (
    sessionUpdatedAtMilliseconds === undefined ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined
  ) {
    throw corruptionError(clock.record.scopeId, "sessionRecordInvalid");
  }
  const expectedFacet = buildFreshTransactionAttemptFacetV1({
    scopeUuid: clock.scopeUuid,
    sessionId: locked.sessionId,
    attemptFence: locked.attemptFence,
    snapshotEpochUuid: clock.epochUuid,
    snapshotCommitSeq: locked.snapshotCommitSeq,
    databaseNowMilliseconds: sessionUpdatedAtMilliseconds,
    authorizationGrantExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    leaseDurationMilliseconds:
      locked.leaseExpiresAtMilliseconds - sessionUpdatedAtMilliseconds,
  });
  if (
    Result.isFailure(expectedFacet) ||
    !isPristineFreshTransactionAttemptJournalRootV1(
      root,
      expectedFacet.success.journalRoot,
    )
  ) {
    return Object.freeze({ kind: "nonPristine" });
  }

  const rows = await tx.select({
    receiptExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalLatestReceipts}
      where ${fxSystemTransactionJournalLatestReceipts.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalLatestReceipts.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalLatestReceipts.attemptFence} =
          ${locked.attemptFence}
    )`,
    pointExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalPoints}
      where ${fxSystemTransactionJournalPoints.scopeUuid} = ${clock.scopeUuid}
        and ${fxSystemTransactionJournalPoints.sessionId} = ${locked.sessionId}
        and ${fxSystemTransactionJournalPoints.attemptFence} =
          ${locked.attemptFence}
    )`,
    eventExists: sql<boolean>`exists(
      select 1 from ${fxSystemTransactionJournalWriteEvents}
      where ${fxSystemTransactionJournalWriteEvents.scopeUuid} =
        ${clock.scopeUuid}
        and ${fxSystemTransactionJournalWriteEvents.sessionId} =
          ${locked.sessionId}
        and ${fxSystemTransactionJournalWriteEvents.attemptFence} =
          ${locked.attemptFence}
    )`,
  }).from(fxSystemScopeClocks).where(eq(
    fxSystemScopeClocks.scopeUuid,
    clock.scopeUuid,
  )).limit(1);
  const observation = rows[0];
  if (
    rows.length !== 1 ||
    observation === undefined ||
    typeof observation.receiptExists !== "boolean" ||
    typeof observation.pointExists !== "boolean" ||
    typeof observation.eventExists !== "boolean"
  ) {
    throw corruptionError(clock.record.scopeId, "journalRootInvalid");
  }
  return Object.freeze({
    kind: observation.receiptExists ||
        observation.pointExists ||
        observation.eventExists
      ? "nonPristine"
      : "pristineOpen",
  });
}

interface LockedPointMutationSessionAttemptStructureBaseV1 {
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGenerationFence: StorageGenerationFence;
}

type LockedPointMutationSessionAttemptStructureV1 =
  | (LockedPointMutationSessionAttemptStructureBaseV1 & {
      readonly leaseState: "absent";
    })
  | (LockedPointMutationSessionAttemptStructureBaseV1 & {
      readonly leaseState: "present";
      readonly lease: SnapshotLeaseRow;
      readonly leaseExpiresAtMilliseconds: number;
      readonly snapshotEpoch: ScopeEpoch;
      readonly snapshotCommitSeq: CommitSeq;
    });

async function lockPointMutationSessionAttemptStructure(
  tx: FlarexMetadataDatabase,
  input: {
    readonly scopeId: ReplacementScopeIdV1;
    readonly failures: PointMutationSessionAttemptAuthorityFailureFactoryV1;
    readonly afterLeaseLock:
      | ((step: PointMutationSessionAttemptLoadLockStepV1) =>
          void | Promise<void>)
      | undefined;
  },
  clock: LockedPointMutationSessionClockV1,
  session: TransactionSessionRow,
): Promise<LockedPointMutationSessionAttemptStructureV1> {
  if (session.storageGeneration !== "flarexdb_v1") {
    throw input.failures.unsupportedStorageGeneration();
  }
  if (
    session.storageGenerationFence !== clock.record.storageGenerationFence
  ) {
    throw input.failures.storageGenerationFenceChanged();
  }
  if (
    session.authorizationRevocationEpoch !==
    clock.authorizationRevocationEpoch
  ) {
    throw input.failures.authorizationRevocationEpochChanged();
  }
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  if (
    authorizationGrantExpiresAtMilliseconds === undefined ||
    hardExpiresAtMilliseconds === undefined ||
    finiteDateMilliseconds(session.createdAt) === undefined ||
    finiteDateMilliseconds(session.updatedAt) === undefined ||
    hardExpiresAtMilliseconds !== authorizationGrantExpiresAtMilliseconds
  ) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }

  let sessionId: TransactionSessionIdV1;
  let attemptFence: TransactionAttemptFence;
  let storageGenerationFence: StorageGenerationFence;
  try {
    sessionId = TransactionSessionIdV1Schema.make(session.sessionId);
    attemptFence = TransactionAttemptFenceSchema.make(session.attemptFence);
    storageGenerationFence = StorageGenerationFenceSchema.make(
      session.storageGenerationFence,
    );
  } catch (cause) {
    throw corruptionError(
      input.scopeId,
      "sessionRecordInvalid",
      cause,
    );
  }
  if (session.protocolVersion !== TRANSACTION_SESSION_PROTOCOL_VERSION_V1) {
    throw corruptionError(input.scopeId, "sessionRecordInvalid");
  }

  const leases = await tx
    .select()
    .from(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, sessionId),
    ))
    .limit(2)
    .for("update");
  if (leases.length > 1) {
    throw corruptionError(input.scopeId, "snapshotLeaseInvalid");
  }
  const lease = leases[0];
  if (lease === undefined) {
    return Object.freeze({
      leaseState: "absent",
      sessionId,
      attemptFence,
      storageGenerationFence,
    } satisfies LockedPointMutationSessionAttemptStructureV1);
  }
  await input.afterLeaseLock?.("leaseLocked");
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(
    lease.leaseExpiresAt,
  );
  if (
    lease.attemptFence !== attemptFence ||
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds > hardExpiresAtMilliseconds
  ) {
    throw corruptionError(input.scopeId, "snapshotLeaseInvalid");
  }

  let snapshotEpoch: ScopeEpoch;
  let snapshotCommitSeq: CommitSeq;
  try {
    snapshotEpoch = replacementScopeEpochV1FromUuid(lease.snapshotEpochUuid);
    snapshotCommitSeq = CommitSeqSchema.make(lease.snapshotCommitSeq);
  } catch (cause) {
    throw corruptionError(
      input.scopeId,
      "snapshotLeaseInvalid",
      cause,
    );
  }
  if (snapshotEpoch !== clock.record.epoch) {
    throw input.failures.scopeEpochChanged();
  }
  if (snapshotCommitSeq > clock.record.lastCommitSeq) {
    throw corruptionError(input.scopeId, "snapshotAheadOfScopeClock");
  }

  return Object.freeze({
    leaseState: "present",
    sessionId,
    attemptFence,
    storageGenerationFence,
    lease,
    leaseExpiresAtMilliseconds,
    snapshotEpoch,
    snapshotCommitSeq,
  } satisfies LockedPointMutationSessionAttemptStructureV1);
}

async function terminalizeAttemptInTransaction(
  tx: FlarexMetadataDatabase,
  input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
  afterEvent:
    | LocatedPointMutationSessionActivationTargetOptionsV1[
        "afterTerminalizationEvent"
      ]
    | undefined,
): Promise<PointMutationSessionAttemptTerminalizationResultV1> {
  const selector = input.selector;
  const emitLock = async (
    step: PointMutationSessionAttemptLoadLockStepV1,
  ): Promise<void> => {
    await afterEvent?.(Object.freeze({
      phase: "lock",
      operation: input.operation,
      step,
    } satisfies PointMutationSessionAttemptTerminalizationEventV1));
  };
  const emitWrite = async (
    step: Extract<
      PointMutationSessionAttemptTerminalizationEventV1,
      { readonly phase: "write" }
    >["step"],
  ): Promise<void> => {
    await afterEvent?.(Object.freeze({
      phase: "write",
      operation: input.operation,
      step,
    } satisfies PointMutationSessionAttemptTerminalizationEventV1));
  };

  const clock = await lockPointMutationSessionClock(tx, selector.scopeId);
  await emitLock("clockLocked");
  requireStableAttemptTerminalizationAuthority(clock, input);
  const session = await lockExactPointMutationSession(
    tx,
    selector,
    clock,
    attemptTerminalizationExactSessionFailures,
    emitLock,
  );
  const locked = await lockPointMutationSessionAttemptStructure(
    tx,
    {
      scopeId: selector.scopeId,
      failures: attemptTerminalizationAuthorityFailures,
      afterLeaseLock: emitLock,
    },
    clock,
    session,
  );
  const databaseNow = await readDatabaseNow(tx, selector.scopeId);
  const journalRoots = await tx
    .select({ attemptFence: fxSystemTransactionJournals.attemptFence })
    .from(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, locked.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, locked.attemptFence),
    ))
    .limit(2)
    .for("update");
  if (journalRoots.length > 1) {
    throw corruptionError(selector.scopeId, "journalRootInvalid");
  }
  if (journalRoots[0] !== undefined) {
    await emitLock("journalRootLocked");
  }

  switch (session.lifecycle) {
    case "committed":
    case "aborted":
    case "expired": {
      if (locked.leaseState === "present") {
        throw corruptionError(
          selector.scopeId,
          "terminalSnapshotLeasePresent",
        );
      }
      if (journalRoots[0] !== undefined) {
        throw corruptionError(selector.scopeId, "terminalJournalRootPresent");
      }
      return attemptTerminalizationResult(
        "observed",
        selector,
        session.lifecycle,
        session.updatedAt,
      );
    }
    case "created":
    case "committing":
    case "retrying":
      throw attemptTerminalizationError({
        reason: "attemptNotTerminalizable",
        lifecycle: session.lifecycle,
      });
    case "running":
    case "finishing":
      break;
    default: {
      const unexpectedLifecycle: never = session.lifecycle;
      throw corruptionError(
        selector.scopeId,
        "sessionRecordInvalid",
        unexpectedLifecycle,
      );
    }
  }

  if (locked.leaseState === "absent") {
    throw corruptionError(selector.scopeId, "snapshotLeaseMissing");
  }
  if (journalRoots[0] === undefined) {
    throw corruptionError(selector.scopeId, "activeJournalRootMissing");
  }
  if (
    input.operation === "abort" &&
    (
      input.expectedSnapshotToken.scopeId !== selector.scopeId ||
      input.expectedSnapshotToken.epoch !== locked.snapshotEpoch ||
      input.expectedSnapshotToken.commitSeq !== locked.snapshotCommitSeq
    )
  ) {
    throw corruptionError(selector.scopeId, "attemptSnapshotChanged");
  }

  const hardExpiresAtMilliseconds = finiteDateMilliseconds(
    session.hardExpiresAt,
  );
  const authorizationGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  if (
    hardExpiresAtMilliseconds === undefined ||
    authorizationGrantExpiresAtMilliseconds === undefined ||
    databaseNowMilliseconds === undefined
  ) {
    throw corruptionError(selector.scopeId, "sessionRecordInvalid");
  }
  const effectiveExpiryMilliseconds = Math.min(
    locked.leaseExpiresAtMilliseconds,
    hardExpiresAtMilliseconds,
    authorizationGrantExpiresAtMilliseconds,
  );
  const effectiveExpiresAt = new Date(effectiveExpiryMilliseconds);
  if (finiteDateMilliseconds(effectiveExpiresAt) === undefined) {
    throw corruptionError(selector.scopeId, "snapshotLeaseInvalid");
  }
  const isExpired = effectiveExpiryMilliseconds <= databaseNowMilliseconds;
  if (input.operation === "expire" && !isExpired) {
    throw attemptTerminalizationError({
      reason: "attemptStillLive",
      effectiveExpiresAt: effectiveExpiresAt.toISOString(),
    });
  }
  const lifecycle = isExpired ? "expired" : "aborted";

  const deletedJournal = await tx
    .delete(fxSystemTransactionJournals)
    .where(and(
      eq(fxSystemTransactionJournals.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionJournals.sessionId, locked.sessionId),
      eq(fxSystemTransactionJournals.attemptFence, locked.attemptFence),
    ))
    .returning({ attemptFence: fxSystemTransactionJournals.attemptFence });
  if (
    deletedJournal.length !== 1 ||
    deletedJournal[0]?.attemptFence !== locked.attemptFence
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("journalDeleted");

  const deleted = await tx
    .delete(fxSystemSnapshotLeases)
    .where(and(
      eq(fxSystemSnapshotLeases.scopeUuid, clock.scopeUuid),
      eq(fxSystemSnapshotLeases.sessionId, locked.sessionId),
      eq(fxSystemSnapshotLeases.attemptFence, locked.attemptFence),
    ))
    .returning({ attemptFence: fxSystemSnapshotLeases.attemptFence });
  if (
    deleted.length !== 1 ||
    deleted[0]?.attemptFence !== locked.attemptFence
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("leaseDeleted");

  const updated = await tx
    .update(fxSystemTransactionSessions)
    .set({
      lifecycle,
      updatedAt: databaseNow,
    })
    .where(and(
      eq(fxSystemTransactionSessions.scopeUuid, clock.scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, locked.sessionId),
      eq(fxSystemTransactionSessions.attemptFence, locked.attemptFence),
      eq(fxSystemTransactionSessions.lifecycle, session.lifecycle),
    ))
    .returning({
      lifecycle: fxSystemTransactionSessions.lifecycle,
      updatedAt: fxSystemTransactionSessions.updatedAt,
    });
  const terminal = updated[0];
  const terminalUpdatedAt = copyFiniteDate(terminal?.updatedAt);
  if (
    updated.length !== 1 ||
    terminal === undefined ||
    terminal.lifecycle !== lifecycle ||
    terminalUpdatedAt === undefined
  ) {
    throw corruptionError(selector.scopeId, "terminalizationWriteMismatch");
  }
  await emitWrite("sessionTerminalized");

  return attemptTerminalizationResult(
    "terminalized",
    selector,
    lifecycle,
    terminalUpdatedAt,
  );
}

const activationAttemptFailures = Object.freeze({
  terminal: (lifecycle: Exclude<TransactionSessionLifecycleV1, "running">) =>
    activationError({ reason: "terminalRequest", lifecycle }),
  unsupportedStorageGeneration: () =>
    activationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    activationError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    activationError({ reason: "authorizationRevocationEpochChanged" }),
  scopeEpochChanged: () => activationError({ reason: "scopeEpochChanged" }),
  activeAttemptExpired: () =>
    activationError({ reason: "activeAttemptExpired" }),
} satisfies PointMutationSessionAttemptFailureFactoryV1);

const attemptLoadFailures = Object.freeze({
  terminal: (lifecycle: Exclude<TransactionSessionLifecycleV1, "running">) =>
    attemptLoadError({ reason: "attemptNotRunning", lifecycle }),
  unsupportedStorageGeneration: () =>
    attemptLoadError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    attemptLoadError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    attemptLoadError({ reason: "authorizationRevocationEpochChanged" }),
  scopeEpochChanged: () => attemptLoadError({ reason: "scopeEpochChanged" }),
  activeAttemptExpired: () =>
    attemptLoadError({ reason: "activeAttemptExpired" }),
} satisfies PointMutationSessionAttemptFailureFactoryV1);

const attemptLoadExactSessionFailures = Object.freeze({
  sessionMissing: () => attemptLoadError({ reason: "sessionMissing" }),
  staleAttemptFence: () => attemptLoadError({ reason: "staleAttemptFence" }),
} satisfies PointMutationSessionExactSessionFailureFactoryV1);

const attemptLoadStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    attemptLoadError({ reason: "selectorScopeMismatch" }),
  unsupportedStorageGeneration: () =>
    attemptLoadError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationChanged: () =>
    attemptLoadError({ reason: "storageGenerationChanged" }),
  storageGenerationFenceChanged: () =>
    attemptLoadError({ reason: "storageGenerationFenceChanged" }),
  scopeEpochChanged: () => attemptLoadError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

const attemptTerminalizationAuthorityFailures = Object.freeze({
  unsupportedStorageGeneration: () =>
    attemptTerminalizationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationFenceChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationFenceChanged" }),
  authorizationRevocationEpochChanged: () =>
    attemptTerminalizationError({
      reason: "authorizationRevocationEpochChanged",
    }),
  scopeEpochChanged: () =>
    attemptTerminalizationError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionAttemptAuthorityFailureFactoryV1);

const attemptTerminalizationExactSessionFailures = Object.freeze({
  sessionMissing: () =>
    attemptTerminalizationError({ reason: "sessionMissing" }),
  staleAttemptFence: () =>
    attemptTerminalizationError({ reason: "staleAttemptFence" }),
} satisfies PointMutationSessionExactSessionFailureFactoryV1);

const attemptTerminalizationStableAuthorityFailures = Object.freeze({
  selectorScopeMismatch: () =>
    attemptTerminalizationError({ reason: "selectorScopeMismatch" }),
  unsupportedStorageGeneration: () =>
    attemptTerminalizationError({ reason: "unsupportedStorageGeneration" }),
  storageGenerationChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationChanged" }),
  storageGenerationFenceChanged: () =>
    attemptTerminalizationError({ reason: "storageGenerationFenceChanged" }),
  scopeEpochChanged: () =>
    attemptTerminalizationError({ reason: "scopeEpochChanged" }),
} satisfies PointMutationSessionStableAuthorityFailureFactoryV1);

async function lockPointMutationSessionClock(
  tx: FlarexMetadataDatabase,
  scopeId: ReplacementScopeIdV1,
): Promise<LockedPointMutationSessionClockV1> {
  const rows = await tx
    .select()
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1)
    .for("update");
  const row = rows[0];
  if (row === undefined) throw new ScopeClockNotFoundError(scopeId);
  const record = decodeScopeClockRecord(row);
  try {
    const scopeProjection = projectScopeIdUuidV1(record.scopeId);
    const epochProjection = projectScopeEpochUuidV1(record.epoch);
    const scopeUuid = decodeScopeUuidV1(row.scopeUuid);
    const epochUuid = decodeScopeEpochUuidV1(row.epochUuid);
    if (
      scopeUuid !== scopeProjection.scopeUuid ||
      epochUuid !== epochProjection.epochUuid
    ) {
      throw new Error("Native scope-clock projection mismatch.");
    }
    return Object.freeze({
      record,
      scopeUuid,
      epochUuid,
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(
          row.authorizationRevocationEpoch,
        ),
    });
  } catch (cause) {
    throw corruptionError(
      scopeId,
      "scopeClockNativeProjectionInvalid",
      cause,
    );
  }
}

function requireStableAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionActivationInputV1,
): void {
  const preliminary = input.preliminaryAuthority;
  if (
    clock.record.scopeId !== input.prepared.scopeId ||
    preliminary.scopeId !== input.prepared.scopeId
  ) {
    throw activationError({ reason: "scopeMismatch" });
  }
  if (
    clock.record.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGeneration !== "flarexdb_v1"
  ) {
    throw activationError({ reason: "unsupportedStorageGeneration" });
  }
  if (clock.record.storageGeneration !== preliminary.storageGeneration) {
    throw activationError({ reason: "storageGenerationChanged" });
  }
  if (
    clock.record.storageGenerationFence !==
    preliminary.storageGenerationFence
  ) {
    throw activationError({ reason: "storageGenerationFenceChanged" });
  }
  if (clock.record.epoch !== preliminary.epoch) {
    throw activationError({ reason: "scopeEpochChanged" });
  }
  if (
    clock.authorizationRevocationEpoch !==
    input.prepared.evidence.authorizationRevocationEpoch
  ) {
    throw activationError({
      reason: "authorizationRevocationEpochChanged",
    });
  }
}

function requireStableAttemptLoadAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionAttemptLoadInputV1,
): void {
  requireStablePointMutationSessionAttemptAuthority(
    clock,
    input,
    attemptLoadStableAuthorityFailures,
  );
}

function requireStableAttemptTerminalizationAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: LocatedPointMutationSessionAttemptTerminalizationInputV1,
): void {
  requireStablePointMutationSessionAttemptAuthority(
    clock,
    input,
    attemptTerminalizationStableAuthorityFailures,
  );
}

interface PointMutationSessionStableAuthorityFailureFactoryV1 {
  readonly selectorScopeMismatch: () => Error;
  readonly unsupportedStorageGeneration: () => Error;
  readonly storageGenerationChanged: () => Error;
  readonly storageGenerationFenceChanged: () => Error;
  readonly scopeEpochChanged: () => Error;
}

function requireStablePointMutationSessionAttemptAuthority(
  clock: LockedPointMutationSessionClockV1,
  input: {
    readonly selector: PointMutationSessionAttemptSelectorV1;
    readonly preliminaryAuthority: TrustedScopeAuthority;
  },
  failures: PointMutationSessionStableAuthorityFailureFactoryV1,
): void {
  const selector = input.selector;
  const preliminary = input.preliminaryAuthority;
  if (
    clock.record.scopeId !== selector.scopeId ||
    preliminary.scopeId !== selector.scopeId ||
    preliminary.deploymentId !== selector.deploymentId
  ) {
    throw failures.selectorScopeMismatch();
  }
  if (
    clock.record.storageGeneration !== "flarexdb_v1" ||
    preliminary.storageGeneration !== "flarexdb_v1"
  ) {
    throw failures.unsupportedStorageGeneration();
  }
  if (clock.record.storageGeneration !== preliminary.storageGeneration) {
    throw failures.storageGenerationChanged();
  }
  if (
    clock.record.storageGenerationFence !==
    preliminary.storageGenerationFence
  ) {
    throw failures.storageGenerationFenceChanged();
  }
  if (clock.record.epoch !== preliminary.epoch) {
    throw failures.scopeEpochChanged();
  }
}

async function readDatabaseNow(
  tx: FlarexMetadataDatabase,
  scopeId: ScopeId,
): Promise<Date> {
  const rows = await tx
    .select({
      databaseNowEpochMilliseconds: sql<string>`
        floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      `,
    })
    .from(fxSystemScopeClocks)
    .where(eq(fxSystemScopeClocks.scopeId, scopeId))
    .limit(1);
  const epochMillisecondsText = rows[0]?.databaseNowEpochMilliseconds;
  if (typeof epochMillisecondsText !== "string") {
    throw corruptionError(scopeId, "databaseClockInvalid");
  }
  const epochMilliseconds = Number(epochMillisecondsText);
  const databaseNow = new Date(epochMilliseconds);
  if (
    !isPositiveSafeInteger(epochMilliseconds) ||
    finiteDateMilliseconds(databaseNow) === undefined
  ) {
    throw corruptionError(scopeId, "databaseClockInvalid");
  }
  return databaseNow;
}

function deriveInitialLeaseExpiry(
  databaseNow: Date,
  hardExpiresAt: Date,
  leaseDurationMilliseconds: number,
): Date {
  const databaseNowMilliseconds = finiteDateMilliseconds(databaseNow);
  const hardExpiryMilliseconds = finiteDateMilliseconds(hardExpiresAt);
  if (
    databaseNowMilliseconds === undefined ||
    hardExpiryMilliseconds === undefined
  ) {
    throw activationError({ reason: "authorizationGrantExpired" });
  }
  const remainingMilliseconds =
    hardExpiryMilliseconds - databaseNowMilliseconds;
  if (remainingMilliseconds <= 0) {
    throw activationError({ reason: "authorizationGrantExpired" });
  }
  const leaseExpiresAt = new Date(
    databaseNowMilliseconds +
      Math.min(leaseDurationMilliseconds, remainingMilliseconds),
  );
  const leaseExpiresAtMilliseconds = finiteDateMilliseconds(leaseExpiresAt);
  if (
    leaseExpiresAtMilliseconds === undefined ||
    leaseExpiresAtMilliseconds <= databaseNowMilliseconds
  ) {
    throw activationError({ reason: "authorizationGrantExpired" });
  }
  return leaseExpiresAt;
}

function sessionEvidenceMatches(
  session: typeof fxSystemTransactionSessions.$inferSelect,
  expected: PreparedPointMutationSessionEvidenceV1,
): boolean {
  const actualGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    session.authorizationGrantExpiresAt,
  );
  const expectedGrantExpiresAtMilliseconds = finiteDateMilliseconds(
    expected.authorizationGrantExpiresAt,
  );
  return (
    session.packageId === expected.packageId &&
    session.artifactRuntime === expected.artifactRuntime &&
    session.artifactId === expected.artifactId &&
    session.sourcePackageHash === expected.sourcePackageHash &&
    session.executionModule === expected.executionModule &&
    session.functionPath === expected.functionPath &&
    session.functionKind === expected.functionKind &&
    session.schemaVersionId === expected.schemaVersionId &&
    session.policyVersion === expected.policyVersion &&
    bytesEqual(
      session.identityAccessPolicySha256,
      expected.identityAccessPolicySha256,
    ) &&
    jsonEqual(session.validatedArgsJson, expected.validatedArgsJson) &&
    session.validatedArgsValueCodecVersion ===
      expected.validatedArgsValueCodecVersion &&
    bytesEqual(
      session.validatedArgsCanonicalBytes,
      expected.validatedArgsCanonicalBytes,
    ) &&
    bytesEqual(session.validatedArgsSha256, expected.validatedArgsSha256) &&
    session.authorizationGrantId === expected.authorizationGrantId &&
    jsonEqual(
      session.authorizationGrantJson,
      expected.authorizationGrantJson,
    ) &&
    session.authorizationGrantValueCodecVersion ===
      expected.authorizationGrantValueCodecVersion &&
    bytesEqual(
      session.authorizationGrantCanonicalBytes,
      expected.authorizationGrantCanonicalBytes,
    ) &&
    bytesEqual(
      session.authorizationGrantSha256,
      expected.authorizationGrantSha256,
    ) &&
    session.authorizationRevocationEpoch ===
      expected.authorizationRevocationEpoch &&
    actualGrantExpiresAtMilliseconds !== undefined &&
    actualGrantExpiresAtMilliseconds === expectedGrantExpiresAtMilliseconds &&
    session.requestKey === expected.requestKey &&
    bytesEqual(session.requestSha256, expected.requestSha256)
  );
}

function capturePreparedActivation(
  input: PreparedPointMutationSessionActivationV1,
): Result.Result<
  PreparedPointMutationSessionActivationV1,
  PointMutationSessionActivationV1Error
> {
  const evidence = input.evidence;
  if (
    !isJsonObjectFromUnknown(evidence.validatedArgsJson) ||
    !isJsonObjectFromUnknown(evidence.authorizationGrantJson)
  ) {
    return Result.fail(activationError({ reason: "invalidPreparedEvidence" }));
  }
  return Result.succeed(Object.freeze({
    deploymentId: input.deploymentId,
    scopeId: decodeReplacementScopeIdV1(input.scopeId),
    evidence: Object.freeze({
      packageId: evidence.packageId,
      artifactRuntime: evidence.artifactRuntime,
      artifactId: evidence.artifactId,
      sourcePackageHash: evidence.sourcePackageHash,
      executionModule: evidence.executionModule,
      functionPath: evidence.functionPath,
      functionKind: evidence.functionKind,
      schemaVersionId: evidence.schemaVersionId,
      policyVersion: evidence.policyVersion,
      identityAccessPolicySha256:
        TransactionIdentityAccessPolicySha256V1Schema.make(
          new Uint8Array(evidence.identityAccessPolicySha256),
        ),
      validatedArgsJson: cloneJsonObject(evidence.validatedArgsJson),
      validatedArgsValueCodecVersion:
        evidence.validatedArgsValueCodecVersion,
      validatedArgsCanonicalBytes:
        CanonicalTransactionArgumentsBytesV1Schema.make(
          new Uint8Array(evidence.validatedArgsCanonicalBytes),
        ),
      validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
        new Uint8Array(evidence.validatedArgsSha256),
      ),
      authorizationGrantId: evidence.authorizationGrantId,
      authorizationGrantJson: cloneJsonObject(
        evidence.authorizationGrantJson,
      ),
      authorizationGrantValueCodecVersion:
        evidence.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalBytes:
        CanonicalTransactionAuthorizationGrantBytesV1Schema.make(
          new Uint8Array(evidence.authorizationGrantCanonicalBytes),
        ),
      authorizationGrantSha256:
        TransactionAuthorizationGrantSha256V1Schema.make(
          new Uint8Array(evidence.authorizationGrantSha256),
        ),
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(
          evidence.authorizationRevocationEpoch,
        ),
      authorizationGrantExpiresAt: cloneValidDate(
        evidence.authorizationGrantExpiresAt,
      ),
      requestKey: evidence.requestKey,
      requestSha256: TransactionRequestSha256V1Schema.make(
        new Uint8Array(evidence.requestSha256),
      ),
    }),
  }));
}

function captureAttemptSelector(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptLoadV1Error
> {
  return decodeAttemptSelectorResult(input).pipe(
    Result.mapError(invalidAttemptSelector),
  );
}

function decodeAttemptSelectorResult(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<PointMutationSessionAttemptSelectorV1, unknown> {
  return Result.gen(function* () {
    const deploymentIdInput = yield* readAttemptSelectorInput(
      () => input.deploymentId,
    );
    const deploymentId = yield* decodeAttemptDeploymentIdResult(
      deploymentIdInput,
    );
    const scopeIdInput = yield* readAttemptSelectorInput(() => input.scopeId);
    const scopeId = yield* decodeAttemptScopeIdResult(scopeIdInput);
    const sessionIdInput = yield* readAttemptSelectorInput(
      () => input.sessionId,
    );
    const sessionId = yield* decodeAttemptSessionIdResult(sessionIdInput);
    const attemptFenceInput = yield* readAttemptSelectorInput(
      () => input.attemptFence,
    );
    const attemptFence = yield* decodeAttemptFenceResult(attemptFenceInput);
    return Object.freeze({
      deploymentId,
      scopeId,
      sessionId,
      attemptFence,
    } satisfies PointMutationSessionAttemptSelectorV1);
  });
}

function readAttemptSelectorInput<A>(
  read: () => A,
): Result.Result<A, unknown> {
  return Result.try({ try: read, catch: (cause) => cause });
}

function invalidAttemptSelector(
  cause: unknown,
): PointMutationSessionAttemptLoadV1Error {
  return attemptLoadError({ reason: "invalidSelector", cause });
}

function captureTerminalizationAttemptSelector(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationV1Error
> {
  return decodeAttemptSelectorResult(input).pipe(
    Result.mapError(invalidTerminalizationAttemptSelector),
  );
}

function captureAttemptAbortInput(
  input: PointMutationSessionAttemptAbortInputV1,
): Result.Result<
  PointMutationSessionAttemptAbortInputV1,
  PointMutationSessionAttemptTerminalizationV1Error
> {
  return Result.gen(function* () {
    const selectorInput = yield* readAttemptTerminalizationInput(
      () => input.selector,
      invalidTerminalizationAttemptSelector,
    );
    const selector = yield* captureTerminalizationAttemptSelector(selectorInput);
    const expectedSnapshotTokenInput = yield* readAttemptTerminalizationInput(
      () => input.expectedSnapshotToken,
      invalidAbortSnapshot,
    );
    const expectedSnapshotToken = yield* decodeAttemptSnapshotTokenResult(
      expectedSnapshotTokenInput,
    ).pipe(Result.mapError(invalidAbortSnapshot));
    if (expectedSnapshotToken.scopeId !== selector.scopeId) {
      return yield* Result.fail(invalidAbortSnapshot(
        new Error("Abort snapshot scope does not match its selector."),
      ));
    }
    return Object.freeze({
      selector,
      expectedSnapshotToken: Object.freeze(expectedSnapshotToken),
    });
  });
}

function readAttemptTerminalizationInput<A>(
  read: () => A,
  onFailure: (cause: unknown) => PointMutationSessionAttemptTerminalizationV1Error,
): Result.Result<A, PointMutationSessionAttemptTerminalizationV1Error> {
  return Result.try({ try: read, catch: onFailure });
}

function invalidTerminalizationAttemptSelector(
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error {
  return attemptTerminalizationError({ reason: "invalidSelector", cause });
}

function invalidAbortSnapshot(
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error {
  return attemptTerminalizationError({
    reason: "invalidAbortSnapshot",
    cause,
  });
}

function requireActivationTarget(
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

function requireAttemptLoadTarget(
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

function requireAttemptTerminalizationTarget(
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
  return typeof Reflect.get(target, "activatePreparedPointMutationSession") ===
    "function";
}

function isAttemptLoadTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationSessionAttemptLoadTargetV1 {
  return typeof Reflect.get(target, "loadExactPointMutationSessionAttempt") ===
    "function";
}

function isAttemptTerminalizationTarget(
  target: LocatedScopeClockReader,
): target is LocatedPointMutationSessionAttemptTerminalizationTargetV1 {
  return typeof Reflect.get(
    target,
    "terminalizeExactPointMutationSessionAttempt",
  ) === "function";
}

function requireLeaseDuration(value: number): number {
  if (!isPositiveSafeInteger(value)) {
    throw new PointMutationSessionActivationConfigurationV1Error({
      reason: "invalidLeaseDuration",
    });
  }
  return value;
}

const generateSessionIdEffect = Effect.fn(
  "PointMutationSessionActivation.generateSessionId",
)(function* (
  randomUuid: () => string,
): Effect.fn.Return<
  TransactionSessionIdV1,
  PointMutationSessionActivationConfigurationV1Error
> {
  const value = yield* Effect.try({
    try: randomUuid,
    catch: (cause) =>
      new PointMutationSessionActivationConfigurationV1Error({
        reason: "sessionIdGenerationFailed",
        cause,
      }),
  });
  return yield* Effect.fromResult(validateGeneratedSessionId(value));
});

function validateGeneratedSessionId(
  value: string,
): Result.Result<
  TransactionSessionIdV1,
  PointMutationSessionActivationConfigurationV1Error
> {
  if (!UUID_V4_PATTERN.test(value)) {
    return Result.fail(new PointMutationSessionActivationConfigurationV1Error({
      reason: "invalidGeneratedSessionId",
      value,
    }));
  }
  return Result.succeed(TransactionSessionIdV1Schema.make(value));
}

function mapActivationAuthorityError(
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

function mapActivationTransactionError(
  cause: unknown,
): PointMutationSessionActivationV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionActivationPersistenceV1Error {
  if (
    cause instanceof PointMutationSessionActivationV1Error ||
    cause instanceof PointMutationSessionAuthorityCorruptionV1Error
  ) {
    return cause;
  }
  return new PointMutationSessionActivationPersistenceV1Error({
    operation: "activationTransaction",
    cause,
  });
}

function mapAttemptLoadAuthorityError(
  error: TrustedScopeAuthorityError,
): TrustedScopeAuthorityResolutionError |
  PointMutationSessionAttemptLoadPersistenceV1Error {
  return error instanceof TrustedScopeAuthorityPortError
    ? new PointMutationSessionAttemptLoadPersistenceV1Error({
        operation: error.operation,
        cause: error.cause,
      })
    : error;
}

function mapAttemptLoadTransactionError(
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
  return new PointMutationSessionAttemptLoadPersistenceV1Error({
    operation: "attemptLoadTransaction",
    cause,
  });
}

function mapAttemptTerminalizationAuthorityError(
  error: TrustedScopeAuthorityError,
): TrustedScopeAuthorityResolutionError |
  PointMutationSessionAttemptTerminalizationPersistenceV1Error {
  return error instanceof TrustedScopeAuthorityPortError
    ? new PointMutationSessionAttemptTerminalizationPersistenceV1Error({
        operation: error.operation,
        cause: error.cause,
      })
    : error;
}

function mapAttemptTerminalizationTransactionError(
  operation: PointMutationSessionAttemptTerminalizationOperationV1,
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error |
  PointMutationSessionAuthorityCorruptionV1Error |
  PointMutationSessionAttemptTerminalizationPersistenceV1Error {
  if (
    cause instanceof PointMutationSessionAttemptTerminalizationV1Error ||
    cause instanceof PointMutationSessionAuthorityCorruptionV1Error
  ) {
    return cause;
  }
  return new PointMutationSessionAttemptTerminalizationPersistenceV1Error({
    operation: operation === "abort"
      ? "attemptAbortTransaction"
      : "attemptExpireTransaction",
    cause,
  });
}

function activationResult(
  status: PointMutationSessionActivationResultV1["status"],
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionActivationResultV1 {
  const capturedAnchor = Object.freeze({
    ...anchor,
    snapshotToken: Object.freeze(
      SnapshotTokenSchema.make({
        scopeId: anchor.snapshotToken.scopeId,
        epoch: anchor.snapshotToken.epoch,
        commitSeq: anchor.snapshotToken.commitSeq,
      }),
    ),
  } satisfies PointMutationSessionAnchorV1);
  switch (status) {
    case "created":
      return Object.freeze({
        status: "created",
        anchor: capturedAnchor,
      } satisfies PointMutationSessionActivationResultV1);
    case "replayed":
      return Object.freeze({
        status: "replayed",
        anchor: capturedAnchor,
      } satisfies PointMutationSessionActivationResultV1);
  }
}

function attemptLoadResult(
  loaded: ExactRunningAttemptKernelContextV1,
): PointMutationSessionAttemptLoadResultV1 {
  return Object.freeze({
    status: "loaded",
    anchor: captureSessionAnchor(loaded.anchor),
    executionPin: Object.freeze({
      schemaVersionId: loaded.executionPin.schemaVersionId,
    }),
    attemptFacet: Object.freeze({ kind: loaded.attemptFacet.kind }),
  });
}

function attemptTerminalizationResult(
  status: PointMutationSessionAttemptTerminalizationResultV1["status"],
  selector: PointMutationSessionAttemptSelectorV1,
  lifecycle: PointMutationSessionTerminalLifecycleV1,
  terminalizedAt: Date,
): PointMutationSessionAttemptTerminalizationResultV1 {
  switch (status) {
    case "terminalized": {
      if (lifecycle === "committed") {
        throw corruptionError(selector.scopeId, "sessionRecordInvalid");
      }
      return Object.freeze({
        status: "terminalized",
        terminal: createTerminalObservation(
          selector,
          lifecycle,
          terminalizedAt,
        ),
      });
    }
    case "observed":
      return Object.freeze({
        status: "observed",
        terminal: createTerminalObservation(
          selector,
          lifecycle,
          terminalizedAt,
        ),
      });
  }
}

function createTerminalObservation<
  Lifecycle extends PointMutationSessionTerminalLifecycleV1,
>(
  selector: PointMutationSessionAttemptSelectorV1,
  lifecycle: Lifecycle,
  terminalizedAt: Date,
): PointMutationSessionTerminalObservationV1<Lifecycle> {
  return Object.freeze({
    ...selector,
    lifecycle,
    terminalizedAt: cloneValidTerminalDate(
      terminalizedAt,
      selector.scopeId,
    ).toISOString(),
  });
}

function captureSessionAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAnchorV1 {
  return Object.freeze({
    ...anchor,
    snapshotToken: Object.freeze(
      SnapshotTokenSchema.make({
        scopeId: anchor.snapshotToken.scopeId,
        epoch: anchor.snapshotToken.epoch,
        commitSeq: anchor.snapshotToken.commitSeq,
      }),
    ),
  } satisfies PointMutationSessionAnchorV1);
}

function activationError(
  issue: PointMutationSessionActivationIssueV1,
): PointMutationSessionActivationV1Error {
  return new PointMutationSessionActivationV1Error(issue);
}

function attemptLoadError(
  issue: PointMutationSessionAttemptLoadIssueV1,
): PointMutationSessionAttemptLoadV1Error {
  return new PointMutationSessionAttemptLoadV1Error(issue);
}

function attemptTerminalizationError(
  issue: PointMutationSessionAttemptTerminalizationIssueV1,
): PointMutationSessionAttemptTerminalizationV1Error {
  return new PointMutationSessionAttemptTerminalizationV1Error(issue);
}

function corruptionError(
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

function cloneValidDate(value: Date): Date {
  const cloned = copyFiniteDate(value);
  if (cloned === undefined) {
    throw new PointMutationSessionActivationV1Error({
      reason: "invalidPreparedEvidence",
    });
  }
  return cloned;
}

function cloneValidTerminalDate(value: Date, scopeId: ScopeId): Date {
  const cloned = copyFiniteDate(value);
  if (cloned === undefined) {
    throw corruptionError(scopeId, "sessionRecordInvalid");
  }
  return cloned;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  const result: Record<string, Json> = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child === undefined) {
      throw new Error(`Missing JSON object value for key ${key}.`);
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: cloneJson(child),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function cloneJson(value: Json): Json {
  if (isJsonArray(value)) {
    return Object.freeze(value.map(cloneJson));
  }
  if (isJsonObject(value)) {
    return cloneJsonObject(value);
  }
  return value;
}

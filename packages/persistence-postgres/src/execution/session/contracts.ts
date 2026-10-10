import type {
  ApplicationActiveSelection,
  CurrentApplicationFiniteEntry,
} from "../../application/activation/contracts";
import type { ApplicationActivationError } from "../../application/activation/errors";
import type {
  ApplicationMutationAdmissionContext,
  PreparedFiniteApplicationMutationAdmission,
} from "../../application/applicationMutationAdmission";
import type { CommittedPointOutcomeResolutionV1 } from "../../commit/committedPointOutcome";
import type { fxSystemSnapshotLeases, fxSystemTransactionSessions } from "../../database/schema";
import type { ScopeClockRecord } from "../../scope/scopeClock";
import type {
  PointMutationExecutionClaimAcquisitionV1Error,
} from "../claims/transactionExecutionClaimErrors";
import type {
  TransactionExecutionClaimObservationV1,
  TransactionExecutionClaimPinV1,
} from "../claims/transactionExecutionClaimModel";
import type {
  ConfirmedFiniteRootEntryCapture,
  PreparedFiniteSessionJournalEntry,
} from "../journal/finiteEntry";
import type { checkedTransactionSessionSelection } from "./attemptAuthority";
import type {
  FiniteApplicationMutationSessionActivationError,
  PointMutationSessionActivationEffectErrorV1,
  PointMutationSessionAttemptLoadEffectErrorV1,
  PointMutationSessionAttemptTerminalizationEffectErrorV1,
} from "./errors";
import type { FiniteRecoveryAttempt } from "./recoveryCapture";
import type { Effect } from "effect";
import type {
  ApplicationMutationExecutionAuthorityV1Error,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import type {
  VerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  FlarexDbV1StorageGeneration,
  ReplacementScopeIdV1,
  SnapshotToken,
  StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type {
  TransactionAttemptFence,
  TransactionRequestKeyV1,
  TransactionSessionIdV1,
  TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";

export type PointMutationExecutionProfile =
  | "durableOperations"
  | "finiteRoot";

type TransactionSessionInsert =
  typeof fxSystemTransactionSessions.$inferInsert;

export type TransactionSessionRow =
  typeof fxSystemTransactionSessions.$inferSelect;

export type CheckedTransactionSessionRow = Pick<
  TransactionSessionRow,
  keyof typeof checkedTransactionSessionSelection
>;

export type SnapshotLeaseRow = typeof fxSystemSnapshotLeases.$inferSelect;

export type PreparedPointMutationSessionEvidenceV1 = Readonly<
  Omit<Pick<
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
  >, "packageId" | "artifactRuntime" | "artifactId" |
    "sourcePackageHash" | "executionModule" | "validatedArgsJson" |
    "validatedArgsCanonicalBytes" | "authorizationGrantJson" |
    "authorizationGrantCanonicalBytes"> & {
      readonly validatedArgsJson: NonNullable<TransactionSessionInsert["validatedArgsJson"]>;
      readonly validatedArgsCanonicalBytes:
        NonNullable<TransactionSessionInsert["validatedArgsCanonicalBytes"]>;
      readonly authorizationGrantJson: NonNullable<TransactionSessionInsert["authorizationGrantJson"]>;
      readonly authorizationGrantCanonicalBytes:
        NonNullable<TransactionSessionInsert["authorizationGrantCanonicalBytes"]>;
      readonly packageId: NonNullable<TransactionSessionInsert["packageId"]>;
      readonly artifactRuntime:
        NonNullable<TransactionSessionInsert["artifactRuntime"]>;
      readonly artifactId: NonNullable<TransactionSessionInsert["artifactId"]>;
      readonly sourcePackageHash:
        NonNullable<TransactionSessionInsert["sourcePackageHash"]>;
      readonly executionModule:
        NonNullable<TransactionSessionInsert["executionModule"]>;
    }
>;

export type PreparedMutationSessionCommonEvidenceV1 = Omit<
  PreparedPointMutationSessionEvidenceV1,
  "packageId" | "artifactRuntime" | "artifactId" |
    "sourcePackageHash" | "executionModule"
>;

export type PreparedStoredMutationSessionEvidenceV1 =
  PreparedMutationSessionCommonEvidenceV1 & (
    | Readonly<{
        readonly executionAuthorityGeneration:
          "legacy_dynamic_worker_v1";
        readonly applicationExecutionAuthorityJson: null;
        readonly applicationExecutionAuthorityCanonicalBytes: null;
        readonly applicationExecutionAuthoritySha256: null;
        readonly packageId:
          PreparedPointMutationSessionEvidenceV1["packageId"];
        readonly artifactRuntime:
          PreparedPointMutationSessionEvidenceV1["artifactRuntime"];
        readonly artifactId:
          PreparedPointMutationSessionEvidenceV1["artifactId"];
        readonly sourcePackageHash:
          PreparedPointMutationSessionEvidenceV1["sourcePackageHash"];
        readonly executionModule:
          PreparedPointMutationSessionEvidenceV1["executionModule"];
      }>
    | Readonly<{
        readonly executionAuthorityGeneration: "application_v1";
        readonly applicationExecutionAuthorityJson:
          NonNullable<TransactionSessionInsert[
            "applicationExecutionAuthorityJson"
          ]>;
        readonly applicationExecutionAuthorityCanonicalBytes: Uint8Array;
        readonly applicationExecutionAuthoritySha256: Uint8Array;
        readonly packageId: null;
        readonly artifactRuntime: null;
        readonly artifactId: null;
        readonly sourcePackageHash: null;
        readonly executionModule: null;
      }>
  );

export interface PreparedStoredMutationSessionActivationV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly executionProfile: PointMutationExecutionProfile;
  readonly evidence: PreparedStoredMutationSessionEvidenceV1;
}

export interface PreparedPointMutationSessionActivationV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly executionProfile?: PointMutationExecutionProfile;
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
  readonly executionProfile: PointMutationExecutionProfile;
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
      readonly executionClaim: TransactionExecutionClaimObservationV1;
    }
  | {
      readonly status: "busy";
      readonly anchor: PointMutationSessionAnchorV1;
    };

export type PointMutationExecutionClaimAcquisitionModeV1 =
  | "execute"
  | "finishOnly"
  | "replaceRelationConflict"
  | "abortOnly";

export type PointMutationExecutionClaimAbortReasonV1 =
  | "dirtyOpen"
  | "failedRoot";

export type PointMutationExecutionClaimAcquisitionResultV1 =
  | Readonly<{
      readonly kind: "replayed";
      readonly outcome: Exclude<
        CommittedPointOutcomeResolutionV1,
        Readonly<{ readonly kind: "missing" }>
      >;
    }>
  | Readonly<{
      readonly kind: "busy";
      readonly observation: TransactionExecutionClaimObservationV1;
    }>
  | Readonly<{ readonly kind: "finiteRecovery"; readonly capture: FiniteRecoveryAttempt }>
  | Readonly<{
      /** Inert routing evidence; C05-B must independently authenticate it. */
      readonly kind: "finishing";
    }>
  | Readonly<{
      readonly kind: "acquired";
      readonly mode: Exclude<
        PointMutationExecutionClaimAcquisitionModeV1,
        "abortOnly"
      >;
      readonly observation: TransactionExecutionClaimObservationV1;
    }>
  | Readonly<{
      readonly kind: "acquired";
      readonly mode: "abortOnly";
      readonly reason: PointMutationExecutionClaimAbortReasonV1;
      readonly observation: TransactionExecutionClaimObservationV1;
    }>;

export interface PointMutationExecutionClaimAcquisitionV1 {
  readonly acquireEffect: (
    input: PointMutationSessionAttemptSelectorV1,
  ) => Effect.Effect<
    PointMutationExecutionClaimAcquisitionResultV1,
    PointMutationExecutionClaimAcquisitionV1Error
  >;
}

export interface PointMutationSessionAttemptLoadResultV1 {
  readonly status: "loaded";
  readonly lastMetadataSequence: ScopeClockRecord["lastMetadataSequence"];
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
  readonly functionPath: TransactionSessionRow["functionPath"];
  readonly functionKind: TransactionSessionRow["functionKind"];
  readonly executionModule: TransactionSessionRow["executionModule"];
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
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

export interface PointMutationSessionActivationPersistenceV1 {
  readonly activateEffect: (
    input: PreparedPointMutationSessionActivationV1,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    PointMutationSessionActivationEffectErrorV1
  >;
}

type ApplicationGrantStorageFieldV1 =
  | "authorizationGrantId"
  | "authorizationGrantJson"
  | "authorizationGrantValueCodecVersion"
  | "authorizationGrantCanonicalBytes"
  | "authorizationGrantSha256"
  | "authorizationRevocationEpoch"
  | "authorizationGrantExpiresAt";

export type PreparedApplicationMutationSessionEvidenceV1 = Readonly<
  Omit<PreparedMutationSessionCommonEvidenceV1,
    ApplicationGrantStorageFieldV1> & {
      readonly executionAuthority: unknown;
      readonly verifiedGrant: VerifiedApplicationMutationGrantV1;
    }
>;

export interface PreparedApplicationMutationSessionActivationV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly executionProfile?: "durableOperations";
  readonly activeSelection: ApplicationActiveSelection;
  readonly evidence: PreparedApplicationMutationSessionEvidenceV1;
}

export interface ApplicationMutationSessionActivationPersistenceV1 {
  readonly activateFiniteEffect: (
    input: PreparedFiniteApplicationMutationSessionActivation,
    entry: PreparedFiniteSessionJournalEntry,
  ) => Effect.Effect<FiniteApplicationMutationSessionActivationResult,
    FiniteApplicationMutationSessionActivationError>;
  readonly activateEffect: (
    input: PreparedApplicationMutationSessionActivationV1,
  ) => Effect.Effect<
    PointMutationSessionActivationResultV1,
    | PointMutationSessionActivationEffectErrorV1
    | ApplicationActivationError
    | ApplicationMutationExecutionAuthorityV1Error
  >;
}

export interface PreparedFiniteApplicationMutationSessionActivation {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly preparedAdmission: PreparedFiniteApplicationMutationAdmission;
  readonly admissionContext: ApplicationMutationAdmissionContext;
  readonly evidence: PreparedApplicationMutationSessionEvidenceV1;
  readonly currentEntry?: CurrentApplicationFiniteEntry;
}

export type FiniteApplicationMutationSessionActivationResult = Readonly<{
  activation: PointMutationSessionActivationResultV1;
  entry?: ConfirmedFiniteRootEntryCapture;
}>;

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

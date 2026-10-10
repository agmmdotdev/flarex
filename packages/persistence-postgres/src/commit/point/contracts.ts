import type { TransactionGrantDeploymentIdV1 } from "flarex-protocol/transaction-grant";
import type {
  ReplacementScopeIdV1,
  FlarexDbV1StorageGeneration,
  StorageGenerationFence,
  SnapshotToken,
  ScopeUuidV1,
  CommitSeq,
} from "flarex-protocol/storage-authority";
import type {
  TransactionSessionIdV1,
  TransactionAttemptFence,
  TransactionFunctionPathV1,
  TransactionPolicyVersionV1,
  TransactionAuthorizationRevocationEpoch,
  TransactionRequestKeyV1,
  TransactionPackageIdV1,
  TransactionArtifactRuntimeV1,
  TransactionArtifactIdV1,
  TransactionSourcePackageSha256HexV1,
  TransactionExecutionModuleV1,
  StoredTransactionSessionScalarsV1,
  TransactionAuthorizationGrantIdV1,
} from "flarex-protocol/transaction-session";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  CommitFinalSyscallSequenceV1,
  SESSION_JOURNAL_FORMAT,
  CommitMaterialWriteEventEvidenceBytesV1,
  LogicalIndexRangeReadDependencyV1,
  LogicalApplicationRelationIncomingReadDependencyV1,
  CommitSyscallSequenceV1,
  CanonicalSuccessfulResultBytesV1Schema,
  SuccessfulResultSha256HexV1,
} from "flarex-protocol/commit-protocol";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import type {
  FlarexValueCodecVersion,
  CanonicalFlarexRuntimeValueV1,
} from "flarex-protocol/value";
import type {
  TransactionExecutionClaimPinV1,
  TransactionExecutionClaimObservationV1,
} from "../../execution/claims/transactionExecutionClaimModel";
import type { AppSchemaCandidateWriteGuardPlanningHead } from "../../storage/catalog/appSchemaCandidateValidation";
import type {
  PointCommitDependencyV1,
  PointCommitRowIntentV1,
} from "../../storage/materialization/model";
import type { FrozenFiniteAttempt } from "../../execution/journal/frozenAttempt";
import type { Effect, Scope } from "effect";
import type {
  PointCommitPublicationV1Error,
  PointCommitDecisionUncertainV1Error,
  PointFiniteTerminalRefusal,
  PointCommitConflictEvidenceV1,
  PointMutationAttemptReplacementV1Error,
  PointCommitFinishingTransitionV1Error,
  PointCommitRollbackProofV1Error,
  PointCommitOutcomeResolutionV1Error,
} from "./errors";
import type { FiniteAttemptNonacceptanceProof } from "../../execution/finiteAttemptAnchor";
import type {
  CommittedPointOutcomeResolutionV1,
  CommittedPointOutcomeTokenV1,
  CommittedPointSuccessfulResultV1,
  ResolveCommittedPointOutcomeInputV1,
} from "../committedPointOutcome";
import type {
  CatalogEdgeDefinitionId,
  CatalogRelationId,
  CatalogTableId,
} from "flarex-protocol/catalog";
import type { AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type {
  PreparedFiniteSessionJournalEntry,
  ConfirmedFiniteRootEntryCapture,
} from "../../execution/journal/finiteEntry";
import type { RecoveredRunningRelationConflictEvidence } from "./capabilities";

export interface PointCommitAuthorityCommonPinsV1 {
  readonly deploymentId: TransactionGrantDeploymentIdV1;
  readonly scopeId: ReplacementScopeIdV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly snapshotToken: SnapshotToken;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly functionPath: TransactionFunctionPathV1;
  readonly functionKind: "mutation";
  readonly policyVersion: TransactionPolicyVersionV1;
  readonly authorizationRevocationEpoch: TransactionAuthorizationRevocationEpoch;
  readonly requestKey: TransactionRequestKeyV1;
}

export type PointCommitAuthorityPinsV1 =
  | Readonly<
      PointCommitAuthorityCommonPinsV1 & {
        readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1";
        readonly packageId: TransactionPackageIdV1;
        readonly artifactRuntime: TransactionArtifactRuntimeV1;
        readonly artifactId: TransactionArtifactIdV1;
        readonly sourcePackageHash: TransactionSourcePackageSha256HexV1;
        readonly executionModule: TransactionExecutionModuleV1;
        readonly applicationExecutionAuthoritySha256?: never;
      }
    >
  | Readonly<
      PointCommitAuthorityCommonPinsV1 & {
        readonly executionAuthorityGeneration: "application_v1";
        readonly applicationExecutionAuthoritySha256: Uint8Array;
        readonly packageId?: never;
        readonly artifactRuntime?: never;
        readonly artifactId?: never;
        readonly sourcePackageHash?: never;
        readonly executionModule?: never;
      }
    >;

export type PointCommitSessionScalarsV1 =
  StoredTransactionSessionScalarsV1 extends infer Session
    ? Session extends StoredTransactionSessionScalarsV1
      ? Omit<Session, "authorizationGrantId"> & {
          readonly authorizationGrantId: TransactionAuthorizationGrantIdV1;
        }
      : never
    : never;

export interface PointCommitSealIdentityV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly lifecycle: "running" | "finishing";
  readonly sessionUpdatedAtMilliseconds: number;
  readonly leaseExpiresAtMilliseconds: number;
  readonly rootCreatedAtMilliseconds: number;
  readonly rootUpdatedAtMilliseconds: number;
  readonly sealedAtMilliseconds: number;
  readonly finalSyscallSequence: CommitFinalSyscallSequenceV1;
  readonly creationTimeSeed: AppCreationTimeV1;
  readonly nextCreationTime: AppCreationTimeV1;
  readonly journalFormat: typeof SESSION_JOURNAL_FORMAT;
  readonly journalProtocolVersion: number;
  readonly journalValueCodecVersion: FlarexValueCodecVersion;
  readonly journalByteLength: number;
  readonly journalSha256: Uint8Array;
  readonly resultValueCodecVersion: FlarexValueCodecVersion;
  readonly resultSemanticBytes: number;
  readonly resultByteLength: number;
  readonly resultSha256: Uint8Array;
  readonly readDocuments: number;
  readonly readSemanticBytes: number;
  readonly pointDependencyCount: number;
  readonly indexedQuerySyscalls: number;
  readonly indexRangeDependencyCount: number;
  readonly indexRangeDependencyEvidenceBytes: number;
  readonly relationReadSyscalls: number;
  readonly relationDependencyCount: number;
  readonly relationBaseOccurrences: number;
  readonly writeOperations: number;
  readonly writeSemanticBytes: number;
  readonly materialWriteEventEvidenceBytes: CommitMaterialWriteEventEvidenceBytesV1;
  readonly receiptEvidenceBytes: number;
  readonly participantWorkBytes: number;
  readonly participantWorkCalls: number;
}

export interface PointCommitAttemptScalarCommandV1 {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitSessionScalarsV1;
  readonly sealIdentity: PointCommitSealIdentityV1;
}

export interface PointCommitFinishingTransitionCommandV1 extends Omit<
  PointCommitAttemptScalarCommandV1,
  "session" | "sealIdentity"
> {
  readonly session: PointCommitRunningSessionScalarsV1;
  readonly sealIdentity: Readonly<
    Omit<PointCommitSealIdentityV1, "lifecycle"> & {
      readonly lifecycle: "running";
    }
  >;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

export type PointCommitRunningSessionScalarsV1 =
  PointCommitSessionScalarsV1 extends infer Session
    ? Session extends PointCommitSessionScalarsV1
      ? Readonly<Omit<Session, "lifecycle"> & { readonly lifecycle: "running" }>
      : never
    : never;

export interface PointCommitTransactionCommandV1 extends PointCommitAttemptScalarCommandV1 {
  /** Full authenticated journal preserves attempted writes before net-zero coalescing. */
  readonly journalBytes?: Uint8Array;
  readonly candidatePlanningHead?: AppSchemaCandidateWriteGuardPlanningHead;
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<LogicalIndexRangeReadDependencyV1>;
  readonly relationDependencies: ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>;
  readonly rowIntents: ReadonlyArray<PointCommitRowIntentV1>;
}

export interface PointFiniteCommitCommand {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitSessionScalarsV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly frozenAttempt: FrozenFiniteAttempt;
}

export interface PointFiniteCommitPublisherPort {
  readonly publishFinite: (
    command: PointFiniteCommitCommand
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitPublicationV1Error | PointCommitDecisionUncertainV1Error
  >;
  readonly resolveFinite: (
    command: PointFiniteAttemptResolutionCommand
  ) => Effect.Effect<
    PointFiniteAttemptResolution,
    PointCommitPublicationV1Error | PointCommitDecisionUncertainV1Error
  >;
}

export type PointFiniteAttemptResolutionCommand = Omit<
  PointFiniteCommitCommand,
  "frozenAttempt"
> &
  Readonly<{
    readonly frozenAttempt?: FrozenFiniteAttempt;
    readonly terminalRefusal?: PointFiniteTerminalRefusal;
    readonly terminalRefusalProof?: FiniteAttemptNonacceptanceProof;
  }>;

export type PointFiniteAttemptResolution =
   Readonly<{
      kind: "committed";
      outcome: Exclude<CommittedPointOutcomeResolutionV1, { kind: "missing" }>
    }>
  | Readonly<{ kind: "noncommit"; proof: FiniteAttemptNonacceptanceProof }>
  | Readonly<{ kind: "rejected"; error: PointFiniteTerminalRefusal }>;

export interface PointMutationAttemptReplacementCommandV1 extends PointCommitAttemptScalarCommandV1 {
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<LogicalIndexRangeReadDependencyV1>;
  readonly relationDependencies: ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>;
  readonly expectedConflict: PointCommitConflictEvidenceV1;
}

export interface RunningRelationConflictEvidenceV1 {
  readonly kind: "relationConflict";
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly targetRowId: AppRowIdHexV1;
  readonly expectedAdjacencyVersion: CommitSeq;
  readonly actualAdjacencyVersion: CommitSeq;
  readonly snapshotCommitSeq: CommitSeq;
}

export interface RunningRelationConflictRequestEvidenceV1 {
  readonly format: "flarex.session-journal-syscall";
  readonly codecVersion: 2;
  readonly kind: "relationIncoming";
  readonly syscallSequence: CommitSyscallSequenceV1;
  readonly relationId: CatalogRelationId;
  readonly edgeDefinitionId: CatalogEdgeDefinitionId;
  readonly sourceTableId: CatalogTableId;
  readonly targetTableId: CatalogTableId;
  readonly targetRowId: AppRowIdHexV1;
  readonly limit: number;
}

export interface RunningRelationConflictAttemptReplacementCommandV1 {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitRunningSessionScalarsV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly request: RunningRelationConflictRequestEvidenceV1;
  readonly conflict: RunningRelationConflictEvidenceV1;
}

export interface RunningRelationConflictRecoveryCommand {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitRunningSessionScalarsV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

export type PointMutationAttemptReplacementObservationV1 =
   Readonly<{
      readonly kind: "replaced";
      readonly scopeUuid: ScopeUuidV1;
      readonly sessionId: TransactionSessionIdV1;
      readonly previousAttemptFence: TransactionAttemptFence;
      readonly attemptFence: TransactionAttemptFence;
      readonly executionClaim: TransactionExecutionClaimObservationV1;
      readonly finiteEntry?: Readonly<{
        preparation: PreparedFiniteSessionJournalEntry;
        capture: ConfirmedFiniteRootEntryCapture
      }>;
    }>
  | Readonly<{
      readonly kind: "alreadyReplaced";
      readonly scopeUuid: ScopeUuidV1;
      readonly sessionId: TransactionSessionIdV1;
      readonly previousAttemptFence: TransactionAttemptFence;
      readonly attemptFence: TransactionAttemptFence;
    }>;

export interface PointMutationAttemptReplacementPortV1 {
  readonly replace: (
    command: PointMutationAttemptReplacementCommandV1,
  ) => Effect.Effect<
    PointMutationAttemptReplacementObservationV1,
    PointMutationAttemptReplacementV1Error,
    never
  >;
}

export interface PointFiniteAttemptReplacementPort {
  readonly replaceFinite: (
    command: PointFiniteCommitCommand &
      Readonly<{ proof: FiniteAttemptNonacceptanceProof }>
  ) => Effect.Effect<
    PointMutationAttemptReplacementObservationV1,
    PointMutationAttemptReplacementV1Error | PointCommitDecisionUncertainV1Error,
    Scope.Scope
  >;
  readonly replaceRecoveredFinite: (
    command: PointRecoveredFiniteAttemptReplacementCommand &
      Readonly<{ proof: FiniteAttemptNonacceptanceProof }>
  ) => Effect.Effect<
    PointMutationAttemptReplacementObservationV1,
    PointMutationAttemptReplacementV1Error | PointCommitDecisionUncertainV1Error,
    Scope.Scope
  >;
}

export type PointRecoveredFiniteAttemptReplacementCommand = Omit<
  PointFiniteAttemptResolutionCommand,
  "frozenAttempt"
> &
  Readonly<{ frozenAttempt?: never }>;

export interface RunningRelationConflictAttemptReplacementPortV1 {
  readonly replaceRunningRelationConflict: (
    command: RunningRelationConflictAttemptReplacementCommandV1,
  ) => Effect.Effect<
    PointMutationAttemptReplacementObservationV1,
    PointMutationAttemptReplacementV1Error,
    never
  >;
}

export interface RunningRelationConflictRecoveryPort {
  readonly recoverRunningRelationConflict: (
    command: RunningRelationConflictRecoveryCommand,
  ) => Effect.Effect<
    RecoveredRunningRelationConflictEvidence,
    PointMutationAttemptReplacementV1Error,
    never
  >;
}

export interface PointCommitSuccessfulResultV1 {
  readonly valueCodecVersion: FlarexValueCodecVersion;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly canonicalBytes: typeof CanonicalSuccessfulResultBytesV1Schema.Type;
  readonly semanticSizeBytes: number;
  readonly sha256Hex: SuccessfulResultSha256HexV1;
}

export interface PointCommitPublicationCommandV1 extends PointCommitTransactionCommandV1 {
  readonly successfulResult: PointCommitSuccessfulResultV1;
}

export interface PointCommitWouldCommitV1 {
  readonly kind: "wouldCommit";
}

export type PointCommitFinishingTransitionResultV1 = Readonly<{
  readonly kind: "transitioned" | "observed";
  readonly scopeUuid: ScopeUuidV1;
  readonly sessionId: TransactionSessionIdV1;
  readonly attemptFence: TransactionAttemptFence;
  readonly priorSessionUpdatedAtMilliseconds: number;
  readonly finishingSessionUpdatedAtMilliseconds: number;
}>;

export interface PointCommitFinishingTransitionPortV1 {
  readonly enterFinishing: (
    command: PointCommitFinishingTransitionCommandV1,
  ) => Effect.Effect<
    PointCommitFinishingTransitionResultV1,
    PointCommitFinishingTransitionV1Error,
    never
  >;
}

export interface PointCommitRollbackProofPortV1 {
  readonly prove: (
    command: PointCommitTransactionCommandV1,
  ) => Effect.Effect<
    PointCommitWouldCommitV1,
    PointCommitRollbackProofV1Error,
    never
  >;
}

export type PointCommitPublicationResultV1 =
  | Readonly<{
      readonly kind: "published" | "replayed";
      readonly token: CommittedPointOutcomeTokenV1;
      readonly successfulResult: CommittedPointSuccessfulResultV1;
    }>
  | Readonly<{
      readonly kind: "expired";
      readonly token: CommittedPointOutcomeTokenV1;
    }>;

export interface PointCommitPublisherPortV1 extends PointCommitRollbackProofPortV1 {
  readonly publish: (
    command: PointCommitPublicationCommandV1,
  ) => Effect.Effect<
    PointCommitPublicationResultV1,
    PointCommitPublicationV1Error,
    never
  >;
}

export const RESOLVE_POINT_COMMIT_OUTCOME_V1: unique symbol = Symbol(
  "FlarexDB/resolvePointCommitOutcomeV1"
);

export interface PointCommitOutcomeResolutionPortV1 {
  readonly [RESOLVE_POINT_COMMIT_OUTCOME_V1]: (
    deploymentId: TransactionGrantDeploymentIdV1,
    input: ResolveCommittedPointOutcomeInputV1,
  ) => Effect.Effect<
    CommittedPointOutcomeResolutionV1,
    PointCommitOutcomeResolutionV1Error,
    never
  >;
}

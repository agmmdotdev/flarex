import type {
  PointFiniteAttemptResolutionCommand,
  PointCommitAuthorityPinsV1,
  PointCommitSessionScalarsV1,
  PointCommitFinishingTransitionCommandV1,
  PointCommitAttemptScalarCommandV1,
  PointCommitTransactionCommandV1,
  PointCommitSuccessfulResultV1,
  PointCommitRunningSessionScalarsV1,
  RunningRelationConflictRequestEvidenceV1,
  RunningRelationConflictEvidenceV1,
} from "./contracts";
import type { ScopeUuidV1 } from "flarex-protocol/storage-authority";
import type {
  ApplicationDocumentMaterializationCommand,
  PreparedPointCommitRowIntentV1,
  PointCommitDependencyV1,
} from "../../storage/materialization/model";
import type { TransactionExecutionClaimPinV1 } from "../../execution/claims/transactionExecutionClaimModel";
import type {
  OwnedFrozenFiniteAttemptData,
  FrozenFiniteOperation,
} from "../../execution/journal/frozenAttempt";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type {
  LogicalIndexRangeReadDependencyV1,
  LogicalApplicationRelationIncomingReadDependencyV1,
  AdmittedParticipantOperation,
  SessionJournal,
  LogicalMetadataReadDependency,
  CanonicalSuccessfulResultBytesV1Schema,
} from "flarex-protocol/commit-protocol";
import type { CommittedEvent } from "../events/model";
import type {
  LogicalParticipantCommitAuthority,
  inspectFiniteOperationCommitAuthority,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import type { PointCommitConflictEvidenceV1 } from "./errors";

export interface PreparedFiniteAttemptResolutionCommand extends PointFiniteAttemptResolutionCommand {
  readonly scopeUuid: ScopeUuidV1
}

export interface PreparedFiniteCommitCommand extends ApplicationDocumentMaterializationCommand {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitSessionScalarsV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
  readonly frozen: OwnedFrozenFiniteAttemptData;
  readonly generatedInsertions: ReadonlySet<string>;
  readonly generatedOnlyPoints: ReadonlySet<string>;
  readonly rowIntentsByTable: ReadonlyMap<
    CatalogTableId,
    ApplicationDocumentMaterializationCommand["rowIntents"]
  >;
  readonly attemptedTableIds: readonly CatalogTableId[];
  readonly applicationPointTableIds: readonly CatalogTableId[];
  readonly participantMaterialDocumentIds: ReadonlySet<string>;
  readonly indexRangeDependencies: readonly LogicalIndexRangeReadDependencyV1[];
  readonly relationDependencies: readonly LogicalApplicationRelationIncomingReadDependencyV1[];
  readonly successfulResult: PreparedPointCommitPublicationCommandV1["successfulResult"];
  readonly sources: readonly FiniteCommitSource[];
  readonly events: readonly CommittedEvent[];
}

export interface FiniteCommitSource {
  readonly token: LogicalParticipantCommitAuthority;
  readonly operation: Extract<FrozenFiniteOperation, { kind: "participant" }>;
  readonly admission: import("../../storage/documents/logicalDocuments/participantAdmission").LogicalParticipantAttemptAdmission;
  readonly methods: readonly string[];
  readonly selected: NonNullable<
    ReturnType<typeof inspectFiniteOperationCommitAuthority>
  >;
  readonly touchedTables: readonly CatalogTableId[];
}

export interface PreparedPointCommitFinishingTransitionCommandV1 extends PointCommitFinishingTransitionCommandV1 {}

export interface PreparedPointCommitAttemptScalarCommandV1 extends PointCommitAttemptScalarCommandV1 {}

export interface PreparedPointCommitTransactionCommandV1
  extends
    PreparedPointCommitAttemptScalarCommandV1,
    Omit<
      PointCommitTransactionCommandV1,
      keyof PointCommitAttemptScalarCommandV1 | "rowIntents"
    > {
  readonly rowIntents: ReadonlyArray<PreparedPointCommitRowIntentV1>;
  readonly attemptedTableIds: ReadonlyArray<CatalogTableId> | null;
  readonly participantOperations: readonly AdmittedParticipantOperation[];
  readonly generatedInsertions: ReadonlySet<string>;
  readonly generatedOnlyPoints: ReadonlySet<string>;
  readonly participantJournal: SessionJournal | null;
  readonly participantMaterialDocumentIds: ReadonlySet<string>;
  readonly participantEventIntents: readonly CommittedEvent[];
  readonly metadataDependencies: readonly LogicalMetadataReadDependency[];
  readonly finiteMetadataReservationSha256Hex: string | null;
}

export interface PreparedPointCommitPublicationCommandV1 extends PreparedPointCommitTransactionCommandV1 {
  readonly successfulResult: Readonly<
    Omit<PointCommitSuccessfulResultV1, "canonicalBytes"> & {
      readonly canonicalBytes: typeof CanonicalSuccessfulResultBytesV1Schema.Type;
    }
  >;
}

export interface PreparedPointMutationAttemptReplacementCommandV1 extends PreparedPointCommitAttemptScalarCommandV1 {
  readonly dependencies: ReadonlyArray<PointCommitDependencyV1>;
  readonly indexRangeDependencies: ReadonlyArray<LogicalIndexRangeReadDependencyV1>;
  readonly relationDependencies: ReadonlyArray<LogicalApplicationRelationIncomingReadDependencyV1>;
  readonly expectedConflict: PointCommitConflictEvidenceV1;
}

export interface PreparedRunningRelationConflictRecoveryCommand {
  readonly authorityPins: PointCommitAuthorityPinsV1;
  readonly session: PointCommitRunningSessionScalarsV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly executionClaim: TransactionExecutionClaimPinV1;
}

export interface PreparedRunningRelationConflictAttemptReplacementCommandV1 extends PreparedRunningRelationConflictRecoveryCommand {
  readonly request: RunningRelationConflictRequestEvidenceV1;
  readonly conflict: RunningRelationConflictEvidenceV1;
}

export type PreparedPointCommitDependencyCommandV1 =
  | PreparedPointCommitTransactionCommandV1
  | PreparedPointMutationAttemptReplacementCommandV1
  | PreparedFiniteCommitCommand;

export type PointCommitTransactionModeV1 = "rollbackProof" | "publish";

export type PointCommitSessionLockModeV1 =
  | PointCommitTransactionModeV1
  | "enterFinishing"
  | "replaceAttempt"
  | "recoverRunningRelationConflict"
  | "replaceRunningRelationConflict"
  | "publishFinite"
  | "resolveFinite";

export type PreparedPointCommitAuthorityCommandV1 =
  | PreparedPointCommitAttemptScalarCommandV1
  | PreparedRunningRelationConflictRecoveryCommand
  | PreparedRunningRelationConflictAttemptReplacementCommandV1
  | PreparedFiniteCommitCommand
  | PreparedFiniteAttemptResolutionCommand;

export function pointCommitCommandScopeUuid(
  command: PreparedPointCommitAuthorityCommandV1,
): ScopeUuidV1 {
  return "scopeUuid" in command
    ? command.scopeUuid
    : command.sealIdentity.scopeUuid;
}

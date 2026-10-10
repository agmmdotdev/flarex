import type { PointCommitPublicationObservation } from "./observation";
import type {
  LogicalParticipantCommitAuthority,
} from "../../storage/documents/logicalDocuments/participantAdmission";
import type { Effect } from "effect";
import type {
  prepareAtomicCommerceEvents,
  ParticipantEventSelection,
} from "../../frameworks/atomicCommerce/events";
import type {
  IntrinsicCreationTimeIndexDefinitionPortV1,
} from "../../storage/indexes/intrinsicCreationTimeIndexBuildV1";
import type { AppDeveloperIndexDefinitionPortV1 } from "../../storage/indexes/appDeveloperIndexCommitV1";
import type { AppUniqueConstraintDefinitionPortV1 } from "../../storage/unique/appUniqueConstraintCommitV1";
import type {
  AppUniqueConstraintSetEligibilityPortV1,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";
import type { ApplicationRelationCommitPort } from "../../application/relations/commit/Model";
import type { AppSchemaCandidateWriteGuardPort } from "../../storage/catalog/appSchemaCandidateValidation";
import type { ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import type {
  PointCommitSqlOperationV1,
  PointMutationAttemptReplacementFiniteEntryError,
  PointMutationAttemptReplacementSqlOperationV1,
} from "./errors";
import type {
  PreparedFiniteActiveApplication,
} from "../../application/activation/contracts";
import type { PreparedFiniteSessionJournalEntry } from "../../execution/journal/finiteEntry";

export type PointCommitTransactionProofStepV1 =
  | "lifecycleProtected"
  | "clockLocked"
  | "activeApplicationSchemaValidated"
  | "activeRelationSelectionValidated"
  | "sessionLocked"
  | "leaseLocked"
  | "journalRootLocked"
  | "executionClaimLocked"
  | "executionClaimDeleted"
  | "sessionEnteredFinishing"
  | "dependenciesValidated"
  | "finiteParticipantDocumentValidated"
  | "intrinsicIndexBuildLocked"
  | "developerIndexBuildLocked"
  | "relationBindingValidated"
  | "relationTargetsValidated"
  | "relationEdgeWritten"
  | "relationRestrictValidated"
  | "candidateSchemaValidationFailed"
  | "outcomeRechecked"
  | "commitHeaderWritten"
  | "commitChangeWritten"
  | "commitRelationAdjacencyChangeWritten"
  | "outcomeWritten"
  | "wakeWritten"
  | "journalDeleted"
  | "leaseDeleted"
  | "sessionCommitted"
  | "clockAdvanced"
  | "beforeCommit"
  | "beforeRollback";

export interface PointCommitTransactionProofOptionsV1 {
  readonly publicationObservation?: PointCommitPublicationObservation;
  /** Trusted selector profiles authenticate whole ordered source bundles,
   * including zero-effect sources and the pinned producer revision. */
  readonly logicalOperationProfiles?: readonly Readonly<{
    participant: string;
    operationMethods: readonly string[];
    profileRevision: string;
    sources: readonly LogicalParticipantCommitAuthority[];
    operationEvents?: Readonly<{
      policy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>>;
      selection: ParticipantEventSelection;
    }>;
  }>[];
  /** Same opaque participant token pins the event contract selected before ack. */
  readonly logicalParticipantEvents?: readonly Readonly<{
    authority: LogicalParticipantCommitAuthority;
    policy: Effect.Success<ReturnType<typeof prepareAtomicCommerceEvents>>;
    selection: ParticipantEventSelection;
  }>[];
  /**
   * Required issued composition for Application material writes. Absence is
   * retained only for lower-level legacy proof/runtime callers, whose active
   * Application exclusion is an explicit CE2 cutover gate.
   */
  readonly intrinsicCreationTimeIndexes?: IntrinsicCreationTimeIndexDefinitionPortV1;
  /** Required from the same control database for Application material writes. */
  readonly developerIndexes?: AppDeveloperIndexDefinitionPortV1;
  /** Private C08-B2 composition; absence preserves the lower proof lane. */
  readonly uniqueConstraints?: AppUniqueConstraintDefinitionPortV1;
  /**
   * Private C08-B1 eligibility facet. It is effective only when composed with
   * the exact B2 definition owner on this same point-commit port.
   */
  readonly uniqueConstraintEligibility?: AppUniqueConstraintSetEligibilityPortV1;
  /** Private C09 composition; absence preserves the lower proof lane. */
  readonly applicationRelations?: ApplicationRelationCommitPort;
  /** Private M03-B composition; absence preserves the lower commit lane. */
  readonly candidateSchemaWriteGuard?: AppSchemaCandidateWriteGuardPort;
  readonly afterTransactionStep?: (
    event: Readonly<{
      readonly scopeId: ReplacementScopeIdV1;
      readonly step: PointCommitTransactionProofStepV1;
    }>,
  ) => Promise<void>;
  readonly observeQuery?: (
    query: Readonly<{
      readonly name: PointCommitSqlOperationV1;
      readonly sql: string;
      readonly params: ReadonlyArray<unknown>;
    }>,
  ) => void;
}

export type PointMutationAttemptReplacementProofStepV1 =
  | "clockLocked"
  | "outcomeRechecked"
  | "activeRelationSelectionValidated"
  | "sessionLocked"
  | "leaseLocked"
  | "journalRootLocked"
  | "dependenciesValidated"
  | "sessionEnteredRetrying"
  | "journalDeleted"
  | "leaseDeleted"
  | "attemptFenceAdvanced"
  | "leaseInserted"
  | "journalRootInserted"
  | "executionClaimDeleted"
  | "executionClaimInserted"
  | "sessionRunning"
  | "beforeCommit";

export interface PointMutationAttemptReplacementOptionsV1 {
  readonly leaseDurationMilliseconds: number;
  /** Trusted reserved-graph composition. Stored profile and reservation require
   * it; its presence never chooses a weaker admission path. */
  readonly finiteEntry?: Readonly<{
    application: PreparedFiniteActiveApplication;
    prepareEntry: () => Effect.Effect<
      PreparedFiniteSessionJournalEntry,
      PointMutationAttemptReplacementFiniteEntryError,
      import("effect").Scope.Scope
    >;
  }>;
  /** Same trusted aggregate profile selection used by final publication. */
  readonly logicalOperationProfiles?: PointCommitTransactionProofOptionsV1["logicalOperationProfiles"];
  readonly executionClaimDurationMilliseconds?: number;
  readonly randomExecutionClaimOwner?: () => string;
  /** Test-only deterministic transaction pause/failure seam. */
  readonly afterReplacementStep?: (
    event: Readonly<{
      readonly scopeId: ReplacementScopeIdV1;
      readonly step: PointMutationAttemptReplacementProofStepV1;
    }>,
  ) => Promise<void>;
  /** Test-only bounded query observation. */
  readonly observeQuery?: (
    query: Readonly<{
      readonly name: PointMutationAttemptReplacementSqlOperationV1;
      readonly sql: string;
      readonly params: ReadonlyArray<unknown>;
    }>,
  ) => void;
}

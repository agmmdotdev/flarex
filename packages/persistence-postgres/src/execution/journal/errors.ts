import type { ExactDecimalError } from "flarex-protocol/internal/exact-decimal";
import { Data } from "effect";
import type { ApplicationTableWriteDeniedError } from "../../application/ownership/Model";
import type { OrderedIndexKeyTooLargeError } from "flarex-protocol/ordered-index";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { AppRelationEdgeReadError } from "../../storage/relations";
import type {
  ApplicationRelationReadOverlayError,
  ApplicationRelationReadUnavailableError,
  ValidateApplicationRelationReadCapabilityError,
} from "../../application/relations/applicationRelationRead";
import type {
  PrepareApplicationRelationCommitError,
} from "../../application/relations/applicationRelationCommit";
import type { ReadAppRowError } from "../../storage/documents/appRows";
import type { ReadAppIndexRangeV1Error } from "../../storage/indexes/appIndexEntries";
import type {
  LocateAppDeveloperIndexDefinitionsV1Error,
} from "../../storage/indexes/appDeveloperIndexCommitV1";
import type { ReadFencedIndexBuildStateError } from "../../storage/indexes/indexBuildStates";
import type {
  ApplicationRevisionSyscallValidatorV1Error,
} from "../../application/revision/applicationRevisionSyscallValidatorErrors";
import type {
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
} from "../../storage/documents/pinnedPointTableErrors";
import type { PointMutationSessionAttemptLoadIssueV1 } from "../transactionSessionActivation";
import type { SessionJournalPointOperationKindV1 } from "./contracts";

export class InvalidSessionJournalCapabilityV1Error extends Data.TaggedError(
  "InvalidSessionJournalCapabilityV1Error",
)<{
  readonly capability:
    | "attempt"
    | "pointTable"
    | "developerIndex"
    | "applicationRelation"
    | "sealPreparation";
}> {}

export class InvalidSessionJournalInputV1Error extends Data.TaggedError(
  "InvalidSessionJournalInputV1Error",
)<{
  readonly operation:
    | SessionJournalPointOperationKindV1
    | "indexRange"
    | "relationIncoming"
    | "openAttempt"
    | "resolvePointTable"
    | "resolveDeveloperIndex"
    | "resolveApplicationRelation";
  readonly reason:
    | "invalidAttemptPins"
    | "invalidTableName"
    | "invalidIndexDescriptor"
    | "invalidOperation";
  readonly cause?: unknown;
}> {}

export class SessionJournalTargetUnavailableV1Error extends Data.TaggedError(
  "SessionJournalTargetUnavailableV1Error",
)<{
  readonly scopeId: ScopeId;
}> {}

export class SessionJournalAttemptUnavailableV1Error extends Data.TaggedError(
  "SessionJournalAttemptUnavailableV1Error",
)<{
  readonly issue: PointMutationSessionAttemptLoadIssueV1;
}> {}

export class SessionJournalPersistenceV1Error extends Data.TaggedError(
  "SessionJournalPersistenceV1Error",
)<{
  readonly operation:
    | "canonicalizeRequest"
    | "completeSealTransaction"
    | "hashSealJournal"
    | "openAttempt"
    | "prepareSealSnapshot"
    | "resolveJournalTarget"
    | "admitLogicalParticipant"
    | "runAdmittedOperation"
    | "resolvePinnedPointTable"
    | "resolveDeveloperIndex"
    | "resolveApplicationRelation"
    | "runPointOperation"
    | "runIndexedQuery"
    | "runApplicationRelationRead";
  readonly cause: unknown;
}> {}

export type SessionJournalResolvePointTableV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | PinnedPointTableCorruptionV1Error
  | PinnedPointTableNotFoundV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

export type SessionJournalRunPointOperationV1Error =
  | ApplicationTableWriteDeniedError
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalIdentityGenerationV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | ApplicationRevisionSyscallValidatorV1Error;

export class SessionJournalDeveloperIndexUnavailableV1Error
  extends Data.TaggedError("SessionJournalDeveloperIndexUnavailableV1Error")<{
    readonly reason:
      | "invalidComposition"
      | "definitionNotFound"
      | "definitionMismatch"
      | "buildNotEnabled";
  }> {}

export type SessionJournalResolveDeveloperIndexV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalDeveloperIndexUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalTargetUnavailableV1Error
  | LocateAppDeveloperIndexDefinitionsV1Error;

export type SessionJournalRunIndexedQueryV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalDeveloperIndexUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | ReadFencedIndexBuildStateError
  | ReadAppIndexRangeV1Error
  | ReadAppRowError
  | OrderedIndexKeyTooLargeError
  | ExactDecimalError;

export type SessionJournalResolveApplicationRelationReadError =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | ApplicationRelationReadUnavailableError;

export type SessionJournalRunApplicationRelationReadError =
  | InvalidSessionJournalCapabilityV1Error
  | InvalidSessionJournalInputV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error
  | ValidateApplicationRelationReadCapabilityError
  | ApplicationRelationReadOverlayError
  | PrepareApplicationRelationCommitError
  | AppRelationEdgeReadError
  | ReadAppRowError;

export type SessionJournalPrepareSealV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalSealV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

export type SessionJournalCompleteSealV1Error =
  | InvalidSessionJournalCapabilityV1Error
  | SessionJournalAttemptUnavailableV1Error
  | SessionJournalLeasePromotionV1Error
  | SessionJournalPersistenceV1Error
  | SessionJournalSealV1Error
  | SessionJournalStorageCorruptionV1Error
  | SessionJournalTargetUnavailableV1Error;

export type SessionJournalStorageCorruptionReasonV1 =
  | "databaseClockInvalid"
  | "exactAttemptPinsChanged"
  | "executionClaimInvalid"
  | "failedJournalEvidenceInvalid"
  | "failedJournalReceiptInvalid"
  | "journalCountersInvalid"
  | "journalReceiptStateMismatch"
  | "journalRootMissingOrDuplicate"
  | "journalRootOperationUpdateMismatch"
  | "journalStateInvalid"
  | "latestReceiptEvidenceInvalid"
  | "latestReceiptMissing"
  | "latestReceiptRequestDigestMismatch"
  | "latestReceiptSequenceMismatch"
  | "liveOverlayEvidenceMissing"
  | "liveOverlaySemanticBytesMismatch"
  | "logicalWriteEventInvalid"
  | "materialWriteEventEvidenceBytesMismatch"
  | "missingDependencyUnexpectedRevision"
  | "pointDependencyChangedAtSnapshot"
  | "pointDependencyCountMismatch"
  | "indexRangeDependencyCountMismatch"
  | "indexRangeDependencyEvidenceBytesMismatch"
  | "indexRangeDependencyInvalid"
  | "indexedSnapshotPositionMismatch"
  | "presentDependencyRevisionMissing"
  | "relationAdjacencyVersionInvalid"
  | "relationDependencyCountMismatch"
  | "relationDependencyInvalid"
  | "relationPageFrontierInvalid"
  | "requestTableCapabilityMismatch"
  | "indexMaintenanceInvalid"
  | "scopeClockMissingOrDuplicate"
  | "sealedJournalStateInvalid"
  | "sessionRecordInvalid"
  | "snapshotLeaseInvalid"
  | "tombstoneDependencyRevisionMissing"
  | "writeOperationCountMismatch"
  | "writeSemanticBytesMismatch"
  | "writeSequenceBeyondJournalFinalSequence"
  | "zeroSequenceHasReceipt";

export class SessionJournalStorageCorruptionV1Error extends Data.TaggedError(
  "SessionJournalStorageCorruptionV1Error",
)<{
  readonly scopeId: ScopeId;
  readonly reason: SessionJournalStorageCorruptionReasonV1;
  readonly cause?: unknown;
}> {}

export class SessionJournalIdentityGenerationV1Error extends Data.TaggedError(
  "SessionJournalIdentityGenerationV1Error",
)<{
  readonly generatedValue: unknown;
}> {}

export type SessionJournalLeasePromotionV1Issue =
  | Readonly<{
      readonly kind: "retentionPolicyInvalid";
      readonly maximumLiveSnapshotRetentionMilliseconds: number;
    }>
  | Readonly<{
      readonly kind: "retentionBudgetExceeded";
      readonly remainingMilliseconds: number;
      readonly maximumLiveSnapshotRetentionMilliseconds: number;
    }>;

export class SessionJournalLeasePromotionV1Error extends Data.TaggedError(
  "SessionJournalLeasePromotionV1Error",
)<{
  readonly issue: SessionJournalLeasePromotionV1Issue;
}> {}

export class SessionJournalSealV1Error extends Data.TaggedError(
  "SessionJournalSealV1Error",
)<{
  readonly reason:
    | "journalFailed"
    | "journalRelationConflicted"
    | "stalePreparation"
    | "canonicalJournalMismatch"
    | "canonicalResultMismatch"
    | "sealedEvidenceMismatch";
  readonly cause?: unknown;
}> {}

export { ApplicationTableWriteDeniedError } from "../../application/ownership/Model";
export {
  PinnedPointTableCorruptionV1Error,
  PinnedPointTableNotFoundV1Error,
} from "../../storage/documents/pinnedPointTableErrors";

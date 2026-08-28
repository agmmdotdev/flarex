import { Data } from "effect";

export type QuerySyncCanonicalField =
  | "namespaceId"
  | "syncModelId"
  | "sourceEpoch"
  | "sourceSequence"
  | "queryGeneration"
  | "workRevision"
  | "publicationAttemptOrdinal"
  | "publicationAttemptInstant"
  | "queryKey"
  | "queryIdentity"
  | "dependencyKey"
  | "publicationContent"
  | "resultDigest"
  | "authorityWitness";

export type QuerySyncOperation =
  | "captureCanonicalValue"
  | "captureNamespaceCursor"
  | "captureQueryDescriptor"
  | "captureInvalidationBatch"
  | "captureEvaluationEvidence"
  | "capturePublicationArtifact"
  | "classifySequence"
  | "nextSyncSequence"
  | "beginQueryEvaluation"
  | "applyAdmittedInvalidations"
  | "completeQueryEvaluation"
  | "claimEvaluationWork"
  | "recordEvaluationAttemptOutcome"
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication"
  | "buildQuerySyncState"
  | "admitGenerationRefreshEvidence"
  | "deriveGenerationRefreshEvidence"
  | "reduceReferenceModel";

export type QuerySyncAuthorityOperation =
  | "classifySequence"
  | "beginQueryEvaluation"
  | "applyAdmittedInvalidations"
  | "completeQueryEvaluation"
  | "claimEvaluationWork"
  | "recordEvaluationAttemptOutcome"
  | "recordPublicationAttemptOutcome"
  | "completePublication"
  | "admitGenerationRefreshEvidence"
  | "deriveGenerationRefreshEvidence";

export type QueryKeyCollisionOperation =
  | "beginQueryEvaluation"
  | "completeQueryEvaluation"
  | "recordEvaluationAttemptOutcome"
  | "buildQuerySyncState";

export type QueryGenerationExhaustionOperation =
  | "beginQueryEvaluation"
  | "claimEvaluationWork";

export type QueryStateNotFoundOperation =
  | "completeQueryEvaluation"
  | "recordEvaluationAttemptOutcome";

export type QueryGenerationMismatchOperation =
  | "beginQueryEvaluation"
  | "completeQueryEvaluation"
  | "recordEvaluationAttemptOutcome";

export type QuerySyncWorkRevisionOperation =
  | "beginQueryEvaluation"
  | "applyAdmittedInvalidations"
  | "completeQueryEvaluation"
  | "claimEvaluationWork"
  | "recordEvaluationAttemptOutcome";

export type QueryEvaluationWorkBlockedOperation =
  | "beginQueryEvaluation"
  | "completeQueryEvaluation";

export type QueryDependencyLimitOperation =
  | "captureInvalidationBatch"
  | "captureEvaluationEvidence";

export type QuerySyncWorkLimitOperation =
  | "applyAdmittedInvalidations"
  | "admitGenerationRefreshEvidence"
  | "deriveGenerationRefreshEvidence";

interface QuerySyncWorkLimitDimensionByOperation {
  readonly applyAdmittedInvalidations:
    | "dependencyLookups"
    | "affectedQueries";
  readonly admitGenerationRefreshEvidence:
    | "refreshBatches"
    | "refreshKeyExaminations"
    | "refreshCanonicalBytes";
  readonly deriveGenerationRefreshEvidence:
    | "refreshBatches"
    | "refreshKeyExaminations"
    | "refreshCanonicalBytes";
}

export type QuerySyncWorkLimitDimension<
  Operation extends QuerySyncWorkLimitOperation,
> = QuerySyncWorkLimitDimensionByOperation[Operation];

export class QuerySyncCanonicalValueError extends Data.TaggedError(
  "QuerySyncCanonicalValueError",
)<{
  readonly field: QuerySyncCanonicalField;
  readonly reason:
    | "invalidType"
    | "empty"
    | "illFormedUnicode"
    | "containsNul"
    | "invalidSyntax"
    | "decodingFailed"
    | "nonCanonical"
    | "tooLarge"
    | "wrongByteLength"
    | "outOfRange";
  readonly maximum: number | bigint | null;
  readonly observed: number | bigint | null;
}> {}

export class QuerySyncNamespaceMismatchError<
  Operation extends QuerySyncAuthorityOperation = QuerySyncAuthorityOperation,
> extends Data.TaggedError(
  "QuerySyncNamespaceMismatchError",
)<{
  readonly operation: Operation;
  readonly expectedNamespaceId: string;
  readonly observedNamespaceId: string;
}> {}

export class QuerySyncModelMismatchError<
  Operation extends QuerySyncAuthorityOperation = QuerySyncAuthorityOperation,
> extends Data.TaggedError(
  "QuerySyncModelMismatchError",
)<{
  readonly operation: Operation;
  readonly expectedSyncModelId: string;
  readonly observedSyncModelId: string;
}> {}

export class QuerySyncEpochMismatchError<
  Operation extends QuerySyncAuthorityOperation = QuerySyncAuthorityOperation,
> extends Data.TaggedError(
  "QuerySyncEpochMismatchError",
)<{
  readonly operation: Operation;
  readonly expectedSourceEpoch: string;
  readonly observedSourceEpoch: string;
  readonly resetRequired: true;
}> {}

export class QuerySyncSequenceExhaustedError extends Data.TaggedError(
  "QuerySyncSequenceExhaustedError",
)<{
  readonly operation: "nextSyncSequence";
  readonly appliedThroughSequence: bigint;
}> {}

export class QueryGenerationExhaustedError<
  Operation extends QueryGenerationExhaustionOperation =
    QueryGenerationExhaustionOperation,
> extends Data.TaggedError(
  "QueryGenerationExhaustedError",
)<{
  readonly operation: Operation;
  readonly queryKey: string;
  readonly currentGeneration: bigint;
}> {}

export class QueryKeyCollisionError<
  Operation extends QueryKeyCollisionOperation = QueryKeyCollisionOperation,
> extends Data.TaggedError(
  "QueryKeyCollisionError",
)<{
  readonly operation: Operation;
  readonly queryKey: string;
}> {}

export class QueryStateNotFoundError<
  Operation extends QueryStateNotFoundOperation = QueryStateNotFoundOperation,
> extends Data.TaggedError(
  "QueryStateNotFoundError",
)<{
  readonly operation: Operation;
  readonly queryKey: string;
}> {}

export class QueryGenerationMismatchError<
  Operation extends QueryGenerationMismatchOperation =
    QueryGenerationMismatchOperation,
> extends Data.TaggedError(
  "QueryGenerationMismatchError",
)<{
  readonly operation: Operation;
  readonly queryKey: string;
  readonly expectedGeneration: bigint | null;
  readonly observedGeneration: bigint;
}> {}

export class QuerySyncWorkRevisionExhaustedError<
  Operation extends QuerySyncWorkRevisionOperation =
    QuerySyncWorkRevisionOperation,
> extends Data.TaggedError(
  "QuerySyncWorkRevisionExhaustedError",
)<{
  readonly operation: Operation;
  readonly currentRevision: bigint;
}> {}

export class QueryEvaluationWorkBlockedError<
  Operation extends QueryEvaluationWorkBlockedOperation =
    QueryEvaluationWorkBlockedOperation,
> extends Data.TaggedError(
  "QueryEvaluationWorkBlockedError",
)<{
  readonly operation: Operation;
  readonly queryKey: string;
  readonly generation: bigint;
  readonly reason: "terminalEvaluatorRefusal";
  readonly resetRequired: true;
}> {}

export class InvalidEvaluationWorkScanRequestError extends Data.TaggedError(
  "InvalidEvaluationWorkScanRequestError",
)<{
  readonly operation: "claimEvaluationWork";
  readonly reason: "maximumQueryInspectionsOutOfRange";
  readonly maximum: number;
  readonly observed: unknown;
}> {}

export class InvalidEvaluationWorkContinuationError extends Data.TaggedError(
  "InvalidEvaluationWorkContinuationError",
)<{
  readonly operation: "claimEvaluationWork";
  readonly reason: "notStateIssued";
}> {}

export class InvalidEvaluationAttemptError extends Data.TaggedError(
  "InvalidEvaluationAttemptError",
)<{
  readonly operation: "recordEvaluationAttemptOutcome";
  readonly reason:
    | "notStateIssued"
    | "descriptorMismatch"
    | "generationMismatch"
    | "expectedActiveMismatch"
    | "registrationCursorMismatch"
    | "requestedDirtyFrontierMismatch";
  readonly queryKey: string;
  readonly generation: bigint;
}> {}

export class InvalidPublicationAttemptError extends Data.TaggedError(
  "InvalidPublicationAttemptError",
)<{
  readonly operation: "recordPublicationAttemptOutcome";
  readonly reason:
    | "notStateIssued"
    | "publicationIdentityMismatch"
    | "queryIdentityMismatch"
    | "publicationContentMismatch"
    | "resultDigestMismatch"
    | "ordinalMismatch"
    | "firstAttemptInstantMismatch"
    | "attemptInstantMismatch";
  readonly queryKey: string;
  readonly generation: bigint;
  readonly ordinal: number;
}> {}

export class InvalidPublicationAttemptOutcomeReplayError
  extends Data.TaggedError(
    "InvalidPublicationAttemptOutcomeReplayError",
  )<{
    readonly operation: "recordPublicationAttemptOutcome";
    readonly reason: "outcomeMismatch";
    readonly queryKey: string;
    readonly generation: bigint;
    readonly ordinal: number;
  }> {}

export class InvalidAcceptedPublicationEvidenceError extends Data.TaggedError(
  "InvalidAcceptedPublicationEvidenceError",
)<{
  readonly operation: "completePublication";
  readonly reason: "notStateIssued" | "resultDigestMismatch";
  readonly queryKey: string;
  readonly generation: bigint;
}> {}

export class InvalidQueryEvidenceError extends Data.TaggedError(
  "InvalidQueryEvidenceError",
)<{
  readonly operation: "completeQueryEvaluation";
  readonly reason:
    | "attemptEvaluationDescriptorMismatch"
    | "attemptEvaluationGenerationMismatch"
    | "attemptExpectedActiveMismatch"
    | "attemptRegistrationCursorMismatch"
    | "attemptDirtyFrontierMismatch"
    | "evaluationRefreshDescriptorMismatch"
    | "evaluationRefreshGenerationMismatch"
    | "evaluationRefreshSnapshotMismatch"
    | "evaluationRefreshDependenciesMismatch"
    | "snapshotBeforeRegistration"
    | "snapshotBeforeRequestedDirtyFrontier"
    | "snapshotAfterRefresh"
    | "refreshAheadOfCursor"
    | "relevantNotAfterSnapshot"
    | "relevantAfterRefresh";
}> {}

export class InvalidQueryEvaluationRequestError extends Data.TaggedError(
  "InvalidQueryEvaluationRequestError",
)<{
  readonly operation: "beginQueryEvaluation";
  readonly reason:
    | "firstRegistrationHasDirtyFrontier"
    | "rerunMissingDirtyFrontier"
    | "dirtyFrontierAheadOfCursor"
    | "dirtyFrontierNotObserved";
  readonly queryKey: string;
  readonly requestedDirtyThroughSequence: bigint | null;
  readonly observedDirtyThroughSequence: bigint | null;
}> {}

export class InvalidQueryCompletionReplayError extends Data.TaggedError(
  "InvalidQueryCompletionReplayError",
)<{
  readonly operation: "completeQueryEvaluation";
  readonly reason: "fingerprintMismatch" | "publicationContentMismatch";
  readonly queryKey: string;
  readonly generation: bigint;
}> {}

export class InvalidRefreshEvidenceError<
  Operation extends
    | "admitGenerationRefreshEvidence"
    | "deriveGenerationRefreshEvidence" =
      | "admitGenerationRefreshEvidence"
      | "deriveGenerationRefreshEvidence",
> extends Data.TaggedError(
  "InvalidRefreshEvidenceError",
)<{
  readonly operation: Operation;
  readonly reason:
    | "targetBeforeSnapshot"
    | "missingBatch"
    | "extraBatch"
    | "nonContiguousBatch";
  readonly expectedSequence: bigint | null;
  readonly observedSequence: bigint | null;
}> {}

export class QueryDependencyLimitError<
  Operation extends QueryDependencyLimitOperation = QueryDependencyLimitOperation,
> extends Data.TaggedError(
  "QueryDependencyLimitError",
)<{
  readonly operation: Operation;
  readonly dimension: "rawEntries" | "distinctEntries" | "decodedBytes";
  readonly maximum: number;
  readonly observed: number;
}> {}

export class QuerySyncStateLimitError extends Data.TaggedError(
  "QuerySyncStateLimitError",
)<{
  readonly operation: "buildQuerySyncState";
  readonly dimension:
    | "queryCount"
    | "retainedIdentityBytes"
    | "dependencyMemberships"
    | "pendingPublicationCount"
    | "retainedPublicationContentBytes"
    | "countedCanonicalBytes";
  readonly maximum: number;
  readonly observed: number;
}> {}

export class QuerySyncWorkLimitError<
  Operation extends QuerySyncWorkLimitOperation = QuerySyncWorkLimitOperation,
> extends Data.TaggedError(
  "QuerySyncWorkLimitError",
)<{
  readonly operation: Operation;
  readonly dimension: QuerySyncWorkLimitDimension<Operation>;
  readonly maximum: number;
  readonly observed: number;
}> {}

export type AnyQuerySyncWorkLimitError = {
  [Operation in QuerySyncWorkLimitOperation]:
    QuerySyncWorkLimitError<Operation>;
}[QuerySyncWorkLimitOperation];

export class QuerySyncInvariantDefect extends Data.TaggedError(
  "QuerySyncInvariantDefect",
)<{
  readonly operation:
    | "beginQueryEvaluation"
    | "applyAdmittedInvalidations"
    | "completeQueryEvaluation"
    | "claimEvaluationWork"
    | "recordEvaluationAttemptOutcome"
    | "claimPublication"
    | "recordPublicationAttemptOutcome"
    | "completePublication"
    | "buildQuerySyncState";
  readonly invariant:
    | "capturedTextBecameIllFormed"
    | "rebuiltEvaluationMissing"
    | "dependencyDirectoryEntryMissingActiveQuery"
    | "emptyQuerySlots"
    | "provisionalRegistrationAuthorityMismatch"
    | "provisionalRegistrationAheadOfCursor"
    | "initialProvisionalGenerationNotOne"
    | "initialProvisionalFenceNotNull"
    | "initialProvisionalDirtyFrontierNotNull"
    | "provisionalGenerationNotAfterActive"
    | "provisionalGenerationNotSuccessor"
    | "provisionalFenceMismatch"
    | "provisionalDirtyFrontierMissing"
    | "provisionalDirtyFrontierNotAfterFreshness"
    | "provisionalDirtyFrontierAheadOfObservedDirty"
    | "activeSnapshotAfterFreshness"
    | "activeFreshnessAheadOfCursor"
    | "activeDirtyNotAfterFreshness"
    | "activeDirtyAheadOfCursor"
    | "activeDependencyCountExceeded"
    | "activeDependencyBytesExceeded"
    | "activeDependenciesNotCanonicalSet"
    | "activeCompletionMissing"
    | "completionWithoutActive"
    | "completionIdentityMismatch"
    | "completionActiveStateMismatch"
    | "completionRegistrationAuthorityMismatch"
    | "completionRegistrationAheadOfCursor"
    | "completionSnapshotBeforeRegistration"
    | "completionPrecedingIdentityInvalid"
    | "pendingPublicationAuthorityMismatch"
    | "pendingPublicationQueryMissing"
    | "pendingPublicationIdentityMismatch"
    | "pendingPublicationDuplicateQuery"
    | "pendingPublicationGenerationAhead"
    | "currentPendingPublicationMissing"
    | "stateClockInstantInvalid"
    | "workRevisionInvalid"
    | "fairnessAnchorQueryMissing"
    | "evaluationDispositionInvalid"
    | "publicationWorkAuthorityMismatch"
    | "publicationWorkQueryMissing"
    | "publicationWorkIdentityMismatch"
    | "publicationWorkDuplicateQuery"
    | "publicationWorkGenerationAhead"
    | "publicationWorkIdentityDuplicated"
    | "publicationWorkQueuedGenerationInvalid"
    | "publicationAttemptStateInvalid"
    | "publicationAttemptTimeInvalid"
    | "publicationDeliveredStateInvalid"
    | "publicationOutcomeStateInvalid"
    | "publicationOutcomeReceiptInvalid"
    | "publicationLifecycleLinkInvalid"
    | "dirtyEvaluationClaimUnexpectedDecision";
}> {}

export type QuerySyncAuthorityError<
  Operation extends QuerySyncAuthorityOperation = QuerySyncAuthorityOperation,
> =
  | QuerySyncNamespaceMismatchError<Operation>
  | QuerySyncModelMismatchError<Operation>
  | QuerySyncEpochMismatchError<Operation>;

export type QuerySyncKernelError =
  | QuerySyncCanonicalValueError
  | QuerySyncAuthorityError
  | QuerySyncSequenceExhaustedError
  | QueryGenerationExhaustedError
  | QueryKeyCollisionError
  | QueryStateNotFoundError
  | QueryGenerationMismatchError
  | QuerySyncWorkRevisionExhaustedError
  | QueryEvaluationWorkBlockedError
  | InvalidEvaluationWorkScanRequestError
  | InvalidEvaluationWorkContinuationError
  | InvalidEvaluationAttemptError
  | InvalidPublicationAttemptError
  | InvalidPublicationAttemptOutcomeReplayError
  | InvalidAcceptedPublicationEvidenceError
  | InvalidQueryEvaluationRequestError
  | InvalidQueryCompletionReplayError
  | InvalidQueryEvidenceError
  | InvalidRefreshEvidenceError
  | QueryDependencyLimitError
  | QuerySyncStateLimitError
  | AnyQuerySyncWorkLimitError;

import { Data } from "effect";

export type QuerySyncCanonicalField =
  | "namespaceId"
  | "syncModelId"
  | "sourceEpoch"
  | "sourceSequence"
  | "queryGeneration"
  | "queryKey"
  | "queryIdentity"
  | "dependencyKey"
  | "resultDigest"
  | "authorityWitness";

export type QuerySyncOperation =
  | "captureCanonicalValue"
  | "captureNamespaceCursor"
  | "captureQueryDescriptor"
  | "captureInvalidationBatch"
  | "captureEvaluationEvidence"
  | "classifySequence"
  | "nextSyncSequence"
  | "beginQueryGeneration"
  | "applyAdmittedInvalidations"
  | "completeQueryGeneration"
  | "buildQuerySyncState"
  | "admitGenerationRefreshEvidence"
  | "deriveGenerationRefreshEvidence"
  | "reduceReferenceModel";

export type QuerySyncAuthorityOperation =
  | "classifySequence"
  | "beginQueryGeneration"
  | "applyAdmittedInvalidations"
  | "completeQueryGeneration"
  | "admitGenerationRefreshEvidence"
  | "deriveGenerationRefreshEvidence";

export type QueryKeyCollisionOperation =
  | "beginQueryGeneration"
  | "completeQueryGeneration"
  | "buildQuerySyncState";

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

export class QueryGenerationExhaustedError extends Data.TaggedError(
  "QueryGenerationExhaustedError",
)<{
  readonly operation: "beginQueryGeneration";
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

export class QueryStateNotFoundError extends Data.TaggedError(
  "QueryStateNotFoundError",
)<{
  readonly operation: "completeQueryGeneration";
  readonly queryKey: string;
}> {}

export class QueryGenerationMismatchError extends Data.TaggedError(
  "QueryGenerationMismatchError",
)<{
  readonly operation: "completeQueryGeneration";
  readonly queryKey: string;
  readonly expectedGeneration: bigint | null;
  readonly observedGeneration: bigint;
}> {}

export class InvalidQueryEvidenceError extends Data.TaggedError(
  "InvalidQueryEvidenceError",
)<{
  readonly operation: "completeQueryGeneration";
  readonly reason:
    | "evaluationRefreshDescriptorMismatch"
    | "evaluationRefreshGenerationMismatch"
    | "evaluationRefreshSnapshotMismatch"
    | "evaluationRefreshDependenciesMismatch"
    | "snapshotBeforeRegistration"
    | "snapshotAfterRefresh"
    | "refreshAheadOfCursor"
    | "relevantNotAfterSnapshot"
    | "relevantAfterRefresh";
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
    | "beginQueryGeneration"
    | "applyAdmittedInvalidations"
    | "buildQuerySyncState";
  readonly invariant:
    | "capturedTextBecameIllFormed"
    | "rebuiltGenerationMissing"
    | "dependencyDirectoryEntryMissingActiveQuery"
    | "emptyQuerySlots"
    | "provisionalRegistrationAuthorityMismatch"
    | "provisionalRegistrationAheadOfCursor"
    | "initialProvisionalGenerationNotOne"
    | "provisionalGenerationNotAfterActive"
    | "activeSnapshotAfterFreshness"
    | "activeFreshnessAheadOfCursor"
    | "activeDirtyNotAfterFreshness"
    | "activeDirtyAheadOfCursor"
    | "activeDependencyCountExceeded"
    | "activeDependencyBytesExceeded"
    | "activeDependenciesNotCanonicalSet";
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
  | InvalidQueryEvidenceError
  | InvalidRefreshEvidenceError
  | QueryDependencyLimitError
  | QuerySyncStateLimitError
  | AnyQuerySyncWorkLimitError;

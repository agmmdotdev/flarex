import { Data } from "effect";

export type QuerySyncStateOperation =
  | "initializeOrInspectNamespace"
  | "beginQueryGeneration"
  | "applyAdmittedBatchAndAdvance"
  | "completeQueryGeneration";

export type QuerySyncStateCommitCertainty = "notCommitted" | "unknown";

export class QuerySyncStateUnavailableError<
  Operation extends QuerySyncStateOperation = QuerySyncStateOperation,
> extends Data.TaggedError("QuerySyncStateUnavailableError")<{
  readonly operation: Operation;
  readonly commitCertainty: "notCommitted";
  readonly reason: "temporarilyUnavailable";
  readonly cause: unknown;
}> {}

export class QuerySyncStateContentionError<
  Operation extends QuerySyncStateOperation = QuerySyncStateOperation,
> extends Data.TaggedError("QuerySyncStateContentionError")<{
  readonly operation: Operation;
  readonly commitCertainty: "notCommitted";
  readonly reason: "serializationRetriesExhausted";
  readonly cause: unknown;
}> {}

export class QuerySyncStateCommitOutcomeUnknownError<
  Operation extends QuerySyncStateOperation = QuerySyncStateOperation,
> extends Data.TaggedError("QuerySyncStateCommitOutcomeUnknownError")<{
  readonly operation: Operation;
  readonly commitCertainty: "unknown";
  readonly reason: "responseLostAfterCommit";
  readonly cause: unknown;
}> {}

export class QuerySyncStoredStateCorruptError<
  Operation extends QuerySyncStateOperation = QuerySyncStateOperation,
> extends Data.TaggedError("QuerySyncStoredStateCorruptError")<{
  readonly operation: Operation;
  readonly commitCertainty: "notCommitted";
  readonly reason:
    | "aggregateMissing"
    | "namespaceBindingMismatch"
    | "storedAggregateInvalid";
  readonly cause: unknown;
}> {}

export class QuerySyncStoredStateIncompatibleError<
  Operation extends QuerySyncStateOperation = QuerySyncStateOperation,
> extends Data.TaggedError("QuerySyncStoredStateIncompatibleError")<{
  readonly operation: Operation;
  readonly commitCertainty: "notCommitted";
  readonly reason: "unsupportedStoredContract" | "bootstrapBindingMismatch";
  readonly cause: unknown;
}> {}

export class QuerySyncStateCapacityError<
  Operation extends QuerySyncStateOperation = QuerySyncStateOperation,
> extends Data.TaggedError("QuerySyncStateCapacityError")<{
  readonly operation: Operation;
  readonly commitCertainty: "notCommitted";
  readonly reason: "adapterCapacityExceeded" | "quotaExceeded";
  readonly cause: unknown;
}> {}

export type QuerySyncStateIntegrationError<
  Operation extends QuerySyncStateOperation = QuerySyncStateOperation,
> =
  | QuerySyncStateUnavailableError<Operation>
  | QuerySyncStateContentionError<Operation>
  | QuerySyncStateCommitOutcomeUnknownError<Operation>
  | QuerySyncStoredStateCorruptError<Operation>
  | QuerySyncStoredStateIncompatibleError<Operation>
  | QuerySyncStateCapacityError<Operation>;

import type { CreateStandardApplicationTaskRunError } from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import { Data } from "effect";

export type TaskAdmissionErrorReason =
  | "invalidInput"
  | "invalidIdentity"
  | "taskNotFound"
  | "applicationUnavailable"
  | "idempotencyConflict"
  | "invalidConfiguration"
  | "incompatibleRuntime"
  | "unavailable"
  | "corruptData"
  | "staleScopeAuthority"
  | "transient"
  | "terminal"
  | "settlementUncertain";

class TaskAdmissionFailure extends Data.TaggedError("TaskAdmissionError")<{
  readonly operation: "startTask";
  readonly reason: TaskAdmissionErrorReason;
  /** Opaque owner failure retained for diagnostics and Cause inspection. */
  readonly cause: unknown;
}> {}

/** Stable clean failure contract for durable Task admission. */
export type TaskAdmissionError = TaskAdmissionFailure;

export function projectTaskAdmissionError(
  error: CreateStandardApplicationTaskRunError,
): TaskAdmissionError {
  if (!("_tag" in error)) {
    return taskAdmissionError(projectTransactionFailureReason(error), error);
  }

  switch (error._tag) {
    case "TaskInputStoreInputError":
      return taskAdmissionError("invalidInput", error);
    case "TaskInputStoreNotFoundError":
    case "TaskInputStoreResourceError":
      return taskAdmissionError("unavailable", error);
    case "TaskInputStoreCorruptionError":
      return taskAdmissionError("corruptData", error);
    case "TaskInputStoreSettlementUncertainError":
      return taskAdmissionError("settlementUncertain", error);
    case "TaskExecutionPrincipalStoreInputError":
      return taskAdmissionError("invalidIdentity", error);
    case "TaskExecutionPrincipalStoreNotFoundError":
    case "TaskExecutionPrincipalStoreResourceError":
      return taskAdmissionError("unavailable", error);
    case "TaskExecutionPrincipalStoreCorruptionError":
      return taskAdmissionError("corruptData", error);
    case "TaskExecutionPrincipalStoreSettlementUncertainError":
      return taskAdmissionError("settlementUncertain", error);
    case "ApplicationTaskSystemCompositionError":
      return taskAdmissionError("invalidConfiguration", error);
    case "ApplicationActivationError":
      return taskAdmissionError(projectActivationReason(error), error);
    case "ApplicationReadinessError":
      return taskAdmissionError(projectReadinessReason(error), error);
    case "ApplicationSchemaAuthorityError":
      return taskAdmissionError(projectSchemaAuthorityReason(error), error);
    case "ApplicationTaskCatalogSnapshotError":
      return taskAdmissionError(projectTaskCatalogReason(error), error);
    case "ApplicationTaskSelectionError":
      return taskAdmissionError(projectSelectionReason(error), error);
    case "TrustedScopeAuthorityResolutionError":
    case "ScopeClockNotFoundError":
      return taskAdmissionError("staleScopeAuthority", error);
    case "TrustedScopeAuthorityPortError":
    case "ScopeAuthorizationRevocationEpochPersistenceError":
      return taskAdmissionError("unavailable", error);
    case "ScopeClockCorruptionError":
    case "AppIndexDefinitionCatalogCorruptionError":
    case "AppUniqueConstraintCatalogCorruptionError":
    case "AppUniqueConstraintSetBuildStateV1Error":
    case "AppUniqueConstraintSetClosureCorruptionV1Error":
    case "IndexBuildReconciliationCatalogV1Error":
    case "InvalidAppIndexDefinitionBindingInputError":
    case "InvalidPhysicalDefinitionLifecycleInputError":
    case "InvalidPreparedPhysicalDefinitionLifecycleReadinessError":
    case "InvalidSchemaVersionArtifactInputError":
    case "SchemaVersionArtifactCorruptionError":
      return taskAdmissionError("corruptData", error);
    case "AppUniqueConstraintSetBuildStaleAuthorityV1Error":
      return taskAdmissionError("staleScopeAuthority", error);
    case "AppIndexDefinitionReadPersistenceError":
    case "AppSchemaVersionIndexBindingPersistenceError":
    case "AppUniqueConstraintCatalogPersistenceError":
    case "AppUniqueConstraintSetClosurePersistenceV1Error":
    case "PhysicalDefinitionLifecyclePersistenceError":
    case "SchemaVersionArtifactPersistenceError":
      return taskAdmissionError("unavailable", error);
    case "AppUniqueConstraintSetBuildIntegrationV1Error":
      return taskAdmissionError(
        error.retryable ? "transient" : "unavailable",
        error,
      );
    case "AppUniqueConstraintSetEligibilityV1Error":
    case "InvalidPhysicalDefinitionLifecyclePortError":
    case "PointCommitUniqueConstraintEligibilityUnavailableV1Error":
      return taskAdmissionError("invalidConfiguration", error);
    case "PhysicalDefinitionLifecycleConflictError":
      return taskAdmissionError(
        projectPhysicalDefinitionConflictReason(error),
        error,
      );
    case "InvalidTaskRunCreationRequestError":
    case "InvalidTaskRunInitialAggregateError":
    case "InvalidStandardApplicationTaskDefinitionV1Error":
    case "StandardApplicationTaskSha256InputV1Error":
      return taskAdmissionError("corruptData", error);
    case "TaskRunCreationIdempotencyConflictError":
      return taskAdmissionError("idempotencyConflict", error);
    case "StandardApplicationTaskSha256ResourceV1Error":
      return taskAdmissionError("unavailable", error);
    case "TaskSystemRunCreationBindingError":
      return taskAdmissionError(projectCreationBindingReason(error), error);
    case "TaskSystemRunCreationCorruptionError":
      return taskAdmissionError("corruptData", error);
    case "TaskSystemRunCreationStaleScopeAuthorityError":
      return taskAdmissionError("staleScopeAuthority", error);
    case "TaskSystemRunCreationTransientStoreError":
      return taskAdmissionError("transient", error);
    case "TaskSystemRunCreationTerminalStoreError":
      return taskAdmissionError("terminal", error);
    default: {
      const unhandledError: never = error;
      throw new TypeError(
        `Unhandled Task admission error: ${String(unhandledError)}`,
      );
    }
  }
}

function taskAdmissionError(
  reason: TaskAdmissionErrorReason,
  cause: unknown,
): TaskAdmissionError {
  return new TaskAdmissionFailure({ operation: "startTask", reason, cause });
}

function projectActivationReason(
  error: Extract<
    CreateStandardApplicationTaskRunError,
    { readonly _tag: "ApplicationActivationError" }
  >,
): TaskAdmissionErrorReason {
  switch (error.reason) {
    case "invalidInput":
      return "invalidInput";
    case "invalidComposition":
      return "invalidConfiguration";
    case "notReady":
    case "activeMissing":
      return "applicationUnavailable";
    case "alreadyActive":
    case "expectedHead":
    case "concurrentHead":
      return "transient";
    case "scopeAuthority":
      return "staleScopeAuthority";
    case "storedState":
      return "corruptData";
    case "decisionUncertain":
      return "settlementUncertain";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectSelectionReason(
  error: Extract<
    CreateStandardApplicationTaskRunError,
    { readonly _tag: "ApplicationTaskSelectionError" }
  >,
): TaskAdmissionErrorReason {
  switch (error.reason) {
    case "invalidComposition":
      return "invalidConfiguration";
    case "invalidTaskId":
      return "corruptData";
    case "taskMissing":
      return "taskNotFound";
    case "storedTask":
      return "corruptData";
    case "authorityMismatch":
      return "staleScopeAuthority";
    case "runtimeHostMismatch":
      return "incompatibleRuntime";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectReadinessReason(
  error: Extract<
    CreateStandardApplicationTaskRunError,
    { readonly _tag: "ApplicationReadinessError" }
  >,
): TaskAdmissionErrorReason {
  switch (error.reason) {
    case "invalidInput":
    case "storedState":
    case "schemaBinding":
    case "coldMaterialization":
      return "corruptData";
    case "authorityChanged":
      return "staleScopeAuthority";
    case "conflictingReplay":
      return "transient";
    case "invalidComposition":
      return "invalidConfiguration";
    case "decisionUncertain":
      return "settlementUncertain";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectSchemaAuthorityReason(
  error: Extract<
    CreateStandardApplicationTaskRunError,
    { readonly _tag: "ApplicationSchemaAuthorityError" }
  >,
): TaskAdmissionErrorReason {
  switch (error.reason) {
    case "invalidDeployment":
      return "invalidConfiguration";
    case "invalidManifest":
    case "invalidSchema":
    case "projectionMismatch":
      return "corruptData";
    case "resourceFailure":
      return "unavailable";
  }
}

function projectTaskCatalogReason(
  error: Extract<
    CreateStandardApplicationTaskRunError,
    { readonly _tag: "ApplicationTaskCatalogSnapshotError" }
  >,
): TaskAdmissionErrorReason {
  switch (error.reason) {
    case "invalidInput":
    case "storedState":
      return "corruptData";
    case "authorityChanged":
      return "staleScopeAuthority";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectPhysicalDefinitionConflictReason(
  error: Extract<
    CreateStandardApplicationTaskRunError,
    { readonly _tag: "PhysicalDefinitionLifecycleConflictError" }
  >,
): TaskAdmissionErrorReason {
  switch (error.reason) {
    case "authorityChanged":
      return "staleScopeAuthority";
    case "expectedFenceMismatch":
    case "requestConflict":
      return "transient";
    case "transitionInvalid":
    case "storedStateInvalid":
      return "corruptData";
  }
}

function projectCreationBindingReason(
  error: Extract<
    CreateStandardApplicationTaskRunError,
    { readonly _tag: "TaskSystemRunCreationBindingError" }
  >,
): TaskAdmissionErrorReason {
  switch (error.reason) {
    case "request_authority_mismatch":
    case "authority_binding_mismatch":
      return "staleScopeAuthority";
    case "definition_unavailable":
      return "taskNotFound";
    case "stored_binding_mismatch":
      return "corruptData";
  }
}

function projectTransactionFailureReason(
  error: Exclude<
    CreateStandardApplicationTaskRunError,
    { readonly _tag: string }
  >,
): TaskAdmissionErrorReason {
  switch (error.issue.kind) {
    case "decisionUncertain":
    case "callbackCleanupFailed":
      return "settlementUncertain";
    case "infrastructureFailure":
    case "callbackRolledBack":
      return "unavailable";
  }
}

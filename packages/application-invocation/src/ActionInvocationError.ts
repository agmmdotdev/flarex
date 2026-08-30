import type { InvokeApplicationActionError } from
  "@flarex/standard-application-invocation/internal/application-action-system";
import { Data } from "effect";

export type ActionInvocationErrorReason =
  | "invalidInput"
  | "actionNotFound"
  | "applicationUnavailable"
  | "idempotencyConflict"
  | "invalidConfiguration"
  | "incompatibleRuntime"
  | "applicationError"
  | "executionFailed"
  | "unavailable"
  | "corruptData"
  | "staleScopeAuthority"
  | "transient"
  | "terminal"
  | "settlementUncertain";

class ActionInvocationFailure extends Data.TaggedError(
  "ActionInvocationError",
)<{
  readonly operation: "runAction";
  readonly reason: ActionInvocationErrorReason;
  /** Opaque owner failure retained for diagnostics and Cause inspection. */
  readonly cause: unknown;
}> {}

/** Stable clean failure contract for foreground Action invocation. */
export type ActionInvocationError = ActionInvocationFailure;

export function projectActionInvocationError(
  error: InvokeApplicationActionError,
): ActionInvocationError {
  if (!("_tag" in error)) {
    return actionInvocationError(projectTransactionFailureReason(error), error);
  }

  switch (error._tag) {
    case "ApplicationActionInputError":
      return actionInvocationError("invalidInput", error);
    case "ApplicationActionSystemConfigurationError":
      return actionInvocationError("invalidConfiguration", error);
    case "ApplicationActionSystemCorruptionError":
      return actionInvocationError("corruptData", error);
    case "ApplicationActionAdmissionError":
      return actionInvocationError(projectAdmissionReason(error), error);
    case "ApplicationActivationError":
      return actionInvocationError(projectActivationReason(error), error);
    case "ApplicationReadinessError":
      return actionInvocationError(projectReadinessReason(error), error);
    case "ApplicationSchemaAuthorityError":
      return actionInvocationError(projectSchemaAuthorityReason(error), error);
    case "ApplicationTaskCatalogSnapshotError":
      return actionInvocationError(projectTaskCatalogReason(error), error);
    case "TrustedScopeAuthorityResolutionError":
    case "ScopeClockNotFoundError":
    case "ApplicationActionAuthorityStaleV1Error":
    case "InvalidDirectActionExecutionSubjectV1Error":
      return actionInvocationError("staleScopeAuthority", error);
    case "TrustedScopeAuthorityPortError":
    case "ScopeAuthorizationRevocationEpochPersistenceError":
    case "AppIndexDefinitionReadPersistenceError":
    case "AppSchemaVersionIndexBindingPersistenceError":
    case "AppUniqueConstraintCatalogPersistenceError":
    case "AppUniqueConstraintSetClosurePersistenceV1Error":
    case "PhysicalDefinitionLifecyclePersistenceError":
    case "SchemaVersionArtifactPersistenceError":
    case "ApplicationActionAuthorityIntegrationV1Error":
    case "ExecutionEvidenceBodyResourceV1Error":
      return actionInvocationError("unavailable", error);
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
    case "ApplicationActionAuthorityInputV1Error":
    case "ApplicationActionAuthorityCorruptionV1Error":
    case "ExecutionEvidenceBodyNotFoundV1Error":
    case "ExecutionEvidenceBodyCorruptionV1Error":
      return actionInvocationError("corruptData", error);
    case "AppUniqueConstraintSetBuildStaleAuthorityV1Error":
      return actionInvocationError("staleScopeAuthority", error);
    case "AppUniqueConstraintSetBuildIntegrationV1Error":
      return actionInvocationError(
        error.retryable ? "transient" : "unavailable",
        error,
      );
    case "InvalidPhysicalDefinitionLifecyclePortError":
    case "PointCommitUniqueConstraintEligibilityUnavailableV1Error":
      return actionInvocationError("invalidConfiguration", error);
    case "AppUniqueConstraintSetEligibilityV1Error":
      return actionInvocationError(
        projectUniqueConstraintEligibilityReason(error),
        error,
      );
    case "PhysicalDefinitionLifecycleConflictError":
      return actionInvocationError(
        projectPhysicalDefinitionConflictReason(error),
        error,
      );
    case "ApplicationActionRequestKeyConflictV1Error":
      return actionInvocationError("idempotencyConflict", error);
    case "ApplicationActionLifecycleConflictV1Error":
    case "ApplicationActionInvocationMissingV1Error":
      return actionInvocationError("transient", error);
    case "ApplicationActionHostCompositionError":
      return actionInvocationError(projectHostCompositionReason(error), error);
    case "ApplicationActionRunnerCompositionError":
      return actionInvocationError(projectRunnerCompositionReason(error), error);
    case "ApplicationActionCapabilitySessionError":
      return actionInvocationError("settlementUncertain", error);
    case "ApplicationExecutionHostError":
      return actionInvocationError(projectExecutionHostReason(error), error);
    case "ExecutionEvidenceProtocolV1Error":
      return actionInvocationError(projectEvidenceProtocolReason(error), error);
    case "ExecutionEvidenceBodyInputV1Error":
      return actionInvocationError("invalidInput", error);
    case "ExecutionEvidenceBodySettlementUncertainV1Error":
      return actionInvocationError("settlementUncertain", error);
    default: {
      const unhandledError: never = error;
      throw new TypeError(
        `Unhandled Action invocation error: ${String(unhandledError)}`,
      );
    }
  }
}

function actionInvocationError(
  reason: ActionInvocationErrorReason,
  cause: unknown,
): ActionInvocationError {
  return new ActionInvocationFailure({ operation: "runAction", reason, cause });
}

function projectAdmissionReason(
  error: Extract<
    InvokeApplicationActionError,
    { readonly _tag: "ApplicationActionAdmissionError" }
  >,
): ActionInvocationErrorReason {
  switch (error.reason) {
    case "invalidComposition":
      return "invalidConfiguration";
    case "invalidFunction":
      return "invalidInput";
    case "functionMissing":
      return "actionNotFound";
    case "functionUnsupported":
      return "incompatibleRuntime";
    case "storedFunction":
    case "invalidExecutionAuthority":
      return "corruptData";
    case "authorityMismatch":
      return "staleScopeAuthority";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectActivationReason(
  error: Extract<
    InvokeApplicationActionError,
    { readonly _tag: "ApplicationActivationError" }
  >,
): ActionInvocationErrorReason {
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

function projectReadinessReason(
  error: Extract<
    InvokeApplicationActionError,
    { readonly _tag: "ApplicationReadinessError" }
  >,
): ActionInvocationErrorReason {
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
    InvokeApplicationActionError,
    { readonly _tag: "ApplicationSchemaAuthorityError" }
  >,
): ActionInvocationErrorReason {
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
    InvokeApplicationActionError,
    { readonly _tag: "ApplicationTaskCatalogSnapshotError" }
  >,
): ActionInvocationErrorReason {
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
    InvokeApplicationActionError,
    { readonly _tag: "PhysicalDefinitionLifecycleConflictError" }
  >,
): ActionInvocationErrorReason {
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

function projectUniqueConstraintEligibilityReason(
  error: Extract<
    InvokeApplicationActionError,
    { readonly _tag: "AppUniqueConstraintSetEligibilityV1Error" }
  >,
): ActionInvocationErrorReason {
  switch (error.reason) {
    case "invalidPort":
      return "invalidConfiguration";
    case "scopeMismatch":
      return "staleScopeAuthority";
    case "targetTransaction":
      if (error.retryable) return "transient";
      return isDecisionUncertainTransactionCause(error.cause)
        ? "settlementUncertain"
        : "unavailable";
  }
}

function isDecisionUncertainTransactionCause(cause: unknown): boolean {
  if (
    !(cause instanceof Error) ||
    cause.name !== "LocatedReadCommittedTransactionFailureV1" ||
    !("issue" in cause)
  ) return false;
  const issue = cause.issue;
  return typeof issue === "object" && issue !== null &&
    !Array.isArray(issue) && "kind" in issue &&
    issue.kind === "decisionUncertain";
}

function projectHostCompositionReason(
  error: Extract<
    InvokeApplicationActionError,
    { readonly _tag: "ApplicationActionHostCompositionError" }
  >,
): ActionInvocationErrorReason {
  switch (error.reason) {
    case "invalidInput":
    case "invalidArguments":
    case "invalidResult":
    case "invalidBundle":
      return "corruptData";
    case "authorityMismatch":
      return "staleScopeAuthority";
    case "settlementUnavailable":
      return "settlementUncertain";
  }
}

function projectRunnerCompositionReason(
  error: Extract<
    InvokeApplicationActionError,
    { readonly _tag: "ApplicationActionRunnerCompositionError" }
  >,
): ActionInvocationErrorReason {
  switch (error.reason) {
    case "invalidAuthority":
      return "staleScopeAuthority";
    case "invalidManifest":
    case "invalidRequest":
      return "corruptData";
    case "runtimeHostMismatch":
    case "compatibilityDateMismatch":
      return "incompatibleRuntime";
    case "hostPolicyMismatch":
      return "invalidConfiguration";
    case "sourceReadFailed":
    case "workerDefinitionFailed":
      return "unavailable";
  }
}

function projectExecutionHostReason(
  error: Extract<
    InvokeApplicationActionError,
    { readonly _tag: "ApplicationExecutionHostError" }
  >,
): ActionInvocationErrorReason {
  switch (error.reason) {
    case "invalidRequest":
    case "invalidResult":
      return "corruptData";
    case "workerLoadFailed":
    case "workerDefinitionFailed":
    case "readBoundaryFailed":
    case "journalBoundaryFailed":
      return "unavailable";
    case "callbackFailed":
      return "settlementUncertain";
    case "applicationError":
      return "applicationError";
    case "userCodeFailed":
      return "executionFailed";
    case "terminalFailed":
    case "timedOut":
      return "terminal";
  }
}

function projectEvidenceProtocolReason(
  error: Extract<
    InvokeApplicationActionError,
    { readonly _tag: "ExecutionEvidenceProtocolV1Error" }
  >,
): ActionInvocationErrorReason {
  switch (error.reason) {
    case "invalidInput":
    case "boundsExceeded":
      return "invalidInput";
    case "malformed":
    case "nonCanonical":
      return "corruptData";
  }
}

function projectTransactionFailureReason(
  error: Exclude<InvokeApplicationActionError, { readonly _tag: string }>,
): ActionInvocationErrorReason {
  switch (error.issue.kind) {
    case "decisionUncertain":
    case "callbackCleanupFailed":
      return "settlementUncertain";
    case "infrastructureFailure":
    case "callbackRolledBack":
      return "unavailable";
  }
}

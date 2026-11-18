import {
  Data,
  Effect,
} from "effect";
import type { ApplicationSchemaAuthorityError } from "../applicationSchemaAuthority";
import type { ApplicationTaskCatalogSnapshotError } from "../tasks/applicationTaskBindings";
import type { ReadSchemaVersionArtifactError } from "../../storage/catalog/schemaVersionArtifacts";
import type {
  ReadAppIndexDefinitionError,
  ReadAppSchemaVersionIndexBindingError,
} from "../../storage/indexes/appIndexDefinitions";
import type {
  IndexBuildReconciliationCatalogV1Error,
  loadPublishedPhysicalRequirementSnapshotV1,
} from "../../storage/indexes/indexBuildReconciliation";
import type { TrustedScopeAuthorityError } from "../../scope/scopeAuthorityResolution";
import type {
  LoadAppSchemaCandidateReadinessError,
  ValidateAppSchemaCandidateReadinessError,
} from "../../storage/catalog/appSchemaCandidateValidation";
import type {
  LoadPointCommitUniqueConstraintEligibilityV1Error,
  ValidatePointCommitUniqueConstraintEligibilityV1Error,
} from "../../commit/point/errors";
import type {
  PreparePhysicalDefinitionLifecycleReadinessError,
  ValidatePhysicalDefinitionLifecycleReadinessError,
} from "../../installation/physicalDefinitionLifecycle";
import type {
  LockScopeClockForShareError,
  LockScopeClockForUpdateError,
} from "../../scope/scopeClock";
import type {
  preparePointCommitUniqueConstraintSet,
  acceptPreparedPointCommitUniqueConstraintSet,
} from "../../commit/point/uniqueEligibility";
import type {
  lendPreparedAppUniqueConstraintDefinitions,
} from "../../storage/unique/appUniqueConstraintSetBuildV1";

export class ApplicationReadinessError extends Data.TaggedError(
  "ApplicationReadinessError",
)<{
  readonly operation: "settle" | "readReady";
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "storedState"
    | "schemaBinding"
    | "coldMaterialization"
    | "conflictingReplay"
    | "invalidComposition"
    | "decisionUncertain"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type SettleApplicationReadinessError<SchemaFailure, ColdFailure> =
  | ApplicationReadinessError
  | ApplicationSchemaAuthorityError
  | ApplicationTaskCatalogSnapshotError
  | SchemaFailure
  | ColdFailure
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | IndexBuildReconciliationCatalogV1Error
  | TrustedScopeAuthorityError
  | LoadAppSchemaCandidateReadinessError
  | ValidateAppSchemaCandidateReadinessError
  | LoadPointCommitUniqueConstraintEligibilityV1Error
  | ValidatePointCommitUniqueConstraintEligibilityV1Error
  | PreparePhysicalDefinitionLifecycleReadinessError
  | ValidatePhysicalDefinitionLifecycleReadinessError
  | LockScopeClockForShareError
  | LockScopeClockForUpdateError;

export type ReadApplicationReadinessError =
  | ApplicationReadinessError
  | ApplicationSchemaAuthorityError
  | ApplicationTaskCatalogSnapshotError
  | ReadSchemaVersionArtifactError
  | ReadAppIndexDefinitionError
  | ReadAppSchemaVersionIndexBindingError
  | IndexBuildReconciliationCatalogV1Error
  | TrustedScopeAuthorityError
  | LoadPointCommitUniqueConstraintEligibilityV1Error
  | PreparePhysicalDefinitionLifecycleReadinessError
  | ValidatePhysicalDefinitionLifecycleReadinessError
  | LockScopeClockForShareError;

export type StoredApplicationReadinessValidationError = ApplicationReadinessError |
  ApplicationTaskCatalogSnapshotError | ValidatePhysicalDefinitionLifecycleReadinessError |
  LockScopeClockForShareError | Effect.Error<ReturnType<typeof preparePointCommitUniqueConstraintSet>> |
  Effect.Error<ReturnType<typeof acceptPreparedPointCommitUniqueConstraintSet>> |
  Effect.Error<ReturnType<typeof lendPreparedAppUniqueConstraintDefinitions>> |
  Effect.Error<ReturnType<typeof loadPublishedPhysicalRequirementSnapshotV1>>;

export function readinessFailure(
  reason: ApplicationReadinessError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationReadinessError> {
  return Effect.fail(readinessFailureValue(reason, retryable, cause));
}

export function readinessFailureValue(
  reason: ApplicationReadinessError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationReadinessError {
  return new ApplicationReadinessError({
    operation: "settle",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function readinessFailureForOperationValue(
  operation: ApplicationReadinessError["operation"],
  error: ApplicationReadinessError,
): ApplicationReadinessError {
  if (error.operation === operation) return error;
  return new ApplicationReadinessError({
    operation,
    reason: error.reason,
    retryable: error.retryable,
    ...("cause" in error ? { cause: error.cause } : {}),
  });
}

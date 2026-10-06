import { Data } from "effect";
import { PreparedHostRuntimeError } from "../preparedHostRuntime";
import type { RequestFailureReason } from "../boundedRequestLifetime";
import { CmsTransactionError } from "../cmsTransaction/model";
import { CommerceTransactionError } from "../commerceTransaction/model";
import { ApplicationCommandError } from "../applicationDocumentMaterialization/insertParticipant";
import { LogicalDocumentMaterializationError } from "../logicalDocuments/materialization";
import { RelationalSessionError } from "../relationalTransaction/model";
import { CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeCorruptionErrorV1 } from "../committedPointOutcome";
import { ScopePublicationCorruptionError, ScopePublicationReferenceCapacityError, ScopePublicationReferenceConstraintError,
  ScopePublicationResourceError, ScopePublicationSqlFailure, ScopePublicationUnsupportedProfileError } from "../commitPublication/scopePublicationModel";
import { LogicalApplicationSourceAdmissionError } from "../logicalDocuments/applicationAdmission";
import { LogicalDocumentSourceAdmissionError } from "../logicalDocuments/documentAdmission";
import { LogicalRelationalAdmissionError } from "../logicalDocuments/relationalAdmission";
import { IndexBuildReconciliationCatalogV1Error } from "../indexBuildReconciliation";
import { AppUniqueConstraintSetClosurePersistenceV1Error, AppUniqueConstraintSetClosureResourceError } from "../appUniqueConstraintSetClosureV1";
import { AppUniqueConstraintSetBuildIntegrationV1Error } from "../appUniqueConstraintSetBuildV1";
import { AppUniqueConstraintCatalogPersistenceError } from "../appUniqueConstraintDefinitions";
import { AppIndexDefinitionReadPersistenceError, AppSchemaVersionIndexBindingPersistenceError } from "../appIndexDefinitions";
import { IndexBuildStatePersistenceError } from "../indexBuildStates";
import { IndexMaintenanceError } from "../indexMaintenanceModel";
import { LogicalStorageDefinitionError } from "../logicalStorageDefinitions";
import { LogicalSchemaAdmissionEvidenceError } from "../logicalSchemaAdmissionEvidence";
import { SchemaVersionArtifactPersistenceError } from "../schemaVersionArtifacts";
import { StableTableIdentityPersistenceError } from "../stableTableCatalog";
import { DataBindingError } from "../frameworkSchema/binding/errors";
import { TrustedScopeAuthorityPortError } from "../scopeAuthorityResolution";

export class CompositeCommandError extends Data.TaggedError("CompositeCommandError")<{
  readonly reason: RequestFailureReason | "unsupportedProfile" | "storedCorruption" | "requestConflict" | "resultUnavailable" | "decisionUncertain" | "resourceFailure";
  readonly cause?: unknown;
}> {}
export const compositeError = (reason: CompositeCommandError["reason"], cause?: unknown) => new CompositeCommandError({ reason, ...(cause === undefined ? {} : { cause }) });
export type CompositeFailure = CompositeCommandError | CmsTransactionError | CommerceTransactionError | ApplicationCommandError | LogicalDocumentMaterializationError;
/** Foreign publication boundary retains corruption separately from resource failures. */
export const projectCompositePublicationFailure = (cause: unknown): CompositeCommandError =>
  compositeError(cause instanceof ScopePublicationReferenceConstraintError ? "invalidInput" :
    cause instanceof ScopePublicationCorruptionError ? "storedCorruption" : "resourceFailure", cause);
/** One root projection for authority and physical/retained-outcome boundaries. */
export function projectCompositeFailure(cause: unknown): CompositeFailure {
  if (cause instanceof CompositeCommandError || cause instanceof CmsTransactionError || cause instanceof CommerceTransactionError || cause instanceof ApplicationCommandError || cause instanceof LogicalDocumentMaterializationError) return cause;
  if ((cause instanceof IndexBuildReconciliationCatalogV1Error || cause instanceof LogicalStorageDefinitionError ||
    cause instanceof LogicalSchemaAdmissionEvidenceError || cause instanceof IndexMaintenanceError ||
    cause instanceof DataBindingError || cause instanceof LogicalDocumentSourceAdmissionError) &&
    cause.reason === "resourceFailure") return compositeError("resourceFailure", cause);
  if (cause instanceof TrustedScopeAuthorityPortError || cause instanceof AppUniqueConstraintSetClosureResourceError || cause instanceof AppUniqueConstraintSetClosurePersistenceV1Error ||
    cause instanceof AppUniqueConstraintSetBuildIntegrationV1Error || cause instanceof AppUniqueConstraintCatalogPersistenceError ||
    cause instanceof AppIndexDefinitionReadPersistenceError || cause instanceof AppSchemaVersionIndexBindingPersistenceError ||
    cause instanceof IndexBuildStatePersistenceError || cause instanceof StableTableIdentityPersistenceError ||
    cause instanceof SchemaVersionArtifactPersistenceError) return compositeError("resourceFailure", cause);
  if ((cause instanceof LogicalApplicationSourceAdmissionError || cause instanceof LogicalDocumentSourceAdmissionError ||
    cause instanceof LogicalRelationalAdmissionError) && cause.reason === "unsupportedProfile")
    return compositeError("unsupportedProfile", cause);
  if (cause instanceof LogicalApplicationSourceAdmissionError || cause instanceof LogicalDocumentSourceAdmissionError ||
    cause instanceof LogicalRelationalAdmissionError) return compositeError("invalidAuthority", cause);
  if (cause instanceof PreparedHostRuntimeError) return compositeError(cause.reason === "closed" ? "closed" : "resourceFailure", cause);
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) return compositeError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) return compositeError("storedCorruption", cause);
  if (cause instanceof ScopePublicationUnsupportedProfileError) return compositeError("unsupportedProfile", cause);
  if (cause instanceof ScopePublicationReferenceConstraintError) return compositeError("invalidInput", cause);
  if (cause instanceof ScopePublicationReferenceCapacityError) return compositeError("resourceFailure", cause);
  if (cause instanceof ScopePublicationCorruptionError || cause instanceof ScopePublicationResourceError || cause instanceof ScopePublicationSqlFailure) return projectCompositePublicationFailure(cause);
  if (cause instanceof RelationalSessionError) return compositeError(cause.reason === "decisionUncertain" ? "decisionUncertain" : "resourceFailure", cause);
  return compositeError("invalidAuthority", cause);
}

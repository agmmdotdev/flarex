import { Data } from "effect";
import { PreparedHostRuntimeError } from "../../execution/preparation/preparedHostRuntime";
import type { RequestFailureReason } from "../../execution/preparation/boundedRequestLifetime";
import { CmsTransactionError } from "../cmsTransaction/model";
import { CommerceTransactionError } from "../commerceTransaction/model";
import { ApplicationCommandError } from "../../storage/materialization/insertParticipant";
import { LogicalDocumentMaterializationError } from "../../storage/documents/logicalDocuments/materialization";
import { RelationalSessionError } from "../../database/relationalTransaction/model";
import { CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeCorruptionErrorV1 } from "../../commit/committedPointOutcome";
import { ScopePublicationCorruptionError, ScopePublicationReferenceCapacityError, ScopePublicationReferenceConstraintError,
  ScopePublicationResourceError, ScopePublicationSqlFailure, ScopePublicationUnsupportedProfileError } from "../../commit/publication/scopePublicationModel";
import { LogicalApplicationSourceAdmissionError } from "../../storage/documents/logicalDocuments/applicationAdmission";
import { LogicalDocumentSourceAdmissionError } from "../../storage/documents/logicalDocuments/documentAdmission";
import { LogicalRelationalAdmissionError } from "../../storage/documents/logicalDocuments/relationalAdmission";
import { IndexBuildReconciliationCatalogV1Error } from "../../storage/indexes/indexBuildReconciliation";
import { AppUniqueConstraintSetClosurePersistenceV1Error, AppUniqueConstraintSetClosureResourceError } from "../../storage/unique/appUniqueConstraintSetClosureV1";
import { AppUniqueConstraintSetBuildIntegrationV1Error } from "../../storage/unique/appUniqueConstraintSetBuildV1";
import { AppUniqueConstraintCatalogPersistenceError } from "../../storage/unique/appUniqueConstraintDefinitions";
import { AppIndexDefinitionReadPersistenceError, AppSchemaVersionIndexBindingPersistenceError } from "../../storage/indexes/appIndexDefinitions";
import { IndexBuildStatePersistenceError } from "../../storage/indexes/indexBuildStates";
import { IndexMaintenanceError } from "../../storage/indexes/indexMaintenanceModel";
import { LogicalStorageDefinitionError } from "../../storage/catalog/logicalStorageDefinitions";
import { LogicalSchemaAdmissionEvidenceError } from "../../storage/catalog/logicalSchemaAdmissionEvidence";
import { SchemaVersionArtifactPersistenceError } from "../../storage/catalog/schemaVersionArtifacts";
import { StableTableIdentityPersistenceError } from "../../storage/catalog/stableTableCatalog";
import { DataBindingError } from "../../installation/frameworkSchema/binding/errors";
import { TrustedScopeAuthorityPortError } from "../../scope/scopeAuthorityResolution";

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

import { LogicalReadAdmissionError } from "../logicalDocuments/readAdmission";
import { LogicalDocumentSourceAdmissionError } from "../logicalDocuments/documentAdmission";
import { TrustedScopeAuthorityPortError } from "../scopeAuthorityResolution";
import { CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeCorruptionErrorV1 } from "../committedPointOutcome";
import { RelationalSessionError } from "../relationalTransaction/model";
import { PreparedHostRuntimeError } from "../preparedHostRuntime";
import { cmsError, CmsTransactionError } from "./model";
import { IndexBuildReconciliationCatalogV1Error } from "../indexBuildReconciliation";
import { AppUniqueConstraintSetClosurePersistenceV1Error, AppUniqueConstraintSetClosureResourceError } from "../appUniqueConstraintSetClosureV1";
import { AppUniqueConstraintSetBuildIntegrationV1Error } from "../appUniqueConstraintSetBuildV1";
import { AppUniqueConstraintCatalogPersistenceError } from "../appUniqueConstraintDefinitions";
import { AppIndexDefinitionReadPersistenceError, AppSchemaVersionIndexBindingPersistenceError } from "../appIndexDefinitions";
import { IndexBuildStatePersistenceError } from "../indexBuildStates";
import { IndexMaintenanceError } from "../indexMaintenanceEvidence";
import { LogicalStorageDefinitionError } from "../logicalStorageDefinitions";
import { LogicalSchemaAdmissionEvidenceError } from "../logicalSchemaAdmissionEvidence";
import { SchemaVersionArtifactPersistenceError } from "../schemaVersionArtifacts";
import { StableTableIdentityPersistenceError } from "../stableTableCatalog";
import { DataBindingError } from "../frameworkSchema/binding/errors";

export const projectCmsRequestFailure = (cause: unknown): CmsTransactionError => {
  if (cause instanceof CmsTransactionError) return cause;
  if (cause instanceof LogicalReadAdmissionError) return cmsError(
    cause.reason === "sourceMismatch" || cause.reason === "bindingMissing" || cause.reason === "notReady"
      ? "bindingChanged" : cause.reason, cause);
  if ((cause instanceof IndexBuildReconciliationCatalogV1Error || cause instanceof LogicalStorageDefinitionError ||
    cause instanceof LogicalSchemaAdmissionEvidenceError || cause instanceof IndexMaintenanceError ||
    cause instanceof DataBindingError) && cause.reason === "resourceFailure") return cmsError("resourceFailure", cause);
  if (cause instanceof AppUniqueConstraintSetClosureResourceError || cause instanceof AppUniqueConstraintSetClosurePersistenceV1Error ||
    cause instanceof AppUniqueConstraintSetBuildIntegrationV1Error || cause instanceof AppUniqueConstraintCatalogPersistenceError ||
    cause instanceof AppIndexDefinitionReadPersistenceError || cause instanceof AppSchemaVersionIndexBindingPersistenceError ||
    cause instanceof IndexBuildStatePersistenceError || cause instanceof StableTableIdentityPersistenceError ||
    cause instanceof SchemaVersionArtifactPersistenceError) return cmsError("resourceFailure", cause);
  if (cause instanceof LogicalDocumentSourceAdmissionError) return cmsError(
    cause.reason === "sourceMismatch" || cause.reason === "bindingMissing" || cause.reason === "notReady"
      ? "bindingChanged" : cause.reason, cause);
  if (cause instanceof PreparedHostRuntimeError) return cmsError(cause.reason === "closed" ? "closed" : "resourceFailure", cause);
  if (cause instanceof TrustedScopeAuthorityPortError) return cmsError("resourceFailure", cause);
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) return cmsError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) return cmsError("storedCorruption", cause);
  if (cause instanceof RelationalSessionError) return cmsError(cause.reason === "decisionUncertain" ? "decisionUncertain" : "resourceFailure", cause);
  return cmsError("invalidAuthority", cause);
};

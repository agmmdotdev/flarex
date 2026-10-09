import { LogicalReadAdmissionError } from "../../storage/documents/logicalDocuments/readAdmission";
import { LogicalDocumentSourceAdmissionError } from "../../storage/documents/logicalDocuments/documentAdmission";
import { TrustedScopeAuthorityPortError } from "../../scope/scopeAuthorityResolution";
import {
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeCorruptionErrorV1,
} from "../../commit/committedPointOutcomeErrors";
import { RelationalSessionError } from "../../database/relationalTransaction/model";
import { PreparedHostRuntimeError } from "../../execution/preparation/preparedHostRuntime";
import { cmsError, CmsTransactionError } from "./model";
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

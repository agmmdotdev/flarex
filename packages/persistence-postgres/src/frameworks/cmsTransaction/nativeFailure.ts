import { CoreNativeBudgetError, CoreNativeUniqueConflict, CoreNativeReferenceError, CoreNativeQueryError, CoreQueryInputError, CoreTransactionError, type CoreError } from "../../core/api";
import { CorePersistenceError } from "../../core/contracts";
import { CoreSchemaError } from "../../core/schemaTypes";
import { cmsError, CmsTransactionError } from "./model";

/** One profile projection; core provenance stays attached to the native error. */
export function projectCoreCmsFailure(failure: CoreError): CmsTransactionError {
  if (failure instanceof CoreNativeBudgetError) return failure.cause instanceof CmsTransactionError ? failure.cause
    : cmsError(failure.reason === "unexpectedFailure" ? "resourceFailure" : failure.reason, failure);
  if (failure instanceof CoreNativeQueryError) return cmsError("invalidInput", failure);
  if (failure instanceof CoreNativeReferenceError) return cmsError(failure.reason, failure);
  if (failure instanceof CoreNativeUniqueConflict) return new CmsTransactionError({ reason: "uniqueConflict", cause: failure,
    uniqueConstraint: { tableName: failure.tableName, orderedFields: failure.fields } });
  if (failure instanceof CorePersistenceError) return cmsError(failure.reason === "uncertainWrite" ? "decisionUncertain" :
    failure.reason === "corruptData" ? "storedCorruption" : "resourceFailure", failure);
  if (failure instanceof CoreSchemaError) return cmsError(failure.reason === "unsupportedCapability" ? "unsupportedProfile" : "bindingChanged", failure);
  if (failure instanceof CoreQueryInputError) return cmsError("unsupportedProfile", failure);
  if (failure instanceof CoreTransactionError) {
    switch (failure.reason) {
      case "closed": return cmsError("closed", failure);
      case "conflict": return cmsError("writeConflict", failure);
      case "requestMismatch": return cmsError("requestConflict", failure);
      case "missingDocument": return cmsError("documentMissing", failure);
      case "invalidValue": case "documentValidation": case "documentExists": case "documentDeleted": return cmsError("documentInvalid", failure);
      case "invalidDocumentId": return cmsError("invalidInput", failure);
      case "admissionExpired": return cmsError("deadlineExceeded", failure);
      case "capacity": case "tooManyTables": return cmsError("limitExceeded", failure);
      case "missingTable": case "missingIndex": case "indexUnavailable": case "programUnavailable":
      case "authorityRevoked": return cmsError("bindingChanged", failure);
      case "unavailable": return cmsError("resourceFailure", failure);
      case "inflight": return cmsError("overlappingOperation", failure);
      case "foreignFinalization": case "foreignClaim": case "readonly": return cmsError("invalidAuthority", failure);
    }
  }
  return cmsError("invalidAuthority", failure);
}

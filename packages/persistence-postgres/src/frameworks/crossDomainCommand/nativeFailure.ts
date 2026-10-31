import { CoreNativeBudgetError, CoreNativeUniqueConflict, CoreNativeQueryError, CoreQueryInputError,
  CoreTransactionError, type CoreError } from "../../core/api";
import { CorePersistenceError } from "../../core/contracts";
import { CoreSchemaError } from "../../core/schemaTypes";
import { ApplicationCommandError, applicationCommandError } from "../../application/commandError";
import { CmsTransactionError } from "../cmsTransaction/model";
import { CommerceTransactionError } from "../commerceTransaction/model";
import { CompositeCommandError, compositeError, type CompositeFailure } from "./model";

/** Only the translated root's persistence boundary is projected here. */
export function projectCoreCompositeFailure(failure: CoreError): CompositeFailure {
  if (failure instanceof CoreNativeBudgetError) {
    const original = failure.cause;
    if (original instanceof CompositeCommandError || original instanceof CmsTransactionError
      || original instanceof CommerceTransactionError || original instanceof ApplicationCommandError) return original;
    return compositeError(failure.reason === "unexpectedFailure" ? "resourceFailure" : failure.reason, failure);
  }
  if (failure instanceof CoreNativeQueryError || failure instanceof CoreNativeUniqueConflict) return compositeError("invalidInput", failure);
  if (failure instanceof CorePersistenceError) return compositeError(failure.reason === "uncertainWrite" ? "decisionUncertain"
    : failure.reason === "corruptData" ? "storedCorruption" : "resourceFailure", failure);
  if (failure instanceof CoreSchemaError) return compositeError(failure.reason === "unsupportedCapability" ? "unsupportedProfile" : "bindingChanged", failure);
  if (failure instanceof CoreQueryInputError) return compositeError("unsupportedProfile", failure);
  if (failure instanceof CoreTransactionError) {
    switch (failure.reason) {
      case "closed": return compositeError("closed", failure);
      case "conflict": return compositeError("writeConflict", failure);
      case "requestMismatch": return compositeError("requestConflict", failure);
      case "missingDocument": case "invalidValue": case "documentValidation": case "invalidDocumentId": return compositeError("invalidInput", failure);
      case "admissionExpired": return compositeError("deadlineExceeded", failure);
      case "capacity": case "tooManyTables": return compositeError("limitExceeded", failure);
      case "missingTable": case "missingIndex": case "indexUnavailable": case "programUnavailable": case "authorityRevoked":
        return compositeError("bindingChanged", failure);
      case "unavailable": return compositeError("resourceFailure", failure);
      case "inflight": return compositeError("overlappingOperation", failure);
      case "foreignFinalization": case "foreignClaim": case "readonly": return compositeError("invalidAuthority", failure);
    }
  }
  return compositeError("invalidAuthority", failure);
}

/** The App child retains its existing insert error contract; final conflicts belong to the root. */
export function projectCoreApplicationInsertFailure(failure: CoreError): ApplicationCommandError {
  if (failure instanceof CoreNativeBudgetError) return failure.cause instanceof ApplicationCommandError ? failure.cause
    : applicationCommandError(failure.reason === "unexpectedFailure" ? "invalidAuthority" : failure.reason, failure);
  if (failure instanceof CoreTransactionError) {
    switch (failure.reason) {
      case "invalidValue": case "documentValidation": return applicationCommandError("documentInvalid", failure);
      case "capacity": case "tooManyTables": return applicationCommandError("limitExceeded", failure);
      case "closed": return applicationCommandError("closed", failure);
      case "inflight": return applicationCommandError("overlappingOperation", failure);
      case "admissionExpired": return applicationCommandError("deadlineExceeded", failure);
      default: return applicationCommandError("invalidAuthority", failure);
    }
  }
  return applicationCommandError("invalidAuthority", failure);
}

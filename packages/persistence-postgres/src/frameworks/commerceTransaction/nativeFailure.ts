import { CoreNativeBudgetError, CoreNativeReferenceError, CoreNativeUniqueConflict, CoreNativeForeignKeyError, CoreNativeReferencePlanError, CoreNativeQueryError, CoreQueryInputError,
  CoreTransactionError, type CoreError } from "../../core/api";
import { CorePersistenceError } from "../../core/contracts";
import { CoreSchemaError } from "../../core/schemaTypes";
import { commerceError, CommerceTransactionError } from "./model";
import { coreNativeRelationalFailure } from "../../core/nativePolicy";
import { inspectRelationalFailure, retainRelationalFailure } from "../../values/relationalFailure";
import { inspectReferenceFailure, retainReferenceFailure } from "../../values/referenceFailure";

/** The native error domain changes here; the complete Core failure stays attached. */
export function projectCoreCommerceFailure(failure: CoreError): CommerceTransactionError {
  const projected = classifyCoreCommerceFailure(failure);
  const row = coreNativeRelationalFailure(failure);
  if (row !== undefined) retainRelationalFailure(projected, { ...row.diagnostic, table: row.table.identity });
  const relational = inspectRelationalFailure(failure);
  if (relational !== undefined) retainRelationalFailure(projected, relational);
  const reference = inspectReferenceFailure(failure);
  if (reference !== undefined) retainReferenceFailure(projected, reference);
  return projected;
}

function classifyCoreCommerceFailure(failure: CoreError): CommerceTransactionError {
  if (failure instanceof CoreNativeReferencePlanError) return commerceError("invalidAuthority", failure);
  if (failure instanceof CoreNativeBudgetError) return failure.cause instanceof CommerceTransactionError ? failure.cause
    : commerceError(failure.reason === "unexpectedFailure" ? "resourceFailure" : failure.reason, failure);
  if (failure instanceof CoreNativeQueryError || failure instanceof CoreNativeUniqueConflict || failure instanceof CoreNativeReferenceError
    || failure instanceof CoreNativeForeignKeyError)
    return commerceError("invalidInput", failure);
  if (failure instanceof CorePersistenceError) return commerceError(failure.reason === "uncertainWrite" ? "decisionUncertain"
    : failure.reason === "corruptData" ? "storedCorruption" : "resourceFailure", failure);
  if (failure instanceof CoreSchemaError) return commerceError(failure.reason === "unsupportedCapability" ? "unsupportedProfile" : "bindingChanged", failure);
  if (failure instanceof CoreQueryInputError) return commerceError("unsupportedProfile", failure);
  if (failure instanceof CoreTransactionError) {
    switch (failure.reason) {
      case "closed": return commerceError("closed", failure);
      case "conflict": return commerceError("writeConflict", failure);
      case "requestMismatch": return commerceError("requestConflict", failure);
      case "missingDocument": case "invalidValue": case "documentValidation": case "invalidDocumentId": case "documentExists": case "documentDeleted":
        return commerceError("invalidInput", failure);
      case "admissionExpired": return commerceError("deadlineExceeded", failure);
      case "capacity": case "tooManyTables": return commerceError("limitExceeded", failure);
      case "missingTable": case "missingIndex": case "indexUnavailable": case "programUnavailable": case "authorityRevoked":
        return commerceError("bindingChanged", failure);
      case "unavailable": return commerceError("resourceFailure", failure);
      case "inflight": return commerceError("overlappingOperation", failure);
      case "foreignFinalization": case "foreignClaim": case "readonly": return commerceError("invalidAuthority", failure);
    }
  }
  return commerceError("invalidAuthority", failure);
}

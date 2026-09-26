import { Data } from "effect";
import type { LogicalDocumentFailureReason } from "../logicalDocuments/model";

export { commerceLimits } from "../frameworkExecutionPolicy";

export class CommerceTransactionError extends Data.TaggedError("CommerceTransactionError")<{
  readonly reason: "invalidInput" | "invalidAuthority" | "unsupportedProfile" |
    "storedCorruption" | "seedRequired" | "seedMismatch" | "bindingChanged" |
    "closed" | "rollbackOnly" | "overlappingOperation" | "limitExceeded" |
    "deadlineExceeded" | "borrowedSettlement" | "statementFailure" |
    "requestConflict" | "resultUnavailable" | "decisionUncertain" | "resourceFailure" |
    "receiptMismatch" | "unadmittedEvent" | "adapterFailure" | "writeConflict";
  readonly cause?: unknown;
}> {}

export function commerceError(reason: CommerceTransactionError["reason"], cause?: unknown): CommerceTransactionError {
  return new CommerceTransactionError({ reason, ...(cause === undefined ? {} : { cause }) });
}

export function logicalCommerceError(reason: LogicalDocumentFailureReason, cause?: unknown): CommerceTransactionError {
  return commerceError(reason === "documentMissing" || reason === "documentInvalid" || reason === "uniqueConflict" ? "invalidInput" : reason, cause);
}

import { Data } from "effect";
import { relationalReadLimits } from "../logicalDocuments/relationalQuery";
import type { LogicalDocumentFailureReason } from "../logicalDocuments/model";

/** Private bounded commerce execution limits, independent of the synthetic scalar store. */
export const commerceLimits = Object.freeze({
  commandDefinitions: 128,
  catalogRows: 256, ...relationalReadLimits,
  calls: 64, rowBytes: 65_536, commandBytes: 1_048_576,
  commandMs: 10_000, statementMs: 1_000, lockMs: 500, cleanupMs: 2_000,
});

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

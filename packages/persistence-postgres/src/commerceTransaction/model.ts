import { Data } from "effect";

/** Private bounded commerce execution limits, independent of the synthetic scalar store. */
export const commerceLimits = Object.freeze({
  catalogRows: 256, filterNodes: 64, filterDepth: 8, filterOperands: 256,
  calls: 64, rowBytes: 65_536, commandBytes: 1_048_576,
  commandMs: 10_000, statementMs: 1_000, lockMs: 500, cleanupMs: 2_000,
});

export class CommerceTransactionError extends Data.TaggedError("CommerceTransactionError")<{
  readonly reason: "invalidInput" | "invalidAuthority" | "unsupportedProfile" |
    "storedCorruption" | "seedRequired" | "seedMismatch" | "bindingChanged" |
    "closed" | "rollbackOnly" | "overlappingOperation" | "limitExceeded" |
    "deadlineExceeded" | "borrowedSettlement" | "statementFailure" |
    "requestConflict" | "resultUnavailable" | "decisionUncertain" | "resourceFailure" |
    "receiptMismatch" | "unadmittedEvent" | "adapterFailure";
  readonly cause?: unknown;
}> {}

export function commerceError(reason: CommerceTransactionError["reason"], cause?: unknown): CommerceTransactionError {
  return new CommerceTransactionError({ reason, ...(cause === undefined ? {} : { cause }) });
}

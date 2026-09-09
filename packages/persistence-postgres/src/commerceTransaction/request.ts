import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeCorruptionErrorV1 } from "../committedPointOutcome";
import { RelationalSessionError } from "../relationalTransaction/model";
import { commerceError, CommerceTransactionError } from "./model";

export const commerceRequestHash = makeLivePrivateSha256V1({
  invalidBudget: () => commerceError("limitExceeded"), invalidBytes: () => commerceError("invalidInput"),
  inputBytesExceeded: () => commerceError("limitExceeded"), unavailable: () => commerceError("resourceFailure"),
  nativeRejected: cause => commerceError("resourceFailure", cause), invalidDigestOutput: () => new Error("Invalid commerce digest"),
});

/** Expected errors only. Effect.mapError preserves interruption and defects. */
export const projectCommerceRequestFailure = (cause: unknown): CommerceTransactionError => {
  if (cause instanceof CommerceTransactionError) return cause;
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) return commerceError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) return commerceError("storedCorruption", cause);
  if (cause instanceof RelationalSessionError) return commerceError(cause.reason === "decisionUncertain" ? "decisionUncertain" : "resourceFailure", cause);
  return commerceError("invalidAuthority", cause);
};

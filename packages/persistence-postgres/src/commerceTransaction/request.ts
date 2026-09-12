import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeCorruptionErrorV1 } from "../committedPointOutcome";
import { RelationalSessionError } from "../relationalTransaction/model";
import { commerceError, CommerceTransactionError } from "./model";
import { Effect, Result } from "effect";
import { canonicalizeJsonOutcome, captureJsonOutcomeValue, JsonOutcomeError } from "../jsonOutcome";

export const captureCommerceJsonData = (input: unknown, maximum: number) =>
  captureJsonOutcomeValue(input, maximum).pipe(Result.mapError(projectCommerceRequestFailure));

const encoder = new TextEncoder();
/** Semantic domains cannot collide with the old arbitrary Application value preimage. */
export const commerceIdentityEvidence = Effect.fn("CommerceRequest.identityEvidence")(function* (
  domain: "policy" | "atomic-policy" | "command" | "atomic-command", input: unknown, maximum: number,
) {
  const prefix = encoder.encode(`flarex.commerce.json.${domain}\0`);
  const canonical = yield* Effect.fromResult(canonicalizeJsonOutcome({ resultEncoding: "json", value: input }, maximum - prefix.byteLength))
    .pipe(Effect.mapError(projectCommerceRequestFailure));
  const canonicalBytes = new Uint8Array(prefix.byteLength + canonical.semanticSizeBytes);
  canonicalBytes.set(prefix);
  canonicalBytes.set(canonical.canonicalBytes, prefix.byteLength);
  return { canonicalBytes };
});

export const commerceRequestHash = makeLivePrivateSha256V1({
  invalidBudget: () => commerceError("limitExceeded"), invalidBytes: () => commerceError("invalidInput"),
  inputBytesExceeded: () => commerceError("limitExceeded"), unavailable: () => commerceError("resourceFailure"),
  nativeRejected: cause => commerceError("resourceFailure", cause), invalidDigestOutput: () => new Error("Invalid commerce digest"),
});

/** Expected errors only. Effect.mapError preserves interruption and defects. */
export const projectCommerceRequestFailure = (cause: unknown): CommerceTransactionError => {
  if (cause instanceof CommerceTransactionError) return cause;
  if (cause instanceof JsonOutcomeError) return commerceError(cause.reason === "invalidEvidence" ? "storedCorruption" : cause.reason, cause);
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) return commerceError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) return commerceError("storedCorruption", cause);
  if (cause instanceof RelationalSessionError) return commerceError(cause.reason === "decisionUncertain" ? "decisionUncertain" : "resourceFailure", cause);
  return commerceError("invalidAuthority", cause);
};

import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import {
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  CommittedPointOutcomeCorruptionErrorV1,
} from "../../commit/committedPointOutcomeErrors";
import { RelationalSessionError } from "../../database/relationalTransaction/model";
import { commerceError, CommerceTransactionError } from "./model";
import { Effect, Result } from "effect";
import { PreparedHostRuntimeError } from "../../execution/preparation/preparedHostRuntime";
import {
  LogicalDocumentMaterializationError,
} from "../../storage/documents/logicalDocuments/materialization";
import {
  LogicalRelationalAdmissionError,
} from "../../storage/documents/logicalDocuments/relationalAdmission";
import { LogicalReadAdmissionError } from "../../storage/documents/logicalDocuments/readAdmission";
import {
  LogicalParticipantAdmissionError,
} from "../../storage/documents/logicalDocuments/participantErrors";
import { DataBindingError } from "../../installation/frameworkSchema/binding/errors";
import { TrustedScopeAuthorityPortError } from "../../scope/scopeAuthorityResolution";
import {
  canonicalizeJsonOutcome,
  captureJsonOutcomeValue,
  JsonOutcomeError,
} from "../../values/jsonOutcome";
import { sql } from "drizzle-orm";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";

/** Exclude one durable Commerce request across standalone and atomic hosts.
 * The outcome row remains the authority; this lock only orders callbacks. */
export const lockCommerceRequest = Effect.fn("CommerceRequest.lock")(function* (
  tx: FlarexMetadataTransaction, scopeId: string, key: string,
) {
  yield* runDrizzleStatementEffect(tx.execute(sql`select pg_advisory_xact_lock(
    hashtextextended(${JSON.stringify(["flarex.commerce.request", scopeId, key])}, 0))`),
    cause => commerceError("statementFailure", cause));
});

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
  if (cause instanceof LogicalReadAdmissionError) return commerceError(
    cause.reason === "sourceMismatch" || cause.reason === "bindingMissing" || cause.reason === "notReady"
      ? "bindingChanged" : cause.reason, cause);
  if (cause instanceof DataBindingError && cause.reason === "logicalSchemaMismatch")
    return commerceError("bindingChanged", cause);
  if (cause instanceof LogicalRelationalAdmissionError && cause.reason === "unsupportedProfile")
    return commerceError("unsupportedProfile", cause);
  if (cause instanceof LogicalParticipantAdmissionError) return commerceError(
    cause.reason === "unsupportedProfile" ? "unsupportedProfile" :
      cause.reason === "resourceFailure" ? "resourceFailure" :
        cause.reason === "storedCorruption" ? "storedCorruption" : "invalidAuthority", cause);
  if (cause instanceof LogicalDocumentMaterializationError) return commerceError(
    cause.reason === "uniqueConflict" || cause.reason === "relationInvalid" || cause.reason === "relationTargetMissing" || cause.reason === "relationDeleteRestricted"
      ? "invalidInput" : cause.reason, cause);
  if (cause instanceof PreparedHostRuntimeError) return commerceError(cause.reason === "closed" ? "closed" : "resourceFailure", cause);
  if (cause instanceof TrustedScopeAuthorityPortError) return commerceError("resourceFailure", cause);
  if (cause instanceof JsonOutcomeError) return commerceError(cause.reason === "invalidEvidence" ? "storedCorruption" : cause.reason, cause);
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) return commerceError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) return commerceError("storedCorruption", cause);
  if (cause instanceof RelationalSessionError) return commerceError(cause.reason === "decisionUncertain" ? "decisionUncertain" : "resourceFailure", cause);
  return commerceError("invalidAuthority", cause);
};

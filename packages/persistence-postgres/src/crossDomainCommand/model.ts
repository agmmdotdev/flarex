import { Data } from "effect";
import type { RequestFailureReason } from "../boundedRequestLifetime";
import { CmsTransactionError } from "../cmsTransaction/model";
import { CommerceTransactionError } from "../commerceTransaction/model";
import { ApplicationCommandError } from "../applicationDocumentMaterialization/insertParticipant";
import { ApplicationParticipantError } from "../applicationDocumentMaterialization/participant";
import { RelationalSessionError } from "../relationalTransaction/model";
import { CommittedPointOutcomeRequestKeyReuseErrorV1, CommittedPointOutcomeCorruptionErrorV1 } from "../committedPointOutcome";
import { ScopePublicationCorruptionError, ScopePublicationResourceError, ScopePublicationSqlFailure } from "../commitPublication/scopePublicationModel";

export class CompositeCommandError extends Data.TaggedError("CompositeCommandError")<{
  readonly reason: RequestFailureReason | "unsupportedProfile" | "storedCorruption" | "requestConflict" | "resultUnavailable" | "decisionUncertain" | "resourceFailure";
  readonly cause?: unknown;
}> {}
export const compositeError = (reason: CompositeCommandError["reason"], cause?: unknown) => new CompositeCommandError({ reason, ...(cause === undefined ? {} : { cause }) });
export type CompositeFailure = CompositeCommandError | CmsTransactionError | CommerceTransactionError | ApplicationCommandError | ApplicationParticipantError;
/** Foreign publication boundary retains corruption separately from resource failures. */
export const projectCompositePublicationFailure = (cause: unknown): CompositeCommandError =>
  compositeError(cause instanceof ScopePublicationCorruptionError ? "storedCorruption" : "resourceFailure", cause);
/** One root projection for authority and physical/retained-outcome boundaries. */
export function projectCompositeFailure(cause: unknown): CompositeFailure {
  if (cause instanceof CompositeCommandError || cause instanceof CmsTransactionError || cause instanceof CommerceTransactionError || cause instanceof ApplicationCommandError || cause instanceof ApplicationParticipantError) return cause;
  if (cause instanceof CommittedPointOutcomeRequestKeyReuseErrorV1) return compositeError("requestConflict", cause);
  if (cause instanceof CommittedPointOutcomeCorruptionErrorV1) return compositeError("storedCorruption", cause);
  if (cause instanceof ScopePublicationCorruptionError || cause instanceof ScopePublicationResourceError || cause instanceof ScopePublicationSqlFailure) return projectCompositePublicationFailure(cause);
  if (cause instanceof RelationalSessionError) return compositeError(cause.reason === "decisionUncertain" ? "decisionUncertain" : "resourceFailure", cause);
  return compositeError("invalidAuthority", cause);
}

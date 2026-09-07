import { Data } from "effect";

export const cmsLimits = Object.freeze({
  calls: 64,
  pageRows: 32,
  identities: 256,
  documentBytes: 65_536,
  commandBytes: 1_048_576,
  commandMs: 10_000,
  statementMs: 1_000,
  lockMs: 500,
  cleanupMs: 2_000,
});

export class CmsTransactionError extends Data.TaggedError("CmsTransactionError")<{
  readonly reason:
    | "invalidInput"
    | "invalidAuthority"
    | "unsupportedProfile"
    | "closed"
    | "rollbackOnly"
    | "overlappingOperation"
    | "limitExceeded"
    | "deadlineExceeded"
    | "borrowedSettlement"
    | "documentMissing"
    | "documentInvalid"
    | "uniqueConflict"
    | "relationInvalid"
    | "relationTargetMissing"
    | "relationDeleteRestricted"
    | "bindingChanged"
    | "storedCorruption"
    | "statementFailure"
    | "requestConflict"
    | "resultUnavailable"
    | "decisionUncertain"
    | "resourceFailure";
  readonly cause?: unknown;
}> {}

export function cmsError(reason: CmsTransactionError["reason"], cause?: unknown): CmsTransactionError {
  return new CmsTransactionError({ reason, ...(cause === undefined ? {} : { cause }) });
}

/** A host-local request capability. A transaction ID alone is never authority. */
export type { BoundedRequestContext as CmsRequestContext, PresentedTransactionId as CmsPresentedTransactionId } from "../boundedRequestLifetime";
export interface CmsHostIdentity { readonly hostId: symbol }
export interface CmsRequestIdentity { readonly requestId: symbol }

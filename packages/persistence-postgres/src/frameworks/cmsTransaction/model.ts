import { Data } from "effect";

export { cmsLimits } from "../../execution/preparation/frameworkExecutionPolicy";

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
    | "writeConflict"
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
  /** Present only when the document owner identified an actual declared constraint. */
  readonly uniqueConstraint?: Readonly<{ tableName: string; orderedFields: readonly string[] }>;
}> {}

export function cmsError(reason: CmsTransactionError["reason"], cause?: unknown): CmsTransactionError {
  return new CmsTransactionError({ reason, ...(cause === undefined ? {} : { cause }) });
}

/** A host-local request capability. A transaction ID alone is never authority. */
export type { BoundedRequestContext as CmsRequestContext, PresentedTransactionId as CmsPresentedTransactionId } from "../../execution/preparation/boundedRequestLifetime";
export interface CmsHostIdentity { readonly hostId: symbol }
export interface CmsRequestIdentity { readonly requestId: symbol }

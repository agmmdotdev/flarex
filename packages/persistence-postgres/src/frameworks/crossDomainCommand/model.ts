import { Data } from "effect";
import type { RequestFailureReason } from "../../execution/preparation/boundedRequestLifetime";
import type { CmsTransactionError } from "../cmsTransaction/model";
import type { CommerceTransactionError } from "../commerceTransaction/model";
import type { ApplicationCommandError } from "../../application/commandError";
import type { LogicalDocumentMaterializationError } from "../../storage/documents/logicalDocuments/materialization";

export class CompositeCommandError extends Data.TaggedError("CompositeCommandError")<{
  readonly reason: RequestFailureReason | "unsupportedProfile" | "storedCorruption" | "requestConflict" | "resultUnavailable" | "decisionUncertain" | "resourceFailure" | "writeConflict" | "bindingChanged";
  readonly cause?: unknown;
}> {}
export const compositeError = (reason: CompositeCommandError["reason"], cause?: unknown) => new CompositeCommandError({ reason, ...(cause === undefined ? {} : { cause }) });
export type CompositeFailure = CompositeCommandError | CmsTransactionError | CommerceTransactionError | ApplicationCommandError | LogicalDocumentMaterializationError;

import { Data } from "effect";

import type {
  PublicationAttemptOrdinal,
} from "../../kernel/CanonicalValue.js";
import type {
  ClaimPublicationError,
  CompletePublicationError,
  PublicationAttemptOutcome,
  RecordPublicationAttemptOutcomeError,
} from "../../kernel/PublicationWork.js";
import type {
  QueryPublicationIdentity,
} from "../../kernel/Publication.js";
import type { QuerySyncCanonicalValueError } from "../../kernel/Errors.js";
import type {
  QuerySyncStateIntegrationError,
} from "../../state/Errors.js";
import type {
  NamespacePublicationBinding,
  NamespacePublicationSyncPolicy,
  PublicationTurnBudget,
} from "./Model.js";

export class ResultPublisherKnownNotAppendedError extends Data.TaggedError(
  "ResultPublisherKnownNotAppendedError",
)<{
  readonly operation: "publish";
}> {}

export class ResultPublisherOutcomeUnknownError extends Data.TaggedError(
  "ResultPublisherOutcomeUnknownError",
)<{
  readonly operation: "publish";
}> {}

export class ResultPublisherTerminalRefusalError extends Data.TaggedError(
  "ResultPublisherTerminalRefusalError",
)<{
  readonly operation: "publish";
}> {}

export type ResultPublisherError =
  | ResultPublisherKnownNotAppendedError
  | ResultPublisherOutcomeUnknownError
  | ResultPublisherTerminalRefusalError;

export class InvalidNamespacePublicationSyncPolicyError
  extends Data.TaggedError(
    "InvalidNamespacePublicationSyncPolicyError",
  )<{
    readonly operation: "makeNamespacePublicationSync";
    readonly field: keyof NamespacePublicationSyncPolicy;
    readonly reason: "invalidValue" | "aboveHardMaximum" | "invalidPair";
  }> {}

export class InvalidPublicationTurnBudgetError extends Data.TaggedError(
  "InvalidPublicationTurnBudgetError",
)<{
  readonly operation: "runPublicationWork";
  readonly field: keyof PublicationTurnBudget;
  readonly reason:
    | "invalidValue"
    | "aboveHardMaximum"
    | "notGreaterThanSettlementReserve";
  readonly observed: number;
}> {}

export class PublicationAuthorityMismatchError extends Data.TaggedError(
  "PublicationAuthorityMismatchError",
)<{
  readonly operation: "runPublicationWork";
  readonly reason: "boundAuthorityMismatch";
  readonly field: keyof NamespacePublicationBinding;
  readonly identity: QueryPublicationIdentity;
}> {}

export type PendingPublicationSettlement =
  | Readonly<{
    readonly _tag: "recordPublicationAttemptOutcome";
    readonly outcome: PublicationAttemptOutcome;
  }>
  | Readonly<{
    readonly _tag: "completePublication";
  }>;

export class PublicationSettlementDeadlineError extends Data.TaggedError(
  "PublicationSettlementDeadlineError",
)<{
  readonly operation: "runPublicationWork";
  readonly reason: "settlementWindowElapsed";
  readonly identity: QueryPublicationIdentity;
  readonly attemptOrdinal: PublicationAttemptOrdinal;
  readonly pending: PendingPublicationSettlement;
}> {}

export type NamespacePublicationSyncConstructionError =
  | QuerySyncCanonicalValueError
  | InvalidNamespacePublicationSyncPolicyError;

export type PublicationWorkTurnError =
  | InvalidPublicationTurnBudgetError
  | PublicationAuthorityMismatchError
  | PublicationSettlementDeadlineError
  | ClaimPublicationError
  | QuerySyncStateIntegrationError<"claimPublication">
  | RecordPublicationAttemptOutcomeError
  | QuerySyncStateIntegrationError<"recordPublicationAttemptOutcome">
  | CompletePublicationError
  | QuerySyncStateIntegrationError<"completePublication">;

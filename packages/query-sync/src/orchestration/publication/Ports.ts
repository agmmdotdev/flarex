import type { Effect } from "effect";

import type {
  PendingQueryPublication,
} from "../../kernel/Publication.js";
import type { QuerySyncTransitionState } from "../../state/Port.js";
import type { ResultPublisherError } from "./Errors.js";

export type QuerySyncPublicationState = Pick<
  QuerySyncTransitionState,
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication"
>;

export interface PublicationDeliveryBudget {
  readonly remainingPublisherCallsIncludingThisCall: number;
  readonly maximumSettlementMilliseconds: number;
}

export interface ResultPublisher {
  readonly publish: (
    publication: PendingQueryPublication,
    budget: PublicationDeliveryBudget,
  ) => Effect.Effect<void, ResultPublisherError, never>;
}

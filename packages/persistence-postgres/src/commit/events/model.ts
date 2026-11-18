import { Data, Schema } from "effect";
import { frameworkEventMessageLimit } from "../../execution/preparation/frameworkExecutionPolicy";

export const commitEventLimits = Object.freeze({ messages: frameworkEventMessageLimit, subscribers: 8, bytes: 65_536,
  totalBytes: 8_388_608,
  batch: 64, claimBatch: 8, leaseMs: 30_000, attempts: 5 });
export const EventRevision = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export const EventName = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/));
export const EventSubscriber = Schema.Struct({ id: EventName, revision: EventRevision });
export const EventEligibilityReference = Schema.Struct({
  groupId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)),
  ownerIdentity: EventRevision, policyRevision: EventRevision,
  maximumCommits: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 })),
});
export type CommitEventEligibilityReference = typeof EventEligibilityReference.Type;
export const EventEnvelope = Schema.Struct({
  contract: EventName, contractRevision: EventRevision, producerRevision: EventRevision,
  internal: Schema.Boolean,
  group: Schema.String.check(Schema.isLengthBetween(1, 256)),
  message: Schema.Json,
  eligibility: Schema.optionalKey(Schema.Array(EventEligibilityReference).check(Schema.isMinLength(1), Schema.isMaxLength(2))),
  subscribers: Schema.Array(EventSubscriber).check(Schema.isMinLength(1), Schema.isMaxLength(commitEventLimits.subscribers)),
});
export type CommittedEvent = typeof EventEnvelope.Type;
export type CommitEventSubscriber = typeof EventSubscriber.Type;
export class CommitEventError extends Data.TaggedError("CommitEventError")<{
  readonly reason: "invalidInput" | "invalidAuthority" | "storedCorruption" | "statementFailure" | "resourceFailure" | "staleClaim" | "groupConflict" | "groupClosed" | "limitExceeded";
  readonly cause?: unknown;
}> {}
export const eventError = (reason: CommitEventError["reason"], cause?: unknown) =>
  new CommitEventError({ reason, ...(cause === undefined ? {} : { cause }) });

/** Stable idempotency input for a subscriber's separately committed work. */
export interface CommitEventMessage {
  readonly eventId: string;
  readonly deliveryId: string;
  readonly subscriber: CommitEventSubscriber;
  readonly envelope: CommittedEvent;
}
export class CommitEventSubscriberFailure extends Data.TaggedError("CommitEventSubscriberFailure")<{
  readonly retryable: boolean;
  readonly code: string;
}> {}

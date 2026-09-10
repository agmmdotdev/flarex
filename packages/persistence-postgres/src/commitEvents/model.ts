import { Data, Schema } from "effect";

export const commitEventLimits = Object.freeze({ messages: 64, subscribers: 8, bytes: 65_536, batch: 64, leaseMs: 30_000, attempts: 5 });
export const EventRevision = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
export const EventName = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/));
export const EventSubscriber = Schema.Struct({ id: EventName, revision: EventRevision });
export const EventEnvelope = Schema.Struct({
  contract: EventName, contractRevision: EventRevision, producerRevision: EventRevision,
  internal: Schema.Boolean,
  group: Schema.String.check(Schema.isLengthBetween(1, 256)),
  message: Schema.Json,
  subscribers: Schema.Array(EventSubscriber).check(Schema.isMinLength(1), Schema.isMaxLength(commitEventLimits.subscribers)),
});
export type CommittedEvent = typeof EventEnvelope.Type;
export type CommitEventSubscriber = typeof EventSubscriber.Type;
export class CommitEventError extends Data.TaggedError("CommitEventError")<{
  readonly reason: "invalidInput" | "invalidAuthority" | "storedCorruption" | "statementFailure" | "resourceFailure" | "staleClaim";
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

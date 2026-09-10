import { Effect, Option, Schema } from "effect";
import { makeCommitEventStore, type CommitEventStoreInput } from "./store";
import { CommitEventSubscriberFailure, EventSubscriber, eventError, commitEventLimits, type CommitEventMessage, type CommitEventSubscriber } from "./model";

export interface CommitEventHandler extends CommitEventSubscriber {
  readonly handle: (message: CommitEventMessage) => Effect.Effect<void, CommitEventSubscriberFailure>;
}
const decodeSubscriber = Schema.decodeUnknownEffect(EventSubscriber, { onExcessProperty: "error" });

/** Explicit private repair scan. Start at zero after a completed scan to revisit
 * retries and missing historical handlers. No background poller or wake consumer. */
export const makeCommitEventPump = Effect.fn("CommitEvents.makePump")(function* (
  input: CommitEventStoreInput, inputHandlers: readonly CommitEventHandler[],
) {
  const selected = inputHandlers.map(({ id, revision, handle }) => ({ id, revision, handle }));
  if (selected.length < 1 || selected.length > commitEventLimits.subscribers) return yield* Effect.fail(eventError("invalidInput"));
  const identities = new Set<string>();
  for (const { id, revision } of selected) {
    yield* decodeSubscriber({ id, revision }).pipe(Effect.mapError(cause => eventError("invalidInput", cause)));
    const identity = `${id}/${revision}`;
    if (identities.has(identity)) return yield* Effect.fail(eventError("invalidInput"));
    identities.add(identity);
  }
  const store = yield* makeCommitEventStore(input);
  const runNext = Effect.fn("CommitEvents.runNext")(function* (afterCommit: bigint = 0n) {
    const next = yield* store.nextCommit(afterCommit);
    if (Option.isNone(next)) return { done: true, cursor: 0n, delivered: 0, failed: 0 };
    let delivered = 0;
    let failed = 0;
    for (let index = 0; index < commitEventLimits.batch; index++) {
      const claimed = yield* store.claim(next.value, selected);
      if (Option.isNone(claimed)) return { done: false, cursor: next.value, delivered, failed };
      const claim = claimed.value;
      const handler = selected.find(candidate => candidate.id === claim.message.subscriber.id && candidate.revision === claim.message.subscriber.revision);
      if (handler === undefined) return yield* Effect.fail(eventError("invalidAuthority"));
      // Handler execution is outside every SQL session. Interruption or a defect
      // leaves the lease recoverable; expected subscriber failure is durable evidence.
      yield* Effect.suspend(() => handler.handle(claim.message)).pipe(
        Effect.timeoutOrElse({ duration: 1000, orElse: () => Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "handler-timeout" })) }),
        Effect.matchEffect({
          onSuccess: () => store.settle(claim).pipe(Effect.tap(() => Effect.sync(() => { delivered++; }))),
          onFailure: failure => store.settle(claim, failure).pipe(Effect.tap(() => Effect.sync(() => { failed++; }))),
        }),
      );
    }
    // Keep the previous cursor when the delivery bound cuts a commit short.
    return { done: false, cursor: afterCommit, delivered, failed };
  });
  return Object.freeze({ runNext });
});

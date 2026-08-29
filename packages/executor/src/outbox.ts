import type {
  ListUndeliveredOutboxEventsInput,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
} from "@flarex/persistence-postgres";
import { Data, Effect } from "effect";

import { OutboxDeliveryPolicyError } from "./errors";
import { makeExecutorTimeEffect } from "./executorTime";
import type {
  Clock,
  FlarexExecutorControlPersistence,
  ListOutboxEventsResult,
  RunOutboxDeliveryBatchInput,
  RunOutboxDeliveryBatchResult,
} from "./types";

const DEFAULT_OUTBOX_DELIVERY_LIMIT = 100;

export class ConfiguredOutboxClockError extends Data.TaggedError(
  "ConfiguredOutboxClockError",
)<{
  readonly cause: unknown;
}> {}

export class OutboxForeignOperationError extends Data.TaggedError(
  "OutboxForeignOperationError",
)<{
  readonly operation: OutboxForeignOperation;
  readonly cause: unknown;
}> {}

export type OutboxForeignOperation =
  | "deliver outbox events"
  | "list undelivered outbox events"
  | "mark outbox events delivered"
  | "project outbox delivery event keys"
  | "read outbox delivery deployment id"
  | "read outbox delivery timestamp override";

export type RunOutboxDeliveryBatchEffectError =
  | ConfiguredOutboxClockError
  | OutboxDeliveryPolicyError
  | OutboxForeignOperationError;

export const listUndeliveredOutboxEventsEffect = Effect.fn(
  "Executor.outbox.listUndelivered",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  input: ListUndeliveredOutboxEventsInput,
): Effect.fn.Return<ListOutboxEventsResult, OutboxForeignOperationError> {
  return yield* tryOutboxPromise(
    "list undelivered outbox events",
    () => persistence.listUndeliveredOutboxEvents(input),
  );
});

export const markOutboxEventsDeliveredEffect = Effect.fn(
  "Executor.outbox.markDelivered",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  input: MarkOutboxEventsDeliveredInput,
): Effect.fn.Return<
  MarkOutboxEventsDeliveredResult,
  OutboxForeignOperationError
> {
  return yield* tryOutboxPromise(
    "mark outbox events delivered",
    () => persistence.markOutboxEventsDelivered(input),
  );
});

export const runOutboxDeliveryBatchEffect = Effect.fn(
  "Executor.outbox.runDeliveryBatch",
)(function* (
  persistence: FlarexExecutorControlPersistence,
  readTime: Effect.Effect<Date, ConfiguredOutboxClockError>,
  input: RunOutboxDeliveryBatchInput,
): Effect.fn.Return<
  RunOutboxDeliveryBatchResult,
  RunOutboxDeliveryBatchEffectError
> {
  const limit = input.limit ?? DEFAULT_OUTBOX_DELIVERY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    return yield* Effect.fail(
      new OutboxDeliveryPolicyError("limit must be a positive integer."),
    );
  }

  const page = yield* listUndeliveredOutboxEventsEffect(persistence, {
    deploymentId: input.deploymentId,
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
  if (page.events.length === 0) {
    return {
      events: [],
      delivered: 0,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  yield* tryOutboxPromise(
    "deliver outbox events",
    () => input.deliver(page.events),
  );
  const markDeploymentId = yield* Effect.try({
    try: () => input.deploymentId,
    catch: (cause) => new OutboxForeignOperationError({
      operation: "read outbox delivery deployment id",
      cause,
    }),
  });
  const eventKeys = yield* Effect.try({
    try: () => page.events.map((event) => ({
      ts: event.ts,
      sequence: event.sequence,
    })),
    catch: (cause) => new OutboxForeignOperationError({
      operation: "project outbox delivery event keys",
      cause,
    }),
  });
  const deliveredAtOverride = yield* Effect.try({
    try: () => input.deliveredAt,
    catch: (cause) => new OutboxForeignOperationError({
      operation: "read outbox delivery timestamp override",
      cause,
    }),
  });
  const deliveredAt = deliveredAtOverride ?? (yield* readTime);
  const delivered = yield* markOutboxEventsDeliveredEffect(persistence, {
    deploymentId: markDeploymentId,
    events: eventKeys,
    deliveredAt,
  });

  return {
    events: page.events,
    delivered: delivered.delivered,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
});

export function makeOutboxTimeEffect(
  clock: Clock | undefined,
): Effect.Effect<Date, ConfiguredOutboxClockError> {
  return makeExecutorTimeEffect(
    clock,
    (cause) => new ConfiguredOutboxClockError({ cause }),
  );
}

export function runOutboxPromise<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(Effect.mapError(outboxFailureCause)),
  );
}

export function outboxFailureCause(error: unknown): unknown {
  return error instanceof ConfiguredOutboxClockError ||
      error instanceof OutboxForeignOperationError
    ? error.cause
    : error;
}

function tryOutboxPromise<A>(
  operation: OutboxForeignOperation,
  evaluate: () => PromiseLike<A>,
): Effect.Effect<A, OutboxForeignOperationError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new OutboxForeignOperationError({ operation, cause }),
  });
}

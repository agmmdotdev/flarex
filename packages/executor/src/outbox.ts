import type {
  Clock,
  FlarexExecutorPersistence,
  ListOutboxEventsResult,
  RunOutboxDeliveryBatchInput,
  RunOutboxDeliveryBatchResult,
} from "./types";
import { OutboxDeliveryPolicyError } from "./errors";
import type {
  ListUndeliveredOutboxEventsInput,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
} from "@flarex/persistence-postgres";

const DEFAULT_OUTBOX_DELIVERY_LIMIT = 100;

export async function listUndeliveredOutboxEvents(
  persistence: FlarexExecutorPersistence,
  input: ListUndeliveredOutboxEventsInput,
): Promise<ListOutboxEventsResult> {
  return await persistence.listUndeliveredOutboxEvents(input);
}

export async function markOutboxEventsDelivered(
  persistence: FlarexExecutorPersistence,
  input: MarkOutboxEventsDeliveredInput,
): Promise<MarkOutboxEventsDeliveredResult> {
  return await persistence.markOutboxEventsDelivered(input);
}

export async function runOutboxDeliveryBatch(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RunOutboxDeliveryBatchInput,
): Promise<RunOutboxDeliveryBatchResult> {
  const limit = input.limit ?? DEFAULT_OUTBOX_DELIVERY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new OutboxDeliveryPolicyError("limit must be a positive integer.");
  }

  const page = await persistence.listUndeliveredOutboxEvents({
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

  await input.deliver(page.events);
  const delivered = await persistence.markOutboxEventsDelivered({
    deploymentId: input.deploymentId,
    events: page.events.map((event) => ({
      ts: event.ts,
      sequence: event.sequence,
    })),
    deliveredAt: input.deliveredAt ?? clock.now(),
  });

  return {
    events: page.events,
    delivered: delivered.delivered,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

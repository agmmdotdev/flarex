import { LiveQueryDeliveryPolicyError } from "./errors";
import type {
  Clock,
  FlarexExecutorPersistence,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  RunLiveQueryDeliveryBatchInput,
  RunLiveQueryDeliveryBatchResult,
} from "./types";

const DEFAULT_LIVE_QUERY_DELIVERY_LIMIT = 100;

export async function listUndeliveredLiveQueryDeliveries(
  persistence: FlarexExecutorPersistence,
  input: ListUndeliveredLiveQueryDeliveriesInput,
): Promise<ListUndeliveredLiveQueryDeliveriesResult> {
  return await persistence.listUndeliveredLiveQueryDeliveries(input);
}

export async function markLiveQueryDeliveriesDelivered(
  persistence: FlarexExecutorPersistence,
  input: MarkLiveQueryDeliveriesDeliveredInput,
): Promise<MarkLiveQueryDeliveriesDeliveredResult> {
  return await persistence.markLiveQueryDeliveriesDelivered(input);
}

export async function runLiveQueryDeliveryBatch(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RunLiveQueryDeliveryBatchInput,
): Promise<RunLiveQueryDeliveryBatchResult> {
  const limit = input.limit ?? DEFAULT_LIVE_QUERY_DELIVERY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    throw new LiveQueryDeliveryPolicyError("limit must be a positive integer.");
  }

  const page = await persistence.listUndeliveredLiveQueryDeliveries({
    deploymentId: input.deploymentId,
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
  if (page.deliveries.length === 0) {
    return {
      deliveries: [],
      delivered: 0,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  await input.deliver(page.deliveries);
  const delivered = await persistence.markLiveQueryDeliveriesDelivered({
    deploymentId: input.deploymentId,
    deliveryIds: page.deliveries.map((delivery) => delivery.deliveryId),
    deliveredAt: input.deliveredAt ?? clock.now(),
  });

  return {
    deliveries: page.deliveries,
    delivered: delivered.delivered,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

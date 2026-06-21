import { LiveQueryDeliveryPolicyError } from "./errors";
import type {
  AckLiveQueryDeliveriesInput,
  AckLiveQueryDeliveriesResult,
  ClaimLiveQueryDeliveryBatchInput,
  ClaimLiveQueryDeliveryBatchResult,
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

export async function claimLiveQueryDeliveryBatch(
  persistence: FlarexExecutorPersistence,
  input: ClaimLiveQueryDeliveryBatchInput,
): Promise<ClaimLiveQueryDeliveryBatchResult> {
  const limit = liveQueryDeliveryLimit(input.limit);
  return await persistence.listUndeliveredLiveQueryDeliveries({
    deploymentId: input.deploymentId,
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export async function ackLiveQueryDeliveries(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: AckLiveQueryDeliveriesInput,
): Promise<AckLiveQueryDeliveriesResult> {
  return await persistence.markLiveQueryDeliveriesDelivered({
    deploymentId: input.deploymentId,
    deliveryIds: input.deliveryIds,
    deliveredAt: input.deliveredAt ?? clock.now(),
  });
}

export async function runLiveQueryDeliveryBatch(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RunLiveQueryDeliveryBatchInput,
): Promise<RunLiveQueryDeliveryBatchResult> {
  const page = await claimLiveQueryDeliveryBatch(persistence, input);
  if (page.deliveries.length === 0) {
    return {
      deliveries: [],
      delivered: 0,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  await input.deliver(page.deliveries);
  const delivered = await ackLiveQueryDeliveries(persistence, clock, {
    deploymentId: input.deploymentId,
    deliveryIds: page.deliveries.map((delivery) => delivery.deliveryId),
    ...(input.deliveredAt === undefined ? {} : { deliveredAt: input.deliveredAt }),
  });

  return {
    deliveries: page.deliveries,
    delivered: delivered.delivered,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

function liveQueryDeliveryLimit(limit: number | undefined): number {
  const resolved = limit ?? DEFAULT_LIVE_QUERY_DELIVERY_LIMIT;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved <= 0) {
    throw new LiveQueryDeliveryPolicyError("limit must be a positive integer.");
  }
  return resolved;
}

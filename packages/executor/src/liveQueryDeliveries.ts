import { LiveQueryDeliveryPolicyError } from "./errors";
import type {
  AckLiveQueryDeliveriesInput,
  AckLiveQueryDeliveriesResult,
  ClaimLiveQueryDeliveryBatchInput,
  ClaimLiveQueryDeliveryBatchResult,
  Clock,
  DeadLetterStuckLiveQueryDeliveriesInput,
  DeadLetterStuckLiveQueryDeliveriesResult,
  FlarexExecutorPersistence,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  MarkLiveQueryDeliveriesDeadLetteredInput,
  MarkLiveQueryDeliveriesDeadLetteredResult,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsResult,
  ListStuckLiveQueryDeliveriesInput,
  ListStuckLiveQueryDeliveriesResult,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQueryDeliveryFailureResult,
  RunLiveQueryDeliveryBatchInput,
  RunLiveQueryDeliveryBatchResult,
} from "./types";

const DEFAULT_LIVE_QUERY_DELIVERY_LIMIT = 100;
const DEFAULT_LIVE_QUERY_DELIVERY_LEASE_MS = 30_000;
const MAX_DELIVERY_FAILURE_ERROR_LENGTH = 4000;
const MAX_DELIVERY_DEAD_LETTER_REASON_LENGTH = 4000;

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

export async function markLiveQueryDeliveriesDeadLettered(
  persistence: FlarexExecutorPersistence,
  input: MarkLiveQueryDeliveriesDeadLetteredInput,
): Promise<MarkLiveQueryDeliveriesDeadLetteredResult> {
  validateDeliveryIds(input.deliveryIds);
  return await persistence.markLiveQueryDeliveriesDeadLettered({
    ...input,
    reason: deliveryDeadLetterReason(input.reason),
  });
}

export async function listPendingLiveQueryDeliveryDeployments(
  persistence: FlarexExecutorPersistence,
  input: ListPendingLiveQueryDeliveryDeploymentsInput,
): Promise<ListPendingLiveQueryDeliveryDeploymentsResult> {
  const limit = liveQueryDeliveryLimit(input.limit);
  return await persistence.listPendingLiveQueryDeliveryDeployments({
    limit,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export async function listStuckLiveQueryDeliveries(
  persistence: FlarexExecutorPersistence,
  input: ListStuckLiveQueryDeliveriesInput,
): Promise<ListStuckLiveQueryDeliveriesResult> {
  const limit = liveQueryDeliveryLimit(input.limit);
  const minAttempts = input.minAttempts ?? 1;
  if (!Number.isInteger(minAttempts) || minAttempts <= 0) {
    throw new LiveQueryDeliveryPolicyError(
      "minAttempts must be a positive integer.",
    );
  }
  return await persistence.listStuckLiveQueryDeliveries({
    olderThan: input.olderThan,
    minAttempts,
    limit,
    ...(input.deploymentId === undefined
      ? {}
      : { deploymentId: input.deploymentId }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export async function deadLetterStuckLiveQueryDeliveries(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: DeadLetterStuckLiveQueryDeliveriesInput,
): Promise<DeadLetterStuckLiveQueryDeliveriesResult> {
  const reason = deliveryDeadLetterReason(input.reason);
  const page = await listStuckLiveQueryDeliveries(persistence, {
    olderThan: input.olderThan,
    ...(input.deploymentId === undefined
      ? {}
      : { deploymentId: input.deploymentId }),
    ...(input.minAttempts === undefined
      ? {}
      : { minAttempts: input.minAttempts }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    limit: input.limit ?? DEFAULT_LIVE_QUERY_DELIVERY_LIMIT,
  });
  if (page.deliveries.length === 0) {
    return {
      scanned: [],
      deadLettered: [],
      reconnectConnectionIds: [],
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  const deadLettered: Array<DeadLetterStuckLiveQueryDeliveriesResult["deadLettered"][number]> = [];
  const byDeployment = deliveriesByDeployment(page.deliveries);
  const deadLetteredAt = input.deadLetteredAt ?? clock.now();
  for (const [deploymentId, deliveries] of byDeployment) {
    const result = await persistence.markLiveQueryDeliveriesDeadLettered({
      deploymentId,
      deliveryIds: deliveries.map(delivery => delivery.deliveryId),
      deadLetteredAt,
      reason,
    });
    deadLettered.push(...result.deliveries);
  }

  return {
    scanned: page.deliveries,
    deadLettered,
    reconnectConnectionIds: uniqueSortedConnectionIds(deadLettered),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

export async function recordLiveQueryDeliveryFailure(
  persistence: FlarexExecutorPersistence,
  input: RecordLiveQueryDeliveryFailureInput,
): Promise<RecordLiveQueryDeliveryFailureResult> {
  if (input.stage !== "fanout" && input.stage !== "ack") {
    throw new LiveQueryDeliveryPolicyError("stage must be fanout or ack.");
  }
  validateDeliveryIds(input.deliveryIds);
  return await persistence.recordLiveQueryDeliveryFailure({
    ...input,
    error: truncateDeliveryFailureError(input.error),
  });
}

export async function claimLiveQueryDeliveryBatch(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: ClaimLiveQueryDeliveryBatchInput,
): Promise<ClaimLiveQueryDeliveryBatchResult> {
  const limit = liveQueryDeliveryLimit(input.limit);
  const leaseDurationMs = liveQueryDeliveryLeaseDurationMs(input.leaseDurationMs);
  const claimedAt = clock.now();
  return await persistence.claimLiveQueryDeliveries({
    deploymentId: input.deploymentId,
    limit,
    claimedAt,
    claimExpiresAt: new Date(claimedAt.getTime() + leaseDurationMs),
    ...(input.claimOwner === undefined ? {} : { claimOwner: input.claimOwner }),
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
    ...(input.claimOwner === undefined ? {} : { claimOwner: input.claimOwner }),
  });
}

export async function runLiveQueryDeliveryBatch(
  persistence: FlarexExecutorPersistence,
  clock: Clock,
  input: RunLiveQueryDeliveryBatchInput,
): Promise<RunLiveQueryDeliveryBatchResult> {
  const claimOwner = input.claimOwner ?? liveQueryDeliveryClaimOwner(input.deploymentId);
  const page = await claimLiveQueryDeliveryBatch(persistence, clock, {
    ...input,
    claimOwner,
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
  const delivered = await ackLiveQueryDeliveries(persistence, clock, {
    deploymentId: input.deploymentId,
    deliveryIds: page.deliveries.map((delivery) => delivery.deliveryId),
    ...(input.deliveredAt === undefined ? {} : { deliveredAt: input.deliveredAt }),
    claimOwner,
  });

  return {
    deliveries: page.deliveries,
    delivered: delivered.delivered,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

function truncateDeliveryFailureError(error: string): string {
  if (error.length <= MAX_DELIVERY_FAILURE_ERROR_LENGTH) return error;
  return error.slice(0, MAX_DELIVERY_FAILURE_ERROR_LENGTH);
}

function deliveryDeadLetterReason(reason: string): string {
  if (reason.length === 0) {
    throw new LiveQueryDeliveryPolicyError("reason must be a non-empty string.");
  }
  if (reason.length <= MAX_DELIVERY_DEAD_LETTER_REASON_LENGTH) return reason;
  return reason.slice(0, MAX_DELIVERY_DEAD_LETTER_REASON_LENGTH);
}

function validateDeliveryIds(deliveryIds: string[]): void {
  if (
    deliveryIds.some(
      (deliveryId) => typeof deliveryId !== "string" || deliveryId.length === 0,
    )
  ) {
    throw new LiveQueryDeliveryPolicyError(
      "deliveryIds must contain only non-empty strings.",
    );
  }
}

function deliveriesByDeployment<T extends { deploymentId: string }>(
  deliveries: T[],
): Map<string, T[]> {
  const byDeployment = new Map<string, T[]>();
  for (const delivery of deliveries) {
    const existing = byDeployment.get(delivery.deploymentId);
    if (existing === undefined) {
      byDeployment.set(delivery.deploymentId, [delivery]);
    } else {
      existing.push(delivery);
    }
  }
  return byDeployment;
}

function uniqueSortedConnectionIds(
  deliveries: Array<{ connectionId: string }>,
): string[] {
  return Array.from(new Set(deliveries.map(delivery => delivery.connectionId)))
    .sort();
}

function liveQueryDeliveryLimit(limit: number | undefined): number {
  const resolved = limit ?? DEFAULT_LIVE_QUERY_DELIVERY_LIMIT;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved <= 0) {
    throw new LiveQueryDeliveryPolicyError("limit must be a positive integer.");
  }
  return resolved;
}

function liveQueryDeliveryLeaseDurationMs(value: number | undefined): number {
  const resolved = value ?? DEFAULT_LIVE_QUERY_DELIVERY_LEASE_MS;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved <= 0) {
    throw new LiveQueryDeliveryPolicyError(
      "leaseDurationMs must be a positive integer.",
    );
  }
  return resolved;
}

function liveQueryDeliveryClaimOwner(deploymentId: string): string {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `executor:${deploymentId}:${token}`;
}

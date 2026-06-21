import { and, asc, count, eq, gt, isNull, min, or, sql } from "drizzle-orm";

import type { FlarexMetadataDatabase } from "./deployments";
import { liveQueryDeliveries } from "./schema";

export interface InsertLiveQueryDeliveryInput {
  deploymentId: string;
  deliveryId: string;
  connectionId: string;
  queryId: number;
  payloadJson: unknown;
  createdAt?: Date;
}

export interface LiveQueryDeliveryCursor {
  createdAt: Date;
  deliveryId: string;
}

export interface ListUndeliveredLiveQueryDeliveriesInput {
  deploymentId: string;
  cursor?: LiveQueryDeliveryCursor;
  limit: number;
}

export interface ListUndeliveredLiveQueryDeliveriesResult {
  deliveries: LiveQueryDeliveryRecord[];
  nextCursor: LiveQueryDeliveryCursor | null;
  hasMore: boolean;
}

export interface PendingLiveQueryDeliveryDeploymentCursor {
  oldestCreatedAt: Date;
  deploymentId: string;
}

export interface PendingLiveQueryDeliveryDeployment {
  deploymentId: string;
  oldestCreatedAt: Date;
  pending: number;
}

export interface ListPendingLiveQueryDeliveryDeploymentsInput {
  cursor?: PendingLiveQueryDeliveryDeploymentCursor;
  limit: number;
}

export interface ListPendingLiveQueryDeliveryDeploymentsResult {
  deployments: PendingLiveQueryDeliveryDeployment[];
  nextCursor: PendingLiveQueryDeliveryDeploymentCursor | null;
  hasMore: boolean;
}

export interface MarkLiveQueryDeliveriesDeliveredInput {
  deploymentId: string;
  deliveryIds: string[];
  deliveredAt: Date;
}

export interface MarkLiveQueryDeliveriesDeliveredResult {
  delivered: number;
}

export type LiveQueryDeliveryRecord = typeof liveQueryDeliveries.$inferSelect;

export async function insertLiveQueryDelivery(
  db: FlarexMetadataDatabase,
  input: InsertLiveQueryDeliveryInput,
): Promise<LiveQueryDeliveryRecord> {
  const rows = await db
    .insert(liveQueryDeliveries)
    .values({
      deploymentId: input.deploymentId,
      deliveryId: input.deliveryId,
      connectionId: input.connectionId,
      queryId: input.queryId,
      payloadJson: jsonbValue(input.payloadJson),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    })
    .returning();

  const delivery = rows[0];
  if (delivery === undefined) {
    throw new Error(
      `Failed to insert live query delivery: ${input.deploymentId}/${input.deliveryId}`,
    );
  }
  return delivery;
}

export async function listUndeliveredLiveQueryDeliveries(
  db: FlarexMetadataDatabase,
  input: ListUndeliveredLiveQueryDeliveriesInput,
): Promise<ListUndeliveredLiveQueryDeliveriesResult> {
  const cursorFilter =
    input.cursor === undefined
      ? undefined
      : or(
          gt(liveQueryDeliveries.createdAt, input.cursor.createdAt),
          and(
            eq(liveQueryDeliveries.createdAt, input.cursor.createdAt),
            gt(liveQueryDeliveries.deliveryId, input.cursor.deliveryId),
          ),
        );
  const baseFilter = and(
    eq(liveQueryDeliveries.deploymentId, input.deploymentId),
    isNull(liveQueryDeliveries.deliveredAt),
  );

  const rows = await db
    .select()
    .from(liveQueryDeliveries)
    .where(
      cursorFilter === undefined
        ? baseFilter
        : and(baseFilter, cursorFilter),
    )
    .orderBy(
      asc(liveQueryDeliveries.createdAt),
      asc(liveQueryDeliveries.deliveryId),
    )
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const deliveries = rows.slice(0, input.limit);
  const last = deliveries.at(-1);
  return {
    deliveries,
    nextCursor:
      hasMore && last !== undefined
        ? {
            createdAt: last.createdAt,
            deliveryId: last.deliveryId,
          }
        : null,
    hasMore,
  };
}

export async function markLiveQueryDeliveriesDelivered(
  db: FlarexMetadataDatabase,
  input: MarkLiveQueryDeliveriesDeliveredInput,
): Promise<MarkLiveQueryDeliveriesDeliveredResult> {
  if (input.deliveryIds.length === 0) {
    return { delivered: 0 };
  }

  const deliveryFilter = or(
    ...input.deliveryIds.map((deliveryId) =>
      eq(liveQueryDeliveries.deliveryId, deliveryId),
    ),
  );
  const rows = await db
    .update(liveQueryDeliveries)
    .set({
      deliveredAt: input.deliveredAt,
    })
    .where(
      and(
        eq(liveQueryDeliveries.deploymentId, input.deploymentId),
        isNull(liveQueryDeliveries.deliveredAt),
        deliveryFilter,
      ),
    )
    .returning();

  return {
    delivered: rows.length,
  };
}

export async function listPendingLiveQueryDeliveryDeployments(
  db: FlarexMetadataDatabase,
  input: ListPendingLiveQueryDeliveryDeploymentsInput,
): Promise<ListPendingLiveQueryDeliveryDeploymentsResult> {
  const oldestCreatedAt = min(liveQueryDeliveries.createdAt);
  const pending = count();
  const cursorFilter =
    input.cursor === undefined
      ? undefined
      : or(
          gt(oldestCreatedAt, input.cursor.oldestCreatedAt),
          and(
            eq(oldestCreatedAt, input.cursor.oldestCreatedAt),
            gt(liveQueryDeliveries.deploymentId, input.cursor.deploymentId),
          ),
        );
  const rows = await db
    .select({
      deploymentId: liveQueryDeliveries.deploymentId,
      oldestCreatedAt,
      pending,
    })
    .from(liveQueryDeliveries)
    .where(isNull(liveQueryDeliveries.deliveredAt))
    .groupBy(liveQueryDeliveries.deploymentId)
    .having(cursorFilter)
    .orderBy(asc(oldestCreatedAt), asc(liveQueryDeliveries.deploymentId))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit).map((row) => {
    if (row.oldestCreatedAt === null) {
      throw new Error(
        `Pending live query delivery deployment ${row.deploymentId} has no oldest created_at.`,
      );
    }
    return {
      deploymentId: row.deploymentId,
      oldestCreatedAt: row.oldestCreatedAt,
      pending: row.pending,
    };
  });
  const last = page.at(-1);
  return {
    deployments: page,
    nextCursor:
      hasMore && last !== undefined
        ? {
            oldestCreatedAt: last.oldestCreatedAt,
            deploymentId: last.deploymentId,
          }
        : null,
    hasMore,
  };
}

function jsonbValue(value: unknown): unknown {
  return value === null ? sql`'null'::jsonb` : value;
}

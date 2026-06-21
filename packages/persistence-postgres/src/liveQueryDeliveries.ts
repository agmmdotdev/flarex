import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";

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

function jsonbValue(value: unknown): unknown {
  return value === null ? sql`'null'::jsonb` : value;
}

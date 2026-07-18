import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  min,
  or,
  sql,
} from "drizzle-orm";

import type { FlarexMetadataDatabase } from "./deployments";
import { jsonbNotNullValue } from "./jsonbNotNullValue";
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

export interface ClaimLiveQueryDeliveriesInput {
  deploymentId: string;
  cursor?: LiveQueryDeliveryCursor;
  limit: number;
  claimedAt: Date;
  claimExpiresAt: Date;
  claimOwner?: string;
}

export type ClaimLiveQueryDeliveriesResult = {
  deliveries: LiveQueryDeliveryRecord[];
} & (
  | { hasMore: true; nextCursor: LiveQueryDeliveryCursor }
  | { hasMore: false; nextCursor: LiveQueryDeliveryCursor | null }
);

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

export interface StuckLiveQueryDeliveryCursor {
  lastAttemptedAt: Date;
  deploymentId: string;
  deliveryId: string;
}

export interface ListStuckLiveQueryDeliveriesInput {
  deploymentId?: string;
  olderThan: Date;
  minAttempts?: number;
  cursor?: StuckLiveQueryDeliveryCursor;
  limit: number;
}

export interface ListStuckLiveQueryDeliveriesResult {
  deliveries: LiveQueryDeliveryRecord[];
  nextCursor: StuckLiveQueryDeliveryCursor | null;
  hasMore: boolean;
}

export interface MarkLiveQueryDeliveriesDeliveredInput {
  deploymentId: string;
  deliveryIds: string[];
  deliveredAt: Date;
  claimOwner?: string;
}

export interface MarkLiveQueryDeliveriesDeliveredResult {
  delivered: number;
}

export interface MarkLiveQueryDeliveriesDeadLetteredInput {
  deploymentId: string;
  deliveryIds: string[];
  deadLetteredAt: Date;
  reason: string;
  claimOwner?: string;
}

export interface MarkLiveQueryDeliveriesDeadLetteredResult {
  deadLettered: number;
  deliveries: LiveQueryDeliveryRecord[];
}

export type LiveQueryDeliveryFailureStage = "fanout" | "ack";

export interface RecordLiveQueryDeliveryFailureInput {
  deploymentId: string;
  deliveryIds: string[];
  stage: LiveQueryDeliveryFailureStage;
  error: string;
  failedAt: Date;
  claimOwner?: string;
}

export interface RecordLiveQueryDeliveryFailureResult {
  failed: number;
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
      payloadJson: jsonbNotNullValue(input.payloadJson),
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
    isNull(liveQueryDeliveries.deadLetteredAt),
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

export async function claimLiveQueryDeliveries(
  db: FlarexMetadataDatabase,
  input: ClaimLiveQueryDeliveriesInput,
): Promise<ClaimLiveQueryDeliveriesResult> {
  const cursorFilter = deliveryCursorFilter(input.cursor);
  const claimableFilter = and(
    eq(liveQueryDeliveries.deploymentId, input.deploymentId),
    isNull(liveQueryDeliveries.deliveredAt),
    isNull(liveQueryDeliveries.deadLetteredAt),
    or(
      isNull(liveQueryDeliveries.claimExpiresAt),
      lte(liveQueryDeliveries.claimExpiresAt, input.claimedAt),
    ),
  );

  const candidates = await db
    .select({
      deliveryId: liveQueryDeliveries.deliveryId,
      createdAt: liveQueryDeliveries.createdAt,
    })
    .from(liveQueryDeliveries)
    .where(
      cursorFilter === undefined
        ? claimableFilter
        : and(claimableFilter, cursorFilter),
    )
    .orderBy(
      asc(liveQueryDeliveries.createdAt),
      asc(liveQueryDeliveries.deliveryId),
    )
    .limit(input.limit + 1);

  const hasMore = candidates.length > input.limit;
  const deliveryIds = candidates
    .slice(0, input.limit)
    .map(candidate => candidate.deliveryId);
  const lastCandidate = candidates.slice(0, input.limit).at(-1);
  const nextCursor =
    hasMore && lastCandidate !== undefined
      ? {
          createdAt: lastCandidate.createdAt,
          deliveryId: lastCandidate.deliveryId,
        }
      : null;
  if (deliveryIds.length === 0) {
    return claimLiveQueryDeliveriesResult([], hasMore, nextCursor);
  }

  const rows = await db
    .update(liveQueryDeliveries)
    .set({
      claimedAt: input.claimedAt,
      claimExpiresAt: input.claimExpiresAt,
      claimOwner: input.claimOwner ?? null,
    })
    .where(
      and(
        claimableFilter,
        inArray(liveQueryDeliveries.deliveryId, deliveryIds),
      ),
    )
    .returning();

  const deliveries = rows.sort(compareDeliveryRecords);
  return claimLiveQueryDeliveriesResult(deliveries, hasMore, nextCursor);
}

function claimLiveQueryDeliveriesResult(
  deliveries: LiveQueryDeliveryRecord[],
  hasMore: boolean,
  nextCursor: LiveQueryDeliveryCursor | null,
): ClaimLiveQueryDeliveriesResult {
  if (hasMore) {
    if (nextCursor === null) {
      throw new Error("Claimed live query delivery page with hasMore must have a cursor.");
    }
    return {
      deliveries,
      hasMore: true,
      nextCursor,
    };
  }
  return {
    deliveries,
    hasMore: false,
    nextCursor,
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
      claimedAt: null,
      claimExpiresAt: null,
      claimOwner: null,
    })
    .where(
      and(
        eq(liveQueryDeliveries.deploymentId, input.deploymentId),
        isNull(liveQueryDeliveries.deliveredAt),
        isNull(liveQueryDeliveries.deadLetteredAt),
        claimOwnerFilter(input.claimOwner),
        deliveryFilter,
      ),
    )
    .returning();

  return {
    delivered: rows.length,
  };
}

export async function markLiveQueryDeliveriesDeadLettered(
  db: FlarexMetadataDatabase,
  input: MarkLiveQueryDeliveriesDeadLetteredInput,
): Promise<MarkLiveQueryDeliveriesDeadLetteredResult> {
  if (input.deliveryIds.length === 0) {
    return { deadLettered: 0, deliveries: [] };
  }

  const rows = await db
    .update(liveQueryDeliveries)
    .set({
      deadLetteredAt: input.deadLetteredAt,
      deadLetterReason: input.reason,
      claimedAt: null,
      claimExpiresAt: null,
      claimOwner: null,
    })
    .where(
      and(
        eq(liveQueryDeliveries.deploymentId, input.deploymentId),
        isNull(liveQueryDeliveries.deliveredAt),
        isNull(liveQueryDeliveries.deadLetteredAt),
        claimOwnerFilter(input.claimOwner),
        inArray(liveQueryDeliveries.deliveryId, input.deliveryIds),
      ),
    )
    .returning();

  return {
    deadLettered: rows.length,
    deliveries: rows,
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
    .where(
      and(
        isNull(liveQueryDeliveries.deliveredAt),
        isNull(liveQueryDeliveries.deadLetteredAt),
      ),
    )
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

export async function recordLiveQueryDeliveryFailure(
  db: FlarexMetadataDatabase,
  input: RecordLiveQueryDeliveryFailureInput,
): Promise<RecordLiveQueryDeliveryFailureResult> {
  if (input.deliveryIds.length === 0) {
    return { failed: 0 };
  }

  const rows = await db
    .update(liveQueryDeliveries)
    .set({
      attemptCount: sql`${liveQueryDeliveries.attemptCount} + 1`,
      lastAttemptedAt: input.failedAt,
      lastErrorStage: input.stage,
      lastError: input.error,
      claimedAt: null,
      claimExpiresAt: null,
      claimOwner: null,
    })
    .where(
      and(
        eq(liveQueryDeliveries.deploymentId, input.deploymentId),
        isNull(liveQueryDeliveries.deliveredAt),
        isNull(liveQueryDeliveries.deadLetteredAt),
        claimOwnerFilter(input.claimOwner),
        inArray(liveQueryDeliveries.deliveryId, input.deliveryIds),
      ),
    )
    .returning();

  return {
    failed: rows.length,
  };
}

export async function listStuckLiveQueryDeliveries(
  db: FlarexMetadataDatabase,
  input: ListStuckLiveQueryDeliveriesInput,
): Promise<ListStuckLiveQueryDeliveriesResult> {
  const minAttempts = input.minAttempts ?? 1;
  const cursorFilter =
    input.cursor === undefined
      ? undefined
      : or(
          gt(liveQueryDeliveries.lastAttemptedAt, input.cursor.lastAttemptedAt),
          and(
            eq(liveQueryDeliveries.lastAttemptedAt, input.cursor.lastAttemptedAt),
            gt(liveQueryDeliveries.deploymentId, input.cursor.deploymentId),
          ),
          and(
            eq(liveQueryDeliveries.lastAttemptedAt, input.cursor.lastAttemptedAt),
            eq(liveQueryDeliveries.deploymentId, input.cursor.deploymentId),
            gt(liveQueryDeliveries.deliveryId, input.cursor.deliveryId),
          ),
        );
  const deploymentFilter =
    input.deploymentId === undefined
      ? undefined
      : eq(liveQueryDeliveries.deploymentId, input.deploymentId);
  const rows = await db
    .select()
    .from(liveQueryDeliveries)
    .where(
      and(
        isNull(liveQueryDeliveries.deliveredAt),
        isNull(liveQueryDeliveries.deadLetteredAt),
        isNotNull(liveQueryDeliveries.lastAttemptedAt),
        lte(liveQueryDeliveries.lastAttemptedAt, input.olderThan),
        gte(liveQueryDeliveries.attemptCount, minAttempts),
        or(
          isNull(liveQueryDeliveries.claimExpiresAt),
          lte(liveQueryDeliveries.claimExpiresAt, input.olderThan),
        ),
        deploymentFilter,
        cursorFilter,
      ),
    )
    .orderBy(
      asc(liveQueryDeliveries.lastAttemptedAt),
      asc(liveQueryDeliveries.deploymentId),
      asc(liveQueryDeliveries.deliveryId),
    )
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const deliveries = rows.slice(0, input.limit);
  const last = deliveries.at(-1);
  return {
    deliveries,
    nextCursor:
      hasMore && last !== undefined && last.lastAttemptedAt !== null
        ? {
            lastAttemptedAt: last.lastAttemptedAt,
            deploymentId: last.deploymentId,
            deliveryId: last.deliveryId,
          }
        : null,
    hasMore,
  };
}

function deliveryCursorFilter(
  cursor: LiveQueryDeliveryCursor | undefined,
): ReturnType<typeof or> | undefined {
  return cursor === undefined
    ? undefined
    : or(
        gt(liveQueryDeliveries.createdAt, cursor.createdAt),
        and(
          eq(liveQueryDeliveries.createdAt, cursor.createdAt),
          gt(liveQueryDeliveries.deliveryId, cursor.deliveryId),
        ),
      );
}

function compareDeliveryRecords(
  left: LiveQueryDeliveryRecord,
  right: LiveQueryDeliveryRecord,
): number {
  return (
    left.createdAt.getTime() - right.createdAt.getTime() ||
    left.deliveryId.localeCompare(right.deliveryId)
  );
}

function claimOwnerFilter(
  claimOwner: string | undefined,
): ReturnType<typeof eq> | undefined {
  return claimOwner === undefined
    ? undefined
    : eq(liveQueryDeliveries.claimOwner, claimOwner);
}

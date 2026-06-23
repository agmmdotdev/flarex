import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  liveQueryConnections,
  liveQuerySubscriptions,
} from "./schema";
import type {
  DeleteLiveQuerySubscriptionResult,
  LiveQuerySubscriptionRecord,
  UpsertLiveQuerySubscriptionInput,
} from "./liveQuerySubscriptions";
import {
  upsertLiveQuerySubscription,
} from "./liveQuerySubscriptions";

export interface LiveQueryConnectionKey {
  deploymentId: string;
  connectionId: string;
}

export interface UpsertLiveQueryConnectionLeaseInput
  extends LiveQueryConnectionKey {
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface UpsertLiveQuerySubscriptionWithLeaseInput
  extends UpsertLiveQuerySubscriptionInput {
  lastSeenAt: Date;
  expiresAt: Date;
}

export interface CloseLiveQueryConnectionInput extends LiveQueryConnectionKey {
  closedAt: Date;
}

export interface ListActiveLiveQuerySubscriptionsInput {
  deploymentId: string;
  activeAt: Date;
  connectionId?: string;
}

export interface DeleteExpiredLiveQuerySubscriptionsInput {
  deploymentId: string;
  expiredAt: Date;
}

export interface DeleteExpiredLiveQuerySubscriptionsResult
  extends DeleteLiveQuerySubscriptionResult {
  deletedConnections: number;
}

export type LiveQueryConnectionRecord =
  typeof liveQueryConnections.$inferSelect;

interface FlarexMetadataSqlExecutor {
  execute(query: SQL): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export async function upsertLiveQueryConnectionLease(
  db: FlarexMetadataDatabase,
  input: UpsertLiveQueryConnectionLeaseInput,
): Promise<LiveQueryConnectionRecord> {
  const rows = await db
    .insert(liveQueryConnections)
    .values({
      deploymentId: input.deploymentId,
      connectionId: input.connectionId,
      lastSeenAt: input.lastSeenAt,
      expiresAt: input.expiresAt,
      closedAt: null,
      updatedAt: input.lastSeenAt,
    })
    .onConflictDoUpdate({
      target: [
        liveQueryConnections.deploymentId,
        liveQueryConnections.connectionId,
      ],
      set: {
        lastSeenAt: input.lastSeenAt,
        expiresAt: input.expiresAt,
        closedAt: null,
        updatedAt: input.lastSeenAt,
      },
    })
    .returning();

  const connection = rows[0];
  if (connection === undefined) {
    throw new Error(
      `Failed to upsert live query connection: ${input.deploymentId}/${input.connectionId}`,
    );
  }
  return connection;
}

export async function upsertLiveQuerySubscriptionWithLease(
  db: FlarexMetadataDatabase,
  input: UpsertLiveQuerySubscriptionWithLeaseInput,
): Promise<LiveQuerySubscriptionRecord> {
  await upsertLiveQueryConnectionLease(db, {
    deploymentId: input.deploymentId,
    connectionId: input.connectionId,
    lastSeenAt: input.lastSeenAt,
    expiresAt: input.expiresAt,
  });
  return await upsertLiveQuerySubscription(db, input);
}

export async function closeLiveQueryConnection(
  db: FlarexMetadataDatabase,
  input: CloseLiveQueryConnectionInput,
): Promise<LiveQueryConnectionRecord | null> {
  const rows = await db
    .update(liveQueryConnections)
    .set({
      closedAt: input.closedAt,
      updatedAt: input.closedAt,
    })
    .where(
      and(
        eq(liveQueryConnections.deploymentId, input.deploymentId),
        eq(liveQueryConnections.connectionId, input.connectionId),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

export async function listActiveLiveQuerySubscriptions(
  db: FlarexMetadataDatabase,
  input: ListActiveLiveQuerySubscriptionsInput,
): Promise<LiveQuerySubscriptionRecord[]> {
  return await db
    .select({
      deploymentId: liveQuerySubscriptions.deploymentId,
      connectionId: liveQuerySubscriptions.connectionId,
      queryId: liveQuerySubscriptions.queryId,
      functionPath: liveQuerySubscriptions.functionPath,
      argsJson: liveQuerySubscriptions.argsJson,
      partitionKey: liveQuerySubscriptions.partitionKey,
      beginTs: liveQuerySubscriptions.beginTs,
      readSetJson: liveQuerySubscriptions.readSetJson,
      resultJson: liveQuerySubscriptions.resultJson,
      resultHash: liveQuerySubscriptions.resultHash,
      createdAt: liveQuerySubscriptions.createdAt,
      updatedAt: liveQuerySubscriptions.updatedAt,
    })
    .from(liveQuerySubscriptions)
    .innerJoin(
      liveQueryConnections,
      and(
        eq(liveQueryConnections.deploymentId, liveQuerySubscriptions.deploymentId),
        eq(liveQueryConnections.connectionId, liveQuerySubscriptions.connectionId),
      ),
    )
    .where(
      and(
        eq(liveQuerySubscriptions.deploymentId, input.deploymentId),
        isNull(liveQueryConnections.closedAt),
        gt(liveQueryConnections.expiresAt, input.activeAt),
        input.connectionId === undefined
          ? undefined
          : eq(liveQuerySubscriptions.connectionId, input.connectionId),
      ),
    )
    .orderBy(
      asc(liveQuerySubscriptions.connectionId),
      asc(liveQuerySubscriptions.queryId),
    );
}

export async function deleteExpiredLiveQuerySubscriptions(
  db: FlarexMetadataSqlExecutor,
  input: DeleteExpiredLiveQuerySubscriptionsInput,
): Promise<DeleteExpiredLiveQuerySubscriptionsResult> {
  const result = await db.execute(sql`
    with expired_connections as (
      delete from live_query_connections
      where deployment_id = ${input.deploymentId}
        and (
          expires_at <= ${input.expiredAt}
          or closed_at <= ${input.expiredAt}
        )
      returning deployment_id, connection_id
    ),
    deleted_subscriptions as (
      delete from live_query_subscriptions
      using expired_connections
      where live_query_subscriptions.deployment_id = expired_connections.deployment_id
        and live_query_subscriptions.connection_id = expired_connections.connection_id
      returning 1
    )
    select
      (select count(*)::int from deleted_subscriptions) as deleted,
      (select count(*)::int from expired_connections) as deleted_connections
  `);
  const row = result.rows[0];
  return {
    deleted: numberField(row, "deleted"),
    deletedConnections: numberField(row, "deleted_connections"),
  };
}

function numberField(
  row: Record<string, unknown> | undefined,
  field: string,
): number {
  const value = row?.[field];
  return typeof value === "number" ? value : 0;
}

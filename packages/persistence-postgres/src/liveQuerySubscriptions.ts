import { and, asc, eq, sql } from "drizzle-orm";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  insertLiveQueryDelivery,
  type InsertLiveQueryDeliveryInput,
  type LiveQueryDeliveryRecord,
} from "./liveQueryDeliveries";
import { liveQuerySubscriptions } from "./schema";

export interface LiveQuerySubscriptionKey {
  deploymentId: string;
  connectionId: string;
  queryId: number;
}

export interface UpsertLiveQuerySubscriptionInput extends LiveQuerySubscriptionKey {
  functionPath: string;
  argsJson: unknown;
  partitionKey?: string | null;
  beginTs: number;
  readSetJson: Record<string, unknown>;
  resultJson: unknown;
  resultHash: string;
  updatedAt?: Date;
}

export interface ListLiveQuerySubscriptionsInput {
  deploymentId: string;
  connectionId?: string;
}

export type LiveQuerySubscriptionConnectionKey = Pick<
  LiveQuerySubscriptionKey,
  "deploymentId" | "connectionId"
>;

export interface DeleteLiveQuerySubscriptionResult {
  deleted: number;
}

export type LiveQuerySubscriptionRecord =
  typeof liveQuerySubscriptions.$inferSelect;

export interface RecordLiveQueryRerunResultInput
  extends UpsertLiveQuerySubscriptionInput {
  delivery?: InsertLiveQueryDeliveryInput;
}

export interface RecordLiveQueryRerunResultResult {
  subscription: LiveQuerySubscriptionRecord;
  delivery: LiveQueryDeliveryRecord | null;
}

export async function upsertLiveQuerySubscription(
  db: FlarexMetadataDatabase,
  input: UpsertLiveQuerySubscriptionInput,
): Promise<LiveQuerySubscriptionRecord> {
  const rows = await db
    .insert(liveQuerySubscriptions)
    .values({
      deploymentId: input.deploymentId,
      connectionId: input.connectionId,
      queryId: input.queryId,
      functionPath: input.functionPath,
      argsJson: jsonbValue(input.argsJson),
      partitionKey: input.partitionKey ?? null,
      beginTs: input.beginTs,
      readSetJson: input.readSetJson,
      resultJson: jsonbValue(input.resultJson),
      resultHash: input.resultHash,
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
    })
    .onConflictDoUpdate({
      target: [
        liveQuerySubscriptions.deploymentId,
        liveQuerySubscriptions.connectionId,
        liveQuerySubscriptions.queryId,
      ],
      set: {
        functionPath: input.functionPath,
        argsJson: jsonbValue(input.argsJson),
        partitionKey: input.partitionKey ?? null,
        beginTs: input.beginTs,
        readSetJson: input.readSetJson,
        resultJson: jsonbValue(input.resultJson),
        resultHash: input.resultHash,
        updatedAt: input.updatedAt ?? new Date(),
      },
    })
    .returning();

  const subscription = rows[0];
  if (subscription === undefined) {
    throw new Error(
      `Failed to upsert live query subscription: ${input.deploymentId}/${input.connectionId}/${input.queryId}`,
    );
  }
  return subscription;
}

export async function recordLiveQueryRerunResult(
  db: FlarexMetadataDatabase,
  input: RecordLiveQueryRerunResultInput,
): Promise<RecordLiveQueryRerunResultResult> {
  const subscription = await upsertLiveQuerySubscription(db, input);
  const delivery =
    input.delivery === undefined
      ? null
      : await insertLiveQueryDelivery(db, input.delivery);
  return {
    subscription,
    delivery,
  };
}

export async function deleteLiveQuerySubscription(
  db: FlarexMetadataDatabase,
  input: LiveQuerySubscriptionKey,
): Promise<DeleteLiveQuerySubscriptionResult> {
  const rows = await db
    .delete(liveQuerySubscriptions)
    .where(
      and(
        eq(liveQuerySubscriptions.deploymentId, input.deploymentId),
        eq(liveQuerySubscriptions.connectionId, input.connectionId),
        eq(liveQuerySubscriptions.queryId, input.queryId),
      ),
    )
    .returning();

  return { deleted: rows.length };
}

export async function deleteLiveQuerySubscriptionsForConnection(
  db: FlarexMetadataDatabase,
  input: LiveQuerySubscriptionConnectionKey,
): Promise<DeleteLiveQuerySubscriptionResult> {
  const rows = await db
    .delete(liveQuerySubscriptions)
    .where(
      and(
        eq(liveQuerySubscriptions.deploymentId, input.deploymentId),
        eq(liveQuerySubscriptions.connectionId, input.connectionId),
      ),
    )
    .returning();

  return { deleted: rows.length };
}

export async function listLiveQuerySubscriptions(
  db: FlarexMetadataDatabase,
  input: ListLiveQuerySubscriptionsInput,
): Promise<LiveQuerySubscriptionRecord[]> {
  return await db
    .select()
    .from(liveQuerySubscriptions)
    .where(
      input.connectionId === undefined
        ? eq(liveQuerySubscriptions.deploymentId, input.deploymentId)
        : and(
            eq(liveQuerySubscriptions.deploymentId, input.deploymentId),
            eq(liveQuerySubscriptions.connectionId, input.connectionId),
          ),
    )
    .orderBy(
      asc(liveQuerySubscriptions.connectionId),
      asc(liveQuerySubscriptions.queryId),
    );
}

function jsonbValue(value: unknown): unknown {
  return value === null ? sql`'null'::jsonb` : value;
}

import { and, asc, eq, sql } from "drizzle-orm";
import type { LiveQueryDeliveryFailedChange } from "flarex";
import type { ExecutionIdentity } from "flarex-protocol/auth";

import type { FlarexMetadataDatabase } from "./deployments";
import { jsonbNotNullValue } from "./jsonbNotNullValue";
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
  identityJson?: ExecutionIdentity;
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

export interface RecordLiveQueryRerunFailureInput
  extends LiveQuerySubscriptionKey {
  delivery?: Omit<
    InsertLiveQueryDeliveryInput,
    keyof LiveQuerySubscriptionKey | "payloadJson"
  > & {
    payloadJson: LiveQueryDeliveryFailedChange;
  };
}

export interface RecordLiveQueryRerunFailureResult {
  deleted: number;
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
      argsJson: jsonbNotNullValue(input.argsJson),
      identityJson: input.identityJson ?? { kind: "anonymous" },
      partitionKey: input.partitionKey ?? null,
      beginTs: input.beginTs,
      readSetJson: input.readSetJson,
      resultJson: jsonbNotNullValue(input.resultJson),
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
        argsJson: jsonbNotNullValue(input.argsJson),
        identityJson: input.identityJson ?? { kind: "anonymous" },
        partitionKey: input.partitionKey ?? null,
        beginTs: input.beginTs,
        readSetJson: input.readSetJson,
        resultJson: jsonbNotNullValue(input.resultJson),
        resultHash: input.resultHash,
        updatedAt: input.updatedAt ?? sql`current_timestamp`,
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

export async function recordLiveQueryRerunFailure(
  db: FlarexMetadataDatabase,
  input: RecordLiveQueryRerunFailureInput,
): Promise<RecordLiveQueryRerunFailureResult> {
  const deleted = await deleteLiveQuerySubscription(db, input);
  const delivery =
    input.delivery === undefined
      ? null
      : await insertLiveQueryDelivery(db, {
          deploymentId: input.deploymentId,
          connectionId: input.connectionId,
          queryId: input.queryId,
          ...input.delivery,
        });
  return {
    deleted: deleted.deleted,
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

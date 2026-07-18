import { and, asc, eq, gt, isNull, or } from "drizzle-orm";

import { outbox } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import type { CommittedDocumentWriteRecord } from "./commits";
import { uniqueSorted } from "./uniqueSorted";

export interface CommitOutboxEvent {
  [key: string]: unknown;
  type: "commit";
  deploymentId: string;
  commitTs: number;
  source: string;
  changedTableIds: number[];
  changedDocumentIds: string[];
  writeSummary: {
    writes: CommittedDocumentWriteRecord[];
  };
}

export interface InsertOutboxEventInput {
  deploymentId: string;
  ts: number;
  sequence: number;
  event: CommitOutboxEvent;
}

export interface OutboxEventCursor {
  ts: number;
  sequence: number;
}

export interface ListOutboxEventsInput {
  deploymentId: string;
  cursor?: OutboxEventCursor;
  limit: number;
}

export interface ListOutboxEventsResult {
  events: OutboxEventRecord[];
  nextCursor: OutboxEventCursor | null;
  hasMore: boolean;
}

export interface ListUndeliveredOutboxEventsInput {
  deploymentId: string;
  cursor?: OutboxEventCursor;
  limit: number;
}

export interface MarkOutboxEventsDeliveredInput {
  deploymentId: string;
  events: OutboxEventCursor[];
  deliveredAt: Date;
}

export interface MarkOutboxEventsDeliveredResult {
  delivered: number;
}

export type OutboxEventRecord = typeof outbox.$inferSelect;

export function commitOutboxEvent(input: {
  deploymentId: string;
  commitTs: number;
  source: string;
  writes: CommittedDocumentWriteRecord[];
}): CommitOutboxEvent {
  return {
    type: "commit",
    deploymentId: input.deploymentId,
    commitTs: input.commitTs,
    source: input.source,
    changedTableIds: uniqueSorted(input.writes.map((write) => write.tableId)),
    changedDocumentIds: uniqueSorted(input.writes.map((write) => write.id)),
    writeSummary: {
      writes: input.writes,
    },
  };
}

export async function insertOutboxEvent(
  db: FlarexMetadataDatabase,
  input: InsertOutboxEventInput,
): Promise<OutboxEventRecord> {
  const rows = await db
    .insert(outbox)
    .values({
      deploymentId: input.deploymentId,
      ts: input.ts,
      sequence: input.sequence,
      event: input.event,
    })
    .returning();

  const event = rows[0];
  if (event === undefined) {
    throw new Error(
      `Failed to insert outbox event: ${input.deploymentId}@${input.ts}/${input.sequence}`,
    );
  }
  return event;
}

export async function listOutboxEvents(
  db: FlarexMetadataDatabase,
  input: ListOutboxEventsInput,
): Promise<ListOutboxEventsResult> {
  return await listOutboxEventsInternal(db, {
    deploymentId: input.deploymentId,
    limit: input.limit,
    undeliveredOnly: false,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export async function listUndeliveredOutboxEvents(
  db: FlarexMetadataDatabase,
  input: ListUndeliveredOutboxEventsInput,
): Promise<ListOutboxEventsResult> {
  return await listOutboxEventsInternal(db, {
    deploymentId: input.deploymentId,
    limit: input.limit,
    undeliveredOnly: true,
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  });
}

export async function markOutboxEventsDelivered(
  db: FlarexMetadataDatabase,
  input: MarkOutboxEventsDeliveredInput,
): Promise<MarkOutboxEventsDeliveredResult> {
  if (input.events.length === 0) {
    return { delivered: 0 };
  }

  const eventFilter = or(
    ...input.events.map((event) =>
      and(eq(outbox.ts, event.ts), eq(outbox.sequence, event.sequence)),
    ),
  );
  const rows = await db
    .update(outbox)
    .set({
      deliveredAt: input.deliveredAt,
    })
    .where(
      and(
        eq(outbox.deploymentId, input.deploymentId),
        isNull(outbox.deliveredAt),
        eventFilter,
      ),
    )
    .returning();

  return {
    delivered: rows.length,
  };
}

async function listOutboxEventsInternal(
  db: FlarexMetadataDatabase,
  input: ListOutboxEventsInput & { undeliveredOnly: boolean },
): Promise<ListOutboxEventsResult> {
  const cursorFilter =
    input.cursor === undefined
      ? undefined
      : or(
          gt(outbox.ts, input.cursor.ts),
          and(
            eq(outbox.ts, input.cursor.ts),
            gt(outbox.sequence, input.cursor.sequence),
          ),
        );
  const baseFilter = input.undeliveredOnly
    ? and(eq(outbox.deploymentId, input.deploymentId), isNull(outbox.deliveredAt))
    : eq(outbox.deploymentId, input.deploymentId);

  const rows = await db
    .select()
    .from(outbox)
    .where(
      cursorFilter === undefined
        ? baseFilter
        : and(baseFilter, cursorFilter),
    )
    .orderBy(asc(outbox.ts), asc(outbox.sequence))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const events = rows.slice(0, input.limit);
  const last = events.at(-1);
  return {
    events,
    nextCursor:
      hasMore && last !== undefined
        ? {
            ts: last.ts,
            sequence: last.sequence,
          }
        : null,
    hasMore,
  };
}

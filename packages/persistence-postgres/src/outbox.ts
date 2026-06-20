import { and, asc, eq, gt, or } from "drizzle-orm";

import { outbox } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import type { CommittedDocumentWriteRecord } from "./commits";

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

  const rows = await db
    .select()
    .from(outbox)
    .where(
      cursorFilter === undefined
        ? eq(outbox.deploymentId, input.deploymentId)
        : and(eq(outbox.deploymentId, input.deploymentId), cursorFilter),
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

function uniqueSorted<T extends string | number>(values: T[]): T[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

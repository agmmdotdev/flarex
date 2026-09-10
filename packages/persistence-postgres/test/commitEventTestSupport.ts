import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { CommitEventQuery } from "../src/commitEvents/store";
import { withPostgresSequentialScansDisabled } from "./postgresHelpers";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { fxSystemCommits } from "../src/schema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../src/commitEvents/schema";

export const expireEventClaims = (db: FlarexMetadataDatabase, commit: CommitSeq) => db.update(fxSystemCommitEventDeliveries)
  .set({ leaseExpiresAt: sql`clock_timestamp() - interval '1 second'` })
  .where(and(eq(fxSystemCommitEventDeliveries.commitSeq, commit), eq(fxSystemCommitEventDeliveries.state, "claimed")));
export const makeEventRetriesDue = (db: FlarexMetadataDatabase, commit: CommitSeq) => db.update(fxSystemCommitEventDeliveries)
  .set({ nextAttemptAt: sql`clock_timestamp() - interval '1 second'` })
  .where(and(eq(fxSystemCommitEventDeliveries.commitSeq, commit), eq(fxSystemCommitEventDeliveries.state, "pending")));
export const corruptEventCount = (db: FlarexMetadataDatabase, commit: CommitSeq, eventCount: number) => db.update(fxSystemCommits)
  .set({ eventCount }).where(eq(fxSystemCommits.commitSeq, commit));

export const replaceEventEnvelope = (db: FlarexMetadataDatabase, row: typeof fxSystemCommitEvents.$inferSelect) => db.update(fxSystemCommitEvents)
  .set({ envelope: row.envelope }).where(and(eq(fxSystemCommitEvents.scopeUuid, row.scopeUuid), eq(fxSystemCommitEvents.epochUuid, row.epochUuid), eq(fxSystemCommitEvents.commitSeq, row.commitSeq), eq(fxSystemCommitEvents.eventOrdinal, row.eventOrdinal)));

/** Header-only query-plan fixture, rolled back before returning. It does not
 * claim these synthetic families or represent them as real published events. */
export const explainSparseEventDirectory = (persistence: PostgresFlarexPersistence, query: CommitEventQuery,
  latest: typeof fxSystemCommits.$inferSelect) => withPostgresSequentialScansDisabled(persistence, async client => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ ...latest,
    commitSeq: CommitSeqSchema.make(latest.commitSeq + BigInt(index + 1)), changeCount: 0,
    relationAdjacencyChangeCount: 0, payloadPreferenceDeletionCount: 0, relationalChangeCount: 0,
    eventCount: index === 999 ? 1 : 0, eventSha256: index === 999 ? "a".repeat(64) : null,
  }));
  await drizzle(client).insert(fxSystemCommits).values(rows);
  const explained = await client.query(`explain (analyze, buffers, format json) ${query.sql}`, [...query.params]);
  return JSON.stringify(explained.rows);
});

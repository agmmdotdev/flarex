import { and, eq, inArray, lte } from "drizzle-orm";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  documentFreshnessVersions,
  freshnessProcessedEvents,
  tableFreshnessVersions,
} from "./schema";
import { uniqueSorted } from "./uniqueSorted";

export interface FreshnessOutboxEventKey {
  deploymentId: string;
  ts: number;
  sequence: number;
}

export interface ApplyFreshnessCommitInput {
  eventKey: FreshnessOutboxEventKey;
  commitTs: number;
  documentIds: string[];
  tableIds: number[];
  processedAt?: Date;
}

export interface DocumentFreshnessVersionRecord {
  deploymentId: string;
  documentId: string;
  version: number;
  outboxTs: number;
  outboxSequence: number;
}

export interface TableFreshnessVersionRecord {
  deploymentId: string;
  tableId: number;
  version: number;
  outboxTs: number;
  outboxSequence: number;
}

export interface ApplyFreshnessCommitResult {
  applied: boolean;
  documentVersions: DocumentFreshnessVersionRecord[];
  tableVersions: TableFreshnessVersionRecord[];
}

export type FreshnessProcessedEventRecord =
  typeof freshnessProcessedEvents.$inferSelect;

export async function applyFreshnessCommit(
  db: FlarexMetadataDatabase,
  input: ApplyFreshnessCommitInput,
): Promise<ApplyFreshnessCommitResult> {
  const eventRows = await db
    .insert(freshnessProcessedEvents)
    .values({
      deploymentId: input.eventKey.deploymentId,
      ts: input.eventKey.ts,
      sequence: input.eventKey.sequence,
      ...(input.processedAt === undefined
        ? {}
        : { processedAt: input.processedAt }),
    })
    .onConflictDoNothing()
    .returning();
  if (eventRows.length === 0) {
    return {
      applied: false,
      documentVersions: [],
      tableVersions: [],
    };
  }

  const documentIds = uniqueSorted(input.documentIds);
  const tableIds = uniqueSorted(input.tableIds);

  await upsertDocumentFreshnessVersions(db, input, documentIds);
  await upsertTableFreshnessVersions(db, input, tableIds);

  return {
    applied: true,
    documentVersions: await listDocumentFreshnessVersions(db, {
      deploymentId: input.eventKey.deploymentId,
      documentIds,
    }),
    tableVersions: await listTableFreshnessVersions(db, {
      deploymentId: input.eventKey.deploymentId,
      tableIds,
    }),
  };
}

export async function getFreshnessProcessedEvent(
  db: FlarexMetadataDatabase,
  input: FreshnessOutboxEventKey,
): Promise<FreshnessProcessedEventRecord | null> {
  const rows = await db
    .select()
    .from(freshnessProcessedEvents)
    .where(
      and(
        eq(freshnessProcessedEvents.deploymentId, input.deploymentId),
        eq(freshnessProcessedEvents.ts, input.ts),
        eq(freshnessProcessedEvents.sequence, input.sequence),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getDocumentFreshnessVersion(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  documentId: string,
): Promise<DocumentFreshnessVersionRecord | null> {
  const rows = await listDocumentFreshnessVersions(db, {
    deploymentId,
    documentIds: [documentId],
  });
  return rows[0] ?? null;
}

export async function getTableFreshnessVersion(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  tableId: number,
): Promise<TableFreshnessVersionRecord | null> {
  const rows = await listTableFreshnessVersions(db, {
    deploymentId,
    tableIds: [tableId],
  });
  return rows[0] ?? null;
}

async function upsertDocumentFreshnessVersions(
  db: FlarexMetadataDatabase,
  input: ApplyFreshnessCommitInput,
  documentIds: string[],
): Promise<void> {
  if (documentIds.length === 0) return;

  await db
    .insert(documentFreshnessVersions)
    .values(
      documentIds.map((documentId) => ({
        deploymentId: input.eventKey.deploymentId,
        documentId,
        version: input.commitTs,
        outboxTs: input.eventKey.ts,
        outboxSequence: input.eventKey.sequence,
      })),
    )
    .onConflictDoUpdate({
      target: [
        documentFreshnessVersions.deploymentId,
        documentFreshnessVersions.documentId,
      ],
      set: {
        version: input.commitTs,
        outboxTs: input.eventKey.ts,
        outboxSequence: input.eventKey.sequence,
      },
      where: lte(documentFreshnessVersions.version, input.commitTs),
    });
}

async function upsertTableFreshnessVersions(
  db: FlarexMetadataDatabase,
  input: ApplyFreshnessCommitInput,
  tableIds: number[],
): Promise<void> {
  if (tableIds.length === 0) return;

  await db
    .insert(tableFreshnessVersions)
    .values(
      tableIds.map((tableId) => ({
        deploymentId: input.eventKey.deploymentId,
        tableId,
        version: input.commitTs,
        outboxTs: input.eventKey.ts,
        outboxSequence: input.eventKey.sequence,
      })),
    )
    .onConflictDoUpdate({
      target: [
        tableFreshnessVersions.deploymentId,
        tableFreshnessVersions.tableId,
      ],
      set: {
        version: input.commitTs,
        outboxTs: input.eventKey.ts,
        outboxSequence: input.eventKey.sequence,
      },
      where: lte(tableFreshnessVersions.version, input.commitTs),
    });
}

async function listDocumentFreshnessVersions(
  db: FlarexMetadataDatabase,
  input: {
    deploymentId: string;
    documentIds: string[];
  },
): Promise<DocumentFreshnessVersionRecord[]> {
  if (input.documentIds.length === 0) return [];
  const rows = await db
    .select()
    .from(documentFreshnessVersions)
    .where(
      and(
        eq(documentFreshnessVersions.deploymentId, input.deploymentId),
        inArray(documentFreshnessVersions.documentId, input.documentIds),
      ),
    );
  return rows.map((row) => ({
    deploymentId: row.deploymentId,
    documentId: row.documentId,
    version: row.version,
    outboxTs: row.outboxTs,
    outboxSequence: row.outboxSequence,
  }));
}

async function listTableFreshnessVersions(
  db: FlarexMetadataDatabase,
  input: {
    deploymentId: string;
    tableIds: number[];
  },
): Promise<TableFreshnessVersionRecord[]> {
  if (input.tableIds.length === 0) return [];
  const rows = await db
    .select()
    .from(tableFreshnessVersions)
    .where(
      and(
        eq(tableFreshnessVersions.deploymentId, input.deploymentId),
        inArray(tableFreshnessVersions.tableId, input.tableIds),
      ),
    );
  return rows.map((row) => ({
    deploymentId: row.deploymentId,
    tableId: row.tableId,
    version: row.version,
    outboxTs: row.outboxTs,
    outboxSequence: row.outboxSequence,
  }));
}

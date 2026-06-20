import { and, desc, eq } from "drizzle-orm";

import { commits, documents } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import type { PersistenceJson } from "./documents";
import {
  getDocumentRevisionAtTs,
  insertDocumentRevision,
} from "./documents";
import { finishInvokeSessionMetadata } from "./invokeSessions";
import { listInvokeSessionDocumentReads } from "./invokeSessionReads";
import { listInvokeSessionDocumentWrites } from "./invokeSessionWrites";

export interface CommitInvokeSessionInsertsInput {
  deploymentId: string;
  sessionId: string;
  source: string;
  finishedAt: Date;
  minimumTs: number;
}

export interface CommittedDocumentWriteRecord {
  tableId: number;
  id: string;
  prevTs: number | null;
  ts: number;
  value: PersistenceJson | null;
}

export interface CommitInvokeSessionInsertsResult {
  committedTs: number;
  writes: CommittedDocumentWriteRecord[];
}

export class InvokeSessionUnsupportedStagedWriteError extends Error {
  constructor(readonly op: string) {
    super(`Unsupported staged invoke session write op: ${op}`);
    this.name = "InvokeSessionUnsupportedStagedWriteError";
  }
}

export class InvokeSessionInsertConflictError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly documentId: string,
  ) {
    super(`Cannot insert existing document: ${deploymentId}/${documentId}`);
    this.name = "InvokeSessionInsertConflictError";
  }
}

export class InvokeSessionOccConflictError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly documentId: string,
    readonly observedTs: number | null,
    readonly currentTs: number | null,
  ) {
    super(
      `OCC conflict for ${deploymentId}/${documentId}: observed ${observedTs}, current ${currentTs}`,
    );
    this.name = "InvokeSessionOccConflictError";
  }
}

export async function commitInvokeSessionInserts(
  db: FlarexMetadataDatabase,
  input: CommitInvokeSessionInsertsInput,
): Promise<CommitInvokeSessionInsertsResult> {
  const stagedWrites = await listInvokeSessionDocumentWrites(
    db,
    input.deploymentId,
    input.sessionId,
  );
  const committedTs = await nextCommitTs(
    db,
    input.deploymentId,
    input.minimumTs,
  );
  const committedWrites: CommittedDocumentWriteRecord[] = [];

  await validateDocumentReads(db, input, committedTs);

  for (const write of stagedWrites) {
    if (write.op !== "insert") {
      throw new InvokeSessionUnsupportedStagedWriteError(write.op);
    }
    const existing = await getDocumentRevisionAtTs(
      db,
      input.deploymentId,
      write.documentId,
      committedTs,
    );
    if (existing !== null) {
      throw new InvokeSessionInsertConflictError(
        input.deploymentId,
        write.documentId,
      );
    }
    const value = write.valueJson as PersistenceJson;
    await insertDocumentRevision(db, {
      deploymentId: input.deploymentId,
      id: write.documentId,
      ts: committedTs,
      value,
      prevTs: null,
    });
    committedWrites.push({
      tableId: write.tableId,
      id: write.documentId,
      prevTs: null,
      ts: committedTs,
      value,
    });
  }

  await db.insert(commits).values({
    deploymentId: input.deploymentId,
    ts: committedTs,
    source: input.source,
    writeSummary: {
      writes: committedWrites,
    },
  });
  await finishInvokeSessionMetadata(db, {
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    finishedAt: input.finishedAt,
  });

  return {
    committedTs,
    writes: committedWrites,
  };
}

async function validateDocumentReads(
  db: FlarexMetadataDatabase,
  input: CommitInvokeSessionInsertsInput,
  commitTs: number,
): Promise<void> {
  const reads = await listInvokeSessionDocumentReads(
    db,
    input.deploymentId,
    input.sessionId,
  );
  for (const read of reads) {
    const current = await getDocumentRevisionAtTs(
      db,
      input.deploymentId,
      read.documentId,
      commitTs,
    );
    const currentTs = current?.ts ?? null;
    if (currentTs !== read.observedTs) {
      throw new InvokeSessionOccConflictError(
        input.deploymentId,
        read.documentId,
        read.observedTs,
        currentTs,
      );
    }
  }
}

async function nextCommitTs(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  minimumTs: number,
): Promise<number> {
  const rows = await db
    .select({ ts: commits.ts })
    .from(commits)
    .where(and(eq(commits.deploymentId, deploymentId)))
    .orderBy(desc(commits.ts))
    .limit(1);
  const documentRows = await db
    .select({ ts: documents.ts })
    .from(documents)
    .where(and(eq(documents.deploymentId, deploymentId)))
    .orderBy(desc(documents.ts))
    .limit(1);
  const latestTs = Math.max(rows[0]?.ts ?? 0, documentRows[0]?.ts ?? 0);
  return Math.max(latestTs, minimumTs) + 1;
}

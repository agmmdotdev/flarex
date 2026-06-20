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

export interface CommitInvokeSessionWritesInput {
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

export interface CommitInvokeSessionWritesResult {
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

export class InvokeSessionPatchTargetError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly documentId: string,
    readonly reason: string,
  ) {
    super(`Cannot patch document ${deploymentId}/${documentId}: ${reason}`);
    this.name = "InvokeSessionPatchTargetError";
  }
}

export class InvokeSessionDeleteTargetError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly documentId: string,
    readonly reason: string,
  ) {
    super(`Cannot delete document ${deploymentId}/${documentId}: ${reason}`);
    this.name = "InvokeSessionDeleteTargetError";
  }
}

export async function commitInvokeSessionWrites(
  db: FlarexMetadataDatabase,
  input: CommitInvokeSessionWritesInput,
): Promise<CommitInvokeSessionWritesResult> {
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
    if (write.op === "insert") {
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
      continue;
    }

    if (write.op === "patch") {
      const current = await getDocumentRevisionAtTs(
        db,
        input.deploymentId,
        write.documentId,
        committedTs,
      );
      if (current === null || current.deleted) {
        throw new InvokeSessionPatchTargetError(
          input.deploymentId,
          write.documentId,
          "document does not exist",
        );
      }
      if (!isJsonObject(current.value)) {
        throw new InvokeSessionPatchTargetError(
          input.deploymentId,
          write.documentId,
          "current document value is not an object",
        );
      }
      if (!isJsonObject(write.valueJson)) {
        throw new InvokeSessionPatchTargetError(
          input.deploymentId,
          write.documentId,
          "patch value is not an object",
        );
      }
      const value: PersistenceJson = {
        ...current.value,
        ...write.valueJson,
      };
      await insertDocumentRevision(db, {
        deploymentId: input.deploymentId,
        id: write.documentId,
        ts: committedTs,
        value,
        prevTs: current.ts,
      });
      committedWrites.push({
        tableId: write.tableId,
        id: write.documentId,
        prevTs: current.ts,
        ts: committedTs,
        value,
      });
      continue;
    }

    if (write.op === "delete") {
      const current = await getDocumentRevisionAtTs(
        db,
        input.deploymentId,
        write.documentId,
        committedTs,
      );
      if (current === null || current.deleted) {
        throw new InvokeSessionDeleteTargetError(
          input.deploymentId,
          write.documentId,
          "document does not exist",
        );
      }
      await insertDocumentRevision(db, {
        deploymentId: input.deploymentId,
        id: write.documentId,
        ts: committedTs,
        value: null,
        deleted: true,
        prevTs: current.ts,
      });
      committedWrites.push({
        tableId: write.tableId,
        id: write.documentId,
        prevTs: current.ts,
        ts: committedTs,
        value: null,
      });
      continue;
    }

    throw new InvokeSessionUnsupportedStagedWriteError(write.op);
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

function isJsonObject(value: unknown): value is Record<string, PersistenceJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function validateDocumentReads(
  db: FlarexMetadataDatabase,
  input: CommitInvokeSessionWritesInput,
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

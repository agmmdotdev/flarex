import { and, desc, eq } from "drizzle-orm";
import { isWritableJsonObject } from "flarex-protocol/json";

import { commits, documents, leases } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import type { PersistenceJson } from "./documents";
import {
  getDocumentRevisionAtTs,
  hasDocumentRevisionInTableBetweenTs,
  insertDocumentRevision,
} from "./documents";
import { getDeploymentPackageMetadata } from "./deploymentPackages";
import {
  finishInvokeSessionMetadata,
  getInvokeSessionMetadata,
} from "./invokeSessions";
import {
  hasIndexEntryBetweenTs,
  insertIndexEntriesForDocumentWrites,
  schemaIndexesFromAnalysis,
} from "./indexEntries";
import { listInvokeSessionDocumentReads } from "./invokeSessionReads";
import { listInvokeSessionIndexReads } from "./invokeSessionIndexReads";
import { listInvokeSessionTableReads } from "./invokeSessionTableReads";
import { listInvokeSessionDocumentWrites } from "./invokeSessionWrites";
import { commitOutboxEvent, insertOutboxEvent } from "./outbox";
import type { FlarexRuntimePersistenceTransaction } from
  "./runtimePersistenceTransaction";
import {
  schemaTableValidatorsFromAnalysis,
  validateDocumentValue,
} from "./validation";

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

interface PlannedDocumentWrite {
  tableId: number;
  id: string;
  prevTs: number | null;
  ts: number;
  previousValue: PersistenceJson | null;
  value: PersistenceJson | null;
  deleted: boolean;
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

export class InvokeSessionTableOccConflictError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly tableId: number,
    readonly observedTs: number,
    readonly currentTs: number,
  ) {
    super(
      `OCC conflict for ${deploymentId}/table ${tableId}: observed ${observedTs}, current ${currentTs}`,
    );
    this.name = "InvokeSessionTableOccConflictError";
  }
}

export class InvokeSessionIndexOccConflictError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly indexId: number,
    readonly observedTs: number,
    readonly currentTs: number,
  ) {
    super(
      `OCC conflict for ${deploymentId}/index ${indexId}: observed ${observedTs}, current ${currentTs}`,
    );
    this.name = "InvokeSessionIndexOccConflictError";
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

export class InvokeSessionReplaceTargetError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly documentId: string,
    readonly reason: string,
  ) {
    super(`Cannot replace document ${deploymentId}/${documentId}: ${reason}`);
    this.name = "InvokeSessionReplaceTargetError";
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

export async function commitInvokeSessionWritesInTransaction(
  transaction: FlarexRuntimePersistenceTransaction,
  input: CommitInvokeSessionWritesInput,
): Promise<CommitInvokeSessionWritesResult> {
  const db = transaction.drizzle;
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

  await validateDocumentReads(db, input, committedTs);
  await validateTableReads(db, input, committedTs);
  await validateIndexReads(db, input, committedTs);

  const tableValidators = await tableValidatorsForSession(db, input);
  const plannedWrites: PlannedDocumentWrite[] = [];

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
      // SAFETY: insert and replace staged writes store a validated
      // persistence JSON document value.
      const value = write.valueJson as PersistenceJson;
      validateDocumentValue(
        tableValidators,
        write.tableId,
        write.documentId,
        value,
      );
      plannedWrites.push({
        tableId: write.tableId,
        id: write.documentId,
        prevTs: null,
        ts: committedTs,
        previousValue: null,
        value,
        deleted: false,
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
      if (!isWritableJsonObject(current.value)) {
        throw new InvokeSessionPatchTargetError(
          input.deploymentId,
          write.documentId,
          "current document value is not an object",
        );
      }
      const value: PersistenceJson = {
        ...current.value,
        ...write.valueJson,
      };
      validateDocumentValue(
        tableValidators,
        write.tableId,
        write.documentId,
        value,
      );
      plannedWrites.push({
        tableId: write.tableId,
        id: write.documentId,
        prevTs: current.ts,
        ts: committedTs,
        previousValue: current.value,
        value,
        deleted: false,
      });
      continue;
    }

    if (write.op === "replace") {
      const current = await getDocumentRevisionAtTs(
        db,
        input.deploymentId,
        write.documentId,
        committedTs,
      );
      if (current === null || current.deleted) {
        throw new InvokeSessionReplaceTargetError(
          input.deploymentId,
          write.documentId,
          "document does not exist",
        );
      }
      // SAFETY: insert and replace staged writes store a validated
      // persistence JSON document value.
      const value = write.valueJson as PersistenceJson;
      validateDocumentValue(
        tableValidators,
        write.tableId,
        write.documentId,
        value,
      );
      plannedWrites.push({
        tableId: write.tableId,
        id: write.documentId,
        prevTs: current.ts,
        ts: committedTs,
        previousValue: current.value,
        value,
        deleted: false,
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
      plannedWrites.push({
        tableId: write.tableId,
        id: write.documentId,
        prevTs: current.ts,
        ts: committedTs,
        previousValue: current.value,
        value: null,
        deleted: true,
      });
      continue;
    }

    throw new InvokeSessionUnsupportedStagedWriteError(write.op);
  }

  for (const write of plannedWrites) {
    await insertDocumentRevision(db, {
      deploymentId: input.deploymentId,
      id: write.id,
      ts: write.ts,
      value: write.value,
      deleted: write.deleted,
      prevTs: write.prevTs,
    });
  }

  await insertIndexEntriesForDocumentWrites(db, {
    deploymentId: input.deploymentId,
    indexes: await tableIndexesForSession(db, input),
    writes: plannedWrites,
  });

  const committedWrites = plannedWrites.map(
    (write): CommittedDocumentWriteRecord => ({
      tableId: write.tableId,
      id: write.id,
      prevTs: write.prevTs,
      ts: write.ts,
      value: write.value,
    }),
  );

  await db.insert(commits).values({
    deploymentId: input.deploymentId,
    ts: committedTs,
    source: input.source,
    writeSummary: {
      writes: committedWrites,
    },
  });
  await insertOutboxEvent(db, {
    deploymentId: input.deploymentId,
    ts: committedTs,
    sequence: 0,
    event: commitOutboxEvent({
      deploymentId: input.deploymentId,
      commitTs: committedTs,
      source: input.source,
      writes: committedWrites,
    }),
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

async function tableValidatorsForSession(
  db: FlarexMetadataDatabase,
  input: CommitInvokeSessionWritesInput,
) {
  const session = await getInvokeSessionMetadata(
    db,
    input.deploymentId,
    input.sessionId,
  );
  if (session === null) return [];
  const deploymentPackage = await getDeploymentPackageMetadata(
    db,
    input.deploymentId,
    session.packageId,
  );
  if (deploymentPackage === null) return [];
  return schemaTableValidatorsFromAnalysis(deploymentPackage.analysisJson);
}

async function tableIndexesForSession(
  db: FlarexMetadataDatabase,
  input: CommitInvokeSessionWritesInput,
) {
  const session = await getInvokeSessionMetadata(
    db,
    input.deploymentId,
    input.sessionId,
  );
  if (session === null) return [];
  const deploymentPackage = await getDeploymentPackageMetadata(
    db,
    input.deploymentId,
    session.packageId,
  );
  if (deploymentPackage === null) return [];
  return schemaIndexesFromAnalysis(deploymentPackage.analysisJson);
}

async function validateTableReads(
  db: FlarexMetadataDatabase,
  input: CommitInvokeSessionWritesInput,
  commitTs: number,
): Promise<void> {
  const reads = await listInvokeSessionTableReads(
    db,
    input.deploymentId,
    input.sessionId,
  );
  for (const read of reads) {
    const changed = await hasDocumentRevisionInTableBetweenTs(
      db,
      input.deploymentId,
      read.tableId,
      read.observedTs,
      commitTs,
    );
    if (changed) {
      throw new InvokeSessionTableOccConflictError(
        input.deploymentId,
        read.tableId,
        read.observedTs,
        commitTs - 1,
      );
    }
  }
}

async function validateIndexReads(
  db: FlarexMetadataDatabase,
  input: CommitInvokeSessionWritesInput,
  commitTs: number,
): Promise<void> {
  const reads = await listInvokeSessionIndexReads(
    db,
    input.deploymentId,
    input.sessionId,
  );
  for (const read of reads) {
    const changed = await hasIndexEntryBetweenTs(db, {
      deploymentId: input.deploymentId,
      indexId: read.indexId,
      afterTs: read.observedTs,
      beforeTs: commitTs,
      ...(read.lowerKey === "" ? {} : { lower: read.lowerKey }),
      ...(read.upperKey === "" ? {} : { upper: read.upperKey }),
    });
    if (changed) {
      throw new InvokeSessionIndexOccConflictError(
        input.deploymentId,
        read.indexId,
        read.observedTs,
        commitTs - 1,
      );
    }
  }
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
  await db
    .insert(leases)
    .values({ deploymentId, ts: 0 })
    .onConflictDoNothing({ target: leases.deploymentId });

  const leaseRows = await db
    .select({ ts: leases.ts })
    .from(leases)
    .where(eq(leases.deploymentId, deploymentId))
    .for("update")
    .limit(1);
  const leaseTs = leaseRows[0]?.ts ?? 0;
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
  const latestTs = Math.max(
    leaseTs,
    rows[0]?.ts ?? 0,
    documentRows[0]?.ts ?? 0,
    minimumTs,
  );
  const nextTs = latestTs + 1;
  await db
    .update(leases)
    .set({ ts: nextTs })
    .where(eq(leases.deploymentId, deploymentId));
  return nextTs;
}

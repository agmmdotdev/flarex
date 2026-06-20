import { and, asc, eq } from "drizzle-orm";

import { invokeSessionDocumentWrites } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import type { PersistenceJson } from "./documents";

export type InvokeSessionDocumentWriteOp = "insert" | "patch" | "delete";

export interface InsertInvokeSessionDocumentWriteInput {
  deploymentId: string;
  sessionId: string;
  tableId: number;
  documentId: string;
  op: InvokeSessionDocumentWriteOp;
  valueJson?: PersistenceJson | null;
}

export type InvokeSessionDocumentWriteRecord =
  typeof invokeSessionDocumentWrites.$inferSelect;

export class InvokeSessionDocumentWriteAlreadyExistsError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly sessionId: string,
    readonly documentId: string,
  ) {
    super(
      `Invoke session document write already exists: ${deploymentId}/${sessionId}/${documentId}`,
    );
    this.name = "InvokeSessionDocumentWriteAlreadyExistsError";
  }
}

export async function insertInvokeSessionDocumentWrite(
  db: FlarexMetadataDatabase,
  input: InsertInvokeSessionDocumentWriteInput,
): Promise<InvokeSessionDocumentWriteRecord> {
  const rows = await db
    .insert(invokeSessionDocumentWrites)
    .values({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: input.tableId,
      documentId: input.documentId,
      op: input.op,
      valueJson: input.valueJson ?? null,
    })
    .onConflictDoNothing({
      target: [
        invokeSessionDocumentWrites.deploymentId,
        invokeSessionDocumentWrites.sessionId,
        invokeSessionDocumentWrites.tableId,
        invokeSessionDocumentWrites.documentId,
      ],
    })
    .returning();

  const write = rows[0];
  if (write === undefined) {
    throw new InvokeSessionDocumentWriteAlreadyExistsError(
      input.deploymentId,
      input.sessionId,
      input.documentId,
    );
  }
  return write;
}

export async function listInvokeSessionDocumentWrites(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  sessionId: string,
): Promise<InvokeSessionDocumentWriteRecord[]> {
  return db
    .select()
    .from(invokeSessionDocumentWrites)
    .where(
      and(
        eq(invokeSessionDocumentWrites.deploymentId, deploymentId),
        eq(invokeSessionDocumentWrites.sessionId, sessionId),
      ),
    )
    .orderBy(
      asc(invokeSessionDocumentWrites.stagedAt),
      asc(invokeSessionDocumentWrites.tableId),
      asc(invokeSessionDocumentWrites.documentId),
    );
}

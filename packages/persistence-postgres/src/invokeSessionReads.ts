import { and, asc, eq } from "drizzle-orm";

import { invokeSessionDocumentReads } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";

export interface InsertInvokeSessionDocumentReadInput {
  deploymentId: string;
  sessionId: string;
  tableId: number;
  documentId: string;
  observedTs?: number | null;
}

export type InvokeSessionDocumentReadRecord =
  typeof invokeSessionDocumentReads.$inferSelect;

export async function insertInvokeSessionDocumentRead(
  db: FlarexMetadataDatabase,
  input: InsertInvokeSessionDocumentReadInput,
): Promise<InvokeSessionDocumentReadRecord> {
  const rows = await db
    .insert(invokeSessionDocumentReads)
    .values({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: input.tableId,
      documentId: input.documentId,
      observedTs: input.observedTs ?? null,
    })
    .onConflictDoNothing({
      target: [
        invokeSessionDocumentReads.deploymentId,
        invokeSessionDocumentReads.sessionId,
        invokeSessionDocumentReads.tableId,
        invokeSessionDocumentReads.documentId,
      ],
    })
    .returning();

  const inserted = rows[0];
  if (inserted !== undefined) {
    return inserted;
  }

  const existing = await getInvokeSessionDocumentRead(
    db,
    input.deploymentId,
    input.sessionId,
    input.tableId,
    input.documentId,
  );
  if (existing === null) {
    throw new Error(
      `Failed to insert or load invoke session document read: ${input.deploymentId}/${input.sessionId}/${input.documentId}`,
    );
  }
  return existing;
}

export async function listInvokeSessionDocumentReads(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  sessionId: string,
): Promise<InvokeSessionDocumentReadRecord[]> {
  return db
    .select()
    .from(invokeSessionDocumentReads)
    .where(
      and(
        eq(invokeSessionDocumentReads.deploymentId, deploymentId),
        eq(invokeSessionDocumentReads.sessionId, sessionId),
      ),
    )
    .orderBy(
      asc(invokeSessionDocumentReads.tableId),
      asc(invokeSessionDocumentReads.documentId),
    );
}

async function getInvokeSessionDocumentRead(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  sessionId: string,
  tableId: number,
  documentId: string,
): Promise<InvokeSessionDocumentReadRecord | null> {
  const rows = await db
    .select()
    .from(invokeSessionDocumentReads)
    .where(
      and(
        eq(invokeSessionDocumentReads.deploymentId, deploymentId),
        eq(invokeSessionDocumentReads.sessionId, sessionId),
        eq(invokeSessionDocumentReads.tableId, tableId),
        eq(invokeSessionDocumentReads.documentId, documentId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

import { and, asc, eq } from "drizzle-orm";

import { invokeSessionTableReads } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";

export interface InsertInvokeSessionTableReadInput {
  deploymentId: string;
  sessionId: string;
  tableId: number;
  observedTs: number;
}

export type InvokeSessionTableReadRecord =
  typeof invokeSessionTableReads.$inferSelect;

export async function insertInvokeSessionTableRead(
  db: FlarexMetadataDatabase,
  input: InsertInvokeSessionTableReadInput,
): Promise<InvokeSessionTableReadRecord> {
  const rows = await db
    .insert(invokeSessionTableReads)
    .values({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      tableId: input.tableId,
      observedTs: input.observedTs,
    })
    .onConflictDoNothing({
      target: [
        invokeSessionTableReads.deploymentId,
        invokeSessionTableReads.sessionId,
        invokeSessionTableReads.tableId,
      ],
    })
    .returning();

  if (rows[0] !== undefined) return rows[0];

  const existing = await db
    .select()
    .from(invokeSessionTableReads)
    .where(
      and(
        eq(invokeSessionTableReads.deploymentId, input.deploymentId),
        eq(invokeSessionTableReads.sessionId, input.sessionId),
        eq(invokeSessionTableReads.tableId, input.tableId),
      ),
    )
    .limit(1);

  const read = existing[0];
  if (read === undefined) {
    throw new Error(
      `Failed to read invoke session table read after conflict: ${input.deploymentId}/${input.sessionId}/${input.tableId}`,
    );
  }
  return read;
}

export async function listInvokeSessionTableReads(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  sessionId: string,
): Promise<InvokeSessionTableReadRecord[]> {
  return db
    .select()
    .from(invokeSessionTableReads)
    .where(
      and(
        eq(invokeSessionTableReads.deploymentId, deploymentId),
        eq(invokeSessionTableReads.sessionId, sessionId),
      ),
    )
    .orderBy(asc(invokeSessionTableReads.tableId));
}

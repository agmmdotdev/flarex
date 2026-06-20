import { and, asc, eq } from "drizzle-orm";

import { invokeSessionIndexReads } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";

export interface InsertInvokeSessionIndexReadInput {
  deploymentId: string;
  sessionId: string;
  indexId: number;
  lowerKey?: string;
  upperKey?: string;
  observedTs: number;
}

export type InvokeSessionIndexReadRecord =
  typeof invokeSessionIndexReads.$inferSelect;

export async function insertInvokeSessionIndexRead(
  db: FlarexMetadataDatabase,
  input: InsertInvokeSessionIndexReadInput,
): Promise<InvokeSessionIndexReadRecord> {
  const lowerKey = input.lowerKey ?? "";
  const upperKey = input.upperKey ?? "";
  const rows = await db
    .insert(invokeSessionIndexReads)
    .values({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      indexId: input.indexId,
      lowerKey,
      upperKey,
      observedTs: input.observedTs,
    })
    .onConflictDoNothing({
      target: [
        invokeSessionIndexReads.deploymentId,
        invokeSessionIndexReads.sessionId,
        invokeSessionIndexReads.indexId,
        invokeSessionIndexReads.lowerKey,
        invokeSessionIndexReads.upperKey,
      ],
    })
    .returning();

  if (rows[0] !== undefined) return rows[0];

  const existing = await db
    .select()
    .from(invokeSessionIndexReads)
    .where(
      and(
        eq(invokeSessionIndexReads.deploymentId, input.deploymentId),
        eq(invokeSessionIndexReads.sessionId, input.sessionId),
        eq(invokeSessionIndexReads.indexId, input.indexId),
        eq(invokeSessionIndexReads.lowerKey, lowerKey),
        eq(invokeSessionIndexReads.upperKey, upperKey),
      ),
    )
    .limit(1);

  const read = existing[0];
  if (read === undefined) {
    throw new Error(
      `Failed to read invoke session index read after conflict: ${input.deploymentId}/${input.sessionId}/${input.indexId}`,
    );
  }
  return read;
}

export async function listInvokeSessionIndexReads(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  sessionId: string,
): Promise<InvokeSessionIndexReadRecord[]> {
  return db
    .select()
    .from(invokeSessionIndexReads)
    .where(
      and(
        eq(invokeSessionIndexReads.deploymentId, deploymentId),
        eq(invokeSessionIndexReads.sessionId, sessionId),
      ),
    )
    .orderBy(
      asc(invokeSessionIndexReads.indexId),
      asc(invokeSessionIndexReads.lowerKey),
      asc(invokeSessionIndexReads.upperKey),
    );
}

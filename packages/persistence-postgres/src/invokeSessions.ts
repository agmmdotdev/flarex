import { and, eq } from "drizzle-orm";

import { invokeSessions } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";

export type InvokeSessionState = "active" | "finished" | "aborted";

export interface InsertInvokeSessionMetadataInput {
  deploymentId: string;
  sessionId: string;
  projectId: string;
  packageId: string;
  functionPath: string;
  functionKind: "query" | "mutation";
  partitionKey: string;
  scopeJson: Record<string, unknown>;
  argsJson: unknown;
  idempotencyKey?: string | null;
  state?: InvokeSessionState;
  beginTs: number;
  schemaVersion: number;
  executionModule: string;
}

export interface FinishInvokeSessionMetadataInput {
  deploymentId: string;
  sessionId: string;
  finishedAt: Date;
}

export type InvokeSessionMetadataRecord = typeof invokeSessions.$inferSelect;

export class InvokeSessionMetadataAlreadyExistsError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly sessionId: string,
  ) {
    super(`Invoke session metadata already exists: ${deploymentId}/${sessionId}`);
    this.name = "InvokeSessionMetadataAlreadyExistsError";
  }
}

export async function insertInvokeSessionMetadata(
  db: FlarexMetadataDatabase,
  input: InsertInvokeSessionMetadataInput,
): Promise<InvokeSessionMetadataRecord> {
  const rows = await db
    .insert(invokeSessions)
    .values({
      deploymentId: input.deploymentId,
      sessionId: input.sessionId,
      projectId: input.projectId,
      packageId: input.packageId,
      functionPath: input.functionPath,
      functionKind: input.functionKind,
      partitionKey: input.partitionKey,
      scopeJson: input.scopeJson,
      argsJson: input.argsJson,
      idempotencyKey: input.idempotencyKey ?? null,
      state: input.state ?? "active",
      beginTs: input.beginTs,
      schemaVersion: input.schemaVersion,
      executionModule: input.executionModule,
    })
    .onConflictDoNothing({
      target: [invokeSessions.deploymentId, invokeSessions.sessionId],
    })
    .returning();

  const invokeSession = rows[0];
  if (invokeSession === undefined) {
    throw new InvokeSessionMetadataAlreadyExistsError(
      input.deploymentId,
      input.sessionId,
    );
  }

  return invokeSession;
}

export async function getInvokeSessionMetadata(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  sessionId: string,
): Promise<InvokeSessionMetadataRecord | null> {
  const rows = await db
    .select()
    .from(invokeSessions)
    .where(
      and(
        eq(invokeSessions.deploymentId, deploymentId),
        eq(invokeSessions.sessionId, sessionId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function finishInvokeSessionMetadata(
  db: FlarexMetadataDatabase,
  input: FinishInvokeSessionMetadataInput,
): Promise<InvokeSessionMetadataRecord | null> {
  const rows = await db
    .update(invokeSessions)
    .set({
      state: "finished",
      finishedAt: input.finishedAt,
    })
    .where(
      and(
        eq(invokeSessions.deploymentId, input.deploymentId),
        eq(invokeSessions.sessionId, input.sessionId),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

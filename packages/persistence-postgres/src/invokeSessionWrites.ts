import { and, asc, eq } from "drizzle-orm";

import { invokeSessionDocumentWrites } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import type { PersistenceJson } from "./documents";

export type InvokeSessionDocumentWriteOp = "insert" | "patch" | "delete";

export interface StageInvokeSessionDocumentWriteInput {
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

export class InvokeSessionDocumentWriteConflictError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly sessionId: string,
    readonly documentId: string,
    readonly existingOp: string,
    readonly nextOp: string,
  ) {
    super(
      `Cannot coalesce staged document writes for ${deploymentId}/${sessionId}/${documentId}: ${existingOp} then ${nextOp}`,
    );
    this.name = "InvokeSessionDocumentWriteConflictError";
  }
}

export async function stageInvokeSessionDocumentWrite(
  db: FlarexMetadataDatabase,
  input: StageInvokeSessionDocumentWriteInput,
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
    return await coalesceInvokeSessionDocumentWrite(db, input);
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

async function coalesceInvokeSessionDocumentWrite(
  db: FlarexMetadataDatabase,
  input: StageInvokeSessionDocumentWriteInput,
): Promise<InvokeSessionDocumentWriteRecord> {
  const existing = await getInvokeSessionDocumentWrite(db, input);
  if (existing === null) {
    throw new InvokeSessionDocumentWriteAlreadyExistsError(
      input.deploymentId,
      input.sessionId,
      input.documentId,
    );
  }

  const coalesced = coalesceDocumentWrite(existing, input);
  if (coalesced === null) {
    await db
      .delete(invokeSessionDocumentWrites)
      .where(writeIdentity(input));
    return {
      ...existing,
      op: input.op,
      valueJson: input.valueJson ?? null,
    };
  }

  const rows = await db
    .update(invokeSessionDocumentWrites)
    .set({
      op: coalesced.op,
      valueJson: coalesced.valueJson,
    })
    .where(writeIdentity(input))
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

async function getInvokeSessionDocumentWrite(
  db: FlarexMetadataDatabase,
  input: Pick<
    StageInvokeSessionDocumentWriteInput,
    "deploymentId" | "sessionId" | "tableId" | "documentId"
  >,
): Promise<InvokeSessionDocumentWriteRecord | null> {
  const rows = await db
    .select()
    .from(invokeSessionDocumentWrites)
    .where(writeIdentity(input))
    .limit(1);
  return rows[0] ?? null;
}

function coalesceDocumentWrite(
  existing: InvokeSessionDocumentWriteRecord,
  input: StageInvokeSessionDocumentWriteInput,
): { op: InvokeSessionDocumentWriteOp; valueJson: PersistenceJson | null } | null {
  if (existing.op === "insert") {
    if (input.op === "patch") {
      return {
        op: "insert",
        valueJson: mergeJsonObjects(
          existing.valueJson,
          input.valueJson,
          existing,
          input,
        ),
      };
    }
    if (input.op === "delete") {
      return null;
    }
    if (input.op === "insert") {
      throw new InvokeSessionDocumentWriteAlreadyExistsError(
        input.deploymentId,
        input.sessionId,
        input.documentId,
      );
    }
    throw writeConflict(existing, input);
  }

  if (existing.op === "patch") {
    if (input.op === "patch") {
      return {
        op: "patch",
        valueJson: mergeJsonObjects(
          existing.valueJson,
          input.valueJson,
          existing,
          input,
        ),
      };
    }
    if (input.op === "delete") {
      return { op: "delete", valueJson: null };
    }
    throw writeConflict(existing, input);
  }

  throw writeConflict(existing, input);
}

function mergeJsonObjects(
  left: unknown,
  right: unknown,
  existing: InvokeSessionDocumentWriteRecord,
  input: StageInvokeSessionDocumentWriteInput,
): PersistenceJson {
  if (!isJsonObject(left) || !isJsonObject(right)) {
    throw writeConflict(existing, input);
  }
  return { ...left, ...right };
}

function writeConflict(
  existing: InvokeSessionDocumentWriteRecord,
  input: StageInvokeSessionDocumentWriteInput,
): InvokeSessionDocumentWriteConflictError {
  return new InvokeSessionDocumentWriteConflictError(
    input.deploymentId,
    input.sessionId,
    input.documentId,
    existing.op,
    input.op,
  );
}

function writeIdentity(
  input: Pick<
    StageInvokeSessionDocumentWriteInput,
    "deploymentId" | "sessionId" | "tableId" | "documentId"
  >,
) {
  return and(
    eq(invokeSessionDocumentWrites.deploymentId, input.deploymentId),
    eq(invokeSessionDocumentWrites.sessionId, input.sessionId),
    eq(invokeSessionDocumentWrites.tableId, input.tableId),
    eq(invokeSessionDocumentWrites.documentId, input.documentId),
  );
}

function isJsonObject(value: unknown): value is Record<string, PersistenceJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

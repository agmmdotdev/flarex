import { and, asc, eq } from "drizzle-orm";
import {
  isJson,
  isWritableJsonObject,
  isWritableJsonObjectFromUnknown,
  type WritableJsonObject,
} from "flarex-protocol/json";

import { invokeSessionDocumentWrites } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import type { PersistenceJson } from "./documents";

export type InvokeSessionDocumentWriteOp =
  | "insert"
  | "patch"
  | "replace"
  | "delete";

export interface StageInvokeSessionDocumentWriteInput {
  deploymentId: string;
  sessionId: string;
  tableId: number;
  documentId: string;
  op: InvokeSessionDocumentWriteOp;
  valueJson?: PersistenceJson | null;
}

export type InvokeSessionDocumentWriteStorageRow =
  typeof invokeSessionDocumentWrites.$inferSelect;

type InvokeSessionDocumentWriteRecordBase = Omit<
  InvokeSessionDocumentWriteStorageRow,
  "op" | "valueJson"
>;

export type InvokeSessionDocumentWriteRecord =
  | (InvokeSessionDocumentWriteRecordBase & {
      op: "insert" | "replace";
      valueJson: PersistenceJson;
    })
  | (InvokeSessionDocumentWriteRecordBase & {
      op: "patch";
      valueJson: WritableJsonObject;
    })
  | (InvokeSessionDocumentWriteRecordBase & {
      op: "delete";
      valueJson: null;
    });

export type InvokeSessionDocumentWriteCorruptionReason =
  | "opUnsupported"
  | "valueNotJson"
  | "patchValueNotObject"
  | "deleteValuePresent";

export class InvokeSessionDocumentWriteCorruptionError extends Error {
  constructor(
    readonly deploymentId: string,
    readonly sessionId: string,
    readonly documentId: string,
    readonly reason: InvokeSessionDocumentWriteCorruptionReason,
  ) {
    super(
      `Invoke session document write is corrupt: ${deploymentId}/${sessionId}/${documentId} (${reason})`,
    );
    this.name = "InvokeSessionDocumentWriteCorruptionError";
  }
}

export function decodeInvokeSessionDocumentWriteRecord(
  row: InvokeSessionDocumentWriteStorageRow,
): InvokeSessionDocumentWriteRecord {
  switch (row.op) {
    case "insert":
    case "replace":
      if (!isPersistenceJson(row.valueJson)) {
        throw writeCorruption(row, "valueNotJson");
      }
      return { ...row, op: row.op, valueJson: row.valueJson };
    case "patch":
      if (!isPersistenceJson(row.valueJson)) {
        throw writeCorruption(row, "valueNotJson");
      }
      if (!isWritableJsonObject(row.valueJson)) {
        throw writeCorruption(row, "patchValueNotObject");
      }
      return { ...row, op: "patch", valueJson: row.valueJson };
    case "delete":
      if (row.valueJson !== null) {
        throw writeCorruption(row, "deleteValuePresent");
      }
      return { ...row, op: "delete", valueJson: null };
    default:
      throw writeCorruption(row, "opUnsupported");
  }
}

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
  validateStageInvokeSessionDocumentWriteInput(input);
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
  return decodeInvokeSessionDocumentWriteRecord(write);
}

export async function listInvokeSessionDocumentWrites(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  sessionId: string,
): Promise<InvokeSessionDocumentWriteRecord[]> {
  const rows = await db
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
  return rows.map(decodeInvokeSessionDocumentWriteRecord);
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
    return decodeInvokeSessionDocumentWriteRecord({
      ...existing,
      op: input.op,
      valueJson: input.valueJson ?? null,
    });
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
  return decodeInvokeSessionDocumentWriteRecord(write);
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
  const row = rows[0];
  return row === undefined ? null : decodeInvokeSessionDocumentWriteRecord(row);
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
    if (input.op === "replace") {
      return { op: "insert", valueJson: input.valueJson ?? null };
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
    if (input.op === "replace") {
      return { op: "replace", valueJson: input.valueJson ?? null };
    }
    if (input.op === "delete") {
      return { op: "delete", valueJson: null };
    }
    throw writeConflict(existing, input);
  }

  if (existing.op === "replace") {
    if (input.op === "patch") {
      return {
        op: "replace",
        valueJson: mergeJsonObjects(
          existing.valueJson,
          input.valueJson,
          existing,
          input,
        ),
      };
    }
    if (input.op === "replace") {
      return { op: "replace", valueJson: input.valueJson ?? null };
    }
    if (input.op === "delete") {
      return { op: "delete", valueJson: null };
    }
    throw writeConflict(existing, input);
  }

  if (existing.op === "delete") {
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
  if (
    !isWritableJsonObjectFromUnknown(left) ||
    !isWritableJsonObjectFromUnknown(right)
  ) {
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

function isPersistenceJson(value: unknown): value is PersistenceJson {
  return isJson(value);
}

function validateStageInvokeSessionDocumentWriteInput(
  input: StageInvokeSessionDocumentWriteInput,
): void {
  const valueJson = input.valueJson ?? null;
  switch (input.op) {
    case "insert":
    case "replace":
      if (!isPersistenceJson(valueJson)) {
        throw writeCorruption(input, "valueNotJson");
      }
      return;
    case "patch":
      if (!isPersistenceJson(valueJson)) {
        throw writeCorruption(input, "valueNotJson");
      }
      if (!isWritableJsonObject(valueJson)) {
        throw writeCorruption(input, "patchValueNotObject");
      }
      return;
    case "delete":
      if (valueJson !== null) {
        throw writeCorruption(input, "deleteValuePresent");
      }
      return;
    default:
      throw writeCorruption(input, "opUnsupported");
  }
}

function writeCorruption(
  row: Pick<
    InvokeSessionDocumentWriteStorageRow,
    "deploymentId" | "sessionId" | "documentId"
  >,
  reason: InvokeSessionDocumentWriteCorruptionReason,
): InvokeSessionDocumentWriteCorruptionError {
  return new InvokeSessionDocumentWriteCorruptionError(
    row.deploymentId,
    row.sessionId,
    row.documentId,
    reason,
  );
}

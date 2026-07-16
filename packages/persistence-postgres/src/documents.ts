import { and, asc, desc, eq, gt, lt, lte } from "drizzle-orm";
import type { WritableJson } from "flarex-protocol/json";

import { documents } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";

/** Published legacy-persistence name for protocol-owned writable JSON values. */
export type PersistenceJson = WritableJson;

export interface ParsedFlarexDocumentId {
  tableId: number;
  documentId: string;
}

export interface InsertDocumentRevisionInput {
  deploymentId: string;
  id: string;
  ts: number;
  value: PersistenceJson;
  deleted?: boolean;
  prevTs?: number | null;
}

export interface DocumentRevisionRecord {
  deploymentId: string;
  id: string;
  tableId: number;
  documentId: string;
  ts: number;
  value: PersistenceJson;
  deleted: boolean;
  prevTs: number | null;
}

export class FlarexDocumentIdFormatError extends Error {
  constructor(readonly id: string) {
    super(`Invalid Flarex document id: ${id}.`);
    this.name = "FlarexDocumentIdFormatError";
  }
}

export function parseFlarexDocumentId(id: string): ParsedFlarexDocumentId {
  const separator = id.indexOf(":");
  if (separator <= 0 || separator === id.length - 1) {
    throw new FlarexDocumentIdFormatError(id);
  }
  const tableId = Number(id.slice(0, separator));
  if (!Number.isInteger(tableId) || tableId < 0) {
    throw new FlarexDocumentIdFormatError(id);
  }
  return { tableId, documentId: id.slice(separator + 1) };
}

export async function insertDocumentRevision(
  db: FlarexMetadataDatabase,
  input: InsertDocumentRevisionInput,
): Promise<DocumentRevisionRecord> {
  const parsed = parseFlarexDocumentId(input.id);
  const rows = await db
    .insert(documents)
    .values({
      deploymentId: input.deploymentId,
      id: encodeString(parsed.documentId),
      ts: input.ts,
      tableId: encodeString(String(parsed.tableId)),
      jsonValue: encodeJson(input.value),
      deleted: input.deleted ?? false,
      prevTs: input.prevTs ?? null,
    })
    .returning();

  const document = rows[0];
  if (document === undefined) {
    throw new Error(
      `Failed to insert document revision: ${input.deploymentId}/${input.id}@${input.ts}`,
    );
  }
  return decodeDocumentRevision(document);
}

export async function getDocumentRevisionAtTs(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  id: string,
  ts: number,
): Promise<DocumentRevisionRecord | null> {
  const parsed = parseFlarexDocumentId(id);
  const rows = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.deploymentId, deploymentId),
        eq(documents.tableId, encodeString(String(parsed.tableId))),
        eq(documents.id, encodeString(parsed.documentId)),
        lte(documents.ts, ts),
      ),
    )
    .orderBy(desc(documents.ts))
    .limit(1);

  const document = rows[0];
  return document === undefined ? null : decodeDocumentRevision(document);
}

export async function listDocumentsInTableAtTs(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  tableId: number,
  ts: number,
  limit?: number,
): Promise<DocumentRevisionRecord[]> {
  const rows = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.deploymentId, deploymentId),
        eq(documents.tableId, encodeString(String(tableId))),
        lte(documents.ts, ts),
      ),
    )
    .orderBy(asc(documents.id), desc(documents.ts));

  const latest = new Map<string, DocumentRevisionRecord>();
  for (const row of rows) {
    const document = decodeDocumentRevision(row);
    if (!latest.has(document.id)) {
      latest.set(document.id, document);
    }
  }

  const visible = Array.from(latest.values())
    .filter((document) => !document.deleted)
    .sort((left, right) => left.id.localeCompare(right.id));

  return limit === undefined ? visible : visible.slice(0, limit);
}

export async function hasDocumentRevisionInTableBetweenTs(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  tableId: number,
  afterTs: number,
  beforeTs: number,
): Promise<boolean> {
  const rows = await db
    .select({ ts: documents.ts })
    .from(documents)
    .where(
      and(
        eq(documents.deploymentId, deploymentId),
        eq(documents.tableId, encodeString(String(tableId))),
        gt(documents.ts, afterTs),
        lt(documents.ts, beforeTs),
      ),
    )
    .limit(1);

  return rows[0] !== undefined;
}

function decodeDocumentRevision(
  row: typeof documents.$inferSelect,
): DocumentRevisionRecord {
  const tableId = Number(decodeString(row.tableId));
  const documentId = decodeString(row.id);
  return {
    deploymentId: row.deploymentId,
    id: `${tableId}:${documentId}`,
    tableId,
    documentId,
    ts: row.ts,
    value: decodeJson(row.jsonValue),
    deleted: row.deleted,
    prevTs: row.prevTs,
  };
}

function encodeJson(value: PersistenceJson): Uint8Array {
  return encodeString(JSON.stringify(value));
}

function decodeJson(value: Uint8Array): PersistenceJson {
  // Deliberate JSON bridge: persisted bytes decode to the PersistenceJson tree.
  return JSON.parse(decodeString(value)) as PersistenceJson;
}

function encodeString(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeString(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

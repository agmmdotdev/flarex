import { and, desc, eq, lte } from "drizzle-orm";

import { documents } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";

export type PersistenceJson =
  | null
  | boolean
  | number
  | string
  | PersistenceJson[]
  | { [key: string]: PersistenceJson };

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
  return JSON.parse(decodeString(value)) as PersistenceJson;
}

function encodeString(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeString(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

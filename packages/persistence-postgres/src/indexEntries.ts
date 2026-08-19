import { asNonArrayRecord } from "@flarex/utils/records";
import { and, eq, gt, gte, lt, lte, type SQL } from "drizzle-orm";

import { indexes } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  getDocumentRevisionAtTs,
  type DocumentRevisionRecord,
  type PersistenceJson,
} from "./documents";

export interface SchemaIndexRecord {
  indexId: number;
  tableId: number;
  name: string;
  fields: string[];
  state: "enabled" | "staged" | "disabled";
}

export interface PlannedIndexDocumentWrite {
  tableId: number;
  id: string;
  ts: number;
  previousValue: PersistenceJson | null;
  value: PersistenceJson | null;
  deleted: boolean;
}

export type IndexRangeExpression = {
  op: "eq" | "gt" | "gte" | "lt" | "lte";
  field: string;
  value: PersistenceJson;
};

export interface ListDocumentsInIndexAtTsInput {
  deploymentId: string;
  indexId: number;
  ts: number;
  lower?: string;
  upper?: string;
  cursor?: string;
  limit?: number;
  order?: "asc" | "desc";
}

export interface HasIndexEntryAfterTsInput {
  deploymentId: string;
  indexId: number;
  afterTs: number;
  lower?: string;
  upper?: string;
}

export interface IndexedDocumentPage {
  documents: Array<{
    key: string;
    document: DocumentRevisionRecord;
  }>;
  isDone: boolean;
  continueCursor: string;
}

interface EncodedIndexEntry {
  indexId: number;
  tableId: number;
  documentId: string;
  keyHex: string;
  keyBytes: Uint8Array;
}

const textEncoder = new TextEncoder();

export class InvokeSessionIndexMetadataError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid schema index metadata: ${reason}`);
    this.name = "InvokeSessionIndexMetadataError";
  }
}

export function schemaIndexesFromAnalysis(analysisJson: unknown): SchemaIndexRecord[] {
  const analysis = asNonArrayRecord(analysisJson);
  const schema = asNonArrayRecord(analysis?.schema);
  if (schema === null || !Array.isArray(schema.indexes)) return [];
  return schema.indexes.map((value, index) => schemaIndexFromJson(value, index));
}

export async function insertIndexEntriesForDocumentWrites(
  db: FlarexMetadataDatabase,
  input: {
    deploymentId: string;
    indexes: SchemaIndexRecord[];
    writes: PlannedIndexDocumentWrite[];
  },
): Promise<void> {
  const enabledIndexes = input.indexes.filter((index) => index.state === "enabled");
  if (enabledIndexes.length === 0 || input.writes.length === 0) return;

  for (const write of input.writes) {
    const tableIndexes = enabledIndexes.filter((index) => index.tableId === write.tableId);
    if (tableIndexes.length === 0) continue;

    for (const index of tableIndexes) {
      const previous =
        write.previousValue === null
          ? null
          : indexEntryForDocument(index, write.id, write.previousValue);
      const next =
        write.deleted || write.value === null
          ? null
          : indexEntryForDocument(index, write.id, write.value);

      if (previous !== null && previous.keyHex !== next?.keyHex) {
        await insertIndexEntry(db, input.deploymentId, write.ts, previous, true);
      }
      if (next !== null && next.keyHex !== previous?.keyHex) {
        await insertIndexEntry(db, input.deploymentId, write.ts, next, false);
      }
    }
  }
}

export async function listDocumentsInIndexAtTs(
  db: FlarexMetadataDatabase,
  input: ListDocumentsInIndexAtTsInput,
): Promise<IndexedDocumentPage> {
  const pageLimit = Math.max(1, Math.min(input.limit ?? 100, 1000));
  const order = input.order ?? "asc";
  const rows = await db
    .select()
    .from(indexes)
    .where(
      and(
        eq(indexes.deploymentId, input.deploymentId),
        eq(indexes.indexId, encodeString(String(input.indexId))),
        lte(indexes.ts, input.ts),
      ),
    );

  const latestByKey = new Map<string, typeof indexes.$inferSelect>();
  for (const row of rows) {
    const key = toHex(Array.from(row.keyPrefix));
    if (!keyInRange(key, input.lower, input.upper)) continue;
    if (input.cursor !== undefined) {
      if (order === "asc" && key <= input.cursor) continue;
      if (order === "desc" && key >= input.cursor) continue;
    }
    const current = latestByKey.get(key);
    if (current === undefined || row.ts > current.ts) {
      latestByKey.set(key, row);
    }
  }

  const visible = Array.from(latestByKey.values())
    .filter((row) => row.deleted !== true)
    .toSorted((left, right) => {
      const leftKey = toHex(Array.from(left.keyPrefix));
      const rightKey = toHex(Array.from(right.keyPrefix));
      return order === "asc"
        ? leftKey.localeCompare(rightKey)
        : rightKey.localeCompare(leftKey);
    });
  const pageRows = visible.slice(0, pageLimit + 1);
  const documents: IndexedDocumentPage["documents"] = [];
  for (const row of pageRows.slice(0, pageLimit)) {
    if (row.documentId === null) continue;
    const documentId = decodeString(row.documentId);
    const document = await getDocumentRevisionAtTs(
      db,
      input.deploymentId,
      documentId,
      input.ts,
    );
    if (document === null || document.deleted) continue;
    documents.push({
      key: toHex(Array.from(row.keyPrefix)),
      document,
    });
  }
  return {
    documents,
    isDone: pageRows.length <= pageLimit,
    continueCursor: documents.at(-1)?.key ?? input.cursor ?? "",
  };
}

export async function hasIndexEntryBetweenTs(
  db: FlarexMetadataDatabase,
  input: {
    deploymentId: string;
    indexId: number;
    afterTs: number;
    beforeTs: number;
    lower?: string;
    upper?: string;
  },
): Promise<boolean> {
  const rows = await db
    .select({ keyPrefix: indexes.keyPrefix })
    .from(indexes)
    .where(and(...indexChangedBetweenConditions(input)))
    .limit(1);
  return rows.length > 0;
}

export async function hasIndexEntryAfterTs(
  db: FlarexMetadataDatabase,
  input: HasIndexEntryAfterTsInput,
): Promise<boolean> {
  const rows = await db
    .select({ keyPrefix: indexes.keyPrefix })
    .from(indexes)
    .where(and(...indexChangedAfterConditions(input)))
    .limit(1);
  return rows.length > 0;
}

function indexChangedAfterConditions(input: HasIndexEntryAfterTsInput): SQL[] {
  return indexChangeConditions(input);
}

function indexChangedBetweenConditions(input: {
  deploymentId: string;
  indexId: number;
  afterTs: number;
  beforeTs: number;
  lower?: string;
  upper?: string;
}): SQL[] {
  return indexChangeConditions({
    ...input,
    upperTsExclusive: input.beforeTs,
  });
}

function indexChangeConditions(input: HasIndexEntryAfterTsInput & {
  upperTsExclusive?: number;
}): SQL[] {
  const conditions: SQL[] = [
    eq(indexes.deploymentId, input.deploymentId),
    eq(indexes.indexId, encodeString(String(input.indexId))),
    gt(indexes.ts, input.afterTs),
  ];
  if (input.upperTsExclusive !== undefined) {
    conditions.push(lt(indexes.ts, input.upperTsExclusive));
  }
  if (input.lower !== undefined) {
    conditions.push(gte(indexes.keyPrefix, hexToBytes(input.lower)));
  }
  if (input.upper !== undefined) {
    conditions.push(lt(indexes.keyPrefix, hexToBytes(input.upper)));
  }
  return conditions;
}

export function indexBoundsForExpressions(
  fields: string[],
  expressions: IndexRangeExpression[],
): { lower?: string; upper?: string } {
  const equalities: PersistenceJson[] = [];
  let lowerExpression: IndexRangeExpression | undefined;
  let upperExpression: IndexRangeExpression | undefined;

  for (const expression of expressions) {
    const expectedField = fields[equalities.length];
    if (expression.op === "eq") {
      if (lowerExpression || upperExpression || expression.field !== expectedField) {
        throw new Error("Index equality expressions must follow index fields in order.");
      }
      equalities.push(expression.value);
      continue;
    }
    if (expression.field !== expectedField) {
      throw new Error("Index inequality must target the field after equality expressions.");
    }
    if (expression.op === "gt" || expression.op === "gte") {
      if (lowerExpression) throw new Error("Index range can have only one lower bound.");
      lowerExpression = expression;
    } else {
      if (upperExpression) throw new Error("Index range can have only one upper bound.");
      upperExpression = expression;
    }
  }

  const prefix = encodeIndexValues(equalities);
  const lower =
    lowerExpression === undefined
      ? prefix || undefined
      : lowerExpression.op === "gt"
        ? indexKeyAfterPrefix(encodeIndexValues([...equalities, lowerExpression.value]))
        : encodeIndexValues([...equalities, lowerExpression.value]);
  const upper =
    upperExpression === undefined
      ? prefix
        ? indexKeyAfterPrefix(prefix)
        : undefined
      : upperExpression.op === "lte"
        ? indexKeyAfterPrefix(encodeIndexValues([...equalities, upperExpression.value]))
        : encodeIndexValues([...equalities, upperExpression.value]);
  return {
    ...(lower === undefined ? {} : { lower }),
    ...(upper === undefined ? {} : { upper }),
  };
}

function schemaIndexFromJson(value: unknown, index: number): SchemaIndexRecord {
  const metadata = asNonArrayRecord(value);
  if (metadata === null) {
    throw new InvokeSessionIndexMetadataError(`index at ${index} must be an object`);
  }
  if (typeof metadata.indexId !== "number" || !Number.isInteger(metadata.indexId)) {
    throw new InvokeSessionIndexMetadataError(`index at ${index} indexId must be an integer`);
  }
  if (typeof metadata.tableId !== "number" || !Number.isInteger(metadata.tableId)) {
    throw new InvokeSessionIndexMetadataError(`index at ${index} tableId must be an integer`);
  }
  if (typeof metadata.name !== "string" || metadata.name.length === 0) {
    throw new InvokeSessionIndexMetadataError(`index at ${index} name must be non-empty`);
  }
  if (!Array.isArray(metadata.fields) || !metadata.fields.every((field) => typeof field === "string")) {
    throw new InvokeSessionIndexMetadataError(`index at ${index} fields must be strings`);
  }
  if (
    metadata.state !== undefined &&
    metadata.state !== "enabled" &&
    metadata.state !== "staged" &&
    metadata.state !== "disabled"
  ) {
    throw new InvokeSessionIndexMetadataError(`index at ${index} state is invalid`);
  }
  return {
    indexId: metadata.indexId,
    tableId: metadata.tableId,
    name: metadata.name,
    fields: [...metadata.fields],
    state: metadata.state ?? "enabled",
  };
}

function indexEntryForDocument(
  index: SchemaIndexRecord,
  documentId: string,
  value: PersistenceJson,
): EncodedIndexEntry {
  const keyHex = indexKeyForDocument(index, value, documentId);
  return {
    indexId: index.indexId,
    tableId: index.tableId,
    documentId,
    keyHex,
    keyBytes: hexToBytes(keyHex),
  };
}

async function insertIndexEntry(
  db: FlarexMetadataDatabase,
  deploymentId: string,
  ts: number,
  entry: EncodedIndexEntry,
  deleted: boolean,
): Promise<void> {
  await db.insert(indexes).values({
    deploymentId,
    indexId: encodeString(String(entry.indexId)),
    ts,
    keyPrefix: entry.keyBytes,
    keySuffix: null,
    keySha256: await sha256(entry.keyBytes),
    deleted,
    tableId: encodeString(String(entry.tableId)),
    documentId: encodeString(entry.documentId),
  });
}

function indexKeyForDocument(
  index: Pick<SchemaIndexRecord, "fields">,
  value: PersistenceJson,
  documentId: string,
): string {
  return encodeIndexValues([...index.fields.map((field) => getField(value, field)), documentId]);
}

function getField(value: PersistenceJson, field: string): PersistenceJson | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  let cursor: PersistenceJson | undefined = value;
  for (const segment of field.split(".")) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function encodeIndexValues(values: Array<PersistenceJson | undefined>): string {
  return toHex(values.flatMap(encodeValue));
}

export function indexKeyAfterPrefix(prefix: string): string | undefined {
  const bytes = hexToNumberArray(prefix);
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    const byte = bytes[index];
    if (byte !== undefined && byte !== 0xff) {
      bytes[index] = byte + 1;
      return toHex(bytes.slice(0, index + 1));
    }
  }
  return undefined;
}

function keyInRange(key: string, lower?: string, upper?: string): boolean {
  return (lower === undefined || key >= lower) && (upper === undefined || key < upper);
}

function encodeValue(value: PersistenceJson | undefined): number[] {
  if (value === undefined) return [0x01];
  if (value === null) return [0x03];
  if (typeof value === "number") return [0x0d, ...encodeFloat64(value)];
  if (typeof value === "boolean") return [value ? 0x0f : 0x0e];
  if (typeof value === "string") return [0x10, ...escapeBytes(textEncoder.encode(value))];
  if (Array.isArray(value)) return [0x12, ...value.flatMap(encodeValue), 0x00];

  const entries = Object.entries(value).toSorted(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return [
    0x15,
    ...entries.flatMap(([field, fieldValue]) => [
      ...escapeBytes(textEncoder.encode(field)),
      ...encodeValue(fieldValue),
    ]),
    0x00,
  ];
}

function encodeFloat64(value: number): number[] {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  let bits = view.getBigUint64(0, false);
  bits = (bits & (1n << 63n)) !== 0n ? ~bits & ((1n << 64n) - 1n) : bits | (1n << 63n);
  view.setBigUint64(0, bits, false);
  return Array.from(new Uint8Array(buffer));
}

function escapeBytes(bytes: Uint8Array): number[] {
  const result: number[] = [];
  for (const byte of bytes) {
    result.push(byte);
    if (byte === 0) result.push(0xff);
  }
  result.push(0);
  return result;
}

function toHex(bytes: number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array {
  return new Uint8Array(hexToNumberArray(value));
}

function hexToNumberArray(value: string): number[] {
  if (value.length % 2 !== 0) throw new Error("Invalid hexadecimal index key.");
  return Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

function encodeString(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function decodeString(value: Uint8Array): string {
  return new TextDecoder().decode(value);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
}

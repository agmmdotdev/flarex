import { indexes } from "./schema";
import type { FlarexMetadataDatabase } from "./deployments";
import type { PersistenceJson } from "./documents";

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
  const analysis = asRecord(analysisJson);
  const schema = asRecord(analysis?.schema);
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

function schemaIndexFromJson(value: unknown, index: number): SchemaIndexRecord {
  const metadata = asRecord(value);
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

function encodeIndexValues(values: Array<PersistenceJson | undefined>): string {
  return toHex(values.flatMap(encodeValue));
}

function encodeValue(value: PersistenceJson | undefined): number[] {
  if (value === undefined) return [0x01];
  if (value === null) return [0x03];
  if (typeof value === "number") return [0x0d, ...encodeFloat64(value)];
  if (typeof value === "boolean") return [value ? 0x0f : 0x0e];
  if (typeof value === "string") return [0x10, ...escapeBytes(textEncoder.encode(value))];
  if (Array.isArray(value)) return [0x12, ...value.flatMap(encodeValue), 0x00];

  const entries = Object.entries(value).sort(([left], [right]) =>
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
  if (value.length % 2 !== 0) throw new Error("Invalid hexadecimal index key.");
  return new Uint8Array(
    Array.from({ length: value.length / 2 }, (_, index) =>
      Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
    ),
  );
}

function encodeString(value: string): Uint8Array {
  return textEncoder.encode(value);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

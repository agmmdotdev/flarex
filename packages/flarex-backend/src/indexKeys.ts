import type { Json, SchemaIndex } from "./types";

export type IndexRangeExpression = {
  op: "eq" | "gt" | "gte" | "lt" | "lte";
  field: string;
  value: Json;
};

const textEncoder = new TextEncoder();

function getField(value: Json, field: string): Json | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  let cursor: Json | undefined = value;
  for (const segment of field.split(".")) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, Json>)[segment];
  }
  return cursor;
}

export function indexKeyForDocument(
  index: Pick<SchemaIndex, "fields">,
  value: Json,
  documentId: string,
): string {
  return encodeIndexValues([...index.fields.map(field => getField(value, field)), documentId]);
}

export function encodeIndexValues(values: Array<Json | undefined>): string {
  return toHex(values.flatMap(encodeValue));
}

export function indexKeyAfterPrefix(prefix: string): string | undefined {
  const bytes = fromHex(prefix);
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    if (bytes[index] !== 0xff) {
      bytes[index]! += 1;
      return toHex(bytes.slice(0, index + 1));
    }
  }
  return undefined;
}

export function indexKeyInRange(key: string, lower?: string, upper?: string): boolean {
  return (lower === undefined || key >= lower) && (upper === undefined || key < upper);
}

export function indexBoundsForExpressions(
  fields: string[],
  expressions: IndexRangeExpression[],
): { lower?: string; upper?: string } {
  const equalities: Json[] = [];
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

function encodeValue(value: Json | undefined): number[] {
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
  return bytes.map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): number[] {
  if (value.length % 2 !== 0) throw new Error("Invalid hexadecimal index key.");
  return Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

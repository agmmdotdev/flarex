/**
 * Convex common/src/{query.rs,json/query.rs,interval/} at
 * db914cf06e2b06ee985646611b9e12ed7a770318. Copyright 2026 Convex, Inc.
 * Rust source license: FSL-1.1-Apache-2.0, enclosing convex-backend/LICENSE.md.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { Data, Encoding, Result, Schema } from "effect";
import { captureDocumentValue, isDocumentArray, type DocumentValue, type DocumentValueError } from "./document-value";
import { compareIndexKeys, encodeCapturedIndexValue } from "./index-key";
import { StrictStructOptions } from "./strict-schema-options";

export type QueryOrder = "asc" | "desc";
export interface IndexRangeExpression {
  readonly op: "eq" | "gt" | "gte" | "lt" | "lte";
  readonly field: string;
  readonly value: unknown;
}
export interface CapturedIndexRangeExpression extends IndexRangeExpression {
  readonly value: DocumentValue | undefined;
}
export interface IndexRangeInterval {
  readonly start: Uint8Array;
  /** null is the unbounded end; finite ends are exclusive. */
  readonly end: Uint8Array | null;
}
export interface IndexRangeSplit {
  readonly observed: IndexRangeInterval;
  readonly remaining: IndexRangeInterval;
}
export interface LogicalQuery {
  readonly source:
    | { readonly type: "FullTableScan"; readonly tableName: string; readonly order: QueryOrder }
    | { readonly type: "IndexRange"; readonly indexName: string; readonly range: readonly CapturedIndexRangeExpression[]; readonly order: QueryOrder };
  readonly operators: readonly { readonly limit: number }[];
}

export class IndexRangeError extends Data.TaggedError("IndexRangeError")<{
  readonly reason: "invalidQuery" | "invalidValue" | "alreadyDefinedBound" | "boundsOnMultipleFields" | "fieldNotInIndex" | "invalidIndexRange";
  readonly field?: string;
  readonly bound?: "equality" | "lower" | "upper" | "inequality";
  readonly cause?: DocumentValueError;
}> {}

// FieldPath::from_str trims exterior dots; IdentifierFieldName has no path-depth limit.
const pathPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const QueryFieldPathSchema = Schema.String.check(Schema.makeFilter(value => {
  const fields = value.replace(/^\.+|\.+$/g, "").split(".");
  return fields.every(field => pathPattern.test(field) && /[A-Za-z0-9]/.test(field)) ? undefined : "Invalid query field path";
}));
const ExpressionSchema = Schema.Struct({
  op: Schema.Literals(["eq", "gt", "gte", "lt", "lte"]), field: QueryFieldPathSchema, value: Schema.Unknown,
}).annotate(StrictStructOptions);
const decodeExpression = Schema.decodeUnknownResult(ExpressionSchema);
const OrderSchema = Schema.Literals(["asc", "desc"]);
const SourceSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal("FullTableScan"), tableName: Schema.String, order: Schema.optionalKey(Schema.NullOr(OrderSchema)) }).annotate(StrictStructOptions),
  Schema.Struct({ type: Schema.Literal("IndexRange"), indexName: Schema.String, range: Schema.Unknown, order: Schema.optionalKey(Schema.NullOr(OrderSchema)) }).annotate(StrictStructOptions),
]);
const decodeSource = Schema.decodeUnknownResult(SourceSchema);
const decodeQuery = Schema.decodeUnknownResult(Schema.Struct({ source: Schema.Unknown, operators: Schema.Unknown }).annotate(StrictStructOptions));
const decodeLimit = Schema.decodeUnknownResult(Schema.Struct({
  limit: Schema.Number.check(Schema.makeFilter(n => Number.isSafeInteger(n) && n >= 0 ? undefined : "Invalid query limit")),
}).annotate(StrictStructOptions));
const utf8 = new TextEncoder();

/** Descriptor-safe AST projection, followed by authoritative structural/value decoders. */
export function captureIndexRangeExpressions(input: unknown): Result.Result<readonly CapturedIndexRangeExpression[], IndexRangeError> {
  return Result.gen(function* () {
    const array = yield* dataArray(input);
    const expressions: CapturedIndexRangeExpression[] = [];
    for (const item of array) {
      const plain = yield* dataObject(item);
      const expression = yield* decodeExpression(plain).pipe(Result.mapError(invalidQuery));
      const value = expression.value === undefined ? undefined : yield* captureDocumentValue(expression.value).pipe(
        Result.mapError(cause => new IndexRangeError({ reason: "invalidValue", cause })),
      );
      expressions.push(Object.freeze({ op: expression.op, field: expression.field.replace(/^\.+|\.+$/g, ""), value }));
    }
    return Object.freeze(expressions);
  });
}

export function captureLogicalQuery(input: unknown): Result.Result<LogicalQuery, IndexRangeError> {
  return Result.gen(function* () {
    const plain = yield* dataObject(input);
    const query = yield* decodeQuery(plain).pipe(Result.mapError(invalidQuery));
    const sourcePlain = yield* dataObject(query.source);
    const source = yield* decodeSource(sourcePlain).pipe(Result.mapError(invalidQuery));
    const capturedSource = source.type === "FullTableScan" ? Object.freeze({ ...source, order: source.order ?? "asc" }) : Object.freeze({
      ...source, order: source.order ?? "asc", range: yield* captureIndexRangeExpressions(source.range),
    });
    const operators: { readonly limit: number }[] = [];
    const operatorArray = yield* dataArray(query.operators);
    if (operatorArray.length > 256) return yield* Result.fail(invalidQuery());
    for (const operator of operatorArray) {
      const operatorPlain = yield* dataObject(operator);
      operators.push(Object.freeze(yield* decodeLimit(operatorPlain).pipe(Result.mapError(invalidQuery))));
    }
    return Object.freeze({ source: capturedSource, operators: Object.freeze(operators) });
  });
}

interface Bound { readonly value: DocumentValue | undefined; readonly inclusive: boolean }

/** Established captured operands; indexedFields excludes the implicit trailing _id. */
export function compileIndexRange(
  expressions: readonly CapturedIndexRangeExpression[], indexedFields: readonly string[],
): Result.Result<IndexRangeInterval, IndexRangeError> {
  return Result.gen(function* () {
    const equalities = new Map<string, DocumentValue | undefined>();
    let inequalityField: string | undefined;
    let lower: Bound | undefined;
    let upper: Bound | undefined;
    for (const expression of expressions) {
      const { op, field, value } = expression;
      if (op === "eq") {
        if (equalities.has(field)) return yield* Result.fail(new IndexRangeError({ reason: "alreadyDefinedBound", bound: "equality", field }));
        equalities.set(field, value);
        continue;
      }
      const less = op === "lt" || op === "lte";
      if (less ? upper !== undefined : lower !== undefined) return yield* Result.fail(new IndexRangeError({
        reason: "alreadyDefinedBound", bound: less ? "upper" : "lower", field,
      }));
      if (inequalityField !== undefined && inequalityField !== field) return yield* Result.fail(new IndexRangeError({ reason: "boundsOnMultipleFields", field }));
      inequalityField = field;
      const bound = { value, inclusive: op === "gte" || op === "lte" };
      if (less) upper = bound; else lower = bound;
    }
    if (inequalityField !== undefined && equalities.has(inequalityField)) return yield* Result.fail(new IndexRangeError({
      reason: "alreadyDefinedBound", bound: "inequality", field: inequalityField,
    }));
    const fields = [...indexedFields, "_id"];
    const rank = new Map(fields.map((field, index) => [field, index]));
    // Invalid selected registry metadata is an owner defect, not a developer query failure.
    if (rank.size !== fields.length) throw new Error("Selected index has duplicate fields");
    const ranked: { readonly field: string; readonly value: DocumentValue | undefined; readonly rank: number }[] = [];
    // Source BTreeMap visits equality fields lexically before rank sorting/inequality validation.
    for (const field of [...equalities.keys()].toSorted()) {
      const fieldRank = rank.get(field);
      if (fieldRank === undefined) return yield* Result.fail(new IndexRangeError({ reason: "fieldNotInIndex", field }));
      ranked.push({ field, value: equalities.get(field), rank: fieldRank });
    }
    ranked.sort((a, b) => a.rank - b.rank);
    if (inequalityField !== undefined && !rank.has(inequalityField)) return yield* Result.fail(new IndexRangeError({ reason: "fieldNotInIndex", field: inequalityField }));
    const used = [...ranked.map(expression => expression.field), ...(inequalityField === undefined ? [] : [inequalityField])];
    for (let i = 0; i < used.length; i += 1) if (used[i] !== fields[i]) return yield* Result.fail(new IndexRangeError({ reason: "invalidIndexRange", field: used[i] }));
    const prefix = ranked.map(expression => expression.value);
    const startKey = encodeValues(lower === undefined ? prefix : [...prefix, lower.value]);
    const start = lower === undefined || lower.inclusive ? startKey : incrementIndexKeyPrefix(startKey);
    if (start === null) throw new Error("Encoded query bound has no increment");
    let end: Uint8Array | null;
    if (upper !== undefined && !upper.inclusive) end = encodeValues([...prefix, upper.value]);
    else {
      const values = upper === undefined ? prefix : [...prefix, upper.value];
      const key = encodeValues(values);
      end = values.length === fields.length ? concatenate([key, Uint8Array.of(0)]) : incrementIndexKeyPrefix(key);
    }
    return Object.freeze({ start, end });
  });
}

export function incrementIndexKeyPrefix(key: Uint8Array): Uint8Array | null {
  for (let i = key.byteLength - 1; i >= 0; i -= 1) {
    const byte = key[i];
    if (byte !== undefined && byte < 255) { const next = key.slice(0, i + 1); next[i] = byte + 1; return next; }
  }
  return null;
}

export function indexRangeIsEmpty(interval: IndexRangeInterval): boolean {
  return interval.end !== null && compareIndexKeys(interval.start, interval.end) >= 0;
}

/** Source Interval::split_after; lastKey is a yielded full index key. */
export function splitIndexRangeAfter(interval: IndexRangeInterval, lastKey: Uint8Array, order: QueryOrder): IndexRangeSplit {
  if (order === "desc") return {
    observed: { start: lastKey.slice(), end: interval.end?.slice() ?? null },
    remaining: { start: interval.start.slice(), end: lastKey.slice() },
  };
  const next = incrementIndexKeyPrefix(lastKey);
  if (next !== null && (interval.end === null || compareIndexKeys(next, interval.end) < 0)) return {
    observed: { start: interval.start.slice(), end: next.slice() }, remaining: { start: next, end: interval.end?.slice() ?? null },
  };
  return { observed: { start: interval.start.slice(), end: interval.end?.slice() ?? null }, remaining: { start: new Uint8Array(), end: new Uint8Array() } };
}

/** Source Query::fingerprint inputs and ordered serde JSON representation. */
export function fingerprintQuery(query: LogicalQuery, indexedFields: readonly string[]): Uint8Array {
  return sha256(utf8.encode(queryFingerprintJson(query, indexedFields)));
}

export function queryFingerprintJson(query: LogicalQuery, indexedFields: readonly string[]): string {
  const source = query.source.type === "FullTableScan"
    ? `{"type":"FullTableScan","tableName":${JSON.stringify(query.source.tableName)},"order":${JSON.stringify(query.source.order)}}`
    : `{"type":"IndexRange","indexName":${JSON.stringify(query.source.indexName)},"range":[${query.source.range.map(expression =>
      `{"type":${JSON.stringify(expression.op[0]?.toUpperCase() + expression.op.slice(1))},"fieldPath":${JSON.stringify(expression.field)},"value":${valueJson(expression.value)}}`).join(",")}],"order":${JSON.stringify(query.source.order)}}`;
  return `{"query":{"source":${source},"operators":[${query.operators.map(operator => `{"limit":${operator.limit}}`).join(",")}]},"indexed_fields":${JSON.stringify(indexedFields)}}`;
}

function valueJson(value: DocumentValue | undefined): string {
  if (value === undefined) return '{"$undefined":null}';
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigInt64(0, value, true); return `{"$integer":${JSON.stringify(Encoding.encodeBase64(bytes))}}`; }
  if (typeof value === "number") {
    if (Number.isFinite(value) && !Object.is(value, -0)) return serdeFloat(value);
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
    return `{"$float":${JSON.stringify(Encoding.encodeBase64(bytes))}}`;
  }
  if (value instanceof ArrayBuffer) return `{"$bytes":${JSON.stringify(Encoding.encodeBase64(new Uint8Array(value)))}}`;
  if (isDocumentArray(value)) return `[${value.map(valueJson).join(",")}]`;
  return `{${Object.keys(value).toSorted().map(key => `${JSON.stringify(key)}:${valueJson(value[key])}`).join(",")}}`;
}

/** zmij 1.0.23's f64 presentation: fixed exponent -5..15 and explicit .0 / e+.
 * ECMAScript supplies the shortest round-tripping significand. The pinned Rust
 * probe validates this adaptation, including subnormal and exponent boundaries. */
function serdeFloat(value: number): string {
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  if (value === 0) return `${sign}0.0`;
  const [mantissa = "", exponentText = ""] = Math.abs(value).toExponential().split("e");
  const exponent = Number(exponentText);
  if (exponent < -5 || exponent > 15) return `${sign}${mantissa}e${exponent >= 0 ? "+" : ""}${exponent}`;
  const digits = mantissa.replace(".", "");
  const point = exponent + 1;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}.0`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

function encodeValues(values: readonly (DocumentValue | undefined)[]): Uint8Array { return concatenate(values.map(encodeCapturedIndexValue)); }
function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
  let offset = 0; for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; } return out;
}
function invalidQuery(): IndexRangeError { return new IndexRangeError({ reason: "invalidQuery" }); }

/** No accessors are evaluated; operand traversal belongs to captureDocumentValue. */
function dataObject(input: unknown): Result.Result<Record<string, unknown>, IndexRangeError> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return Result.fail(invalidQuery());
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return Result.fail(invalidQuery());
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") return Result.fail(invalidQuery());
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return Result.fail(invalidQuery());
    Object.defineProperty(out, key, { value: descriptor.value, enumerable: true });
  }
  return Result.succeed(out);
}
function dataArray(input: unknown): Result.Result<readonly unknown[], IndexRangeError> {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return Result.fail(invalidQuery());
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number") return Result.fail(invalidQuery());
  const length = lengthDescriptor.value;
  if (Reflect.ownKeys(input).length !== length + 1) return Result.fail(invalidQuery());
  const out: unknown[] = [];
  for (let i = 0; i < length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return Result.fail(invalidQuery());
    out.push(descriptor.value);
  }
  return Result.succeed(out);
}

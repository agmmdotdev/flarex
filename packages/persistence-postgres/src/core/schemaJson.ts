/**
 * Source JSON layout: Convex common/schemas/json.rs at db914cf06. Numeric layout:
 * serde_json 1.0.151 / zmij 1.0.23 (FloatTraits::min/max_decimal_exponent).
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { MAX_VALIDATOR_JSON_DEPTH_V1, MAX_VALIDATOR_JSON_NODES_V1, ValidatorLiteralWireCodecV1, ValidatorLiteralSourceCodecV1 } from "flarex-protocol/validator-json";
import { captureCoreSchema, CoreSchemaError, CoreSchemaInputSchema, invalidCoreSchema,
  type CoreSchemaDefinition } from "./schemaTypes";
import { validatorIsSubsetOfStringV1, validatorIsStringSubtypeWithStringLiteralV1 } from "flarex-protocol/internal/validator-json-core";

/** The source emits a mandatory .0 in fixed integral f64s and uses -5..15 fixed exponents. */
export function serializeCoreSchemaFloat(value: number): Result.Result<string, CoreSchemaError> {
  return Number.isFinite(value) ? Result.succeed(formatFiniteSchemaFloat(value))
    : Result.fail(new CoreSchemaError({ reason: "unsupportedFloatLiteral",
      message: "Infinite or NaN values are not supported in literal validators." }));
}

function formatFiniteSchemaFloat(value: number): string {
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const sign = value < 0 ? "-" : "";
  const parts = Math.abs(value).toString().split("e");
  const significand = parts[0] ?? "";
  const explicitExponent = parts[1] === undefined ? 0 : Number(parts[1]);
  const dot = significand.indexOf(".");
  const integerDigits = dot < 0 ? significand.length : dot;
  const allDigits = significand.replace(".", "");
  const first = allDigits.search(/[1-9]/);
  const nativeDigits = allDigits.slice(first).replace(/0+$/, "");
  const nativeExponent = explicitExponent + integerDigits - first - 1;
  const { digits, exponent } = closestDecimalDigits(Math.abs(value), nativeDigits.length, nativeExponent);
  if (exponent < -5 || exponent > 15) return `${sign}${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ""}e${exponent >= 0 ? "+" : ""}${exponent}`;
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  const point = exponent + 1;
  return point >= digits.length ? `${sign}${digits}${"0".repeat(point - digits.length)}.0`
    : `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * ECMAScript guarantees the minimal digit count, but only recommends closest/even
 * among those strings. Refine that choice with the exact binary rational, as zmij
 * requires. Only the floor/ceiling decimal candidates can be closest. At least one
 * round-trips: the native shortest string already supplies such a candidate.
 */
function closestDecimalDigits(value: number, digitCount: number, nativeExponent: number) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const significand = (bits & 0x000f_ffff_ffff_ffffn) | (exponentBits === 0 ? 0n : 0x0010_0000_0000_0000n);
  const binaryExponent = exponentBits === 0 ? -1074 : exponentBits - 1075;
  const numerator = binaryExponent >= 0 ? significand << BigInt(binaryExponent) : significand;
  const denominator = binaryExponent < 0 ? 1n << BigInt(-binaryExponent) : 1n;
  const decimalExponent = nativeExponent - digitCount + 1;
  const scaledNumerator = decimalExponent < 0 ? numerator * (10n ** BigInt(-decimalExponent)) : numerator;
  const scaledDenominator = decimalExponent > 0 ? denominator * (10n ** BigInt(decimalExponent)) : denominator;
  const floor = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const distance = remainder * 2n;
  const nearest = distance < scaledDenominator || (distance === scaledDenominator && floor % 2n === 0n) ? floor : floor + 1n;
  // Powers of two have asymmetric round-trip intervals; the closer candidate
  // can be outside its narrow side while the other candidate is still valid.
  const selected = Number(`${nearest}e${decimalExponent}`) === value ? nearest : nearest === floor ? floor + 1n : floor;
  const raw = selected.toString();
  return { digits: raw.replace(/0+$/, ""), exponent: decimalExponent + raw.length - 1 };
}

const quote = (value: string): string => JSON.stringify(value);

const encodeLiteral = Schema.encodeUnknownResult(ValidatorLiteralWireCodecV1);
const decodeSourceLiteral = Schema.decodeUnknownResult(ValidatorLiteralSourceCodecV1);

/** Property order follows the source enum/struct declaration, not alphabetical JSON keys. */
export function serializeCoreDocumentValidator(validator: ValidatorJsonV1): Result.Result<string, CoreSchemaError> {
  return Result.gen(function* () {
    const tag = `"type":${quote(validator.type)}`;
    switch (validator.type) {
      case "literal": {
        const value = typeof validator.value === "number" ? yield* serializeCoreSchemaFloat(validator.value)
          : JSON.stringify(yield* Result.mapError(encodeLiteral(validator.value), cause => invalidCoreSchema("Invalid literal value", cause)));
        return `{${tag},"value":${value}}`;
      }
      case "id": return `{${tag},"tableName":${quote(validator.tableName)}}`;
      case "array": return `{${tag},"value":${yield* serializeCoreDocumentValidator(validator.value)}}`;
      case "union": {
        const values: string[] = [];
        for (const value of validator.value) values.push(yield* serializeCoreDocumentValidator(value));
        return `{${tag},"value":[${values.join(",")}]}`;
      }
      case "record": {
        const keys = yield* serializeCoreDocumentValidator(validator.keys);
        const values = yield* serializeCoreDocumentValidator(validator.values);
        return `{${tag},"keys":${keys},"values":{"fieldType":${values},"optional":false}}`;
      }
      case "object": {
        const fields: string[] = [];
        for (const [key, field] of Object.entries(validator.value).toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
          fields.push(`${quote(key)}:{"fieldType":${yield* serializeCoreDocumentValidator(field.fieldType)},"optional":${field.optional}}`);
        return `{${tag},"value":{${fields.join(",")}}}`;
      }
      case "null": case "number": case "bigint": case "boolean": case "string": case "bytes": case "any": return `{${tag}}`;
    }
  });
}

/** Source TryFrom<DatabaseSchema>: finite validation belongs to persistence conversion. */
export function serializeCoreSchema(schema: CoreSchemaDefinition): Result.Result<string, CoreSchemaError> {
  return Result.gen(function* () {
    const tables: string[] = [];
    for (const table of schema.tables) {
      const indexes = (values: typeof table.indexes) => `[${values.map(index =>
        `{"indexDescriptor":${quote(index.indexDescriptor)},"fields":${JSON.stringify(index.fields)}}`).join(",")}]`;
      const documentType = table.documentType === undefined ? "null" : yield* serializeCoreDocumentValidator(table.documentType);
      const stagedDocumentType = table.stagedDocumentType === undefined ? "null" : yield* serializeCoreDocumentValidator(table.stagedDocumentType);
      tables.push(`{"tableName":${quote(table.tableName)},"indexes":${indexes(table.indexes)},"stagedDbIndexes":${indexes(table.stagedDbIndexes)},"searchIndexes":[],"stagedSearchIndexes":[],"vectorIndexes":[],"stagedVectorIndexes":[],"documentType":${documentType},"stagedDocumentType":${stagedDocumentType}}`);
    }
    return `{"tables":[${tables.join(",")}],"schemaValidation":${schema.schemaValidation}}`;
  });
}

export const coreDocumentValidatorHash = Effect.fn("CoreSchema.validatorHash")(function* (validator: ValidatorJsonV1) {
  const serialized = yield* Effect.fromResult(serializeCoreDocumentValidator(validator));
  const bytes = new TextEncoder().encode(serialized);
  const digest = yield* Effect.tryPromise({ try: () => globalThis.crypto.subtle.digest("SHA-256", bytes),
    catch: (cause: unknown) => new CoreSchemaError({ reason: "hashFailure", message: "Could not hash the schema validator", cause }) });
  return encodeBytesToLowercaseHex(new Uint8Array(digest));
});
const SourceFieldSchema = Schema.Struct({ fieldType: Schema.Unknown, optional: Schema.Boolean });
const SourceNodeSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literals(["null", "number", "bigint", "boolean", "string", "bytes", "any", "map", "set"]) }),
  Schema.Struct({ type: Schema.Literal("literal"), value: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("id"), tableName: Schema.String }),
  Schema.Struct({ type: Schema.Literal("array"), value: Schema.Unknown }),
  Schema.Struct({ type: Schema.Literal("object"), value: Schema.Record(Schema.String, SourceFieldSchema) }),
  Schema.Struct({ type: Schema.Literal("record"), keys: Schema.Unknown, values: SourceFieldSchema }),
  Schema.Struct({ type: Schema.Literal("union"), value: Schema.Array(Schema.Unknown) }),
]);
const decodeSourceNode = Schema.decodeUnknownResult(SourceNodeSchema);
const decodeInput = Schema.decodeUnknownResult(CoreSchemaInputSchema);

/** This codec adapts source record FieldTypeJson; semantic admission stays protocol-owned. */
function sourceValidator(value: unknown, budget: { nodes: number }, depth = 0): Result.Result<ValidatorJsonV1, CoreSchemaError> {
  return Result.gen(function* () {
    budget.nodes += 1;
    if (depth > MAX_VALIDATOR_JSON_DEPTH_V1 || budget.nodes > MAX_VALIDATOR_JSON_NODES_V1)
      return yield* Result.fail(invalidCoreSchema("Source validator exceeds admission limits"));
    const node = yield* Result.mapError(decodeSourceNode(value), cause => invalidCoreSchema("Invalid source validator JSON", cause));
    switch (node.type) {
      case "map": case "set": return { type: "any" };
      case "array": return { type: "array", value: yield* sourceValidator(node.value, budget, depth + 1) };
      case "union": {
        const members: ValidatorJsonV1[] = [];
        for (const member of node.value) members.push(yield* sourceValidator(member, budget, depth + 1));
        return { type: "union", value: members };
      }
      case "object": {
        const fields: [string, { fieldType: ValidatorJsonV1; optional: boolean }][] = [];
        for (const [key, field] of Object.entries(node.value)) fields.push([key, {
          fieldType: yield* sourceValidator(field.fieldType, budget, depth + 1), optional: field.optional }]);
        return { type: "object", value: Object.fromEntries(fields) };
      }
      case "record": {
        const keys = yield* sourceValidator(node.keys, budget, depth + 1);
        if (!validatorIsSubsetOfStringV1(keys))
          return yield* Result.fail(invalidCoreSchema("Source record keys must be string subtypes"));
        const values = yield* sourceValidator(node.values.fieldType, budget, depth + 1);
        if (validatorIsStringSubtypeWithStringLiteralV1(keys))
          return yield* Result.fail(invalidCoreSchema("Source record keys cannot contain string literal validators"));
        if (node.values.optional)
          return yield* Result.fail(invalidCoreSchema("Source record values must not be optional"));
        return { type: "record", keys, values };
      }
      case "literal": return { type: "literal", value: yield* Result.mapError(decodeSourceLiteral(node.value),
        cause => invalidCoreSchema("Invalid source literal value", cause)) };
      case "id": return node;
      case "null": case "number": case "bigint": case "boolean": case "string": case "bytes": case "any": return { type: node.type };
    }
  });
}

/** JSON.parse is the narrow foreign parser boundary; malformed stored JSON is projected by its caller. */
export function parseCoreSchema(raw: string): Result.Result<CoreSchemaDefinition, CoreSchemaError> {
  return Result.gen(function* () {
    const parsed = yield* Result.try({ try: (): unknown => JSON.parse(raw), catch: (cause: unknown) => {
      if (cause instanceof SyntaxError) return invalidCoreSchema("Malformed schema JSON", cause);
      throw cause;
    } });
    const input = yield* Result.mapError(decodeInput(parsed), cause => invalidCoreSchema("Invalid source schema JSON", cause));
    const tables = [];
    for (const table of input.tables) {
      const documentType = table.documentType == null ? undefined : yield* sourceValidator(table.documentType, { nodes: 0 });
      const stagedDocumentType = table.stagedDocumentType == null ? undefined : yield* sourceValidator(table.stagedDocumentType, { nodes: 0 });
      tables.push({ ...table, ...(documentType === undefined ? {} : { documentType }),
        ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) });
    }
    return yield* captureCoreSchema({ ...input, tables });
  });
}

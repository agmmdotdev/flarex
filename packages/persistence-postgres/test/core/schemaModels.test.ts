import { Effect, Option, Result, Schema } from "effect";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeIndexValue } from "flarex-protocol/index-key";
import type { DocumentObject, DocumentValue } from "flarex-protocol/document-value";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { incrementIndexKeyPrefix } from "flarex-protocol/index-range";
import { captureCoreSchema, checkCoreSchemaIndexReferences, coreSchemaTable, decodeCoreSchemaMetadata,
  decodeCoreSchemaValidationMetadata, decodeCoreSchemaValidationProgress, SCHEMAS, SCHEMA_VALIDATIONS,
  SCHEMA_VALIDATION_PROGRESS, type CoreSchemaDefinition } from "../../src/core/schemaTypes";
import { parseCoreSchema, serializeCoreDocumentValidator as encodeCoreDocumentValidator,
  serializeCoreSchema as encodeCoreSchema, serializeCoreSchemaFloat as encodeCoreSchemaFloat,
  coreDocumentValidatorHash } from "../../src/core/schemaJson";
import { CoreSchemaRegistry } from "../../src/core/schemaRegistry";
import { coreValidatorIsSubset, coreValidatorsEqual } from "../../src/core/validatorSubset";
import { CoreSchemaModel, coreSchemaValidationOutcomes } from "../../src/core/schemaModel";
import { CorePersistenceError } from "../../src/core/contracts";
import { CoreSchemaValidations } from "../../src/core/schemaValidations";
import type { CoreSchemaTransaction } from "../../src/core/schemaValidationProgress";
import type { CoreSystemDocument } from "../../src/core/transaction";
import { CoreTableNamespaceSchema } from "../../src/core/namespace";

const serializeCoreDocumentValidator = (value: ValidatorJsonV1) => Result.getOrThrow(encodeCoreDocumentValidator(value));
const serializeCoreSchema = (value: CoreSchemaDefinition) => Result.getOrThrow(encodeCoreSchema(value));
const serializeCoreSchemaFloat = (value: number) => Result.getOrThrow(encodeCoreSchemaFloat(value));
const bytes = (value: number) => { const result = new Uint8Array(16); new DataView(result.buffer).setUint32(12, value); return result; };
const id = (value: number) => Result.getOrThrow(encodeDocumentId(600, bytes(value)));
const object = (fields: Record<string, ValidatorJsonV1>): ValidatorJsonV1 => ({ type: "object",
  value: Object.fromEntries(Object.entries(fields).map(([name, fieldType]) => [name, { fieldType, optional: false }])) });
const schema = (documentType?: ValidatorJsonV1, stagedDocumentType?: ValidatorJsonV1): CoreSchemaDefinition =>
  Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{ tableName: "items", indexes: [],
    ...(documentType === undefined ? {} : { documentType }), ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) }] }));
const record = (n: number, state: "pending" | "validated" | "active" | "overwritten", definition = schema()): CoreSystemDocument =>
  ({ id: id(n), creationTime: n, value: { state: { state }, schema: serializeCoreSchema(definition) } });

/** Generic metadata storage only; all state/uniqueness/publication rules use the actual models/registry. */
function metadataStore() {
  const tables = new Set([SCHEMAS, SCHEMA_VALIDATIONS, SCHEMA_VALIDATION_PROGRESS, "items"]);
  const rows = new Map<string, Map<string, CoreSystemDocument>>();
  const reads: { table: string; index: string; values: readonly DocumentValue[] }[] = [];
  let registry = CoreSchemaRegistry.empty();
  let counter = 100;
  const tableRows = (name: string) => {
    const found = rows.get(name);
    if (found !== undefined) return found;
    const created = new Map<string, CoreSystemDocument>(); rows.set(name, created); return created;
  };
  const fields: Readonly<Record<string, readonly string[]>> = {
    by_state: ["state"], by_schema_id_and_table_name: ["schemaId", "tableName"], by_validation_id: ["validationId"], by_creation_time: [],
  };
  const equal = (left: DocumentValue | undefined, right: DocumentValue) =>
    typeof left === "object" && typeof right === "object" ? JSON.stringify(left) === JSON.stringify(right) : left === right;
  const publish = (table: string, oldDocument?: CoreSystemDocument, newDocument?: CoreSystemDocument) => {
    if (table === SCHEMAS) registry = Result.getOrThrow(registry.withDocument(null, oldDocument, newDocument));
  };
  const tx: CoreSchemaTransaction = {
    namespace: null, timestamp: 7_200_000_000_000n,
    get schemaRegistry() { return registry; },
    applicationSchemaRetained: () => Result.succeed(false),
    schemaTableStateIndex: () => ({ id: bytes(1) }), addIndexRead: () => {},
    tableExists: name => tables.has(name),
    ensureUserTable: name => Effect.sync(() => {
      tables.add(name);
      return { name, number: 10000, tabletId: bytes(10000), namespace: null, state: "active" as const, indexes: [] };
    }),
    getSystem: (table, selected) => Effect.sync(() => Option.fromUndefinedOr(tableRows(table).get(selected))),
    querySystem: (table, index, values) => Effect.sync(() => {
      reads.push({ table, index, values });
      const selectedFields = fields[index];
      if (selectedFields === undefined) throw new Error(`Unknown test index ${index}`);
      return [...tableRows(table).values()].filter(row => values.every((value, position) => {
        const field = selectedFields[position]; return field !== undefined && equal(row.value[field], value);
      })).toSorted((a, b) => a.creationTime - b.creationTime);
    }),
    insertSystem: (table, value) => Effect.sync(() => {
      counter += 1;
      const document = { id: id(counter), creationTime: 7_200_000 + counter, value: structuredClone(value) };
      publish(table, undefined, document); tableRows(table).set(document.id, document); return document.id;
    }),
    replaceSystem: (table, selected, value) => Effect.sync(() => {
      const previous = tableRows(table).get(selected);
      if (previous === undefined) throw new Error("Missing test metadata row");
      const document = { ...previous, value: structuredClone(value) };
      publish(table, previous, document); tableRows(table).set(selected, document);
    }),
    deleteSystem: (table, selected) => Effect.sync(() => {
      const previous = tableRows(table).get(selected);
      publish(table, previous); tableRows(table).delete(selected);
    }),
  };
  return { tx, reads, rows: (table: string) => [...tableRows(table).values()], tables };
}

describe("source schema codecs and proof rules", () => {
  it("looks up detached frozen tables without changing source ordering, duplicate resolution or bytes", () => {
    const producer = { schemaValidation: true, tables: [
      { tableName: "zeta", indexes: [], documentType: { type: "any" } },
      { tableName: "alpha", indexes: [] },
      { tableName: "zeta", indexes: [], documentType: { type: "object", value: {} } },
    ] };
    const captured = Result.getOrThrow(captureCoreSchema(producer));
    const expected = '{"tables":[{"tableName":"alpha","indexes":[],"stagedDbIndexes":[],"searchIndexes":[],"stagedSearchIndexes":[],"vectorIndexes":[],"stagedVectorIndexes":[],"documentType":null,"stagedDocumentType":null},{"tableName":"zeta","indexes":[],"stagedDbIndexes":[],"searchIndexes":[],"stagedSearchIndexes":[],"vectorIndexes":[],"stagedVectorIndexes":[],"documentType":{"type":"object","value":{}},"stagedDocumentType":null}],"schemaValidation":true}';
    expect(serializeCoreSchema(captured)).toBe(expected);
    const zeta = coreSchemaTable(captured, "zeta");
    expect(zeta).toBe(captured.tables[1]);
    expect(zeta?.documentType).toEqual({ type: "object", value: {} });
    expect(coreSchemaTable(captured, "alpha")).toBe(captured.tables[0]);
    expect(coreSchemaTable(captured, "missing")).toBeUndefined();
    expect(coreSchemaTable(captured, "constructor")).toBeUndefined();
    expect(coreSchemaTable(captured, "__proto__")).toBeUndefined();
    producer.tables.reverse();
    const changed = producer.tables[0];
    if (changed === undefined) throw new Error("Missing producer declaration");
    changed.tableName = "changed";
    producer.tables.push({ tableName: "late", indexes: [] });
    expect(coreSchemaTable(captured, "zeta")).toBe(zeta);
    expect(coreSchemaTable(captured, "late")).toBeUndefined();
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.tables)).toBe(true);
    expect(Object.isFrozen(zeta)).toBe(true);
    expect(Object.isFrozen(zeta?.documentType)).toBe(true);
    expect(serializeCoreSchema(captured)).toBe(expected);
    const parsed = Result.getOrThrow(parseCoreSchema(expected));
    expect(coreSchemaTable(parsed, "zeta")).toEqual(zeta);
    expect(coreSchemaTable(parsed, "zeta")).not.toBe(zeta);
    expect(serializeCoreSchema(parsed)).toBe(expected);
    const replaced = Result.getOrThrow(captureCoreSchema({ tables: [
      { tableName: "zeta", indexes: [], documentType: { type: "any" } },
    ] }));
    expect(coreSchemaTable(replaced, "zeta")?.documentType).toEqual({ type: "any" });
    expect(coreSchemaTable(captured, "zeta")?.documentType).toEqual({ type: "object", value: {} });
  });

  it("preserves source defaults, optional validators, sorted fields and source record encoding", () => {
    const captured = Result.getOrThrow(captureCoreSchema({ tables: [{ tableName: "items", indexes: [],
      documentType: { type: "union", value: [object({ z: { type: "number" }, _id: { type: "string" },
        a: { type: "record", keys: { type: "string" }, values: { type: "number" } } })] } }] }));
    expect(captured.schemaValidation).toBe(false);
    const validator = captured.tables[0]?.documentType;
    expect(validator?.type).toBe("object");
    if (validator === undefined) throw new Error("Missing captured validator");
    const serialized = serializeCoreDocumentValidator(validator);
    expect(serialized).toBe('{"type":"object","value":{"a":{"fieldType":{"type":"record","keys":{"type":"string"},"values":{"fieldType":{"type":"number"},"optional":false}},"optional":false},"z":{"fieldType":{"type":"number"},"optional":false}}}');
    expect(Result.getOrThrow(parseCoreSchema(serializeCoreSchema(captured)))).toEqual(captured);
    expect(serializeCoreSchema(schema())).toContain('"documentType":null');
    expect(serializeCoreSchema(schema())).not.toBe(serializeCoreSchema(schema({ type: "any" })));
  });

  it("rejects unsupported/nonobject declarations and source-incompatible records", () => {
    expect(Result.isFailure(captureCoreSchema({ tables: [{ tableName: "items", indexes: [], searchIndexes: [{}] }] }))).toBe(true);
    expect(Result.isFailure(captureCoreSchema({ tables: [{ tableName: "items", indexes: [], documentType: { type: "number" } }] }))).toBe(true);
    expect(Result.isFailure(captureCoreSchema({ tables: [{ tableName: "items", indexes: [],
      documentType: object({ bad: { type: "record", keys: { type: "literal", value: "bad" }, values: { type: "string" } } }) }] }))).toBe(true);
    expect(Result.isFailure(parseCoreSchema('{"tables":[{"tableName":"items","indexes":[],"documentType":{"type":"object","value":{"bad":{"fieldType":{"type":"record","keys":{"type":"string"},"values":{"fieldType":{"type":"any"},"optional":true}},"optional":false}}}}]}'))).toBe(true);
  });

  it("finishes raw record DTOs before ordered key, value and optional semantics", () => {
    const parseRecord = (keys: unknown, fieldType: unknown, optional = false) => parseCoreSchema(JSON.stringify({
      tables: [{ tableName: "items", indexes: [], documentType: { type: "object", value: {
        record: { fieldType: { type: "record", keys, values: { fieldType, optional } }, optional: false },
      } } }],
    }));
    const malformed = { type: "not-a-validator" };
    const integer = { type: "literal", value: { $integer: "AQAAAAAAAAA=" } };
    const literal = { type: "literal", value: "key" };
    const nonfinite = { type: "literal", value: { $float: "AAAAAAAA+H8=" } };
    expect(parseRecord(integer, malformed, true)).toMatchObject({ failure: {
      reason: "invalidSchema", cause: { phase: "raw", reason: "unknownVariant" },
    } });
    expect(parseRecord(nonfinite, nonfinite)).toMatchObject({ failure: {
      reason: "invalidSchema", cause: { phase: "semantic", reason: "nonStringRecordKey" },
    } });
    expect(parseRecord(literal, malformed, true)).toMatchObject({ failure: {
      reason: "invalidSchema", cause: { phase: "raw", reason: "unknownVariant" },
    } });
    expect(parseRecord(literal, nonfinite, true)).toMatchObject({ failure: {
      reason: "invalidSchema", cause: { phase: "semantic", reason: "stringLiteralRecordKey" },
    } });
    expect(parseRecord({ type: "union", value: [{ type: "string" }, literal] }, { type: "number" })).toMatchObject({ failure: {
      reason: "invalidSchema", cause: { phase: "semantic", reason: "stringLiteralRecordKey" },
    } });
    expect(parseRecord({ type: "string" }, { type: "number" }, true)).toMatchObject({ failure: {
      reason: "invalidSchema", cause: { phase: "semantic", reason: "optionalRecordValue" },
    } });
    expect(Result.isSuccess(parseRecord({ type: "union", value: [] }, { type: "number" }))).toBe(true);
    expect(Result.isSuccess(parseRecord({ type: "id", tableName: "items" }, { type: "number" }))).toBe(true);
  });
  it("uses source float layout at exponent boundaries", () => {
    const cases: readonly (readonly [number, string])[] = [[0, "0.0"], [-0, "-0.0"], [1, "1.0"], [0.1, "0.1"],
      [1e-5, "0.00001"], [1e-6, "1e-6"], [1e15, "1000000000000000.0"], [1e16, "1e+16"],
      [1.2345e16, "1.2345e+16"], [Number.MIN_VALUE, "5e-324"], [Number.MAX_VALUE, "1.7976931348623157e+308"]];
    for (const [value, expected] of cases) expect(serializeCoreSchemaFloat(value)).toBe(expected);
    expect(serializeCoreDocumentValidator({ type: "literal", value: 1 })).toBe('{"type":"literal","value":1.0}');
  });

  it("matches the pinned zmij f64 regression vectors including rounding and subnormal boundaries", () => {
    // Primary reference: https://github.com/dtolnay/zmij/blob/1.0.23/tests/test.rs
    // f64 finite dtoa assertions, excluding duplicate zero/integer cases above.
    const vectors: readonly (readonly [number, string])[] = [
      [6.62607015e-34, "6.62607015e-34"], [5.444310685350916e14, "544431068535091.6"],
      [1e-323, "1e-323"], [1.2e-322, "1.2e-322"], [1.24e-322, "1.24e-322"],
      [1.234e-320, "1.234e-320"], [2.2250738585072004e-308, "2.2250738585072004e-308"],
      [-4.932096661796888e-226, "-4.932096661796888e-226"], [3.439070283483335e35, "3.439070283483335e+35"],
      [6.606854224493745e-17, "6.606854224493745e-17"], [6.079537928711555e61, "6.079537928711555e+61"],
      [1.3588129002659584e-245, "1.3588129002659584e-245"], [2.9802322387695312e-8, "2.9802322387695312e-8"],
      [5.960464477539063e-8, "5.960464477539063e-8"], [1.3076622631878654e65, "1.3076622631878654e+65"],
      [9.03725590277404e159, "9.03725590277404e+159"], [9.03725590277404e160, "9.03725590277404e+160"],
      [9.03725590277404e161, "9.03725590277404e+161"], [9.03725590277404e162, "9.03725590277404e+162"],
      [5.960464477539062e-7, "5.960464477539062e-7"], [43210, "43210.0"], [43210.1, "43210.1"],
      [10000, "10000.0"], [-5942736479622170, "-5942736479622170.0"],
    ];
    for (const [value, expected] of vectors) expect(serializeCoreSchemaFloat(value)).toBe(expected);
  });

  it("matches source JSON string escaping and rejects text Rust cannot represent", () => {
    const value = '"\\\b\t\n\f\r\u0000\u001f/\u2028\u2029😀é';
    const expected = String.raw`{"type":"literal","value":"\"\\\b\t\n\f\r\u0000\u001f/` + "\u2028\u2029😀é" + '"}';
    expect(serializeCoreDocumentValidator({ type: "literal", value })).toBe(expected);
    expect(Result.isFailure(captureCoreSchema({ tables: [{ tableName: "items", indexes: [],
      documentType: object({ value: { type: "literal", value: "\ud800" } }) }] }))).toBe(true);
    expect(Result.isFailure(captureCoreSchema({ tables: [{ tableName: "items", indexes: [],
      documentType: object({ "😀": { type: "string" } }) }] }))).toBe(true);
    expect(Result.isFailure(captureCoreSchema({ tables: [{ tableName: "items", indexes: [],
      documentType: object({ ___: { type: "string" } }) }] }))).toBe(true);
  });

  it("hashes exact source enum, field and record layout independently of caller key order", async () => {
    const captured = schema(object({ z: { type: "id", tableName: "items" },
      a: { type: "record", keys: { type: "string" }, values: { type: "literal", value: 1 } } }));
    const validator = captured.tables[0]?.documentType;
    if (validator === undefined) throw new Error("Missing captured validator");
    const expected = '{"type":"object","value":{"a":{"fieldType":{"type":"record","keys":{"type":"string"},"values":{"fieldType":{"type":"literal","value":1.0},"optional":false}},"optional":false},"z":{"fieldType":{"type":"id","tableName":"items"},"optional":false}}}';
    expect(serializeCoreDocumentValidator(validator)).toBe(expected);
    expect(await Effect.runPromise(coreDocumentValidatorHash(validator))).toBe(createHash("sha256").update(expected).digest("hex"));
  });

  it("keeps union order significant and rejects duplicate index fields", async () => {
    const left = schema({ type: "union", value: [object({ value: { type: "literal", value: 1 } }), object({ value: { type: "string" } })] });
    const right = schema({ type: "union", value: [object({ value: { type: "string" } }), object({ value: { type: "literal", value: 1 } })] });
    const a = left.tables[0]?.documentType; const b = right.tables[0]?.documentType;
    if (a === undefined || b === undefined) throw new Error("Missing captured validator");
    expect(await Effect.runPromise(coreDocumentValidatorHash(a))).not.toBe(await Effect.runPromise(coreDocumentValidatorHash(b)));
    expect(Result.isFailure(captureCoreSchema({ tables: [{ tableName: "items", indexes: [
      { indexDescriptor: "by_a", fields: ["value"] }, { indexDescriptor: "by_b", fields: ["value"] }] }] }))).toBe(true);
  });

  it("copies source subtype proofs without guessing record or object widening", () => {
    expect(coreValidatorIsSubset(object({ a: { type: "string" } }), object({}))).toBe(false);
    expect(coreValidatorIsSubset(object({}), { type: "object", value: { a: { fieldType: { type: "string" }, optional: true } } })).toBe(true);
    expect(coreValidatorIsSubset({ type: "object", value: { a: { fieldType: { type: "string" }, optional: true } } }, object({ a: { type: "string" } }))).toBe(false);
    expect(coreValidatorIsSubset({ type: "boolean" }, { type: "union", value: [{ type: "literal", value: true }, { type: "literal", value: false }] })).toBe(true);
    expect(coreValidatorIsSubset({ type: "record", keys: { type: "string" }, values: { type: "literal", value: "a" } },
      { type: "record", keys: { type: "string" }, values: { type: "string" } })).toBe(false);
    expect(coreSchemaValidationOutcomes(schema(object({ a: { type: "string" } })), undefined, new Map(), () => true).get("items")).toBe("mustWalk");
    expect(coreSchemaValidationOutcomes(schema(object({ a: { type: "string" } })), undefined, new Map(), () => false).get("items")).toBe("supersetOfShape");
  });

  it("uses signed int64 progress, source failed field names and actual index field membership", () => {
    expect(Result.isSuccess(decodeCoreSchemaMetadata({ schema: "{}", state: { state: "failed", error: "bad", table_name: "items" } }))).toBe(true);
    expect(Result.getOrThrow(decodeCoreSchemaMetadata({ schema: "{}", state: { state: "failed", error: "bad", tableName: "items" } })).state)
      .toEqual({ state: "failed", error: "bad", table_name: null });
    expect(Result.getOrThrow(decodeCoreSchemaValidationMetadata({ schemaId: id(1), tableName: "items", validatorHash: null,
      state: { state: "pending" } })).validatorHash).toBeUndefined();
    expect(Result.isSuccess(decodeCoreSchemaValidationProgress({ validationId: id(1), numDocsValidated: 9_007_199_254_740_993n, totalDocs: null }))).toBe(true);
    expect(Result.isFailure(decodeCoreSchemaValidationProgress({ validationId: id(1), numDocsValidated: 0x8000_0000_0000_0000n, totalDocs: null }))).toBe(true);
    const declaration = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{ tableName: "items", indexes: [
      { indexDescriptor: "by_missing", fields: ["missing", "_creationTime"] }], documentType: object({ value: { type: "string" } }) }] }));
    expect(Result.isFailure(checkCoreSchemaIndexReferences(declaration))).toBe(true);
  });
});

describe("source literal identity and persistence conversion", () => {
  const fromLiteral = (value: string | number | boolean | bigint) => schema(object({ value: { type: "literal", value } }));
  const sourceSchema = (literal: string) => `{"tables":[{"tableName":"items","indexes":[],"documentType":{"type":"object","value":{"value":{"fieldType":{"type":"literal","value":${literal}},"optional":false}}}}]}`;
  const capturedLiteral = (definition: CoreSchemaDefinition) => {
    const validator = definition.tables[0]?.documentType;
    return validator?.type === "object" && validator.value.value?.fieldType.type === "literal"
      ? validator.value.value.fieldType.value : undefined;
  };

  it("round-trips source int64 tags and signed zero without changing ordinary literal bytes", async () => {
    const cases: readonly (readonly [bigint, string])[] = [
      [0n, "AAAAAAAAAAA="], [1n, "AQAAAAAAAAA="], [-1n, "//////////8="],
      [-0x8000_0000_0000_0000n, "AAAAAAAAAIA="], [0x7fff_ffff_ffff_ffffn, "/////////38="],
    ];
    for (const [value, encoded] of cases) {
      const literal = { type: "literal", value } as const;
      const expected = `{"type":"literal","value":{"$integer":"${encoded}"}}`;
      expect(serializeCoreDocumentValidator(literal)).toBe(expected);
      expect(await Effect.runPromise(coreDocumentValidatorHash(literal)))
        .toBe(createHash("sha256").update(expected).digest("hex"));
      expect(capturedLiteral(Result.getOrThrow(parseCoreSchema(sourceSchema(`{"$integer":"${encoded}"}`))))).toBe(value);
    }
    expect(serializeCoreDocumentValidator({ type: "literal", value: -0 })).toBe('{"type":"literal","value":-0.0}');
    expect(serializeCoreDocumentValidator({ type: "literal", value: 0 })).toBe('{"type":"literal","value":0.0}');
    expect(Object.is(capturedLiteral(Result.getOrThrow(parseCoreSchema(sourceSchema('-0.0')))), -0)).toBe(true);
    expect(Object.is(capturedLiteral(Result.getOrThrow(parseCoreSchema(sourceSchema('{"$float":"AAAAAAAAAIA="}')))), -0)).toBe(true);
    expect(Object.is(capturedLiteral(Result.getOrThrow(parseCoreSchema(sourceSchema('{"$float":"AAAAAAAAAAA="}')))), 0)).toBe(true);
    expect(serializeCoreDocumentValidator({ type: "literal", value: "\0" })).toBe('{"type":"literal","value":"\\u0000"}');
    expect(await Effect.runPromise(coreDocumentValidatorHash({ type: "literal", value: 1n })))
      .not.toBe(await Effect.runPromise(coreDocumentValidatorHash({ type: "literal", value: 1 })));
    expect(await Effect.runPromise(coreDocumentValidatorHash({ type: "literal", value: -0 })))
      .not.toBe(await Effect.runPromise(coreDocumentValidatorHash({ type: "literal", value: 0 })));
    expect(Result.isFailure(captureCoreSchema({ tables: [{ tableName: "items", indexes: [],
      documentType: object({ value: { type: "literal", value: 0x8000_0000_0000_0000n } }) }] }))).toBe(true);
  });

  it("matches standalone Rust serde literal golden hashes", async () => {
    // Pinned enum field order, executed with serde_json 1.0.151 / serde_core
    // 1.0.229 / zmij 1.0.23, offline. Int64 LE payloads supplied independently;
    // this is a serde serialization oracle, not execution of the Convex crate.
    const vectors: readonly (readonly [number | bigint, string])[] = [
      [0, "9de16a640aeeed5dd8fe60839d1347596ffda30fabe0c15ad7cdcbf51d57352b"],
      [-0, "4da6affabb1697140fcf34f5c148b77a9805818ee515e8974a586776412f32d6"],
      [1, "b171289f3b32c98981959a950a26bd1e06f27bd8d92fcf458e72d8f332886511"],
      [1e-6, "4ed76c6f8afc6f9bbade5c3d8a81f0edfd05fcf9bf44a102a0a20e471352d44d"],
      [1e16, "72483e88e87b0f4feaf85cd92a82c24ac9aca59508ae2c04081fc86eb053a698"],
      [0n, "ddd4cea217f984b2719e8f5ce217a7e72033355077b75ab33ac792e7e3bcb3b0"],
      [1n, "183b791d93905b55cbe70a35187dcd5fb483ef22de5e3156881c81b694dd3b48"],
      [-1n, "ca3c4e2913edacba083c0d8a1925f6f28238e9701ea50cfc32d0ce6bef4d6d1a"],
      [-0x8000_0000_0000_0000n, "44dd455deeae8b14a33daec8e0eebbb0316e677820811eca258b9f8d59261ba8"],
      [0x7fff_ffff_ffff_ffffn, "51b2484ee79a92495d53f857845eebb32b09c380139a4f730475eaf74c331738"],
    ];
    for (const [value, expected] of vectors)
      expect(await Effect.runPromise(coreDocumentValidatorHash({ type: "literal", value }))).toBe(expected);
  });
  it("accepts source nonfinite parsing but refuses schema/hash persistence with a typed error", async () => {
    for (const [value, tag] of [[Infinity, "AAAAAAAA8H8="], [-Infinity, "AAAAAAAA8P8="], [NaN, "AAAAAAAA+H8="]] as const) {
      const parsed = Result.getOrThrow(parseCoreSchema(sourceSchema(`{"$float":"${tag}"}`)));
      expect(Object.is(capturedLiteral(parsed), value)).toBe(true);
      expect(encodeCoreSchema(parsed)).toMatchObject({ failure: { _tag: "CoreSchemaError", reason: "unsupportedFloatLiteral" } });
      expect(await Effect.runPromise(Effect.result(coreDocumentValidatorHash({ type: "literal", value }))))
        .toMatchObject({ failure: { _tag: "CoreSchemaError", reason: "unsupportedFloatLiteral" } });
      const store = metadataStore();
      expect(await Effect.runPromise(Effect.result(new CoreSchemaModel(store.tx).submitPending(fromLiteral(value)))))
        .toMatchObject({ failure: { _tag: "CoreSchemaError", reason: "unsupportedFloatLiteral" } });
      expect(store.rows(SCHEMAS)).toHaveLength(0);
    }
    for (const tag of ['{"$float":"AAAAAAAA8D8="}', '{"$integer":"AA=="}', '{"$integer":"AAAAAAAAAAA=","extra":true}'])
      expect(Result.isFailure(parseCoreSchema(sourceSchema(tag)))).toBe(true);
  });

  it("uses source literal bits and scalar types for subset and schema walk proofs", () => {
    const literal = (value: string | number | boolean | bigint): ValidatorJsonV1 => ({ type: "literal", value });
    const float = (bits: bigint) => { const view = new DataView(new ArrayBuffer(8)); view.setBigUint64(0, bits); return view.getFloat64(0); };
    expect(coreValidatorsEqual(literal(0), literal(-0))).toBe(false);
    expect(coreValidatorsEqual(literal(1), literal(1n))).toBe(false);
    expect(coreValidatorsEqual(literal(float(0x7ff8_0000_0000_0001n)), literal(float(0x7ff8_0000_0000_0001n)))).toBe(true);
    expect(coreValidatorsEqual(literal(float(0x7ff8_0000_0000_0001n)), literal(float(0x7ff8_0000_0000_0002n)))).toBe(false);
    expect(coreValidatorIsSubset(literal(1n), { type: "bigint" })).toBe(true);
    expect(coreValidatorIsSubset(literal(1n), { type: "number" })).toBe(false);
    expect(coreValidatorIsSubset(literal(1), { type: "bigint" })).toBe(false);
    expect(coreValidatorIsSubset(literal(0), literal(-0))).toBe(false);
    expect(coreSchemaValidationOutcomes(fromLiteral(-0), fromLiteral(0), new Map(), () => true).get("items")).toBe("mustWalk");
    expect(coreSchemaValidationOutcomes(fromLiteral(-0), undefined, new Map([["items", object({ value: literal(0) })]]), () => true)
      .get("items")).toBe("mustWalk");
  });

  it("does not carry pending progress or valid staged proof across signed-zero changes", async () => {
    for (const completed of [false, true]) {
      const store = metadataStore(); const model = new CoreSchemaModel(store.tx);
      const before = await Effect.runPromise(model.submitPending(schema(undefined, object({ value: { type: "literal", value: 0 } }))));
      const first = Option.getOrThrow(await Effect.runPromise(model.validations.validationMetadataForTable(before.id, "items")));
      await Effect.runPromise(model.validations.updateAttempt(first.document.id,
        { kind: "recordProgress", additionalDocsValidated: 5n, totalDocs: 10n }));
      if (completed) await Effect.runPromise(model.validations.updateAttempt(first.document.id, { kind: "markValid" }));
      const after = await Effect.runPromise(model.submitPending(schema(undefined, object({ value: { type: "literal", value: -0 } }))));
      const next = Option.getOrThrow(await Effect.runPromise(model.validations.validationMetadataForTable(after.id, "items")));
      expect(next.document.id).not.toBe(first.document.id);
      expect(next.metadata.validatorHash).not.toBe(first.metadata.validatorHash);
      expect(next.metadata.state).toEqual({ state: "pending" });
      expect(await Effect.runPromise(model.validations.progress(next.document.id))).toMatchObject({ numDocsValidated: 0n });
    }
  });
});
describe("namespaced schema registry", () => {
  it("records negative object-state equality dependencies and retains older roots", () => {
    const before = CoreSchemaRegistry.empty();
    const reads: { id: Uint8Array; interval: { start: Uint8Array | null; end: Uint8Array | null } }[] = [];
    const observe = (index: Uint8Array, interval: { start: Uint8Array | null; end: Uint8Array | null }) => reads.push({ id: index, interval });
    expect(Option.isNone(Result.getOrThrow(before.getByState(null, "active", { id: bytes(1) }, observe)))).toBe(true);
    const prefix = Result.getOrThrow(encodeIndexValue({ state: "active" }));
    expect(reads[0]?.interval).toEqual({ start: prefix, end: incrementIndexKeyPrefix(prefix) });
    const active = record(1, "active");
    const after = Result.getOrThrow(before.withDocument(null, undefined, active));
    expect(Option.isNone(Result.getOrThrow(before.getByState(null, "active", { id: bytes(1) }, observe)))).toBe(true);
    expect(Option.getOrThrow(Result.getOrThrow(after.getByState(null, "active", { id: bytes(1) }, observe))).id).toBe(active.id);
    const component = Schema.decodeUnknownSync(CoreTableNamespaceSchema)({ kind: "byComponent", id: id(99) });
    expect(Option.isNone(Result.getOrThrow(after.getByState(component, "active", { id: bytes(1) }, observe)))).toBe(true);
  });

  it("preserves the source distinction between stored nonfinite reads and new schema persistence", async () => {
    // Convex db914cf06 schema_metadata.rs22-31/55-59: stored raw strings are
    // parsed directly; only new metadata construction reverse-serializes them.
    for (const [state, tag, expected] of [["active", "AAAAAAAA+H8=", NaN],
      ["pending", "AAAAAAAA8H8=", Infinity], ["validated", "AAAAAAAA8P8=", -Infinity]] as const) {
      const store = metadataStore();
      const raw = `{"tables":[{"tableName":"items","indexes":[],"documentType":{"type":"object","value":{"value":{"fieldType":{"type":"literal","value":{"$float":"${tag}"}},"optional":false}}}}],"schemaValidation":true}`;
      const selectedId = await Effect.runPromise(store.tx.insertSystem(SCHEMAS, { state: { state }, schema: raw }));
      let stateReads = 0;
      const byState = Result.getOrThrow(store.tx.schemaRegistry.getByState(null, state,
        store.tx.schemaTableStateIndex(), () => { stateReads++; }));
      const byId = await Effect.runPromise(new CoreSchemaModel(store.tx).get(selectedId));
      for (const found of [byState, byId]) {
        const selected = Option.getOrThrow(found);
        const validator = selected.schema.tables[0]?.documentType;
        expect(validator).toMatchObject({ type: "object" });
        if (validator?.type !== "object") throw new Error("Missing stored object validator");
        const literal = validator.value.value?.fieldType;
        expect(literal?.type).toBe("literal");
        if (literal?.type !== "literal") throw new Error("Missing stored literal validator");
        expect(Object.is(literal.value, expected)).toBe(true);
        expect(selected.metadata.schema).toBe(raw);
        expect(encodeCoreSchema(selected.schema)).toMatchObject({ failure: {
          _tag: "CoreSchemaError", reason: "unsupportedFloatLiteral",
        } });
      }
      expect(stateReads).toBe(1);
    }
  });

  it("classifies malformed stored numeric literals as corruption in both actual readers", async () => {
    for (const encoded of ['{"$float":"AA=="}', '1e309']) {
      const store = metadataStore();
      const raw = `{"tables":[{"tableName":"items","indexes":[],"documentType":{"type":"object","value":{"value":{"fieldType":{"type":"literal","value":${encoded}},"optional":false}}}}],"schemaValidation":true}`;
      const selectedId = await Effect.runPromise(store.tx.insertSystem(SCHEMAS, { state: { state: "active" }, schema: raw }));
      let stateReads = 0;
      const byState = store.tx.schemaRegistry.getByState(null, "active",
        store.tx.schemaTableStateIndex(), () => { stateReads++; });
      const byId = await Effect.runPromise(Effect.result(new CoreSchemaModel(store.tx).get(selectedId)));
      for (const result of [byState, byId]) expect(result).toMatchObject({ failure: {
        _tag: "CorePersistenceError", reason: "corruptData", cause: { reason: "invalidSchema" },
      } });
      expect(stateReads).toBe(1);
    }
  });
  it("checks final batch invariants and lazily rejects corrupt source JSON", () => {
    const active = record(1, "active"); const validated = record(2, "validated");
    const initial = Result.getOrThrow(CoreSchemaRegistry.bootstrap([{ namespace: null, document: active }, { namespace: null, document: validated }]));
    const updated = initial.apply([
      { namespace: null, oldDocument: validated, newDocument: record(2, "active") },
      { namespace: null, oldDocument: active, newDocument: record(1, "overwritten") },
    ]);
    expect(Result.isSuccess(updated)).toBe(true);
    expect(Result.isFailure(initial.withDocument(null, undefined, record(3, "pending")))).toBe(true);
    const corrupt = Result.getOrThrow(CoreSchemaRegistry.bootstrap([{ namespace: null,
      document: { ...active, value: { state: { state: "active" }, schema: "{" } } }]));
    expect(Result.isFailure(corrupt.getByState(null, "active", { id: bytes(1) }, () => {}))).toBe(true);
  });
});

describe("schema lifecycle and attempt fencing", () => {
  it("propagates a typed deployment-retention failure before deleting schema history", async () => {
    const store = metadataStore(), ordinary = new CoreSchemaModel(store.tx);
    const proposed = await Effect.runPromise(ordinary.submitPending(schema()));
    const failure = new CorePersistenceError({ reason: "corruptData" });
    const model = new CoreSchemaModel({ ...store.tx, applicationSchemaRetained: () => Result.fail(failure) });
    expect(await Effect.runPromise(Effect.result(model.markFailed(proposed.id, "invalid candidate"))))
      .toEqual(Result.fail(failure));
    expect(store.rows(SCHEMAS).some(row => row.id === proposed.id)).toBe(true);
  });

  it("selects each table's active, proposed and staged validators independently", async () => {
    const store = metadataStore(); const model = new CoreSchemaModel(store.tx);
    const activeSchema = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [
      { tableName: "last", indexes: [], documentType: object({ value: { type: "boolean" } }) },
      { tableName: "first", indexes: [], documentType: object({ value: { type: "string" } }),
        stagedDocumentType: object({ value: { type: "literal", value: "ready" } }) },
    ] }));
    const active = await Effect.runPromise(model.submitPending(activeSchema));
    await Effect.runPromise(model.markValidated(active.id)); await Effect.runPromise(model.markActive(active.id));
    const activeAttempt = Option.getOrThrow(await Effect.runPromise(model.validations.validationMetadataForTable(active.id, "first")));
    await Effect.runPromise(model.validations.updateAttempt(activeAttempt.document.id, { kind: "markValid" }));
    expect([...(await Effect.runPromise(model.validations.validStagedValidators(active.id, activeSchema))).keys()]).toEqual(["first"]);
    expect((await Effect.runPromise(model.validations.stagedValidationsWithProgress(active.id, activeSchema)))
      .map(value => value.attempt.validation.tableName)).toEqual(["first"]);
    const proposalSchema = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [
      { tableName: "last", indexes: [], documentType: object({ value: { type: "boolean" } }),
        stagedDocumentType: object({ value: { type: "literal", value: true } }) },
      { tableName: "first", indexes: [], documentType: object({ value: { type: "literal", value: "only" } }) },
    ] }));
    const outcomes = coreSchemaValidationOutcomes(proposalSchema, activeSchema, new Map(), () => true);
    expect([...outcomes]).toEqual([["first", "mustWalk"], ["last", "supersetOfEnforced"]]);
    const proposal = await Effect.runPromise(model.submitPending(proposalSchema));
    const stagedState = async (schemaId: string, tableName: string) => Option.getOrThrow(
      await Effect.runPromise(model.validations.validationMetadataForTable(schemaId, tableName))).metadata.state.state;
    await Effect.runPromise(model.enforceDocument("omitted", { value: 1 }, { mode: "shapeOnly" }));
    expect(await stagedState(active.id, "first")).toBe("valid");
    expect(await stagedState(proposal.id, "last")).toBe("pending");
    const rejected = await Effect.runPromise(Effect.result(model.enforceDocument("last", { value: "bad" }, { mode: "shapeOnly" })));
    expect(rejected).toMatchObject({ failure: { reason: "documentValidation" } });
    expect(await stagedState(proposal.id, "last")).toBe("pending");
    await Effect.runPromise(model.enforceDocument("last", { value: false }, { mode: "shapeOnly" }));
    expect(await stagedState(proposal.id, "last")).toBe("failed");
    expect(await stagedState(active.id, "first")).toBe("valid");
    expect(Option.getOrThrow(await Effect.runPromise(model.get(proposal.id))).metadata.state.state).toBe("pending");
    const failedAttempt = Option.getOrThrow(await Effect.runPromise(model.validations.validationMetadataForTable(proposal.id, "last")));
    expect((await Effect.runPromise(model.submitPending(proposalSchema))).id).toBe(proposal.id);
    const retriedAttempt = Option.getOrThrow(await Effect.runPromise(model.validations.validationMetadataForTable(proposal.id, "last")));
    expect(retriedAttempt.document.id).not.toBe(failedAttempt.document.id);
    expect(await stagedState(proposal.id, "last")).toBe("pending");
    await Effect.runPromise(model.enforceDocument("first", { value: "other" }, { mode: "shapeOnly" }));
    expect(await stagedState(active.id, "first")).toBe("failed");
    expect(Option.getOrThrow(await Effect.runPromise(model.get(proposal.id))).metadata.state.state).toBe("failed");
    expect(Option.getOrThrow(await Effect.runPromise(model.active())).id).toBe(active.id);
  });

  it("replays identical proposals, overwrites changed work and preserves active on activation", async () => {
    const store = metadataStore(); const model = new CoreSchemaModel(store.tx);
    const first = await Effect.runPromise(model.submitPending(schema(object({ value: { type: "string" } }))));
    expect(await Effect.runPromise(model.submitPending(schema(object({ value: { type: "string" } }))))).toEqual(first);
    await Effect.runPromise(model.markValidated(first.id)); await Effect.runPromise(model.markActive(first.id));
    const proposed = await Effect.runPromise(model.submitPending(schema(object({ value: { type: "number" } }))));
    const replayActive = await Effect.runPromise(model.submitPending(schema(object({ value: { type: "string" } }))));
    expect(replayActive.id).toBe(first.id); expect(replayActive.state.state).toBe("active");
    expect(Option.getOrThrow(await Effect.runPromise(model.get(proposed.id))).metadata.state.state).toBe("overwritten");
    expect(Option.getOrThrow(await Effect.runPromise(model.active())).id).toBe(first.id);
  });

  it("rejects active violations and fails proposed violations while accepting active-valid writes", async () => {
    const store = metadataStore(); const model = new CoreSchemaModel(store.tx);
    const active = await Effect.runPromise(model.submitPending(schema(object({ value: { type: "string" } }))));
    await Effect.runPromise(model.markValidated(active.id)); await Effect.runPromise(model.markActive(active.id));
    const proposal = await Effect.runPromise(model.submitPending(schema(object({ value: { type: "literal", value: "only" } }))));
    const rejected = await Effect.runPromise(Effect.result(model.enforceDocument("items", { value: 1 }, { mode: "shapeOnly" })));
    expect(rejected).toMatchObject({ _tag: "Failure", failure: { reason: "documentValidation" } });
    expect(Option.getOrThrow(await Effect.runPromise(model.get(proposal.id))).metadata.state.state).toBe("pending");
    await Effect.runPromise(model.enforceDocument("items", { value: "other" }, { mode: "shapeOnly" }));
    expect(Option.getOrThrow(await Effect.runPromise(model.get(proposal.id))).metadata.state.state).toBe("failed");
    expect(Option.getOrThrow(await Effect.runPromise(model.active())).id).toBe(active.id);
  });

  it("avoids staged attempt reads for conforming writes, invalidates valid proofs and retries with fresh IDs", async () => {
    const store = metadataStore(); const model = new CoreSchemaModel(store.tx);
    const staged = schema(undefined, object({ value: { type: "string" } }));
    const proposal = await Effect.runPromise(model.submitPending(staged));
    const attempt = Option.getOrThrow(await Effect.runPromise(model.validations.validationMetadataForTable(proposal.id, "items")));
    await Effect.runPromise(model.validations.updateAttempt(attempt.document.id, { kind: "markValid" }));
    await Effect.runPromise(model.markValidated(proposal.id)); await Effect.runPromise(model.markActive(proposal.id));
    store.reads.length = 0;
    await Effect.runPromise(model.enforceDocument("items", { value: "ok" }, { mode: "shapeOnly" }));
    expect(store.reads.filter(read => read.table === SCHEMA_VALIDATIONS)).toHaveLength(0);
    await Effect.runPromise(model.enforceDocument("items", { value: 1 }, { mode: "shapeOnly" }));
    const failed = Option.getOrThrow(await Effect.runPromise(model.validations.validationMetadataForTable(proposal.id, "items")));
    expect(failed.metadata.state.state).toBe("failed");
    await Effect.runPromise(model.submitPending(staged));
    const retried = Option.getOrThrow(await Effect.runPromise(model.validations.validationMetadataForTable(proposal.id, "items")));
    expect(retried.document.id).not.toBe(attempt.document.id);
    expect(retried.metadata.state.state).toBe("pending");
    expect(await Effect.runPromise(model.validations.updateAttempt(attempt.document.id, { kind: "markValid" }))).toBe(false);
  });

  it("keeps progress separate, fences stale flushes and carries only compatible staged proofs", async () => {
    const store = metadataStore(); const validations = new CoreSchemaValidations(store.tx);
    const attempt = await Effect.runPromise(validations.startTableValidation(id(1), "items", undefined, 2n));
    await Effect.runPromise(validations.updateAttempt(attempt, { kind: "recordProgress", additionalDocsValidated: 3n, totalDocs: 9n }));
    expect(await Effect.runPromise(validations.progress(attempt))).toMatchObject({ numDocsValidated: 3n, totalDocs: 2n });
    expect(decodeCoreSchemaValidationMetadata(store.rows(SCHEMA_VALIDATIONS)[0]?.value)).toMatchObject({ success: { state: { state: "pending" } } });
    const replacement = await Effect.runPromise(validations.startTableValidation(id(1), "items", undefined, null));
    expect(replacement).not.toBe(attempt);
    expect(await Effect.runPromise(validations.updateAttempt(attempt, { kind: "recordProgress", additionalDocsValidated: 1n, totalDocs: null }))).toBe(false);
    const model = new CoreSchemaModel(store.tx);
    const first = await Effect.runPromise(model.submitPending(schema(undefined, object({ value: { type: "literal", value: "only" } }))));
    const firstAttempt = Option.getOrThrow(await Effect.runPromise(validations.validationMetadataForTable(first.id, "items")));
    await Effect.runPromise(validations.updateAttempt(firstAttempt.document.id, { kind: "markValid" }));
    const next = await Effect.runPromise(model.submitPending(schema(undefined, object({ value: { type: "string" } }))));
    const carried = Option.getOrThrow(await Effect.runPromise(validations.validationMetadataForTable(next.id, "items")));
    expect(carried.document.id).not.toBe(firstAttempt.document.id); expect(carried.metadata.state.state).toBe("valid");
    expect(store.rows(SCHEMA_VALIDATION_PROGRESS).some(row => row.value.validationId === firstAttempt.document.id)).toBe(false);
  });

  it("refuses competing enforced/staged walks on existing tables but admits truly new empty tables", async () => {
    const store = metadataStore(); const model = new CoreSchemaModel(store.tx);
    const declaration = schema(object({ value: { type: "string" } }), object({ value: { type: "number" } }));
    expect(await Effect.runPromise(Effect.result(model.submitPending(declaration)))).toMatchObject({ failure: { reason: "stagedEnforcedConflict" } });
    store.tables.delete("items");
    expect((await Effect.runPromise(model.submitPending(declaration))).state.state).toBe("pending");
    expect(store.tables.has("items")).toBe(true);
  });
});

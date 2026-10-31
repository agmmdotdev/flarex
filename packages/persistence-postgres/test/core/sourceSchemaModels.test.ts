import { createHash } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { captureCoreSchema, checkCoreSchemaIndexReferences } from "../../src/core/schemaTypes";
import { coreDocumentValidatorHash, parseCoreSchema, serializeCoreDocumentValidator, serializeCoreSchema } from "../../src/core/schemaJson";
import { coreValidatorIsSubset, coreValidatorReferences, coreValidatorsEqual } from "../../src/core/validatorSubset";

const object = (fields: Record<string, ValidatorJsonV1>): ValidatorJsonV1 => ({ type: "object", value:
  Object.fromEntries(Object.entries(fields).map(([name, fieldType]) => [name, { fieldType, optional: false }])) });
const sourceObject = (fields: Record<string, unknown>) => ({ type: "object", value:
  Object.fromEntries(Object.entries(fields).map(([name, fieldType]) => [name, { fieldType, optional: false }])) });
const declaration = (documentType: unknown, stagedDocumentType?: unknown) => ({ schemaValidation: true,
  tables: [{ tableName: "items", indexes: [], documentType, ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) }] });
const parse = (documentType: unknown, stagedDocumentType?: unknown) => parseCoreSchema(JSON.stringify(declaration(documentType, stagedDocumentType)));
const document = (documentType: unknown, stagedDocumentType?: unknown) => Result.getOrThrow(parse(documentType, stagedDocumentType)).tables[0];

describe("source schema DTO and document normalization", () => {
  it("finishes the raw DTO phase across tables, staged roots and unsupported index DTOs before semantics", () => {
    const nonStringRecord = object({ record: { type: "record", keys: { type: "number" }, values: { type: "string" } } });
    const rawNonString = sourceObject({ record: { type: "record", keys: { type: "number" }, values: { fieldType: { type: "string" }, optional: false } } });
    const malformed = { type: "object", value: { bad: { fieldType: { type: "string" }, optional: "false" } } };
    expect(parse(rawNonString, malformed)).toMatchObject({ failure: { cause: { phase: "raw" } } });
    expect(parseCoreSchema(JSON.stringify({ tables: [declaration(rawNonString).tables[0],
      { tableName: "other", indexes: [], documentType: malformed }] }))).toMatchObject({ failure: { cause: { phase: "raw" } } });
    expect(parseCoreSchema(JSON.stringify({ tables: [{ ...declaration(rawNonString).tables[0],
      searchIndexes: [{ indexDescriptor: "by_search", searchField: 42, filterFields: [] }] }] })))
      .toMatchObject({ failure: { cause: { phase: "raw" } } });
    expect(Result.isFailure(captureCoreSchema(declaration(nonStringRecord)))).toBe(true);
  });

  it("retains duplicate text evidence and source struct sequence forms", () => {
    expect(parseCoreSchema('{"tables":[],"tables":[]}')).toMatchObject({ failure: { cause: { phase: "raw" } } });
    expect(parseCoreSchema('{"tables":[{"tableName":"items","tableName":"other","indexes":[]}]}'))
      .toMatchObject({ failure: { cause: { phase: "raw" } } });
    expect(parseCoreSchema('{"tables":[{"tableName":"items","indexes":[{"indexDescriptor":"by_value","fields":["value"],"fields":["other"]}]}]}'))
      .toMatchObject({ failure: { cause: { phase: "raw" } } });
    expect(Result.getOrThrow(parseCoreSchema('[[["items",[]]],true]'))).toEqual(Result.getOrThrow(captureCoreSchema({
      tables: [{ tableName: "items", indexes: [] }], schemaValidation: true })));
    const lastField = Result.getOrThrow(parseCoreSchema('{"tables":[{"tableName":"items","indexes":[],"documentType":{"type":"object","value":{"value":{"fieldType":{"type":"number"},"optional":false},"value":{"fieldType":{"type":"string"},"optional":false}}}}]}'));
    expect(lastField.tables[0]?.documentType).toEqual(object({ value: { type: "string" } }));
  });

  it("refuses malformed vector raw numbers before semantic validator failures", () => {
    for (const dimensions of ["1.0", "-0", "4294967296", '"3"']) {
      const raw = `{"tables":[{"tableName":"items","indexes":[],"documentType":{"type":"id","tableName":""},"vectorIndexes":[{"indexDescriptor":"by_vector","vectorField":"vector","dimensions":${dimensions},"filterFields":[]}]}]}`;
      expect(parseCoreSchema(raw)).toMatchObject({ failure: { cause: { phase: "raw" } } });
    }
    expect(parseCoreSchema('{"tables":[{"tableName":"items","indexes":[],"vectorIndexes":[{"indexDescriptor":"by_vector","vectorField":"vector","dimensions":3,"filterFields":[]}]}]}'))
      .toMatchObject({ failure: { reason: "unsupportedCapability" } });
  });

  it("accepts the actual root variants for active and staged definitions and collapses only singleton object unions", () => {
    const first = object({ first: { type: "string" } });
    const second = object({ second: { type: "number" } });
    for (const root of [{ type: "any" }, { type: "union", value: [] }, first,
      { type: "union", value: [first, second] }]) {
      expect(document(root, root)).toMatchObject({ documentType: root, stagedDocumentType: root });
    }
    expect(document({ type: "union", value: [first] }, { type: "union", value: [second] }))
      .toMatchObject({ documentType: first, stagedDocumentType: second });
    for (const root of [{ type: "union", value: [{ type: "any" }] },
      { type: "union", value: [{ type: "union", value: [first] }] }]) {
      expect(Result.isFailure(parse(root))).toBe(true);
      expect(Result.isFailure(parse(first, root))).toBe(true);
    }
  });

  it("parses children before filtering every top-level underscore field and before finite serialization", () => {
    const root = object({ _custom: { type: "literal", value: NaN }, _creationTime: { type: "number" },
      nested: object({ _retained: { type: "number" } }), fn: { type: "function", args: object({ _argument: { type: "string" } }) } });
    const captured = Result.getOrThrow(captureCoreSchema(declaration(root, root)));
    const expected = object({ nested: object({ _retained: { type: "number" } }),
      fn: { type: "function", args: object({ _argument: { type: "string" } }) } });
    expect(captured.tables[0]).toMatchObject({ documentType: expected, stagedDocumentType: expected });
    expect(Result.isSuccess(serializeCoreSchema(captured))).toBe(true);
    expect(parse(sourceObject({ _removed: { type: "literal", value: { $float: "bad" } } })))
      .toMatchObject({ failure: { cause: { phase: "semantic" } } });
    const filteredSource = sourceObject({ _removed: { type: "literal", value: { $float: "AAAAAAAA+H8=" } } });
    expect(document(filteredSource)?.documentType).toEqual(object({}));
  });

  it("does not impose general value object field limits on validator declarations", () => {
    const fields: Record<string, ValidatorJsonV1> = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [`field${index}`, { type: "string" }]));
    const captured = Result.getOrThrow(captureCoreSchema(declaration(object(fields))));
    const source = Result.getOrThrow(serializeCoreSchema(captured));
    expect(Result.getOrThrow(parseCoreSchema(source))).toEqual(captured);
  });

  it("does not impose the displaced node budget when a declaration shares a large member list", () => {
    const leaf: ValidatorJsonV1 = { type: "string" };
    const captured = Result.getOrThrow(captureCoreSchema(declaration(object({ value: {
      type: "union", value: Array.from({ length: 65_537 }, () => leaf),
    } }))));
    expect(Result.isSuccess(serializeCoreSchema(captured))).toBe(true);
  }, 20_000);

  it("walks shared validator DAGs once per comparison or reference query", () => {
    let left: ValidatorJsonV1 = { type: "string" };
    let right: ValidatorJsonV1 = { type: "string" };
    for (let depth = 0; depth < 25; depth++) {
      left = object({ first: left, second: left });
      right = object({ first: right, second: right });
    }
    expect(coreValidatorsEqual(left, right)).toBe(true);
    expect(coreValidatorIsSubset(left, right)).toBe(true);
    expect(coreValidatorReferences(left, "absent")).toBe(false);
  });

  it("retains the source record serializer bytes and hashes without an identity marker", async () => {
    const validator = object({ records: { type: "record", keys: { type: "string" }, values: { type: "string" } } });
    const expected = '{"type":"object","value":{"records":{"fieldType":{"type":"record","keys":{"type":"string"},"values":{"fieldType":{"type":"string"},"optional":false}},"optional":false}}}';
    expect(Result.getOrThrow(serializeCoreDocumentValidator(validator))).toBe(expected);
    expect(await Effect.runPromise(coreDocumentValidatorHash(validator))).toBe(createHash("sha256").update(expected).digest("hex"));
    expect(Result.getOrThrow(serializeCoreSchema(Result.getOrThrow(captureCoreSchema(declaration(validator)))))).not.toContain("validatorIdentityEncoding");
  });

  it("uses source union field containment for ordinary and staged index declarations", () => {
    const validator: ValidatorJsonV1 = { type: "union", value: [object({ branch: object({ leaf: { type: "string" } }) }), object({ alternate: { type: "number" } })] };
    const capture = (field: string) => Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{
      tableName: "items", documentType: validator, indexes: [{ indexDescriptor: "by_branch", fields: [field] }],
      stagedDbIndexes: [{ indexDescriptor: "by_alternate", fields: ["alternate"] }],
    }] }));
    expect(Result.isSuccess(checkCoreSchemaIndexReferences(capture("branch.leaf")))).toBe(true);
    expect(Result.isFailure(checkCoreSchemaIndexReferences(capture("branch.absent")))).toBe(true);
    const inherited = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{ tableName: "items",
      documentType: object({}), indexes: [{ indexDescriptor: "by_constructor", fields: ["constructor"] }] }] }));
    expect(Result.isFailure(checkCoreSchemaIndexReferences(inherited))).toBe(true);
    const constructorValidator: ValidatorJsonV1 = { type: "string" };
    expect(coreValidatorIsSubset(object({}), object({ constructor: constructorValidator }))).toBe(false);
  });

  it("keeps Function signatures in serialization/equality but excludes their IDs from references and subset constraints", () => {
    const left: ValidatorJsonV1 = { type: "function", fnType: "query", args: object({ target: { type: "id", tableName: "other" } }), returns: { type: "commitTs" } };
    const right: ValidatorJsonV1 = { type: "function", fnType: "mutation", args: { type: "any" } };
    expect(coreValidatorsEqual(left, right)).toBe(false);
    expect(coreValidatorIsSubset(left, right)).toBe(true);
    expect(coreValidatorIsSubset(right, left)).toBe(true);
    expect(coreValidatorIsSubset(left, { type: "string" })).toBe(true);
    expect(coreValidatorIsSubset({ type: "literal", value: "function://handle" }, left)).toBe(false);
    expect(coreValidatorReferences(left, "other")).toBe(false);
    expect(Result.getOrThrow(serializeCoreDocumentValidator(left))).toBe('{"type":"function","fnType":"query","args":{"type":"object","value":{"target":{"fieldType":{"type":"id","tableName":"other"},"optional":false}}},"returns":{"type":"commitTs"}}');
    expect(coreValidatorIsSubset({ type: "commitTs" }, { type: "bigint" })).toBe(true);
    expect(coreValidatorIsSubset({ type: "bigint" }, { type: "commitTs" })).toBe(true);
    expect(coreValidatorIsSubset({ type: "literal", value: 1n }, { type: "commitTs" })).toBe(true);
    expect(coreValidatorsEqual({ type: "commitTs" }, { type: "bigint" })).toBe(false);
  });
});

import { Result } from "effect";
import { expect, it } from "vitest";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import type { CoreSchemaDefinition } from "../../src/core/schemaTypes";
import { parseCoreSchema, serializeCoreDocumentValidator, serializeCoreSchema } from "../../src/core/schemaJson";
import { captureCoreSchema } from "../../src/core/schemaTypes";

it("refuses exponentially expanded source validators before materializing system metadata", () => {
  let validator: ValidatorJsonV1 = { type: "string" };
  for (let index = 0; index < 40; index++) validator = { type: "union", value: [validator, validator] };
  expect(serializeCoreDocumentValidator(validator)).toMatchObject({
    _tag: "Failure", failure: { reason: "invalidSchema", cause: { reason: "bytesExceeded" } },
  });
});

it("bounds the complete schema string before joining repeated individually supported declarations", () => {
  const documentType: ValidatorJsonV1 = { type: "object", value: { payload: {
    fieldType: { type: "literal", value: "x".repeat(1024 * 1024) }, optional: false,
  } } };
  const schema: CoreSchemaDefinition = { schemaValidation: true,
    tables: Array.from({ length: 40 }, (_value, index) => ({ tableName: "items" + index,
      documentType, indexes: [], stagedDbIndexes: [] })),
  };
  expect(Result.isSuccess(serializeCoreDocumentValidator(documentType))).toBe(true);
  expect(serializeCoreSchema(schema)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidSchema" } });
});

it("round trips enforced and staged signed zero at the complete Source schema container boundary", () => {
  let documentType = '{"type":"literal","value":-0}';
  for (let index = 0; index < 120; index++) documentType = '{"type":"array","value":' + documentType + '}';
  documentType = '{"type":"object","value":{"payload":{"fieldType":' + documentType + ',"optional":false}}}';
  const raw = '{"tables":[{"tableName":"items","indexes":[],"stagedDbIndexes":[],"documentType":' + documentType
    + ',"stagedDocumentType":' + documentType + '}],"schemaValidation":true}';
  const parsed = Result.getOrThrow(parseCoreSchema(raw));
  const serialized = Result.getOrThrow(serializeCoreSchema(parsed));
  expect(serialized).toContain('"value":-0.0');
  expect(serialized).not.toContain("$float");
  expect(Result.getOrThrow(parseCoreSchema(serialized))).toEqual(parsed);
  for (const count of [121, 130]) {
    let payload: ValidatorJsonV1 = { type: "literal", value: -0 };
    for (let index = 0; index < count; index++) payload = { type: "array", value: payload };
    const over = { type: "object" as const, value: { payload: { fieldType: payload, optional: false } } };
    for (const [documentType, stagedDocumentType] of [[over, undefined], [undefined, over]]) {
      const schema = Result.getOrThrow(captureCoreSchema({ tables: [{ tableName: "items", indexes: [], stagedDbIndexes: [],
        ...(documentType === undefined ? {} : { documentType }), ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) }],
        schemaValidation: true }));
      expect(serializeCoreSchema(schema)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidSchema", cause: { reason: "recursionLimit" } } });
    }
  }
});

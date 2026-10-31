import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { captureSchemaManifestAppTableDeclarationsV1Result, encodeSchemaManifestAppDocumentDefinitionV2,
  SchemaManifestAppDocumentDefinitionV2Schema } from "../src/schema-manifest";
import { decodeValidatorSourceTextResult, SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS } from "../src/validator-source";
import { measureValidatorSourceResult, serializeValidatorSourceResult } from "../src/validator-source-serialization";
import type { ValidatorJsonV1 } from "../src/validator-json-core";

const literal = '{"type":"literal","value":-0}';
const array = (value: string) => '{"type":"array","value":' + value + '}';
const object = (value: string) => '{"type":"object","value":{"payload":{"fieldType":' + value + ',"optional":false}}}';
const record = (value: string) => '{"type":"record","keys":{"type":"string"},"values":{"fieldType":' + value + ',"optional":false}}';
const fn = (value: string) => '{"type":"function","returns":' + value + '}';
const union = (value: string) => '{"type":"union","value":[' + value + ']}';
const nest = (wrap: (value: string) => string, count: number) => {
  let value = literal;
  for (let index = 0; index < count; index++) value = wrap(value);
  return value;
};

describe("normalized backend Source serialization", () => {
  it.each([
    ["arrays", nest(array, 123)],
    ["objects", nest(object, 41)],
    ["records", array(nest(record, 61))],
    ["functions", nest(fn, 123)],
    ["unions", array(nest(union, 61))],
  ] as const)("round trips signed zero at the 127 raw-container boundary through %s", (_name, payload) => {
    const input = { kind: "appDocument", definitionVersion: 2, documentType: object(payload) };
    const decoded = Schema.decodeUnknownSync(SchemaManifestAppDocumentDefinitionV2Schema)(input);
    const metrics = measureValidatorSourceResult(decoded.documentType, { maximumRawContainers: SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS });
    expect(metrics).toMatchObject({ ok: true, value: { rawContainers: 127 } });
    const encoded = encodeSchemaManifestAppDocumentDefinitionV2(decoded);
    expect(encoded.documentType).toContain('"value":-0.0');
    expect(encoded.documentType).not.toContain("$float");
    expect(Schema.decodeUnknownSync(SchemaManifestAppDocumentDefinitionV2Schema)(encoded)).toEqual(decoded);
    expect(Result.isFailure(Schema.decodeUnknownResult(SchemaManifestAppDocumentDefinitionV2Schema)({
      ...input, documentType: object(array(payload)),
    }))).toBe(true);
  });

  it("refuses semantic declarations whose emitted Source text could not be read", () => {
    let payload: ValidatorJsonV1 = { type: "literal", value: -0 };
    for (let index = 0; index < 130; index++) payload = { type: "array", value: payload };
    const documentType = { type: "object" as const, value: { payload: { fieldType: payload, optional: false } } };
    const definition = { kind: "appDocument", definitionVersion: 2, documentType };
    expect(Result.isFailure(captureSchemaManifestAppTableDeclarationsV1Result([{ logicalName: "items", definition }]))).toBe(true);
    expect(Result.isFailure(Schema.encodeUnknownResult(SchemaManifestAppDocumentDefinitionV2Schema)(definition))).toBe(true);
  });

  it("measures shared graphs before expansion against the actual metadata string ceiling", () => {
    let payload: ValidatorJsonV1 = { type: "string" };
    for (let index = 0; index < 40; index++) payload = { type: "union", value: [payload, payload] };
    expect(measureValidatorSourceResult(payload)).toMatchObject({ ok: false, issue: { reason: "bytesExceeded" } });
    expect(serializeValidatorSourceResult(payload)).toMatchObject({ ok: false, issue: { reason: "bytesExceeded" } });
    expect(Result.isFailure(captureSchemaManifestAppTableDeclarationsV1Result([{ logicalName: "items", definition: {
      kind: "appDocument", definitionVersion: 2, documentType: { type: "object", value: { payload: { fieldType: payload, optional: false } } },
    } }]))).toBe(true);
  });

  it("preserves wide declarations, Unicode/NUL literals and exact UTF8 measurements", () => {
    const fields = Object.fromEntries(Array.from({ length: 1025 }, (_value, index) => ["field" + index,
      { fieldType: { type: "literal" as const, value: "before\0after😀" }, optional: false }]));
    const validator: ValidatorJsonV1 = { type: "object", value: fields };
    const serialized = serializeValidatorSourceResult(validator, { maximumRawContainers: SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS });
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(measureValidatorSourceResult(validator)).toEqual({ ok: true, value: {
      bytes: new TextEncoder().encode(serialized.value).byteLength, rawContainers: 4,
    } });
    const decoded = decodeValidatorSourceTextResult(serialized.value);
    expect(decoded).toEqual({ ok: true, value: validator });
    const definition = Schema.decodeUnknownSync(SchemaManifestAppDocumentDefinitionV2Schema)({
      kind: "appDocument", definitionVersion: 2, documentType: serialized.value,
    });
    expect(Schema.decodeUnknownSync(SchemaManifestAppDocumentDefinitionV2Schema)(encodeSchemaManifestAppDocumentDefinitionV2(definition)))
      .toEqual(definition);
  });
});

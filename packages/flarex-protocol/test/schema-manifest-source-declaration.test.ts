import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { canonicalizeSchemaManifestV1, captureSchemaManifestAppTableDeclarationsV1Result,
  decodeSchemaManifestAppTableDeclarationsV1Result, encodeSchemaManifestAppDocumentDefinition,
  SchemaManifestAppDocumentDefinitionV2Schema } from "../src/schema-manifest";

describe("current private source document declarations", () => {
  it("uses the source text owner for duplicate, field-name, recursion and optional-record refusals", () => {
    let nested = '{"type":"number"}';
    for (let index = 0; index < 127; index += 1) nested = '{"type":"array","value":' + nested + '}';
    for (const documentType of [
      '{"type":"object","type":"any","value":{}}',
      '{"type":"object","value":{"$bad":{"fieldType":{"type":"string"},"optional":false}}}',
      '{"type":"object","value":{"deep":{"fieldType":' + nested + ',"optional":false}}}',
      '{"type":"object","value":{"scores":{"fieldType":{"type":"record","keys":{"type":"string"},"values":{"fieldType":{"type":"number"},"optional":true}},"optional":false}}}',
    ]) expect(Result.isFailure(Schema.decodeUnknownResult(SchemaManifestAppDocumentDefinitionV2Schema)({
      kind: "appDocument", definitionVersion: 2, documentType,
    }))).toBe(true);
  });
  it("stores Source DTO JSON text in V2 and preserves literal NUL through the JSONB-safe envelope", async () => {
    const documentType = { type: "object" as const, value: {
      text: { fieldType: { type: "literal" as const, value: "before\0after\n😀" }, optional: false },
      scores: { fieldType: { type: "record" as const, keys: { type: "string" as const }, values: { type: "number" as const } }, optional: false },
    } };
    const captured = Result.getOrThrow(captureSchemaManifestAppTableDeclarationsV1Result([{ logicalName: "items",
      definition: { kind: "appDocument", definitionVersion: 2, documentType } }]));
    const first = captured[0];
    if (first === undefined) throw new Error("Missing captured declaration");
    const wire = { logicalName: first.logicalName, definition: encodeSchemaManifestAppDocumentDefinition(first.definition) };
    expect(typeof wire.definition.documentType).toBe("string");
    expect(wire.definition.documentType).toContain('"values":{"fieldType":{"type":"number"},"optional":false}');
    expect(wire.definition.documentType).toContain("\\u0000");
    const canonical = await canonicalizeSchemaManifestV1({ declarations: [wire] });
    const declarations = (canonical.manifestJson.declarations);
    expect(Result.getOrThrow(decodeSchemaManifestAppTableDeclarationsV1Result(declarations))).toEqual(captured);
    expect(Result.isFailure(captureSchemaManifestAppTableDeclarationsV1Result([{ logicalName: "items",
      definition: { kind: "appDocument", definitionVersion: 1, documentType } }]))).toBe(true);
  });

  it("normalizes source roots and rejects unknown definition versions and scalar document roots", () => {
    const encoded = { kind: "appDocument", definitionVersion: 2, documentType: JSON.stringify({ type: "union", value: [
      { type: "object", value: { _filtered: { fieldType: { type: "number" }, optional: false },
        value: { fieldType: { type: "string" }, optional: false } } },
    ] }) };
    expect(Schema.decodeUnknownSync(SchemaManifestAppDocumentDefinitionV2Schema)(encoded).documentType).toEqual({ type: "object",
      value: { value: { fieldType: { type: "string" }, optional: false } } });
    expect(Result.isFailure(decodeSchemaManifestAppTableDeclarationsV1Result([{ logicalName: "items",
      definition: { ...encoded, definitionVersion: 3 } }]))).toBe(true);
    expect(Result.isFailure(decodeSchemaManifestAppTableDeclarationsV1Result([{ logicalName: "items",
      definition: { ...encoded, documentType: '{"type":"string"}' } }]))).toBe(true);
  });
});

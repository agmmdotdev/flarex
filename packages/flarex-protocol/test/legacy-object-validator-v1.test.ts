import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeLegacyObjectValidatorJsonResultCoreV1,
  decodeLegacyObjectValidatorJsonWireResultCoreV1,
  decodeLegacyValidatorJsonResultCoreV1,
  decodeLegacyValidatorJsonWireResultCoreV1,
  type ObjectValidatorJsonV1,
  type ValidatorJsonV1,
} from "../src/validator-json-core";
import { LegacyObjectValidatorJsonWireCodecV1, ValidatorJsonWireCodecV1 } from "../src/validator-json";
import { SchemaManifestAppDocumentDefinitionV2Schema } from "../src/schema-manifest";

const decodeWire = Schema.decodeUnknownResult(LegacyObjectValidatorJsonWireCodecV1);
const decodeSemantic = Schema.decodeUnknownResult(Schema.toType(LegacyObjectValidatorJsonWireCodecV1));
const encode = Schema.encodeSync(LegacyObjectValidatorJsonWireCodecV1);

function objectFields(count: number): ObjectValidatorJsonV1 {
  const value: Record<string, { readonly fieldType: ValidatorJsonV1; readonly optional: boolean }> = {};
  for (let index = 0; index < count; index += 1) value[`f${index}`] = { fieldType: { type: "number" }, optional: false };
  return { type: "object", value };
}
function objectChild(fieldType: ValidatorJsonV1): ObjectValidatorJsonV1 {
  return { type: "object", value: { payload: { fieldType, optional: false } } };
}
function nestedArrays(count: number, inner: ValidatorJsonV1 = { type: "number" }): ValidatorJsonV1 {
  let value = inner;
  for (let index = 0; index < count; index += 1) value = { type: "array", value };
  return value;
}
function allCodecPaths(value: ObjectValidatorJsonV1, accepted: boolean): void {
  expect(Result.isSuccess(decodeWire(value))).toBe(accepted);
  expect(Result.isSuccess(decodeSemantic(value))).toBe(accepted);
  if (accepted) expect(() => encode(value)).not.toThrow();
  else expect(() => encode(value)).toThrow();
}

describe("frozen appDocument V1 object admission", () => {
  it("retains 1024 fields across encoded, semantic and encode paths", () => {
    allCodecPaths(objectFields(1024), true);
    const over = objectFields(1025);
    allCodecPaths(over, false);
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(over)).toMatchObject({ ok: false, issue: { reason: "tooManyObjectFields", segments: ["value"] } });
    expect(decodeLegacyObjectValidatorJsonWireResultCoreV1(over)).toMatchObject({ ok: false, issue: { reason: "tooManyObjectFields" } });
  });

  it("counts 65536 logical occurrences while retaining shared captured DAG nodes", () => {
    const shared = nestedArrays(1);
    // Root + union + 32767 occurrences of (array + number) = 65536.
    const at = objectChild({ type: "union", value: Array.from({ length: 32767 }, () => shared) });
    const over = objectChild({ type: "union", value: Array.from({ length: 32768 }, () => shared) });
    allCodecPaths(at, true);
    allCodecPaths(over, false);
    const captured = decodeLegacyObjectValidatorJsonResultCoreV1(at);
    expect(captured.ok).toBe(true);
    if (captured.ok && captured.value.type === "object") {
      const child = captured.value.value.payload?.fieldType;
      if (child?.type !== "union") throw new Error("Expected the captured union");
      expect(child.value[0]).toBe(child.value[1]);
    }
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(over)).toMatchObject({ ok: false, issue: { reason: "tooManyNodes" } });
  });

  it("retains logical depth 128 with the object root at depth one", () => {
    // Object root + 126 arrays + scalar = 128 logical validator levels.
    allCodecPaths(objectChild(nestedArrays(126)), true);
    const over = objectChild(nestedArrays(127));
    allCodecPaths(over, false);
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(over)).toMatchObject({ ok: false, issue: { reason: "tooDeep" } });
  });

  it("keeps baseline node-before-depth and union-length-before-member error order", () => {
    const shared: ValidatorJsonV1 = { type: "number" };
    const terminal = nestedArrays(126);
    // Terminal scalar is at depth 129 and is logical occurrence 65536/65537.
    const depthFirst = objectChild({ type: "union", value: [...Array.from({ length: 65407 }, () => shared), terminal] });
    const nodesFirst = objectChild({ type: "union", value: [...Array.from({ length: 65408 }, () => shared), terminal] });
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(depthFirst)).toMatchObject({ ok: false, issue: { reason: "tooDeep" } });
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(nodesFirst)).toMatchObject({ ok: false, issue: { reason: "tooManyNodes" } });
    const missingMembers: unknown[] = new Array(65535);
    expect(decodeLegacyObjectValidatorJsonResultCoreV1({ type: "object", value: { payload: { fieldType: { type: "union", value: missingMembers }, optional: false } } })).toMatchObject({ ok: false, issue: { reason: "tooManyNodes", segments: ["value", "payload", "fieldType"] } });
  });

  it("replays the exact descendant node refusal when a reused subtree crosses the remaining budget", () => {
    const shared = nestedArrays(1);
    const filler: ValidatorJsonV1 = { type: "number" };
    function fixture(count: number): ObjectValidatorJsonV1 {
      return { type: "object", value: {
        seed: { fieldType: shared, optional: false },
        filler: { fieldType: { type: "union", value: Array.from({ length: count }, () => filler) }, optional: false },
        late: { fieldType: shared, optional: false },
      } };
    }
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(fixture(65530)).ok).toBe(true);
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(fixture(65531))).toMatchObject({ ok: false,
      issue: { reason: "tooManyNodes", segments: ["value", "late", "fieldType", "value"] } });
  });

  it("replays the exact descendant depth refusal when a reused subtree occurs deeper", () => {
    const shared = nestedArrays(10);
    function fixture(prefixDepth: number): ObjectValidatorJsonV1 {
      return { type: "object", value: {
        seed: { fieldType: shared, optional: false },
        late: { fieldType: nestedArrays(prefixDepth, shared), optional: false },
      } };
    }
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(fixture(116)).ok).toBe(true);
    expect(decodeLegacyObjectValidatorJsonResultCoreV1(fixture(117))).toMatchObject({ ok: false,
      issue: { reason: "tooDeep", segments: ["value", "late", "fieldType", ...Array.from({ length: 127 }, () => "value")] } });
  });

  it("refuses oversize object maps before reading fields and preserves cycle refusal", () => {
    let reads = 0;
    const fields = { ...objectFields(1024).value };
    Object.defineProperty(fields, "extra", { enumerable: true, get() { reads += 1; return {}; } });
    expect(decodeLegacyObjectValidatorJsonResultCoreV1({ type: "object", value: fields })).toMatchObject({ ok: false, issue: { reason: "tooManyObjectFields" } });
    expect(reads).toBe(0);
    const cyclic: { type: "array"; value?: unknown } = { type: "array" }; cyclic.value = cyclic;
    expect(decodeLegacyObjectValidatorJsonResultCoreV1({ type: "object", value: { payload: { fieldType: cyclic, optional: false } } })).toMatchObject({ ok: false, issue: { reason: "malformedContainer" } });
  });

  it("keeps Source V2/current wire and generic historical formats outside this policy", () => {
    const over = objectFields(1025);
    expect(Result.isSuccess(Schema.decodeUnknownResult(SchemaManifestAppDocumentDefinitionV2Schema)({ kind: "appDocument", definitionVersion: 2, documentType: JSON.stringify(over) }))).toBe(true);
    expect(Result.isSuccess(Schema.decodeUnknownResult(ValidatorJsonWireCodecV1)(over))).toBe(true);
    expect(decodeLegacyValidatorJsonResultCoreV1(over).ok).toBe(true);
    expect(decodeLegacyValidatorJsonWireResultCoreV1(over).ok).toBe(true);
  });
});

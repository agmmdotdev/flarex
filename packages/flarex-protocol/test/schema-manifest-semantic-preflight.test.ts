import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { captureSchemaManifestAppTableDeclarationsV1Result, SchemaManifestSemanticInputSchema } from "../src/schema-manifest";
import type { ValidatorJsonV1 } from "../src/validator-json";

describe("semantic schema manifest own-data capture", () => {
  it("reaches the typed Source refusal for ten thousand nested semantic validators", () => {
    let child: ValidatorJsonV1 = { type: "number" };
    for (let index = 0; index < 10_000; index++) child = { type: "array", value: child };
    const result = captureSchemaManifestAppTableDeclarationsV1Result([{ logicalName: "items", definition: {
      kind: "appDocument", definitionVersion: 2,
      documentType: { type: "object", value: { payload: { fieldType: child, optional: false } } },
    } }]);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(Schema.isSchemaError(result.failure)).toBe(true);
      expect(result.failure.message).toContain("Source JSON recursion limit exceeded");
    }
  });

  it("keeps graph sharing, cycle refusal and descriptor-only traversal", () => {
    const decode = Schema.decodeUnknownResult(SchemaManifestSemanticInputSchema);
    let child: unknown = { value: "shared" };
    for (let index = 0; index < 1000; index++) child = { first: child, second: child };
    expect(Result.isSuccess(decode(child))).toBe(true);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(Result.isFailure(decode(cyclic))).toBe(true);
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: () => { getterCalls++; return "foreign"; } });
    expect(Result.isFailure(decode(accessor))).toBe(true);
    expect(getterCalls).toBe(0);
    const array = new Proxy(["plain"], { get: () => { getterCalls++; throw new Error("No property access is allowed"); } });
    expect(Result.isSuccess(decode(array))).toBe(true);
    expect(getterCalls).toBe(0);
    expect(Result.isFailure(decode(["plain", , "sparse"]))).toBe(true);
    expect(Result.isFailure(decode(Object.create({ inherited: true })))).toBe(true);
  });

  it("parses the captured graph when a later Proxy mutates an earlier foreign node", () => {
    const earlier: Record<string, unknown> = { label: "captured" };
    const trigger = new Proxy({ value: "trigger" }, { getOwnPropertyDescriptor(target, key) {
      earlier.unsafe = () => "foreign";
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    const captured = Result.getOrThrow(Schema.decodeUnknownResult(SchemaManifestSemanticInputSchema)({
      first: earlier, trigger, again: earlier,
    }));
    expect(typeof earlier.unsafe).toBe("function");
    expect(captured).toEqual({ first: { label: "captured" }, trigger: { value: "trigger" }, again: { label: "captured" } });
    const fields = Schema.decodeUnknownSync(Schema.Struct({ first: Schema.Unknown, again: Schema.Unknown }))(captured);
    expect(fields.first).toBe(fields.again);
    expect(Object.isFrozen(fields.first)).toBe(true);
  });
});

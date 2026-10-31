import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSchema, defineTable, query } from "flarex/server";
import { v } from "flarex/values";
import { analyzeLoadedSourcePackageEffect, analyzeSchemaDefinitionEffect, backendCodegenAnalysisFromCodegenAnalysisEffect } from "../src/index";
import { ApplicationManifestV1Schema, canonicalizeApplicationManifestWireV1, captureApplicationManifestV1, decodeApplicationManifestV1, makeApplicationManifestV1 } from "../src/applicationAnalysisV1";

function analyzeExports(args: string, returns = "null") {
  return analyzeLoadedSourcePackageEffect({
    schemaDefinition: undefined,
    executionModules: { source: { run: {
      isQuery: true, isPublic: true, _handler: async () => null,
      exportArgs: () => args, exportReturns: () => returns,
    } } }, sourceMaps: {},
  });
}

describe("source validator exporter translation", () => {
  it("accepts only JSON whitespace around an absent return validator", async () => {
    const args = '{"type":"any"}';
    expect((await Effect.runPromise(analyzeExports(args, " \t\r\nnull\n\r\t "))).functions[0]?.functions[0]?.returns).toBeNull();
    for (const text of ["\u00a0null", "null\u00a0", "\ufeffnull", "null\ufeff"]) {
      const result = await Effect.runPromise(Effect.result(analyzeExports(args, text)));
      if (Result.isSuccess(result)) throw new Error("Expected strict JSON refusal");
      expect(result.failure).toMatchObject({ cause: { phase: "raw", reason: "invalidJson" } });
    }
  });
  it("keeps serialized source record admission separate from semantic manifest capture", async () => {
    const schema = defineSchema({
      records: defineTable({ rows: v.record(v.string(), v.commitTs()) }),
      branches: defineTable(v.union(v.object({ rows: v.record(v.string(), v.number()) }), v.object({ label: v.string() }))),
    });
    const run = query({ args: { rows: v.record(v.string(), v.number()), maybe: v.union(v.record(v.string(), v.number()), v.null()) },
      returns: v.union(v.record(v.string(), v.commitTs()), v.null()), handler: async () => null });
    const analysis = await Effect.runPromise(analyzeLoadedSourcePackageEffect({ schemaDefinition: schema, executionModules: { records: { run } }, sourceMaps: {} }));
    const canonical = await Effect.runPromise(makeApplicationManifestV1(analysis, {
      rootSha256: "1".repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: "_flarex/schema.js",
      modules: [
        { path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 1 },
        { path: "_flarex/schema.js", roles: 2, sourceSha256: "3".repeat(64), sourceByteLength: 1 },
      ],
    }));
    const serialized: unknown = JSON.parse(canonical.canonicalText);
    const reopened = Result.getOrThrow(canonicalizeApplicationManifestWireV1(serialized));
    expect(reopened.canonicalBytes).toEqual(canonical.canonicalBytes);
    expect(Result.getOrThrow(Schema.decodeUnknownResult(ApplicationManifestV1Schema)(serialized))).toEqual(canonical.manifest);
    expect(Result.getOrThrow(captureApplicationManifestV1(canonical.manifest))).toEqual(canonical.manifest);
    const legacyBareWire: unknown = JSON.parse(JSON.stringify(canonical.manifest));
    expect(Result.isFailure(decodeApplicationManifestV1(legacyBareWire))).toBe(true);
    expect(Result.isFailure(Schema.decodeUnknownResult(ApplicationManifestV1Schema)(legacyBareWire))).toBe(true);
  });

  it("exports source record wrappers and advisory function signatures", async () => {
    const signature = v.function({ fnType: "mutation", args: { id: v.id("items") }, returns: v.commitTs() });
    const registered = query({ args: { callback: signature, values: v.record(v.string(), v.commitTs()) }, handler: async () => null });
    expect(v.record(v.string(), v.number()).json).toEqual({
      type: "record", keys: { type: "string" }, values: { fieldType: { type: "number" }, optional: false },
    });
    const analyzed = await Effect.runPromise(analyzeExports(registered.exportArgs()));
    expect(analyzed.functions[0]?.functions[0]?.args).toMatchObject({ type: "object", value: {
      callback: { fieldType: { type: "function", fnType: "mutation", returns: { type: "commitTs" } } },
      values: { fieldType: { type: "record", values: { type: "commitTs" } } },
    } });
  });

  it("retains duplicate known members instead of letting JSON.parse erase them", async () => {
    const result = await Effect.runPromise(Effect.result(analyzeExports('{"type":"any","type":"object","value":{}}')));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({ cause: { phase: "raw" } });
  });

  it("accepts serde sequence fields and deprecated map/set aliases", async () => {
    const result = await Effect.runPromise(analyzeExports('{"type":"object","value":{"maps":[{"type":"map"},false],"sets":[{"type":"set"},true]}}'));
    expect(result.functions[0]?.functions[0]?.args).toEqual({ type: "object", value: {
      maps: { fieldType: { type: "any" }, optional: false }, sets: { fieldType: { type: "any" }, optional: true },
    } });
  });

  it("finishes raw DTO parsing before record key semantics", async () => {
    const result = await Effect.runPromise(Effect.result(analyzeExports('{"type":"object","value":{"rows":{"fieldType":{"type":"record","keys":{"type":"number"},"values":{"fieldType":{"type":"literal","value":{"$integer":"bad"}}}},"optional":false}}}')));
    if (Result.isSuccess(result)) throw new Error("Expected raw wrapper refusal");
    expect(result.failure).toMatchObject({ cause: { phase: "raw" } });
    expect(result.failure).not.toHaveProperty("code", "InvalidRecordType");
  });

  it("parses return semantics before finite argument completion", async () => {
    const args = query({ args: { number: v.literal(Infinity) }, handler: async () => null }).exportArgs();
    const result = await Effect.runPromise(Effect.result(analyzeExports(args, '{"type":"id","tableName":""}')));
    if (Result.isSuccess(result)) throw new Error("Expected return semantic refusal");
    expect(result.failure.message).toContain("exportReturns");
    expect(result.failure.message).not.toContain("Infinite or NaN");
    const valid = await Effect.runPromise(analyzeExports(args));
    const finite = await Effect.runPromise(Effect.result(backendCodegenAnalysisFromCodegenAnalysisEffect(valid)));
    if (Result.isSuccess(finite)) throw new Error("Expected finite refusal");
    expect(finite.failure.message).toBe("Infinite or NaN values are not supported in literal validators.");
  });
});

describe("source table normalization", () => {
  it("preserves removed authoring children until source admission rejects them", async () => {
    const schema = defineSchema({ items: defineTable({ _removed: v.record(v.literal("reserved"), v.string()), valid: v.string() }) });
    expect(schema.tables.items.validator.json).toHaveProperty("value._removed");
    const result = await Effect.runPromise(Effect.result(analyzeSchemaDefinitionEffect(schema)));
    if (Result.isSuccess(result)) throw new Error("Expected removed invalid child refusal");
    expect(result.failure).toMatchObject({ cause: { cause: { phase: "semantic", reason: "stringLiteralRecordKey" } } });
    let removed: import("flarex/values").Validator<unknown, "required", string> = v.string();
    for (let depth = 0; depth < 130; depth += 1) removed = v.array(removed);
    const tooDeep = defineSchema({ items: defineTable({ _removed: removed, valid: v.string() }) });
    const depthResult = await Effect.runPromise(Effect.result(analyzeSchemaDefinitionEffect(tooDeep)));
    if (Result.isSuccess(depthResult)) throw new Error("Expected original Source JSON nesting refusal");
    expect(depthResult.failure).toMatchObject({ cause: { cause: { phase: "raw", reason: "recursionLimit" } } });
  });
  it("admits any, empty union and object unions, collapsing only singletons", async () => {
    const schema = defineSchema({
      any: defineTable(v.any()), empty: defineTable(v.union()),
      singleton: defineTable(v.union(v.object({ name: v.string() }))),
      branches: defineTable(v.union(v.object({ a: v.string() }), v.object({ b: v.number() }))),
    });
    const result = await Effect.runPromise(analyzeSchemaDefinitionEffect(schema));
    expect(result.tables.map(table => [table.name, table.validator.type])).toEqual([
      ["any", "any"], ["branches", "union"], ["empty", "union"], ["singleton", "object"],
    ]);
    expect(result.tables.find(table => table.name === "empty")?.validator).toEqual({ type: "union", value: [] });
  });

  it("parses all children before removing top-level underscore fields and finite conversion", async () => {
    const schema = defineSchema({ items: defineTable({ _private: v.literal(NaN), nested: v.object({ _kept: v.string() }) }) });
    const result = await Effect.runPromise(analyzeSchemaDefinitionEffect(schema));
    expect(result.tables[0]?.validator).toEqual({ type: "object", value: {
      nested: { fieldType: { type: "object", value: { _kept: { fieldType: { type: "string" }, optional: false } } }, optional: false },
    } });
    const invalid = defineSchema({ items: defineTable({ _private: v.id("") }) });
    expect(Result.isFailure(await Effect.runPromise(Effect.result(analyzeSchemaDefinitionEffect(invalid))))).toBe(true);
  });

  it("admits 1,025 declaration fields independently of data-object limits", async () => {
    const fields = Object.fromEntries(Array.from({ length: 1_025 }, (_, index) => [`field${index}`, v.optional(v.string())]));
    const result = await Effect.runPromise(analyzeSchemaDefinitionEffect(defineSchema({ items: defineTable(fields) })));
    const root = result.tables[0]?.validator;
    if (root?.type !== "object") throw new Error("Expected object root");
    expect(Object.keys(root.value)).toHaveLength(1_025);
  });
});

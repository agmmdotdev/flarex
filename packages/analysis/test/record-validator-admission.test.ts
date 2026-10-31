import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { defineSchema, defineTable, query } from "flarex/server";
import { isValidator, v, type GenericValidator, type ValidatorJSON, type Validator } from "flarex/values";
import {
  admitFreshDeploymentMetadataEffect,
  type AnalyzerProtocolSuccessResponse,
  analyzeLoadedSourcePackageEffect,
  analyzeSchemaDefinitionEffect,
  backendCodegenAnalysisFromCodegenAnalysisEffect,
  backendRequiredValidatorJsonEffect,
} from "../src/index";
import { decodeValidatorJsonWireV1 } from "flarex-protocol/validator-json";
import { captureDeploymentAnalysisEffect, captureDeploymentCodegenAnalysisEffect } from "flarex-protocol/deployment";
import { makeApplicationManifestV1 } from "../src/applicationAnalysisV1";

describe("source record validator admission", () => {
  it.each([
    ["int64 literal", () => v.literal(1n)],
    ["float literal", () => v.literal(1)],
    ["string literal", () => v.literal("only")],
    ["string union with literal", () => v.union(v.string(), v.literal("only"))],
    ["nonfinite key", () => v.literal(NaN)],
  ] as const)("exports %s before rejecting it during source parsing", async (_name, key) => {
    const registered = register(record(key(), v.number()));
    expect(typeof registered.exportArgs()).toBe("string");
    const result = await Effect.runPromise(Effect.result(analyze(registered)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({
      _tag: "AnalyzerValidatorError", code: "InvalidRecordType",
    });
  });

  it.each([
    ["string", () => v.string()],
    ["ID", () => v.id("items")],
    ["string and ID union", () => v.union(v.string(), v.id("items"))],
  ] as const)("keeps %s keys valid through complete manifest analysis", async (_name, key) => {
    const registered = register(record(key(), v.number()));
    const analysis = await Effect.runPromise(analyze(registered));
    const complete = await Effect.runPromise(makeApplicationManifestV1(analysis, sourceArtifact));
    expect(complete.manifest.functions[0]?.args).toEqual(analysis.functions[0]?.functions[0]?.args);
  });

  it("refuses a string literal key before finite serialization of its nonfinite value", async () => {
    const result = await Effect.runPromise(Effect.result(analyze(register(record(v.literal("only"), v.literal(Infinity))))));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({
      code: "InvalidRecordType", message: "Records cannot have string literal keys",
    });
  });

  it("retains finite serialization refusal after parsing valid record domains", async () => {
    const analysis = await Effect.runPromise(analyze(register(record(v.string(), v.literal(Infinity)))));
    const result = await Effect.runPromise(Effect.result(backendCodegenAnalysisFromCodegenAnalysisEffect(analysis)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "AnalyzerValidatorError", message: "Infinite or NaN values are not supported in literal validators.",
      });
      expect(result.failure).not.toHaveProperty("code");
    }
  });

  it("rejects invalid args record domains before inspecting malformed returns", async () => {
    const registered = register(record(v.literal(1n), v.number()));
    let returnsVisited = false;
    const result = await Effect.runPromise(Effect.result(analyze({
      ...registrationExports(registered),
      exportReturns: () => { returnsVisited = true; return '{"type":"id","tableName":""}'; },
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({ code: "InvalidRecordType" });
    expect(returnsVisited).toBe(false);
  });

  it("parses malformed returns before serializing valid-domain nonfinite args", async () => {
    const registered = register(record(v.string(), v.literal(Infinity)));
    let returnsVisited = false;
    const result = await Effect.runPromise(Effect.result(analyze({
      ...registrationExports(registered),
      exportReturns: () => { returnsVisited = true; return '{"type":"id","tableName":""}'; },
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: "AnalyzerValidatorError", message: expect.stringContaining("exportReturns") });
      expect(result.failure.message).not.toContain("Infinite or NaN");
    }
    expect(returnsVisited).toBe(true);
  });

  it.each([1n, NaN, Infinity, -0])("protects direct metadata builders from invalid key %s", async value => {
    const result = await Effect.runPromise(Effect.result(backendRequiredValidatorJsonEffect({
      type: "record", keys: { type: "literal", value }, values: { type: "number" },
    })));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({ code: "InvalidRecordType" });
  });
});

describe("source table record validator admission", () => {
  const invalidKeys = [
    ["int64 literal", () => v.literal(1n)],
    ["float literal", () => v.literal(1)],
    ["string literal", () => v.literal("only")],
    ["string union with literal", () => v.union(v.string(), v.literal("only"))],
    ["nonfinite key", () => v.literal(NaN)],
  ] as const;
  const invalidCases = invalidKeys.flatMap(([name, key]) => [
    { name: name + " with finite value", key, value: 1 },
    { name: name + " with nonfinite value", key, value: Infinity },
  ]);

  it.each(invalidCases)("constructs $name then rejects it before schema finite serialization", async ({ key, value }) => {
    const schema = defineSchema({ items: defineTable({ bad: record(key(), v.literal(value)) }) });
    const result = await Effect.runPromise(Effect.result(analyzeSchemaDefinitionEffect(schema)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({
      _tag: "AnalyzerSchemaError",
      cause: { _tag: "AnalyzerValidatorError", code: "InvalidRecordType" },
    });
  });

  it.each([
    ["string", () => v.string()],
    ["ID", () => v.id("items")],
    ["string and ID union", () => v.union(v.string(), v.id("items"))],
  ] as const)("keeps %s table record keys valid through complete metadata", async (_name, key) => {
    const schema = defineSchema({ items: defineTable({ values: record(key(), v.number()) }) });
    const analysis = await Effect.runPromise(analyzeLoadedSourcePackageEffect({ schemaDefinition: schema, executionModules: {}, sourceMaps: {} }));
    const complete = await Effect.runPromise(makeApplicationManifestV1(analysis, {
      ...sourceArtifact, schemaModulePath: "_flarex/schema.js",
      modules: [...sourceArtifact.modules, { path: "_flarex/schema.js", roles: 2, sourceSha256: "3".repeat(64), sourceByteLength: 1 }],
    }));
    expect(complete.manifest.schema.tables[0]?.validator).toEqual(analysis.schema.tables[0]?.validator);
  });

  it.each([NaN, Infinity, -Infinity])("retains the schema finite gate for valid-domain nonfinite value %s", async value => {
    const schema = defineSchema({ items: defineTable({ values: record(v.string(), v.literal(value)) }) });
    const result = await Effect.runPromise(Effect.result(analyzeSchemaDefinitionEffect(schema)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: "AnalyzerSchemaError", message: "Schema table declarations are invalid." });
      expect(result.failure.cause).not.toHaveProperty("code", "InvalidRecordType");
    }
  });
});

const sourceArtifact = {
  rootSha256: "1".repeat(64), executionModulePath: "_flarex/execution.js", schemaModulePath: null,
  modules: [{ path: "_flarex/execution.js", roles: 8, sourceSha256: "2".repeat(64), sourceByteLength: 1 }],
};

/** Exercise the JavaScript SDK entrypoint; the TypeScript key generic is not runtime admission. */
function record(key: unknown, value: unknown): Validator<unknown, "required", string> {
  const validator: unknown = Reflect.apply(v.record, undefined, [key, value]);
  if (!isRequiredTestValidator(validator)) throw new Error("Expected an SDK record validator");
  return validator;
}

function register(validator: GenericValidator) {
  return query({ args: { rows: validator }, returns: v.null(), handler: async () => null });
}

function registrationExports(registered: ReturnType<typeof register>) {
  return { isQuery: true, isPublic: true, _handler: async () => null,
    exportArgs: () => registered.exportArgs(), exportReturns: () => registered.exportReturns() };
}

function analyze(registered: unknown) {
  return analyzeLoadedSourcePackageEffect({ schemaDefinition: undefined,
    executionModules: { records: { run: registered } }, sourceMaps: {} });
}

describe("fresh deployment metadata source admission", () => {
  it.each(["analysis", "codegen"] as const)("validates %s argument and return source phases before finite completion", async side => {
    const nanArgs = exportedArgs(v.literal(NaN));
    const badReturns = exportedReturn(record(v.literal("only"), v.number()));
    const pair = freshPair(side === "analysis" ? nanArgs : exportedArgs(v.number()), side === "analysis" ? badReturns : null,
      side === "codegen" ? nanArgs : exportedArgs(v.number()), side === "codegen" ? badReturns : null);
    const result = await Effect.runPromise(Effect.result(admitFreshDeploymentMetadataEffect(pair)));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({
      code: "InvalidRecordType", message: "Records cannot have string literal keys",
      cause: { path: expect.stringContaining("exportReturns()") },
    });
  });

  it.each(["analysis", "codegen"] as const)("keeps %s argument parsing before return parsing", async side => {
    const args = exportedArgs(record(v.literal(1n), v.literal(Infinity)));
    const returns = exportedReturn(record(v.literal("only"), v.number()));
    const pair = freshPair(side === "analysis" ? args : exportedArgs(v.number()), side === "analysis" ? returns : null,
      side === "codegen" ? args : exportedArgs(v.number()), side === "codegen" ? returns : null);
    const result = await Effect.runPromise(Effect.result(admitFreshDeploymentMetadataEffect(pair)));
    if (Result.isSuccess(result)) throw new Error("Expected fresh source refusal");
    expect(result.failure).toMatchObject({ code: "InvalidRecordType", cause: { path: expect.stringContaining("exportArgs()") } });
    expect(result.failure.message).toContain("subtype of v.string()");
  });

  it.each(["analysis", "codegen"] as const)("keeps %s argument shape refusal before invalid return domains", async side => {
    const invalidArgs: ValidatorJSON = { type: "literal", value: 1 };
    const badReturns = exportedReturn(record(v.literal("only"), v.number()));
    const pair = freshPair(side === "analysis" ? invalidArgs : exportedArgs(v.number()), side === "analysis" ? badReturns : null,
      side === "codegen" ? invalidArgs : exportedArgs(v.number()), side === "codegen" ? badReturns : null);
    const result = await Effect.runPromise(Effect.result(admitFreshDeploymentMetadataEffect(pair)));
    if (Result.isSuccess(result)) throw new Error("Expected argument shape refusal");
    expect(result.failure.message).toContain("Argument validator must be an object validator or v.any().");
    expect(result.failure.message).toContain("exportArgs()");
  });

  it.each([1n, -0])("admits SDK-exported object args and literal return %s", async value => {
    const pair = freshPair(exportedArgs(v.literal(value)), exportedReturn(v.literal(value)));
    await expect(Effect.runPromise(admitFreshDeploymentMetadataEffect(pair))).resolves.toBeUndefined();
  });

});

function exportedArgs(leaf: GenericValidator): ValidatorJSON {
  const registered = query({ args: { value: leaf }, returns: v.null(), handler: async () => null });
  return decodeValidatorJsonWireV1(JSON.parse(registered.exportArgs()));
}

function exportedReturn(validator: Validator<unknown, "required", string>): ValidatorJSON {
  const registered = query({ args: {}, returns: validator, handler: async () => null });
  return decodeValidatorJsonWireV1(JSON.parse(registered.exportReturns()));
}

function freshPair(args: ValidatorJSON, returns: ValidatorJSON | null, codegenArgs = args, codegenReturns = returns): Pick<AnalyzerProtocolSuccessResponse, "analysis" | "codegenAnalysis"> {
  const schema = { version: 1, tables: [], indexes: [] };
  return {
    analysis: { schema, functions: { functions: [{ path: "records:run", kind: "query", args, returns }] } },
    codegenAnalysis: { schema, functions: [{ moduleName: "records", functions: [{ moduleName: "records", exportName: "run", kind: "query", visibility: "public", args: codegenArgs, returns: codegenReturns }] }] },
  };
}

function isRequiredTestValidator(value: unknown): value is Validator<unknown, "required", string> {
  return isValidator(value) && value.isOptional === "required";
}


describe("fresh deployment table root admission", () => {
  it.each([
    ["int64", () => v.literal(1n), false],
    ["negative zero", () => v.literal(-0), false],
    ["scalar", () => v.string(), false],
    ["array", () => v.array(v.string()), false],
    ["union", () => v.union(v.object({}), v.object({ name: v.string() })), false],
    ["nonfinite root before finite completion", () => v.literal(NaN), false],
    ["nonfinite array before finite completion", () => v.array(v.literal(Infinity)), false],
    ["record key before root and finite completion", () => record(v.literal(1n), v.literal(Infinity)), true],
  ] as const)("shares the source object-root rule for %s without narrowing historical DTOs", async (_name, make, recordFailure) => {
    const validator = make();
    const source = await Effect.runPromise(Effect.result(analyzeSchemaDefinitionEffect({
      tables: { items: { kind: "table", validator, indexes: [] } },
    })));
    if (Result.isSuccess(source)) throw new Error("Expected source table refusal");
    expect(source.failure).toMatchObject(recordFailure
      ? { _tag: "AnalyzerSchemaError", cause: { code: "InvalidRecordType" } }
      : { _tag: "AnalyzerSchemaError", message: 'Schema table "items" document validator must be an object validator.' });
    for (const side of ["analysis", "codegen"] as const) {
      const pair = freshTablePair(decodeValidatorJsonWireV1(validator.json), side);
      await expect(Effect.runPromise(captureDeploymentAnalysisEffect(pair.analysis))).resolves.toBeDefined();
      await expect(Effect.runPromise(captureDeploymentCodegenAnalysisEffect(pair.codegenAnalysis))).resolves.toBeDefined();
      const result = await Effect.runPromise(Effect.result(admitFreshDeploymentMetadataEffect(pair)));
      if (Result.isSuccess(result)) throw new Error("Expected fresh table refusal");
      expect(result.failure).toMatchObject(recordFailure
        ? { _tag: "AnalyzerValidatorError", code: "InvalidRecordType" }
        : { _tag: "AnalyzerSchemaError", message: 'Schema table "items" document validator must be an object validator.' });
    }
  });

  it.each([null, undefined])("preserves retained compatibility table validator %s", async validator => {
    for (const side of ["analysis", "codegen"] as const) {
      await expect(Effect.runPromise(admitFreshDeploymentMetadataEffect(freshTablePair(validator, side)))).resolves.toBeUndefined();
    }
  });
});

function freshTablePair(validator: ValidatorJSON | null | undefined, side: "analysis" | "codegen"): Pick<AnalyzerProtocolSuccessResponse, "analysis" | "codegenAnalysis"> {
  const base = freshPair(exportedArgs(v.number()), null);
  const schema = { version: 1, tables: [{ tableId: 1, name: "items", placement: { kind: "global" as const },
    ...(validator === undefined ? {} : { validator }) }], indexes: [] };
  return { analysis: { ...base.analysis, schema: side === "analysis" ? schema : base.analysis.schema },
    codegenAnalysis: { ...base.codegenAnalysis, schema: side === "codegen" ? schema : base.codegenAnalysis.schema } };
}

import { describe, expect, it } from "vitest";
import {
  analyzedStartPushRequest,
  validateAnalysis,
  validateCodegenAnalysis,
  validateDiagnostics,
  validateFunctions,
  validateSchema,
  validateSourcePackage,
} from "../src/deployment/Validation";
import { HttpError } from "../src/http";
import type { AnalyzedStartPushRequest as ProtocolAnalyzedStartPushRequest } from "flarex-protocol/deployment";
import type { DeploymentFunctions, DeploymentSchema, PushSourcePackage } from "../src/types";

describe("deployment validation", () => {
  it("normalizes source package modules and function paths", () => {
    const normalized = validateSourcePackage({
      modules: [
        sourceModule("functions/list.ts"),
        sourceModule("convex/_generated/server.ts"),
        sourceModule("schema.ts"),
      ],
      functions: ["functions/list.ts"],
      schema: "schema.ts",
      execution: "convex/_generated/server.ts",
    });

    expect(normalized.modules.map(module => module.path)).toEqual([
      "convex/_generated/server.ts",
      "functions/list.ts",
      "schema.ts",
    ]);
    expect(normalized.functions).toEqual(["functions/list.ts"]);
  });

  it("preserves source package validation error messages", () => {
    expect(() =>
      validateSourcePackage({
        modules: "not-modules",
        functions: [],
        execution: "convex/_generated/server.ts",
      } as unknown as PushSourcePackage)
    ).toThrow(new HttpError(400, "Source package modules must be an array."));

    expect(() =>
      validateSourcePackage({
        modules: [sourceModule("convex/_generated/server.ts")],
        functions: ["missing.ts"],
        execution: "convex/_generated/server.ts",
      })
    ).toThrow(new HttpError(400, "Source package function module missing.ts is missing."));
  });

  it("normalizes diagnostics and keeps the newest 100 entries", () => {
    const diagnostics = Array.from({ length: 101 }, (_, index) => ({
      level: "log" as const,
      message: `diagnostic ${index}`,
    }));

    const normalized = validateDiagnostics(diagnostics);

    expect(normalized).toHaveLength(100);
    expect(normalized[0]).toEqual({ level: "log", message: "diagnostic 1" });
    expect(normalized[99]).toEqual({ level: "log", message: "diagnostic 100" });
  });

  it("preserves diagnostics validation error messages", () => {
    expect(() => validateDiagnostics("not-diagnostics")).toThrow(
      new HttpError(400, "Push diagnostics must be an array."),
    );
    expect(() => validateDiagnostics([{ level: "debug", message: "too chatty" }])).toThrow(
      new HttpError(400, "Push diagnostic at index 0 has an invalid level."),
    );
  });

  it("normalizes analyzed start-push protocol success requests", () => {
    const request = analyzedStartPushRequest({
      sourcePackage: sourcePackage(),
      analysis: {
        schema: simpleSchema(),
        functions: simpleFunctions(),
      },
      diagnostics: [{ level: "warn", message: "check generated output" }],
    } as ProtocolAnalyzedStartPushRequest);

    expect(request).toEqual({
      sourcePackage: sourcePackage(),
      analysis: {
        schema: simpleSchema(),
        functions: simpleFunctions(),
      },
      diagnostics: [{ level: "warn", message: "check generated output" }],
    });
  });

  it("normalizes analyzed start-push protocol failure requests", () => {
    const request = analyzedStartPushRequest({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
    } as ProtocolAnalyzedStartPushRequest);

    expect(request).toEqual({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
    });
  });

  it("preserves analyzed start-push adapter defensive errors", () => {
    expect(() =>
      analyzedStartPushRequest({
        sourcePackage: sourcePackage(),
      } as ProtocolAnalyzedStartPushRequest)
    ).toThrow(new Error("Parsed failed push request is missing error."));
  });

  it("normalizes deployment schema metadata", () => {
    const normalized = validateSchema({
      version: 1,
      tables: [{
        tableId: 1,
        name: "messages",
        placement: { kind: "global" },
      }],
      indexes: [{
        indexId: 1,
        tableId: 1,
        name: "by_author",
        fields: ["authorId"],
      }],
    });

    expect(normalized).toEqual({
      version: 1,
      tables: [{
        tableId: 1,
        name: "messages",
        state: "active",
        validator: null,
        placement: { kind: "global" },
      }],
      indexes: [{
        indexId: 1,
        tableId: 1,
        name: "by_author",
        fields: ["authorId"],
        state: "enabled",
      }],
    });
  });

  it("preserves deployment schema validation error messages", () => {
    expect(() => validateSchema("not-schema")).toThrow(new HttpError(400, "Schema must be an object."));
    expect(() =>
      validateSchema({
        version: 1,
        tables: [],
        indexes: [{ indexId: 1, tableId: 99, name: "bad", fields: [] }],
      } satisfies DeploymentSchema)
    ).toThrow(new HttpError(400, "Index bad references unknown table id 99."));
  });

  it("normalizes deployment function metadata", () => {
    const normalized = validateFunctions({
      functions: [{
        path: "messages:list",
        kind: "query",
      }],
    });

    expect(normalized).toEqual({
      functions: [{
        path: "messages:list",
        kind: "query",
        visibility: "public",
        args: null,
        returns: null,
        route: null,
        partition: null,
      }],
    });
  });

  it("preserves deployment function validation error messages", () => {
    expect(() => validateFunctions("not-functions")).toThrow(
      new HttpError(400, "Function metadata must be an object."),
    );
    expect(() =>
      validateFunctions({
        functions: [{ path: "messages:list", kind: "subscription" }],
      } as unknown as DeploymentFunctions)
    ).toThrow(new HttpError(400, "$functions.messages:list.kind: Invalid function kind subscription."));
  });

  it("normalizes deployment analysis metadata", () => {
    const normalized = validateAnalysis({
      schema: simpleSchema(),
      functions: simpleFunctions(),
    });

    expect(normalized.schema).toEqual(validateSchema(simpleSchema()));
    expect(normalized.functions).toEqual(validateFunctions(simpleFunctions()));
  });

  it("preserves deployment analysis validation error messages", () => {
    expect(() => validateAnalysis("not-analysis")).toThrow(
      new HttpError(400, "Deployment analysis must be an object."),
    );
    expect(() =>
      validateAnalysis({
        schema: partitionedSchema(),
        functions: {
          functions: [{
            path: "teams:create",
            kind: "mutation",
            route: { type: "args", field: "teamSlug" },
            partition: {
              type: "partition",
              table: "teams",
              selector: "byId",
              partitionField: "_id",
              argField: "teamSlug",
            },
          }],
        },
      })
    ).toThrow(new HttpError(400, "teams:create.partition: Selector byId targets _id, but teams is partitioned by slug."));
  });

  it("normalizes codegen analysis metadata", () => {
    const analysis = validateAnalysis({
      schema: simpleSchema(),
      functions: simpleFunctions(),
    });

    const normalized = validateCodegenAnalysis({
      schema: simpleSchema(),
      functions: [{
        moduleName: "messages",
        functions: [{
          moduleName: "messages",
          exportName: "list",
          kind: "query",
          visibility: "public",
          args: { type: "any" },
          returns: null,
          partition: null,
        }],
      }],
    }, analysis);

    expect(normalized.functions[0]?.functions[0]).toMatchObject({
      moduleName: "messages",
      exportName: "list",
      kind: "query",
      visibility: "public",
      args: { type: "any" },
      returns: null,
      partition: null,
    });
  });

  it("preserves codegen analysis validation error messages", () => {
    const analysis = validateAnalysis({
      schema: simpleSchema(),
      functions: simpleFunctions(),
    });

    expect(() => validateCodegenAnalysis("not-codegen", analysis)).toThrow(
      new HttpError(400, "Codegen analysis must be an object."),
    );
    expect(() =>
      validateCodegenAnalysis({
        schema: { ...simpleSchema(), version: 2 },
        functions: [],
      }, analysis)
    ).toThrow(new HttpError(400, "Codegen analysis schema must match deployment analysis schema."));
  });
});

function sourceModule(path: string): PushSourcePackage["modules"][number] {
  return {
    path,
    environment: "isolate",
    sha256: "a".repeat(64),
    source: `export default ${JSON.stringify(path)};`,
  };
}

function sourcePackage(): PushSourcePackage {
  return {
    modules: [
      sourceModule("convex/_generated/server.ts"),
      sourceModule("functions/list.ts"),
    ],
    functions: ["functions/list.ts"],
    execution: "convex/_generated/server.ts",
  };
}

function simpleSchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [{
      tableId: 1,
      name: "messages",
      placement: { kind: "global" },
    }],
    indexes: [],
  };
}

function partitionedSchema(): DeploymentSchema {
  return {
    version: 1,
    tables: [{
      tableId: 1,
      name: "teams",
      placement: { kind: "partitionBy", field: "slug" },
    }],
    indexes: [],
  };
}

function simpleFunctions(): DeploymentFunctions {
  return {
    functions: [{
      path: "messages:list",
      kind: "query",
    }],
  };
}

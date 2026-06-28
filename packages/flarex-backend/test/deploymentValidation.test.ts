import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { DeploymentValidationError } from "../src/deployment/Errors";
import {
  analyzedStartPushRequest,
  codegenAnalysisFromDeploymentAnalysis,
  decodeDiagnostics,
  decodeSourcePackage,
  pushStatusFromRow,
  startAnalyzedPushInput,
  validateAnalysis,
  validateCodegenAnalysis,
  validateDiagnostics,
  validateFunctions,
  validateSchema,
  validateSourcePackage,
  type DeploymentPushStatusRow,
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
    expectDeploymentValidationFailure(
      () =>
        validateSourcePackage({
          modules: "not-modules",
          functions: [],
          execution: "convex/_generated/server.ts",
        } as unknown as PushSourcePackage),
      "Source package modules must be an array.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateSourcePackage({
          modules: [sourceModule("convex/_generated/server.ts")],
          functions: ["missing.ts"],
          execution: "convex/_generated/server.ts",
        }),
      "Source package function module missing.ts is missing.",
    );
  });

  it("exposes typed source package validation failures", async () => {
    await expect(Effect.runPromise(decodeSourcePackage(sourcePackage()))).resolves.toEqual(sourcePackage());

    const failure = await Effect.runPromise(decodeSourcePackage({
      modules: "not-modules",
      functions: [],
      execution: "convex/_generated/server.ts",
    } as unknown as PushSourcePackage).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(failure).toBeInstanceOf(DeploymentValidationError);
    if (!(failure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(failure.message).toBe("Source package modules must be an array.");
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
    expectDeploymentValidationFailure(
      () => validateDiagnostics("not-diagnostics"),
      "Push diagnostics must be an array.",
    );
    expectDeploymentValidationFailure(
      () => validateDiagnostics([{ level: "debug", message: "too chatty" }]),
      "Push diagnostic at index 0 has an invalid level.",
    );
  });

  it("exposes typed diagnostics validation failures", async () => {
    await expect(Effect.runPromise(decodeDiagnostics([
      { level: "warn", message: "check generated output" },
    ]))).resolves.toEqual([{ level: "warn", message: "check generated output" }]);

    const failure = await Effect.runPromise(decodeDiagnostics([
      { level: "debug", message: "too chatty" },
    ]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(failure).toBeInstanceOf(DeploymentValidationError);
    if (!(failure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(failure.message).toBe("Push diagnostic at index 0 has an invalid level.");
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

  it("prepares analyzed start-push service input with generated codegen fallback", () => {
    const analysis = {
      schema: simpleSchema(),
      functions: simpleFunctions(),
    };

    const input = startAnalyzedPushInput({
      sourcePackage: sourcePackage(),
      analysis,
    });

    expect(input).toEqual({
      sourcePackage: sourcePackage(),
      analysis: validateAnalysis(analysis),
      codegenAnalysis: codegenAnalysisFromDeploymentAnalysis(validateAnalysis(analysis)),
      diagnostics: [],
    });
  });

  it("prepares analyzed start-push service input with explicit codegen and diagnostics", () => {
    const analysis = validateAnalysis({
      schema: simpleSchema(),
      functions: simpleFunctions(),
    });
    const codegenAnalysis = codegenAnalysisFromDeploymentAnalysis(analysis);

    const input = startAnalyzedPushInput({
      sourcePackage: sourcePackage(),
      analysis,
      codegenAnalysis,
      diagnostics: [{ level: "warn", message: "check generated output" }],
    });

    expect(input).toEqual({
      sourcePackage: sourcePackage(),
      analysis,
      codegenAnalysis,
      diagnostics: [{ level: "warn", message: "check generated output" }],
    });
  });

  it("prepares failed start-push service input", () => {
    const input = startAnalyzedPushInput({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      diagnostics: [{ level: "error", message: "typecheck failed" }],
    });

    expect(input).toEqual({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      diagnostics: [{ level: "error", message: "typecheck failed" }],
    });
  });

  it("preserves start-push service input validation error messages", () => {
    expectDeploymentValidationFailure(
      () =>
        startAnalyzedPushInput({
          sourcePackage: sourcePackage(),
        } as unknown as Parameters<typeof startAnalyzedPushInput>[0]),
      "A push without analysis must include an error message.",
    );

    expect(() =>
      startAnalyzedPushInput({
        sourcePackage: sourcePackage(),
        analysis: {
          schema: simpleSchema(),
          functions: simpleFunctions(),
        },
        codegenAnalysis: {
          schema: { ...simpleSchema(), version: 2 },
          functions: [],
        },
      })
    ).toThrow(new HttpError(400, "Codegen analysis schema must match deployment analysis schema."));
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
    expectDeploymentValidationFailure(
      () => validateAnalysis("not-analysis"),
      "Deployment analysis must be an object.",
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

    expectDeploymentValidationFailure(
      () => validateCodegenAnalysis("not-codegen", analysis),
      "Codegen analysis must be an object.",
    );
    expect(() =>
      validateCodegenAnalysis({
        schema: { ...simpleSchema(), version: 2 },
        functions: [],
      }, analysis)
    ).toThrow(new HttpError(400, "Codegen analysis schema must match deployment analysis schema."));

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: "not-functions",
        }, analysis),
      "Codegen analysis functions must be an array.",
    );
  });

  it("generates codegen analysis from deployment analysis", () => {
    const analysis = validateAnalysis({
      schema: simpleSchema(),
      functions: {
        functions: [
          { path: "messages:list", kind: "query" },
          { path: "messages:create", kind: "mutation" },
          { path: "health", kind: "query" },
        ],
      },
    });

    expect(codegenAnalysisFromDeploymentAnalysis(analysis).functions).toEqual([
      {
        moduleName: "health",
        functions: [{
          moduleName: "health",
          exportName: "default",
          kind: "query",
          visibility: "public",
          args: { type: "any" },
          returns: null,
          partition: null,
        }],
      },
      {
        moduleName: "messages",
        functions: [
          {
            moduleName: "messages",
            exportName: "create",
            kind: "mutation",
            visibility: "public",
            args: { type: "any" },
            returns: null,
            partition: null,
          },
          {
            moduleName: "messages",
            exportName: "list",
            kind: "query",
            visibility: "public",
            args: { type: "any" },
            returns: null,
            partition: null,
          },
        ],
      },
    ]);
  });

  it("normalizes stored push rows with generated codegen fallback", () => {
    const analysis = validateAnalysis({
      schema: simpleSchema(),
      functions: simpleFunctions(),
    });

    const status = pushStatusFromRow(pushRow({
      schema_json: JSON.stringify(simpleSchema()),
      functions_json: JSON.stringify(simpleFunctions()),
      diagnostics_json: JSON.stringify([{ level: "log", message: "stored diagnostic" }]),
    }));

    expect(status).toMatchObject({
      pushId: "push-row",
      state: "analyzed",
      sourcePackage: sourcePackage(),
      analysis,
      codegenAnalysis: codegenAnalysisFromDeploymentAnalysis(analysis),
      diagnostics: [{ level: "log", message: "stored diagnostic" }],
      createdAt: 1_000,
      updatedAt: 2_000,
    });
  });

  it("preserves stored push row state error messages", () => {
    expect(() => pushStatusFromRow(pushRow({ state: "unknown" }))).toThrow(
      new Error("Unknown stored push state unknown."),
    );
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

function pushRow(overrides: Partial<DeploymentPushStatusRow> = {}): DeploymentPushStatusRow {
  return {
    push_id: "push-row",
    state: "analyzed",
    source_package_json: JSON.stringify(sourcePackage()),
    schema_json: null,
    functions_json: null,
    codegen_analysis_json: null,
    error: null,
    diagnostics_json: null,
    created_at: 1_000,
    updated_at: 2_000,
    ...overrides,
  };
}

function expectDeploymentValidationFailure(callback: () => unknown, message: string): void {
  try {
    callback();
    throw new Error("Expected deployment validation to fail.");
  } catch (cause) {
    if (!(cause instanceof DeploymentValidationError)) {
      throw cause;
    }
    expect(cause.message).toBe(message);
  }
}

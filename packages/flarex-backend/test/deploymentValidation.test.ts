import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { DeploymentValidationError } from "../src/deployment/Errors";
import {
  codegenAnalysisFromDeploymentAnalysis,
  decodeAnalyzedStartPushRequest,
  decodeAnalysis,
  decodeCodegenAnalysis,
  decodeDiagnostics,
  decodeFunctions,
  decodePushStatusFromRow,
  decodeSchema,
  decodeSourcePackage,
  decodeStartAnalyzedPushInput,
  type DeploymentPushStatusRow,
} from "../src/deployment/Validation";
import type { AnalyzedStartPushRequest as ProtocolAnalyzedStartPushRequest } from "flarex-protocol/deployment";
import type {
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  DeploymentCodegenAnalysis,
  DeploymentFunctions,
  DeploymentSchema,
  PushDiagnostic,
  PushSourcePackage,
  PushStatus,
} from "../src/types";

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

    await expectDeploymentValidationEffectFailure(
      decodeAnalyzedStartPushRequest({
        sourcePackage: {
          modules: "not-modules",
          functions: [],
          execution: "convex/_generated/server.ts",
        },
        error: "analysis failed",
      } as unknown as ProtocolAnalyzedStartPushRequest),
      "Source package modules must be an array.",
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

  it("preserves analyzed start-push adapter validation errors", () => {
    expectDeploymentValidationFailure(
      () =>
        analyzedStartPushRequest({
          sourcePackage: sourcePackage(),
        } as ProtocolAnalyzedStartPushRequest),
      "A push without analysis must include an error message.",
    );
  });

  it("exposes typed analyzed start-push request validation failures", async () => {
    await expect(Effect.runPromise(decodeAnalyzedStartPushRequest({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
    } as ProtocolAnalyzedStartPushRequest))).resolves.toEqual({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
    });

    const failure = await Effect.runPromise(decodeAnalyzedStartPushRequest({
      sourcePackage: sourcePackage(),
      diagnostics: [{ level: "debug", message: "too chatty" }],
      error: "analysis failed",
    } as unknown as ProtocolAnalyzedStartPushRequest).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(failure).toBeInstanceOf(DeploymentValidationError);
    if (!(failure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(failure.message).toBe("Push diagnostic at index 0 has an invalid level.");
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

    expectDeploymentValidationFailure(
      () =>
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
        }),
      "Codegen analysis schema must match deployment analysis schema.",
    );
  });

  it("exposes typed start-push service input validation failures", async () => {
    await expect(Effect.runPromise(decodeStartAnalyzedPushInput({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
    }))).resolves.toEqual({
      sourcePackage: sourcePackage(),
      error: "analysis failed",
      diagnostics: [],
    });

    const failure = await Effect.runPromise(decodeStartAnalyzedPushInput({
      sourcePackage: sourcePackage(),
    } as unknown as Parameters<typeof startAnalyzedPushInput>[0]).pipe(
      Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
    ));
    expect(failure).toBeInstanceOf(DeploymentValidationError);
    if (!(failure instanceof DeploymentValidationError)) {
      throw new Error("Expected DeploymentValidationError.");
    }
    expect(failure.message).toBe("A push without analysis must include an error message.");

    await expectDeploymentValidationEffectFailure(
      decodeStartAnalyzedPushInput({
        sourcePackage: sourcePackage(),
        analysis: {
          schema: simpleSchema(),
          functions: simpleFunctions(),
        },
        codegenAnalysis: {
          schema: { ...simpleSchema(), version: 2 },
          functions: [],
        },
      }),
      "Codegen analysis schema must match deployment analysis schema.",
    );
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
    expectDeploymentValidationFailure(
      () => validateSchema("not-schema"),
      "Schema must be an object.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({ ...simpleSchema(), version: -1 }),
      "Schema version must be a non-negative integer.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({ ...simpleSchema(), tables: "not-tables" }),
      "Schema tables must be an array.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({ ...simpleSchema(), indexes: "not-indexes" }),
      "Schema indexes must be an array.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({ ...simpleSchema(), tables: ["not-table"] }),
      "Schema table entry must be an object.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        tables: [{ tableId: 0, name: "messages", placement: { kind: "global" } }],
      }),
      "Invalid table id for messages.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        tables: [
          { tableId: 1, name: "messages", placement: { kind: "global" } },
          { tableId: 1, name: "messages2", placement: { kind: "global" } },
        ],
      }),
      "Duplicate table id 1.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        tables: [{ tableId: 1, name: "", placement: { kind: "global" } }],
      }),
      "Table 1 has an invalid name.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({ ...simpleSchema(), indexes: ["not-index"] }),
      "Schema index entry must be an object.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        indexes: [{ indexId: 0, tableId: 1, name: "bad", fields: [] }],
      }),
      "Invalid index id for bad.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        indexes: [
          { indexId: 1, tableId: 1, name: "by_author", fields: [] },
          { indexId: 1, tableId: 1, name: "by_title", fields: [] },
        ],
      }),
      "Duplicate index id 1.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateSchema({
          version: 1,
          tables: [],
          indexes: [{ indexId: 1, tableId: 99, name: "bad", fields: [] }],
        } satisfies DeploymentSchema),
      "Index bad references unknown table id 99.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        indexes: [{ indexId: 1, tableId: 1, name: "", fields: [] }],
      }),
      "Index 1 has an invalid name.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        indexes: [{ indexId: 1, tableId: 1, name: "by_author", fields: [123] }],
      }),
      "Index by_author has invalid fields.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        tables: [{ tableId: 1, name: "messages", state: "archived", placement: { kind: "global" } }],
      }),
      "Schema table has invalid state.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        tables: [{ tableId: 1, name: "messages", placement: { kind: "nearby" } }],
      }),
      "$schema.tables.messages.placement: Invalid placement.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        tables: [{
          tableId: 1,
          name: "messages",
          placement: { kind: "global" },
          validator: { type: "object", value: { body: { optional: false } } },
        }],
      }),
      "Invalid validator metadata: $schema.tables.messages.validator.value.body.fieldType: Validator is required.",
    );
    expectDeploymentValidationFailure(
      () => validateSchema({
        ...simpleSchema(),
        indexes: [{ indexId: 1, tableId: 1, name: "by_author", fields: [], state: "retired" }],
      }),
      "Schema index has invalid state.",
    );
  });

  it("exposes typed grouped deployment schema validation failures", async () => {
    await expectDeploymentValidationEffectFailure(
      decodeSchema({
        ...simpleSchema(),
        tables: [{ tableId: 1, name: "messages", state: "archived", placement: { kind: "global" } }],
      }),
      "Schema table has invalid state.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeSchema({
        ...simpleSchema(),
        tables: [{ tableId: 1, name: "messages", placement: { kind: "nearby" } }],
      }),
      "$schema.tables.messages.placement: Invalid placement.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeSchema({
        ...simpleSchema(),
        tables: [{
          tableId: 1,
          name: "messages",
          placement: { kind: "global" },
          validator: { type: "object", value: { body: { optional: false } } },
        }],
      }),
      "Invalid validator metadata: $schema.tables.messages.validator.value.body.fieldType: Validator is required.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeSchema({
        ...simpleSchema(),
        tables: [{
          tableId: 1,
          name: "messages",
          placement: { kind: "global" },
          validator: { type: "array", value: undefined },
        }],
      }),
      "$schema.tables.messages.validator.value: Expected JSON value.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeSchema({
        ...simpleSchema(),
        indexes: [{ indexId: 1, tableId: 1, name: "by_author", fields: [], state: "retired" }],
      }),
      "Schema index has invalid state.",
    );
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
    expectDeploymentValidationFailure(
      () => validateFunctions("not-functions"),
      "Function metadata must be an object.",
    );
    expectDeploymentValidationFailure(
      () => validateFunctions({}),
      "Function metadata must include a functions array.",
    );
    expectDeploymentValidationFailure(
      () => validateFunctions({ functions: ["not-function"] }),
      "Function metadata at index 0 must be an object.",
    );
    expectDeploymentValidationFailure(
      () => validateFunctions({ functions: [{ path: "", kind: "query" }] }),
      "Function metadata at index 0 has an invalid path.",
    );
    expectDeploymentValidationFailure(
      () => validateFunctions({
        functions: [
          { path: "messages:list", kind: "query" },
          { path: "messages:list", kind: "query" },
        ],
      }),
      "Duplicate function metadata path: messages:list.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{ path: "messages:list", kind: "subscription" }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.kind: Invalid function kind subscription.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{ path: "messages:list", kind: "query", visibility: "private" }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.visibility: Invalid function visibility private.",
    );
    expectDeploymentValidationFailure(
      () => validateFunctions({
        functions: [{ path: "messages:list", kind: "query", route: "not-route" }],
      }),
      "$functions.messages:list.route: Invalid route policy.",
    );
    expectDeploymentValidationFailure(
      () => validateFunctions({
        functions: [{ path: "messages:list", kind: "query", partition: "not-partition" }],
      }),
      "$functions.messages:list.partition: Invalid partition policy.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{ path: "messages:list", kind: "query", position: "not-position" }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.position: Invalid source position.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{
            path: "messages:list",
            kind: "query",
            position: { path: "", startLine: 1, startColumn: 1 },
          }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.position.path: Source position path must be a non-empty string.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{
            path: "messages:list",
            kind: "query",
            position: { path: "messages.ts", startLine: 0, startColumn: 1 },
          }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.position.startLine: Source position line must be a positive integer.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{
            path: "messages:list",
            kind: "query",
            position: { path: "messages.ts", startLine: 1, startColumn: 0 },
          }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.position.startColumn: Source position column must be a positive integer.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{
            path: "messages:list",
            kind: "query",
            args: { type: "object", value: { body: { optional: false } } },
          }],
        } as unknown as DeploymentFunctions),
      "Invalid validator metadata: $functions.messages:list.args.value.body.fieldType: Validator is required.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{
            path: "messages:list",
            kind: "query",
            args: { type: "array", value: undefined },
          }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.args.value: Expected JSON value.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{
            path: "messages:list",
            kind: "query",
            args: { type: "array", value: [undefined] },
          }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.args.value[0]: Expected JSON value.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{
            path: "messages:list",
            kind: "query",
            args: { type: "object", value: { body: undefined } },
          }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.args.value.body: Expected JSON value.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateFunctions({
          functions: [{
            path: "messages:list",
            kind: "query",
            args: Symbol("not-json"),
          }],
        } as unknown as DeploymentFunctions),
      "$functions.messages:list.args: Expected JSON value.",
    );
  });

  it("exposes typed grouped deployment function validation failures", async () => {
    await expectDeploymentValidationEffectFailure(
      decodeFunctions({ functions: ["not-function"] }),
      "Function metadata at index 0 must be an object.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeFunctions({ functions: [{ path: "messages:list", kind: "subscription" }] }),
      "$functions.messages:list.kind: Invalid function kind subscription.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeFunctions({ functions: [{ path: "messages:list", kind: "query", visibility: "private" }] }),
      "$functions.messages:list.visibility: Invalid function visibility private.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeFunctions({ functions: [{ path: "messages:list", kind: "query", route: "not-route" }] }),
      "$functions.messages:list.route: Invalid route policy.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeFunctions({ functions: [{ path: "messages:list", kind: "query", partition: "not-partition" }] }),
      "$functions.messages:list.partition: Invalid partition policy.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeFunctions({ functions: [{ path: "messages:list", kind: "query", position: "not-position" }] }),
      "$functions.messages:list.position: Invalid source position.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeFunctions({
        functions: [{
          path: "messages:list",
          kind: "query",
          args: { type: "object", value: { body: { optional: false } } },
        }],
      }),
      "Invalid validator metadata: $functions.messages:list.args.value.body.fieldType: Validator is required.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeFunctions({
        functions: [{
          path: "messages:list",
          kind: "query",
          args: { type: "object", value: { body: undefined } },
        }],
      }),
      "$functions.messages:list.args.value.body: Expected JSON value.",
    );
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

    expectDeploymentValidationFailure(
      () =>
        validateAnalysis({
          schema: partitionedSchema(),
          functions: partitionedFunctions({
            partition: {
              type: "partition",
              table: "missing",
              selector: "byId",
              partitionField: "_id",
              argField: "teamSlug",
            },
          }),
        }),
      "teams:create.partition: Unknown partition table missing.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateAnalysis({
          schema: simpleSchema(),
          functions: partitionedFunctions({
            partition: {
              type: "partition",
              table: "messages",
              selector: "byId",
              partitionField: "_id",
              argField: "teamSlug",
            },
          }),
        }),
      "teams:create.partition: Table messages is not partitioned.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateAnalysis({
          schema: partitionedSchema(),
          functions: partitionedFunctions({
            partition: {
              type: "partitionCreateRoot",
              table: "teams",
              partitionField: "_id",
            },
          }),
        }),
      "teams:create.partition: create-root partition requires teams to be partitioned by _id.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateAnalysis({
          schema: {
            ...partitionedSchema(),
            tables: [{
              tableId: 1,
              name: "teams",
              placement: { kind: "partitionBy", field: "_id" },
            }],
          },
          functions: partitionedFunctions({
            route: { type: "args", field: "teamSlug" },
            partition: {
              type: "partitionCreateRoot",
              table: "teams",
              partitionField: "_id",
            },
          }),
        }),
      "teams:create.partition: create-root partition cannot declare route metadata.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateAnalysis({
          schema: partitionedSchema(),
          functions: partitionedFunctions({
            partition: {
              type: "partition",
              table: "teams",
              selector: "byId",
              partitionField: "_id",
              argField: "teamSlug",
            },
          }),
        }),
      "teams:create.partition: Selector byId targets _id, but teams is partitioned by slug.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateAnalysis({
          schema: partitionedSchema(),
          functions: partitionedFunctions({
            partition: {
              type: "partition",
              table: "teams",
              selector: "byId",
              partitionField: "slug",
              argField: "teamSlug",
            },
          }),
        }),
      'teams:create.partition: Expected selector bySlug for teams partition field "slug".',
    );
    expectDeploymentValidationFailure(
      () =>
        validateAnalysis({
          schema: partitionedSchema(),
          functions: partitionedFunctions({
            args: { type: "object", value: {} },
          }),
        }),
      "teams:create.partition: args.teamSlug is not a required argument.",
    );
    expectDeploymentValidationFailure(
      () =>
        validateAnalysis({
          schema: partitionedSchema(),
          functions: partitionedFunctions({
            route: { type: "args", field: "otherSlug" },
          }),
        }),
      "teams:create.partition: partition argument teamSlug must match route argument otherSlug.",
    );
  });

  it("exposes typed partition validation failures from deployment analysis", async () => {
    await expectDeploymentValidationEffectFailure(
      decodeAnalysis({
        schema: partitionedSchema(),
        functions: partitionedFunctions({
          partition: {
            type: "partition",
            table: "missing",
            selector: "byId",
            partitionField: "_id",
            argField: "teamSlug",
          },
        }),
      }),
      "teams:create.partition: Unknown partition table missing.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeAnalysis({
        schema: partitionedSchema(),
        functions: partitionedFunctions({
          route: { type: "args", field: "otherSlug" },
        }),
      }),
      "teams:create.partition: partition argument teamSlug must match route argument otherSlug.",
    );
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
    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: { ...simpleSchema(), version: 2 },
          functions: [],
        }, analysis),
      "Codegen analysis schema must match deployment analysis schema.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: "not-functions",
        }, analysis),
      "Codegen analysis functions must be an array.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: ["not-module"],
        }, analysis),
      "Codegen module at index 0 must be an object.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "",
            functions: [],
          }],
        }, analysis),
      "Codegen module at index 0 has an invalid moduleName.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "messages",
            functions: "not-functions",
          }],
        }, analysis),
      "Codegen module messages functions must be an array.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [
            { moduleName: "messages", functions: [] },
            { moduleName: "messages", functions: [] },
          ],
        }, analysis),
      "Duplicate codegen module metadata: messages.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "messages",
            functions: ["not-function"],
          }],
        }, analysis),
      "Codegen function messages[0] must be an object.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "other",
              exportName: "list",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            }],
          }],
        }, analysis),
      "Codegen function messages[0] moduleName must match its module.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "messages",
              exportName: "",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            }],
          }],
        }, analysis),
      "Codegen function messages[0] has an invalid exportName.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "messages",
              exportName: "missing",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            }],
          }],
        }, analysis),
      "Codegen function messages:missing has no deployment function metadata.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "messages",
            functions: [
              {
                moduleName: "messages",
                exportName: "list",
                kind: "query",
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
          }],
        }, analysis),
      "Duplicate codegen function metadata path: messages:list.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "messages",
              exportName: "list",
              kind: "query",
              visibility: "public",
              args: null,
              returns: null,
              partition: null,
            }],
          }],
        }, analysis),
      "$codegen.functions.messages:list.args: Validator is required.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [{
            moduleName: "messages",
            functions: [{
              moduleName: "messages",
              exportName: "list",
              kind: "mutation",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: null,
            }],
          }],
        }, analysis),
      "Codegen function messages:list must match deployment function metadata.",
    );

    expectDeploymentValidationFailure(
      () =>
        validateCodegenAnalysis({
          schema: simpleSchema(),
          functions: [],
        }, analysis),
      "Codegen analysis functions must cover every deployment function.",
    );
  });

  it("exposes typed codegen metadata validation failures", async () => {
    const analysis = validateAnalysis({
      schema: simpleSchema(),
      functions: simpleFunctions(),
    });

    await expectDeploymentValidationEffectFailure(
      decodeCodegenAnalysis({
        schema: simpleSchema(),
        functions: [{
          moduleName: "messages",
          functions: ["not-function"],
        }],
      }, analysis),
      "Codegen function messages[0] must be an object.",
    );
    await expectDeploymentValidationEffectFailure(
      decodeCodegenAnalysis({
        schema: simpleSchema(),
        functions: [{
          moduleName: "messages",
          functions: [{
            moduleName: "messages",
            exportName: "list",
            kind: "mutation",
            visibility: "public",
            args: { type: "any" },
            returns: null,
            partition: null,
          }],
        }],
      }, analysis),
      "Codegen function messages:list must match deployment function metadata.",
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
    expectDeploymentValidationFailure(
      () => pushStatusFromRow(pushRow({ state: "unknown" })),
      "Unknown stored push state unknown.",
    );
  });

  it("matches stored push row decoder results for transaction preflight boundaries", async () => {
    const success = await Effect.runPromise(decodePushStatusFromRow(pushRow({
      schema_json: JSON.stringify(simpleSchema()),
      functions_json: JSON.stringify(simpleFunctions()),
    })).pipe(
      Effect.match({
        onFailure: error => ({ success: false as const, error }),
        onSuccess: value => ({ success: true as const, value }),
      }),
    ));
    expect(success).toMatchObject({
      success: true,
      value: {
        pushId: "push-row",
        state: "analyzed",
      },
    });

    const failure = await Effect.runPromise(decodePushStatusFromRow(pushRow({ source_package_json: "null" })).pipe(
      Effect.match({
        onFailure: error => ({ success: false as const, error }),
        onSuccess: value => ({ success: true as const, value }),
      }),
    ));
    expect(failure.success).toBe(false);
    if (failure.success) {
      throw new Error("Expected decodePushStatusFromRow to fail.");
    }
    expect(failure.error).toBeInstanceOf(DeploymentValidationError);
    expect(failure.error.message).toBe("Stored push source_package_json must match stored schema.");
  });

  it("exposes typed stored push row validation failures", async () => {
    await expect(Effect.runPromise(decodePushStatusFromRow(pushRow({
      schema_json: JSON.stringify(simpleSchema()),
      functions_json: JSON.stringify(simpleFunctions()),
    })))).resolves.toMatchObject({
      pushId: "push-row",
      state: "analyzed",
      sourcePackage: sourcePackage(),
      analysis: validateAnalysis({
        schema: simpleSchema(),
        functions: simpleFunctions(),
      }),
    });

    await expectDeploymentValidationEffectFailure(
      decodePushStatusFromRow(pushRow({ source_package_json: "{" })),
      "Stored push source_package_json must be valid JSON.",
    );
    await expectDeploymentValidationEffectFailure(
      decodePushStatusFromRow(pushRow({ source_package_json: "null" })),
      "Stored push source_package_json must match stored schema.",
    );
    await expectDeploymentValidationEffectFailure(
      decodePushStatusFromRow(pushRow({
        source_package_json: JSON.stringify({
          modules: [null],
          functions: [],
          execution: "convex/_generated/server.ts",
        }),
      })),
      "Source package module must be an object.",
    );
    await expectDeploymentValidationEffectFailure(
      decodePushStatusFromRow(pushRow({
        schema_json: JSON.stringify(simpleSchema()),
        functions_json: null,
      })),
      "Stored push analysis must include both schema_json and functions_json.",
    );
    await expectDeploymentValidationEffectFailure(
      decodePushStatusFromRow(pushRow({
        schema_json: "{",
        functions_json: JSON.stringify(simpleFunctions()),
      })),
      "Stored push schema_json must be valid JSON.",
    );
    await expectDeploymentValidationEffectFailure(
      decodePushStatusFromRow(pushRow({
        schema_json: JSON.stringify(simpleSchema()),
        functions_json: JSON.stringify(simpleFunctions()),
        codegen_analysis_json: "{",
      })),
      "Stored push codegen_analysis_json must be valid JSON.",
    );
    await expectDeploymentValidationEffectFailure(
      decodePushStatusFromRow(pushRow({
        diagnostics_json: JSON.stringify([{ level: "debug", message: "too chatty" }]),
      })),
      "Push diagnostic at index 0 has an invalid level.",
    );
  });
});

function validateSourcePackage(sourcePackage: PushSourcePackage): PushSourcePackage {
  return Effect.runSync(decodeSourcePackage(sourcePackage));
}

function validateDiagnostics(value: unknown): PushDiagnostic[] {
  return Effect.runSync(decodeDiagnostics(value));
}

function analyzedStartPushRequest(
  request: ProtocolAnalyzedStartPushRequest,
): AnalyzedStartPushRequest {
  return Effect.runSync(decodeAnalyzedStartPushRequest(request));
}

function startAnalyzedPushInput(
  request: AnalyzedStartPushRequest,
) {
  return Effect.runSync(decodeStartAnalyzedPushInput(request));
}

function pushStatusFromRow(row: DeploymentPushStatusRow): PushStatus {
  return Effect.runSync(decodePushStatusFromRow(row));
}

function validateSchema(schema: unknown): DeploymentSchema {
  return Effect.runSync(decodeSchema(schema));
}

function validateFunctions(functions: unknown): DeploymentFunctions {
  return Effect.runSync(decodeFunctions(functions));
}

function validateAnalysis(analysis: unknown): DeploymentAnalysis {
  return Effect.runSync(decodeAnalysis(analysis));
}

function validateCodegenAnalysis(
  codegenAnalysis: unknown,
  analysis: DeploymentAnalysis,
): DeploymentCodegenAnalysis {
  return Effect.runSync(decodeCodegenAnalysis(codegenAnalysis, analysis));
}

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

function partitionedFunctions(
  overrides: Partial<DeploymentFunctions["functions"][number]> = {},
): DeploymentFunctions {
  return {
    functions: [{
      path: "teams:create",
      kind: "mutation",
      args: { type: "object", value: { teamSlug: { fieldType: { type: "string" }, optional: false } } },
      route: { type: "args", field: "teamSlug" },
      partition: {
        type: "partition",
        table: "teams",
        selector: "bySlug",
        partitionField: "slug",
        argField: "teamSlug",
      },
      ...overrides,
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

async function expectDeploymentValidationEffectFailure(
  effect: Effect.Effect<unknown, DeploymentValidationError>,
  message: string,
): Promise<void> {
  const failure = await Effect.runPromise(effect.pipe(
    Effect.catchTag("DeploymentValidationError", error => Effect.succeed(error)),
  ));
  expect(failure).toBeInstanceOf(DeploymentValidationError);
  if (!(failure instanceof DeploymentValidationError)) {
    throw new Error("Expected DeploymentValidationError.");
  }
  expect(failure.message).toBe(message);
}

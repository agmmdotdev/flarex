import { Effect } from "effect";
import type { ValidatorJSON } from "flarex/values";
import { describe, expect, it } from "vitest";
import {
  analyzeLoadedSourcePackageEffect,
  backendCodegenAnalysisFromCodegenAnalysisEffect,
  decodeAnalyzerProtocolSuccessResponseEffect,
  decodeAnalyzerSuccessEnvelopeEffect,
  deploymentAnalysisFromCodegenAnalysisEffect,
  normalizeAnalyzerDiagnostics,
  type DeploymentAnalysis,
} from "../src/index";

describe("shared analyzer semantics", () => {
  it("analyzes schema, functions, source positions, and root partitions", async () => {
    const analysis = await Effect.runPromise(analyzeLoadedSourcePackageEffect({
      schemaDefinition: schemaDefinition(),
      executionModules: {
        users: {
          get: runtimeFunction({
            kind: "query",
            args: objectValidator({
              id: { fieldType: { type: "id", tableName: "users" }, optional: false },
            }),
            returns: { type: "null" },
            partition: { type: "partitionRoot", table: "users", partitionField: "_id" },
          }),
          create: runtimeFunction({
            kind: "mutation",
            args: objectValidator({
              name: { fieldType: { type: "string" }, optional: false },
            }),
            partition: { type: "partitionRoot", table: "users", partitionField: "_id" },
          }),
        },
      },
      sourceMaps: {
        users: JSON.stringify({
          sources: ["users.ts"],
          sourcesContent: ["export const get = null;\nexport const create = null;\n"],
        }),
      },
    }));

    expect(analysis.schema.tables).toEqual([
      {
        tableId: 1,
        name: "users",
        validator: objectValidator({
          name: { fieldType: { type: "string" }, optional: false },
        }),
        placement: { kind: "partitionBy", field: "_id" },
      },
    ]);
    expect(analysis.functions[0]?.functions).toMatchObject([
      {
        exportName: "create",
        partition: {
          type: "partitionCreateRoot",
          table: "users",
          partitionField: "_id",
        },
      },
      {
        exportName: "get",
        partition: {
          type: "partition",
          table: "users",
          selector: "byId",
          partitionField: "_id",
          argField: "id",
        },
        position: { path: "users.ts", startLine: 1, startColumn: 1 },
      },
    ]);
  });

  it("rejects invalid argument validators with a typed analyzer error", async () => {
    await expect(Effect.runPromise(analyzeLoadedSourcePackageEffect({
      schemaDefinition: schemaDefinition(),
      executionModules: {
        users: {
          bad: runtimeFunction({
            kind: "query",
            args: { type: "string" },
          }),
        },
      },
      sourceMaps: {},
    }))).rejects.toMatchObject({
      _tag: "AnalyzerValidatorError",
      message: "Invalid validator returned from users:bad.exportArgs(): Argument validator must be an object validator or v.any().",
    });
  });

  it("rejects ambiguous root model partitions", async () => {
    await expect(Effect.runPromise(analyzeLoadedSourcePackageEffect({
      schemaDefinition: schemaDefinition(),
      executionModules: {
        users: {
          get: runtimeFunction({
            kind: "query",
            args: objectValidator({
              first: { fieldType: { type: "id", tableName: "users" }, optional: false },
              second: { fieldType: { type: "id", tableName: "users" }, optional: false },
            }),
            partition: { type: "partitionRoot", table: "users", partitionField: "_id" },
          }),
        },
      },
      sourceMaps: {},
    }))).rejects.toMatchObject({
      _tag: "AnalyzerPartitionError",
      message: "users:get.partition: model.users is ambiguous. Found multiple required users IDs: first, second.",
    });
  });

  it("tags malformed partition JSON as a partition analyzer error", async () => {
    await expect(Effect.runPromise(analyzeLoadedSourcePackageEffect({
      schemaDefinition: schemaDefinition(),
      executionModules: {
        users: {
          bad: runtimeFunction({
            kind: "query",
            args: objectValidator({
              id: { fieldType: { type: "id", tableName: "users" }, optional: false },
            }),
            partition: "{",
          }),
        },
      },
      sourceMaps: {},
    }))).rejects.toMatchObject({
      _tag: "AnalyzerPartitionError",
    });
  });

  it("converts grouped codegen analysis into backend analysis and backend codegen analysis", async () => {
    const analysis = await Effect.runPromise(analyzeLoadedSourcePackageEffect({
      schemaDefinition: schemaDefinition(),
      executionModules: {
        users: {
          get: runtimeFunction({
            kind: "query",
            args: objectValidator({
              id: { fieldType: { type: "id", tableName: "users" }, optional: false },
            }),
          }),
        },
      },
      sourceMaps: {},
    }));

    await expect(Effect.runPromise(deploymentAnalysisFromCodegenAnalysisEffect(analysis)))
      .resolves.toMatchObject({
        functions: {
          functions: [
            {
              path: "users:get",
              kind: "query",
              visibility: "public",
              args: objectValidator({
                id: { fieldType: { type: "id", tableName: "users" }, optional: false },
              }),
              returns: null,
              route: null,
              partition: null,
            },
          ],
        },
      });
    const codegen = await Effect.runPromise(backendCodegenAnalysisFromCodegenAnalysisEffect(analysis));
    expect(codegen.functions[0]?.moduleName)
      .toBe("users");
  });

  it("preserves reserved validator field names in backend analysis", async () => {
    const fields: Extract<ValidatorJSON, { type: "object" }>["value"] = Object.fromEntries([[
      "__proto__",
      { fieldType: { type: "string" }, optional: false },
    ]]);
    const analysis: DeploymentAnalysis = {
      schema: {
        version: 1,
        tables: [{
          tableId: 1,
          name: "users",
          validator: { type: "object", value: fields },
          placement: { kind: "global" },
        }],
        indexes: [],
      },
      functions: [{
        moduleName: "users",
        functions: [{
          moduleName: "users",
          exportName: "create",
          kind: "mutation",
          visibility: "public",
          args: { type: "object", value: fields },
          returns: null,
        }],
      }],
    };

    const converted = await Effect.runPromise(
      deploymentAnalysisFromCodegenAnalysisEffect(analysis),
    );
    const tableValidator = converted.schema.tables[0]?.validator;
    const argsValidator = converted.functions.functions[0]?.args;
    if (tableValidator?.type !== "object" || argsValidator?.type !== "object") {
      throw new Error("Expected object validators.");
    }
    expect(Object.hasOwn(tableValidator.value, "__proto__")).toBe(true);
    expect(Object.hasOwn(argsValidator.value, "__proto__")).toBe(true);
  });

  it("rejects BigInt literal validators at the backend metadata conversion boundary", async () => {
    const analysis: DeploymentAnalysis = {
      schema: { version: 1, tables: [], indexes: [] },
      functions: [
        {
          moduleName: "users",
          functions: [
            {
              moduleName: "users",
              exportName: "bad",
              kind: "query",
              visibility: "public",
              args: objectValidator({
                value: { fieldType: { type: "literal", value: 1n }, optional: false },
              }),
              returns: null,
            },
          ],
        },
      ],
    };

    await expect(Effect.runPromise(deploymentAnalysisFromCodegenAnalysisEffect(analysis)))
      .rejects.toMatchObject({
        message: "BigInt literal validators are not supported by backend deployment metadata.",
      });
  });

  it("rejects empty ID table names at the backend metadata conversion boundary", async () => {
    const analysis: DeploymentAnalysis = {
      schema: {
        version: 1,
        tables: [{
          tableId: 1,
          name: "users",
          validator: objectValidator({
            ownerId: {
              fieldType: { type: "id", tableName: "" },
              optional: false,
            },
            later: {
              fieldType: { type: "literal", value: 1n },
              optional: false,
            },
          }),
          placement: { kind: "global" },
        }],
        indexes: [],
      },
      functions: [],
    };

    await expect(Effect.runPromise(deploymentAnalysisFromCodegenAnalysisEffect(analysis)))
      .rejects.toMatchObject({
        _tag: "AnalyzerValidatorError",
        message: expect.stringContaining("tableName must be a Convex-compatible table identifier"),
      });
  });

  it("normalizes analyzer diagnostics and caps old entries", () => {
    const diagnostics = Array.from({ length: 105 }, (_, index) => ({
      level: index % 2 === 0 ? "log" : "warn",
      message: `entry-${index}`,
    }));

    const normalized = normalizeAnalyzerDiagnostics([
      { level: "bad", message: "ignored" },
      ...diagnostics,
    ]);

    expect(normalized).toHaveLength(100);
    expect(normalized[0]?.message).toBe("entry-5");
    expect(normalized.at(-1)?.message).toBe("entry-104");
  });

  it("decodes analyzer success envelopes and verifies protocol-shaped analysis", async () => {
    const envelope = await Effect.runPromise(decodeAnalyzerSuccessEnvelopeEffect({
      analysis: protocolDeploymentAnalysis(),
      codegenAnalysis: protocolCodegenAnalysis(),
      diagnostics: [
        { level: "bad", message: "ignored" },
        { level: "log", message: "ok" },
      ],
    }));

    expect(envelope.diagnostics).toEqual([{ level: "log", message: "ok" }]);
    await expect(Effect.runPromise(decodeAnalyzerProtocolSuccessResponseEffect(envelope)))
      .resolves.toMatchObject({
        analysis: protocolDeploymentAnalysis(),
        codegenAnalysis: protocolCodegenAnalysis(),
        diagnostics: [{ level: "log", message: "ok" }],
      });
  });

  it("classifies missing analyzer codegen analysis separately from invalid envelopes", async () => {
    await expect(Effect.runPromise(decodeAnalyzerSuccessEnvelopeEffect({
      analysis: protocolDeploymentAnalysis(),
    }))).rejects.toMatchObject({
      _tag: "AnalyzerResponseError",
      code: "missing_codegen_analysis",
    });

    await expect(Effect.runPromise(decodeAnalyzerSuccessEnvelopeEffect({
      analysis: protocolDeploymentAnalysis(),
      codegenAnalysis: null,
    }))).rejects.toMatchObject({
      _tag: "AnalyzerResponseError",
      code: "invalid_success_envelope",
    });
  });

  it("rejects analyzer success envelopes that fail the protocol contract", async () => {
    const envelope = await Effect.runPromise(decodeAnalyzerSuccessEnvelopeEffect({
      analysis: { schema: {}, functions: {} },
      codegenAnalysis: protocolCodegenAnalysis(),
    }));

    await expect(Effect.runPromise(decodeAnalyzerProtocolSuccessResponseEffect(envelope)))
      .rejects.toMatchObject({
        _tag: "AnalyzerResponseError",
        code: "protocol_validation",
        message: "Deployment analysis did not match the deployment protocol.",
      });
  });
});

function schemaDefinition(): unknown {
  return {
    tables: {
      users: {
        kind: "table",
        validator: {
          isFlarexValidator: true,
          json: objectValidator({
            name: { fieldType: { type: "string" }, optional: false },
          }),
        },
        indexes: [],
      },
    },
  };
}

function runtimeFunction(options: {
  kind: "query" | "mutation" | "workflowMutation" | "action";
  args: unknown;
  returns?: unknown;
  partition?: unknown;
}): Record<string, unknown> {
  return {
    ...(options.kind === "query" ? { isQuery: true } : {}),
    ...(options.kind === "mutation" ? { isMutation: true } : {}),
    ...(options.kind === "workflowMutation" ? { isWorkflowMutation: true } : {}),
    ...(options.kind === "action" ? { isAction: true } : {}),
    isPublic: true,
    _handler: async () => null,
    exportArgs: () => JSON.stringify(options.args),
  exportReturns: () => JSON.stringify(options.returns ?? null),
    exportPartition: () => typeof options.partition === "string"
      ? options.partition
      : JSON.stringify(options.partition ?? null),
  };
}

function objectValidator(
  value: Record<string, { fieldType: ValidatorJSON; optional: boolean }>,
): { type: "object"; value: Record<string, { fieldType: ValidatorJSON; optional: boolean }> } {
  return { type: "object", value };
}

function protocolDeploymentAnalysis() {
  return {
    schema: {
      version: 1,
      tables: [],
      indexes: [],
    },
    functions: {
      functions: [],
    },
  };
}

function protocolCodegenAnalysis() {
  return {
    schema: {
      version: 1,
      tables: [],
      indexes: [],
    },
    functions: [],
  };
}

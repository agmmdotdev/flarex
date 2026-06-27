import { describe, expect, it } from "vitest";
import {
  DeploymentProtocolValidationError,
  parseAnalyzedStartPushRequest,
  parseDeploymentAnalysis,
  parseDeploymentCodegenAnalysis,
  parseFinishPushResponse,
  parsePushStatus,
} from "../src/deployment";

describe("deployment protocol schemas", () => {
  it("parses deep deployment analysis and codegen analysis payloads", () => {
    expect(parseDeploymentAnalysis(deploymentAnalysis())).toEqual(deploymentAnalysis());
    expect(parseDeploymentCodegenAnalysis(deploymentCodegenAnalysis())).toEqual(deploymentCodegenAnalysis());
  });

  it("parses push and finish responses with deep analysis payloads", () => {
    const push = {
      pushId: "push_1",
      state: "analyzed",
      sourcePackage: sourcePackage(),
      analysis: deploymentAnalysis(),
      codegenAnalysis: deploymentCodegenAnalysis(),
      diagnostics: [{ level: "log", message: "ok" }],
      createdAt: 1,
      updatedAt: 2,
    };

    expect(parsePushStatus(push)).toEqual(push);
    expect(parseFinishPushResponse({ result: "activated", push })).toEqual({
      result: "activated",
      push,
    });
  });

  it("rejects malformed deep codegen payloads", () => {
    const codegen = deploymentCodegenAnalysis();
    delete (codegen.functions[0]!.functions[0]! as { exportName?: string }).exportName;

    expect(() => parseDeploymentCodegenAnalysis(codegen))
      .toThrow(DeploymentProtocolValidationError);
  });

  it("keeps analyzed start-push request parsing wrapper-oriented", () => {
    const request = parseAnalyzedStartPushRequest({
      sourcePackage: sourcePackage(),
      analysis: null,
      codegenAnalysis: { not: "validated here" },
      diagnostics: [],
    });

    expect(request.analysis).toBeNull();
    expect(request.codegenAnalysis).toEqual({ not: "validated here" });
  });
});

function sourcePackage() {
  return {
    modules: [
      {
        path: "lessons.ts",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
      {
        path: "__execution.ts",
        environment: "isolate",
        sha256: "b".repeat(64),
      },
    ],
    functions: ["lessons.ts"],
    execution: "__execution.ts",
  };
}

function deploymentAnalysis() {
  return {
    schema: deploymentSchema(),
    functions: {
      functions: [
        {
          path: "lessons:list",
          kind: "query",
          visibility: "internal",
          args: {
            type: "object",
            value: {
              teamSlug: { fieldType: { type: "string" }, optional: false },
            },
          },
          returns: { type: "array", value: { type: "string" } },
          route: { type: "args", field: "teamSlug" },
          partition: {
            type: "partition",
            table: "teams",
            selector: "bySlug",
            partitionField: "slug",
            argField: "teamSlug",
          },
          position: { path: "lessons.ts", startLine: 3, startColumn: 1 },
        },
      ],
    },
  };
}

function deploymentCodegenAnalysis() {
  return {
    schema: deploymentSchema(),
    functions: [
      {
        moduleName: "lessons",
        functions: [
          {
            moduleName: "lessons",
            exportName: "list",
            kind: "query",
            visibility: "internal",
            args: {
              type: "object",
              value: {
                teamSlug: { fieldType: { type: "string" }, optional: false },
              },
            },
            returns: { type: "array", value: { type: "string" } },
            partition: {
              type: "partition",
              table: "teams",
              selector: "bySlug",
              partitionField: "slug",
              argField: "teamSlug",
            },
            position: { path: "lessons.ts", startLine: 3, startColumn: 1 },
          },
        ],
      },
    ],
  };
}

function deploymentSchema() {
  return {
    version: 1,
    tables: [
      {
        tableId: 1,
        name: "teams",
        state: "active",
        validator: {
          type: "object",
          value: {
            slug: { fieldType: { type: "string" }, optional: false },
          },
        },
        placement: { kind: "partitionBy", field: "slug" },
      },
    ],
    indexes: [
      {
        indexId: 1,
        tableId: 1,
        name: "by_slug",
        fields: ["slug"],
        state: "enabled",
      },
    ],
  };
}

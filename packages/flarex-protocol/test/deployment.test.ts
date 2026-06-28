import { describe, expect, it } from "vitest";
import {
  DeploymentApi,
  DeploymentApiPath,
  DeploymentPushAction,
  DeploymentPushParams,
  DeploymentProtocolValidationError,
  DeploymentRoute,
  parseAbandonPushRequest,
  parseAnalyzedStartPushRequest,
  parseDeploymentAnalysis,
  parseDeploymentCodegenAnalysis,
  parseDeploymentHealthResponse,
  parseFinishPushRequest,
  parseFinishPushResponse,
  parsePushStatus,
} from "../src/deployment";

describe("deployment protocol schemas", () => {
  it("locks DeploymentDO route constants", () => {
    expect(DeploymentRoute).toEqual({
      health: "/health",
      activeDeployment: "/deployment",
      startAnalyzedPush: "/push/start-analyzed",
      push: "/push",
    });
    expect(DeploymentApiPath).toEqual({
      pushStatus: "/push/:pushId",
      finishPush: "/push/:pushId/finish",
      abandonPush: "/push/:pushId/abandon",
    });
    expect(DeploymentPushAction).toEqual({
      finish: "finish",
      abandon: "abandon",
    });
  });

  it("describes the current DeploymentDO read routes as an HttpApi contract", () => {
    const group = DeploymentApi.groups.deployment;

    expect(group.topLevel).toBe(true);
    expect(group.endpoints.health.path).toBe(DeploymentRoute.health);
    expect(group.endpoints.health.method).toBe("GET");
    expect(group.endpoints.getActiveDeployment.path).toBe(DeploymentRoute.activeDeployment);
    expect(group.endpoints.getActiveDeployment.method).toBe("GET");
    expect(group.endpoints.getPush.path).toBe(DeploymentApiPath.pushStatus);
    expect(group.endpoints.getPush.method).toBe("GET");
    expect(group.endpoints.getPush.params).toBeDefined();

    expect(DeploymentPushParams.make({ pushId: "push_123" })).toEqual({
      pushId: "push_123",
    });
  });

  it("describes the current DeploymentDO mutation routes as an HttpApi contract", () => {
    const group = DeploymentApi.groups.deployment;

    expect(group.endpoints.startAnalyzedPush.path).toBe(DeploymentRoute.startAnalyzedPush);
    expect(group.endpoints.startAnalyzedPush.method).toBe("POST");
    expect(group.endpoints.startAnalyzedPush.payload).toBeDefined();

    expect(group.endpoints.finishPush.path).toBe(DeploymentApiPath.finishPush);
    expect(group.endpoints.finishPush.method).toBe("POST");
    expect(group.endpoints.finishPush.params).toBeDefined();
    expect(group.endpoints.finishPush.payload).toBeDefined();

    expect(group.endpoints.abandonPush.path).toBe(DeploymentApiPath.abandonPush);
    expect(group.endpoints.abandonPush.method).toBe("POST");
    expect(group.endpoints.abandonPush.params).toBeDefined();
    expect(group.endpoints.abandonPush.payload).toBeDefined();
  });

  it("parses deployment health responses used by the HttpApi contract", () => {
    expect(parseDeploymentHealthResponse({
      service: "flarex-deployment",
      status: "ok",
    })).toEqual({
      service: "flarex-deployment",
      status: "ok",
    });
    expect(() => parseDeploymentHealthResponse({ service: "wrong", status: "ok" }))
      .toThrow(DeploymentProtocolValidationError);
  });

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

  it("parses finish push request bodies", () => {
    expect(parseFinishPushRequest({})).toEqual({});
    expect(parseFinishPushRequest({ activate: true })).toEqual({ activate: true });
    expect(() => parseFinishPushRequest(null)).toThrow(DeploymentProtocolValidationError);
    expect(() => parseFinishPushRequest({ activate: "yes" }))
      .toThrow(DeploymentProtocolValidationError);
  });

  it("parses abandon push request bodies", () => {
    expect(parseAbandonPushRequest({})).toEqual({});
    expect(parseAbandonPushRequest({ reason: "typecheck failed" })).toEqual({
      reason: "typecheck failed",
    });
    expect(() => parseAbandonPushRequest(null)).toThrow(DeploymentProtocolValidationError);
    expect(() => parseAbandonPushRequest([])).toThrow(DeploymentProtocolValidationError);
    expect(() => parseAbandonPushRequest({ reason: 42 }))
      .toThrow(DeploymentProtocolValidationError);
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

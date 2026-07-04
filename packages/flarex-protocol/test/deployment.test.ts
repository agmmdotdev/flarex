import { describe, expect, it } from "vitest";
import { Effect, SchemaAST, type Schema } from "effect";
import {
  decodeAbandonPushRequestEffect,
  decodeActiveDeploymentStatusEffect,
  decodeAnalyzedStartPushRequestEffect,
  decodeDeploymentAnalysisEffect,
  decodeDeploymentCodegenAnalysisEffect,
  decodeDeploymentErrorResponseEffect,
  decodeDeploymentHealthResponseEffect,
  decodeFinishPushRequestEffect,
  decodeFinishPushResponseEffect,
  decodePushSourcePackageEffect,
  decodePushStatusEffect,
  decodeStartPushRequestEffect,
  DeploymentApi,
  DeploymentApiPath,
  DeploymentBadRequestError,
  DeploymentConflictError,
  DeploymentNotFoundError,
  DeploymentPushAction,
  DeploymentPushParams,
  DeploymentProtocolValidationError,
  DeploymentRoute,
  DeploymentStorageError,
  RejectedFinishPushSuccess,
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
    expect(schemaStatusCodes(group.endpoints.health.error)).toEqual([]);
    expect(group.endpoints.getActiveDeployment.path).toBe(DeploymentRoute.activeDeployment);
    expect(group.endpoints.getActiveDeployment.method).toBe("GET");
    expect(schemaStatusCodes(group.endpoints.getActiveDeployment.error)).toEqual([404, 500]);
    expect(group.endpoints.getPush.path).toBe(DeploymentApiPath.pushStatus);
    expect(group.endpoints.getPush.method).toBe("GET");
    expect(group.endpoints.getPush.params).toBeDefined();
    expect(schemaStatusCodes(group.endpoints.getPush.error)).toEqual([404, 500]);

    expect(DeploymentPushParams.make({ pushId: "push_123" })).toEqual({
      pushId: "push_123",
    });
  });

  it("describes the current DeploymentDO mutation routes as an HttpApi contract", () => {
    const group = DeploymentApi.groups.deployment;

    expect(group.endpoints.startAnalyzedPush.path).toBe(DeploymentRoute.startAnalyzedPush);
    expect(group.endpoints.startAnalyzedPush.method).toBe("POST");
    expect(group.endpoints.startAnalyzedPush.payload).toBeDefined();
    expect(schemaStatusCodes(group.endpoints.startAnalyzedPush.error)).toEqual([400, 500]);

    expect(group.endpoints.finishPush.path).toBe(DeploymentApiPath.finishPush);
    expect(group.endpoints.finishPush.method).toBe("POST");
    expect(group.endpoints.finishPush.params).toBeDefined();
    expect(group.endpoints.finishPush.payload).toBeDefined();
    expect(group.endpoints.finishPush.success.size).toBe(2);
    expect(schemaStatusCodes(group.endpoints.finishPush.success)).toEqual([409]);
    expect(schemaStatusCodes(group.endpoints.finishPush.error)).toEqual([400, 404, 500]);

    expect(group.endpoints.abandonPush.path).toBe(DeploymentApiPath.abandonPush);
    expect(group.endpoints.abandonPush.method).toBe("POST");
    expect(group.endpoints.abandonPush.params).toBeDefined();
    expect(group.endpoints.abandonPush.payload).toBeDefined();
    expect(schemaStatusCodes(group.endpoints.abandonPush.error)).toEqual([404, 409, 500]);
  });

  it("locks deployment HttpApi error response status annotations", () => {
    expect(SchemaAST.resolve(DeploymentBadRequestError.ast)?.httpApiStatus).toBe(400);
    expect(SchemaAST.resolve(DeploymentNotFoundError.ast)?.httpApiStatus).toBe(404);
    expect(SchemaAST.resolve(DeploymentConflictError.ast)?.httpApiStatus).toBe(409);
    expect(SchemaAST.resolve(DeploymentStorageError.ast)?.httpApiStatus).toBe(500);
    expect(SchemaAST.resolve(RejectedFinishPushSuccess.ast)?.httpApiStatus).toBe(409);
  });

  it("decodes deployment error responses used by the HttpApi contract", async () => {
    await expect(Effect.runPromise(decodeDeploymentErrorResponseEffect({ error: "Unknown push: push-missing" }))).resolves.toEqual({
      error: "Unknown push: push-missing",
    });
    await expect(Effect.runPromise(decodeDeploymentErrorResponseEffect({ message: "wrong envelope" })))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("decodes deployment health responses used by the HttpApi contract", async () => {
    await expect(Effect.runPromise(decodeDeploymentHealthResponseEffect({
      service: "flarex-deployment",
      status: "ok",
    }))).resolves.toEqual({
      service: "flarex-deployment",
      status: "ok",
    });
    await expect(Effect.runPromise(decodeDeploymentHealthResponseEffect({ service: "wrong", status: "ok" })))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("decodes deep deployment analysis and codegen analysis payloads", async () => {
    await expect(Effect.runPromise(decodePushSourcePackageEffect(sourcePackage())))
      .resolves.toEqual(sourcePackage());
    await expect(Effect.runPromise(decodePushSourcePackageEffect(sourcePackageWithAuth())))
      .resolves.toEqual(sourcePackageWithAuth());
    await expect(Effect.runPromise(decodeDeploymentAnalysisEffect(deploymentAnalysis())))
      .resolves.toEqual(deploymentAnalysis());
    await expect(Effect.runPromise(decodeDeploymentCodegenAnalysisEffect(deploymentCodegenAnalysis())))
      .resolves.toEqual(deploymentCodegenAnalysis());
  });

  it("rejects invalid deep deployment payloads with typed Effect failures", async () => {
    await expect(Effect.runPromise(decodePushSourcePackageEffect(sourcePackage())))
      .resolves.toEqual(sourcePackage());
    await expect(Effect.runPromise(decodeDeploymentAnalysisEffect(deploymentAnalysis())))
      .resolves.toEqual(deploymentAnalysis());
    await expect(Effect.runPromise(decodeDeploymentCodegenAnalysisEffect(deploymentCodegenAnalysis())))
      .resolves.toEqual(deploymentCodegenAnalysis());

    await expect(Effect.runPromise(decodePushSourcePackageEffect({
      ...sourcePackage(),
      modules: "not-modules",
    }))).rejects.toMatchObject({
      schema: "PushSourcePackage",
      message: "Source package must include modules, functions, and execution fields with valid module entries.",
    });
    await expect(Effect.runPromise(decodePushSourcePackageEffect({
      ...sourcePackage(),
      authConfig: {
        providers: [{
          type: "customJwt",
          issuer: "https://auth.example.com",
          jwks: "https://auth.example.com/jwks.json",
          algorithm: "HS256",
        }],
      },
    }))).rejects.toMatchObject({
      schema: "PushSourcePackage",
      message: "Source package must include modules, functions, and execution fields with valid module entries.",
    });
    await expect(Effect.runPromise(decodePushSourcePackageEffect({
      ...sourcePackage(),
      authConfigModule: "_flarex/auth.config.js",
    }))).rejects.toMatchObject({
      schema: "PushSourcePackage",
      message: "Source package authConfig is required when auth config module is present.",
    });
    await expect(Effect.runPromise(decodePushSourcePackageEffect({
      ...sourcePackage(),
      authConfigModule: "_flarex/auth.config.js",
      authConfig: {
        providers: [{
          domain: "https://auth.example.com",
          applicationID: "app-123",
        }],
      },
    }))).rejects.toMatchObject({
      schema: "PushSourcePackage",
      message: "Source package auth config module _flarex/auth.config.js is missing.",
    });

    await expect(Effect.runPromise(decodeDeploymentAnalysisEffect({
      ...deploymentAnalysis(),
      functions: "not-functions",
    }))).rejects.toMatchObject({
      schema: "DeploymentAnalysis",
      message: "Deployment analysis did not match the deployment protocol.",
    });

    await expect(Effect.runPromise(decodeDeploymentCodegenAnalysisEffect({
      ...deploymentCodegenAnalysis(),
      functions: "not-functions",
    }))).rejects.toMatchObject({
      schema: "DeploymentCodegenAnalysis",
      message: "Deployment codegen analysis did not match the deployment protocol.",
    });
  });

  it("exposes typed response decode failures", async () => {
    await expect(Effect.runPromise(decodeDeploymentErrorResponseEffect({ message: "wrong envelope" })))
      .rejects.toMatchObject({
        schema: "DeploymentErrorResponse",
        message: "Deployment error response did not match the deployment protocol.",
      });

    await expect(Effect.runPromise(decodeDeploymentHealthResponseEffect({
      service: "wrong",
      status: "ok",
    }))).rejects.toMatchObject({
      schema: "DeploymentHealthResponse",
      message: "Deployment health response did not match the deployment protocol.",
    });

    await expect(Effect.runPromise(decodeActiveDeploymentStatusEffect({
      ...activeDeploymentStatus(),
      activePushId: 42,
    }))).rejects.toMatchObject({
      schema: "ActiveDeploymentStatus",
      message: "Active deployment response did not match the deployment protocol.",
    });

    await expect(Effect.runPromise(decodePushStatusEffect({
      ...pushStatus(),
      state: "missing-state",
    }))).rejects.toMatchObject({
      schema: "PushStatus",
      message: "Deployment push response did not match the deployment protocol.",
    });

    await expect(Effect.runPromise(decodeFinishPushResponseEffect({
      result: "activated",
      push: { ...pushStatus(), state: "missing-state" },
    }))).rejects.toMatchObject({
      schema: "FinishPushResponse",
      message: "Finish push response did not match the deployment protocol.",
    });
  });

  it("decodes active deployment responses with deep analysis payloads", async () => {
    const active = activeDeploymentStatus();

    await expect(Effect.runPromise(decodeActiveDeploymentStatusEffect(active)))
      .resolves.toEqual(active);
  });

  it("decodes response payloads through Effect", async () => {
    const push = pushStatus();

    await expect(Effect.runPromise(decodeDeploymentErrorResponseEffect({ error: "Unknown push: push-missing" })))
      .resolves.toEqual({ error: "Unknown push: push-missing" });
    await expect(Effect.runPromise(decodeDeploymentHealthResponseEffect({
      service: "flarex-deployment",
      status: "ok",
    }))).resolves.toEqual({
      service: "flarex-deployment",
      status: "ok",
    });
    await expect(Effect.runPromise(decodeActiveDeploymentStatusEffect(activeDeploymentStatus())))
      .resolves.toEqual(activeDeploymentStatus());
    await expect(Effect.runPromise(decodePushStatusEffect(push))).resolves.toEqual(push);
    await expect(Effect.runPromise(decodeFinishPushResponseEffect({ result: "activated", push })))
      .resolves.toEqual({ result: "activated", push });
  });

  it("decodes push and finish responses with deep analysis payloads", async () => {
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

    await expect(Effect.runPromise(decodePushStatusEffect(push))).resolves.toEqual(push);
    await expect(Effect.runPromise(decodeFinishPushResponseEffect({ result: "activated", push }))).resolves.toEqual({
      result: "activated",
      push,
    });
  });

  it("rejects malformed deep codegen payloads", async () => {
    const codegen = deploymentCodegenAnalysis();
    delete (codegen.functions[0]!.functions[0]! as { exportName?: string }).exportName;

    await expect(Effect.runPromise(decodeDeploymentCodegenAnalysisEffect(codegen)))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("keeps analyzed start-push request decoding shallow", async () => {
    const request = await Effect.runPromise(decodeAnalyzedStartPushRequestEffect({
      sourcePackage: sourcePackage(),
      analysis: null,
      codegenAnalysis: { not: "validated here" },
      diagnostics: [],
    }));

    expect(request.analysis).toBeNull();
    expect(request.codegenAnalysis).toEqual({ not: "validated here" });
  });

  it("exposes typed analyzed start-push decode failures", async () => {
    await expect(Effect.runPromise(decodeAnalyzedStartPushRequestEffect(null)))
      .rejects.toMatchObject({
        schema: "AnalyzedStartPushRequest",
        message: "Analyzed start push request must be an object.",
      });

    await expect(Effect.runPromise(decodeAnalyzedStartPushRequestEffect({
      sourcePackage: sourcePackage(),
    }))).rejects.toMatchObject({
      schema: "AnalyzedStartPushRequest",
      message: "A push without analysis must include an error message.",
    });

    await expect(Effect.runPromise(decodeAnalyzedStartPushRequestEffect({
      sourcePackage: sourcePackage(),
      diagnostics: "not-array",
    }))).rejects.toMatchObject({
      schema: "AnalyzedStartPushRequest",
      message: "Push diagnostics must be an array.",
    });
  });

  it("decodes source-only start push request bodies", async () => {
    await expect(Effect.runPromise(decodeStartPushRequestEffect({ sourcePackage: sourcePackage() }))).resolves.toEqual({
      sourcePackage: sourcePackage(),
    });
    await expect(Effect.runPromise(decodeStartPushRequestEffect(null)))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeStartPushRequestEffect({})))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeStartPushRequestEffect({
      sourcePackage: { ...sourcePackage(), modules: "not-modules" },
    }))).rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeStartPushRequestEffect({
      sourcePackage: {
        ...sourcePackage(),
        authConfig: {
          providers: [{
            domain: "https://auth.example.com",
            applicationID: "app-123",
          }],
        },
      },
    }))).rejects.toMatchObject({
      schema: "PushSourcePackage",
      message: "Source package auth config module is required when authConfig is present.",
    });
  });

  it("exposes typed source-only start push decode failures", async () => {
    await expect(Effect.runPromise(decodeStartPushRequestEffect([])))
      .rejects.toMatchObject({
        schema: "StartPushRequest",
        message: "Start push request must be an object.",
      });

    await expect(Effect.runPromise(decodeStartPushRequestEffect({})))
      .rejects.toMatchObject({
        schema: "StartPushRequest",
        message: "Start push request must include sourcePackage.",
      });
  });

  it("decodes finish push request bodies", async () => {
    await expect(Effect.runPromise(decodeFinishPushRequestEffect({}))).resolves.toEqual({});
    await expect(Effect.runPromise(decodeFinishPushRequestEffect({ activate: true })))
      .resolves.toEqual({ activate: true });
    await expect(Effect.runPromise(decodeFinishPushRequestEffect(null)))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeFinishPushRequestEffect({ activate: "yes" })))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("exposes typed finish push decode failures", async () => {
    await expect(Effect.runPromise(decodeFinishPushRequestEffect(null)))
      .rejects.toMatchObject({
        schema: "FinishPushRequest",
        message: "Finish push request must be an object.",
      });

    await expect(Effect.runPromise(decodeFinishPushRequestEffect({ activate: "yes" })))
      .rejects.toMatchObject({
        schema: "FinishPushRequest",
        message: "Finish push activate flag must be a boolean.",
      });
  });

  it("decodes abandon push request bodies", async () => {
    await expect(Effect.runPromise(decodeAbandonPushRequestEffect({}))).resolves.toEqual({});
    await expect(Effect.runPromise(decodeAbandonPushRequestEffect({ reason: "typecheck failed" }))).resolves.toEqual({
      reason: "typecheck failed",
    });
    await expect(Effect.runPromise(decodeAbandonPushRequestEffect(null)))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeAbandonPushRequestEffect([])))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
    await expect(Effect.runPromise(decodeAbandonPushRequestEffect({ reason: 42 })))
      .rejects.toBeInstanceOf(DeploymentProtocolValidationError);
  });

  it("exposes typed abandon push decode failures", async () => {
    await expect(Effect.runPromise(decodeAbandonPushRequestEffect([])))
      .rejects.toMatchObject({
        schema: "AbandonPushRequest",
        message: "Abandon push request must be an object.",
      });

    await expect(Effect.runPromise(decodeAbandonPushRequestEffect({ reason: 42 })))
      .rejects.toMatchObject({
        schema: "AbandonPushRequest",
        message: "Abandon push reason must be a string.",
      });
  });
});

function schemaStatusCodes(schemas: ReadonlySet<Schema.Top>): ReadonlyArray<number> {
  return Array.from(schemas, schema => SchemaAST.resolve(schema.ast)?.httpApiStatus)
    .filter((status): status is number => typeof status === "number")
    .sort((left, right) => left - right);
}

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

function sourcePackageWithAuth() {
  return {
    ...sourcePackage(),
    modules: [
      ...sourcePackage().modules,
      {
        path: "_flarex/auth.config.js",
        environment: "isolate",
        sha256: "c".repeat(64),
      },
    ],
    authConfigModule: "_flarex/auth.config.js",
    authConfig: {
      providers: [{
        domain: "https://auth.example.com",
        applicationID: "app-123",
      }],
    },
  };
}

function pushStatus() {
  return {
    pushId: "push_1",
    state: "analyzed",
    sourcePackage: sourcePackage(),
    analysis: deploymentAnalysis(),
    codegenAnalysis: deploymentCodegenAnalysis(),
    diagnostics: [{ level: "log", message: "ok" }],
    createdAt: 1,
    updatedAt: 2,
  };
}

function activeDeploymentStatus() {
  return {
    activePushId: "push_1",
    activatedAt: 3,
    schemaVersion: 1,
    executionArtifactRef: {
      runtime: "dynamic-worker",
      artifactId: "artifact_1",
      sourcePackageHash: "a".repeat(64),
      executionModule: "__execution.ts",
    },
    sourcePackage: sourcePackage(),
    analysis: deploymentAnalysis(),
    codegenAnalysis: deploymentCodegenAnalysis(),
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

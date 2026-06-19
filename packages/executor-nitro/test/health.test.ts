import { describe, expect, it } from "vitest";

import {
  DeploymentNotFoundError,
  DeploymentPackageNotActivatedError,
  DeploymentProjectMismatchError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
  createFlarexExecutor,
  type FlarexExecutor,
  type PrepareInvokeInput,
  type PrepareInvokeResult,
} from "@flarex/executor";

import { createFlarexNitroHandler } from "../src/index";

describe("createFlarexNitroHandler", () => {
  it("maps health requests to the executor core", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
        persistence: healthyPersistence(),
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/health"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "executor",
      status: "ok",
      persistence: { status: "ok" },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("returns a JSON 404 for unknown adapter routes", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        persistence: healthyPersistence(),
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/unknown"),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "No Flarex executor adapter route for GET /unknown",
    });
  });

  it("serializes degraded executor health without failing the route", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
        persistence: {
          ...healthyPersistence(),
          async check() {
            throw new Error("database unavailable");
          },
        },
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/health"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "executor",
      status: "degraded",
      persistence: {
        status: "error",
        message: "database unavailable",
      },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("maps invoke prepare requests to the executor core", async () => {
    const calls: PrepareInvokeInput[] = [];
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor({
        async prepareInvoke(input) {
          calls.push(input);
          return preparedInvokeResult({
            deploymentId: input.deploymentId,
            packageId: "package_active",
            path: input.path,
            kind: input.kind ?? "query",
            schemaVersion: 12,
            executionModule: "_flarex/execution.js",
          });
        },
      }),
    });

    const response = await handler({
      request: jsonRequest("https://executor.test/invoke/prepare", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
      }),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      deploymentId: "deployment_active",
      packageId: "package_active",
      path: "messages:list",
      kind: "query",
      schemaVersion: 12,
      executionModule: "_flarex/execution.js",
    });
  });

  it("rejects malformed invoke prepare JSON", async () => {
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor(),
    });

    const response = await handler({
      request: new Request("https://executor.test/invoke/prepare", {
        method: "POST",
        body: "{",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "Request body must be valid JSON.",
    });
  });

  it("validates invoke prepare request fields before calling the executor", async () => {
    let called = false;
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor({
        async prepareInvoke() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await handler({
      request: jsonRequest("https://executor.test/invoke/prepare", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "action",
      }),
    });

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "kind must be query or mutation.",
    });
  });

  it("rejects non-POST invoke prepare requests", async () => {
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor(),
    });

    const response = await handler({
      request: new Request("https://executor.test/invoke/prepare"),
    });

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/invoke/prepare only supports POST",
    });
  });

  it("maps executor not found errors to 404", async () => {
    await expect(
      expectPrepareError(new DeploymentNotFoundError("deployment_missing")),
    ).resolves.toMatchObject({
      status: 404,
      body: {
        error: "DeploymentNotFoundError",
      },
    });

    await expect(
      expectPrepareError(
        new FunctionNotFoundError("deployment_active", "messages:missing"),
      ),
    ).resolves.toMatchObject({
      status: 404,
      body: {
        error: "FunctionNotFoundError",
      },
    });
  });

  it("maps executor project mismatch errors to 403", async () => {
    await expect(
      expectPrepareError(
        new DeploymentProjectMismatchError(
          "deployment_active",
          "project_requested",
          "project_actual",
        ),
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: {
        error: "DeploymentProjectMismatchError",
      },
    });
  });

  it("maps executor bad invoke shape errors to 400", async () => {
    await expect(
      expectPrepareError(
        new FunctionKindMismatchError(
          "deployment_active",
          "messages:list",
          "mutation",
          "query",
        ),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: "FunctionKindMismatchError",
      },
    });

    await expect(
      expectPrepareError(
        new FunctionNotInvokableError(
          "deployment_active",
          "messages:archive",
          "action",
        ),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: "FunctionNotInvokableError",
      },
    });
  });

  it("maps inactive deployment errors to 409", async () => {
    await expect(
      expectPrepareError(
        new DeploymentPackageNotActivatedError("deployment_active"),
      ),
    ).resolves.toMatchObject({
      status: 409,
      body: {
        error: "DeploymentPackageNotActivatedError",
      },
    });
  });
});

function healthyPersistence() {
  return {
    async check() {
      return { status: "ok" as const };
    },
    async getDeploymentMetadata() {
      return null;
    },
    async getDeploymentPackageMetadata() {
      return null;
    },
    async insertDeploymentPackageMetadata(input: {
      deploymentId: string;
      packageId: string;
      sourcePackageHash: string;
      executionModule: string;
      sourcePackageJson: Record<string, unknown>;
      analysisJson?: Record<string, unknown> | null;
    }) {
      return {
        deploymentId: input.deploymentId,
        packageId: input.packageId,
        sourcePackageHash: input.sourcePackageHash,
        executionModule: input.executionModule,
        sourcePackageJson: input.sourcePackageJson,
        analysisJson: input.analysisJson ?? null,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async insertDeploymentMetadata(input: {
      deploymentId: string;
      projectId: string;
      activePackageId?: string | null;
      activeSchemaVersion?: number;
    }) {
      return {
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        activePackageId: input.activePackageId ?? null,
        activeSchemaVersion: input.activeSchemaVersion ?? 0,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async updateDeploymentMetadataActivation(input: {
      deploymentId: string;
      activePackageId: string;
      activeSchemaVersion: number;
    }) {
      return {
        deploymentId: input.deploymentId,
        projectId: "project_test",
        activePackageId: input.activePackageId,
        activeSchemaVersion: input.activeSchemaVersion,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
  };
}

function fakeExecutor(
  overrides: Partial<FlarexExecutor> = {},
): FlarexExecutor {
  return {
    async activateDeploymentPackage() {
      throw new Error("activateDeploymentPackage is not implemented by test fake");
    },
    async ensureDeployment() {
      throw new Error("ensureDeployment is not implemented by test fake");
    },
    async getActiveFunction() {
      throw new Error("getActiveFunction is not implemented by test fake");
    },
    async getActiveDeploymentPackage() {
      throw new Error(
        "getActiveDeploymentPackage is not implemented by test fake",
      );
    },
    async prepareInvoke(input) {
      return preparedInvokeResult({
        deploymentId: input.deploymentId,
        packageId: "package_active",
        path: input.path,
        kind: input.kind ?? "query",
        schemaVersion: 12,
        executionModule: "_flarex/execution.js",
      });
    },
    async registerDeploymentPackage() {
      throw new Error("registerDeploymentPackage is not implemented by test fake");
    },
    async health() {
      return {
        service: "executor",
        status: "ok",
        persistence: { status: "ok" },
        time: "2026-06-19T00:00:00.000Z",
      };
    },
    ...overrides,
  };
}

function preparedInvokeResult(input: {
  deploymentId: string;
  packageId: string;
  path: string;
  kind: "query" | "mutation";
  schemaVersion: number;
  executionModule: string;
}): PrepareInvokeResult {
  return {
    deployment: {
      deploymentId: input.deploymentId,
      projectId: "project_active",
      activePackageId: input.packageId,
      activeSchemaVersion: input.schemaVersion,
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
    },
    package: {
      deploymentId: input.deploymentId,
      packageId: input.packageId,
      sourcePackageHash: "a".repeat(64),
      executionModule: input.executionModule,
      sourcePackageJson: {},
      analysisJson: null,
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
    },
    function: {
      path: input.path,
      kind: input.kind,
    },
    schema: {
      version: input.schemaVersion,
      tables: [],
      indexes: [],
    },
    executionModule: input.executionModule,
  };
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectPrepareError(error: Error): Promise<{
  status: number;
  body: unknown;
}> {
  const handler = createFlarexNitroHandler({
    executor: fakeExecutor({
      async prepareInvoke() {
        throw error;
      },
    }),
  });
  const response = await handler({
    request: jsonRequest("https://executor.test/invoke/prepare", {
      deploymentId: "deployment_active",
      projectId: "project_active",
      path: "messages:list",
    }),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

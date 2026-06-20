import type {
  FlarexExecutor,
  FlarexExecutorPersistence,
  PrepareInvokeResult,
} from "@flarex/executor";

import { createFlarexNitroHandler } from "../src/index";

export function healthyPersistence(): FlarexExecutorPersistence {
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
    async insertDeploymentPackageMetadata(input) {
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
    async insertDeploymentMetadata(input) {
      return {
        deploymentId: input.deploymentId,
        projectId: input.projectId,
        activePackageId: input.activePackageId ?? null,
        activeSchemaVersion: input.activeSchemaVersion ?? 0,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async updateDeploymentMetadataActivation(input) {
      return {
        deploymentId: input.deploymentId,
        projectId: "project_test",
        activePackageId: input.activePackageId,
        activeSchemaVersion: input.activeSchemaVersion,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async insertInvokeSessionMetadata(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        projectId: input.projectId,
        packageId: input.packageId,
        functionPath: input.functionPath,
        functionKind: input.functionKind,
        partitionKey: input.partitionKey,
        scopeJson: input.scopeJson,
        argsJson: input.argsJson,
        idempotencyKey: input.idempotencyKey ?? null,
        state: input.state ?? "active",
        beginTs: input.beginTs,
        schemaVersion: input.schemaVersion,
        executionModule: input.executionModule,
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
        finishedAt: null,
      };
    },
    async getInvokeSessionMetadata() {
      return null;
    },
    async finishInvokeSessionMetadata(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        projectId: "project_test",
        packageId: "package_test",
        functionPath: "messages:list",
        functionKind: "query",
        partitionKey: "team:1",
        scopeJson: {},
        argsJson: null,
        idempotencyKey: null,
        state: "finished",
        beginTs: 1,
        schemaVersion: 1,
        executionModule: "_flarex/execution.js",
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
        finishedAt: input.finishedAt,
      };
    },
    async getDocumentRevisionAtTs() {
      return null;
    },
    async insertInvokeSessionDocumentRead(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: input.tableId,
        documentId: input.documentId,
        observedTs: input.observedTs ?? null,
        readAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async listInvokeSessionDocumentReads() {
      return [];
    },
    async insertInvokeSessionDocumentWrite(input) {
      return {
        deploymentId: input.deploymentId,
        sessionId: input.sessionId,
        tableId: input.tableId,
        documentId: input.documentId,
        op: input.op,
        valueJson: input.valueJson ?? null,
        stagedAt: new Date("2026-06-19T00:00:00.000Z"),
      };
    },
    async listInvokeSessionDocumentWrites() {
      return [];
    },
    async commitInvokeSessionWrites(input) {
      return {
        committedTs: input.minimumTs + 1,
        writes: [],
      };
    },
  };
}

export function fakeExecutor(
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
    async beginInvokeSession() {
      throw new Error("beginInvokeSession is not implemented by test fake");
    },
    async finishInvokeSession() {
      throw new Error("finishInvokeSession is not implemented by test fake");
    },
    async invokeSyscall() {
      throw new Error("invokeSyscall is not implemented by test fake");
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

export function preparedInvokeResult(input: {
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
    scope: {
      kind: "partition",
      table: "teams",
      selector: "byId",
      partitionField: "_id",
      argField: "teamId",
      partitionKey: "team:1",
    },
    executionModule: input.executionModule,
  };
}

export function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function expectPrepareError(error: Error): Promise<{
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
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    }),
  });

  return {
    status: response.status,
    body: await response.json(),
  };
}

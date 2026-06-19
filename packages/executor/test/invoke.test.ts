import { describe, expect, it } from "vitest";
import type { ArtifactSourcePackage } from "flarex/artifacts";

import {
  DeploymentSchemaMetadataUnavailableError,
  FunctionKindMismatchError,
  FunctionNotInvokableError,
  createFlarexExecutor,
} from "../src";
import {
  deploymentMetadata,
  deploymentPackageMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor invoke preparation", () => {
  it("prepares an invokable active query", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_invoke",
      projectId: "project_invoke",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson({
        functions: [
          {
            path: "messages:list",
            kind: "query",
            visibility: "public",
            args: { type: "any" },
            returns: null,
          },
        ],
      }),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_invoke",
      projectId: "project_invoke",
      packageId: registered.package.packageId,
      schemaVersion: 5,
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:list",
        kind: "query",
      }),
    ).resolves.toMatchObject({
      deployment: {
        deploymentId: "deployment_invoke",
        activePackageId: registered.package.packageId,
        activeSchemaVersion: 5,
      },
      package: {
        packageId: registered.package.packageId,
      },
      function: {
        path: "messages:list",
        kind: "query",
      },
      schema: {
        version: 5,
        tables: [],
        indexes: [],
      },
      executionModule: "_flarex/execution.js",
    });
  });

  it("prepares an invokable active mutation without a caller kind expectation", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [
          deploymentMetadata({
            deploymentId: "deployment_invoke",
            projectId: "project_invoke",
            activePackageId: "package_invoke",
            activeSchemaVersion: 5,
          }),
        ],
        [
          deploymentPackageMetadata({
            deploymentId: "deployment_invoke",
            packageId: "package_invoke",
            sourcePackageHash: "a".repeat(64),
            executionModule: "_flarex/execution.js",
            sourcePackageJson: sourcePackageJson(),
            analysisJson: analysisJson({
              functions: [{ path: "messages:send", kind: "mutation" }],
            }),
          }),
        ],
      ),
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:send",
      }),
    ).resolves.toMatchObject({
      function: {
        path: "messages:send",
        kind: "mutation",
      },
    });
  });

  it("rejects caller kind mismatches", async () => {
    const executor = executorWithActivePackage({
      functions: [{ path: "messages:list", kind: "query" }],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:list",
        kind: "mutation",
      }),
    ).rejects.toThrow(FunctionKindMismatchError);
  });

  it("rejects active actions because /invoke only supports queries and mutations", async () => {
    const executor = executorWithActivePackage({
      functions: [{ path: "messages:archive", kind: "action" }],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:archive",
      }),
    ).rejects.toThrow(FunctionNotInvokableError);
  });

  it("rejects active packages without schema analysis metadata", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [
          deploymentMetadata({
            deploymentId: "deployment_invoke",
            projectId: "project_invoke",
            activePackageId: "package_invoke",
            activeSchemaVersion: 5,
          }),
        ],
        [
          deploymentPackageMetadata({
            deploymentId: "deployment_invoke",
            packageId: "package_invoke",
            sourcePackageHash: "a".repeat(64),
            executionModule: "_flarex/execution.js",
            sourcePackageJson: sourcePackageJson(),
            analysisJson: {
              functions: {
                functions: [{ path: "messages:list", kind: "query" }],
              },
            },
          }),
        ],
      ),
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:list",
      }),
    ).rejects.toThrow(DeploymentSchemaMetadataUnavailableError);
  });

  it("rejects malformed schema analysis metadata", async () => {
    const executor = executorWithActivePackage({
      schema: { version: 5, tables: "bad", indexes: [] },
      functions: [{ path: "messages:list", kind: "query" }],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:list",
      }),
    ).rejects.toThrow(DeploymentSchemaMetadataUnavailableError);
  });
});

function executorWithActivePackage(input: {
  schema?: unknown;
  functions: Array<Record<string, unknown>>;
}) {
  return createFlarexExecutor({
    persistence: memoryPersistence(
      [
        deploymentMetadata({
          deploymentId: "deployment_invoke",
          projectId: "project_invoke",
          activePackageId: "package_invoke",
          activeSchemaVersion: 5,
        }),
      ],
      [
        deploymentPackageMetadata({
          deploymentId: "deployment_invoke",
          packageId: "package_invoke",
          sourcePackageHash: "a".repeat(64),
          executionModule: "_flarex/execution.js",
          sourcePackageJson: sourcePackageJson(),
          analysisJson: analysisJson(input),
        }),
      ],
    ),
  });
}

function analysisJson(input: {
  schema?: unknown;
  functions: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  return {
    schema: input.schema ?? { version: 5, tables: [], indexes: [] },
    functions: { functions: input.functions },
  };
}

function sourcePackage(): ArtifactSourcePackage {
  return {
    modules: [
      {
        path: "messages.js",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
    ],
    functions: ["messages.js"],
    execution: "_flarex/execution.js",
  };
}

function sourcePackageJson(): Record<string, unknown> {
  return sourcePackage() as unknown as Record<string, unknown>;
}

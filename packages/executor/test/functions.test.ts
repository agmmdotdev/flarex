import { describe, expect, it } from "vitest";
import type { ArtifactSourcePackage } from "flarex/artifacts";

import {
  DeploymentFunctionMetadataUnavailableError,
  FunctionNotFoundError,
  createFlarexExecutor,
} from "../src";
import {
  deploymentMetadata,
  deploymentPackageMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor function resolution", () => {
  it("resolves function metadata from the active deployment package", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_functions",
      projectId: "project_functions",
      sourcePackage: sourcePackage(),
      analysisJson: {
        functions: {
          functions: [
            {
              path: "messages:list",
              kind: "query",
              visibility: "public",
              args: { type: "any" },
              returns: null,
              partition: {
                type: "partition",
                table: "teams",
                selector: "byId",
                partitionField: "_id",
                argField: "teamId",
              },
            },
          ],
        },
      },
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_functions",
      projectId: "project_functions",
      packageId: registered.package.packageId,
      schemaVersion: 3,
    });

    await expect(
      executor.getActiveFunction({
        deploymentId: "deployment_functions",
        projectId: "project_functions",
        path: "messages:list",
      }),
    ).resolves.toMatchObject({
      deployment: {
        deploymentId: "deployment_functions",
        activePackageId: registered.package.packageId,
      },
      package: {
        packageId: registered.package.packageId,
      },
      function: {
        path: "messages:list",
        kind: "query",
        visibility: "public",
        returns: null,
        partition: {
          table: "teams",
          argField: "teamId",
        },
      },
    });
  });

  it("rejects a function path missing from active metadata", async () => {
    const persistence = memoryPersistence(
      [
        deploymentMetadata({
          deploymentId: "deployment_functions",
          projectId: "project_functions",
          activePackageId: "package_functions",
          activeSchemaVersion: 3,
        }),
      ],
      [
        deploymentPackageMetadata({
          deploymentId: "deployment_functions",
          packageId: "package_functions",
          sourcePackageHash: "a".repeat(64),
          executionModule: "_flarex/execution.js",
          sourcePackageJson: sourcePackageJson(),
          analysisJson: {
            functions: { functions: [{ path: "messages:list", kind: "query" }] },
          },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.getActiveFunction({
        deploymentId: "deployment_functions",
        projectId: "project_functions",
        path: "messages:send",
      }),
    ).rejects.toThrow(FunctionNotFoundError);
  });

  it("rejects active packages without function analysis metadata", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [
          deploymentMetadata({
            deploymentId: "deployment_functions",
            projectId: "project_functions",
            activePackageId: "package_functions",
            activeSchemaVersion: 3,
          }),
        ],
        [
          deploymentPackageMetadata({
            deploymentId: "deployment_functions",
            packageId: "package_functions",
            sourcePackageHash: "a".repeat(64),
            executionModule: "_flarex/execution.js",
            sourcePackageJson: sourcePackageJson(),
            analysisJson: null,
          }),
        ],
      ),
    });

    await expect(
      executor.getActiveFunction({
        deploymentId: "deployment_functions",
        projectId: "project_functions",
        path: "messages:list",
      }),
    ).rejects.toThrow(DeploymentFunctionMetadataUnavailableError);
  });

  it("rejects malformed active function metadata", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [
          deploymentMetadata({
            deploymentId: "deployment_functions",
            projectId: "project_functions",
            activePackageId: "package_functions",
            activeSchemaVersion: 3,
          }),
        ],
        [
          deploymentPackageMetadata({
            deploymentId: "deployment_functions",
            packageId: "package_functions",
            sourcePackageHash: "a".repeat(64),
            executionModule: "_flarex/execution.js",
            sourcePackageJson: sourcePackageJson(),
            analysisJson: {
              functions: { functions: [{ path: "messages:list", kind: "job" }] },
            },
          }),
        ],
      ),
    });

    await expect(
      executor.getActiveFunction({
        deploymentId: "deployment_functions",
        projectId: "project_functions",
        path: "messages:list",
      }),
    ).rejects.toThrow(DeploymentFunctionMetadataUnavailableError);
  });
});

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

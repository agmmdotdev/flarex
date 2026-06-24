import { describe, expect, it } from "vitest";
import type { ArtifactSourcePackage } from "flarex/artifacts";

import {
  DeploymentSchemaMetadataUnavailableError,
  FunctionKindMismatchError,
  FunctionNotInvokableError,
  FunctionVisibilityMismatchError,
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
            route: { type: "args", field: "teamId" },
            partition: teamPartition(),
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
        args: { teamId: "team:1" },
        partitionKey: "team:1",
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
        tables: [
          {
            tableId: 1,
            name: "teams",
            placement: { kind: "partitionBy", field: "_id" },
          },
        ],
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
              functions: [
                {
                  path: "messages:send",
                  kind: "mutation",
                  route: { type: "args", field: "teamId" },
                  partition: teamPartition(),
                },
              ],
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
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    ).resolves.toMatchObject({
      function: {
        path: "messages:send",
        kind: "mutation",
      },
      scope: {
        partitionKey: "team:1",
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
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    ).rejects.toThrow(FunctionKindMismatchError);
  });

  it("rejects internal functions for public invoke preparation by default", async () => {
    const executor = executorWithActivePackage({
      functions: [
        {
          path: "messages:internalList",
          kind: "query",
          visibility: "internal",
          route: { type: "args", field: "teamId" },
          partition: teamPartition(),
        },
      ],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:internalList",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    ).rejects.toThrow(FunctionVisibilityMismatchError);
  });

  it("prepares internal functions when the caller expects internal visibility", async () => {
    const executor = executorWithActivePackage({
      functions: [
        {
          path: "messages:internalList",
          kind: "query",
          visibility: "internal",
          route: { type: "args", field: "teamId" },
          partition: teamPartition(),
        },
      ],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:internalList",
        visibility: "internal",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    ).resolves.toMatchObject({
      function: {
        path: "messages:internalList",
        kind: "query",
        visibility: "internal",
      },
    });
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
        args: { teamId: "team:1" },
        partitionKey: "team:1",
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
        args: { teamId: "team:1" },
        partitionKey: "team:1",
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
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    ).rejects.toThrow(DeploymentSchemaMetadataUnavailableError);
  });

  it("rejects invoke preparation without partition metadata", async () => {
    const executor = executorWithActivePackage({
      functions: [{ path: "messages:list", kind: "query" }],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:list",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    ).rejects.toThrow(
      "PartitionValidationError: function messages:list must declare partition metadata.",
    );
  });

  it("rejects mismatched partition keys", async () => {
    const executor = executorWithActivePackage({
      functions: [
        {
          path: "messages:list",
          kind: "query",
          route: { type: "args", field: "teamId" },
          partition: teamPartition(),
        },
      ],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:list",
        args: { teamId: "team:1" },
        partitionKey: "team:wrong",
      }),
    ).rejects.toThrow(
      "PartitionValidationError: partitionKey must match args.teamId for messages:list.",
    );
  });

  it("rejects partition metadata that does not match schema placement", async () => {
    const executor = executorWithActivePackage({
      functions: [
        {
          path: "messages:list",
          kind: "query",
          partition: {
            type: "partition",
            table: "teams",
            selector: "bySlug",
            partitionField: "slug",
            argField: "teamSlug",
          },
        },
      ],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "messages:list",
        args: { teamSlug: "acme" },
        partitionKey: "acme",
      }),
    ).rejects.toThrow(
      "PartitionValidationError: messages:list partition selector bySlug targets slug, but teams is partitioned by _id.",
    );
  });

  it("prepares create-root partition scopes with a preallocated root id", async () => {
    const executor = executorWithActivePackage({
      functions: [
        {
          path: "teams:create",
          kind: "mutation",
          partition: {
            type: "partitionCreateRoot",
            table: "teams",
            partitionField: "_id",
          },
        },
      ],
    });

    await expect(
      executor.prepareInvoke({
        deploymentId: "deployment_invoke",
        projectId: "project_invoke",
        path: "teams:create",
        args: { name: "Acme" },
      }),
    ).resolves.toMatchObject({
      scope: {
        kind: "partitionCreateRoot",
        table: "teams",
        partitionField: "_id",
        partitionKey: expect.stringMatching(/^1:/),
        preallocatedRootId: expect.stringMatching(/^1:/),
      },
    });
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
    schema: input.schema ?? {
      version: 5,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    },
    functions: { functions: input.functions },
  };
}

function teamPartition(): Record<string, unknown> {
  return {
    type: "partition",
    table: "teams",
    selector: "byId",
    partitionField: "_id",
    argField: "teamId",
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

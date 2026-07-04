import { describe, expect, it } from "vitest";
import {
  executionArtifactRefForSourcePackage,
  type ArtifactSourcePackage,
} from "flarex/artifacts";

import {
  DeploymentNotFoundError,
  DeploymentAuthConfigMetadataUnavailableError,
  DeploymentPackageMismatchError,
  DeploymentPackageNotActivatedError,
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
  createFlarexExecutor,
} from "../src";
import {
  deploymentMetadata,
  deploymentPackageMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor deployment behavior", () => {
  it("registers a package for a missing deployment", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.registerDeploymentPackage({
        deploymentId: "deployment_package",
        projectId: "project_package",
        sourcePackage: sourcePackage(),
        analysisJson: { functions: [] },
      }),
    ).resolves.toMatchObject({
      createdDeployment: true,
      createdPackage: true,
      package: {
        deploymentId: "deployment_package",
        packageId: expect.stringMatching(/^artifact_[a-f0-9]{32}$/),
        sourcePackageHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        executionModule: "_flarex/execution.js",
      },
    });
  });

  it("returns existing package registration idempotently", async () => {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());
    const persistence = memoryPersistence(
      [
        deploymentMetadata({
          deploymentId: "deployment_package",
          projectId: "project_package",
        }),
      ],
      [
        deploymentPackageMetadata({
          deploymentId: "deployment_package",
          packageId: ref.artifactId,
          sourcePackageHash: ref.sourcePackageHash,
          executionModule: ref.executionModule,
          sourcePackageJson: sourcePackageJson(),
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.registerDeploymentPackage({
        deploymentId: "deployment_package",
        projectId: "project_package",
        sourcePackage: sourcePackage(),
      }),
    ).resolves.toMatchObject({
      createdDeployment: false,
      createdPackage: false,
      package: {
        deploymentId: "deployment_package",
        packageId: ref.artifactId,
      },
    });
  });

  it("rejects mismatched package registration metadata", async () => {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());
    const persistence = memoryPersistence(
      [
        deploymentMetadata({
          deploymentId: "deployment_package",
          projectId: "project_package",
        }),
      ],
      [
        deploymentPackageMetadata({
          deploymentId: "deployment_package",
          packageId: ref.artifactId,
          sourcePackageHash: "b".repeat(64),
          executionModule: ref.executionModule,
          sourcePackageJson: sourcePackageJson(),
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.registerDeploymentPackage({
        deploymentId: "deployment_package",
        projectId: "project_package",
        sourcePackage: sourcePackage(),
      }),
    ).rejects.toThrow(DeploymentPackageMismatchError);
  });

  it("activates a registered package", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_activate",
      projectId: "project_activate",
      sourcePackage: sourcePackage(),
    });

    await expect(
      executor.activateDeploymentPackage({
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        packageId: registered.package.packageId,
        schemaVersion: 4,
      }),
    ).resolves.toMatchObject({
      createdDeployment: false,
      deployment: {
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        activePackageId: registered.package.packageId,
        activeSchemaVersion: 4,
      },
    });
  });

  it("activates a package for an existing deployment", async () => {
    const ref = await executionArtifactRefForSourcePackage(sourcePackage());
    const persistence = memoryPersistence(
      [
        deploymentMetadata({
          deploymentId: "deployment_activate",
          projectId: "project_activate",
          activePackageId: "package_old",
          activeSchemaVersion: 3,
        }),
      ],
      [
        deploymentPackageMetadata({
          deploymentId: "deployment_activate",
          packageId: ref.artifactId,
          sourcePackageHash: ref.sourcePackageHash,
          executionModule: ref.executionModule,
          sourcePackageJson: sourcePackageJson(),
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.activateDeploymentPackage({
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        packageId: ref.artifactId,
        schemaVersion: 4,
      }),
    ).resolves.toMatchObject({
      createdDeployment: false,
      deployment: {
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        activePackageId: ref.artifactId,
        activeSchemaVersion: 4,
      },
    });
  });

  it("rejects activation for an unregistered package", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([
        deploymentMetadata({
          deploymentId: "deployment_activate",
          projectId: "project_activate",
        }),
      ]),
    });

    await expect(
      executor.activateDeploymentPackage({
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        packageId: "package_missing",
        schemaVersion: 4,
      }),
    ).rejects.toThrow(DeploymentPackageNotFoundError);
  });

  it("rejects package activation for a deployment in another project", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([
        deploymentMetadata({
          deploymentId: "deployment_activate",
          projectId: "project_a",
        }),
      ]),
    });

    await expect(
      executor.activateDeploymentPackage({
        deploymentId: "deployment_activate",
        projectId: "project_b",
        packageId: "package_new",
        schemaVersion: 4,
      }),
    ).rejects.toThrow(DeploymentProjectMismatchError);
  });

  it("resolves the active deployment package", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_active_package",
      projectId: "project_active_package",
      sourcePackage: sourcePackage(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_active_package",
      projectId: "project_active_package",
      packageId: registered.package.packageId,
      schemaVersion: 7,
    });

    await expect(
      executor.getActiveDeploymentPackage({
        deploymentId: "deployment_active_package",
        projectId: "project_active_package",
      }),
    ).resolves.toMatchObject({
      deployment: {
        deploymentId: "deployment_active_package",
        projectId: "project_active_package",
        activePackageId: registered.package.packageId,
        activeSchemaVersion: 7,
      },
      package: {
        deploymentId: "deployment_active_package",
        packageId: registered.package.packageId,
      },
    });
  });

  it("resolves active auth config from the active package metadata", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });
    const source = sourcePackageWithAuthConfig();

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_active_auth",
      projectId: "project_active_auth",
      sourcePackage: source,
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_active_auth",
      projectId: "project_active_auth",
      packageId: registered.package.packageId,
      schemaVersion: 9,
    });

    await expect(
      executor.getActiveDeploymentAuthConfig({
        deploymentId: "deployment_active_auth",
        projectId: "project_active_auth",
      }),
    ).resolves.toMatchObject({
      deployment: {
        deploymentId: "deployment_active_auth",
        projectId: "project_active_auth",
        activePackageId: registered.package.packageId,
      },
      package: {
        deploymentId: "deployment_active_auth",
        packageId: registered.package.packageId,
      },
      authConfig: source.authConfig,
      authConfigModule: "flarex/auth.config.ts",
    });
  });

  it("returns null active auth config for deployments without auth providers", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_no_auth",
      projectId: "project_no_auth",
      sourcePackage: sourcePackage(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_no_auth",
      projectId: "project_no_auth",
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    await expect(
      executor.getActiveDeploymentAuthConfig({
        deploymentId: "deployment_no_auth",
        projectId: "project_no_auth",
      }),
    ).resolves.toMatchObject({
      authConfig: null,
      authConfigModule: null,
    });
  });

  it("rejects corrupt persisted active auth config metadata", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [
          deploymentMetadata({
            deploymentId: "deployment_corrupt_auth",
            projectId: "project_corrupt_auth",
            activePackageId: "package_corrupt_auth",
            activeSchemaVersion: 1,
          }),
        ],
        [
          deploymentPackageMetadata({
            deploymentId: "deployment_corrupt_auth",
            packageId: "package_corrupt_auth",
            sourcePackageHash: "a".repeat(64),
            executionModule: "_flarex/execution.js",
            sourcePackageJson: {
              ...sourcePackageJson(),
              authConfig: { providers: [{ domain: "", applicationID: "app" }] },
              authConfigModule: "flarex/auth.config.ts",
            },
          }),
        ],
      ),
    });

    await expect(
      executor.getActiveDeploymentAuthConfig({
        deploymentId: "deployment_corrupt_auth",
        projectId: "project_corrupt_auth",
      }),
    ).rejects.toThrow(DeploymentAuthConfigMetadataUnavailableError);
  });

  it.each([
    {
      name: "auth module without auth config",
      sourcePackageJson: {
        ...sourcePackageJson(),
        authConfigModule: "flarex/auth.config.ts",
      },
    },
    {
      name: "auth config without auth module",
      sourcePackageJson: {
        ...sourcePackageJson(),
        authConfig: sourcePackageWithAuthConfig().authConfig,
      },
    },
    {
      name: "auth module missing from modules",
      sourcePackageJson: {
        ...sourcePackageJson(),
        authConfig: sourcePackageWithAuthConfig().authConfig,
        authConfigModule: "flarex/auth.config.ts",
      },
    },
  ])("rejects corrupt persisted active auth metadata: $name", async ({ sourcePackageJson }) => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [
          deploymentMetadata({
            deploymentId: "deployment_corrupt_auth_pairing",
            projectId: "project_corrupt_auth_pairing",
            activePackageId: "package_corrupt_auth_pairing",
            activeSchemaVersion: 1,
          }),
        ],
        [
          deploymentPackageMetadata({
            deploymentId: "deployment_corrupt_auth_pairing",
            packageId: "package_corrupt_auth_pairing",
            sourcePackageHash: "a".repeat(64),
            executionModule: "_flarex/execution.js",
            sourcePackageJson,
          }),
        ],
      ),
    });

    await expect(
      executor.getActiveDeploymentAuthConfig({
        deploymentId: "deployment_corrupt_auth_pairing",
        projectId: "project_corrupt_auth_pairing",
      }),
    ).rejects.toThrow(DeploymentAuthConfigMetadataUnavailableError);
  });

  it("rejects active package resolution for a missing deployment", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(),
    });

    await expect(
      executor.getActiveDeploymentPackage({
        deploymentId: "deployment_missing",
        projectId: "project_active_package",
      }),
    ).rejects.toThrow(DeploymentNotFoundError);
  });

  it("rejects active package resolution for a deployment in another project", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([
        deploymentMetadata({
          deploymentId: "deployment_active_package",
          projectId: "project_a",
          activePackageId: "package_active",
          activeSchemaVersion: 7,
        }),
      ]),
    });

    await expect(
      executor.getActiveDeploymentPackage({
        deploymentId: "deployment_active_package",
        projectId: "project_b",
      }),
    ).rejects.toThrow(DeploymentProjectMismatchError);
  });

  it("rejects active package resolution before activation", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([
        deploymentMetadata({
          deploymentId: "deployment_active_package",
          projectId: "project_active_package",
        }),
      ]),
    });

    await expect(
      executor.getActiveDeploymentPackage({
        deploymentId: "deployment_active_package",
        projectId: "project_active_package",
      }),
    ).rejects.toThrow(DeploymentPackageNotActivatedError);
  });

  it("rejects active package resolution when the active package row is missing", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([
        deploymentMetadata({
          deploymentId: "deployment_active_package",
          projectId: "project_active_package",
          activePackageId: "package_missing",
          activeSchemaVersion: 7,
        }),
      ]),
    });

    await expect(
      executor.getActiveDeploymentPackage({
        deploymentId: "deployment_active_package",
        projectId: "project_active_package",
      }),
    ).rejects.toThrow(DeploymentPackageNotFoundError);
  });

  it("creates missing deployment metadata", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.ensureDeployment({
        deploymentId: "deployment_a",
        projectId: "project_a",
      }),
    ).resolves.toMatchObject({
      created: true,
      deployment: {
        deploymentId: "deployment_a",
        projectId: "project_a",
        activePackageId: null,
        activeSchemaVersion: 0,
      },
    });

    await expect(
      persistence.getDeploymentMetadata("deployment_a"),
    ).resolves.toMatchObject({
      deploymentId: "deployment_a",
      projectId: "project_a",
    });
  });

  it("returns existing deployment metadata idempotently", async () => {
    const persistence = memoryPersistence([
      deploymentMetadata({
        deploymentId: "deployment_a",
        projectId: "project_a",
      }),
    ]);
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.ensureDeployment({
        deploymentId: "deployment_a",
        projectId: "project_a",
      }),
    ).resolves.toMatchObject({
      created: false,
      deployment: {
        deploymentId: "deployment_a",
        projectId: "project_a",
      },
    });
  });

  it("recovers from duplicate insert races by re-reading deployment metadata", async () => {
    const persistence = memoryPersistence([
      deploymentMetadata({
        deploymentId: "deployment_race",
        projectId: "project_race",
      }),
    ]);
    let firstRead = true;
    const racingPersistence = {
      ...persistence,
      async getDeploymentMetadata(deploymentId: string) {
        if (firstRead) {
          firstRead = false;
          return null;
        }
        return persistence.getDeploymentMetadata(deploymentId);
      },
    };
    const executor = createFlarexExecutor({ persistence: racingPersistence });

    await expect(
      executor.ensureDeployment({
        deploymentId: "deployment_race",
        projectId: "project_race",
      }),
    ).resolves.toMatchObject({
      created: false,
      deployment: {
        deploymentId: "deployment_race",
        projectId: "project_race",
      },
    });
  });

  it("rejects deployment metadata from another project", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([
        deploymentMetadata({
          deploymentId: "deployment_a",
          projectId: "project_a",
        }),
      ]),
    });

    await expect(
      executor.ensureDeployment({
        deploymentId: "deployment_a",
        projectId: "project_b",
      }),
    ).rejects.toThrow(DeploymentProjectMismatchError);
  });
});

function sourcePackage(): ArtifactSourcePackage {
  return {
    modules: [
      {
        path: "functions.js",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
    ],
    functions: [],
    execution: "_flarex/execution.js",
  };
}

function sourcePackageWithAuthConfig(): ArtifactSourcePackage {
  return {
    ...sourcePackage(),
    modules: [
      ...sourcePackage().modules,
      {
        path: "flarex/auth.config.ts",
        environment: "isolate",
        sha256: "b".repeat(64),
      },
    ],
    authConfig: {
      providers: [
        {
          domain: "https://issuer.example.com",
          applicationID: "flarex-app",
        },
      ],
    },
    authConfigModule: "flarex/auth.config.ts",
  };
}

function sourcePackageJson(): Record<string, unknown> {
  return sourcePackage() as unknown as Record<string, unknown>;
}

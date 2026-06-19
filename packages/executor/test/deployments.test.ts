import { describe, expect, it } from "vitest";
import {
  executionArtifactRefForSourcePackage,
  type ArtifactSourcePackage,
} from "flarex/artifacts";

import {
  DeploymentPackageMismatchError,
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

function sourcePackageJson(): Record<string, unknown> {
  return sourcePackage() as unknown as Record<string, unknown>;
}

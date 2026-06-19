import { describe, expect, it } from "vitest";

import {
  DeploymentProjectMismatchError,
  createFlarexExecutor,
} from "../src";
import {
  deploymentMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor deployment behavior", () => {
  it("activates a package for a missing deployment", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.activateDeploymentPackage({
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        packageId: "package_activate",
        schemaVersion: 4,
      }),
    ).resolves.toMatchObject({
      createdDeployment: true,
      deployment: {
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        activePackageId: "package_activate",
        activeSchemaVersion: 4,
      },
    });
  });

  it("activates a package for an existing deployment", async () => {
    const persistence = memoryPersistence([
      deploymentMetadata({
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        activePackageId: "package_old",
        activeSchemaVersion: 3,
      }),
    ]);
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.activateDeploymentPackage({
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        packageId: "package_new",
        schemaVersion: 4,
      }),
    ).resolves.toMatchObject({
      createdDeployment: false,
      deployment: {
        deploymentId: "deployment_activate",
        projectId: "project_activate",
        activePackageId: "package_new",
        activeSchemaVersion: 4,
      },
    });
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

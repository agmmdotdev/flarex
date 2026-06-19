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

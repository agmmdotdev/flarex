import { describe, expect, it } from "vitest";

import {
  DeploymentProjectMismatchError,
  createFlarexExecutor,
} from "../src/index";
import {
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
  type InsertDeploymentMetadataInput,
} from "@flarex/persistence-postgres";

describe("createFlarexExecutor", () => {
  it("returns stable health state directly", async () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
      persistence: healthyPersistence(),
    });

    await expect(executor.health()).resolves.toEqual({
      service: "executor",
      status: "ok",
      persistence: { status: "ok" },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("reports degraded health when persistence fails", async () => {
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
      persistence: {
        ...healthyPersistence(),
        async check() {
          throw new Error("database unavailable");
        },
      },
    });

    await expect(executor.health()).resolves.toEqual({
      service: "executor",
      status: "degraded",
      persistence: {
        status: "error",
        message: "database unavailable",
      },
      time: "2026-06-19T00:00:00.000Z",
    });
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

function healthyPersistence() {
  return memoryPersistence();
}

function memoryPersistence(initialDeployments: DeploymentMetadataRecord[] = []) {
  const deployments = new Map<string, DeploymentMetadataRecord>(
    initialDeployments.map((deployment) => [
      deployment.deploymentId,
      deployment,
    ]),
  );

  return {
    async check() {
      return { status: "ok" as const };
    },
    async getDeploymentMetadata(deploymentId: string) {
      return deployments.get(deploymentId) ?? null;
    },
    async insertDeploymentMetadata(input: InsertDeploymentMetadataInput) {
      if (deployments.has(input.deploymentId)) {
        throw new DeploymentMetadataAlreadyExistsError(input.deploymentId);
      }
      const deployment = deploymentMetadata(input);
      deployments.set(deployment.deploymentId, deployment);
      return deployment;
    },
  };
}

function deploymentMetadata(
  input: InsertDeploymentMetadataInput,
): DeploymentMetadataRecord {
  return {
    deploymentId: input.deploymentId,
    projectId: input.projectId,
    activePackageId: input.activePackageId ?? null,
    activeSchemaVersion: input.activeSchemaVersion ?? 0,
    createdAt: new Date("2026-06-19T00:00:00.000Z"),
  };
}

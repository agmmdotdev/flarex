import {
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
  type InsertDeploymentMetadataInput,
  type UpdateDeploymentMetadataActivationInput,
} from "@flarex/persistence-postgres";

import type { FlarexExecutorPersistence } from "../../src";

export function healthyPersistence(): FlarexExecutorPersistence {
  return memoryPersistence();
}

export function memoryPersistence(
  initialDeployments: DeploymentMetadataRecord[] = [],
): FlarexExecutorPersistence {
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
    async updateDeploymentMetadataActivation(
      input: UpdateDeploymentMetadataActivationInput,
    ) {
      const deployment = deployments.get(input.deploymentId);
      if (deployment === undefined) {
        return null;
      }

      const updated = {
        ...deployment,
        activePackageId: input.activePackageId,
        activeSchemaVersion: input.activeSchemaVersion,
      };
      deployments.set(updated.deploymentId, updated);
      return updated;
    },
  };
}

export function deploymentMetadata(
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

import {
  DeploymentPackageMetadataAlreadyExistsError,
  type DeploymentPackageMetadataRecord,
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
  type InsertDeploymentPackageMetadataInput,
  type InsertDeploymentMetadataInput,
  type UpdateDeploymentMetadataActivationInput,
} from "@flarex/persistence-postgres";

import type { FlarexExecutorPersistence } from "../../src";

export function healthyPersistence(): FlarexExecutorPersistence {
  return memoryPersistence();
}

export function memoryPersistence(
  initialDeployments: DeploymentMetadataRecord[] = [],
  initialPackages: DeploymentPackageMetadataRecord[] = [],
): FlarexExecutorPersistence {
  const deployments = new Map<string, DeploymentMetadataRecord>(
    initialDeployments.map((deployment) => [
      deployment.deploymentId,
      deployment,
    ]),
  );
  const packages = new Map<string, DeploymentPackageMetadataRecord>(
    initialPackages.map((deploymentPackage) => [
      packageKey(deploymentPackage.deploymentId, deploymentPackage.packageId),
      deploymentPackage,
    ]),
  );

  return {
    async check() {
      return { status: "ok" as const };
    },
    async getDeploymentPackageMetadata(deploymentId: string, packageId: string) {
      return packages.get(packageKey(deploymentId, packageId)) ?? null;
    },
    async insertDeploymentPackageMetadata(
      input: InsertDeploymentPackageMetadataInput,
    ) {
      const key = packageKey(input.deploymentId, input.packageId);
      if (packages.has(key)) {
        throw new DeploymentPackageMetadataAlreadyExistsError(
          input.deploymentId,
          input.packageId,
        );
      }
      const deploymentPackage = deploymentPackageMetadata(input);
      packages.set(key, deploymentPackage);
      return deploymentPackage;
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

export function deploymentPackageMetadata(
  input: InsertDeploymentPackageMetadataInput,
): DeploymentPackageMetadataRecord {
  return {
    deploymentId: input.deploymentId,
    packageId: input.packageId,
    sourcePackageHash: input.sourcePackageHash,
    executionModule: input.executionModule,
    sourcePackageJson: input.sourcePackageJson,
    analysisJson: input.analysisJson ?? null,
    createdAt: new Date("2026-06-19T00:00:00.000Z"),
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

function packageKey(deploymentId: string, packageId: string): string {
  return `${deploymentId}/${packageId}`;
}

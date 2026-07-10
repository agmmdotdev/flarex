import type { DeploymentMetadataRecord } from "@flarex/persistence-postgres";

import {
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
} from "./errors";
import type {
  ActivateDeploymentPackageInput,
  ActivateDeploymentPackageResult,
  EnsureDeploymentInput,
  EnsureDeploymentResult,
  FlarexExecutorControlPersistence,
} from "./types";

export async function activateDeploymentPackage(
  persistence: FlarexExecutorControlPersistence,
  input: ActivateDeploymentPackageInput,
): Promise<ActivateDeploymentPackageResult> {
  const ensured = await ensureDeployment(persistence, input);
  const deploymentPackage = await persistence.getDeploymentPackageMetadata(
    input.deploymentId,
    input.packageId,
  );
  if (deploymentPackage === null) {
    throw new DeploymentPackageNotFoundError(
      input.deploymentId,
      input.packageId,
    );
  }

  const deployment = await persistence.updateDeploymentMetadataActivation({
    deploymentId: input.deploymentId,
    activePackageId: input.packageId,
    activeSchemaVersion: input.schemaVersion,
  });

  if (deployment === null) {
    throw new Error(
      `Deployment disappeared before package activation: ${input.deploymentId}`,
    );
  }

  return {
    deployment,
    createdDeployment: ensured.created,
  };
}

export async function ensureDeployment(
  persistence: FlarexExecutorControlPersistence,
  input: EnsureDeploymentInput,
): Promise<EnsureDeploymentResult> {
  try {
    const ensured = await persistence.ensureDeploymentAuthority(input);
    return {
      deployment: assertDeploymentProject(ensured.deployment, input),
      created: ensured.createdDeployment,
    };
  } catch (error) {
    let deployment: DeploymentMetadataRecord | null;
    try {
      deployment = await persistence.getDeploymentMetadata(input.deploymentId);
    } catch {
      throw error;
    }
    if (deployment !== null) {
      assertDeploymentProject(deployment, input);
    }
    throw error;
  }
}

export function assertDeploymentProject(
  deployment: DeploymentMetadataRecord,
  input: EnsureDeploymentInput,
): DeploymentMetadataRecord {
  if (deployment.projectId !== input.projectId) {
    throw new DeploymentProjectMismatchError(
      deployment.deploymentId,
      input.projectId,
      deployment.projectId,
    );
  }

  return deployment;
}

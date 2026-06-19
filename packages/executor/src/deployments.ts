import {
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
} from "@flarex/persistence-postgres";

import {
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
} from "./errors";
import type {
  ActivateDeploymentPackageInput,
  ActivateDeploymentPackageResult,
  EnsureDeploymentInput,
  EnsureDeploymentResult,
  FlarexExecutorPersistence,
} from "./types";

export async function activateDeploymentPackage(
  persistence: FlarexExecutorPersistence,
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
  persistence: FlarexExecutorPersistence,
  input: EnsureDeploymentInput,
): Promise<EnsureDeploymentResult> {
  const existingDeployment = await persistence.getDeploymentMetadata(
    input.deploymentId,
  );
  if (existingDeployment !== null) {
    return {
      deployment: assertDeploymentProject(existingDeployment, input),
      created: false,
    };
  }

  try {
    const deployment = await persistence.insertDeploymentMetadata(input);
    return { deployment, created: true };
  } catch (error) {
    if (!(error instanceof DeploymentMetadataAlreadyExistsError)) {
      throw error;
    }

    const racedDeployment = await persistence.getDeploymentMetadata(
      input.deploymentId,
    );
    if (racedDeployment === null) {
      throw error;
    }

    return {
      deployment: assertDeploymentProject(racedDeployment, input),
      created: false,
    };
  }
}

function assertDeploymentProject(
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

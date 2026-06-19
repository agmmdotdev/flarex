import {
  DeploymentMetadataAlreadyExistsError,
  type DeploymentMetadataRecord,
} from "@flarex/persistence-postgres";

import { DeploymentProjectMismatchError } from "./errors";
import type {
  EnsureDeploymentInput,
  EnsureDeploymentResult,
  FlarexExecutorPersistence,
} from "./types";

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

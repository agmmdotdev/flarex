import {
  DeploymentPackageMetadataAlreadyExistsError,
  type DeploymentPackageMetadataRecord,
} from "@flarex/persistence-postgres";

import { DeploymentPackageMismatchError } from "./errors";
import { ensureDeployment } from "./deployments";
import type {
  FlarexExecutorPersistence,
  RegisterDeploymentPackageInput,
  RegisterDeploymentPackageResult,
} from "./types";

export async function registerDeploymentPackage(
  persistence: FlarexExecutorPersistence,
  input: RegisterDeploymentPackageInput,
): Promise<RegisterDeploymentPackageResult> {
  const ensured = await ensureDeployment(persistence, input);
  const existingPackage = await persistence.getDeploymentPackageMetadata(
    input.deploymentId,
    input.packageId,
  );
  if (existingPackage !== null) {
    return {
      deployment: ensured.deployment,
      package: assertDeploymentPackageMatches(existingPackage, input),
      createdDeployment: ensured.created,
      createdPackage: false,
    };
  }

  try {
    const deploymentPackage = await persistence.insertDeploymentPackageMetadata({
      deploymentId: input.deploymentId,
      packageId: input.packageId,
      sourcePackageHash: input.sourcePackageHash,
      executionModule: input.executionModule,
      sourcePackageJson: input.sourcePackageJson,
      analysisJson: input.analysisJson ?? null,
    });

    return {
      deployment: ensured.deployment,
      package: deploymentPackage,
      createdDeployment: ensured.created,
      createdPackage: true,
    };
  } catch (error) {
    if (!(error instanceof DeploymentPackageMetadataAlreadyExistsError)) {
      throw error;
    }

    const racedPackage = await persistence.getDeploymentPackageMetadata(
      input.deploymentId,
      input.packageId,
    );
    if (racedPackage === null) {
      throw error;
    }

    return {
      deployment: ensured.deployment,
      package: assertDeploymentPackageMatches(racedPackage, input),
      createdDeployment: ensured.created,
      createdPackage: false,
    };
  }
}

function assertDeploymentPackageMatches(
  deploymentPackage: DeploymentPackageMetadataRecord,
  input: RegisterDeploymentPackageInput,
): DeploymentPackageMetadataRecord {
  if (
    deploymentPackage.sourcePackageHash !== input.sourcePackageHash ||
    deploymentPackage.executionModule !== input.executionModule
  ) {
    throw new DeploymentPackageMismatchError(
      input.deploymentId,
      input.packageId,
    );
  }

  return deploymentPackage;
}

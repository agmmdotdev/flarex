import {
  DeploymentPackageMetadataAlreadyExistsError,
  type DeploymentPackageMetadataRecord,
} from "@flarex/persistence-postgres";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";

import {
  DeploymentNotFoundError,
  DeploymentPackageMismatchError,
  DeploymentPackageNotActivatedError,
  DeploymentPackageNotFoundError,
} from "./errors";
import { assertDeploymentProject, ensureDeployment } from "./deployments";
import type {
  FlarexExecutorControlPersistence,
  GetActiveDeploymentPackageInput,
  GetActiveDeploymentPackageResult,
  RegisterDeploymentPackageInput,
  RegisterDeploymentPackageResult,
} from "./types";

export async function registerDeploymentPackage(
  persistence: FlarexExecutorControlPersistence,
  input: RegisterDeploymentPackageInput,
): Promise<RegisterDeploymentPackageResult> {
  const ensured = await ensureDeployment(persistence, input);
  const ref = await executionArtifactRefForSourcePackage(input.sourcePackage);
  const packageInput = {
    deploymentId: input.deploymentId,
    packageId: ref.artifactId,
    sourcePackageHash: ref.sourcePackageHash,
    executionModule: ref.executionModule,
    sourcePackageJson: deploymentPackageSourcePackageJson(input.sourcePackage),
    analysisJson: input.analysisJson ?? null,
  };
  const existingPackage = await persistence.getDeploymentPackageMetadata(
    input.deploymentId,
    packageInput.packageId,
  );
  if (existingPackage !== null) {
    return {
      deployment: ensured.deployment,
      package: assertDeploymentPackageMatches(existingPackage, packageInput),
      createdDeployment: ensured.created,
      createdPackage: false,
    };
  }

  try {
    const deploymentPackage =
      await persistence.insertDeploymentPackageMetadata(packageInput);

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
      packageInput.packageId,
    );
    if (racedPackage === null) {
      throw error;
    }

    return {
      deployment: ensured.deployment,
      package: assertDeploymentPackageMatches(racedPackage, packageInput),
      createdDeployment: ensured.created,
      createdPackage: false,
    };
  }
}

export async function getActiveDeploymentPackage(
  persistence: FlarexExecutorControlPersistence,
  input: GetActiveDeploymentPackageInput,
): Promise<GetActiveDeploymentPackageResult> {
  const deployment = await persistence.getDeploymentMetadata(input.deploymentId);
  if (deployment === null) {
    throw new DeploymentNotFoundError(input.deploymentId);
  }

  const ownedDeployment = assertDeploymentProject(deployment, input);
  if (ownedDeployment.activePackageId === null) {
    throw new DeploymentPackageNotActivatedError(input.deploymentId);
  }

  const deploymentPackage = await persistence.getDeploymentPackageMetadata(
    input.deploymentId,
    ownedDeployment.activePackageId,
  );
  if (deploymentPackage === null) {
    throw new DeploymentPackageNotFoundError(
      input.deploymentId,
      ownedDeployment.activePackageId,
    );
  }

  return {
    deployment: ownedDeployment,
    package: deploymentPackage,
  };
}

function assertDeploymentPackageMatches(
  deploymentPackage: DeploymentPackageMetadataRecord,
  input: {
    deploymentId: string;
    packageId: string;
    sourcePackageHash: string;
    executionModule: string;
  },
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

export function deploymentPackageSourcePackageJson(
  sourcePackage: RegisterDeploymentPackageInput["sourcePackage"],
): Record<string, unknown> {
  return {
    modules: sourcePackage.modules.map((module) => ({ ...module })),
    functions: [...sourcePackage.functions],
    ...(sourcePackage.schema === undefined ? {} : { schema: sourcePackage.schema }),
    ...(sourcePackage.authConfig === undefined
      ? {}
      : { authConfig: structuredClone(sourcePackage.authConfig) }),
    ...(sourcePackage.authConfigModule === undefined
      ? {}
      : { authConfigModule: sourcePackage.authConfigModule }),
    execution: sourcePackage.execution,
  };
}

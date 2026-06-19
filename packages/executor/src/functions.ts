import {
  DeploymentFunctionMetadataUnavailableError,
  FunctionNotFoundError,
} from "./errors";
import { getActiveDeploymentPackage } from "./deploymentPackages";
import type {
  DeploymentFunctionKind,
  DeploymentFunctionMetadata,
  FlarexExecutorPersistence,
  FunctionVisibility,
  GetActiveFunctionInput,
  GetActiveFunctionResult,
} from "./types";

export async function getActiveFunction(
  persistence: FlarexExecutorPersistence,
  input: GetActiveFunctionInput,
): Promise<GetActiveFunctionResult> {
  const active = await getActiveDeploymentPackage(persistence, input);
  const functions = deploymentFunctionsFromAnalysis(
    active.package.analysisJson,
    active.package.deploymentId,
    active.package.packageId,
  );
  const metadata = functions.find(candidate => candidate.path === input.path);
  if (metadata === undefined) {
    throw new FunctionNotFoundError(input.deploymentId, input.path);
  }

  return {
    ...active,
    function: metadata,
  };
}

function deploymentFunctionsFromAnalysis(
  analysisJson: unknown,
  deploymentId: string,
  packageId: string,
): DeploymentFunctionMetadata[] {
  const analysis = asRecord(analysisJson);
  if (analysis === null) {
    throw new DeploymentFunctionMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson must be an object",
    );
  }

  const functionsContainer = asRecord(analysis.functions);
  if (functionsContainer === null || !Array.isArray(functionsContainer.functions)) {
    throw new DeploymentFunctionMetadataUnavailableError(
      deploymentId,
      packageId,
      "analysisJson.functions.functions must be an array",
    );
  }

  return functionsContainer.functions.map((value, index) =>
    deploymentFunctionMetadataFromJson(value, deploymentId, packageId, index),
  );
}

function deploymentFunctionMetadataFromJson(
  value: unknown,
  deploymentId: string,
  packageId: string,
  index: number,
): DeploymentFunctionMetadata {
  const metadata = asRecord(value);
  if (metadata === null) {
    throw invalidFunctionMetadata(deploymentId, packageId, index, "must be an object");
  }
  if (typeof metadata.path !== "string" || metadata.path.length === 0) {
    throw invalidFunctionMetadata(deploymentId, packageId, index, "path must be a non-empty string");
  }
  if (!isDeploymentFunctionKind(metadata.kind)) {
    throw invalidFunctionMetadata(
      deploymentId,
      packageId,
      index,
      "kind must be query, mutation, action, or workflowMutation",
    );
  }
  if (
    metadata.visibility !== undefined &&
    !isFunctionVisibility(metadata.visibility)
  ) {
    throw invalidFunctionMetadata(
      deploymentId,
      packageId,
      index,
      "visibility must be public or internal",
    );
  }

  return {
    path: metadata.path,
    kind: metadata.kind,
    ...(metadata.visibility === undefined
      ? {}
      : { visibility: metadata.visibility }),
    ...(metadata.args === undefined ? {} : { args: metadata.args }),
    ...(metadata.returns === undefined ? {} : { returns: metadata.returns }),
    ...(metadata.route === undefined ? {} : { route: metadata.route }),
    ...(metadata.partition === undefined ? {} : { partition: metadata.partition }),
    ...(metadata.position === undefined ? {} : { position: metadata.position }),
  };
}

function invalidFunctionMetadata(
  deploymentId: string,
  packageId: string,
  index: number,
  message: string,
): DeploymentFunctionMetadataUnavailableError {
  return new DeploymentFunctionMetadataUnavailableError(
    deploymentId,
    packageId,
    `function metadata at index ${index} ${message}`,
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isDeploymentFunctionKind(value: unknown): value is DeploymentFunctionKind {
  return (
    value === "query" ||
    value === "mutation" ||
    value === "action" ||
    value === "workflowMutation"
  );
}

function isFunctionVisibility(value: unknown): value is FunctionVisibility {
  return value === "public" || value === "internal";
}

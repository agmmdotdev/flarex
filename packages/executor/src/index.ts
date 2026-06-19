import { activateDeploymentPackage, ensureDeployment } from "./deployments";
import {
  getActiveDeploymentPackage,
  registerDeploymentPackage,
} from "./deploymentPackages";
import { getActiveFunction } from "./functions";
import { defaultClock, getExecutorHealth } from "./health";
import type { FlarexExecutor, FlarexExecutorConfig } from "./types";

export {
  DeploymentFunctionMetadataUnavailableError,
  DeploymentNotFoundError,
  DeploymentPackageMismatchError,
  DeploymentPackageNotActivatedError,
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
  FunctionNotFoundError,
} from "./errors";
export type {
  ActivateDeploymentPackageInput,
  ActivateDeploymentPackageResult,
  Clock,
  DeploymentFunctionKind,
  DeploymentFunctionMetadata,
  EnsureDeploymentInput,
  EnsureDeploymentResult,
  FlarexExecutor,
  FlarexExecutorConfig,
  FlarexExecutorDependencyHealth,
  FlarexExecutorPersistence,
  FlarexHealth,
  FunctionVisibility,
  GetActiveFunctionInput,
  GetActiveFunctionResult,
  GetActiveDeploymentPackageInput,
  GetActiveDeploymentPackageResult,
  RegisterDeploymentPackageInput,
  RegisterDeploymentPackageResult,
} from "./types";

export function createFlarexExecutor(config: FlarexExecutorConfig): FlarexExecutor {
  const clock = config.clock ?? defaultClock;
  const persistence = config.persistence;

  return {
    activateDeploymentPackage: (input) =>
      activateDeploymentPackage(persistence, input),
    ensureDeployment: (input) => ensureDeployment(persistence, input),
    getActiveFunction: (input) => getActiveFunction(persistence, input),
    getActiveDeploymentPackage: (input) =>
      getActiveDeploymentPackage(persistence, input),
    registerDeploymentPackage: (input) =>
      registerDeploymentPackage(persistence, input),
    health: () => getExecutorHealth(persistence, clock),
  };
}

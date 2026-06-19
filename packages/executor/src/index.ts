import { activateDeploymentPackage, ensureDeployment } from "./deployments";
import {
  getActiveDeploymentPackage,
  registerDeploymentPackage,
} from "./deploymentPackages";
import { getActiveFunction } from "./functions";
import { defaultClock, getExecutorHealth } from "./health";
import { prepareInvoke } from "./invoke";
import type { FlarexExecutor, FlarexExecutorConfig } from "./types";

export {
  DeploymentFunctionMetadataUnavailableError,
  DeploymentNotFoundError,
  DeploymentPackageMismatchError,
  DeploymentPackageNotActivatedError,
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
  DeploymentSchemaMetadataUnavailableError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
} from "./errors";
export type {
  ActivateDeploymentPackageInput,
  ActivateDeploymentPackageResult,
  Clock,
  DeploymentFunctionKind,
  DeploymentFunctionMetadata,
  DeploymentSchemaMetadata,
  EnsureDeploymentInput,
  EnsureDeploymentResult,
  FlarexExecutor,
  FlarexExecutorConfig,
  FlarexExecutorDependencyHealth,
  FlarexExecutorPersistence,
  FlarexHealth,
  FunctionVisibility,
  InvokableFunctionKind,
  GetActiveFunctionInput,
  GetActiveFunctionResult,
  GetActiveDeploymentPackageInput,
  GetActiveDeploymentPackageResult,
  PrepareInvokeInput,
  PrepareInvokeResult,
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
    prepareInvoke: (input) => prepareInvoke(persistence, input),
    registerDeploymentPackage: (input) =>
      registerDeploymentPackage(persistence, input),
    health: () => getExecutorHealth(persistence, clock),
  };
}

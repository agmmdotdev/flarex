import { activateDeploymentPackage, ensureDeployment } from "./deployments";
import {
  getActiveDeploymentPackage,
  registerDeploymentPackage,
} from "./deploymentPackages";
import { getActiveFunction } from "./functions";
import { defaultClock, getExecutorHealth } from "./health";
import { prepareInvoke } from "./invoke";
import { beginInvokeSession, defaultIds, invokeSyscall } from "./sessions";
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
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
  PartitionValidationError,
} from "./errors";
export { FlarexDocumentIdFormatError } from "@flarex/persistence-postgres";
export type {
  ActivateDeploymentPackageInput,
  ActivateDeploymentPackageResult,
  BeginInvokeSessionInput,
  BeginInvokeSessionResult,
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
  IdGenerator,
  FunctionVisibility,
  FunctionExecutionScope,
  FunctionPartitionCreateRootPolicy,
  FunctionPartitionMetadata,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
  InvokableFunctionKind,
  InvokeSyscallInput,
  InvokeSyscallRequest,
  InvokeSyscallResult,
  Json,
  GetActiveFunctionInput,
  GetActiveFunctionResult,
  GetActiveDeploymentPackageInput,
  GetActiveDeploymentPackageResult,
  PrepareInvokeInput,
  PrepareInvokeResult,
  RegisterDeploymentPackageInput,
  RegisterDeploymentPackageResult,
  SchemaIndexMetadata,
  SchemaTableMetadata,
  TablePlacement,
} from "./types";

export function createFlarexExecutor(config: FlarexExecutorConfig): FlarexExecutor {
  const clock = config.clock ?? defaultClock;
  const ids = config.ids ?? defaultIds;
  const persistence = config.persistence;

  return {
    activateDeploymentPackage: (input) =>
      activateDeploymentPackage(persistence, input),
    ensureDeployment: (input) => ensureDeployment(persistence, input),
    getActiveFunction: (input) => getActiveFunction(persistence, input),
    getActiveDeploymentPackage: (input) =>
      getActiveDeploymentPackage(persistence, input),
    beginInvokeSession: (input) =>
      beginInvokeSession(persistence, clock, ids, input),
    invokeSyscall: (input) => invokeSyscall(persistence, input),
    prepareInvoke: (input) => prepareInvoke(persistence, input),
    registerDeploymentPackage: (input) =>
      registerDeploymentPackage(persistence, input),
    health: () => getExecutorHealth(persistence, clock),
  };
}

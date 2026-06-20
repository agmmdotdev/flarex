import { activateDeploymentPackage, ensureDeployment } from "./deployments";
import {
  getActiveDeploymentPackage,
  registerDeploymentPackage,
} from "./deploymentPackages";
import { getActiveFunction } from "./functions";
import { defaultClock, getExecutorHealth } from "./health";
import { prepareInvoke } from "./invoke";
import {
  listUndeliveredOutboxEvents,
  markOutboxEventsDelivered,
} from "./outbox";
import {
  listMaintenanceDeployments,
  runInvokeSessionMaintenance,
  runMaintenanceSweep,
} from "./maintenance";
import { runInvokeWithRetries } from "./retry";
import {
  abortInvokeSession,
  abortStaleInvokeSessions,
  beginInvokeSession,
  defaultIds,
  finishInvokeSession,
  invokeSyscall,
} from "./sessions";
import type { FlarexExecutor, FlarexExecutorConfig } from "./types";

export {
  InvokeDeleteDocumentNotFoundError,
  DeploymentFunctionMetadataUnavailableError,
  DeploymentNotFoundError,
  DeploymentPackageMismatchError,
  DeploymentPackageNotActivatedError,
  DeploymentPackageNotFoundError,
  DeploymentProjectMismatchError,
  DeploymentSchemaMetadataUnavailableError,
  FlarexInsertIdTableMismatchError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
  InvokeFinishNotImplementedError,
  InvokePatchDocumentNotFoundError,
  InvokePatchNonObjectDocumentError,
  InvokePatchValueError,
  InvokeQueryRequestError,
  InvokeReplaceDocumentNotFoundError,
  InvokeRetryExhaustedError,
  InvokeRetryPolicyError,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
  MaintenancePolicyError,
  PartitionValidationError,
} from "./errors";
export { FlarexDocumentIdFormatError } from "@flarex/persistence-postgres";
export {
  DeploymentValidatorMetadataError,
  InvokeSessionDocumentValidationError,
  InvokeSessionDocumentWriteAlreadyExistsError,
  InvokeSessionDocumentWriteConflictError,
  InvokeSessionDeleteTargetError,
  InvokeSessionInsertConflictError,
  InvokeSessionIndexOccConflictError,
  InvokeSessionOccConflictError,
  InvokeSessionPatchTargetError,
  InvokeSessionReplaceTargetError,
  InvokeSessionTableOccConflictError,
  InvokeSessionUnsupportedStagedWriteError,
} from "@flarex/persistence-postgres";
export type {
  ActivateDeploymentPackageInput,
  ActivateDeploymentPackageResult,
  AbortInvokeSessionInput,
  AbortInvokeSessionResult,
  AbortStaleInvokeSessionsInput,
  AbortStaleInvokeSessionsResult,
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
  FinishInvokeSessionInput,
  FinishInvokeSessionResult,
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
  InvokeAttemptContext,
  Json,
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  ListMaintenanceDeploymentsInput,
  ListMaintenanceDeploymentsResult,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  MaintenanceSweepDeploymentResult,
  RunInvokeSessionMaintenanceInput,
  RunInvokeSessionMaintenanceResult,
  RunMaintenanceSweepInput,
  RunMaintenanceSweepResult,
  GetActiveFunctionInput,
  GetActiveFunctionResult,
  GetActiveDeploymentPackageInput,
  GetActiveDeploymentPackageResult,
  PrepareInvokeInput,
  PrepareInvokeResult,
  RegisterDeploymentPackageInput,
  RegisterDeploymentPackageResult,
  RunInvokeWithRetriesInput,
  RunInvokeWithRetriesResult,
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
    finishInvokeSession: (input) =>
      finishInvokeSession(persistence, clock, input),
    abortInvokeSession: (input) =>
      abortInvokeSession(persistence, clock, input),
    abortStaleInvokeSessions: (input) =>
      abortStaleInvokeSessions(persistence, clock, input),
    runInvokeSessionMaintenance: (input) =>
      runInvokeSessionMaintenance(persistence, clock, input),
    listMaintenanceDeployments: (input) =>
      listMaintenanceDeployments(persistence, input),
    listUndeliveredOutboxEvents: (input) =>
      listUndeliveredOutboxEvents(persistence, input),
    markOutboxEventsDelivered: (input) =>
      markOutboxEventsDelivered(persistence, input),
    runMaintenanceSweep: (input) =>
      runMaintenanceSweep(persistence, clock, input),
    runInvokeWithRetries: (input) =>
      runInvokeWithRetries(persistence, clock, ids, input),
    invokeSyscall: (input) => invokeSyscall(persistence, input),
    prepareInvoke: (input) => prepareInvoke(persistence, input),
    registerDeploymentPackage: (input) =>
      registerDeploymentPackage(persistence, input),
    health: () => getExecutorHealth(persistence, clock),
  };
}

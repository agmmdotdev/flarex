import {
  createLegacyV1AppDataEngine,
} from "@flarex/persistence-postgres/legacy-v1-app-data-engine";

import { createLegacyOnlyAppDataEngineRegistry } from "./appDataEngines";
import { activateDeploymentPackage, ensureDeployment } from "./deployments";
import { getActiveDeploymentAuthConfig } from "./authConfig";
import {
  deploymentPackageSourcePackageJson,
  getActiveDeploymentPackage,
  registerDeploymentPackage,
} from "./deploymentPackages";
import { getActiveFunction } from "./functions";
import { defaultClock, getExecutorHealth } from "./health";
import { prepareInvoke } from "./invoke";
import {
  listUndeliveredOutboxEvents,
  markOutboxEventsDelivered,
  runOutboxDeliveryBatch,
} from "./outbox";
import {
  ackLiveQueryDeliveries,
  claimLiveQueryDeliveryBatch,
  deadLetterStuckLiveQueryDeliveries,
  listPendingLiveQueryDeliveryDeployments,
  listStuckLiveQueryDeliveries,
  listUndeliveredLiveQueryDeliveries,
  markLiveQueryDeliveriesDeadLettered,
  markLiveQueryDeliveriesDelivered,
  recordLiveQueryDeliveryFailure,
  runLiveQueryDeliveryBatch,
} from "./liveQueryDeliveries";
import {
  findStaleLiveQuerySubscriptions,
  fingerprintJson,
  listExpiredLiveQueryConnectionDeployments,
  recordLiveQuerySubscription,
  removeExpiredLiveQuerySubscriptions,
  removeLiveQuerySubscription,
  removeLiveQuerySubscriptionsForConnection,
  runLiveQuerySubscriptionWithInvoke,
  rerunLiveQuerySubscription,
  rerunStaleLiveQuerySubscriptions,
  touchLiveQueryConnection,
} from "./liveQueries";
import {
  listMaintenanceDeployments,
  runInvokeSessionMaintenance,
  runMaintenanceSweep,
} from "./maintenance";
import { runInvokeWithRetries as runInvokeWithRetriesInternal } from "./retry";
import {
  abortInvokeSession,
  abortStaleInvokeSessions,
  beginInvokeSession,
  defaultIds,
  finishInvokeSession,
  invokeSyscall,
} from "./sessions";
import type {
  FlarexExecutor,
  FlarexExecutorConfig,
  RunInvokeWithRetriesInput,
  RunInvokeWithRetriesResult,
  RunMutationInvokeWithRetriesInput,
  RunMutationInvokeWithRetriesResult,
  RunQueryInvokeWithRetriesInput,
  RunQueryInvokeWithRetriesResult,
} from "./types";

export {
  InvokeDeleteDocumentNotFoundError,
  DeploymentFunctionMetadataUnavailableError,
  DeploymentAuthConfigMetadataUnavailableError,
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
  FunctionVisibilityMismatchError,
  InvokeFinishNotImplementedError,
  InvokePatchDocumentNotFoundError,
  InvokePatchNonObjectDocumentError,
  InvokePatchValueError,
  InvokeQueryRequestError,
  InvokeReplaceDocumentNotFoundError,
  InvokeRetryExhaustedError,
  InvokeRetryPolicyError,
  LiveQuerySubscriptionRerunError,
  LiveQueryDeliveryPolicyError,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
  MaintenancePolicyError,
  OutboxDeliveryPolicyError,
  PartitionValidationError,
} from "./errors";
export { FlarexDocumentIdFormatError } from "@flarex/persistence-postgres";
export { deploymentPackageSourcePackageJson };
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
  AckLiveQueryDeliveriesInput,
  AckLiveQueryDeliveriesResult,
  BeginInvokeSessionInput,
  BeginInvokeSessionResult,
  ClaimLiveQueryDeliveryBatchInput,
  ClaimLiveQueryDeliveryBatchResult,
  Clock,
  DeadLetterStuckLiveQueryDeliveriesInput,
  DeadLetterStuckLiveQueryDeliveriesResult,
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
  FinishMutationInvokeSessionResult,
  FinishInvokeSessionResult,
  FinishQueryInvokeSessionResult,
  IdGenerator,
  FunctionVisibility,
  FunctionExecutionScope,
  FunctionPartitionCreateRootPolicy,
  FunctionPartitionMetadata,
  FunctionPartitionPolicy,
  FunctionRoutePolicy,
  FindStaleLiveQuerySubscriptionsInput,
  FindStaleLiveQuerySubscriptionsResult,
  InvokableFunctionKind,
  InvokeSyscallInput,
  InvokeSyscallRequest,
  InvokeSyscallResult,
  InvokeAttemptContext,
  Json,
  ListOutboxEventsResult,
  ListUndeliveredOutboxEventsInput,
  ListExpiredLiveQueryConnectionDeploymentsInput,
  ListExpiredLiveQueryConnectionDeploymentsResult,
  ListPendingLiveQueryDeliveryDeploymentsInput,
  ListPendingLiveQueryDeliveryDeploymentsResult,
  ListStuckLiveQueryDeliveriesInput,
  ListStuckLiveQueryDeliveriesResult,
  ListUndeliveredLiveQueryDeliveriesInput,
  ListUndeliveredLiveQueryDeliveriesResult,
  ListMaintenanceDeploymentsInput,
  ListMaintenanceDeploymentsResult,
  MarkOutboxEventsDeliveredInput,
  MarkOutboxEventsDeliveredResult,
  MarkLiveQueryDeliveriesDeadLetteredInput,
  MarkLiveQueryDeliveriesDeadLetteredResult,
  MarkLiveQueryDeliveriesDeliveredInput,
  MarkLiveQueryDeliveriesDeliveredResult,
  RecordLiveQueryDeliveryFailureInput,
  RecordLiveQueryDeliveryFailureResult,
  LiveQueryDeliveryCursor,
  LiveQueryDeliveryRecord,
  LiveQueryDeliveryBatchSummary,
  LiveQueryDeadLetterSummary,
  LiveQueryChange,
  MaintenanceSweepDeploymentResult,
  RunInvokeSessionMaintenanceInput,
  RunInvokeSessionMaintenanceResult,
  RunMaintenanceSweepInput,
  RunMaintenanceSweepResult,
  GetActiveFunctionInput,
  GetActiveFunctionResult,
  GetActiveDeploymentPackageInput,
  GetActiveDeploymentPackageResult,
  GetActiveDeploymentAuthConfigInput,
  GetActiveDeploymentAuthConfigResult,
  PrepareInvokeInput,
  PrepareInvokeResult,
  RegisterDeploymentPackageInput,
  RegisterDeploymentPackageResult,
  RunOutboxDeliveryBatchInput,
  RunOutboxDeliveryBatchResult,
  RunLiveQueryDeliveryBatchInput,
  RunLiveQueryDeliveryBatchResult,
  RecordLiveQuerySubscriptionInput,
  RecordLiveQuerySubscriptionResult,
  RemoveExpiredLiveQuerySubscriptionsInput,
  RemoveLiveQuerySubscriptionInput,
  RemoveLiveQuerySubscriptionsForConnectionInput,
  RerunLiveQuerySubscriptionInput,
  RerunLiveQuerySubscriptionOutput,
  RerunLiveQuerySubscriptionResult,
  RerunStaleLiveQuerySubscriptionsInput,
  RerunStaleLiveQuerySubscriptionsResult,
  RunLiveQuerySubscriptionWithInvokeInput,
  TouchLiveQueryConnectionInput,
  TouchLiveQueryConnectionResult,
  RunInvokeWithRetriesInput,
  RunInvokeWithRetriesResult,
  RunMutationInvokeWithRetriesInput,
  RunMutationInvokeWithRetriesResult,
  RunQueryInvokeWithRetriesInput,
  RunQueryInvokeWithRetriesResult,
  SchemaIndexMetadata,
  SchemaTableMetadata,
  TablePlacement,
  LiveQuerySubscriptionFreshnessEntry,
  LiveQueryInvalidationConfig,
  LiveQueryInvalidationTriggerInput,
  LiveQueryInvalidationErrorInput,
} from "./types";
export { fingerprintJson } from "./liveQueries";

export function createFlarexExecutor(config: FlarexExecutorConfig): FlarexExecutor {
  const clock = config.clock ?? defaultClock;
  const ids = config.ids ?? defaultIds;
  const persistence = config.persistence;
  const appDataEngines = createLegacyOnlyAppDataEngineRegistry(
    createLegacyV1AppDataEngine(persistence),
  );
  const liveQueryInvalidation = config.liveQueryInvalidation;

  function runInvokeWithRetriesForExecutor(
    input: RunQueryInvokeWithRetriesInput,
  ): Promise<RunQueryInvokeWithRetriesResult>;
  function runInvokeWithRetriesForExecutor(
    input: RunMutationInvokeWithRetriesInput,
  ): Promise<RunMutationInvokeWithRetriesResult>;
  function runInvokeWithRetriesForExecutor(
    input: RunInvokeWithRetriesInput,
  ): Promise<RunInvokeWithRetriesResult>;
  function runInvokeWithRetriesForExecutor(
    input: RunInvokeWithRetriesInput,
  ): Promise<RunInvokeWithRetriesResult> {
    return runInvokeWithRetriesInternal(
      persistence,
      appDataEngines,
      clock,
      ids,
      liveQueryInvalidation,
      input,
    );
  }

  return {
    activateDeploymentPackage: (input) =>
      activateDeploymentPackage(persistence, input),
    ensureDeployment: (input) => ensureDeployment(persistence, input),
    getActiveFunction: (input) => getActiveFunction(persistence, input),
    getActiveDeploymentPackage: (input) =>
      getActiveDeploymentPackage(persistence, input),
    getActiveDeploymentAuthConfig: (input) =>
      getActiveDeploymentAuthConfig(persistence, input),
    beginInvokeSession: (input) =>
      beginInvokeSession(persistence, clock, ids, input),
    finishInvokeSession: (input) =>
      finishInvokeSession(
        persistence,
        appDataEngines,
        clock,
        liveQueryInvalidation,
        input,
      ),
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
    runOutboxDeliveryBatch: (input) =>
      runOutboxDeliveryBatch(persistence, clock, input),
    listUndeliveredLiveQueryDeliveries: (input) =>
      listUndeliveredLiveQueryDeliveries(persistence, input),
    markLiveQueryDeliveriesDelivered: (input) =>
      markLiveQueryDeliveriesDelivered(persistence, input),
    claimLiveQueryDeliveryBatch: (input) =>
      claimLiveQueryDeliveryBatch(persistence, clock, input),
    ackLiveQueryDeliveries: (input) =>
      ackLiveQueryDeliveries(persistence, clock, input),
    runLiveQueryDeliveryBatch: (input) =>
      runLiveQueryDeliveryBatch(persistence, clock, input),
    listPendingLiveQueryDeliveryDeployments: (input) =>
      listPendingLiveQueryDeliveryDeployments(persistence, input),
    listStuckLiveQueryDeliveries: (input) =>
      listStuckLiveQueryDeliveries(persistence, input),
    markLiveQueryDeliveriesDeadLettered: (input) =>
      markLiveQueryDeliveriesDeadLettered(persistence, input),
    deadLetterStuckLiveQueryDeliveries: (input) =>
      deadLetterStuckLiveQueryDeliveries(persistence, clock, input),
    recordLiveQueryDeliveryFailure: (input) =>
      recordLiveQueryDeliveryFailure(persistence, input),
    touchLiveQueryConnection: (input) =>
      touchLiveQueryConnection(persistence, clock, input),
    recordLiveQuerySubscription: (input) =>
      recordLiveQuerySubscription(persistence, clock, input),
    removeLiveQuerySubscription: (input) =>
      removeLiveQuerySubscription(persistence, input),
    removeLiveQuerySubscriptionsForConnection: (input) =>
      removeLiveQuerySubscriptionsForConnection(persistence, clock, input),
    removeExpiredLiveQuerySubscriptions: (input) =>
      removeExpiredLiveQuerySubscriptions(persistence, clock, input),
    listExpiredLiveQueryConnectionDeployments: (input) =>
      listExpiredLiveQueryConnectionDeployments(persistence, clock, input),
    findStaleLiveQuerySubscriptions: (input) =>
      findStaleLiveQuerySubscriptions(persistence, clock, input),
    rerunLiveQuerySubscription: (input) =>
      rerunLiveQuerySubscription(persistence, {
        ...input,
        deliveryId: input.deliveryId ?? ids.nextId(),
      }),
    rerunStaleLiveQuerySubscriptions: (input) =>
      rerunStaleLiveQuerySubscriptions(persistence, clock, ids, input),
    runLiveQuerySubscriptionWithInvoke: (input) =>
      runLiveQuerySubscriptionWithInvoke(
        persistence,
        appDataEngines,
        clock,
        ids,
        input,
      ),
    runMaintenanceSweep: (input) =>
      runMaintenanceSweep(persistence, clock, input),
    runInvokeWithRetries: runInvokeWithRetriesForExecutor,
    invokeSyscall: (input) => invokeSyscall(persistence, appDataEngines, input),
    prepareInvoke: (input) => prepareInvoke(persistence, input),
    registerDeploymentPackage: (input) =>
      registerDeploymentPackage(persistence, input),
    health: () => getExecutorHealth(persistence, clock),
  };
}

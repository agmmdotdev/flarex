import {
  createLegacyV1AppDataEngine,
} from "@flarex/persistence-postgres/legacy-v1-app-data-engine";

import { createLegacyOnlyAppDataEngineRegistry } from "./appDataEngines";
import { activateDeploymentPackage, ensureDeployment } from "./deployments";
export {
  withReadyDeploymentAuthority,
  type FlarexExecutorPersistenceCompositionInput,
  type FlarexExecutorPersistenceWithoutDeploymentAuthority,
} from "./deploymentAuthority";
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
  listUndeliveredOutboxEventsEffect,
  makeOutboxTimeEffect,
  markOutboxEventsDeliveredEffect,
  runOutboxDeliveryBatchEffect,
  runOutboxPromise,
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
  findStaleLiveQuerySubscriptionsEffect,
  listExpiredLiveQueryConnectionDeploymentsEffect,
  makeLiveQueryTimeEffect,
  recordLiveQuerySubscriptionEffect,
  removeExpiredLiveQuerySubscriptionsEffect,
  removeLiveQuerySubscription,
  removeLiveQuerySubscriptionsForConnectionEffect,
  runLiveQueryPromise,
  runLiveQuerySubscriptionWithInvoke,
  rerunLiveQuerySubscription,
  rerunStaleLiveQuerySubscriptionsEffect,
  touchLiveQueryConnectionEffect,
} from "./liveQueries";
import {
  listMaintenanceDeploymentsEffect,
  runInvokeSessionMaintenanceEffect,
  runMaintenancePromise,
  runMaintenanceSweepEffect,
} from "./maintenance";
import {
  runInvokeWithRetriesEffect,
  runInvokeWithRetriesPromise,
} from "./retry";
import {
  defaultIds,
  invokeSyscall,
  makeInvokeSessionOperations,
  makeSessionTimeEffect,
  runInvokeSessionPromise,
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
  EnsureDeploymentAuthorityResult,
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
  ReadyDeploymentAuthorityProvisioner,
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
  const configuredClock = config.clock;
  const clock = configuredClock ?? defaultClock;
  const ids = config.ids ?? defaultIds;
  const persistence = config.persistence;
  const appDataEngines = createLegacyOnlyAppDataEngineRegistry(
    createLegacyV1AppDataEngine(persistence),
  );
  const liveQueryInvalidation = config.liveQueryInvalidation;
  const sessionOperations = makeInvokeSessionOperations({
    persistence,
    appDataEngines,
    clock: configuredClock,
    ids,
    liveQueryInvalidation,
  });
  const maintenanceTimeEffect = makeSessionTimeEffect(configuredClock);
  const outboxTimeEffect = makeOutboxTimeEffect(configuredClock);
  const liveQueryTimeEffect = makeLiveQueryTimeEffect(configuredClock);

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
    return runInvokeWithRetriesPromise(
      runInvokeWithRetriesEffect(
        persistence,
        appDataEngines,
        sessionOperations,
        input,
      ),
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
      runInvokeSessionPromise(sessionOperations.begin(input)),
    finishInvokeSession: (input) =>
      runInvokeSessionPromise(sessionOperations.finish(input)),
    abortInvokeSession: (input) =>
      runInvokeSessionPromise(sessionOperations.abort(input)),
    abortStaleInvokeSessions: (input) =>
      runInvokeSessionPromise(sessionOperations.abortStale(input)),
    runInvokeSessionMaintenance: (input) =>
      runMaintenancePromise(runInvokeSessionMaintenanceEffect(
        maintenanceTimeEffect,
        sessionOperations,
        input,
      )),
    listMaintenanceDeployments: (input) =>
      runMaintenancePromise(listMaintenanceDeploymentsEffect(
        persistence,
        input,
      )),
    listUndeliveredOutboxEvents: (input) =>
      runOutboxPromise(listUndeliveredOutboxEventsEffect(persistence, input)),
    markOutboxEventsDelivered: (input) =>
      runOutboxPromise(markOutboxEventsDeliveredEffect(persistence, input)),
    runOutboxDeliveryBatch: (input) =>
      runOutboxPromise(runOutboxDeliveryBatchEffect(
        persistence,
        outboxTimeEffect,
        input,
      )),
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
      runLiveQueryPromise(touchLiveQueryConnectionEffect(
        persistence,
        liveQueryTimeEffect,
        input,
      )),
    recordLiveQuerySubscription: (input) =>
      runLiveQueryPromise(recordLiveQuerySubscriptionEffect(
        persistence,
        liveQueryTimeEffect,
        input,
      )),
    removeLiveQuerySubscription: (input) =>
      removeLiveQuerySubscription(persistence, input),
    removeLiveQuerySubscriptionsForConnection: (input) =>
      runLiveQueryPromise(removeLiveQuerySubscriptionsForConnectionEffect(
        persistence,
        liveQueryTimeEffect,
        input,
      )),
    removeExpiredLiveQuerySubscriptions: (input) =>
      runLiveQueryPromise(removeExpiredLiveQuerySubscriptionsEffect(
        persistence,
        liveQueryTimeEffect,
        input,
      )),
    listExpiredLiveQueryConnectionDeployments: (input) =>
      runLiveQueryPromise(listExpiredLiveQueryConnectionDeploymentsEffect(
        persistence,
        liveQueryTimeEffect,
        input,
      )),
    findStaleLiveQuerySubscriptions: (input) =>
      runLiveQueryPromise(findStaleLiveQuerySubscriptionsEffect(
        persistence,
        liveQueryTimeEffect,
        input,
      )),
    rerunLiveQuerySubscription: (input) =>
      rerunLiveQuerySubscription(persistence, {
        ...input,
        deliveryId: input.deliveryId ?? ids.nextId(),
      }),
    rerunStaleLiveQuerySubscriptions: (input) =>
      runLiveQueryPromise(rerunStaleLiveQuerySubscriptionsEffect(
        persistence,
        liveQueryTimeEffect,
        ids,
        input,
      )),
    runLiveQuerySubscriptionWithInvoke: (input) =>
      runLiveQuerySubscriptionWithInvoke(
        persistence,
        runInvokeWithRetriesForExecutor,
        input,
      ),
    runMaintenanceSweep: (input) =>
      runMaintenancePromise(runMaintenanceSweepEffect(
        persistence,
        maintenanceTimeEffect,
        sessionOperations,
        input,
      )),
    runInvokeWithRetries: runInvokeWithRetriesForExecutor,
    invokeSyscall: (input) => invokeSyscall(persistence, appDataEngines, input),
    prepareInvoke: (input) => prepareInvoke(persistence, input),
    registerDeploymentPackage: (input) =>
      registerDeploymentPackage(persistence, input),
    health: () => getExecutorHealth(persistence, configuredClock),
  };
}

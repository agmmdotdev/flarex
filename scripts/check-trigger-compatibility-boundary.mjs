#!/usr/bin/env node
// @ts-check
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const repoRoot = process.cwd();
const sourceExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const durableTaskManifestPath = "packages/durable-task/package.json";
const durableTaskSourcePrefix = "packages/durable-task/";
const standardApplicationDefinitionManifestPath =
  "packages/standard-application-definition/package.json";
const standardApplicationInvocationManifestPath =
  "packages/standard-application-invocation/package.json";
const persistencePostgresManifestPath =
  "packages/persistence-postgres/package.json";
const flarexBackendManifestPath = "packages/flarex-backend/package.json";
const standardApplicationTaskComputeDeliveryPath =
  "packages/standard-application-invocation/src/ApplicationTaskComputeDelivery.ts";
const standardApplicationTaskMutationAuthorityPath =
  "packages/standard-application-invocation/src/ApplicationTaskMutationAuthority.ts";
const standardApplicationTaskSystemPath =
  "packages/standard-application-invocation/src/ApplicationTaskSystem.ts";
const standardApplicationTaskRunQueryPath =
  "packages/standard-application-invocation/src/StandardApplicationTaskRunQuery.ts";
const standardApplicationTaskResultQueryPath =
  "packages/standard-application-invocation/src/StandardApplicationTaskResultQuery.ts";
const standardApplicationTaskCancellationPath =
  "packages/standard-application-invocation/src/StandardApplicationTaskCancellation.ts";
const systemTestManifestPath = "packages/system-test/package.json";
const systemTestApplicationTaskSystemConnectedHarnessPath =
  "packages/system-test/support/applicationTaskSystemConnectedHarness.ts";
const systemTestApplicationTaskSystemFreshHostTakeoverHarnessPath =
  "packages/system-test/support/applicationTaskSystemFreshHostTakeoverHarness.ts";
const systemTestApplicationTaskHostedTestKitPath =
  "packages/system-test/support/applicationTaskHostedTestKit.ts";
const systemTestApplicationEnvironmentPath =
  "packages/system-test/src/environment/applicationEnvironment.ts";
const systemTestStandardApplicationTaskDeliveryPath =
  "packages/system-test/src/environment/standardApplicationTaskDeliveryV1.ts";
const systemTestDatabaseLanePath =
  "packages/system-test/src/lanes/databaseLane.ts";
const standardApplicationTaskDeliveryEventHostPath =
  "packages/standard-application-invocation/src/ApplicationTaskDeliveryEventHost.ts";
const flarexBackendTaskComputeDeliveryCandidateRunnerPath =
  "packages/flarex-backend/src/taskComputeDelivery/CandidateRunner.ts";
const flarexBackendWorkerLoaderTaskComputeProviderPath =
  "packages/flarex-backend/src/taskComputeDelivery/WorkerLoaderTaskComputeProvider.ts";
const flarexBackendApplicationTaskQueryCallbackPath =
  "packages/flarex-backend/src/taskComputeDelivery/ApplicationTaskQueryCallback.ts";
const flarexBackendApplicationTaskMutationCallbackPath =
  "packages/flarex-backend/src/taskComputeDelivery/ApplicationTaskMutationCallback.ts";
const flarexBackendTaskWorkerTerminalCompletionPath =
  "packages/flarex-backend/src/taskComputeDelivery/TaskWorkerTerminalCompletion.ts";
const flarexBackendTaskAttemptSupervisorPath =
  "packages/flarex-backend/src/taskComputeDelivery/TaskAttemptSupervisor.ts";
const flarexBackendTaskComputeDeliverySourcePrefix =
  "packages/flarex-backend/src/taskComputeDelivery/";
const flarexBackendTaskRuntimeLaunchModelPath =
  "packages/flarex-backend/src/taskRuntimeLaunch/Model.ts";
const flarexBackendTaskRuntimeLaunchAuthorityPath =
  "packages/flarex-backend/src/taskRuntimeLaunch/Authority.ts";
const flarexBackendTaskRuntimeLaunchResourceDirectoryPath =
  "packages/flarex-backend/src/taskRuntimeLaunch/ResourceDirectory.ts";
const flarexBackendTaskRuntimeLaunchSourcePrefix =
  "packages/flarex-backend/src/taskRuntimeLaunch/";
const flarexBackendLegacyTaskWorkerDefinitionPath =
  "packages/flarex-backend/src/artifactRuntime/LegacyTaskWorkerDefinition.ts";
const flarexBackendTaskRuntimeObjectStorePath =
  "packages/flarex-backend/src/taskRuntimePublication/TaskRuntimeObjectStore.ts";
const flarexBackendTaskResultStorePath =
  "packages/flarex-backend/src/taskResult/TaskResultStore.ts";
const flarexBackendTaskResultBodyQueryPath =
  "packages/flarex-backend/src/taskResult/TaskResultBodyQuery.ts";
const flarexBackendTaskExecutionPrincipalStorePath =
  "packages/flarex-backend/src/taskExecutionPrincipal/TaskExecutionPrincipalStore.ts";
const flarexBackendTaskInputStorePath =
  "packages/flarex-backend/src/taskInput/TaskInputStore.ts";
const flarexBackendImmutableR2SourcePrefix =
  "packages/flarex-backend/src/immutableR2/";
const flarexBackendDeclarativeV2RuntimeArtifactStorePath =
  "packages/flarex-backend/src/artifactRuntime/DeclarativeV2RuntimeArtifactStore.ts";
const persistencePostgresSchemaPath =
  "packages/persistence-postgres/src/schema.ts";
const persistencePostgresTaskRunAttemptStorePath =
  "packages/persistence-postgres/src/taskSystemRunAttemptStoreV1.ts";
const persistencePostgresTaskAttemptLifecycleGatewayPath =
  "packages/persistence-postgres/src/taskAttemptLifecycleGateway.ts";
const persistencePostgresTaskExternalEffectAuthorityPath =
  "packages/persistence-postgres/src/taskExternalEffectAuthority.ts";
const persistencePostgresPostgresTaskExternalEffectAuthorityPath =
  "packages/persistence-postgres/src/postgresTaskExternalEffectAuthority.ts";
const persistencePostgresTaskLifecycleLedgerCorrelationPath =
  "packages/persistence-postgres/src/taskSystemLifecycleLedgerCorrelationV1.ts";
const persistencePostgresTaskRunCreationPath =
  "packages/persistence-postgres/src/taskSystemRunCreationV1.ts";
const persistencePostgresApplicationTaskRunCreationPath =
  "packages/persistence-postgres/src/applicationTaskSystemRunCreation.ts";
const persistencePostgresTaskSystemRunRowPath =
  "packages/persistence-postgres/src/taskSystemRunRowV1.ts";
const persistencePostgresTaskSystemRequestedEffectRowPath =
  "packages/persistence-postgres/src/taskSystemRequestedEffectRowV1.ts";
const persistencePostgresTaskSystemRunReadPath =
  "packages/persistence-postgres/src/taskSystemRunReadV1.ts";
const persistencePostgresTaskComputeDeliveryEvidencePath =
  "packages/persistence-postgres/src/taskComputeDeliveryEvidenceV1.ts";
const persistencePostgresTaskComputeDeliveryRepositoryPath =
  "packages/persistence-postgres/src/taskComputeDeliveryRepositoryV1.ts";
const persistencePostgresTaskComputeDeliveryDiscoveryPath =
  "packages/persistence-postgres/src/taskComputeDeliveryDiscovery.ts";
const persistencePostgresTaskComputeDeliveryControlDirectoryPath =
  "packages/persistence-postgres/src/taskComputeDeliveryControlDirectory.ts";
const persistencePostgresTaskComputeDeliveryControlDirectoryTargetPath =
  "packages/persistence-postgres/src/taskComputeDeliveryControlDirectoryTarget.ts";
const persistencePostgresTaskComputeDeliveryControlDirectoryTargetSystemTestPath =
  "packages/persistence-postgres/src/taskComputeDeliveryControlDirectoryTargetSystemTest.ts";
const persistencePostgresPostgresTaskComputeDeliveryControlDirectoryPath =
  "packages/persistence-postgres/src/postgresTaskComputeDeliveryControlDirectory.ts";
const persistencePostgresPGlitePath =
  "packages/persistence-postgres/src/pglite.ts";
const persistencePostgresPhysicalDefinitionRetirementPinsPath =
  "packages/persistence-postgres/src/physicalDefinitionRetirementPins.ts";
const flarexBackendTaskComputeDeliveryTrustedDirectoryPath =
  "packages/flarex-backend/src/taskComputeDelivery/TrustedDirectory.ts";
const persistencePostgresTaskWakeSchedulerPartitionPath =
  "packages/persistence-postgres/src/taskSystemWakeSchedulerPartitionV1.ts";
const persistencePostgresTaskWakeSchedulerDirectoryPath =
  "packages/persistence-postgres/src/taskSystemWakeSchedulerDirectoryV1.ts";
const persistencePostgresTaskWakeSchedulerRepairDirectoryPath =
  "packages/persistence-postgres/src/taskSystemWakeSchedulerRepairDirectoryV1.ts";
const persistencePostgresTaskWakeSchedulerResolverPath =
  "packages/persistence-postgres/src/taskSystemWakeSchedulerResolverV1.ts";
const persistencePostgresTaskWakeSchedulerCompositionPath =
  "packages/persistence-postgres/src/taskSystemWakeSchedulerCompositionV1.ts";
const executorTaskQueueWakePath =
  "packages/executor/src/taskQueueWakeV1.ts";
const executorTaskRepairSweepPath =
  "packages/executor/src/taskRepairSweepV1.ts";
const executorTaskRepairSweepContinuationCodecPath =
  "packages/executor/src/taskRepairSweepContinuationCodecV1.ts";
const executorTaskRepairSchedulerRunPath =
  "packages/executor/src/taskRepairSchedulerRunV1.ts";
const standardApplicationTaskDefinitionSourcePrefix =
  "packages/standard-application-definition/src/taskDefinition/";
const standardApplicationTaskDefinitionDurableTaskSpecifier =
  "@flarex/durable-task/internal/run-attempt-v1";
const admittedStandardApplicationDurableTaskSymbols = new Set([
  "RunAttemptPolicyV1",
  "RunAttemptPolicyV1Schema",
  "TaskComputeProfileRefV1",
  "TaskComputeProfileRefV1Schema",
  "TaskDefinitionRevisionIdV1",
  "TaskDefinitionRevisionIdV1Schema",
]);
const admittedPersistenceDurableTaskSymbolsBySpecifier = new Map([
  ["@flarex/durable-task/internal/run-attempt-v1", new Set([
    "MAX_TASK_REQUESTED_EFFECT_PERSISTED_JSON_BYTES_V1",
    "MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1",
    "TaskAttemptIdV1",
    "TaskAttemptNumberV1",
    "TaskCancellationGenerationV1",
    "TaskDefinitionRevisionIdV1",
    "TaskDurationMsV1",
    "TaskExecutionFenceV1",
    "TaskLeaseVersionV1",
    "TaskRequestedEffectPersistenceCursorV1",
    "TaskRequestedEffectSequenceV1",
    "TaskRequestedEffectV1",
    "TaskRunAttemptPersistenceProjectionV1",
    "TaskRunIdV1",
    "TaskRunVersionV1",
    "ApplicationTaskRunAttemptPersistenceProjectionV1",
  ])],
  ["@flarex/durable-task/internal/run-creation-v1", new Set([
    "MAX_TASK_INPUT_CANONICAL_BYTES_V1",
    "MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1",
    "TaskInputSha256V1",
    "TaskExecutionPrincipalSha256V1",
    "ApplicationTaskRuntimeTargetSha256V1",
    "TaskRunCreationAuthoritySha256V1",
    "TaskRunCreationRequestKeySha256V1",
    "TaskRunCreationRequestSha256V1",
  ])],
]);
const admittedPersistenceTaskComputeDeliveryEvidenceSymbolsBySpecifier =
  new Map([
    ["@flarex/durable-task/internal/compute-provider-v1", new Set([
      "TaskComputeCancellationReceiptV1",
      "TaskComputeCancellationRequestV1",
      "ApplicationTaskComputeDispatchRequestV1",
      "CurrentTaskComputeDispatchRequestV1",
      "TaskComputeDispatchAcceptanceV1",
      "TaskComputeDispatchRequestV1",
      "decodeApplicationTaskComputeDispatchRequestV1",
      "decodeTaskComputeCancellationReceiptV1",
      "decodeTaskComputeCancellationRequestV1",
      "decodeTaskComputeDispatchAcceptanceV1",
      "decodeTaskComputeDispatchRequestV1",
      "encodeApplicationTaskComputeDispatchRequestV1",
      "encodeTaskComputeCancellationReceiptV1",
      "encodeTaskComputeCancellationRequestV1",
      "encodeTaskComputeDispatchAcceptanceV1",
      "encodeTaskComputeDispatchRequestV1",
      "validateApplicationTaskComputeDispatchRequestV1",
      "validateCurrentTaskComputeDispatchRequestV1",
      "validateTaskComputeCancellationReceiptV1",
      "validateTaskComputeCancellationRequestV1",
      "validateTaskComputeDispatchAcceptanceV1",
      "validateTaskComputeDispatchRequestV1",
    ])],
    ["@flarex/durable-task/internal/run-creation-v1", new Set([
      "TaskExecutionPrincipalReferenceV1",
      "TaskInputReferenceV1",
      "decodeTaskExecutionPrincipalReferenceV1",
      "decodeTaskInputReferenceV1",
    ])],
    ["@flarex/durable-task/internal/run-attempt-v1", new Set([
      "TaskComputeProfileRefV1",
      "TaskComputeProfileRefV1Schema",
    ])],
  ]);
const admittedPersistenceTaskComputeDeliveryRepositorySymbolsBySpecifier =
  new Map([
    ["@flarex/durable-task/internal/compute-provider-v1", new Set([
      "TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1",
      "TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1",
      "TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1",
      "TaskComputeCancellationReceiptV1",
      "TaskComputeCancellationRejectedError",
      "TaskComputeCancellationRequestV1",
      "TaskComputeCancellationStaleError",
      "TaskComputeCancellationTransportError",
      "TaskComputeDispatchIdentityV1",
      "TaskComputeDispatchRejectedError",
      "TaskComputeDispatchTransportError",
      "TaskComputeDispatchAcceptanceV1",
      "TaskComputeDispatchRequestV1",
      "ApplicationTaskComputeDispatchRequestV1",
      "CurrentTaskComputeDispatchRequestV1",
      "validateApplicationTaskComputeDispatchRequestV1",
      "validateCurrentTaskComputeDispatchRequestV1",
      "validateTaskComputeCancellationReceiptV1",
      "validateTaskComputeCancellationRequestV1",
      "validateTaskComputeDispatchAcceptanceV1",
      "validateTaskComputeDispatchRequestV1",
    ])],
    ["@flarex/durable-task/internal/run-creation-v1", new Set([
      "TaskExecutionPrincipalReferenceV1",
      "TaskInputReferenceV1",
      "decodeTaskExecutionPrincipalReferenceV1",
      "decodeTaskInputReferenceV1",
    ])],
    ["@flarex/durable-task/internal/run-attempt-v1", new Set([
      "PersistedTaskRequestedEffectV1",
      "ApplicationPersistedTaskRequestedEffectV1",
      "ApplicationTaskRunAttemptAggregateV1",
      "CurrentPersistedTaskRequestedEffect",
      "CurrentTaskRunAttemptAggregate",
      "TaskCancellationGenerationV1",
      "TaskRequestedEffectSequenceV1",
      "TaskRunAttemptAggregateV1",
      "TaskRunIdV1",
      "decodeTaskAttemptIdV1",
      "decodeTaskCancellationGenerationV1",
      "decodeTaskExecutionFenceV1",
      "decodeTaskRequestedEffectSequenceV1",
      "decodeTaskRunIdV1",
    ])],
  ]);
const admittedPersistenceTaskComputeDeliveryDiscoverySymbols = new Set([
  "TaskRunIdV1Schema",
  "TaskRequestedEffectSequenceV1",
  "TaskRunIdV1",
  "TaskRunVersionV1",
  "decodeTaskRequestedEffectSequenceV1",
]);
const admittedFlarexBackendTaskComputeDeliveryCandidateRunnerSymbols =
  new Set([
    "TaskComputeCancellationErrorV1",
    "TaskComputeCancellationRejectedError",
    "TaskComputeCancellationStaleError",
    "TaskComputeCancellationTransportError",
    "TaskComputeDispatchErrorV1",
    "TaskComputeDispatchRejectedError",
    "TaskComputeDispatchTransportError",
    "TaskComputeProvider",
  ]);
const admittedFlarexBackendTaskRuntimeLaunchSymbolsBySpecifier = new Map([
  ["@flarex/durable-task/internal/compute-provider-v1", new Set([
    "ApplicationTaskComputeDispatchRequestV1",
    "CurrentTaskComputeDispatchRequestV1",
    "TaskComputeDispatchRequestV1",
    "validateCurrentTaskComputeDispatchRequestV1",
    "validateTaskComputeDispatchRequestV1",
  ])],
  ["@flarex/durable-task/internal/run-creation-v1", new Set([
    "TaskExecutionPrincipalReferenceV1",
    "TaskInputReferenceV1",
    "decodeTaskInputReferenceV1",
  ])],
]);
const admittedFlarexBackendTaskExecutionPrincipalStoreSymbols = new Set([
  "MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1",
  "TaskExecutionPrincipalReferenceV1",
  "decodeTaskExecutionPrincipalReferenceV1",
  "makeTaskExecutionPrincipalReferenceV1",
]);
const admittedFlarexBackendTaskRuntimeLaunchAuthoritySymbolsBySpecifier = new Map([
  ["@flarex/durable-task/internal/compute-provider-v1", new Set([
    "validateTaskComputeDispatchRequestV1",
  ])],
  ["@flarex/durable-task/internal/run-creation-v1", new Set([
    "decodeTaskExecutionPrincipalReferenceV1",
  ])],
]);
const admittedFlarexBackendWorkerLoaderProviderSymbols = new Set([
  "TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1",
  "TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1",
  "TaskComputeCancellationRejectedError",
  "TaskComputeCancellationStaleError",
  "TaskComputeCancellationTransportError",
  "TaskComputeCancellationUncertainError",
  "TaskComputeDispatchConflictError",
  "TaskComputeDispatchRejectedError",
  "TaskComputeDispatchTransportError",
  "TaskComputeDispatchUncertainError",
  "TaskComputeExecutionIdV1",
  "TaskComputeExecutionIdV1Schema",
  "TaskComputeProvider",
  "decodeTaskComputeProviderDescriptorV1",
  "makeTaskComputeProviderV1",
  "snapshotTaskComputeCancellationReceiptV1",
  "snapshotTaskComputeDispatchAcceptanceV1",
  "CurrentTaskComputeDispatchRequestV1",
  "TaskComputeCancellationErrorV1",
  "TaskComputeCancellationReceiptV1",
  "TaskComputeCancellationRequestV1",
  "TaskComputeDispatchAcceptanceV1",
  "TaskComputeDispatchErrorV1",
  "TaskComputeExecutionRefV1",
  "TaskComputeProviderDescriptorV1",
  "TaskComputeProviderShape",
]);
const admittedFlarexBackendTaskWorkerTerminalCompletionSymbols = new Set([
  "TaskAttemptCompletionV1",
  "TaskCancellationGenerationV1",
  "TaskExecutionFailureV1",
  "TaskRetryDirectiveV1",
]);
const admittedFlarexBackendTaskAttemptSupervisorRunAttemptSymbols = new Set([
  "ApplicationCompleteAttemptOutcomeV1",
  "ApplicationHeartbeatAttemptOutcomeV1",
  "ApplicationTaskSystemRunAttemptTransactionReceiptV1",
  "CompleteAttemptCurrentReasonV1",
  "CompleteAttemptOutcomeV1",
  "HeartbeatAttemptCurrentReasonV1",
  "HeartbeatAttemptOutcomeV1",
  "TaskAttemptCompletionV1",
  "TaskSystemRunAttemptTransactionReceiptV1",
  "TaskSystemRunAttemptTransientStoreError",
  "encodeTaskAttemptCompletionV1",
]);
const admittedFlarexBackendTaskAttemptSupervisorComputeProviderSymbols =
  new Set(["CurrentTaskComputeDispatchRequestV1"]);
const admittedFlarexBackendTaskResultStoreSymbols = new Set([
  "MAX_TASK_RESULT_CANONICAL_BYTES_V1",
  "TASK_RESULT_CODEC_V1",
  "TaskResultCommitmentV1",
  "decodeTaskResultCommitmentV1",
  "taskResultObjectKeyV1",
]);
const admittedLegacyWorkerLaunchModelImports = new Map([
  ["TaskRuntimeLaunchSubject", "type"],
]);
const admittedWorkerLoaderLaunchAuthorityImports = new Map([
  ["TaskRuntimeLaunchAuthority", "value"],
  ["TaskRuntimeLaunchAuthorityShape", "type"],
]);
const admittedWorkerLoaderLaunchModelImports = new Map([
  ["TaskRuntimeLaunchHashError", "value"],
  ["TaskRuntimeLaunchPortError", "value"],
  ["TaskRuntimeLaunchValidationError", "value"],
  ["CurrentTaskRuntimeLaunchSubject", "type"],
  ["TaskRuntimeInputSource", "type"],
]);
const admittedApplicationTaskQueryCallbackLaunchModelImports = new Map([
  ["ApplicationTaskRuntimeLaunchSubject", "type"],
]);
const admittedApplicationTaskQueryCallbackComputeProviderImports = new Map([
  ["TaskComputeExecutionIdV1", "type"],
]);
const admittedApplicationTaskMutationCallbackLaunchModelImports = new Map([
  ["ApplicationTaskRuntimeLaunchSubject", "type"],
]);
const admittedApplicationTaskMutationCallbackComputeProviderImports = new Map([
  ["TaskComputeExecutionIdV1", "type"],
]);
const admittedApplicationTaskComputeDeliveryImports = new Map([
  ["TaskComputeDeliveryCandidateRunnerLive", "value"],
  ["makeTaskComputeDeliveryConnectedRunnerLayer", "value"],
  ["makeTaskComputeDeliveryTrustedDirectoryLayer", "value"],
  ["makeSupervisedWorkerLoaderTaskComputeProviderLayer", "value"],
  ["TaskAttemptSupervisionObserver", "type"],
  ["TaskAttemptSupervisor", "type"],
  ["TaskComputeDeliveryConnectedRunnerOptions", "type"],
  ["TaskComputeDeliveryTrustedDirectoryOptions", "type"],
  ["ApplicationTaskMutationCallbackAuthority", "type"],
  ["WorkerLoaderTaskComputeProviderOptions", "type"],
]);
const admittedApplicationTaskMutationAuthorityComputeDeliveryImports = new Map([
  ["ApplicationTaskMutationCallbackBindError", "value"],
  ["ApplicationTaskMutationCallbackAuthority", "type"],
  ["ApplicationTaskMutationCallbackSession", "type"],
  ["ApplicationTaskMutationCallbackSessionFailure", "type"],
]);
const admittedApplicationTaskMutationAuthorityLaunchImports = new Map([
  ["decodeTaskRuntimeLaunchRequest", "value"],
  ["ApplicationTaskRuntimeLaunchSubject", "type"],
]);
const admittedApplicationTaskMutationAuthorityExternalEffectImports = new Map([
  ["confirmTaskChildMutationEffect", "value"],
  ["declareTaskChildMutationDispatch", "value"],
  ["issueApplicationTaskExternalEffectSubject", "value"],
  ["prepareTaskChildMutationEffect", "value"],
  ["reconcileTaskChildMutationDisposition", "value"],
  ["revokeApplicationTaskExternalEffectSubject", "value"],
  ["InvalidApplicationTaskExternalEffectSubjectError", "value"],
  ["TaskExternalEffectAuthorityCorruptionError", "value"],
  ["TaskExternalEffectAuthorityInputError", "value"],
  ["TaskExternalEffectAuthorityStaleError", "value"],
  ["TaskExternalEffectLifecycleConflictError", "value"],
  ["TaskExternalEffectRequestConflictError", "value"],
  ["TaskExternalEffectSequenceConflictError", "value"],
  ["LocatedTaskExternalEffectAuthorityTarget", "type"],
  ["ReconcileTaskChildMutationDispositionInput", "type"],
  ["ReconcileTaskChildMutationDispositionReceipt", "type"],
  ["TaskChildMutationEffectInput", "type"],
  ["TaskChildMutationEffectProjection", "type"],
  ["TaskExternalEffectAuthorityHashContext", "type"],
  ["TaskExternalEffectAuthoritySha256", "type"],
]);
const admittedPGliteTaskExternalEffectAuthorityImports = new Map([
  ["createLocatedTaskExternalEffectAuthorityTarget", "value"],
  ["LocatedTaskExternalEffectAuthorityTarget", "type"],
  ["TaskExternalEffectAuthorityConfigurationError", "type"],
]);
const admittedPostgresTaskExternalEffectAuthorityImports = new Map([
  [
    "createLocatedTaskExternalEffectAuthorityTargetFromPolicyInternal",
    "value",
  ],
  ["TaskExternalEffectAuthorityConfigurationError", "value"],
  ["LocatedTaskExternalEffectAuthorityTarget", "type"],
]);
const admittedSystemTestConnectedHarnessTaskExternalEffectAuthorityImports =
  new Map([
    ["createLocatedTaskExternalEffectAuthorityTarget", "value"],
    ["LocatedTaskExternalEffectAuthorityTarget", "type"],
  ]);
const admittedApplicationTaskRuntimeLaunchImports = new Map([
  ["makeTaskRuntimeLaunchAuthorityLayer", "value"],
  ["TaskRuntimeLaunchAuthorityOptions", "type"],
  ["TaskRuntimeLaunchDirectory", "type"],
]);
const admittedSystemTestConnectedHarnessTaskComputeImports = new Map([
  ["makeTaskAttemptSupervisor", "value"],
  ["TaskComputeDeliveryConnectedRunner", "value"],
  ["TaskAttemptSupervisionObserver", "type"],
  ["TaskAttemptSupervisorError", "type"],
  ["TaskAttemptSupervisorLifecycleResolver", "type"],
  ["TaskAttemptSupervisorOutcome", "type"],
  ["TaskAttemptSupervisorPolicy", "type"],
  ["TaskComputeDeliveryConnectedRunnerReceipt", "type"],
]);
const admittedSystemTestConnectedHarnessTaskRuntimeLaunchImports = new Map([
  ["TaskRuntimeLaunchPortError", "value"],
  ["TaskRuntimeLaunchDirectory", "type"],
  ["TaskRuntimeLaunchLocatedSource", "type"],
  ["TaskRuntimeLaunchResourceDirectory", "type"],
]);
const admittedSystemTestConnectedHarnessRunAttemptImports = new Map([
  ["decideApplicationRequestCancellationV1", "value"],
  ["decideApplicationStartAttemptV1", "value"],
  ["decodeTaskDurationMsV1", "value"],
  ["decodeTaskRetryJitterV1", "value"],
  ["decodeTaskRunVersionV1", "value"],
  ["encodeApplicationTaskRunAttemptAggregateJsonV1", "value"],
]);
const admittedSystemTestConnectedHarnessRunCreationImports = new Map([
  ["decodeTaskRunCreationRequestKeyV1", "value"],
  ["makeTaskInputReferenceV1", "value"],
]);
const admittedApplicationTaskSystemPrincipalStoreImports = new Map([
  ["TaskExecutionPrincipalIdentity", "type"],
  ["TaskExecutionPrincipalIssuer", "type"],
  ["TaskExecutionPrincipalStoreError", "type"],
]);
const admittedSystemTestConnectedHarnessPrincipalStoreImports = new Map([
  ["makeTaskExecutionPrincipalStore", "value"],
]);
const admittedTaskRuntimeLaunchAuthorityPrincipalStoreImports = new Map([
  ["decodeTaskExecutionPrincipalObjectV1", "value"],
]);
const admittedSystemTestConnectedHarnessTaskResultImports = new Map([
  ["makeTaskResultStore", "value"],
  ["TaskResultStoreSettlementUncertainError", "value"],
  ["TaskResultStoreBucket", "type"],
]);
const admittedTaskAttemptSupervisorResultStoreImports = new Map([
  ["TaskResultStore", "type"],
  ["TaskResultStoreError", "type"],
]);
const admittedSystemTestConnectedHarnessLifecycleGatewayImports = new Map([
  ["createTaskAttemptLifecycleGateway", "value"],
  ["ApplicationTaskAttemptLifecycleCapability", "type"],
]);
const admittedSystemTestConnectedHarnessControlTargetImports = new Map([
  ["TaskComputeDeliveryControlDirectoryTarget", "type"],
]);
const admittedSystemTestConnectedHarnessControlFactoryImports = new Map([
  ["createTaskComputeDeliveryControlDirectoryTargetForSystemTest", "value"],
]);
const admittedStandardApplicationTaskRunQueryImports = new Map([
  ["makeTaskRunQueryLayer", "value"],
  ["TaskRunQuery", "value"],
  ["TaskRunProjection", "type"],
  ["TaskRunQueryApi", "type"],
  ["TaskRunQueryError", "type"],
]);
const admittedStandardApplicationTaskResultQueryImports = new Map([
  ["makeTaskRunResultQueryLayer", "value"],
]);
const admittedStandardApplicationTaskCancellationImports = new Map([
  ["makeApplicationRunAttemptLifecycleV1", "value"],
  ["ApplicationRequestCancellationOutcomeV1", "type"],
  ["ApplicationTaskSystemRunAttemptStoreShape", "type"],
  ["ApplicationTaskSystemRunAttemptTransactionReceiptV1", "type"],
  ["RunAttemptLifecycleErrorV1", "type"],
  ["TaskCancellationReasonV1", "type"],
  ["TaskRunIdV1", "type"],
]);
const admittedBackendTaskResultBodyQueryImports = new Map([
  ["TaskRunResultQuery", "value"],
  ["TaskRunResultQueryApi", "type"],
  ["TaskRunResultQueryError", "type"],
]);
const admittedLaterDurableTaskImports = [
  makeExactImportAdmission(
    flarexBackendTaskInputStorePath,
    "@flarex/durable-task/internal/run-creation-v1",
    {
      values: [
        "decodeTaskInputReferenceV1",
        "makeTaskInputReferenceV1",
        "MAX_TASK_INPUT_CANONICAL_BYTES_V1",
      ],
      types: ["TaskInputReferenceV1"],
    },
  ),
  makeExactImportAdmission(
    flarexBackendTaskRuntimeLaunchResourceDirectoryPath,
    "@flarex/durable-task/internal/compute-provider-v1",
    { types: ["CurrentTaskComputeDispatchRequestV1"] },
  ),
  makeExactImportAdmission(
    persistencePostgresPhysicalDefinitionRetirementPinsPath,
    "@flarex/durable-task/internal/run-attempt-v1",
    { types: ["TaskRunIdV1"] },
  ),
  makeExactImportAdmission(
    systemTestApplicationEnvironmentPath,
    "@flarex/durable-task/internal/run-attempt-v1",
    { values: ["decodeTaskDurationMsV1"] },
  ),
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "@flarex/durable-task/internal/run-attempt-v1",
    {
      values: [
        "decideApplicationRequestCancellationV1",
        "decideApplicationStartAttemptV1",
        "decodeTaskRetryJitterV1",
        "decodeTaskRunVersionV1",
        "encodeApplicationTaskRunAttemptAggregateJsonV1",
      ],
      types: [
        "RunAttemptDecisionErrorV1",
        "TaskAttemptNumberV1",
        "TaskCancellationGenerationV1",
        "TaskComputeProfileRefV1",
        "TaskDatabaseTimeMsV1",
        "TaskSystemRunAttemptStoreErrorV1",
        "TaskRunIdV1",
      ],
    },
  ),
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "@flarex/durable-task/internal/scheduling-testing-v1",
    { values: ["makeFixedTaskRetryJitterSourceV1"] },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskSystemConnectedHarnessPath,
    "@flarex/durable-task/internal/scheduling-testing-v1",
    { values: ["makeFixedTaskRetryJitterSourceV1"] },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskSystemFreshHostTakeoverHarnessPath,
    "@flarex/durable-task/internal/run-attempt-v1",
    {
      values: ["encodeApplicationTaskRunAttemptAggregateJsonV1"],
      types: [
        "ApplicationTaskSystemRunAttemptStoreShape",
        "TaskResultCommitmentV1",
        "TaskRunIdV1",
      ],
    },
  ),
];
const admittedLaterTaskComputeDeliveryImports = [
  makeExactImportAdmission(
    standardApplicationTaskDeliveryEventHostPath,
    "flarex-backend/internal/task-compute-delivery",
    {
      values: ["makeTaskComputeDeliveryEventHost"],
      types: [
        "TaskAttemptSupervisionObserver",
        "TaskComputeDeliveryEventHostConfigurationError",
        "TaskComputeDeliveryEventHostPolicy",
        "TaskComputeDeliveryEventHostShape",
      ],
    },
  ),
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "flarex-backend/internal/task-compute-delivery",
    {
      values: [
        "makeTaskAttemptSupervisor",
        "TaskComputeDeliveryConnectedRunner",
        "TaskComputeDeliverySupervisionControl",
      ],
      types: [
        "TaskAttemptSupervisionObserver",
        "TaskAttemptSupervisor",
        "TaskAttemptSupervisorError",
        "TaskAttemptSupervisorOutcome",
        "TaskAttemptSupervisorConfigurationError",
        "TaskAttemptSupervisorLifecycleResolver",
        "TaskAttemptSupervisorPolicy",
        "TaskComputeDeliveryEventHostConfigurationError",
        "TaskComputeDeliveryEventRunnerReceipt",
        "TaskComputeDeliveryConnectedRunnerReceipt",
      ],
    },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskHostedTestKitPath,
    "flarex-backend/internal/task-compute-delivery",
    { types: ["TaskComputeDeliveryConnectedRunnerOptions"] },
  ),
];
const admittedLaterTaskRuntimeLaunchImports = [
  makeExactImportAdmission(
    standardApplicationTaskDeliveryEventHostPath,
    "flarex-backend/internal/task-runtime-launch",
    {
      values: ["makeTaskRuntimeLaunchDirectoryFromResources"],
      types: ["TaskRuntimeLaunchResourceDirectory"],
    },
  ),
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "flarex-backend/internal/task-runtime-launch",
    {
      values: [
        "makeTaskRuntimeLaunchDirectoryFromResources",
        "TaskRuntimeLaunchPortError",
      ],
      types: [
        "TaskRuntimeLaunchLocatedSource",
        "TaskRuntimeLaunchResourceDirectory",
      ],
    },
  ),
];
const admittedLaterTaskExecutionPrincipalStoreImports = [
  makeExactImportAdmission(
    flarexBackendTaskRuntimeLaunchResourceDirectoryPath,
    "../taskExecutionPrincipal/TaskExecutionPrincipalStore.js",
    {
      values: [
        "TaskExecutionPrincipalStoreCorruptionError",
        "TaskExecutionPrincipalStoreInputError",
        "TaskExecutionPrincipalStoreNotFoundError",
        "TaskExecutionPrincipalStoreResourceError",
        "TaskExecutionPrincipalStoreSettlementUncertainError",
      ],
      types: ["TaskExecutionPrincipalReader"],
    },
  ),
  makeExactImportAdmission(
    systemTestApplicationEnvironmentPath,
    "flarex-backend/internal/task-execution-principal-store",
    { types: ["TaskExecutionPrincipalStoreBucket"] },
  ),
  makeExactImportAdmission(
    systemTestApplicationEnvironmentPath,
    "flarex-backend/internal/task-execution-principal-store",
    { values: ["makeTaskExecutionPrincipalStore"] },
  ),
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "flarex-backend/internal/task-execution-principal-store",
    {
      values: ["makeTaskExecutionPrincipalStore"],
      types: ["TaskExecutionPrincipalStore"],
    },
  ),
];
const admittedLaterTaskResultStoreImports = [
  makeExactImportAdmission(
    flarexBackendTaskResultBodyQueryPath,
    "./TaskResultStore.js",
    { types: ["TaskResultStore", "TaskResultStoreError"] },
  ),
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "flarex-backend/internal/task-result-store",
    {
      values: [
        "makeTaskResultStore",
        "TaskResultStoreSettlementUncertainError",
      ],
      types: ["TaskResultStoreBucket", "TaskResultStoreError"],
    },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskHostedTestKitPath,
    "flarex-backend/internal/task-result-store",
    { types: ["TaskResultStoreBucket"] },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskSystemFreshHostTakeoverHarnessPath,
    "flarex-backend/internal/task-result-store",
    { types: ["StoredTaskResult", "TaskResultStoreError"] },
  ),
];
const admittedLaterTaskRuntimeObjectStoreImports = [
  makeExactImportAdmission(
    flarexBackendTaskRuntimeLaunchResourceDirectoryPath,
    "../taskRuntimePublication/TaskRuntimeObjectStore.js",
    {
      values: [
        "TaskRuntimeObjectStoreCorruptionError",
        "TaskRuntimeObjectStoreInputError",
        "TaskRuntimeObjectStoreNotFoundError",
        "TaskRuntimeObjectStoreResourceError",
        "TaskRuntimeObjectStoreSettlementUncertainError",
      ],
      types: ["TaskRuntimeObjectStore"],
    },
  ),
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "flarex-backend/internal/task-runtime-object-store",
    { values: ["makeTaskRuntimeObjectStore"] },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskHostedTestKitPath,
    "flarex-backend/internal/task-runtime-object-store",
    { types: ["TaskRuntimeObjectStoreBucket"] },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskSystemConnectedHarnessPath,
    "flarex-backend/internal/task-runtime-object-store",
    { values: ["makeTaskRuntimeObjectStore"] },
  ),
];
const admittedLaterImmutableR2Imports = [
  makeExactImportAdmission(
    flarexBackendTaskInputStorePath,
    "../immutableR2/ImmutableR2ByteStore.js",
    {
      values: [
        "ImmutableR2BodyBudgetExceededError",
        "ImmutableR2CorruptionError",
        "ImmutableR2NotFoundError",
        "ImmutableR2ResourceError",
        "ImmutableR2SettlementUncertainError",
        "immutableR2ResourceCause",
        "immutableR2SettlementUncertainCause",
        "makeImmutableR2ByteStore",
      ],
      types: ["ImmutableR2Bucket"],
    },
  ),
];
const admittedLaterTaskAttemptLifecycleGatewayImports = [
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway",
    {
      values: ["createTaskAttemptLifecycleGateway"],
      types: ["ApplicationTaskAttemptLifecycleCapability"],
    },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskSystemFreshHostTakeoverHarnessPath,
    "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway",
    { types: ["ApplicationTaskAttemptLifecycleCapability"] },
  ),
];
const admittedLaterTaskWakeSchedulerPartitionImports = [
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1",
    {
      values: ["makeApplicationTaskSystemWakeSchedulerPartitionV1"],
      types: ["ApplicationTaskSystemWakeSchedulerPartitionV1"],
    },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskSystemConnectedHarnessPath,
    "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1",
    { values: ["makeApplicationTaskSystemWakeSchedulerPartitionV1"] },
  ),
  makeExactImportAdmission(
    systemTestApplicationTaskSystemFreshHostTakeoverHarnessPath,
    "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1",
    { types: ["ApplicationTaskSystemWakeSchedulerPartitionV1"] },
  ),
];
const admittedLaterTaskExternalEffectAuthorityImports = [
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "@flarex/persistence-postgres/internal/task-external-effect-authority",
    { types: ["LocatedTaskExternalEffectAuthorityTarget"] },
  ),
  makeExactImportAdmission(
    systemTestDatabaseLanePath,
    "@flarex/persistence-postgres/internal/system-test/postgres-task-external-effect-authority",
    { values: ["createPostgresTaskExternalEffectAuthorityResource"] },
  ),
];
const admittedLaterTaskComputeDeliveryControlDirectoryImports = [
  makeExactImportAdmission(
    systemTestStandardApplicationTaskDeliveryPath,
    "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory",
    { types: ["TaskComputeDeliveryControlDirectoryTarget"] },
  ),
  makeExactImportAdmission(
    systemTestDatabaseLanePath,
    "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory",
    { values: ["createTaskComputeDeliveryControlDirectoryTargetForSystemTest"] },
  ),
  makeExactImportAdmission(
    systemTestDatabaseLanePath,
    "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory",
    { values: ["createPostgresTaskComputeDeliveryControlDirectoryResource"] },
  ),
];
const admittedLaterPersistenceTaskImports = [
  makeExactImportAdmission(
    persistencePostgresTaskSystemRunReadPath,
    "@flarex/durable-task/internal/run-attempt-v1",
    {
      values: [
        "decodeTaskDatabaseTimeMsV1",
        "decodeTaskRequestedEffectSequenceV1",
      ],
      types: [
        "ApplicationTaskRunAttemptAggregateV1",
        "PersistedTaskRunAttemptAggregate",
        "TaskRequestedEffectPersistenceCursorV1",
        "TaskRunAttemptAggregateV1",
        "TaskRunIdV1",
      ],
    },
  ),
  makeExactImportAdmission(
    persistencePostgresTaskWakeSchedulerPartitionPath,
    "@flarex/durable-task/internal/run-attempt-v1",
    {
      values: [
        "makeApplicationRunAttemptLifecycleV1",
        "makeRunAttemptLifecycleV1",
      ],
      types: ["RunAttemptLifecycleErrorV1"],
    },
  ),
  makeExactImportAdmission(
    persistencePostgresTaskWakeSchedulerPartitionPath,
    "@flarex/durable-task/internal/scheduling-v1",
    {
      values: [
        "makeApplicationRunAttemptDueCandidateHandlerV1",
        "makeRunAttemptDueCandidateHandlerV1",
        "makeTaskWakeSchedulerV1",
        "makeWakePublishingRunAttemptDueCandidateHandlerV1",
      ],
      types: [
        "InvalidTaskWakeSchedulerConfigurationError",
        "TaskDueCandidateLifecycleContractError",
        "TaskRetryJitterSourceV1",
        "TaskWakeHintPublisherV1",
        "TaskWakeSchedulerOptionsV1",
        "TaskWakeSchedulerV1",
      ],
    },
  ),
];
const admittedPersistenceTaskRunAttemptStoreSymbols = new Set([
  "ApplicationPersistedTaskRequestedEffectV1",
  "ApplicationTaskRunAttemptAggregateV1",
  "ApplicationTaskRunAttemptDecisionV1",
  "ApplicationTaskSystemRunAttemptDecisionInputV1",
  "ApplicationTaskSystemRunAttemptInspectionSnapshotV1",
  "ApplicationTaskSystemRunAttemptStoreShape",
  "ApplicationTaskSystemRunAttemptTransactionReceiptV1",
  "ApplicationTaskSystemRunAttemptTransactionV1",
  "CurrentTaskRunAttemptAggregate",
  "CurrentTaskRunAttemptDecision",
  "InvalidRunAttemptTransitionError",
  "PersistedTaskRequestedEffectV1",
  "RunAttemptDecisionErrorV1",
  "RunAttemptDecisionFor",
  "RunAttemptOperationV1",
  "RunAttemptServiceReceiptFor",
  "StaleTaskRunVersionError",
  "TaskAttemptGrantCandidateV1",
  "TaskAttemptIdV1",
  "TaskAttemptNumberV1",
  "TaskDatabaseTimeMsV1",
  "TaskExecutionFenceV1",
  "TaskPersistenceCodecErrorV1",
  "TaskRunAttemptAggregateV1",
  "TaskRunAttemptCounterExhaustedError",
  "TaskRunAttemptDecisionV1",
  "TaskRunIdV1",
  "TaskRunVersionV1",
  "TaskSystemRunAttemptCorruptionError",
  "TaskSystemRunAttemptInspectionSnapshotV1",
  "TaskSystemRunAttemptStaleScopeAuthorityError",
  "TaskSystemRunAttemptStore",
  "TaskSystemRunAttemptStoreErrorV1",
  "TaskSystemRunAttemptStoreShape",
  "TaskSystemRunAttemptTerminalStoreError",
  "TaskSystemRunAttemptTransactionReceiptV1",
  "TaskSystemRunAttemptTransactionV1",
  "TaskSystemRunAttemptTransientStoreError",
  "TaskSystemRunAttemptUnavailableError",
  "decodePersistedTaskRequestedEffectJsonV1",
  "decodeApplicationTaskRunAttemptAggregateJsonV1",
  "decodePersistedTaskRunAttemptAggregateJsonV1",
  "decodeTaskAttemptIdV1",
  "decodeTaskAttemptNumberV1",
  "decodeTaskDatabaseTimeMsV1",
  "decodeTaskExecutionFenceV1",
  "encodePersistedTaskRequestedEffectJsonV1",
  "encodeApplicationPersistedTaskRequestedEffectJsonV1",
  "encodeApplicationTaskRunAttemptAggregateJsonV1",
  "encodePersistedTaskRunAttemptAggregateJsonV1",
  "projectTaskRunAttemptPersistenceV1",
  "fromCurrentTaskRunAttemptAggregate",
  "projectApplicationTaskRunAttemptPersistenceV1",
  "toCurrentApplicationTaskRunAttemptDecision",
  "toCurrentLegacyTaskRunAttemptDecision",
  "toCurrentTaskRunAttemptAggregate",
]);
const admittedPersistenceTaskAttemptLifecycleGatewaySymbolsBySpecifier =
  new Map([
    ["@flarex/durable-task/internal/run-attempt-v1", new Set([
      "ApplicationCompleteAttemptOutcomeV1",
      "ApplicationHeartbeatAttemptOutcomeV1",
      "ApplicationTaskSystemRunAttemptInspectionSnapshotV1",
      "ApplicationTaskSystemRunAttemptStoreShape",
      "ApplicationTaskSystemRunAttemptTransactionReceiptV1",
      "ApplicationTaskSystemRunAttemptTransactionV1",
      "CompleteAttemptOutcomeV1",
      "HeartbeatAttemptOutcomeV1",
      "RunAttemptDecisionErrorV1",
      "TaskAttemptCompletionV1",
      "TaskHeartbeatSequenceV1",
      "TaskSystemRunAttemptInspectionSnapshotV1",
      "TaskSystemRunAttemptStoreErrorV1",
      "TaskSystemRunAttemptStoreShape",
      "TaskSystemRunAttemptTransactionReceiptV1",
      "TaskSystemRunAttemptTransactionV1",
      "decideApplicationCompleteAttemptV1",
      "decideApplicationHeartbeatAttemptV1",
      "decideCompleteAttemptV1",
      "decideHeartbeatAttemptV1",
      "decodeTaskAttemptCompletionV1",
      "decodeTaskHeartbeatSequenceV1",
    ])],
    ["@flarex/durable-task/internal/compute-provider-v1", new Set([
      "CurrentTaskComputeDispatchRequestV1",
      "validateCurrentTaskComputeDispatchRequestV1",
    ])],
  ]);
const admittedPersistenceTaskExternalEffectAuthoritySymbols = new Set([
  "ApplicationTaskComputeDispatchRequestV1",
  "validateApplicationTaskComputeDispatchRequestV1",
]);
const admittedPersistenceTaskLifecycleLedgerCorrelationSymbols = new Set([
  "ApplicationTaskRunAttemptAggregateV1",
  "CurrentPersistedTaskRequestedEffect",
  "CurrentTaskRunAttemptAggregate",
  "PersistedTaskRunAttemptAggregate",
  "PersistedTaskRequestedEffectV1",
  "TaskAttemptIdV1",
  "TaskAttemptNumberV1",
  "TaskExecutionFenceV1",
  "TaskRunAttemptAggregateV1",
  "TaskRunIdV1",
  "toCurrentTaskRequestedEffect",
  "toCurrentTaskRunAttemptAggregate",
]);
const admittedPersistenceTaskRunCreationSymbolsBySpecifier = new Map([
  ["@flarex/durable-task/internal/run-creation-v1", new Set([
    "InvalidTaskRunCreationRequestError",
    "InvalidTaskRunInitialAggregateError",
    "TaskInputSha256V1",
    "TaskRunCreationAuthoritySha256V1",
    "TaskRunCreationIdempotencyConflictError",
    "TaskRunCreationReceiptV1",
    "TaskRunCreationRequestKeySha256V1",
    "TaskRunCreationRequestSha256V1",
    "TaskRunCreationRequestV1",
    "decodeTaskRunCreationReceiptV1",
    "decodeTaskRunCreationRequestV1",
    "encodeTaskRunCreationRequestKeyPreimageV1",
    "encodeTaskRunCreationRequestPreimageV1",
    "makeTaskRunCreationInitialAggregateV1",
  ])],
  ["@flarex/durable-task/internal/run-attempt-v1", new Set([
    "TaskDatabaseTimeMsV1",
    "TaskDurationMsV1",
    "TaskRunIdV1",
    "decodeTaskDatabaseTimeMsV1",
    "decodeTaskDurationMsV1",
    "decodeTaskRunIdV1",
    "encodePersistedTaskRunAttemptAggregateJsonV1",
    "projectTaskRunAttemptPersistenceV1",
  ])],
]);
const admittedPersistenceTaskSystemRunRowSymbols = new Set([
  "ApplicationTaskRunAttemptAggregateV1",
  "TaskPersistenceCodecErrorV1",
  "TaskRunAttemptAggregateV1",
  "TaskSystemRunAttemptCorruptionError",
  "decodePersistedTaskRunAttemptAggregateJsonV1",
  "decodeApplicationTaskRunAttemptAggregateJsonV1",
  "encodePersistedTaskRunAttemptAggregateJsonV1",
  "encodeApplicationTaskRunAttemptAggregateJsonV1",
  "projectApplicationTaskRunAttemptPersistenceV1",
  "projectTaskRunAttemptPersistenceV1",
]);
const admittedPersistenceTaskSystemRequestedEffectRowSymbols = new Set([
  "ApplicationPersistedTaskRequestedEffectV1",
  "PersistedTaskRequestedEffectV1",
  "decodePersistedTaskRequestedEffectJsonV1",
  "decodeApplicationPersistedTaskRequestedEffectJsonV1",
  "encodePersistedTaskRequestedEffectJsonV1",
  "encodeApplicationPersistedTaskRequestedEffectJsonV1",
]);
const admittedPersistenceApplicationTaskRunCreationSymbolsBySpecifier =
  new Map([
    ["@flarex/durable-task/internal/run-creation-v1", new Set([
      "InvalidTaskRunInitialAggregateError",
      "ApplicationTaskRunCreationReceiptV1",
      "ApplicationTaskRunCreationRequestV1",
      "ApplicationTaskRuntimeTargetSha256V1",
      "TaskExecutionPrincipalSha256V1",
      "TaskInputSha256V1",
      "TaskRunCreationAuthoritySha256V1",
      "TaskRunCreationIdempotencyConflictError",
      "TaskRunCreationRequestKeySha256V1",
      "TaskRunCreationRequestSha256V1",
      "decodeApplicationTaskRunCreationReceiptV1",
      "decodeApplicationTaskRunCreationRequestV1",
      "encodeApplicationTaskRunCreationRequestPreimageV1",
      "encodeTaskRunCreationRequestKeyPreimageV1",
      "makeApplicationTaskRunCreationInitialAggregateV1",
    ])],
    ["@flarex/durable-task/internal/run-attempt-v1", new Set([
      "TaskDatabaseTimeMsV1",
      "TaskDurationMsV1",
      "TaskRunIdV1",
      "decodeTaskDatabaseTimeMsV1",
      "decodeTaskDurationMsV1",
      "decodeTaskRunIdV1",
      "encodeApplicationTaskRunAttemptAggregateJsonV1",
      "projectApplicationTaskRunAttemptPersistenceV1",
    ])],
  ]);
const admittedPersistenceTaskSystemRunReadSymbolsBySpecifier = new Map([
  ["@flarex/durable-task/internal/run-read-v1", new Set([
    "InvalidTaskSystemRunReadRequestError",
    "TaskDueDiscoveryCandidateV1",
    "TaskDueDiscoveryPageV1",
    "TaskDueDiscoveryRequestV1",
    "TaskRequestedEffectPageRequestV1",
    "TaskRequestedEffectPageV1",
    "decodeTaskDueDiscoveryRequestV1",
    "decodeTaskRequestedEffectPageRequestV1",
  ])],
  ["@flarex/durable-task/internal/run-attempt-v1", new Set([
    "TaskRequestedEffectPersistenceCursorV1",
    "TaskRunAttemptAggregateV1",
    "TaskRunIdV1",
    "decodeTaskDatabaseTimeMsV1",
    "decodeTaskRequestedEffectSequenceV1",
  ])],
]);
const admittedPersistenceTaskWakeSchedulerSymbolsBySpecifier = new Map([
  ["@flarex/durable-task/internal/run-attempt-v1", new Set([
    "RunAttemptLifecycleErrorV1",
    "makeRunAttemptLifecycleV1",
  ])],
  ["@flarex/durable-task/internal/scheduling-v1", new Set([
    "InvalidTaskWakeSchedulerConfigurationError",
    "TaskDueCandidateLifecycleContractError",
    "TaskRetryJitterSourceV1",
    "TaskWakeSchedulerOptionsV1",
    "TaskWakeSchedulerV1",
    "TaskWakeHintPublisherV1",
    "TaskWakeRequestedEffectV1",
    "makeRunAttemptDueCandidateHandlerV1",
    "makeWakePublishingRunAttemptDueCandidateHandlerV1",
    "makeTaskWakeSchedulerV1",
  ])],
]);
const admittedPersistenceTaskWakeSchedulerDirectorySymbolsBySpecifier =
  new Map([
    ["@flarex/durable-task/internal/scheduling-v1", new Set([
      "InvalidTaskWakeSchedulerConfigurationError",
    ])],
  ]);
const admittedPersistenceTaskWakeSchedulerRepairDirectorySymbolsBySpecifier =
  new Map([
    ["@flarex/durable-task/internal/run-read-v1", new Set([
      "decodeTaskDueDiscoveryRequestV1",
    ])],
  ]);
const admittedPersistenceTaskWakeSchedulerResolverSymbolsBySpecifier =
  new Map([
    ["@flarex/durable-task/internal/scheduling-v1", new Set([
      "InvalidTaskWakeSchedulerConfigurationError",
      "TaskWakeHintPublisherV1",
      "TaskWakeRequestedEffectV1",
    ])],
  ]);
const durableTaskAllowedExports = Object.freeze({
  "./internal/compute-provider-v1": "./src/computeProvider/v1.ts",
  "./internal/compute-provider-testing-v1": "./src/computeProvider/testing-v1.ts",
  "./internal/run-attempt-v1": "./src/runAttempt/v1.ts",
  "./internal/run-creation-v1": "./src/runCreation/v1.ts",
  "./internal/run-projection": "./src/runProjection/index.ts",
  "./internal/run-result-query": "./src/runResult/index.ts",
  "./internal/run-read-v1": "./src/runRead/v1.ts",
  "./internal/scheduling-v1": "./src/scheduling/v1.ts",
  "./internal/scheduling-testing-v1": "./src/scheduling/testing-v1.ts",
});
const expectedTargetPackage = "@flarex/durable-task";
const forbiddenDurableTaskPackages = new Set([
  "@prisma/client",
  "@redis/client",
  "@kubernetes/client-node",
  "bullmq",
  "dockerode",
  "ioredis",
  "prisma",
  "redis",
  "redlock",
]);
const ignoredDirectoryNames = new Set([".turbo", "node_modules"]);
const rootArtifactDirectoryNames = new Set([".wrangler", "build", "coverage", "dist"]);
const forbiddenInternalPackages = new Set([
  "@internal/cache",
  "@internal/compute",
  "@internal/metrics-pipeline",
  "@internal/redis",
  "@internal/run-engine",
  "@internal/run-ops-database",
  "@internal/run-store",
  "@internal/testcontainers",
  "@internal/tracing",
  "supervisor",
]);

if (isCliEntrypoint()) {
  const report = analyzeTriggerCompatibilityBoundary(
    discoverWorkspaceManifests(),
    discoverWorkspaceSources(),
  );
  const durableTaskRoot = path.join(repoRoot, "packages/durable-task");
  if (existsSync(durableTaskRoot)) {
    const durableTaskTsconfigPath = path.join(durableTaskRoot, "tsconfig.json");
    if (!existsSync(durableTaskTsconfigPath)) {
      report.errors.push("packages/durable-task/tsconfig.json is required after package admission.");
    } else {
      try {
        report.errors.push(...analyzeDurableTaskTsconfig(
          JSON.parse(readFileSync(durableTaskTsconfigPath, "utf8")),
        ));
      } catch (error) {
        report.errors.push(`packages/durable-task/tsconfig.json must be valid JSON: ${errorMessage(error)}.`);
      }
    }
  }

  if (report.errors.length > 0) {
    console.error(report.errors.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Trigger compatibility boundary check passed.");
  }
}

/**
 * @param {{ relativePath: string; manifest: unknown }[]} manifests
 * @param {{ relativePath: string; text: string }[]} sources
 */
export function analyzeTriggerCompatibilityBoundary(manifests, sources) {
  /** @type {string[]} */
  const errors = [];

  for (const { relativePath, manifest } of manifests) {
    if (!isRecord(manifest)) {
      errors.push(`${relativePath}: package manifest must be an object.`);
      continue;
    }

    for (const field of dependencyFields) {
      const dependencies = manifest[field];
      if (!isRecord(dependencies)) continue;

      for (const [name, value] of Object.entries(dependencies)) {
        if (isForbiddenModuleSpecifier(name) || (typeof value === "string" && isForbiddenDependencyReference(value))) {
          errors.push(`${relativePath}: ${field} must not reference Trigger compatibility dependency "${name}".`);
        }
        if (
          relativePath !== durableTaskManifestPath
          && (isDurableTaskPackageSpecifier(name)
            || (typeof value === "string" && isDurableTaskDependencyReference(value, relativePath)))
          && !isAdmittedDurableTaskConsumerDependency(
            relativePath,
            name,
            value,
          )
        ) {
          errors.push(`${relativePath}: ${field} must not activate @flarex/durable-task before host admission.`);
        }
      }
    }

    if (relativePath === durableTaskManifestPath) {
      errors.push(...analyzeDurableTaskManifest(manifest));
    }
  }

  for (const { relativePath, text } of sources) {
    const sourceFile = ts.createSourceFile(
      relativePath,
      text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(relativePath),
    );
    const admittedCompatibilityLocalBindings =
      collectAdmittedCompatibilityLocalBindings(sourceFile);

    visit(sourceFile);

    /** @param {ts.Node} node */
    function visit(node) {
      if (isLocalBindingReExport(node, admittedCompatibilityLocalBindings)) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not re-export an admitted compatibility binding beyond its owning file.`);
      }
      const specifier = moduleSpecifierForNode(node);
      if (specifier !== undefined && isForbiddenModuleSpecifier(specifier)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${relativePath}:${line} must not import Trigger compatibility module "${specifier}".`);
      }
      if (
        specifier !== undefined
        && relativePath.startsWith(durableTaskSourcePrefix)
        && isProductionSource(relativePath)
        && !isForbiddenModuleSpecifier(specifier)
        && !isDurableTaskCompatibilityHarnessSpecifier(specifier, relativePath)
        && !isAllowedDurableTaskProductionSpecifier(specifier, relativePath)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${relativePath}:${line} must not import non-portable durable-task module "${specifier}".`);
      }
      if (relativePath.startsWith(durableTaskSourcePrefix) && isProductionSource(relativePath)) {
        const prohibitedGlobal = prohibitedDurableTaskGlobalForNode(node);
        if (prohibitedGlobal !== undefined) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          errors.push(`${relativePath}:${line} must not use prohibited durable-task global "${prohibitedGlobal}".`);
        }
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isDurableTaskCompatibilityHarnessSpecifier(specifier, relativePath)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${relativePath}:${line} production source must not import durable-task compatibility harness "${specifier}".`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskAttemptLifecycleGatewaySpecifier(specifier, relativePath)
        && relativePath !== persistencePostgresTaskAttemptLifecycleGatewayPath
        && !(relativePath === flarexBackendTaskAttemptSupervisorPath
          && isTypeOnlyImportDeclaration(node))
        && !(relativePath === systemTestApplicationTaskSystemConnectedHarnessPath
          && hasExactNamedImportModes(
            node,
            admittedSystemTestConnectedHarnessLifecycleGatewayImports,
          ))
        && !matchesExactAdmittedImport(
          admittedLaterTaskAttemptLifecycleGatewayImports,
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task attempt lifecycle gateway before supervisor admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskExternalEffectAuthoritySpecifier(specifier, relativePath)
        && !(
          relativePath === standardApplicationTaskMutationAuthorityPath
          && hasExactNamedImportModes(
            node,
            admittedApplicationTaskMutationAuthorityExternalEffectImports,
          )
        )
        && !(
          relativePath === persistencePostgresPGlitePath
          && hasExactNamedImportModes(
            node,
            admittedPGliteTaskExternalEffectAuthorityImports,
          )
        )
        && !(
          relativePath ===
            persistencePostgresPostgresTaskExternalEffectAuthorityPath
          && hasExactNamedImportModes(
            node,
            admittedPostgresTaskExternalEffectAuthorityImports,
          )
        )
        && !(
          relativePath === systemTestApplicationTaskSystemConnectedHarnessPath
          && hasExactNamedImportModes(
            node,
            admittedSystemTestConnectedHarnessTaskExternalEffectAuthorityImports,
          )
        )
        && !matchesExactAdmittedImport(
          admittedLaterTaskExternalEffectAuthorityImports,
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task external-effect authority before mutation-host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskWakeSchedulerPartitionSpecifier(specifier, relativePath)
        && relativePath !== persistencePostgresTaskWakeSchedulerDirectoryPath
        && relativePath !== persistencePostgresTaskWakeSchedulerRepairDirectoryPath
        && relativePath !== persistencePostgresTaskWakeSchedulerResolverPath
        && relativePath !== persistencePostgresTaskWakeSchedulerCompositionPath
        && !matchesExactAdmittedImport(
          admittedLaterTaskWakeSchedulerPartitionImports,
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task wake scheduler partition before host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskWakeSchedulerRepairDirectorySpecifier(specifier, relativePath)
        && relativePath !== executorTaskRepairSweepPath
        && relativePath !== executorTaskRepairSweepContinuationCodecPath
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not consume the Task repair scheduler directory outside the admitted repair sweep.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskRepairSweepSpecifier(specifier, relativePath)
        && relativePath !== executorTaskRepairSchedulerRunPath
        && !(
          relativePath === executorTaskRepairSweepContinuationCodecPath
          && isTypeOnlyImportDeclaration(node)
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task repair sweep before scheduled-host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskRepairSchedulerRunSpecifier(specifier, relativePath)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the connected Task repair runner before scheduled-host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskWakeSchedulerDirectorySpecifier(specifier, relativePath)
        && relativePath !== persistencePostgresTaskWakeSchedulerRepairDirectoryPath
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task wake scheduler directory before host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskWakeSchedulerResolverSpecifier(specifier, relativePath)
        && relativePath !== executorTaskQueueWakePath
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not consume the Task wake scheduler resolver outside the admitted Queue adapter.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskQueueWakeAdapterSpecifier(specifier, relativePath)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task Queue wake adapter before Worker admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isTaskComputeDeliveryControlDirectorySpecifier(
          specifier,
          relativePath,
        )
        && !isAdmittedTaskComputeDeliveryControlDirectoryConsumer(
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task compute-delivery control directory before host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isFlarexBackendTaskComputeDeliverySpecifier(
          specifier,
          relativePath,
        )
        && !relativePath.startsWith(
          flarexBackendTaskComputeDeliverySourcePrefix,
        )
        && !isAdmittedFlarexBackendTaskComputeDeliveryConsumer(
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the connected Task compute-delivery runtime before host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isFlarexBackendTaskRuntimeLaunchSpecifier(specifier, relativePath)
        && !relativePath.startsWith(
          flarexBackendTaskRuntimeLaunchSourcePrefix,
        )
        && !isAdmittedFlarexBackendTaskRuntimeLaunchConsumer(
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task runtime launch authority before Worker Loader admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isFlarexBackendTaskExecutionPrincipalStoreSpecifier(
          specifier,
          relativePath,
        )
        && relativePath !== flarexBackendTaskExecutionPrincipalStorePath
        && !isAdmittedFlarexBackendTaskExecutionPrincipalStoreConsumer(
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not consume the Task execution principal store outside admitted issue and launch owners.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isFlarexBackendTaskResultStoreSpecifier(specifier, relativePath)
        && relativePath !== flarexBackendTaskResultStorePath
        && !(relativePath === flarexBackendTaskAttemptSupervisorPath
          && hasExactNamedImportModes(
            node,
            admittedTaskAttemptSupervisorResultStoreImports,
          ))
        && !(relativePath === systemTestApplicationTaskSystemConnectedHarnessPath
          && hasExactNamedImportModes(
            node,
            admittedSystemTestConnectedHarnessTaskResultImports,
          ))
        && !matchesExactAdmittedImport(
          admittedLaterTaskResultStoreImports,
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task result store before connected host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isFlarexBackendTaskRuntimeObjectStoreSpecifier(specifier, relativePath)
        && relativePath !== flarexBackendTaskRuntimeObjectStorePath
        && !matchesExactAdmittedImport(
          admittedLaterTaskRuntimeObjectStoreImports,
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task runtime object store before publication-host admission.`);
      }
      if (
        specifier !== undefined
        && isProductionSource(relativePath)
        && isFlarexBackendImmutableR2Specifier(specifier, relativePath)
        && relativePath !== flarexBackendTaskRuntimeObjectStorePath
        && relativePath !== flarexBackendTaskResultStorePath
        && relativePath !== flarexBackendTaskExecutionPrincipalStorePath
        && relativePath !== flarexBackendDeclarativeV2RuntimeArtifactStorePath
        && !matchesExactAdmittedImport(
          admittedLaterImmutableR2Imports,
          relativePath,
          specifier,
          node,
        )
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not consume the private immutable R2 mechanics outside admitted store adapters.`);
      }
      if (
        specifier !== undefined
        && !relativePath.startsWith(durableTaskSourcePrefix)
        && isProductionSource(relativePath)
        && isDurableTaskProductionSpecifier(specifier, relativePath)
        && !isAdmittedDurableTaskConsumerImport(relativePath, specifier, node)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate @flarex/durable-task before host admission.`);
      }
      ts.forEachChild(node, visit);
    }
  }

  return { errors };
}

/**
 * @param {ts.SourceFile} sourceFile
 * @returns {ReadonlySet<string>}
 */
function collectAdmittedCompatibilityLocalBindings(sourceFile) {
  const bindings = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || statement.moduleSpecifier === undefined
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || !isAdmittedCompatibilityImportForReExport(
        sourceFile.fileName,
        statement.moduleSpecifier.text,
        statement,
      )
    ) {
      continue;
    }
    const namedImports = statement.importClause?.namedBindings;
    if (namedImports !== undefined && ts.isNamedImports(namedImports)) {
      for (const element of namedImports.elements) bindings.add(element.name.text);
    }
  }
  return bindings;
}

/**
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function isAdmittedCompatibilityImportForReExport(
  relativePath,
  specifier,
  node,
) {
  if (isAdmittedDurableTaskConsumerImport(relativePath, specifier, node)) {
    return true;
  }
  if (
    isFlarexBackendTaskComputeDeliverySpecifier(specifier, relativePath)
    && isAdmittedFlarexBackendTaskComputeDeliveryConsumer(
      relativePath,
      specifier,
      node,
    )
  ) return true;
  if (
    isFlarexBackendTaskRuntimeLaunchSpecifier(specifier, relativePath)
    && isAdmittedFlarexBackendTaskRuntimeLaunchConsumer(
      relativePath,
      specifier,
      node,
    )
  ) return true;
  if (
    isFlarexBackendTaskExecutionPrincipalStoreSpecifier(
      specifier,
      relativePath,
    )
    && isAdmittedFlarexBackendTaskExecutionPrincipalStoreConsumer(
      relativePath,
      specifier,
      node,
    )
  ) return true;
  if (
    isTaskComputeDeliveryControlDirectorySpecifier(specifier, relativePath)
    && isAdmittedTaskComputeDeliveryControlDirectoryConsumer(
      relativePath,
      specifier,
      node,
    )
  ) return true;
  if (
    isTaskAttemptLifecycleGatewaySpecifier(specifier, relativePath)
    && (
      (relativePath === flarexBackendTaskAttemptSupervisorPath
        && isTypeOnlyImportDeclaration(node))
      || (relativePath === systemTestApplicationTaskSystemConnectedHarnessPath
        && hasExactNamedImportModes(
          node,
          admittedSystemTestConnectedHarnessLifecycleGatewayImports,
        ))
      || matchesExactAdmittedImport(
        admittedLaterTaskAttemptLifecycleGatewayImports,
        relativePath,
        specifier,
        node,
      )
    )
  ) return true;
  if (
    isTaskExternalEffectAuthoritySpecifier(specifier, relativePath)
    && (
      (relativePath === standardApplicationTaskMutationAuthorityPath
        && hasExactNamedImportModes(
          node,
          admittedApplicationTaskMutationAuthorityExternalEffectImports,
        ))
      || (relativePath === persistencePostgresPGlitePath
        && hasExactNamedImportModes(
          node,
          admittedPGliteTaskExternalEffectAuthorityImports,
        ))
      || (relativePath ===
          persistencePostgresPostgresTaskExternalEffectAuthorityPath
        && hasExactNamedImportModes(
          node,
          admittedPostgresTaskExternalEffectAuthorityImports,
        ))
      || (relativePath === systemTestApplicationTaskSystemConnectedHarnessPath
        && hasExactNamedImportModes(
          node,
          admittedSystemTestConnectedHarnessTaskExternalEffectAuthorityImports,
        ))
      || matchesExactAdmittedImport(
        admittedLaterTaskExternalEffectAuthorityImports,
        relativePath,
        specifier,
        node,
      )
    )
  ) return true;
  if (
    isFlarexBackendTaskResultStoreSpecifier(specifier, relativePath)
    && (
      (relativePath === flarexBackendTaskAttemptSupervisorPath
        && hasExactNamedImportModes(
          node,
          admittedTaskAttemptSupervisorResultStoreImports,
        ))
      || (relativePath === systemTestApplicationTaskSystemConnectedHarnessPath
        && hasExactNamedImportModes(
          node,
          admittedSystemTestConnectedHarnessTaskResultImports,
        ))
      || matchesExactAdmittedImport(
        admittedLaterTaskResultStoreImports,
        relativePath,
        specifier,
        node,
      )
    )
  ) return true;
  return [
    admittedLaterTaskRuntimeObjectStoreImports,
    admittedLaterImmutableR2Imports,
    admittedLaterTaskWakeSchedulerPartitionImports,
    admittedLaterPersistenceTaskImports,
  ].some(admissions =>
    matchesExactAdmittedImport(admissions, relativePath, specifier, node)
  );
}

/**
 * @param {ts.Node} node
 * @param {ReadonlySet<string>} importedBindings
 */
function isLocalBindingReExport(node, importedBindings) {
  if (
    ts.isExportDeclaration(node)
    && node.moduleSpecifier === undefined
    && node.exportClause !== undefined
    && ts.isNamedExports(node.exportClause)
  ) {
    return node.exportClause.elements.some((element) =>
      importedBindings.has(element.propertyName?.text ?? element.name.text)
    );
  }
  return ts.isExportAssignment(node)
    && !node.isExportEquals
    && ts.isIdentifier(node.expression)
    && importedBindings.has(node.expression.text);
}

/** @param {Readonly<Record<string, unknown>>} manifest */
export function analyzeDurableTaskManifest(manifest) {
  /** @type {string[]} */
  const errors = [];
  if (manifest.name !== expectedTargetPackage) {
    errors.push(`${durableTaskManifestPath}: name must be ${expectedTargetPackage}.`);
  }
  if (manifest.version !== "0.0.1") {
    errors.push(`${durableTaskManifestPath}: version must be 0.0.1 during the private vertical.`);
  }
  if (manifest.private !== true) {
    errors.push(`${durableTaskManifestPath}: private must remain true during the private vertical.`);
  }
  if (manifest.type !== "module") {
    errors.push(`${durableTaskManifestPath}: type must be module.`);
  }

  const exportsField = manifest.exports;
  if (
    !isRecord(exportsField)
    || !hasExactStringRecord(exportsField, durableTaskAllowedExports)
  ) {
    errors.push(
      `${durableTaskManifestPath}: exports must contain only the admitted compute-provider, compute-provider-testing, run-attempt, run-creation, run-projection, run-result-query, run-read, scheduling, and scheduling-testing internal subpaths.`,
    );
  }

  const dependencies = manifest.dependencies;
  if (
    !isRecord(dependencies)
    || Object.keys(dependencies).length !== 3
    || dependencies["@flarex/utils"] !== "workspace:*"
    || dependencies.effect !== "catalog:"
    || dependencies["flarex-protocol"] !== "workspace:*"
  ) {
    errors.push(`${durableTaskManifestPath}: runtime dependencies must contain only workspace @flarex/utils, root-catalog effect, and workspace flarex-protocol.`);
  }

  if (!hasExactStringRecord(manifest.scripts, {
    build: "tsc -p tsconfig.json",
    typecheck: "tsc -p tsconfig.json",
    test: "vitest run",
  })) {
    errors.push(`${durableTaskManifestPath}: scripts must exactly match the admitted build, typecheck, and test commands.`);
  }

  if (!hasExactStringRecord(manifest.devDependencies, {
    typescript: "catalog:",
    vitest: "catalog:",
  })) {
    errors.push(`${durableTaskManifestPath}: devDependencies must contain only root-catalog typescript and vitest.`);
  }

  for (const field of ["optionalDependencies", "peerDependencies"]) {
    const values = manifest[field];
    if (values !== undefined && (!isRecord(values) || Object.keys(values).length > 0)) {
      errors.push(`${durableTaskManifestPath}: ${field} must be absent or empty.`);
    }
  }

  for (const field of dependencyFields) {
    const values = manifest[field];
    if (!isRecord(values)) continue;
    for (const [name, value] of Object.entries(values)) {
      if (
        isForbiddenDurableTaskPackage(name)
        || (typeof value === "string" && isForbiddenDurableTaskDependencyReference(value))
      ) {
        errors.push(`${durableTaskManifestPath}: ${field} must not contain non-portable dependency "${name}".`);
      }
    }
  }

  const files = manifest.files;
  const expectedFiles = ["src", "THIRD_PARTY_NOTICES.md", "trigger-source-map.json", "licenses"];
  if (!Array.isArray(files) || JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    errors.push(`${durableTaskManifestPath}: files must exactly match the admitted distribution list.`);
  }
  return errors;
}

/** @param {unknown} tsconfig */
export function analyzeDurableTaskTsconfig(tsconfig) {
  const label = "packages/durable-task/tsconfig.json";
  if (!isRecord(tsconfig)) return [`${label} must be an object.`];
  /** @type {string[]} */
  const errors = [];
  if (!hasExactKeys(tsconfig, ["compilerOptions", "extends", "include"])) {
    errors.push(`${label} must contain only extends, compilerOptions, and include.`);
  }
  if (tsconfig.extends !== "../../tsconfig.base.json") {
    errors.push(`${label} must extend ../../tsconfig.base.json.`);
  }
  if (!Array.isArray(tsconfig.include) || JSON.stringify(tsconfig.include) !== JSON.stringify(["src", "test"])) {
    errors.push(`${label} include must exactly match src and test.`);
  }
  const compilerOptions = tsconfig.compilerOptions;
  if (!isRecord(compilerOptions)) {
    errors.push(`${label} compilerOptions must be an object.`);
    return errors;
  }
  if (!hasExactKeys(compilerOptions, ["lib", "noUncheckedIndexedAccess", "types"])) {
    errors.push(`${label} compilerOptions must contain only lib, types, and noUncheckedIndexedAccess.`);
  }
  if (!Array.isArray(compilerOptions.lib) || JSON.stringify(compilerOptions.lib) !== JSON.stringify(["ES2022"])) {
    errors.push(`${label} compilerOptions.lib must exactly match ES2022 without DOM.`);
  }
  if (!Array.isArray(compilerOptions.types) || compilerOptions.types.length !== 0) {
    errors.push(`${label} compilerOptions.types must be empty.`);
  }
  if (compilerOptions.noUncheckedIndexedAccess !== true) {
    errors.push(`${label} compilerOptions.noUncheckedIndexedAccess must be true.`);
  }
  return errors;
}

/** @returns {{ relativePath: string; manifest: unknown }[]} */
export function discoverWorkspaceManifests() {
  return [repoRoot, ...discoverWorkspaceDirectories()].map((directory) => {
    const manifestPath = path.join(directory, "package.json");
    return {
      relativePath: normalizePath(path.relative(repoRoot, manifestPath)),
      manifest: JSON.parse(readFileSync(manifestPath, "utf8")),
    };
  });
}

/** @returns {{ relativePath: string; text: string }[]} */
export function discoverWorkspaceSources() {
  const sourceRoots = [
    ...discoverWorkspaceDirectories(),
    path.join(repoRoot, "integration"),
    path.join(repoRoot, "scripts"),
  ].filter(existsSync);

  return sourceRoots.flatMap((directory) => {
    return collectFiles(directory).map((file) => ({
      relativePath: normalizePath(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
    }));
  });
}

/** @returns {string[]} */
function discoverWorkspaceDirectories() {
  return ["apps", "packages"].flatMap((workspaceRoot) => {
    const absoluteRoot = path.join(repoRoot, workspaceRoot);
    return readdirSync(absoluteRoot)
      .map((entry) => path.join(absoluteRoot, entry))
      .filter((entry) => lstatSync(entry).isDirectory() && existsSync(path.join(entry, "package.json")));
  });
}

/**
 * @param {string} directory
 * @param {string} [sourceRoot]
 * @returns {string[]}
 */
export function collectFiles(directory, sourceRoot = directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolutePath = path.join(directory, entry);
    const stats = lstatSync(absolutePath);
    if (stats.isDirectory()) {
      if (
        ignoredDirectoryNames.has(entry)
        || (directory === sourceRoot && rootArtifactDirectoryNames.has(entry))
      ) {
        return [];
      }
      return collectFiles(absolutePath, sourceRoot);
    }
    if (stats.isFile() && sourceExtensions.has(path.extname(absolutePath))) return [absolutePath];
    return [];
  });
}

/** @param {ts.Node} node */
function moduleSpecifierForNode(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) {
    return node.moduleReference.expression.text;
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
    return node.argument.literal.text;
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0 || !ts.isStringLiteralLike(node.arguments[0])) {
    return undefined;
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) {
    return node.arguments[0].text;
  }
  if (ts.isPropertyAccessExpression(node.expression)) {
    const owner = node.expression.expression;
    if ((ts.isIdentifier(owner) && owner.text === "module" && node.expression.name.text === "require") || (ts.isIdentifier(owner) && owner.text === "require" && node.expression.name.text === "resolve")) {
      return node.arguments[0].text;
    }
  }
  return undefined;
}

/** @param {string} specifier */
function isForbiddenModuleSpecifier(specifier) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  return normalized === "@trigger.dev" || normalized.startsWith("@trigger.dev/") || [...forbiddenInternalPackages].some((name) => normalized === name || normalized.startsWith(`${name}/`)) || normalized.includes("third_party/trigger.dev");
}

/** @param {string} reference */
function isForbiddenDependencyReference(reference) {
  const normalized = reference.replaceAll("\\", "/");
  const filePath = normalized.startsWith("file:") ? normalized.slice(5) : normalized;
  if (path.posix.normalize(filePath).includes("third_party/trigger.dev")) return true;

  let target = normalized;
  while (target.startsWith("npm:") || target.startsWith("workspace:")) {
    target = target.slice(target.indexOf(":") + 1);
  }

  return target === "@trigger.dev" || target.startsWith("@trigger.dev/") || [...forbiddenInternalPackages].some((name) => target === name || target.startsWith(`${name}@`) || target.startsWith(`${name}/`));
}

/** @param {string} specifier @param {string} relativePath */
function isAllowedDurableTaskProductionSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  if (normalized === "effect" || normalized.startsWith("effect/")) return true;
  if (normalized === "@flarex/utils/bytes") return true;
  if (normalized === "flarex-protocol/json") return true;
  if (normalized === "flarex-protocol/storage-authority") return true;
  return specifier.replaceAll("\\", "/").startsWith(".")
    && resolved.startsWith("packages/durable-task/src/")
    && !resolved.includes("/generated/prisma")
    && !resolved.includes("/.prisma/client");
}

/** @param {string} packageName */
function isForbiddenDurableTaskPackage(packageName) {
  return forbiddenDurableTaskPackages.has(packageName)
    || packageName.startsWith("@prisma/adapter-");
}

/** @param {string} reference */
function isForbiddenDurableTaskDependencyReference(reference) {
  const packageName = packageNameFromDependencyReference(reference);
  return packageName !== undefined && isForbiddenDurableTaskPackage(packageName);
}

/** @param {string} reference @param {string} manifestPath */
function isDurableTaskDependencyReference(reference, manifestPath) {
  if (packageNameFromDependencyReference(reference) === expectedTargetPackage) return true;
  let target = reference.replaceAll("\\", "/");
  while (target.startsWith("workspace:")) target = target.slice("workspace:".length);
  let localPathReference = false;
  if (target.startsWith("file:")) {
    localPathReference = true;
    target = target.slice("file:".length);
  } else if (target.startsWith("link:")) {
    localPathReference = true;
    target = target.slice("link:".length);
  }
  localPathReference ||= target.startsWith(".")
    || target.startsWith("/")
    || /^[A-Za-z]:\//.test(target)
    || target.toLowerCase().startsWith("packages/");
  if (!localPathReference) return false;
  const resolved = target.startsWith(".")
    ? path.posix.normalize(path.posix.join(path.posix.dirname(manifestPath), target))
    : path.posix.normalize(target);
  const comparable = resolved.toLowerCase();
  return comparable === "packages/durable-task"
    || comparable.startsWith("packages/durable-task/")
    || comparable.endsWith("/packages/durable-task")
    || comparable.includes("/packages/durable-task/");
}

/** @param {string} reference */
function packageNameFromDependencyReference(reference) {
  let target = reference.replaceAll("\\", "/");
  while (target.startsWith("npm:") || target.startsWith("workspace:")) {
    target = target.slice(target.indexOf(":") + 1);
  }
  if (target.startsWith("file:") || target.startsWith("link:") || target.startsWith(".")) {
    return undefined;
  }
  if (target.startsWith("@")) {
    const slash = target.indexOf("/");
    if (slash < 0) return target;
    const version = target.indexOf("@", slash + 1);
    return version < 0 ? target : target.slice(0, version);
  }
  const version = target.indexOf("@");
  const slash = target.indexOf("/");
  const end = [version, slash].filter((index) => index >= 0).sort((left, right) => left - right)[0];
  return end === undefined ? target : target.slice(0, end);
}

/** @param {string} relativePath */
function isProductionSource(relativePath) {
  if (!relativePath.startsWith("apps/") && !relativePath.startsWith("packages/")) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relativePath)) return false;
  if (relativePath.includes("/src/")) return true;
  return !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/.test(relativePath);
}

/** @param {string} specifier @param {string} relativePath */
function isDurableTaskCompatibilityHarnessSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return resolved.includes("integration/durable-task-compatibility")
    || resolved.includes("durable-task-compatibility/")
    || resolved.includes("packages/durable-task/test/compatibility");
}

/** @param {string} specifier @param {string} relativePath */
function isDurableTaskProductionSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return isDurableTaskPackageSpecifier(normalized)
    || resolved === "packages/durable-task"
    || resolved.startsWith("packages/durable-task/");
}

/** @param {string} specifier @param {string} relativePath */
function isTaskWakeSchedulerPartitionSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targetWithoutExtension =
    persistencePostgresTaskWakeSchedulerPartitionPath.slice(0, -3);
  return normalized === "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1"
    || resolved === persistencePostgresTaskWakeSchedulerPartitionPath
    || resolved === targetWithoutExtension
    || resolved === `${targetWithoutExtension}.js`;
}

/** @param {string} specifier @param {string} relativePath */
function isTaskAttemptLifecycleGatewaySpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targetWithoutExtension =
    persistencePostgresTaskAttemptLifecycleGatewayPath.slice(0, -3);
  return normalized ===
      "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway"
    || resolved === persistencePostgresTaskAttemptLifecycleGatewayPath
    || resolved === targetWithoutExtension
    || resolved === `${targetWithoutExtension}.js`;
}

/** @param {string} specifier @param {string} relativePath */
function isTaskExternalEffectAuthoritySpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targets = [
    persistencePostgresTaskExternalEffectAuthorityPath,
    persistencePostgresPostgresTaskExternalEffectAuthorityPath,
  ];
  return normalized ===
      "@flarex/persistence-postgres/internal/task-external-effect-authority"
    || normalized ===
      "@flarex/persistence-postgres/internal/system-test/postgres-task-external-effect-authority"
    || targets.some(target => {
      const targetWithoutExtension = target.slice(0, -3);
      return resolved === target
        || resolved === targetWithoutExtension
        || resolved === `${targetWithoutExtension}.js`;
    });
}

/** @param {ts.Node} node */
function isTypeOnlyImportDeclaration(node) {
  return ts.isImportDeclaration(node)
    && node.importClause !== undefined
    && node.importClause.isTypeOnly;
}

/** @param {string} specifier @param {string} relativePath */
function isTaskWakeSchedulerDirectorySpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targetWithoutExtension =
    persistencePostgresTaskWakeSchedulerDirectoryPath.slice(0, -3);
  return normalized === "@flarex/persistence-postgres/internal/task-wake-scheduler-directory-v1"
    || resolved === persistencePostgresTaskWakeSchedulerDirectoryPath
    || resolved === targetWithoutExtension
    || resolved === `${targetWithoutExtension}.js`;
}

/** @param {string} specifier @param {string} relativePath */
function isTaskWakeSchedulerRepairDirectorySpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targetWithoutExtension =
    persistencePostgresTaskWakeSchedulerRepairDirectoryPath.slice(0, -3);
  return normalized === "@flarex/persistence-postgres/internal/task-wake-scheduler-repair-directory-v1"
    || resolved === persistencePostgresTaskWakeSchedulerRepairDirectoryPath
    || resolved === targetWithoutExtension
    || resolved === `${targetWithoutExtension}.js`;
}

/** @param {string} specifier @param {string} relativePath */
function isTaskWakeSchedulerResolverSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targetWithoutExtension =
    persistencePostgresTaskWakeSchedulerResolverPath.slice(0, -3);
  return normalized === "@flarex/persistence-postgres/internal/task-wake-scheduler-resolver-v1"
    || resolved === persistencePostgresTaskWakeSchedulerResolverPath
    || resolved === targetWithoutExtension
    || resolved === `${targetWithoutExtension}.js`;
}

/** @param {string} specifier @param {string} relativePath */
function isTaskQueueWakeAdapterSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targetWithoutExtension = executorTaskQueueWakePath.slice(0, -3);
  return normalized === "@flarex/executor/internal/task-queue-wake-v1"
    || resolved === executorTaskQueueWakePath
    || resolved === targetWithoutExtension
    || resolved === `${targetWithoutExtension}.js`;
}

/** @param {string} specifier @param {string} relativePath */
function isTaskRepairSweepSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targetWithoutExtension = executorTaskRepairSweepPath.slice(0, -3);
  return normalized === "@flarex/executor/internal/task-repair-sweep-v1"
    || resolved === executorTaskRepairSweepPath
    || resolved === targetWithoutExtension
    || resolved === `${targetWithoutExtension}.js`;
}

/** @param {string} specifier @param {string} relativePath */
function isTaskRepairSchedulerRunSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targetWithoutExtension = executorTaskRepairSchedulerRunPath.slice(0, -3);
  return normalized === "@flarex/executor/internal/task-repair-scheduler-run-v1"
    || resolved === executorTaskRepairSchedulerRunPath
    || resolved === targetWithoutExtension
    || resolved === `${targetWithoutExtension}.js`;
}

/** @param {string} specifier @param {string} relativePath */
function isFlarexBackendTaskComputeDeliverySpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return normalized === "flarex-backend/internal/task-compute-delivery"
    || resolved.startsWith(flarexBackendTaskComputeDeliverySourcePrefix);
}

/** @param {string} relativePath @param {string} specifier @param {ts.Node} node */
function isAdmittedFlarexBackendTaskComputeDeliveryConsumer(
  relativePath,
  specifier,
  node,
) {
  if (matchesExactAdmittedImport(
    admittedLaterTaskComputeDeliveryImports,
    relativePath,
    specifier,
    node,
  )) return true;
  const expected = relativePath === standardApplicationTaskComputeDeliveryPath
    ? admittedApplicationTaskComputeDeliveryImports
    : relativePath === standardApplicationTaskMutationAuthorityPath
    ? admittedApplicationTaskMutationAuthorityComputeDeliveryImports
    : relativePath === systemTestApplicationTaskSystemConnectedHarnessPath
    ? admittedSystemTestConnectedHarnessTaskComputeImports
    : undefined;
  return expected !== undefined && hasExactNamedImportModes(node, expected);
}

/** @param {string} specifier @param {string} relativePath */
function isFlarexBackendTaskRuntimeLaunchSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return normalized === "flarex-backend/internal/task-runtime-launch"
    || resolved.startsWith(flarexBackendTaskRuntimeLaunchSourcePrefix);
}

/**
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function isAdmittedFlarexBackendTaskRuntimeLaunchConsumer(
  relativePath,
  specifier,
  node,
) {
  if (matchesExactAdmittedImport(
    admittedLaterTaskRuntimeLaunchImports,
    relativePath,
    specifier,
    node,
  )) return true;
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  if (relativePath === standardApplicationTaskComputeDeliveryPath) {
    return hasExactNamedImportModes(
      node,
      admittedApplicationTaskRuntimeLaunchImports,
    );
  }
  if (relativePath === standardApplicationTaskMutationAuthorityPath) {
    return hasExactNamedImportModes(
      node,
      admittedApplicationTaskMutationAuthorityLaunchImports,
    );
  }
  if (relativePath === systemTestApplicationTaskSystemConnectedHarnessPath) {
    return hasExactNamedImportModes(
      node,
      admittedSystemTestConnectedHarnessTaskRuntimeLaunchImports,
    );
  }
  if (relativePath === flarexBackendLegacyTaskWorkerDefinitionPath &&
    matchesRepositoryModule(resolved, flarexBackendTaskRuntimeLaunchModelPath)) {
    return hasExactNamedImportModes(node, admittedLegacyWorkerLaunchModelImports);
  }
  if (relativePath === flarexBackendApplicationTaskQueryCallbackPath &&
    matchesRepositoryModule(resolved, flarexBackendTaskRuntimeLaunchModelPath)) {
    return hasExactNamedImportModes(
      node,
      admittedApplicationTaskQueryCallbackLaunchModelImports,
    );
  }
  if (relativePath === flarexBackendApplicationTaskMutationCallbackPath &&
    matchesRepositoryModule(resolved, flarexBackendTaskRuntimeLaunchModelPath)) {
    return hasExactNamedImportModes(
      node,
      admittedApplicationTaskMutationCallbackLaunchModelImports,
    );
  }
  if (relativePath !== flarexBackendWorkerLoaderTaskComputeProviderPath) {
    return false;
  }
  if (matchesRepositoryModule(resolved, flarexBackendTaskRuntimeLaunchAuthorityPath)) {
    return hasExactNamedImportModes(
      node,
      admittedWorkerLoaderLaunchAuthorityImports,
    );
  }
  if (matchesRepositoryModule(resolved, flarexBackendTaskRuntimeLaunchModelPath)) {
    return hasExactNamedImportModes(node, admittedWorkerLoaderLaunchModelImports);
  }
  return false;
}

/** @param {ts.Node} node @param {Map<string, string>} expected */
function hasExactNamedImportModes(node, expected) {
  if (!ts.isImportDeclaration(node)) return false;
  const clause = node.importClause;
  if (clause === undefined || clause.name !== undefined ||
    clause.namedBindings === undefined ||
    !ts.isNamedImports(clause.namedBindings) ||
    clause.namedBindings.elements.length !== expected.size) {
    return false;
  }
  const importedNames = new Set();
  return clause.namedBindings.elements.every((element) => {
    const importedName = element.propertyName?.text ?? element.name.text;
    if (importedNames.has(importedName)) return false;
    importedNames.add(importedName);
    const mode = expected.get(importedName);
    const typeOnly = clause.isTypeOnly || element.isTypeOnly;
    return mode === (typeOnly ? "type" : "value");
  });
}

/**
 * @param {string} relativePath
 * @param {string} specifier
 * @param {{ values?: readonly string[]; types?: readonly string[] }} names
 */
function makeExactImportAdmission(relativePath, specifier, names) {
  /** @type {Map<string, "value" | "type">} */
  const expected = new Map();
  for (const name of names.values ?? []) expected.set(name, "value");
  for (const name of names.types ?? []) expected.set(name, "type");
  return Object.freeze({ relativePath, specifier, expected });
}

/**
 * @param {readonly ReturnType<typeof makeExactImportAdmission>[]} admissions
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function matchesExactAdmittedImport(
  admissions,
  relativePath,
  specifier,
  node,
) {
  return admissions.some(admission =>
    admission.relativePath === relativePath
    && admission.specifier === specifier
    && hasExactNamedImportModes(node, admission.expected)
  );
}

/** @param {string} specifier @param {string} relativePath */
function isFlarexBackendTaskRuntimeObjectStoreSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return normalized === "flarex-backend/internal/task-runtime-object-store"
    || matchesRepositoryModule(resolved, flarexBackendTaskRuntimeObjectStorePath);
}

/** @param {string} specifier @param {string} relativePath */
function isFlarexBackendTaskResultStoreSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return normalized === "flarex-backend/internal/task-result-store"
    || matchesRepositoryModule(resolved, flarexBackendTaskResultStorePath);
}

/** @param {string} specifier @param {string} relativePath */
function isFlarexBackendTaskExecutionPrincipalStoreSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return normalized === "flarex-backend/internal/task-execution-principal-store"
    || matchesRepositoryModule(
      resolved,
      flarexBackendTaskExecutionPrincipalStorePath,
    );
}

/**
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function isAdmittedFlarexBackendTaskExecutionPrincipalStoreConsumer(
  relativePath,
  specifier,
  node,
) {
  if (matchesExactAdmittedImport(
    admittedLaterTaskExecutionPrincipalStoreImports,
    relativePath,
    specifier,
    node,
  )) return true;
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const expected = relativePath === standardApplicationTaskSystemPath
    ? admittedApplicationTaskSystemPrincipalStoreImports
    : relativePath === systemTestApplicationTaskSystemConnectedHarnessPath
    ? admittedSystemTestConnectedHarnessPrincipalStoreImports
    : relativePath === flarexBackendTaskRuntimeLaunchAuthorityPath
      && matchesRepositoryModule(
        resolved,
        flarexBackendTaskExecutionPrincipalStorePath,
      )
    ? admittedTaskRuntimeLaunchAuthorityPrincipalStoreImports
    : undefined;
  return expected !== undefined && hasExactNamedImportModes(node, expected);
}

/** @param {string} specifier @param {string} relativePath */
function isFlarexBackendImmutableR2Specifier(specifier, relativePath) {
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return resolved.startsWith(flarexBackendImmutableR2SourcePrefix);
}

/** @param {string} specifier @param {string} relativePath */
function isTaskComputeDeliveryControlDirectorySpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  const targets = [
    persistencePostgresTaskComputeDeliveryControlDirectoryPath,
    persistencePostgresTaskComputeDeliveryControlDirectoryTargetPath,
    persistencePostgresTaskComputeDeliveryControlDirectoryTargetSystemTestPath,
    persistencePostgresPostgresTaskComputeDeliveryControlDirectoryPath,
  ];
  return normalized ===
      "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory"
    || normalized ===
      "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory"
    || normalized ===
      "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory"
    || targets.some((target) => {
      const withoutExtension = target.slice(0, -3);
      return resolved === target
        || resolved === withoutExtension
        || resolved === `${withoutExtension}.js`;
    });
}

/** @param {string} relativePath @param {string} specifier @param {ts.Node} node */
function isAdmittedTaskComputeDeliveryControlDirectoryConsumer(
  relativePath,
  specifier,
  node,
) {
  if (matchesExactAdmittedImport(
    admittedLaterTaskComputeDeliveryControlDirectoryImports,
    relativePath,
    specifier,
    node,
  )) return true;
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  if (relativePath === flarexBackendTaskComputeDeliveryTrustedDirectoryPath) {
    return normalized ===
        "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory"
      || matchesRepositoryModule(
        resolved,
        persistencePostgresTaskComputeDeliveryControlDirectoryPath,
      );
  }
  if (relativePath === systemTestApplicationTaskSystemConnectedHarnessPath) {
    return normalized ===
        "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory"
      ? hasExactNamedImportModes(
        node,
        admittedSystemTestConnectedHarnessControlTargetImports,
      )
      : normalized ===
          "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory"
      && hasExactNamedImportModes(
        node,
        admittedSystemTestConnectedHarnessControlFactoryImports,
      );
  }
  if (
    relativePath === persistencePostgresTaskComputeDeliveryControlDirectoryPath
    || relativePath ===
      persistencePostgresPostgresTaskComputeDeliveryControlDirectoryPath
    || relativePath === persistencePostgresPGlitePath
    || relativePath ===
      persistencePostgresTaskComputeDeliveryControlDirectoryTargetSystemTestPath
  ) {
    return matchesRepositoryModule(
      resolved,
      persistencePostgresTaskComputeDeliveryControlDirectoryTargetPath,
    );
  }
  return false;
}

/** @param {string} resolved @param {string} target */
function matchesRepositoryModule(resolved, target) {
  const withoutExtension = target.slice(0, -3);
  return resolved === target
    || resolved === withoutExtension
    || resolved === `${withoutExtension}.js`;
}

/** @param {string} specifier */
function isDurableTaskPackageSpecifier(specifier) {
  return specifier === expectedTargetPackage || specifier.startsWith(`${expectedTargetPackage}/`);
}

/**
 * DTE04-A2b through DTE04-B, the production-inert DTE06-C3 checkpoint, and
 * the private DTE07-C1 query checkpoint admit only the exact workspace
 * consumers below. These are
 * definition/schema/private-adapter ownership edges, not host activation.
 *
 * @param {string} relativePath
 * @param {string} name
 * @param {unknown} value
 */
function isAdmittedDurableTaskConsumerDependency(
  relativePath,
  name,
  value,
) {
  return (
    relativePath === standardApplicationDefinitionManifestPath
    || relativePath === standardApplicationInvocationManifestPath
    || relativePath === persistencePostgresManifestPath
    || relativePath === flarexBackendManifestPath
    || relativePath === systemTestManifestPath
  )
    && name === expectedTargetPackage
    && value === "workspace:*";
}

/**
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function isAdmittedDurableTaskConsumerImport(relativePath, specifier, node) {
  if (matchesExactAdmittedImport(
    admittedLaterDurableTaskImports,
    relativePath,
    specifier,
    node,
  )) return true;
  if (
    relativePath === standardApplicationTaskRunQueryPath
    && specifier === "@flarex/durable-task/internal/run-projection"
  ) {
    return hasExactNamedImportModes(
      node,
      admittedStandardApplicationTaskRunQueryImports,
    );
  }
  if (
    relativePath === standardApplicationTaskResultQueryPath
    && specifier === "@flarex/durable-task/internal/run-result-query"
  ) {
    return hasExactNamedImportModes(
      node,
      admittedStandardApplicationTaskResultQueryImports,
    );
  }
  if (
    relativePath === standardApplicationTaskCancellationPath
    && specifier === "@flarex/durable-task/internal/run-attempt-v1"
  ) {
    return hasExactNamedImportModes(
      node,
      admittedStandardApplicationTaskCancellationImports,
    );
  }
  if (
    relativePath === flarexBackendTaskResultBodyQueryPath
    && specifier === "@flarex/durable-task/internal/run-result-query"
  ) {
    return hasExactNamedImportModes(
      node,
      admittedBackendTaskResultBodyQueryImports,
    );
  }
  return isAdmittedStandardApplicationTaskDefinitionImport(
    relativePath,
    specifier,
    node,
  ) || isAdmittedPersistenceTaskImport(relativePath, specifier, node)
    || isAdmittedFlarexBackendTaskComputeDeliveryImport(
      relativePath,
      specifier,
      node,
    ) || isAdmittedSystemTestConnectedHarnessTaskImport(
      relativePath,
      specifier,
      node,
    );
}

/**
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function isAdmittedSystemTestConnectedHarnessTaskImport(
  relativePath,
  specifier,
  node,
) {
  if (relativePath !== systemTestApplicationTaskSystemConnectedHarnessPath) {
    return false;
  }
  const expected = specifier === "@flarex/durable-task/internal/run-attempt-v1"
    ? admittedSystemTestConnectedHarnessRunAttemptImports
    : specifier === "@flarex/durable-task/internal/run-creation-v1"
    ? admittedSystemTestConnectedHarnessRunCreationImports
    : undefined;
  return expected !== undefined && hasExactNamedImportModes(node, expected);
}

/**
 * DTE06-C3 admits only the private connected candidate runner as a host-neutral
 * consumer of the provider contract. It does not admit Worker, route, Queue,
 * cron, or public backend activation.
 *
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function isAdmittedFlarexBackendTaskComputeDeliveryImport(
  relativePath,
  specifier,
  node,
) {
  if (
    relativePath === flarexBackendApplicationTaskQueryCallbackPath &&
    specifier === "@flarex/durable-task/internal/compute-provider-v1"
  ) {
    return hasExactNamedImportModes(
      node,
      admittedApplicationTaskQueryCallbackComputeProviderImports,
    );
  }
  if (
    relativePath === flarexBackendApplicationTaskMutationCallbackPath &&
    specifier === "@flarex/durable-task/internal/compute-provider-v1"
  ) {
    return hasExactNamedImportModes(
      node,
      admittedApplicationTaskMutationCallbackComputeProviderImports,
    );
  }
  if (
    relativePath === flarexBackendTaskExecutionPrincipalStorePath
    && specifier === "@flarex/durable-task/internal/run-creation-v1"
    && ts.isImportDeclaration(node)
  ) {
    const clause = node.importClause;
    if (
      clause === undefined || clause.name !== undefined
      || clause.namedBindings === undefined
      || !ts.isNamedImports(clause.namedBindings)
      || clause.namedBindings.elements.length === 0
    ) return false;
    return clause.namedBindings.elements.every((element) => {
      const importedName = element.propertyName?.text ?? element.name.text;
      return admittedFlarexBackendTaskExecutionPrincipalStoreSymbols.has(
        importedName,
      );
    });
  }
  if (
    relativePath === flarexBackendTaskAttemptSupervisorPath
    && ts.isImportDeclaration(node)
  ) {
    const admittedSymbols = specifier ===
        "@flarex/durable-task/internal/run-attempt-v1"
      ? admittedFlarexBackendTaskAttemptSupervisorRunAttemptSymbols
      : specifier === "@flarex/durable-task/internal/compute-provider-v1"
      ? admittedFlarexBackendTaskAttemptSupervisorComputeProviderSymbols
      : undefined;
    const clause = node.importClause;
    if (
      admittedSymbols === undefined || clause === undefined
      || clause.name !== undefined || clause.namedBindings === undefined
      || !ts.isNamedImports(clause.namedBindings)
      || clause.namedBindings.elements.length === 0
    ) return false;
    return clause.namedBindings.elements.every((element) => {
      const importedName = element.propertyName?.text ?? element.name.text;
      return admittedSymbols.has(importedName);
    });
  }
  if (
    relativePath === flarexBackendTaskResultStorePath &&
    specifier === "@flarex/durable-task/internal/run-attempt-v1" &&
    ts.isImportDeclaration(node)
  ) {
    const clause = node.importClause;
    if (
      clause === undefined || clause.name !== undefined ||
      clause.namedBindings === undefined ||
      !ts.isNamedImports(clause.namedBindings) ||
      clause.namedBindings.elements.length === 0
    ) return false;
    return clause.namedBindings.elements.every((element) => {
      const importedName = element.propertyName?.text ?? element.name.text;
      return admittedFlarexBackendTaskResultStoreSymbols.has(importedName);
    });
  }
  if (
    relativePath === flarexBackendTaskWorkerTerminalCompletionPath &&
    specifier === "@flarex/durable-task/internal/run-attempt-v1" &&
    ts.isImportDeclaration(node)
  ) {
    const clause = node.importClause;
    if (
      clause === undefined || clause.name !== undefined ||
      clause.namedBindings === undefined ||
      !ts.isNamedImports(clause.namedBindings) ||
      clause.namedBindings.elements.length === 0
    ) return false;
    return clause.namedBindings.elements.every((element) => {
      const importedName = element.propertyName?.text ?? element.name.text;
      return admittedFlarexBackendTaskWorkerTerminalCompletionSymbols.has(
        importedName,
      );
    });
  }
  if (relativePath === flarexBackendTaskRuntimeLaunchModelPath ||
    relativePath === flarexBackendTaskRuntimeLaunchAuthorityPath) {
    const admittedSymbols = relativePath === flarexBackendTaskRuntimeLaunchModelPath
      ? admittedFlarexBackendTaskRuntimeLaunchSymbolsBySpecifier.get(specifier)
      : admittedFlarexBackendTaskRuntimeLaunchAuthoritySymbolsBySpecifier.get(
          specifier,
        );
    if (admittedSymbols === undefined || !ts.isImportDeclaration(node)) {
      return false;
    }
    const clause = node.importClause;
    if (
      clause === undefined || clause.name !== undefined
      || clause.namedBindings === undefined
      || !ts.isNamedImports(clause.namedBindings)
      || clause.namedBindings.elements.length === 0
    ) {
      return false;
    }
    return clause.namedBindings.elements.every((element) => {
      const importedName = element.propertyName?.text ?? element.name.text;
      return admittedSymbols.has(importedName);
    });
  }
  if (
    relativePath === flarexBackendWorkerLoaderTaskComputeProviderPath
    && specifier === "@flarex/durable-task/internal/compute-provider-v1"
    && ts.isImportDeclaration(node)
  ) {
    const clause = node.importClause;
    if (
      clause === undefined || clause.name !== undefined
      || clause.namedBindings === undefined
      || !ts.isNamedImports(clause.namedBindings)
      || clause.namedBindings.elements.length === 0
    ) {
      return false;
    }
    return clause.namedBindings.elements.every((element) => {
      const importedName = element.propertyName?.text ?? element.name.text;
      return admittedFlarexBackendWorkerLoaderProviderSymbols.has(importedName);
    });
  }
  if (
    relativePath !== flarexBackendTaskComputeDeliveryCandidateRunnerPath
    || specifier !== "@flarex/durable-task/internal/compute-provider-v1"
    || !ts.isImportDeclaration(node)
  ) {
    return false;
  }
  const clause = node.importClause;
  if (
    clause === undefined || clause.name !== undefined
    || clause.namedBindings === undefined
    || !ts.isNamedImports(clause.namedBindings)
    || clause.namedBindings.elements.length === 0
  ) {
    return false;
  }
  return clause.namedBindings.elements.every((element) => {
    const importedName = element.propertyName?.text ?? element.name.text;
    return admittedFlarexBackendTaskComputeDeliveryCandidateRunnerSymbols.has(
      importedName,
    );
  });
}

/**
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function isAdmittedStandardApplicationTaskDefinitionImport(
  relativePath,
  specifier,
  node,
) {
  if (
    !relativePath.startsWith(standardApplicationTaskDefinitionSourcePrefix)
    || specifier !== standardApplicationTaskDefinitionDurableTaskSpecifier
    || !ts.isImportDeclaration(node)
  ) {
    return false;
  }
  const clause = node.importClause;
  if (
    clause === undefined || clause.name !== undefined
    || clause.namedBindings === undefined
    || !ts.isNamedImports(clause.namedBindings)
    || clause.namedBindings.elements.length === 0
  ) {
    return false;
  }
  return clause.namedBindings.elements.every((element) => {
    const importedName = element.propertyName?.text ?? element.name.text;
    return admittedStandardApplicationDurableTaskSymbols.has(importedName);
  });
}

/**
 * @param {string} relativePath
 * @param {string} specifier
 * @param {ts.Node} node
 */
function isAdmittedPersistenceTaskImport(relativePath, specifier, node) {
  if (matchesExactAdmittedImport(
    admittedLaterPersistenceTaskImports,
    relativePath,
    specifier,
    node,
  )) return true;
  const admittedSymbols = relativePath === persistencePostgresSchemaPath
    ? admittedPersistenceDurableTaskSymbolsBySpecifier.get(specifier)
    : relativePath === persistencePostgresTaskRunAttemptStorePath
      && specifier === "@flarex/durable-task/internal/run-attempt-v1"
    ? admittedPersistenceTaskRunAttemptStoreSymbols
    : relativePath === persistencePostgresTaskAttemptLifecycleGatewayPath
    ? admittedPersistenceTaskAttemptLifecycleGatewaySymbolsBySpecifier.get(
      specifier,
    )
    : relativePath === persistencePostgresTaskExternalEffectAuthorityPath
      && specifier === "@flarex/durable-task/internal/compute-provider-v1"
    ? admittedPersistenceTaskExternalEffectAuthoritySymbols
    : relativePath === persistencePostgresTaskLifecycleLedgerCorrelationPath
      && specifier === "@flarex/durable-task/internal/run-attempt-v1"
    ? admittedPersistenceTaskLifecycleLedgerCorrelationSymbols
    : relativePath === persistencePostgresTaskRunCreationPath
      ? admittedPersistenceTaskRunCreationSymbolsBySpecifier.get(specifier)
    : relativePath === persistencePostgresApplicationTaskRunCreationPath
      ? admittedPersistenceApplicationTaskRunCreationSymbolsBySpecifier.get(
        specifier,
      )
    : relativePath === persistencePostgresTaskSystemRunRowPath
      && specifier === "@flarex/durable-task/internal/run-attempt-v1"
    ? admittedPersistenceTaskSystemRunRowSymbols
    : relativePath === persistencePostgresTaskSystemRequestedEffectRowPath
      && specifier === "@flarex/durable-task/internal/run-attempt-v1"
    ? admittedPersistenceTaskSystemRequestedEffectRowSymbols
    : relativePath === persistencePostgresTaskSystemRunReadPath
    ? admittedPersistenceTaskSystemRunReadSymbolsBySpecifier.get(specifier)
    : relativePath === persistencePostgresTaskComputeDeliveryEvidencePath
    ? admittedPersistenceTaskComputeDeliveryEvidenceSymbolsBySpecifier.get(
      specifier,
    )
    : relativePath === persistencePostgresTaskComputeDeliveryRepositoryPath
    ? admittedPersistenceTaskComputeDeliveryRepositorySymbolsBySpecifier.get(
      specifier,
    )
    : relativePath === persistencePostgresTaskComputeDeliveryDiscoveryPath
      && specifier === "@flarex/durable-task/internal/run-attempt-v1"
    ? admittedPersistenceTaskComputeDeliveryDiscoverySymbols
    : relativePath === persistencePostgresTaskWakeSchedulerPartitionPath
    ? admittedPersistenceTaskWakeSchedulerSymbolsBySpecifier.get(specifier)
    : relativePath === persistencePostgresTaskWakeSchedulerDirectoryPath
    ? admittedPersistenceTaskWakeSchedulerDirectorySymbolsBySpecifier.get(
      specifier,
    )
    : relativePath === persistencePostgresTaskWakeSchedulerRepairDirectoryPath
    ? admittedPersistenceTaskWakeSchedulerRepairDirectorySymbolsBySpecifier.get(
      specifier,
    )
    : relativePath === persistencePostgresTaskWakeSchedulerResolverPath
    ? admittedPersistenceTaskWakeSchedulerResolverSymbolsBySpecifier.get(
      specifier,
    )
    : undefined;
  if (
    admittedSymbols === undefined
    || !ts.isImportDeclaration(node)
  ) {
    return false;
  }
  const clause = node.importClause;
  if (
    clause === undefined || clause.name !== undefined
    || clause.namedBindings === undefined
    || !ts.isNamedImports(clause.namedBindings)
    || clause.namedBindings.elements.length === 0
  ) {
    return false;
  }
  return clause.namedBindings.elements.every((element) => {
    const importedName = element.propertyName?.text ?? element.name.text;
    return admittedSymbols.has(importedName);
  });
}

/** @param {string} specifier @param {string} relativePath */
function resolveRepositorySpecifier(specifier, relativePath) {
  const portable = specifier.replaceAll("\\", "/");
  if (!portable.startsWith(".")) return path.posix.normalize(portable);
  return path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), portable));
}

/** @param {ts.Node} node */
function prohibitedDurableTaskGlobalForNode(node) {
  const memberPath = normalizedGlobalMemberPath(node);
  if (memberPath?.length === 2 && memberPath[0] === "Date" && memberPath[1] === "now") {
    return "Date.now";
  }
  if (memberPath?.length === 2 && memberPath[0] === "Math" && memberPath[1] === "random") {
    return "Math.random";
  }
  for (const globalName of ["process", "fetch", "caches", "crypto", "performance"]) {
    if (
      memberPath?.length === 1
      && memberPath[0] === globalName
      && isGlobalReferenceNode(node)
    ) return globalName;
  }

  if (
    (ts.isNewExpression(node) || ts.isCallExpression(node))
    && isExactGlobalMember(node.expression, "Date")
    && (node.arguments === undefined || node.arguments.length === 0)
  ) {
    return ts.isNewExpression(node) ? "new Date()" : "Date()";
  }
  if (
    ts.isVariableDeclaration(node)
    && ts.isObjectBindingPattern(node.name)
    && node.initializer !== undefined
  ) {
    if (isExactGlobalMember(node.initializer, "Date") && bindingPatternSelects(node.name, "now")) {
      return "Date.now";
    }
    if (isExactGlobalMember(node.initializer, "Math") && bindingPatternSelects(node.name, "random")) {
      return "Math.random";
    }
  }
  return undefined;
}

/** @param {ts.Node} node @returns {string[] | undefined} */
function normalizedGlobalMemberPath(node) {
  const members = staticMemberPath(node);
  return members?.[0] === "globalThis" ? members.slice(1) : members;
}

/** @param {ts.Node} node @returns {string[] | undefined} */
function staticMemberPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const owner = staticMemberPath(node.expression);
    return owner === undefined ? undefined : [...owner, node.name.text];
  }
  if (
    ts.isElementAccessExpression(node)
    && node.argumentExpression !== undefined
    && ts.isStringLiteralLike(node.argumentExpression)
  ) {
    const owner = staticMemberPath(node.expression);
    return owner === undefined ? undefined : [...owner, node.argumentExpression.text];
  }
  return undefined;
}

/** @param {ts.Node} node @param {string} member */
function isExactGlobalMember(node, member) {
  const path = normalizedGlobalMemberPath(node);
  return path?.length === 1 && path[0] === member;
}

/** @param {ts.Node} node */
function isGlobalReferenceNode(node) {
  if (!ts.isIdentifier(node)) return true;
  if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) return false;
  if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return false;
  return true;
}

/** @param {ts.ObjectBindingPattern} pattern @param {string} member */
function bindingPatternSelects(pattern, member) {
  return pattern.elements.some((element) => {
    if (element.propertyName !== undefined) {
      return (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
        && element.propertyName.text === member;
    }
    return ts.isIdentifier(element.name) && element.name.text === member;
  });
}

/** @param {string} file */
function scriptKindForPath(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, unknown>>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {Readonly<Record<string, string>>} expected */
function hasExactStringRecord(value, expected) {
  if (!isRecord(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && value[key] === expected[key]);
}

/** @param {Readonly<Record<string, unknown>>} value @param {readonly string[]} expected */
function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} value */
function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function isCliEntrypoint() {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

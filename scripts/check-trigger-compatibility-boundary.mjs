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
const persistencePostgresManifestPath =
  "packages/persistence-postgres/package.json";
const flarexBackendManifestPath = "packages/flarex-backend/package.json";
const flarexBackendTaskComputeDeliveryCandidateRunnerPath =
  "packages/flarex-backend/src/taskComputeDelivery/CandidateRunner.ts";
const flarexBackendTaskComputeDeliverySourcePrefix =
  "packages/flarex-backend/src/taskComputeDelivery/";
const flarexBackendTaskRuntimeLaunchModelPath =
  "packages/flarex-backend/src/taskRuntimeLaunch/Model.ts";
const flarexBackendTaskRuntimeLaunchSourcePrefix =
  "packages/flarex-backend/src/taskRuntimeLaunch/";
const persistencePostgresSchemaPath =
  "packages/persistence-postgres/src/schema.ts";
const persistencePostgresTaskRunAttemptStorePath =
  "packages/persistence-postgres/src/taskSystemRunAttemptStoreV1.ts";
const persistencePostgresTaskLifecycleLedgerCorrelationPath =
  "packages/persistence-postgres/src/taskSystemLifecycleLedgerCorrelationV1.ts";
const persistencePostgresTaskRunCreationPath =
  "packages/persistence-postgres/src/taskSystemRunCreationV1.ts";
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
  ])],
  ["@flarex/durable-task/internal/run-creation-v1", new Set([
    "MAX_TASK_INPUT_CANONICAL_BYTES_V1",
    "TaskInputSha256V1",
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
      "TaskComputeDispatchAcceptanceV1",
      "TaskComputeDispatchRequestV1",
      "decodeTaskComputeCancellationReceiptV1",
      "decodeTaskComputeCancellationRequestV1",
      "decodeTaskComputeDispatchAcceptanceV1",
      "decodeTaskComputeDispatchRequestV1",
      "encodeTaskComputeCancellationReceiptV1",
      "encodeTaskComputeCancellationRequestV1",
      "encodeTaskComputeDispatchAcceptanceV1",
      "encodeTaskComputeDispatchRequestV1",
      "validateTaskComputeCancellationReceiptV1",
      "validateTaskComputeCancellationRequestV1",
      "validateTaskComputeDispatchAcceptanceV1",
      "validateTaskComputeDispatchRequestV1",
    ])],
    ["@flarex/durable-task/internal/run-creation-v1", new Set([
      "TaskInputReferenceV1",
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
      "validateTaskComputeCancellationReceiptV1",
      "validateTaskComputeCancellationRequestV1",
      "validateTaskComputeDispatchAcceptanceV1",
      "validateTaskComputeDispatchRequestV1",
    ])],
    ["@flarex/durable-task/internal/run-creation-v1", new Set([
      "TaskInputReferenceV1",
      "decodeTaskInputReferenceV1",
    ])],
    ["@flarex/durable-task/internal/run-attempt-v1", new Set([
      "PersistedTaskRequestedEffectV1",
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
    "TaskComputeDispatchRequestV1",
    "validateTaskComputeDispatchRequestV1",
  ])],
  ["@flarex/durable-task/internal/run-creation-v1", new Set([
    "TaskInputReferenceV1",
    "decodeTaskInputReferenceV1",
  ])],
]);
const admittedPersistenceTaskRunAttemptStoreSymbols = new Set([
  "InvalidRunAttemptTransitionError",
  "PersistedTaskRequestedEffectV1",
  "RunAttemptDecisionErrorV1",
  "RunAttemptOperationV1",
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
  "decodePersistedTaskRunAttemptAggregateJsonV1",
  "decodeTaskAttemptIdV1",
  "decodeTaskAttemptNumberV1",
  "decodeTaskDatabaseTimeMsV1",
  "decodeTaskExecutionFenceV1",
  "encodePersistedTaskRequestedEffectJsonV1",
  "encodePersistedTaskRunAttemptAggregateJsonV1",
  "projectTaskRunAttemptPersistenceV1",
]);
const admittedPersistenceTaskLifecycleLedgerCorrelationSymbols = new Set([
  "PersistedTaskRequestedEffectV1",
  "TaskAttemptIdV1",
  "TaskAttemptNumberV1",
  "TaskExecutionFenceV1",
  "TaskRunAttemptAggregateV1",
  "TaskRunIdV1",
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
  "TaskPersistenceCodecErrorV1",
  "TaskRunAttemptAggregateV1",
  "TaskSystemRunAttemptCorruptionError",
  "decodePersistedTaskRunAttemptAggregateJsonV1",
  "encodePersistedTaskRunAttemptAggregateJsonV1",
  "projectTaskRunAttemptPersistenceV1",
]);
const admittedPersistenceTaskSystemRequestedEffectRowSymbols = new Set([
  "PersistedTaskRequestedEffectV1",
  "decodePersistedTaskRequestedEffectJsonV1",
  "encodePersistedTaskRequestedEffectJsonV1",
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
    const admittedDurableTaskLocalBindings =
      collectAdmittedDurableTaskLocalBindings(sourceFile);

    visit(sourceFile);

    /** @param {ts.Node} node */
    function visit(node) {
      if (isLocalBindingReExport(node, admittedDurableTaskLocalBindings)) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not re-export admitted @flarex/durable-task bindings before host admission.`);
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
        && isTaskWakeSchedulerPartitionSpecifier(specifier, relativePath)
        && relativePath !== persistencePostgresTaskWakeSchedulerDirectoryPath
        && relativePath !== persistencePostgresTaskWakeSchedulerRepairDirectoryPath
        && relativePath !== persistencePostgresTaskWakeSchedulerResolverPath
        && relativePath !== persistencePostgresTaskWakeSchedulerCompositionPath
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
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(`${relativePath}:${line} production source must not activate the Task runtime launch authority before Worker Loader admission.`);
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
function collectAdmittedDurableTaskLocalBindings(sourceFile) {
  const bindings = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || statement.moduleSpecifier === undefined
      || !ts.isStringLiteralLike(statement.moduleSpecifier)
      || !isAdmittedDurableTaskConsumerImport(
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
      `${durableTaskManifestPath}: exports must contain only the admitted compute-provider, compute-provider-testing, run-attempt, run-creation, run-read, scheduling, and scheduling-testing internal subpaths.`,
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

/** @param {string} specifier @param {string} relativePath */
function isFlarexBackendTaskRuntimeLaunchSpecifier(specifier, relativePath) {
  const normalized = path.posix.normalize(specifier.replaceAll("\\", "/"));
  const resolved = resolveRepositorySpecifier(specifier, relativePath);
  return normalized === "flarex-backend/internal/task-runtime-launch"
    || resolved.startsWith(flarexBackendTaskRuntimeLaunchSourcePrefix);
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

/** @param {string} relativePath @param {string} specifier */
function isAdmittedTaskComputeDeliveryControlDirectoryConsumer(
  relativePath,
  specifier,
) {
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
 * DTE04-A2b through DTE04-B and the production-inert DTE06-C3 checkpoint admit
 * only the exact workspace consumers below. These are
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
    || relativePath === persistencePostgresManifestPath
    || relativePath === flarexBackendManifestPath
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
  return isAdmittedStandardApplicationTaskDefinitionImport(
    relativePath,
    specifier,
    node,
  ) || isAdmittedPersistenceTaskImport(relativePath, specifier, node)
    || isAdmittedFlarexBackendTaskComputeDeliveryImport(
      relativePath,
      specifier,
      node,
    );
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
  if (relativePath === flarexBackendTaskRuntimeLaunchModelPath) {
    const admittedSymbols =
      admittedFlarexBackendTaskRuntimeLaunchSymbolsBySpecifier.get(specifier);
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
  const admittedSymbols = relativePath === persistencePostgresSchemaPath
    ? admittedPersistenceDurableTaskSymbolsBySpecifier.get(specifier)
    : relativePath === persistencePostgresTaskRunAttemptStorePath
      && specifier === "@flarex/durable-task/internal/run-attempt-v1"
    ? admittedPersistenceTaskRunAttemptStoreSymbols
    : relativePath === persistencePostgresTaskLifecycleLedgerCorrelationPath
      && specifier === "@flarex/durable-task/internal/run-attempt-v1"
    ? admittedPersistenceTaskLifecycleLedgerCorrelationSymbols
    : relativePath === persistencePostgresTaskRunCreationPath
      ? admittedPersistenceTaskRunCreationSymbolsBySpecifier.get(specifier)
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

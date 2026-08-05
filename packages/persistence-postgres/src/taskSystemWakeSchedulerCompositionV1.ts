import type { ScopeId } from "flarex-protocol/storage-authority";

import type {
  ScopeClockTargetReaderResolver,
  ScopeMetadataReader,
  ScopeProvisioningReceiptReader,
  TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type {
  LocatedTaskSystemRunAttemptTargetV1,
} from "./taskSystemRunAttemptStoreV1";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import type {
  TaskSystemWakeSchedulerPartitionOptionsV1,
} from "./taskSystemWakeSchedulerPartitionV1";

export function captureTaskSystemWakeSchedulerAuthorityPortsV1(
  ports: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskSystemRunAttemptTargetV1
  >,
): TrustedScopeAuthorityResolutionPorts<LocatedTaskSystemRunAttemptTargetV1> {
  const scopeMetadataOwner = ports.scopeMetadata;
  const getScopeMetadataByDeploymentId =
    scopeMetadataOwner.getScopeMetadataByDeploymentId;
  const receiptOwner = ports.provisioningReceipts;
  const getScopeAuthorityProvisioningReceipt =
    receiptOwner.getScopeAuthorityProvisioningReceipt;
  const targetOwner = ports.scopeClockTargets;
  const resolve = targetOwner.resolve;
  const scopeMetadata: ScopeMetadataReader = Object.freeze({
    getScopeMetadataByDeploymentId: (deploymentId: string) =>
      getScopeMetadataByDeploymentId.call(scopeMetadataOwner, deploymentId),
  });
  const provisioningReceipts: ScopeProvisioningReceiptReader = Object.freeze({
    getScopeAuthorityProvisioningReceipt: (scopeId: ScopeId) =>
      getScopeAuthorityProvisioningReceipt.call(receiptOwner, scopeId),
  });
  const scopeClockTargets: ScopeClockTargetReaderResolver<
    LocatedTaskSystemRunAttemptTargetV1
  > = Object.freeze({
    resolve: (physicalLocator: ScopePhysicalLocator) =>
      resolve.call(targetOwner, physicalLocator),
  });
  return Object.freeze({
    scopeMetadata,
    provisioningReceipts,
    scopeClockTargets,
  });
}

export function captureTaskSystemWakeSchedulerPartitionOptionsV1(
  options: TaskSystemWakeSchedulerPartitionOptionsV1,
): TaskSystemWakeSchedulerPartitionOptionsV1 {
  const retryJitterOwner = options.retryJitter;
  const nextRetryJitterMethod = retryJitterOwner.nextRetryJitter;
  const nextRetryJitter: TaskSystemWakeSchedulerPartitionOptionsV1[
    "retryJitter"
  ]["nextRetryJitter"] = (runId) =>
    nextRetryJitterMethod.call(retryJitterOwner, runId);
  const runReadOwner = options.runRead;
  const observeQueryMethod = runReadOwner?.observeQuery;
  const observeQuery: NonNullable<
    TaskSystemWakeSchedulerPartitionOptionsV1["runRead"]
  >["observeQuery"] = runReadOwner === undefined
      || observeQueryMethod === undefined
    ? undefined
    : (observation) => observeQueryMethod.call(runReadOwner, observation);
  const runAttemptStoreOwner = options.runAttemptStore;
  const randomUuidMethod = runAttemptStoreOwner?.randomUuid;
  const randomUuid: NonNullable<
    TaskSystemWakeSchedulerPartitionOptionsV1["runAttemptStore"]
  >["randomUuid"] = runAttemptStoreOwner === undefined
      || randomUuidMethod === undefined
    ? undefined
    : () => randomUuidMethod.call(runAttemptStoreOwner);
  return Object.freeze({
    scheduler: Object.freeze({
      pageSize: options.scheduler.pageSize,
      maximumPages: options.scheduler.maximumPages,
      maximumCandidates: options.scheduler.maximumCandidates,
    }),
    retryJitter: Object.freeze({ nextRetryJitter }),
    ...(observeQuery === undefined
      ? {}
      : { runRead: Object.freeze({ observeQuery }) }),
    ...(randomUuid === undefined
      ? {}
      : { runAttemptStore: Object.freeze({ randomUuid }) }),
  });
}

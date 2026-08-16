import {
  captureTrustedScopeAuthorityResolutionPorts,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type {
  LocatedTaskSystemRunAttemptTargetV1,
} from "./taskSystemRunAttemptStoreV1";
import type {
  TaskSystemWakeSchedulerPartitionOptionsV1,
} from "./taskSystemWakeSchedulerPartitionV1";

export function captureTaskSystemWakeSchedulerAuthorityPortsV1(
  ports: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskSystemRunAttemptTargetV1
  >,
): TrustedScopeAuthorityResolutionPorts<LocatedTaskSystemRunAttemptTargetV1> {
  return captureTrustedScopeAuthorityResolutionPorts(ports);
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

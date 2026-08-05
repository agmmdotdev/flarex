import {
  makeRunAttemptLifecycleV1,
  type RunAttemptLifecycleErrorV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeRunAttemptDueCandidateHandlerV1,
  makeTaskWakeSchedulerV1,
  type InvalidTaskWakeSchedulerConfigurationError,
  type TaskDueCandidateLifecycleContractError,
  type TaskRetryJitterSourceV1,
  type TaskWakeSchedulerOptionsV1,
  type TaskWakeSchedulerV1,
} from "@flarex/durable-task/internal/scheduling-v1";
import type { Result } from "effect";

import type { LocatedTrustedScopeAuthority } from "./scopeAuthorityResolution";
import {
  makeTaskSystemRunAttemptStoreV1,
  type LocatedTaskSystemRunAttemptTargetV1,
  type TaskSystemRunAttemptStoreOptionsV1,
} from "./taskSystemRunAttemptStoreV1";
import {
  makeTaskSystemDueDiscoveryV1,
  type TaskSystemDueDiscoveryErrorV1,
  type TaskSystemRunReadOptionsV1,
} from "./taskSystemRunReadV1";

export type TaskSystemWakeSchedulerPartitionHandlerErrorV1 =
  | RunAttemptLifecycleErrorV1
  | TaskDueCandidateLifecycleContractError;

export type TaskSystemWakeSchedulerPartitionV1 = TaskWakeSchedulerV1<
  TaskSystemDueDiscoveryErrorV1,
  TaskSystemWakeSchedulerPartitionHandlerErrorV1
>;

export interface TaskSystemWakeSchedulerPartitionOptionsV1 {
  readonly scheduler: TaskWakeSchedulerOptionsV1;
  readonly retryJitter: TaskRetryJitterSourceV1;
  readonly runRead?: TaskSystemRunReadOptionsV1;
  readonly runAttemptStore?: TaskSystemRunAttemptStoreOptionsV1;
}

/**
 * Composes one production-inert scheduler over an already-resolved located
 * scope. The returned value cannot select or reveal another tenant scope.
 */
export function makeTaskSystemWakeSchedulerPartitionV1(
  located: LocatedTrustedScopeAuthority<LocatedTaskSystemRunAttemptTargetV1>,
  options: TaskSystemWakeSchedulerPartitionOptionsV1,
): Result.Result<
  TaskSystemWakeSchedulerPartitionV1,
  InvalidTaskWakeSchedulerConfigurationError
> {
  const schedulerOptions = options.scheduler;
  const retryJitter = options.retryJitter;
  const runReadOptions = options.runRead;
  const runAttemptStoreOptions = options.runAttemptStore;
  const source = makeTaskSystemDueDiscoveryV1(located, runReadOptions);
  const store = makeTaskSystemRunAttemptStoreV1(
    located,
    runAttemptStoreOptions,
  );
  const lifecycle = makeRunAttemptLifecycleV1(store);
  const handler = makeRunAttemptDueCandidateHandlerV1(
    lifecycle,
    retryJitter,
  );
  return makeTaskWakeSchedulerV1(source, handler, schedulerOptions);
}

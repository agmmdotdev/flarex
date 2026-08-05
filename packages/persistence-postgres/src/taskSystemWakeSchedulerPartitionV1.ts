import {
  makeRunAttemptLifecycleV1,
  type RunAttemptLifecycleErrorV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeRunAttemptDueCandidateHandlerV1,
  makeWakePublishingRunAttemptDueCandidateHandlerV1,
  makeTaskWakeSchedulerV1,
  type InvalidTaskWakeSchedulerConfigurationError,
  type TaskDueCandidateLifecycleContractError,
  type TaskRetryJitterSourceV1,
  type TaskWakeSchedulerOptionsV1,
  type TaskWakeSchedulerV1,
  type TaskWakeHintPublisherV1,
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

export type TaskSystemWakePublishingSchedulerPartitionHandlerErrorV1<
  PublishFailure,
> = TaskSystemWakeSchedulerPartitionHandlerErrorV1 | PublishFailure;

export type TaskSystemWakePublishingSchedulerPartitionV1<PublishFailure> =
  TaskWakeSchedulerV1<
    TaskSystemDueDiscoveryErrorV1,
    TaskSystemWakePublishingSchedulerPartitionHandlerErrorV1<PublishFailure>
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

/**
 * Constructs the same scope-bound scheduler and adds only post-settlement
 * publication of persisted retry and lease-expiry wake effects.
 */
export function makeTaskSystemWakePublishingSchedulerPartitionV1<
  PublishFailure,
>(
  located: LocatedTrustedScopeAuthority<LocatedTaskSystemRunAttemptTargetV1>,
  options: TaskSystemWakeSchedulerPartitionOptionsV1,
  publisher: TaskWakeHintPublisherV1<PublishFailure>,
): Result.Result<
  TaskSystemWakePublishingSchedulerPartitionV1<PublishFailure>,
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
  const handler = makeWakePublishingRunAttemptDueCandidateHandlerV1(
    lifecycle,
    retryJitter,
    publisher,
  );
  return makeTaskWakeSchedulerV1(source, handler, schedulerOptions);
}

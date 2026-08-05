import type {
  InvalidTaskWakeSchedulerConfigurationError,
  TaskWakeHintPublisherV1,
  TaskWakeRequestedEffectV1,
} from "@flarex/durable-task/internal/scheduling-v1";
import { Effect } from "effect";

import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  captureTaskSystemWakeSchedulerAuthorityPortsV1,
  captureTaskSystemWakeSchedulerPartitionOptionsV1,
} from "./taskSystemWakeSchedulerCompositionV1";
import type {
  LocatedTaskSystemRunAttemptTargetV1,
} from "./taskSystemRunAttemptStoreV1";
import {
  makeTaskSystemWakePublishingSchedulerPartitionV1,
  type TaskSystemWakePublishingSchedulerPartitionV1,
  type TaskSystemWakeSchedulerPartitionOptionsV1,
} from "./taskSystemWakeSchedulerPartitionV1";

export type {
  TaskSystemWakePublishingSchedulerPartitionV1,
} from "./taskSystemWakeSchedulerPartitionV1";

export type TaskSystemWakeSchedulerResolverErrorV1 =
  | TrustedScopeAuthorityError
  | InvalidTaskWakeSchedulerConfigurationError;

export interface TaskSystemWakeSchedulerResolverV1<PublishFailure> {
  readonly resolveEffect: (
    partitionHint: string,
    publisher: TaskWakeHintPublisherV1<PublishFailure>,
  ) => Effect.Effect<
    TaskSystemWakePublishingSchedulerPartitionV1<PublishFailure>,
    TaskSystemWakeSchedulerResolverErrorV1
  >;
}

export interface TaskSystemWakeSchedulerResolverOptionsV1 {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskSystemRunAttemptTargetV1
  >;
  readonly partition: TaskSystemWakeSchedulerPartitionOptionsV1;
}

/**
 * Resolves one opaque deployment hint against current control-plane and scope
 * authority before constructing an operation-local publishing scheduler.
 */
export function createTaskSystemWakeSchedulerResolverV1<PublishFailure>(
  options: TaskSystemWakeSchedulerResolverOptionsV1,
): TaskSystemWakeSchedulerResolverV1<PublishFailure> {
  const authority = captureTaskSystemWakeSchedulerAuthorityPortsV1(
    options.authority,
  );
  const partitionOptions = captureTaskSystemWakeSchedulerPartitionOptionsV1(
    options.partition,
  );
  const resolveCapturedEffect: TaskSystemWakeSchedulerResolverV1<
    PublishFailure
  >["resolveEffect"] = Effect.fn(
    "TaskSystemWakeSchedulerResolver.resolve",
  )(function* (partitionHint, publisher) {
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      partitionHint,
      authority,
    );
    return yield* Effect.fromResult(
      makeTaskSystemWakePublishingSchedulerPartitionV1(
        located,
        partitionOptions,
        publisher,
      ),
    );
  });
  const resolveEffect: TaskSystemWakeSchedulerResolverV1<
    PublishFailure
  >["resolveEffect"] = (partitionHint, publisher) => {
    const publisherOwner = publisher;
    const publish = publisherOwner.publish;
    return resolveCapturedEffect(
      partitionHint,
      Object.freeze({
        publish: (requested: TaskWakeRequestedEffectV1) =>
          publish.call(publisherOwner, requested),
      }),
    );
  };
  return Object.freeze({ resolveEffect });
}

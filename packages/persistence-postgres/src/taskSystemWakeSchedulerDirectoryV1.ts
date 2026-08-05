import type { InvalidTaskWakeSchedulerConfigurationError } from
  "@flarex/durable-task/internal/scheduling-v1";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  createReplacementScopeDirectoryDiscoveryV1,
  type ReplacementScopeDirectoryCandidateV1,
  type ReplacementScopeDirectoryContinuationV1,
  type ReplacementScopeDirectoryCorruptionReasonV1,
  type ReplacementScopeDirectoryInputReasonV1,
} from "./replacementScopeDirectoryDiscoveryV1";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type ScopeClockTargetReaderResolver,
  type ScopeMetadataReader,
  type ScopeProvisioningReceiptReader,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import type {
  LocatedTaskSystemRunAttemptTargetV1,
} from "./taskSystemRunAttemptStoreV1";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import {
  makeTaskSystemWakeSchedulerPartitionV1,
  type TaskSystemWakeSchedulerPartitionOptionsV1,
  type TaskSystemWakeSchedulerPartitionV1,
} from "./taskSystemWakeSchedulerPartitionV1";

export type TaskSystemWakeSchedulerDirectoryContinuationV1 =
  ReplacementScopeDirectoryContinuationV1;

export interface TaskSystemWakeSchedulerDirectoryPartitionV1 {
  readonly deploymentId: ReplacementScopeDirectoryCandidateV1["deploymentId"];
  readonly scopeId: ReplacementScopeDirectoryCandidateV1["scopeId"];
  readonly scheduler: TaskSystemWakeSchedulerPartitionV1;
}

export interface TaskSystemWakeSchedulerDirectoryPageV1 {
  readonly partitions:
    ReadonlyArray<TaskSystemWakeSchedulerDirectoryPartitionV1>;
  readonly continuation: TaskSystemWakeSchedulerDirectoryContinuationV1 | null;
}

export interface TaskSystemWakeSchedulerDirectoryV1 {
  readonly discoverEffect: (
    input: unknown,
  ) => Effect.Effect<
    TaskSystemWakeSchedulerDirectoryPageV1,
    TaskSystemWakeSchedulerDirectoryErrorV1
  >;
}

export interface TaskSystemWakeSchedulerDirectoryOptionsV1 {
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskSystemRunAttemptTargetV1
  >;
  readonly partition: TaskSystemWakeSchedulerPartitionOptionsV1;
}

export class TaskSystemWakeSchedulerDirectoryInputError
  extends Data.TaggedError("TaskSystemWakeSchedulerDirectoryInputError")<{
    readonly reason: ReplacementScopeDirectoryInputReasonV1;
    readonly cause?: unknown;
  }> {}

export class TaskSystemWakeSchedulerDirectoryCorruptionError
  extends Data.TaggedError("TaskSystemWakeSchedulerDirectoryCorruptionError")<{
    readonly reason: ReplacementScopeDirectoryCorruptionReasonV1;
    readonly cause?: unknown;
  }> {}

export class TaskSystemWakeSchedulerDirectorySqlError
  extends Data.TaggedError("TaskSystemWakeSchedulerDirectorySqlError")<{
    readonly operation: "discover";
    readonly cause: unknown;
  }> {}

export class TaskSystemWakeSchedulerDirectoryScopeError
  extends Data.TaggedError("TaskSystemWakeSchedulerDirectoryScopeError")<{
    readonly reason: "candidate_scope_mismatch";
  }> {}

export type TaskSystemWakeSchedulerDirectoryErrorV1 =
  | TaskSystemWakeSchedulerDirectoryInputError
  | TaskSystemWakeSchedulerDirectoryCorruptionError
  | TaskSystemWakeSchedulerDirectorySqlError
  | TaskSystemWakeSchedulerDirectoryScopeError
  | TrustedScopeAuthorityError
  | InvalidTaskWakeSchedulerConfigurationError;

/**
 * Discovers only inert replacement-scope hints, resolves each hint against
 * current control-plane authority, and returns freshly constructed C1
 * schedulers. No input can select a tenant scope or physical target.
 */
export function createTaskSystemWakeSchedulerDirectoryV1(
  controlDb: FlarexMetadataDatabase,
  options: TaskSystemWakeSchedulerDirectoryOptionsV1,
): TaskSystemWakeSchedulerDirectoryV1 {
  const authority = captureAuthorityPorts(options.authority);
  const partitionOptions = capturePartitionOptions(options.partition);
  const directory = createReplacementScopeDirectoryDiscoveryV1<
    string,
    | TaskSystemWakeSchedulerDirectoryInputError
    | TaskSystemWakeSchedulerDirectoryCorruptionError
    | TaskSystemWakeSchedulerDirectorySqlError
  >(controlDb, {
    operationName: "TaskSystemWakeSchedulerDirectory.discoverScopes",
    input: (reason, cause) => new TaskSystemWakeSchedulerDirectoryInputError({
      reason,
      ...(cause === undefined ? {} : { cause }),
    }),
    corruption: (reason, cause) =>
      new TaskSystemWakeSchedulerDirectoryCorruptionError({
        reason,
        ...(cause === undefined ? {} : { cause }),
      }),
    sql: (cause) => new TaskSystemWakeSchedulerDirectorySqlError({
      operation: "discover",
      cause,
    }),
    decodeDeploymentId: (value) =>
      isNonBlankString(value)
        ? Result.succeed(value)
        : Result.fail(new TaskSystemWakeSchedulerDirectoryCorruptionError({
          reason: "metadataInvalid",
        })),
  });

  const discoverEffect: TaskSystemWakeSchedulerDirectoryV1["discoverEffect"] =
    Effect.fn("TaskSystemWakeSchedulerDirectory.discover")(function* (input) {
      const page = yield* directory.discoverEffect(input);
      const partitions: TaskSystemWakeSchedulerDirectoryPartitionV1[] = [];
      for (const candidate of page.candidates) {
        const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
          candidate.deploymentId,
          authority,
        );
        if (located.authority.scopeId !== candidate.scopeId) {
          return yield* Effect.fail(
            new TaskSystemWakeSchedulerDirectoryScopeError({
              reason: "candidate_scope_mismatch",
            }),
          );
        }
        const scheduler = yield* Effect.fromResult(
          makeTaskSystemWakeSchedulerPartitionV1(located, partitionOptions),
        );
        partitions.push(Object.freeze({
          deploymentId: candidate.deploymentId,
          scopeId: candidate.scopeId,
          scheduler,
        }));
      }
      return Object.freeze({
        partitions: Object.freeze(partitions),
        continuation: page.continuation,
      });
    });

  return Object.freeze({ discoverEffect });
}

function captureAuthorityPorts(
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

function capturePartitionOptions(
  options: TaskSystemWakeSchedulerPartitionOptionsV1,
): TaskSystemWakeSchedulerPartitionOptionsV1 {
  const nextRetryJitter = options.retryJitter.nextRetryJitter;
  const observeQuery = options.runRead?.observeQuery;
  const randomUuid = options.runAttemptStore?.randomUuid;
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

import { isNonBlankString } from "@flarex/utils/strings";
import { Effect, Result } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import {
  createReplacementScopeDirectoryDiscoveryV1,
  type ReplacementScopeDirectoryCandidateV1,
  type ReplacementScopeDirectoryContinuationV1,
} from "./replacementScopeDirectoryDiscoveryV1";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
} from "./scopeAuthorityResolution";
import {
  captureTaskSystemWakeSchedulerAuthorityPortsV1,
  captureTaskSystemWakeSchedulerPartitionOptionsV1,
} from "./taskSystemWakeSchedulerCompositionV1";
import {
  makeTaskSystemWakeSchedulerPartitionV1,
  type TaskSystemWakeSchedulerPartitionV1,
} from "./taskSystemWakeSchedulerPartitionV1";
import {
  TaskSystemWakeSchedulerDirectoryCorruptionError,
  TaskSystemWakeSchedulerDirectoryInputError,
  type TaskSystemWakeSchedulerDirectoryOptionsV1,
  TaskSystemWakeSchedulerDirectorySqlError,
} from "./taskSystemWakeSchedulerDirectoryV1";

export type TaskSystemWakeSchedulerRepairDirectoryContinuationV1 =
  ReplacementScopeDirectoryContinuationV1;

export type TaskSystemWakeSchedulerRepairDirectoryCandidateFailureReasonV1 =
  | "authority_unavailable"
  | "candidate_scope_mismatch"
  | "scheduler_configuration_invalid";

export type TaskSystemWakeSchedulerRepairDirectoryItemV1 =
  | Readonly<{
      readonly kind: "ready";
      readonly deploymentId: string;
      readonly scopeId: ReplacementScopeDirectoryCandidateV1["scopeId"];
      readonly maximumPagesPerRun: number;
      readonly maximumCandidatesPerRun: number;
      readonly scheduler: TaskSystemWakeSchedulerPartitionV1;
    }>
  | Readonly<{
      readonly kind: "failed";
      readonly deploymentId: string;
      readonly scopeId: ReplacementScopeDirectoryCandidateV1["scopeId"];
      readonly reason:
        TaskSystemWakeSchedulerRepairDirectoryCandidateFailureReasonV1;
    }>;

export interface TaskSystemWakeSchedulerRepairDirectoryPageV1 {
  readonly items: ReadonlyArray<TaskSystemWakeSchedulerRepairDirectoryItemV1>;
  readonly continuation:
    | TaskSystemWakeSchedulerRepairDirectoryContinuationV1
    | null;
}

export type TaskSystemWakeSchedulerRepairDirectoryErrorV1 =
  | TaskSystemWakeSchedulerDirectoryInputError
  | TaskSystemWakeSchedulerDirectoryCorruptionError
  | TaskSystemWakeSchedulerDirectorySqlError;

export interface TaskSystemWakeSchedulerRepairDirectoryV1 {
  readonly discoverEffect: (
    input: unknown,
  ) => Effect.Effect<
    TaskSystemWakeSchedulerRepairDirectoryPageV1,
    TaskSystemWakeSchedulerRepairDirectoryErrorV1
  >;
}

/**
 * Repair-only view of the trusted scheduler directory. Page failures still
 * fail closed because there is no safe cursor to advance. A candidate-local
 * authority or construction failure is instead returned as inert evidence so
 * a scheduled repair cycle cannot starve every later scope.
 */
export function createTaskSystemWakeSchedulerRepairDirectoryV1(
  controlDb: FlarexMetadataDatabase,
  options: TaskSystemWakeSchedulerDirectoryOptionsV1,
): TaskSystemWakeSchedulerRepairDirectoryV1 {
  const authority = captureTaskSystemWakeSchedulerAuthorityPortsV1(
    options.authority,
  );
  const partition = captureTaskSystemWakeSchedulerPartitionOptionsV1(
    options.partition,
  );
  const directory = createReplacementScopeDirectoryDiscoveryV1<
    string,
    TaskSystemWakeSchedulerRepairDirectoryErrorV1
  >(controlDb, {
    operationName: "TaskSystemWakeSchedulerRepairDirectory.discoverScopes",
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

  const discoverEffect: TaskSystemWakeSchedulerRepairDirectoryV1[
    "discoverEffect"
  ] = Effect.fn("TaskSystemWakeSchedulerRepairDirectory.discover")(
    function* (input) {
      const page = yield* directory.discoverEffect(input);
      const items: TaskSystemWakeSchedulerRepairDirectoryItemV1[] = [];
      for (const candidate of page.candidates) {
        const located = yield* Effect.result(
          resolveLocatedTrustedScopeAuthorityEffect(
            candidate.deploymentId,
            authority,
          ),
        );
        if (Result.isFailure(located)) {
          items.push(failed(candidate, "authority_unavailable"));
          continue;
        }
        if (located.success.authority.scopeId !== candidate.scopeId) {
          items.push(failed(candidate, "candidate_scope_mismatch"));
          continue;
        }
        const scheduler = makeTaskSystemWakeSchedulerPartitionV1(
          located.success,
          partition,
        );
        if (Result.isFailure(scheduler)) {
          items.push(failed(candidate, "scheduler_configuration_invalid"));
          continue;
        }
        items.push(Object.freeze({
          kind: "ready",
          deploymentId: candidate.deploymentId,
          scopeId: candidate.scopeId,
          maximumPagesPerRun: partition.scheduler.maximumPages,
          maximumCandidatesPerRun: partition.scheduler.maximumCandidates,
          scheduler: scheduler.success,
        }));
      }
      return Object.freeze({
        items: Object.freeze(items),
        continuation: page.continuation,
      });
    },
  );

  return Object.freeze({ discoverEffect });
}

function failed(
  candidate: ReplacementScopeDirectoryCandidateV1,
  reason: TaskSystemWakeSchedulerRepairDirectoryCandidateFailureReasonV1,
): Extract<TaskSystemWakeSchedulerRepairDirectoryItemV1, { kind: "failed" }> {
  return Object.freeze({
    kind: "failed",
    deploymentId: candidate.deploymentId,
    scopeId: candidate.scopeId,
    reason,
  });
}

import { Data, Result } from "effect";

import {
  createTaskRepairPostgresDeadlinePolicyV1,
  type TaskRepairPostgresDeadlinePolicyInputV1,
  type TaskRepairPostgresDeadlinePolicyV1,
} from "./taskRepairPostgresDeadlinePolicyV1";
import type {
  RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

const CONTROL_DIRECTORY_TARGET = Symbol(
  "flarex.task_compute_delivery_control_directory_target",
);

export interface TaskComputeDeliveryControlDirectoryTarget {
  readonly kind: "task_compute_delivery_control_directory_target";
  readonly [CONTROL_DIRECTORY_TARGET]: true;
}

export interface CapturedTaskComputeDeliveryControlDirectoryTarget {
  readonly runReadCommitted: RunLocatedReadCommittedTransactionV1;
  readonly deadlinePolicy: TaskRepairPostgresDeadlinePolicyV1;
}

const TARGETS = new WeakMap<
  TaskComputeDeliveryControlDirectoryTarget,
  CapturedTaskComputeDeliveryControlDirectoryTarget
>();

export type TaskComputeDeliveryControlDirectoryConfigurationErrorReason =
  | "invalid_target"
  | "invalid_deadline_policy"
  | "invalid_pool_configuration";

export class TaskComputeDeliveryControlDirectoryConfigurationError<
  Reason extends TaskComputeDeliveryControlDirectoryConfigurationErrorReason =
    TaskComputeDeliveryControlDirectoryConfigurationErrorReason,
>
  extends Data.TaggedError(
    "TaskComputeDeliveryControlDirectoryConfigurationError",
  )<{
    readonly reason: Reason;
    readonly cause?: unknown;
  }> {}

export function captureTaskComputeDeliveryControlDirectoryTargetInternal(
  target: TaskComputeDeliveryControlDirectoryTarget,
): CapturedTaskComputeDeliveryControlDirectoryTarget | undefined {
  return TARGETS.get(target);
}

export function createTaskComputeDeliveryControlDirectoryTargetInternal(
  runReadCommitted: RunLocatedReadCommittedTransactionV1,
  deadlineInput: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<
  TaskComputeDeliveryControlDirectoryTarget,
  TaskComputeDeliveryControlDirectoryConfigurationError<
    "invalid_deadline_policy"
  >
> {
  return createTaskRepairPostgresDeadlinePolicyV1(deadlineInput).pipe(
    Result.mapError((cause) =>
      new TaskComputeDeliveryControlDirectoryConfigurationError({
        reason: "invalid_deadline_policy",
        cause,
      })
    ),
    Result.map((deadlinePolicy) =>
      createTaskComputeDeliveryControlDirectoryTargetFromPolicyInternal(
        runReadCommitted,
        deadlinePolicy,
      )
    ),
  );
}

export function createTaskComputeDeliveryControlDirectoryTargetFromPolicyInternal(
  runReadCommitted: RunLocatedReadCommittedTransactionV1,
  deadlinePolicy: TaskRepairPostgresDeadlinePolicyV1,
): TaskComputeDeliveryControlDirectoryTarget {
  const target = Object.freeze({
    kind: "task_compute_delivery_control_directory_target" as const,
    [CONTROL_DIRECTORY_TARGET]: true as const,
  });
  TARGETS.set(target, Object.freeze({
    runReadCommitted,
    deadlinePolicy,
  }));
  return target;
}

export const createTaskComputeDeliveryControlDirectoryTargetForSystemTest =
  createTaskComputeDeliveryControlDirectoryTargetInternal;

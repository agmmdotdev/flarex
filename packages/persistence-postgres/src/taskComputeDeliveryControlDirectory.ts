import { Result } from "effect";

import {
  createReplacementScopeDirectoryDiscoveryFromExecuteV1,
  type ReplacementScopeDirectoryDiscoveryV1,
  type ReplacementScopeDirectoryPolicyV1,
} from "./replacementScopeDirectoryDiscoveryV1";
import {
  configureTaskRepairPostgresTransactionDeadlinesV1,
} from "./taskRepairPostgresDeadlinePolicyV1";
import {
  captureTaskComputeDeliveryControlDirectoryTargetInternal,
  TaskComputeDeliveryControlDirectoryConfigurationError,
  type TaskComputeDeliveryControlDirectoryTarget,
} from "./taskComputeDeliveryControlDirectoryTarget";

export {
  TaskComputeDeliveryControlDirectoryConfigurationError,
  type TaskComputeDeliveryControlDirectoryTarget,
} from "./taskComputeDeliveryControlDirectoryTarget";

export interface TaskComputeDeliveryControlDirectory<DeploymentId, Failure>
  extends ReplacementScopeDirectoryDiscoveryV1<DeploymentId, Failure> {
  readonly settlementBudgetMilliseconds: number;
}

export function makeTaskComputeDeliveryControlDirectory<
  DeploymentId,
  Failure,
>(
  target: TaskComputeDeliveryControlDirectoryTarget,
  policy: ReplacementScopeDirectoryPolicyV1<DeploymentId, Failure>,
): Result.Result<
  TaskComputeDeliveryControlDirectory<DeploymentId, Failure>,
  TaskComputeDeliveryControlDirectoryConfigurationError<"invalid_target">
> {
  const captured = captureTaskComputeDeliveryControlDirectoryTargetInternal(
    target,
  );
  if (captured === undefined) {
    return Result.fail(
      new TaskComputeDeliveryControlDirectoryConfigurationError({
        reason: "invalid_target",
      }),
    );
  }
  const runReadCommitted = captured.runReadCommitted;
  const deadlinePolicy = captured.deadlinePolicy;
  const directory = createReplacementScopeDirectoryDiscoveryFromExecuteV1(
    (statement) => runReadCommitted(async (tx) => {
      await configureTaskRepairPostgresTransactionDeadlinesV1(
        tx,
        deadlinePolicy,
      );
      return tx.execute(statement);
    }),
    policy,
  );
  return Result.succeed(Object.freeze({
    settlementBudgetMilliseconds:
      deadlinePolicy.settlementReserveMilliseconds,
    discoverEffect: directory.discoverEffect,
  }));
}

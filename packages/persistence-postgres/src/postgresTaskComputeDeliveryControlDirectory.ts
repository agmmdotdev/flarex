import { Result } from "effect";
import { Pool, type PoolConfig } from "pg";

import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "./postgresLocatedReadCommitted";
import {
  createTaskComputeDeliveryControlDirectoryTargetFromPolicyInternal,
  TaskComputeDeliveryControlDirectoryConfigurationError,
  type TaskComputeDeliveryControlDirectoryTarget,
} from "./taskComputeDeliveryControlDirectoryTarget";
import {
  applyTaskRepairPostgresDeadlinePolicyV1,
  createTaskRepairPostgresDeadlinePolicyV1,
  type TaskRepairPostgresDeadlinePolicyInputV1,
} from "./taskRepairPostgresDeadlinePolicyV1";

export interface PostgresTaskComputeDeliveryControlDirectoryResource {
  readonly target: TaskComputeDeliveryControlDirectoryTarget;
  readonly pool: Pool;
  readonly close: () => Promise<void>;
}

/**
 * Private system-test composition. The caller owns `close`; a future admitted
 * host must wrap the resource in its own scoped Layer before activation.
 */
export function createPostgresTaskComputeDeliveryControlDirectoryResource(
  poolConfig: Readonly<PoolConfig>,
  deadlinePolicy: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<
  PostgresTaskComputeDeliveryControlDirectoryResource,
  TaskComputeDeliveryControlDirectoryConfigurationError<
    "invalid_deadline_policy" | "invalid_pool_configuration"
  >
> {
  return createTaskRepairPostgresDeadlinePolicyV1(deadlinePolicy).pipe(
    Result.mapError((cause) =>
      new TaskComputeDeliveryControlDirectoryConfigurationError({
        reason: "invalid_deadline_policy",
        cause,
      })
    ),
    Result.flatMap((capturedPolicy) =>
      applyTaskRepairPostgresDeadlinePolicyV1(
        poolConfig,
        capturedPolicy,
      ).pipe(
        Result.mapError((cause) =>
          new TaskComputeDeliveryControlDirectoryConfigurationError({
            reason: "invalid_pool_configuration",
            cause,
          })
        ),
        Result.flatMap((configured) => Result.try({
          try: () => {
            const pool = new Pool(configured);
            const runReadCommitted =
              createPostgresLocatedReadCommittedTransactionRunnerV1(pool);
            const target =
              createTaskComputeDeliveryControlDirectoryTargetFromPolicyInternal(
                runReadCommitted,
                capturedPolicy,
              );
            return Object.freeze({
              target,
              pool,
              close: () => pool.end(),
            });
          },
          catch: (cause) =>
            new TaskComputeDeliveryControlDirectoryConfigurationError({
              reason: "invalid_pool_configuration",
              cause,
            }),
        })),
      )
    ),
  );
}

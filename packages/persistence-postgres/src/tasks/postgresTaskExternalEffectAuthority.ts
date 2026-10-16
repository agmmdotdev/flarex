import { drizzle } from "drizzle-orm/node-postgres";
import { Result } from "effect";
import { Pool, type PoolConfig } from "pg";

import {
  createLocatedTaskExternalEffectAuthorityTargetFromPolicyInternal,
  TaskExternalEffectAuthorityConfigurationError,
  type LocatedTaskExternalEffectAuthorityTarget,
} from "./taskExternalEffectAuthority";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "../database/postgresLocatedReadCommitted";
import { flarexSchema } from "../database/schema";
import type { ScopePhysicalLocator } from "../scope/scopeMetadataTypes";
import {
  applyTaskRepairPostgresDeadlinePolicyV1,
  configureTaskRepairPostgresTransactionDeadlinesV1,
  createTaskRepairPostgresDeadlinePolicyV1,
  type TaskRepairPostgresDeadlinePolicyInputV1,
} from "./taskRepairPostgresDeadlinePolicyV1";
import { retainDeadlineOwnedTaskPersistenceTargetInternal,
  type DeadlineOwnedTaskPersistenceTarget } from "./taskPersistenceTransaction";
import { createLocatedTaskSystemRunAttemptTargetV1, type LocatedTaskSystemRunAttemptTargetV1 } from "./taskSystemRunAttemptStoreV1";

export interface PostgresTaskExternalEffectAuthorityResource {
  readonly target: LocatedTaskExternalEffectAuthorityTarget & DeadlineOwnedTaskPersistenceTarget;
  readonly lifecycleTarget: LocatedTaskSystemRunAttemptTargetV1 & DeadlineOwnedTaskPersistenceTarget;
  readonly pool: Pool;
  readonly close: () => Promise<void>;
}

/**
 * Creates one deadline-owned pool for a located Task external-effect target.
 * The caller owns `close`; the future host composition must place this resource
 * under its scope before production activation.
 */
export function createPostgresTaskExternalEffectAuthorityResource(
  poolConfig: Readonly<PoolConfig>,
  physicalLocator: ScopePhysicalLocator,
  deadlineInput: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<
  PostgresTaskExternalEffectAuthorityResource,
  TaskExternalEffectAuthorityConfigurationError<
    "invalid_deadline_policy" | "invalid_pool_configuration"
  >
> {
  return createTaskRepairPostgresDeadlinePolicyV1(deadlineInput).pipe(
    Result.mapError(cause =>
      new TaskExternalEffectAuthorityConfigurationError({
        reason: "invalid_deadline_policy",
        cause,
      })
    ),
    Result.flatMap(deadlinePolicy =>
      applyTaskRepairPostgresDeadlinePolicyV1(
        poolConfig,
        deadlinePolicy,
      ).pipe(
        Result.mapError(cause =>
          new TaskExternalEffectAuthorityConfigurationError({
            reason: "invalid_pool_configuration",
            cause,
          })
        ),
        Result.flatMap(configured => Result.try({
          try: () => {
            const pool = new Pool(configured);
            const db = drizzle(pool, { schema: flarexSchema });
            const runReadCommitted = createPostgresLocatedReadCommittedTransactionRunnerV1(pool);
            const target = retainDeadlineOwnedTaskPersistenceTargetInternal(
              createLocatedTaskExternalEffectAuthorityTargetFromPolicyInternal(
                db,
                physicalLocator,
                runReadCommitted,
                deadlinePolicy,
              ), deadlinePolicy, "postgres");
            const lifecycleTarget = retainDeadlineOwnedTaskPersistenceTargetInternal(
              createLocatedTaskSystemRunAttemptTargetV1(db, physicalLocator,
                work => runReadCommitted(async tx => {
                  await configureTaskRepairPostgresTransactionDeadlinesV1(tx, deadlinePolicy);
                  return work(tx);
                })), deadlinePolicy, "postgres");
            return Object.freeze({
              target,
              lifecycleTarget,
              pool,
              close: () => pool.end(),
            });
          },
          catch: cause =>
            new TaskExternalEffectAuthorityConfigurationError({
              reason: "invalid_pool_configuration",
              cause,
            }),
        })),
      )
    ),
  );
}

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
} from "./postgresLocatedReadCommitted";
import { flarexSchema } from "./schema";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import {
  applyTaskRepairPostgresDeadlinePolicyV1,
  createTaskRepairPostgresDeadlinePolicyV1,
  type TaskRepairPostgresDeadlinePolicyInputV1,
} from "./taskRepairPostgresDeadlinePolicyV1";

export interface PostgresTaskExternalEffectAuthorityResource {
  readonly target: LocatedTaskExternalEffectAuthorityTarget;
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
            const target =
              createLocatedTaskExternalEffectAuthorityTargetFromPolicyInternal(
                db,
                physicalLocator,
                createPostgresLocatedReadCommittedTransactionRunnerV1(pool),
                deadlinePolicy,
              );
            return Object.freeze({
              target,
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

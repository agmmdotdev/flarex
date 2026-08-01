import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import { Pool, type PoolConfig } from "pg";

import { defaultMigrationsFolder } from "./defaultMigrationsFolder";
import {
  createLocatedApplicationRevisionRegistrationTargetV1,
  type LocatedApplicationRevisionRegistrationTargetV1,
} from "./applicationRevisionRegistrationV1";
import {
  createLocatedApplicationRevisionReadinessTargetV1,
  type LocatedApplicationRevisionReadinessTargetV1,
} from "./applicationRevisionReadinessV1";
import {
  createLocatedApplicationRevisionActivationTargetV1,
  type LocatedApplicationRevisionActivationTargetV1,
} from "./applicationRevisionActivationV1";
import {
  createLocatedIndexBuildReconciliationTargetV1,
  type LocatedIndexBuildReconciliationTargetV1,
} from "./indexBuildReconciliation";
import type { FlarexPersistence } from "./index";
import {
  createSharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapperOptions,
} from "./scopeAuthorityBootstrap";
import {
  createSplitScopeAuthorityProvisioner,
  type SplitScopeAuthorityProvisioner,
  type SplitScopeAuthorityProvisionerOptions,
} from "./splitScopeAuthorityProvisioning";
import {
  createLocatedSplitScopeClockTarget,
  type LocatedSplitScopeClockTarget,
} from "./splitScopeClockTarget";
import {
  createLocatedScopeAuthorizationEpochTarget,
} from "./scopeAuthorizationEpochAuthority";
import {
  createLocatedPointMutationSessionActivationTargetV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
} from "./transactionSessionActivation";
import type { LocatedScopeClockReader } from "./scopeAuthorityResolution";
import {
  LOCATED_READ_COMMITTED_RUNNER_V1,
} from "./transactionSessionAttemptKernel";
import type {
  ScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "./scopeMetadataTypes";
import { createFlarexRuntimePersistence } from "./runtimePersistence";
import type { FlarexRuntimePersistenceTransaction } from "./runtimePersistence";
import {
  createPostgresSqlClient,
  runPostgresTransaction,
} from "./postgresRuntime";
import {
  createPostgresLocatedReadCommittedTransactionRunnerV1,
} from "./postgresLocatedReadCommitted";
import { flarexSchema } from "./schema";

export interface PostgresPersistenceOptions {
  pool?: Pool;
  poolConfig?: PoolConfig;
  connectionString?: string;
  migrationsFolder?: string;
  migrationsSchema?: string;
  migrationsTable?: string;
}

export interface PostgresFlarexPersistence extends FlarexPersistence {
  drizzle: NodePgDatabase<typeof flarexSchema>;
  pool: Pool;
  close(): Promise<void>;
}

export {
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresSharedScopeAuthorityPersistence,
} from "./postgresSharedScopeAuthority";

export function createPostgresSharedScopeAuthorityBootstrapper(
  persistence: Pick<PostgresFlarexPersistence, "drizzle">,
  options: SharedScopeAuthorityBootstrapperOptions,
): SharedScopeAuthorityBootstrapper {
  return createSharedScopeAuthorityBootstrapper(
    persistence.drizzle,
    options,
  );
}

export function createPostgresSplitScopeAuthorityProvisioner(
  persistence: Pick<PostgresFlarexPersistence, "drizzle">,
  options: SplitScopeAuthorityProvisionerOptions,
): SplitScopeAuthorityProvisioner {
  return createSplitScopeAuthorityProvisioner(
    persistence.drizzle,
    options,
  );
}

export function createPostgresLocatedSplitScopeClockTarget(
  persistence: Pick<PostgresFlarexPersistence, "drizzle">,
  physicalLocator: SplitScopePhysicalLocator,
): LocatedSplitScopeClockTarget {
  return createLocatedSplitScopeClockTarget(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPostgresLocatedScopeAuthorizationEpochTarget(
  persistence: Pick<PostgresFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedScopeClockReader {
  return createLocatedScopeAuthorizationEpochTarget(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPostgresLocatedPointMutationSessionActivationTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
  options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): LocatedScopeClockReader {
  return createLocatedPointMutationSessionActivationTargetV1(
    persistence.drizzle,
    physicalLocator,
    {
      ...options,
      [LOCATED_READ_COMMITTED_RUNNER_V1]:
        createPostgresLocatedReadCommittedTransactionRunnerV1(
          persistence.pool,
        ),
    },
  );
}

export function createPostgresLocatedApplicationRevisionRegistrationTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionRegistrationTargetV1 {
  return createLocatedApplicationRevisionRegistrationTargetV1(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
}

export function createPostgresLocatedApplicationRevisionReadinessTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionReadinessTargetV1 {
  return createLocatedApplicationRevisionReadinessTargetV1(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
}

export function createPostgresLocatedApplicationRevisionActivationTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationRevisionActivationTargetV1 {
  return createLocatedApplicationRevisionActivationTargetV1(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
}

export function createPostgresLocatedIndexBuildReconciliationTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedIndexBuildReconciliationTargetV1 {
  return createLocatedIndexBuildReconciliationTargetV1(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
}

export {
  InvalidSharedScopeAuthorityBootstrapBatchLimitError,
  InvalidSharedScopeAuthorityBootstrapFrontierError,
  MAX_SHARED_SCOPE_AUTHORITY_BOOTSTRAP_BATCH_SIZE,
  SharedScopeAuthorityBootstrapFrontierVersion,
  SharedScopeAuthorityParityRowError,
  type RunSharedScopeAuthorityBootstrapBatchInput,
  type RunSharedScopeAuthorityBootstrapBatchResult,
  type SharedScopeAuthorityBootstrapCursor,
  type SharedScopeAuthorityBootstrapFrontier,
  type SharedScopeAuthorityBootstrapItemResult,
  type SharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapperOptions,
  type SharedScopeAuthorityParityCounts,
  type SharedScopeAuthorityParityReport,
} from "./scopeAuthorityBootstrap";

export {
  InvalidGeneratedScopeAuthorityIdError,
  ScopeAuthorityIdGenerationExhaustedError,
  SharedScopeAuthorityConflictError,
  SharedScopeAuthorityProvisioningStatuses,
  UnsupportedScopeAuthorityProvisioningTopologyError,
  type EnsureSharedScopeAuthorityInput,
  type EnsureSharedScopeAuthorityResult,
  type SharedScopeAuthorityConflict,
  type SharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisionerOptions,
  type SharedScopeAuthorityProvisioningStatus,
} from "./scopeAuthorityProvisioning";

export {
  SplitScopeAuthorityConflictError,
  SplitScopeAuthorityPlacementPlanningError,
  SplitScopeAuthorityProvisioningStatuses,
  SplitScopeAuthorityTargetResolutionError,
  type EnsureSplitScopeAuthorityInput,
  type EnsureSplitScopeAuthorityResult,
  type SplitScopeAuthorityConflict,
  type SplitScopeAuthorityPlacementPlanner,
  type SplitScopeAuthorityProvisioner,
  type SplitScopeAuthorityProvisionerOptions,
  type SplitScopeAuthorityTargetResolutionConflict,
  type SplitScopeClockTargetResolver,
} from "./splitScopeAuthorityProvisioning";

export {
  EnsureSplitScopeInitialClockStatuses,
  SplitScopeInitialClockConflictError,
  type EnsureSplitScopeInitialClockInput,
  type EnsureSplitScopeInitialClockResult,
  type LocatedSplitScopeClockTarget,
} from "./splitScopeClockTarget";

export async function createPostgresPersistence(
  options: PostgresPersistenceOptions = {},
): Promise<PostgresFlarexPersistence> {
  const ownsPool = options.pool === undefined;
  const pool =
    options.pool ??
    new Pool({
      ...(options.connectionString === undefined
        ? {}
        : { connectionString: options.connectionString }),
      ...options.poolConfig,
    });
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder();
  const drizzleDb = drizzle(pool, { schema: flarexSchema });
  const runtime = createFlarexRuntimePersistence({
    drizzle: drizzleDb,
    sql: createPostgresSqlClient(drizzleDb, pool),
    appTableDefinitionsArtifactRepository: {
      db: drizzleDb,
      runTransaction: (run) => drizzleDb.transaction(run),
    },
    appSchemaPublicationRepository: {
      db: drizzleDb,
      runTransaction: (run) => drizzleDb.transaction(run),
    },
    async transaction<T>(
      run: (transaction: FlarexRuntimePersistenceTransaction) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      let rollbackError: Error | undefined;
      try {
        return await runPostgresTransaction(
          client,
          drizzle(client, { schema: flarexSchema }),
          run,
          {
            onRollbackError: (error) => {
              rollbackError =
                error instanceof Error
                  ? error
                  : new Error("Postgres transaction rollback failed.", {
                      cause: error,
                    });
            },
          },
        );
      } finally {
        client.release(rollbackError);
      }
    },
  });

  return {
    ...runtime,
    drizzle: drizzleDb,
    pool,
    async migrate(): Promise<void> {
      await migrateNodePg(drizzleDb, {
        migrationsFolder,
        ...(options.migrationsSchema === undefined
          ? {}
          : { migrationsSchema: options.migrationsSchema }),
        ...(options.migrationsTable === undefined
          ? {}
          : { migrationsTable: options.migrationsTable }),
      });
    },

    async close(): Promise<void> {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}

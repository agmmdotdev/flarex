import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";
import { Result } from "effect";

import { defaultMigrationsFolder } from "./defaultMigrationsFolder";
import {
  createLocatedApplicationActionAuthorityTargetV1,
  type LocatedApplicationActionAuthorityTargetV1,
} from "./applicationActionAuthorityV1";
import {
  createLocatedIndexBuildReconciliationTargetV1,
  type LocatedIndexBuildReconciliationTargetV1,
} from "./indexBuildReconciliation";
import type {
  FlarexPersistence,
  FlarexSqlClient,
  QueryResult,
} from "./index";
import {
  createSharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapperOptions,
} from "./scopeAuthorityBootstrap";
import {
  createSharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisionerOptions,
} from "./scopeAuthorityProvisioning";
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
  createLocatedRetainedHistoryFloorTargetInternal,
  type LocatedRetainedHistoryFloorTarget,
} from "./retainedHistoryFloorObservation";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
  createLocatedPointMutationSessionActivationTargetV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
} from "./transactionSessionActivation";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  type LocatedTaskSystemRunAttemptTargetV1,
} from "./taskSystemRunAttemptStoreV1";
import {
  createTaskComputeDeliveryControlDirectoryTargetInternal,
  type TaskComputeDeliveryControlDirectoryConfigurationError,
  type TaskComputeDeliveryControlDirectoryTarget,
} from "./taskComputeDeliveryControlDirectoryTarget";
import {
  type TaskRepairPostgresDeadlinePolicyInputV1,
} from "./taskRepairPostgresDeadlinePolicyV1";
import type { LocatedScopeClockReader } from "./scopeAuthorityResolution";
import type {
  ScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "./scopeMetadataTypes";
import {
  createFlarexRuntimePersistence,
  rowsFromDriver,
} from "./runtimePersistence";
import {
  createFlarexRuntimePersistenceTransaction,
} from "./runtimePersistenceTransaction";
import { flarexSchema } from "./schema";

export {
  makeTaskSystemRunAttemptStoreV1,
  type TaskSystemRunAttemptStoreOptionsV1,
} from "./taskSystemRunAttemptStoreV1";

type PGliteLike = {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
  transaction<T>(fn: (tx: PGliteTransactionLike) => Promise<T>): Promise<T>;
};

type PGliteTransactionLike = {
  exec(sql: string): Promise<unknown>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
};

export interface PGlitePersistenceOptions {
  dataDir?: string;
  db?: PGliteLike;
  migrationsFolder?: string;
}

export interface PGliteFlarexPersistence extends FlarexPersistence {
  drizzle: PgliteDatabase<typeof flarexSchema>;
}

export function createPGliteSharedScopeAuthorityProvisioner(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  options: SharedScopeAuthorityProvisionerOptions,
): SharedScopeAuthorityProvisioner {
  return createSharedScopeAuthorityProvisioner(
    persistence.drizzle,
    options,
  );
}

export function createPGliteSharedScopeAuthorityBootstrapper(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  options: SharedScopeAuthorityBootstrapperOptions,
): SharedScopeAuthorityBootstrapper {
  return createSharedScopeAuthorityBootstrapper(
    persistence.drizzle,
    options,
  );
}

export function createPGliteSplitScopeAuthorityProvisioner(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  options: SplitScopeAuthorityProvisionerOptions,
): SplitScopeAuthorityProvisioner {
  return createSplitScopeAuthorityProvisioner(
    persistence.drizzle,
    options,
  );
}

export function createPGliteLocatedSplitScopeClockTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: SplitScopePhysicalLocator,
): LocatedSplitScopeClockTarget {
  return createLocatedSplitScopeClockTarget(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPGliteLocatedScopeAuthorizationEpochTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedScopeClockReader {
  return createLocatedScopeAuthorizationEpochTarget(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPGliteLocatedPointMutationSessionActivationTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
  options: LocatedPointMutationSessionActivationTargetOptionsV1 = {},
): LocatedScopeClockReader {
  return createLocatedPointMutationSessionActivationTargetV1(
    persistence.drizzle,
    physicalLocator,
    options,
  );
}

export function createPGliteLocatedRetainedHistoryFloorTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedRetainedHistoryFloorTarget {
  return createLocatedRetainedHistoryFloorTargetInternal(
    persistence.drizzle,
    physicalLocator,
    createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    ),
  );
}

export function createPGliteLocatedTaskSystemRunAttemptTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedTaskSystemRunAttemptTargetV1 {
  return createLocatedTaskSystemRunAttemptTargetV1(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPGliteTaskComputeDeliveryControlDirectoryTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  deadlineInput: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<
  TaskComputeDeliveryControlDirectoryTarget,
  TaskComputeDeliveryControlDirectoryConfigurationError<
    "invalid_deadline_policy"
  >
> {
  return createTaskComputeDeliveryControlDirectoryTargetInternal(
    createDefaultLocatedReadCommittedTransactionRunnerV1(
      persistence.drizzle,
    ),
    deadlineInput,
  );
}

export function createPGliteLocatedApplicationActionAuthorityTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationActionAuthorityTargetV1 {
  return createLocatedApplicationActionAuthorityTargetV1(
    persistence.drizzle,
    physicalLocator,
  );
}

export function createPGliteLocatedIndexBuildReconciliationTargetV1(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
): LocatedIndexBuildReconciliationTargetV1 {
  return createLocatedIndexBuildReconciliationTargetV1(
    persistence.drizzle,
    physicalLocator,
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

export async function createPGlitePersistence(
  options: PGlitePersistenceOptions = {},
): Promise<PGliteFlarexPersistence> {
  const db: PGliteLike = options.db ?? new PGlite(options.dataDir);
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder();
  const drizzleDb = drizzle({
    // SAFETY: Drizzle types its PGlite driver client as the concrete PGlite
    // class; PGliteLike implements the exec/query protocol drizzle actually calls.
    client: db as PGlite,
    schema: flarexSchema,
  });
  const runtime = createFlarexRuntimePersistence({
    drizzle: drizzleDb,
    sql: createPGliteSqlClient(drizzleDb, db),
    appTableDefinitionsArtifactRepository: {
      db: drizzleDb,
      runTransaction: (run) => drizzleDb.transaction(run),
    },
    appSchemaPublicationRepository: {
      db: drizzleDb,
      runTransaction: (run) => drizzleDb.transaction(run),
    },
    transaction: (run) =>
      db.transaction((tx) => {
        // SAFETY: Drizzle types its PGlite driver client as the concrete PGlite
        // class; a PGlite transaction object implements the same exec/query protocol.
        const txDrizzle = drizzle({
          client: tx as PGlite,
          schema: flarexSchema,
        });
        return run(createFlarexRuntimePersistenceTransaction(
          txDrizzle,
          createPGliteSqlClient(txDrizzle, tx),
        ));
      }),
  });

  return {
    ...runtime,
    drizzle: drizzleDb,
    async migrate(): Promise<void> {
      await migratePGlite(drizzleDb, { migrationsFolder });
    },
  };
}

function createPGliteSqlClient(
  database: PgliteDatabase<typeof flarexSchema>,
  client: PGliteTransactionLike,
): FlarexSqlClient {
  return {
    async execute<Row extends Record<string, unknown> = Record<string, unknown>>(
      query: Parameters<FlarexSqlClient["execute"]>[0],
    ): Promise<QueryResult<Row>> {
      const result = await database.execute<Row>(query);
      return { rows: rowsFromDriver<Row>(result.rows) };
    },
    exec: (sql) => client.exec(sql),
    query: <Row extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ) => client.query<Row>(sql, params),
  };
}

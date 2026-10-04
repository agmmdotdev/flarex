import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { Effect, Schema } from "effect";
import { sql } from "drizzle-orm";
import { withInstallationMaintenance, runInstallationMigrations, backfillInstallationMetadataBindings,
  backfillInstallationLogicalReadProjections, bootstrapInstallationMigrations,
  publishFullProofInstallation, publishVerifiedInstallation } from "./postgresInstallationMaintenance";
import { InstallationLifecycleError } from "./installationLifecycle";
import type { FlarexMetadataDatabase } from "./deployments";

import { defaultMigrationsFolder } from "./defaultMigrationsFolder";
import {
  createLocatedApplicationActionAuthorityTargetV1,
  type LocatedApplicationActionAuthorityTargetV1,
} from "./applicationActionAuthorityV1";
import {
  createLocatedIndexBuildReconciliationTargetV1,
  type LocatedIndexBuildReconciliationTargetV1,
} from "./indexBuildReconciliation";
import {
  createLocatedAppUniqueConstraintSetBuildTargetV1,
  type LocatedAppUniqueConstraintSetBuildTargetV1,
} from "./appUniqueConstraintSetBuildV1";
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
  createLocatedRetainedHistoryFloorTargetInternal,
  type LocatedRetainedHistoryFloorTarget,
} from "./retainedHistoryFloorObservation";
import {
  createLocatedPointMutationSessionActivationTargetV1,
  type LocatedPointMutationSessionActivationTargetOptionsV1,
} from "./transactionSessionActivation";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  type LocatedTaskSystemRunAttemptTargetV1,
} from "./taskSystemRunAttemptStoreV1";
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
  type PostgresLocatedReadCommittedRunnerOptionsV1,
} from "./postgresLocatedReadCommitted";
import { flarexSchema } from "./schema";

export {
  makeTaskSystemRunAttemptStoreV1,
  type TaskSystemRunAttemptStoreOptionsV1,
} from "./taskSystemRunAttemptStoreV1";

export interface PostgresPersistenceOptions {
  pool?: Pool;
  /** Privileged schema migration connection for a restricted runtime pool. */
  migrationPool?: Pool;
  poolConfig?: PoolConfig;
  connectionString?: string;
  migrationsFolder?: string;
  migrationsSchema?: string;
  migrationsTable?: string;
  /** Existing split data installations restore immutable Application/binding catalog
   * evidence from this genuine control owner. The declared co-located default
   * is this installer's migration database, selected before maintenance. */
  immutableCatalog?: FlarexMetadataDatabase;
  /** fullProof is the explicit compatibility installer profile used by owner
   * tests. Managed publication requires exact authenticated runtime pools. */
  installation?: Readonly<{ kind: "fullProof" }> | Readonly<{ kind: "managed";
    runtimePolicies: ReadonlyArray<Readonly<{ database: FlarexMetadataDatabase; endpointPolicy: string;
      accessProfile?: "dataRuntime" | "controlRead" }>> }>;
}
const decodeMigrationTarget = Schema.decodeUnknownEffect(Schema.Tuple([
  Schema.Struct({ schemaName: Schema.NonEmptyString, installed: Schema.Boolean }),
]));
const decodeInstalled = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ installed: Schema.Boolean })]));
const decodePolicyCount = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ count: Schema.String.check(
  Schema.makeFilter(value => /^(0|[1-9][0-9]*)$/.test(value) ? undefined : "Expected a nonnegative count")) })]));
function installationQuery<Value>(run: () => PromiseLike<Value>): Effect.Effect<Value, InstallationLifecycleError> {
  return Effect.tryPromise({ try: () => Promise.resolve(run()),
    catch: cause => new InstallationLifecycleError({ reason: "resourceFailure", cause }) });
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
          options.managedInstallation === undefined ? {} : { managedInstallation: {
            installation: options.managedInstallation.installation, database: persistence.drizzle } },
        ),
    },
  );
}

export function createPostgresLocatedRetainedHistoryFloorTarget(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
  options: PostgresLocatedReadCommittedRunnerOptionsV1 = {},
): LocatedRetainedHistoryFloorTarget {
  return createLocatedRetainedHistoryFloorTargetInternal(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(
      persistence.pool,
      options,
    ),
  );
}

export function createPostgresLocatedTaskSystemRunAttemptTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedTaskSystemRunAttemptTargetV1 {
  return createLocatedTaskSystemRunAttemptTargetV1(
    persistence.drizzle,
    physicalLocator,
    createPostgresLocatedReadCommittedTransactionRunnerV1(persistence.pool),
  );
}

export function createPostgresLocatedApplicationActionAuthorityTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedApplicationActionAuthorityTargetV1 {
  return createLocatedApplicationActionAuthorityTargetV1(
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

export function createPostgresLocatedAppUniqueConstraintSetBuildTargetV1(
  persistence: Pick<PostgresFlarexPersistence, "drizzle" | "pool">,
  physicalLocator: ScopePhysicalLocator,
): LocatedAppUniqueConstraintSetBuildTargetV1 {
  return createLocatedAppUniqueConstraintSetBuildTargetV1(
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
  const migrationDb = options.migrationPool === undefined
    ? drizzleDb
    : drizzle(options.migrationPool, { schema: flarexSchema });
  const immutableCatalog = options.immutableCatalog ?? migrationDb;
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

  const migrateInstallation = Effect.fn("PostgresPersistence.migrate")(function* () {
      const migrationOptions = {
        migrationsFolder,
        ...(options.migrationsSchema === undefined ? {} : { migrationsSchema: options.migrationsSchema }),
        ...(options.migrationsTable === undefined ? {} : { migrationsTable: options.migrationsTable }),
      };
      const rows = yield* installationQuery(() => migrationDb.select({ schemaName: sql<string>`current_schema()`,
        installed: sql<boolean>`pg_catalog.to_regclass('fx_system_installation') is not null` })
        .from(sql`(values (1)) as migration_target(value)`));
      const [target] = yield* decodeMigrationTarget(rows).pipe(Effect.mapError(cause =>
        new InstallationLifecycleError({ reason: "invalidInstallation", cause })));
      const selected: NonNullable<PostgresPersistenceOptions["installation"]> = options.installation ?? { kind: "fullProof" };
      if (selected.kind === "managed" && (selected.runtimePolicies.length === 0 || selected.runtimePolicies.length > 64))
        return yield* Effect.fail(new InstallationLifecycleError({ reason: "invalidCapability" }));
      if (target.installed && selected.kind === "fullProof") {
        const counts = yield* installationQuery(() => migrationDb.select({ count: sql<string>`count(*)::text` })
          .from(sql`${sql.identifier(target.schemaName)}.fx_system_installation_runtime`));
        const [policy] = yield* decodePolicyCount(counts).pipe(Effect.mapError(cause =>
          new InstallationLifecycleError({ reason: "invalidInstallation", cause })));
        if (policy.count !== "0") return yield* Effect.fail(new InstallationLifecycleError({ reason: "invalidCapability" }));
      }
      const maintenanceConfig = options.migrationPool?.options ?? pool.options;
      if (!target.installed) {
        yield* bootstrapInstallationMigrations(maintenanceConfig, target.schemaName, migrationOptions);
        const currentRows = yield* installationQuery(() => migrationDb.select({
          installed: sql<boolean>`pg_catalog.to_regclass('fx_system_installation') is not null` })
          .from(sql`(values (1)) as installed_bootstrap(value)`));
        const [current] = yield* decodeInstalled(currentRows).pipe(Effect.mapError(cause =>
          new InstallationLifecycleError({ reason: "invalidInstallation", cause })));
        if (!current.installed) {
          if (selected.kind === "managed") return yield* Effect.fail(new InstallationLifecycleError({ reason: "invalidCapability" }));
          return; // Explicit historical migration fixtures predate this gate.
        }
      }
      yield* withInstallationMaintenance(maintenanceConfig, target.schemaName, handle => Effect.gen(function* () {
        if (target.installed) yield* runInstallationMigrations(handle, migrationOptions);
        yield* backfillInstallationMetadataBindings(handle, immutableCatalog);
        yield* backfillInstallationLogicalReadProjections(handle);
        yield* selected.kind === "managed" ? publishVerifiedInstallation(handle, selected.runtimePolicies, migrationOptions) : publishFullProofInstallation(handle, migrationOptions);
      }));
  });

  return {
    ...runtime,
    drizzle: drizzleDb,
    pool,
    async migrate(): Promise<void> {
      return Effect.runPromise(migrateInstallation());
    },

    async close(): Promise<void> {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}

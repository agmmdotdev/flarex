import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gin } from "@electric-sql/pglite/contrib/btree_gin";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { sql } from "drizzle-orm";
import {
  initializeFullProofInstallation,
  verifyInstallationWriterProtection,
  InstallationLifecycleError,
} from "../installation/installationLifecycle";
import { prepareTypedMaintenanceMigration } from "../storage/indexes/indexMaintenanceMigration";
import { backfillBindingMaintenance } from "../storage/indexes/bindingMaintenanceMigration";
import type { FlarexMetadataDatabase } from "../application/deployments";
import {
  backfillStandaloneApplicationBindings,
} from "../application/activation/readBindingPublication";
import { backfillBindingMetadataProjections } from "../installation/frameworkSchema/binding/repository";
import { backfillLogicalReadProjections } from "../storage/catalog/logicalStorageDefinitions";

import { defaultMigrationsFolder } from "../installation/defaultMigrationsFolder";
import {
  createLocatedApplicationActionAuthorityTargetV1,
  type LocatedApplicationActionAuthorityTargetV1,
} from "../application/applicationActionAuthorityV1";
import {
  createLocatedIndexBuildReconciliationTargetV1,
  type LocatedIndexBuildReconciliationTargetV1,
} from "../storage/indexes/indexBuildReconciliation";
import type {
  FlarexPersistence,
  FlarexSqlClient,
  QueryResult,
} from "../index";
import {
  createSharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapper,
  type SharedScopeAuthorityBootstrapperOptions,
} from "../scope/scopeAuthorityBootstrap";
import {
  createSharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisioner,
  type SharedScopeAuthorityProvisionerOptions,
} from "../scope/scopeAuthorityProvisioning";
import {
  createSplitScopeAuthorityProvisioner,
  type SplitScopeAuthorityProvisioner,
  type SplitScopeAuthorityProvisionerOptions,
} from "../scope/splitScopeAuthorityProvisioning";
import {
  createLocatedSplitScopeClockTarget,
  type LocatedSplitScopeClockTarget,
} from "../scope/splitScopeClockTarget";
import {
  createLocatedScopeAuthorizationEpochTarget,
} from "../scope/scopeAuthorizationEpochAuthority";
import {
  createLocatedRetainedHistoryFloorTargetInternal,
  type LocatedRetainedHistoryFloorTarget,
} from "../storage/history/retainedHistoryFloorObservation";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "./locatedReadCommittedRunner";
import {
  createLocatedPointMutationSessionActivationTargetV1,
} from "../execution/session/target";
import type {
  LocatedPointMutationSessionActivationTargetOptionsV1,
} from "../execution/session/constructionContracts";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  type LocatedTaskSystemRunAttemptTargetV1,
} from "../tasks/taskSystemRunAttemptStoreV1";
import {
  createLocatedTaskExternalEffectAuthorityTarget,
  createLocatedTaskExternalEffectAuthorityTargetFromPolicyInternal,
  type LocatedTaskExternalEffectAuthorityTarget,
  type TaskExternalEffectAuthorityConfigurationError,
} from "../tasks/taskExternalEffectAuthority";
import {
  createTaskComputeDeliveryControlDirectoryTargetInternal,
  type TaskComputeDeliveryControlDirectoryConfigurationError,
  type TaskComputeDeliveryControlDirectoryTarget,
} from "../tasks/taskComputeDeliveryControlDirectoryTarget";
import {
  createTaskRepairPostgresDeadlinePolicyV1,
  configureTaskRepairPostgresTransactionDeadlinesV1,
  type TaskRepairPostgresDeadlineConfigurationV1Error,
  type TaskRepairPostgresDeadlinePolicyInputV1,
} from "../tasks/taskRepairPostgresDeadlinePolicyV1";
import { retainDeadlineOwnedTaskPersistenceTargetInternal, TaskPersistenceTransactionError,
  type DeadlineOwnedTaskPersistenceTarget } from "../tasks/taskPersistenceTransaction";
import type { LocatedScopeClockReader } from "../scope/scopeAuthorityResolution";
import type {
  ScopePhysicalLocator,
  SplitScopePhysicalLocator,
} from "../scope/scopeMetadataTypes";
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
} from "../tasks/taskSystemRunAttemptStoreV1";

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

// PGlite serializes individual statements, but its single PostgreSQL backend
// reenters session advisory locks. The actual client owns the complete command.
const activePGliteMaintenance = new WeakSet<PGliteLike>();
const ownedPGliteDatabases = new WeakSet<object>();

export interface PGlitePersistenceOptions {
  dataDir?: string;
  db?: PGliteLike;
  migrationsFolder?: string;
  immutableCatalog?: FlarexMetadataDatabase;
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

export function createPGliteLocatedTaskExternalEffectAuthorityTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
  deadlineInput: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<
  LocatedTaskExternalEffectAuthorityTarget,
  TaskExternalEffectAuthorityConfigurationError<"invalid_deadline_policy">
> {
  return createLocatedTaskExternalEffectAuthorityTarget(
    persistence.drizzle,
    physicalLocator,
    deadlineInput,
  );
}

/** Explicit SQL-semantics test lane. It makes no PostgreSQL pool-acquisition
 * claim and accepts only a database created by this PGlite persistence owner. */
export function createPGliteDeadlineOwnedTaskPersistenceTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
  deadlineInput: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<DeadlineOwnedTaskPersistenceTarget,
  TaskPersistenceTransactionError | TaskRepairPostgresDeadlineConfigurationV1Error> {
  if (!ownedPGliteDatabases.has(persistence.drizzle)) return Result.fail(new TaskPersistenceTransactionError({
    reason: "invalidTarget", operation: "pgliteTestTarget" }));
  return createTaskRepairPostgresDeadlinePolicyV1(deadlineInput).pipe(Result.map(policy =>
    retainDeadlineOwnedTaskPersistenceTargetInternal(createLocatedTaskExternalEffectAuthorityTargetFromPolicyInternal(
      persistence.drizzle, physicalLocator, createDefaultLocatedReadCommittedTransactionRunnerV1(persistence.drizzle), policy,
    ), policy, "pgliteTest")));
}

/** Same explicit SQL test owner, with the existing Task lifecycle target's
 * database-time and identity allocation capabilities. */
export function createPGliteDeadlineOwnedTaskRunAttemptTarget(
  persistence: Pick<PGliteFlarexPersistence, "drizzle">,
  physicalLocator: ScopePhysicalLocator,
  deadlineInput: TaskRepairPostgresDeadlinePolicyInputV1,
): Result.Result<LocatedTaskSystemRunAttemptTargetV1 & DeadlineOwnedTaskPersistenceTarget,
  TaskPersistenceTransactionError | TaskRepairPostgresDeadlineConfigurationV1Error> {
  if (!ownedPGliteDatabases.has(persistence.drizzle)) return Result.fail(new TaskPersistenceTransactionError({
    reason: "invalidTarget", operation: "pgliteTaskLifecycleTarget" }));
  return createTaskRepairPostgresDeadlinePolicyV1(deadlineInput).pipe(Result.map(policy => {
    const runReadCommitted = createDefaultLocatedReadCommittedTransactionRunnerV1(persistence.drizzle);
    return retainDeadlineOwnedTaskPersistenceTargetInternal(createLocatedTaskSystemRunAttemptTargetV1(
      persistence.drizzle, physicalLocator, work => runReadCommitted(async tx => {
        await configureTaskRepairPostgresTransactionDeadlinesV1(tx, policy);
        return work(tx);
      })), policy, "pgliteTest");
  }));
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
} from "../scope/scopeAuthorityBootstrap";

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
} from "../scope/scopeAuthorityProvisioning";

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
} from "../scope/splitScopeAuthorityProvisioning";

export {
  EnsureSplitScopeInitialClockStatuses,
  SplitScopeInitialClockConflictError,
  type EnsureSplitScopeInitialClockInput,
  type EnsureSplitScopeInitialClockResult,
  type LocatedSplitScopeClockTarget,
} from "../scope/splitScopeClockTarget";

export async function createPGlitePersistence(
  options: PGlitePersistenceOptions = {},
): Promise<PGliteFlarexPersistence> {
  const db: PGliteLike = options.db ?? (options.dataDir === undefined
    ? new PGlite({ extensions: { pg_trgm, btree_gin } })
    : new PGlite(options.dataDir, { extensions: { pg_trgm, btree_gin } }));
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder();
  const drizzleDb = drizzle({
    // SAFETY: Drizzle types its PGlite driver client as the concrete PGlite
    // class; PGliteLike implements the exec/query protocol drizzle actually calls.
    client: db as PGlite,
    schema: flarexSchema,
  });
  const immutableCatalog = options.immutableCatalog ?? drizzleDb;
  ownedPGliteDatabases.add(drizzleDb);
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
      if (activePGliteMaintenance.has(db)) throw maintenanceIssue("busy");
      activePGliteMaintenance.add(db);
      try {
      await Effect.runPromise(withFullProofInstallationMaintenance(drizzleDb, Effect.gen(function* () {
      const [existing] = yield* maintenanceQuery(() => drizzleDb.select({
        present: sql`pg_catalog.to_regclass('fx_system_installation') is not null`,
        schemaName: sql`current_schema()`,
      }).from(sql`(values (1)) as pglite_existing_installation(value)`)).pipe(
        Effect.flatMap(rows => decodeLocatedMaintenancePresenceRows(rows).pipe(
          Effect.mapError(cause => maintenanceIssue("invalidInstallation", cause)))));
      if (existing.present) {
        yield* prepareTypedMaintenanceMigration(drizzleDb, immutableCatalog, existing.schemaName, {}).pipe(
          Effect.mapError(cause => maintenanceIssue("invalidInstallation", cause)));
      }
      yield* Effect.tryPromise({ try: () => migratePGlite(drizzleDb, { migrationsFolder }),
        catch: cause => new InstallationLifecycleError({ reason: "resourceFailure", cause }) });
      const [installation] = yield* maintenanceQuery(() => drizzleDb.select({ present: sql`pg_catalog.to_regclass('fx_system_installation') is not null` })
        .from(sql`(values (1)) as pglite_installation(value)`)).pipe(Effect.flatMap(rows => decodeMaintenancePresenceRows(rows).pipe(
          Effect.mapError(cause => maintenanceIssue("invalidInstallation", cause)))));
      if (!installation.present) return; // Historical migration fixture.
      // PGlite's owner-only compatibility lane is single-backend and explicitly
      // fullProof. It cannot issue a managed installation capability.
      const [gate] = yield* maintenanceQuery(() => drizzleDb.select({ state: sql`state` }).from(sql`fx_system_installation`).limit(2)).pipe(
        Effect.flatMap(rows => decodeMaintenanceStateRows(rows).pipe(Effect.mapError(cause => maintenanceIssue("invalidInstallation", cause)))));
      if (gate.state === "unverified") yield* initializeFullProofInstallation(drizzleDb);
      yield* backfillStandaloneApplicationBindings(drizzleDb, immutableCatalog);
      yield* backfillBindingMetadataProjections(drizzleDb, immutableCatalog);
      yield* backfillBindingMaintenance(drizzleDb, immutableCatalog);
      yield* backfillLogicalReadProjections(drizzleDb);
      })));
      await Effect.runPromise(Effect.gen(function* () {
        const [installation] = yield* maintenanceQuery(() => drizzleDb.select({ present: sql`pg_catalog.to_regclass('fx_system_installation') is not null` })
          .from(sql`(values (1)) as pglite_installation(value)`)).pipe(Effect.flatMap(rows => decodeMaintenancePresenceRows(rows).pipe(
            Effect.mapError(cause => maintenanceIssue("invalidInstallation", cause)))));
        if (installation.present) yield* initializeFullProofInstallation(drizzleDb);
      }));
      } finally {
        activePGliteMaintenance.delete(db);
      }
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
    exec: (statement) => client.exec(statement),
    query: <Row extends Record<string, unknown> = Record<string, unknown>>(
      statement: string,
      params?: readonly unknown[],
    ) => client.query<Row>(statement, params),
  };
}

const maintenanceIssue = (reason: InstallationLifecycleError["reason"], cause?: unknown) =>
  new InstallationLifecycleError({ reason, ...(cause === undefined ? {} : { cause }) });
const maintenanceQuery = <Value>(run: () => PromiseLike<Value>) => Effect.tryPromise({
  try: () => Promise.resolve(run()), catch: cause => maintenanceIssue("resourceFailure", cause),
});
const maintenancePositiveIntegerText = Schema.String.check(Schema.makeFilter(value =>
  /^[1-9][0-9]*$/.test(value) ? undefined : "Expected canonical positive integer text"));
const maintenanceNamespaceOid = maintenancePositiveIntegerText.check(Schema.makeFilter(value =>
  /^[1-9][0-9]*$/.test(value) && BigInt(value) > 4_294_967_295n ? "Namespace OID exceeds PostgreSQL OID bounds" : undefined));
const maintenanceGeneration = maintenancePositiveIntegerText.check(Schema.makeFilter(value =>
  /^[1-9][0-9]*$/.test(value) && BigInt(value) > 9_223_372_036_854_775_807n ? "Installation generation exceeds signed bigint bounds" : undefined));
const maintenanceUuid = Schema.String.check(Schema.isUUID());
const maintenancePresenceSchema = Schema.Struct({ present: Schema.Boolean });
const decodeMaintenancePresenceRows = Schema.decodeUnknownEffect(Schema.Tuple([maintenancePresenceSchema]));
const decodeLocatedMaintenancePresenceRows = Schema.decodeUnknownEffect(Schema.Tuple([
  Schema.Struct({ present: Schema.Boolean, schemaName: Schema.NonEmptyString }),
]));
const decodeMaintenanceStateRows = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ state: Schema.NonEmptyString })]));
const maintenanceGateSchema = Schema.Struct({ state: Schema.NonEmptyString, schema: Schema.NonEmptyString,
  owner: Schema.Boolean, noRuntimePolicies: Schema.Boolean, namespaceOid: maintenanceNamespaceOid,
  incarnation: maintenanceUuid, generation: maintenanceGeneration });
const decodeMaintenanceGateRows = Schema.decodeUnknownEffect(Schema.Tuple([maintenanceGateSchema]));
const decodeMaintenanceLockRows = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ owner: Schema.Boolean, drain: Schema.Boolean })]));
const maintenanceOwnerSchema = Schema.Struct({ owner: maintenanceUuid, incarnation: maintenanceUuid, generation: maintenanceGeneration });
const decodeMaintenanceOwnerRows = Schema.decodeUnknownEffect(Schema.Tuple([maintenanceOwnerSchema]));
const decodeMaintenanceReopenRows = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ reopened: Schema.Literal(1) })]));
/** The owner-only single-backend compatibility installer uses the same durable
 * draining state and admission exclusion as managed maintenance. A failed
 * upgrade remains closed; this never issues a managed runtime capability. */
const withFullProofInstallationMaintenance = Effect.fn("InstallationLifecycle.withFullProofMaintenance")(
  function* <Value, Failure, Requirements>(database: PgliteDatabase<typeof flarexSchema>,
    work: Effect.Effect<Value, Failure, Requirements>) {
    const [exists] = yield* maintenanceQuery(() => database.select({ present: sql`pg_catalog.to_regclass('fx_system_installation') is not null` })
      .from(sql`(values (1)) as installation_presence(value)`)).pipe(Effect.flatMap(rows => decodeMaintenancePresenceRows(rows).pipe(
        Effect.mapError(cause => maintenanceIssue("invalidInstallation", cause)))));
    if (!exists.present) return yield* work;
    const [gate] = yield* maintenanceQuery(() => database.select({ state: sql`i.state`, schema: sql`current_schema()`,
      owner: sql`pg_catalog.pg_has_role(session_user, c.relowner, 'USAGE')`,
      noRuntimePolicies: sql`not exists(select 1 from fx_system_installation_runtime)`,
      namespaceOid: sql`i.namespace_oid::text`, incarnation: sql`i.incarnation::text`, generation: sql`i.structural_generation::text` })
      .from(sql`fx_system_installation i join pg_catalog.pg_class c
        on c.oid = 'fx_system_installation'::pg_catalog.regclass where i.singleton_id = 1`).limit(2)).pipe(
          Effect.flatMap(rows => decodeMaintenanceGateRows(rows).pipe(Effect.mapError(cause => maintenanceIssue("invalidCapability", cause)))));
    if (!gate.owner || !gate.noRuntimePolicies)
      return yield* Effect.fail(maintenanceIssue("invalidCapability"));
    if (gate.state !== "active" && gate.state !== "unverified" && gate.state !== "draining")
      return yield* Effect.fail(maintenanceIssue("inactive"));
    const schema = sql.identifier(gate.schema);
    return yield* Effect.uninterruptible(Effect.gen(function* () {
    const owned = yield* Effect.exit(maintenanceQuery(() => database.select({ owner: sql`pg_catalog.pg_try_advisory_lock(2147483001,
      (${gate.namespaceOid}::bigint - 2147483648)::integer)`,
      drain: sql`pg_catalog.pg_try_advisory_lock(2147483002, (${gate.namespaceOid}::bigint - 2147483648)::integer)` })
      .from(sql`(values (1)) as compatibility_maintenance(value)`)).pipe(Effect.flatMap(rows => decodeMaintenanceLockRows(rows).pipe(
        Effect.mapError(cause => maintenanceIssue("invalidCapability", cause))))));
    const operation = Effect.gen(function* () {
      if (Exit.isFailure(owned)) return yield* Effect.failCause(owned.cause);
      const [locks] = owned.value;
      if (!locks.owner || !locks.drain) return yield* Effect.fail(maintenanceIssue("busy"));
      const acquired = yield* maintenanceQuery(() => database.execute(sql`update ${schema}.fx_system_installation set state = 'draining',
        maintenance_owner = pg_catalog.gen_random_uuid(), maintenance_pid = pg_backend_pid(),
        maintenance_backend_start = (select backend_start from pg_catalog.pg_stat_activity where pid = pg_backend_pid()),
        incarnation = pg_catalog.gen_random_uuid(), structural_generation = structural_generation + 1 where singleton_id = 1
        and incarnation = ${gate.incarnation}::uuid and structural_generation = ${gate.generation}::bigint
        returning maintenance_owner::text as owner, incarnation::text as incarnation, structural_generation::text as generation`));
      const [owner] = yield* decodeMaintenanceOwnerRows(acquired.rows).pipe(Effect.mapError(cause => maintenanceIssue("changed", cause)));
      const value = yield* work;
      yield* verifyInstallationWriterProtection(database, gate.schema);
      const reopened = yield* maintenanceQuery(() => database.execute(sql`update ${schema}.fx_system_installation set state = 'active',
        maintenance_owner = null, maintenance_pid = null, maintenance_backend_start = null where singleton_id = 1
        and state = 'draining' and maintenance_pid = pg_backend_pid()
        and maintenance_owner = ${owner.owner}::uuid and incarnation = ${owner.incarnation}::uuid
        and structural_generation = ${owner.generation}::bigint
        and maintenance_backend_start = (select backend_start from pg_catalog.pg_stat_activity where pid = pg_backend_pid())
        returning 1 as reopened`));
      yield* decodeMaintenanceReopenRows(reopened.rows).pipe(Effect.mapError(cause => maintenanceIssue("changed", cause)));
      return value;
    });
    const result = yield* Effect.exit(operation);
      // The lock query may have acquired a session lock before its result was
      // lost or failed decoding. This command owns both keys on this backend;
      // unlock also safely reports false when a key was never acquired.
      const drained = yield* Effect.exit(maintenanceQuery(() => database.execute(sql`select pg_catalog.pg_advisory_unlock(2147483002,
        (${gate.namespaceOid}::bigint - 2147483648)::integer)`)));
      const released = yield* Effect.exit(maintenanceQuery(() => database.execute(sql`select pg_catalog.pg_advisory_unlock(2147483001,
        (${gate.namespaceOid}::bigint - 2147483648)::integer)`)));
      const cleanup = Cause.combine(Exit.isFailure(drained) ? drained.cause : Cause.empty,
        Exit.isFailure(released) ? released.cause : Cause.empty);
      if (Exit.isFailure(result)) return yield* Effect.failCause(Cause.combine(result.cause, cleanup));
      if (cleanup.reasons.length > 0) return yield* Effect.failCause(cleanup);
      return result.value;
    }));
  },
);

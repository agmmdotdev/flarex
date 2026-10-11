import { randomUUID } from "node:crypto";
import { FINITE_PUBLICATION_FUNCTIONS } from "../commit/finitePublicationInstallation";
import {
  APPLICATION_DOMAIN_FUNCTIONS,
  APPLICATION_DOMAIN_TYPES,
} from "../storage/materialization/domainInstallation";
import { INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS, INDEX_MAINTENANCE_BUILD_PERMISSIONS,
  INDEX_MAINTENANCE_OBLIGATION_TABLES } from "../storage/indexes/indexMaintenanceInstallation";
import { prepareTypedMaintenanceMigration } from "../storage/indexes/indexMaintenanceMigration";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { Client, type ClientConfig } from "pg";
import { Cause, Data, Effect, Exit, Schema, Semaphore } from "effect";
import type { FlarexMetadataDatabase } from "../application/deployments";
import { flarexSchema } from "./schema";
import { attestProtectedMetadataInstallation } from "../execution/preparation/preparedMetadataEpoch";
import { InstallationLifecycleError, verifyInstallationWriterProtection, verifyManagedRuntimePrivileges,
  type InstallationAccessProfile } from "../installation/installationLifecycle";
import {
  backfillStandaloneApplicationBindings,
} from "../application/activation/readBindingPublication";
import { backfillBindingMetadataProjections } from "../installation/frameworkSchema/binding/repository";
import { backfillLogicalReadProjections } from "../storage/catalog/logicalStorageDefinitions";
import {
  frameworkSchemaTargetSnapshot,
  hasFrameworkSchemaTargetDatabase,
  type FrameworkSchemaTarget,
  type FrameworkSchemaTargetCompositionError,
} from "../installation/frameworkSchema/target";
import {
  makeFrameworkSchemaArtifactMaintenanceReader,
  type FrameworkSchemaArtifactRepository,
} from "../installation/frameworkSchema/artifact/repository";
import {
  makeFrameworkInstaller,
  type FrameworkFreshInstallationRequest,
  type FrameworkInstallerPolicy,
} from "../installation/migrationCoordination/installer";
import {
  makePostgresMaintenanceFrameworkMigrationTargetEffect,
  type PostgresFrameworkMigrationOptions,
} from "../installation/migrationCoordination/postgresTarget";
import {
  FrameworkMigrationSessionResourceIssue,
  FrameworkMigrationDecisionUncertainIssue,
  FrameworkMigrationTargetCompositionError,
  runFrameworkMigrationTargetTransactionEffect,
  withFrameworkMigrationRawTransactionEffect,
  type FrameworkMigrationTarget,
} from "../installation/migrationCoordination/targetSession";
import {
  CatalogControlSessionResourceIssue,
  makeCatalogControlSessionStarter,
  remainingCatalogControlMilliseconds,
  type CatalogControlReadInput,
  type CatalogControlSessionDriver,
} from "./catalogControlSession";
import type {
  FrameworkSchemaArtifactRepositoryConfigurationError,
} from "../installation/frameworkSchema/artifact/errors";
import type {
  RestoredFrameworkSchemaAvailabilityHead,
} from "../installation/frameworkSchema/installation/storedMetadataRestoration";
import type {
  FrameworkMigrationCoordinatorFailure,
} from "../installation/migrationCoordination/coordinatorContracts";

declare const maintenanceBrand: unique symbol;
export interface InstallationMaintenance { readonly [maintenanceBrand]: true }
interface Owner {
  readonly client: Client;
  readonly database: NodePgDatabase<typeof flarexSchema>;
  readonly schemaName: string;
  readonly job: string;
  readonly lane: Semaphore.Semaphore;
  readonly generation: string;
  readonly incarnation: string;
  readonly databaseName: string;
  phase: "commands" | "verifying" | "closed" | "reopened";
  queued: number;
}
const owners = new WeakMap<object, Owner>();
const controlReadRelations: readonly string[] = [
  "fx_system_installation", "fx_system_installation_runtime", "fx_system_prepared_metadata_epoch",
  "fx_control_scope", "fx_control_scope_provisioning", "fx_control_logical_read_source",
  "fx_control_logical_read_table", "fx_control_logical_read_access", "fx_control_index_definition",
  "fx_control_schema_version", "fx_control_schema_unique_constraint_set",
  "fx_control_schema_version_unique_constraint_binding", "fx_control_unique_constraint_definition",
];
const fail = (reason: InstallationLifecycleError["reason"], cause?: unknown) =>
  new InstallationLifecycleError({ reason, ...(cause === undefined ? {} : { cause }) });
class MaintenanceDriverFailure extends Data.TaggedError("MaintenanceDriverFailure")<{ readonly cause: unknown }> {}
interface DedicatedClient {
  readonly client: Client;
  readonly failures: InstallationLifecycleError[];
  readonly onError: (cause: Error) => void;
}
const maximumConnectionTimeoutMilliseconds = 10_000;
const acquireDedicatedClient = (config: ClientConfig) => Effect.sync(() => {
  const requestedTimeout = config.connectionTimeoutMillis;
  // PostgreSQL startup precedes SQL timeouts. Zero/default pg configuration
  // must not leave this owner's uninterruptible connection attempt unbounded.
  const connectionTimeoutMillis = requestedTimeout !== undefined && Number.isSafeInteger(requestedTimeout) && requestedTimeout > 0
    ? Math.min(requestedTimeout, maximumConnectionTimeoutMilliseconds) : maximumConnectionTimeoutMilliseconds;
  const client = new Client({ ...config, connectionTimeoutMillis });
  const failures: InstallationLifecycleError[] = [];
  const onError = (cause: Error) => { failures.push(fail("resourceFailure", cause)); };
  // A failed command and the following socket close are separate pg events.
  // This lifetime observes both through its final socket close.
  client.on("error", onError);
  return { client, failures, onError } satisfies DedicatedClient;
});
const closeDedicatedClient = Effect.fn("InstallationMaintenance.closeClient")(function* (owned: DedicatedClient) {
  const ended = yield* Effect.exit(driver(() => owned.client.end()));
  owned.client.removeListener("error", owned.onError);
  let cause: Cause.Cause<InstallationLifecycleError> = Exit.isFailure(ended) ? ended.cause : Cause.empty;
  for (const failure of owned.failures) cause = Cause.combine(cause, Cause.fail(failure));
  if (cause.reasons.length > 0) return yield* Effect.failCause(cause);
});
const decodeLock = Schema.decodeUnknownEffect(Schema.Tuple([
  Schema.Struct({ owned: Schema.Boolean, permitted: Schema.Boolean }),
]));
const decodeGate = Schema.decodeUnknownEffect(Schema.Tuple([
  Schema.Struct({ incarnation: Schema.String.check(Schema.isUUID()), generation: Schema.String,
    databaseName: Schema.NonEmptyString, namespaceOid: Schema.String }),
]));
const decodeRuntime = Schema.decodeUnknownEffect(Schema.Tuple([
  Schema.Struct({ login: Schema.NonEmptyString, databaseName: Schema.NonEmptyString,
    schemaName: Schema.NonEmptyString, sameLogin: Schema.Boolean }),
]));
const decodeDriverRows = Schema.decodeUnknownEffect(Schema.Struct({ rows: Schema.Unknown }));

/** A dedicated, nonreconnecting backend owns the whole maintenance command lane.
 * The backend retains its session advisory lock until PostgreSQL closes it.
 * A successor cannot acquire ownership while predecessor SQL remains live. */
export const withInstallationMaintenance = Effect.fn("InstallationMaintenance.withOwner")(
  function* <Value, Failure, Requirements>(
    config: ClientConfig, schemaName: string,
    work: (owner: InstallationMaintenance) => Effect.Effect<Value, Failure, Requirements>,
  ) {
    return yield* Effect.acquireUseRelease(
      acquireDedicatedClient(config),
      owned => Effect.gen(function* () {
        const connected = owned.client;
        yield* driver(() => connected.connect());
        yield* driver(() => connected.query("set statement_timeout = '30s'"));
        yield* driver(() => connected.query("select pg_catalog.set_config('search_path', $1, false)",
          [`${quoteIdentifier(schemaName)}, pg_temp`]));
        const table = `${quoteIdentifier(schemaName)}.fx_system_installation`;
        const lock = yield* driver(() => connected.query(`select
          pg_catalog.pg_try_advisory_lock(2147483001, (i.namespace_oid - 2147483648)::integer) as owned,
          pg_catalog.pg_has_role(session_user, c.relowner, 'USAGE') as permitted
          from ${table} i join pg_catalog.pg_class c on c.oid = $1::pg_catalog.regclass
          where i.singleton_id = 1`, [`${schemaName}.fx_system_installation`]));
        const [ownership] = yield* decodeLock(lock.rows).pipe(
          Effect.mapError(cause => fail("invalidInstallation", cause)));
        if (!ownership.permitted) return yield* Effect.fail(fail("invalidCapability"));
        if (!ownership.owned) return yield* Effect.fail(fail("busy"));
        // This distinct queued exclusive latch prevents new shared admissions
        // passing a row updater waiting on an existing MultiXact SHARE holder.
        yield* driver(() => connected.query(`select pg_catalog.pg_advisory_lock(2147483002,
          (i.namespace_oid - 2147483648)::integer) from ${table} i where singleton_id = 1`));
        const job = randomUUID();
        // Both admission latches and row holders have drained before it returns.
        // The next statement sees durable draining even if this process then dies.
        const drained = yield* driver(() => connected.query(`update ${table} set state = 'draining',
          maintenance_owner = $1, maintenance_pid = pg_backend_pid(),
          maintenance_backend_start = (select backend_start from pg_catalog.pg_stat_activity where pid = pg_backend_pid()),
          incarnation = pg_catalog.gen_random_uuid(),
          structural_generation = structural_generation + 1 where singleton_id = 1
          returning incarnation::text, structural_generation::text as generation,
            database_name as "databaseName", namespace_oid::text as "namespaceOid"`, [job]));
        const [identity] = yield* decodeGate(drained.rows).pipe(Effect.mapError(cause => fail("invalidInstallation", cause)));
        yield* driver(() => connected.query(`delete from ${quoteIdentifier(schemaName)}.fx_system_installation_runtime`));
        // SAFETY: this private registry is the sole issuer of the inert handle.
        const handle = Object.freeze({}) as InstallationMaintenance;
        const owner: Owner = { client: connected, database: drizzle(connected, { schema: flarexSchema }),
          schemaName, job, generation: identity.generation, incarnation: identity.incarnation,
          databaseName: identity.databaseName,
          phase: "commands", queued: 0, lane: yield* Semaphore.make(1) };
        owners.set(handle, owner);
        return yield* Effect.suspend(() => work(handle)).pipe(Effect.ensuring(
          Effect.sync(() => { owner.phase = "closed"; }).pipe(Effect.andThen(
            owner.lane.withPermits(1)(Effect.void)))));
      }),
      // PostgreSQL releases the session lock on backend termination. Socket close
      // alone is not proof of cancellation; active migration cleanup owns that.
      closeDedicatedClient,
    );
  },
);

/** Fixed retained-profile operation: canonical installation and replay share
 * one fenced backend. Only authenticated availability escapes this owner. */
export interface RetainedPhysicalProfileInstallationInput {
  readonly config: ClientConfig;
  readonly schemaName: string;
  readonly database: FlarexMetadataDatabase;
  readonly target: FrameworkSchemaTarget;
  readonly artifactRepository: FrameworkSchemaArtifactRepository;
  readonly requests: readonly FrameworkFreshInstallationRequest[];
  readonly policy: FrameworkInstallerPolicy;
  readonly journal: InstallationMigrationJournal;
  readonly runtimePolicies?: ReadonlyArray<Readonly<{ database: FlarexMetadataDatabase; endpointPolicy: string;
    accessProfile?: InstallationAccessProfile }>>;
  readonly runtimeDatabases?: readonly FlarexMetadataDatabase[];
  readonly options?: PostgresFrameworkMigrationOptions;
}
export type RetainedPhysicalProfileInstallationFailure = InstallationLifecycleError |
  FrameworkMigrationCoordinatorFailure | FrameworkSchemaTargetCompositionError | FrameworkSchemaArtifactRepositoryConfigurationError;
export const installRetainedPhysicalProfile: (input: RetainedPhysicalProfileInstallationInput) =>
  Effect.Effect<RestoredFrameworkSchemaAvailabilityHead, RetainedPhysicalProfileInstallationFailure> =
  Effect.fn("InstallationMaintenance.installPhysicalProfile")(
  function* (input: RetainedPhysicalProfileInstallationInput):
    Effect.fn.Return<RestoredFrameworkSchemaAvailabilityHead, RetainedPhysicalProfileInstallationFailure> {
    const target = frameworkSchemaTargetSnapshot(input.target);
    if (target === undefined || !hasFrameworkSchemaTargetDatabase(input.target, input.database) ||
      target.namespace.frame.schemaName !== input.schemaName || target.physicalLocator.schemaName !== input.schemaName ||
      input.requests.length < 1 || input.requests.length > 2) return yield* Effect.fail(fail("invalidCapability"));
    return yield* withInstallationMaintenance(input.config, input.schemaName, handle => Effect.gen(function* () {
      const availability = yield* command(handle, owner => Effect.gen(function* () {
        yield* verifyInstallationWriterProtection(owner.database, owner.schemaName, {
          schemaName: input.journal.migrationsSchema ?? "drizzle", tableName: input.journal.migrationsTable ?? "__drizzle_migrations" });
        const targetInput = {
          database: input.database, client: owner.client, config: input.config,
          deploymentId: target.namespace.frame.deploymentId,
          canonicalPhysicalDatabaseIdentity: target.namespace.frame.physicalDatabaseIdentity,
          physicalLocator: target.physicalLocator, ...(input.options === undefined ? {} : { options: input.options }),
          assertOwner: () => assertOwner(owner).pipe(Effect.mapError(maintenanceMigrationResource)),
          protectNewTables: () => protectNewPhysicalTables(owner, input.journal).pipe(Effect.mapError(maintenanceMigrationResource)),
        };
        const migrationTarget = yield* makePostgresMaintenanceFrameworkMigrationTargetEffect(targetInput);
        const artifactReadTarget = yield* makePostgresMaintenanceFrameworkMigrationTargetEffect({ ...targetInput, readOnly: true });
        const artifactReader = yield* Effect.fromResult(makeFrameworkSchemaArtifactMaintenanceReader(input.artifactRepository,
          input.database, makeCatalogControlSessionStarter({ controlDb: input.database,
            driver: makeMaintenanceArtifactReadDriver(artifactReadTarget, input.policy) })));
        const installer = yield* Effect.fromResult(makeFrameworkInstaller({ target: migrationTarget,
          artifactRepository: artifactReader, policy: input.policy }));
        let result: RestoredFrameworkSchemaAvailabilityHead | undefined;
        for (const request of input.requests) {
          const installed = yield* installer.installFresh(request);
          if (installed.kind !== "ready") return yield* Effect.fail(fail("invalidInstallation", installed));
          // A terminal receipt replay proves settlement, while this canonical
          // audit reobserves the physical catalog before installation reopens.
          const verified = yield* installer.verify(request);
          const plan = installed.availability.installation.plan.plan;
          if (verified.kind !== "verified" || !verified.complete ||
            verified.planSha256 !== plan.migrationPlanSha256 ||
            verified.completedStepCount !== plan.frame.steps.length ||
            verified.requiredStepCount !== plan.frame.steps.length)
            return yield* Effect.fail(fail("invalidInstallation", verified));
          result = installed.availability;
        }
        if (result === undefined) return yield* Effect.fail(fail("invalidInstallation"));
        const tables = result.installation.plan.plan.physicalLayout.frame.tables;
        for (const database of input.runtimeDatabases ?? (input.runtimePolicies ?? []).map(policy => policy.database)) {
          const login = yield* driver(() => database.execute(`select session_user as login,
            current_database() as "databaseName", current_schema() as "schemaName", current_user = session_user as "sameLogin"`));
          const observed = yield* decodeDriverRows(login).pipe(Effect.mapError(cause => fail("invalidInstallation", cause)));
          const [runtime] = yield* decodeRuntime(observed.rows).pipe(Effect.mapError(cause => fail("invalidInstallation", cause)));
          if (!runtime.sameLogin || runtime.databaseName !== owner.databaseName || runtime.schemaName !== owner.schemaName)
            return yield* Effect.fail(fail("changed"));
          for (const table of tables) yield* driver(() => owner.client.query(
            `grant select, insert, update, delete on ${quoteIdentifier(owner.schemaName)}.${quoteIdentifier(table.name)} to ${quoteIdentifier(runtime.login)}`));
          for (const table of tables) yield* driver(() => owner.client.query(
            `revoke truncate, trigger, references on ${quoteIdentifier(owner.schemaName)}.${quoteIdentifier(table.name)} from ${quoteIdentifier(runtime.login)}`));
          yield* verifyManagedRuntimePrivileges(database, owner.schemaName, {
            schemaName: input.journal.migrationsSchema ?? "drizzle",
            tableName: input.journal.migrationsTable ?? "__drizzle_migrations",
          });
        }
        return result;
      }));
      if ((input.runtimePolicies?.length ?? 0) > 0) yield* publishVerifiedInstallation(handle, input.runtimePolicies ?? [], input.journal);
      else yield* publishFullProofInstallation(handle, input.journal);
      return availability;
    }));
  },
);

const maintenanceMigrationResource = (cause: InstallationLifecycleError) =>
  new FrameworkMigrationSessionResourceIssue({ phase: "beginOrConfigure", cause });

/** The canonical transaction owner also settles bounded READ ONLY artifact
 * reads on the exact maintenance backend. No second admission or transport. */
function makeMaintenanceArtifactReadDriver(target: FrameworkMigrationTarget, policy: FrameworkInstallerPolicy): CatalogControlSessionDriver {
  return {
    runReadEffect: Effect.fn("InstallationMaintenance.readArtifact")(function* <Value, Failure>(
      input: CatalogControlReadInput, work: (database: FlarexMetadataDatabase) => Effect.Effect<Value, Failure>,
    ): Effect.fn.Return<Value, Failure | CatalogControlSessionResourceIssue> {
      const remaining = yield* remainingCatalogControlMilliseconds(input.deadline, "callback")
        .pipe(Effect.mapError(maintenanceCatalogResource));
      const reading = runFrameworkMigrationTargetTransactionEffect(target, { kind: "ordinary",
        lockTimeoutMilliseconds: Math.min(policy.lockTimeoutMilliseconds, remaining),
        statementTimeoutMilliseconds: Math.min(policy.statementTimeoutMilliseconds, remaining) }, transaction =>
        withFrameworkMigrationRawTransactionEffect(transaction, target, work)).pipe(Effect.mapError(cause => cause instanceof FrameworkMigrationSessionResourceIssue ||
          cause instanceof FrameworkMigrationDecisionUncertainIssue || cause instanceof FrameworkMigrationTargetCompositionError
          ? maintenanceCatalogResource(cause) : cause));
      return yield* Effect.raceFirst(reading, Effect.sleep(remaining).pipe(Effect.andThen(
        Effect.fail(maintenanceCatalogResource(new Error("Maintenance artifact read deadline expired."))))));
    }),
    runInitialTransactionEffect: () => Effect.succeed({ kind: "notCommitted",
      cause: Cause.fail(maintenanceCatalogResource(new Error("Maintenance artifact reads cannot admit artifacts."))) }),
    runRecoveryTransactionEffect: () => Effect.succeed({ kind: "unresolved", resolution: { kind: "lifecycle",
      cause: Cause.fail(maintenanceCatalogResource(new Error("Maintenance artifact reads cannot recover writes."))) } }),
  };
}
const maintenanceCatalogResource = (cause: unknown) => new CatalogControlSessionResourceIssue({ phase: "callback", cause });
const decodePhysicalRelationNames = Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ name: Schema.NonEmptyString })));

const protectNewPhysicalTables = Effect.fn("InstallationMaintenance.protectPhysicalTables")(
  function* (owner: Owner, journal: InstallationMigrationJournal) {
    const relations = yield* driver(() => owner.client.query(`select c.relname as name from pg_catalog.pg_class c
      where c.relnamespace = $1::pg_catalog.regnamespace and c.relkind in ('r','p') and not c.relispartition
        and c.relname not in ('fx_system_installation','fx_system_installation_runtime')
        and c.oid <> $2::pg_catalog.regclass and not exists(select 1 from pg_catalog.pg_trigger t
          where t.tgrelid = c.oid and t.tgname = 'fx_00_installation_admission')`,
      [owner.schemaName, journalName(journal)]));
    const names = yield* decodePhysicalRelationNames(relations.rows)
      .pipe(Effect.mapError(cause => fail("invalidInstallation", cause)));
    for (const relation of names) yield* driver(() => owner.client.query(
      `create trigger fx_00_installation_admission before insert or update or delete or truncate on
        ${quoteIdentifier(owner.schemaName)}.${quoteIdentifier(relation.name)} for each statement
        execute function ${quoteIdentifier(owner.schemaName)}.fx_require_active_installation()`));
  },
);

/** Fixed installer operation. No raw database or callback escapes this owner. */
export const backfillInstallationMetadataBindings = Effect.fn("InstallationMaintenance.backfillMetadataBindings")(
  (handle: InstallationMaintenance, controlDb?: FlarexMetadataDatabase) => command(handle, owner =>
    Effect.gen(function* () {
      const immutableCatalog = controlDb ?? owner.database;
      yield* backfillStandaloneApplicationBindings(owner.database, immutableCatalog);
      yield* backfillBindingMetadataProjections(owner.database, immutableCatalog);
    }).pipe(Effect.mapError(cause => fail("invalidInstallation", cause)))),
);

export const backfillInstallationLogicalReadProjections = Effect.fn("InstallationMaintenance.backfillLogicalReads")(
  (handle: InstallationMaintenance) => command(handle, owner =>
    backfillLogicalReadProjections(owner.database).pipe(Effect.mapError(cause => fail("invalidInstallation", cause)))),
);

export interface InstallationMigrationJournal {
  readonly migrationsSchema?: string;
  readonly migrationsTable?: string;
}
export interface InstallationMigrationOptions extends InstallationMigrationJournal {
  readonly migrationsFolder: string;
}
/** Quiescent bootstrap predates the installation row, but still owns one
 * nonreconnecting bounded backend until its migration commands settle. */
export const bootstrapInstallationMigrations = Effect.fn("InstallationMaintenance.bootstrap")(
  function* (config: ClientConfig, schemaName: string, options: InstallationMigrationOptions) {
    yield* Effect.acquireUseRelease(acquireDedicatedClient(config), owned => Effect.gen(function* () {
      const connected = owned.client;
      yield* driver(() => connected.connect());
      yield* driver(() => connected.query("set statement_timeout = '30s'"));
      yield* driver(() => connected.query("select pg_catalog.set_config('search_path', $1, false)",
        [`${quoteIdentifier(schemaName)}, pg_temp`]));
      yield* driver(() => connected.query("select pg_catalog.set_config('flarex.installation_migration_journal', $1, false)",
        [journalName(options)]));
      yield* driver(() => migrate(drizzle(connected, { schema: flarexSchema }), options));
    }), closeDedicatedClient);
  },
);
/** The migrator uses the same dedicated backend as the fence and DML triggers. */
export const runInstallationMigrations = Effect.fn("InstallationMaintenance.migrate")(
  (handle: InstallationMaintenance, options: InstallationMigrationOptions, immutableCatalog?: FlarexMetadataDatabase) =>
    command(handle, owner => Effect.gen(function* () {
      yield* driver(() => owner.client.query("select pg_catalog.set_config('flarex.installation_migration_journal', $1, false)",
        [journalName(options)]));
      yield* prepareTypedMaintenanceMigration(owner.database, immutableCatalog ?? owner.database, owner.schemaName, options).pipe(
        Effect.mapError(cause => fail("invalidInstallation", cause)));
      yield* driver(() => migrate(owner.database, options));
    })),
);

/** Constrained policy changes supplement the runtime's business DML grants.
 * Column grants are revoked too; table REVOKE alone cannot remove them. */
export const configureInstallationRuntimePermissions = Effect.fn("InstallationMaintenance.configureRuntime")(
  (handle: InstallationMaintenance, login: string, journal: InstallationMigrationJournal,
    accessProfile: InstallationAccessProfile = "dataRuntime") =>
    command(handle, owner => configureRuntimePermissions(owner, login, journal, accessProfile)),
);
const configureRuntimePermissions = Effect.fn("InstallationMaintenance.configureRuntimePermissions")(
  function* (owner: Owner, login: string, journal: InstallationMigrationJournal,
    accessProfile: InstallationAccessProfile = "dataRuntime") {
    if (login.length === 0 || login.length > 63) return yield* Effect.fail(fail("invalidCapability"));
    const schema = quoteIdentifier(owner.schemaName), role = quoteIdentifier(login);
    const tables = ["fx_system_installation", "fx_system_installation_runtime", "fx_system_prepared_metadata_epoch",
      "fx_system_application_read_binding", "fx_control_logical_read_source", "fx_control_logical_read_table",
      "fx_control_logical_read_access", ...INDEX_MAINTENANCE_OBLIGATION_TABLES];
    const controlRelations = accessProfile === "controlRead" ? yield* driver(() => owner.client.query<{ table: string }>(
      `select c.relname as table from pg_catalog.pg_class c where c.relnamespace = $1::pg_catalog.regnamespace
        and c.relkind in ('r','p') and not c.relispartition`, [owner.schemaName])) : undefined;
    const selectedTables = controlRelations === undefined ? tables : controlRelations.rows.map(row => row.table);
    const protectedRelations = [...selectedTables.map(table => ({ schemaName: owner.schemaName, table, readable:
      accessProfile !== "controlRead" || controlReadRelations.includes(table) })),
      { schemaName: journal.migrationsSchema ?? "drizzle", table: journal.migrationsTable ?? "__drizzle_migrations", readable: false }];
    for (const relation of protectedRelations) {
      const qualified = `${quoteIdentifier(relation.schemaName)}.${quoteIdentifier(relation.table)}`;
      yield* driver(() => owner.client.query(`revoke all on table ${qualified} from ${role}`));
      const columns = yield* driver(() => owner.client.query<{ name: string }>(`select a.attname as name
        from pg_catalog.pg_attribute a where a.attrelid = $1::pg_catalog.regclass
        and a.attnum > 0 and not a.attisdropped`, [qualified]));
      if (columns.rows.length === 0) return yield* Effect.fail(fail("invalidInstallation"));
      const names = columns.rows.map(column => quoteIdentifier(column.name)).join(",");
      yield* driver(() => owner.client.query(`revoke all (${names}) on table ${qualified} from ${role}`));
      if (relation.readable) yield* driver(() => owner.client.query(`grant select on table ${qualified} to ${role}`));
    }
    for (const build of INDEX_MAINTENANCE_BUILD_PERMISSIONS) {
      const qualified = `${schema}.${quoteIdentifier(build.tableName)}`;
      const columns = yield* driver(() => owner.client.query<{ name: string }>(`select a.attname as name
        from pg_catalog.pg_attribute a where a.attrelid = $1::pg_catalog.regclass
        and a.attnum > 0 and not a.attisdropped`, [qualified]));
      if (!columns.rows.some(column => column.name === build.bindingColumn) ||
        build.writableColumns.some(name => !columns.rows.some(column => column.name === name)))
        return yield* Effect.fail(fail("invalidInstallation"));
      const names = columns.rows.map(column => quoteIdentifier(column.name)).join(",");
      // Column REVOKE cannot counter a table grant. Remove both forms first.
      yield* driver(() => owner.client.query(`revoke insert,update on table ${qualified} from ${role}`));
      yield* driver(() => owner.client.query(`revoke insert (${names}),update (${names}) on table ${qualified} from ${role}`));
      if (accessProfile !== "controlRead") {
        const permitted = build.writableColumns.map(quoteIdentifier).join(",");
        yield* driver(() => owner.client.query(`grant insert (${permitted}),update (${permitted}) on table ${qualified} to ${role}`));
      }
    }
    if (accessProfile !== "controlRead") yield* driver(() => owner.client.query(
      `grant select,insert,update,delete on table ${schema}.fx_system_scope_execution_authority,
        ${schema}.fx_system_metadata_contract_observation to ${role}`));
    yield* driver(() => owner.client.query(`grant usage on schema ${schema} to ${role}`));
    yield* driver(() => owner.client.query(`grant execute on function ${schema}.fx_lock_installation_admission(),
      ${schema}.fx_lock_prepared_metadata_epoch() to ${role}`));
    const frontierHelper = `${schema}.fx_lock_installation_frontier(${schema}.fx_installation_frontier_expected)`;
    const placementFrontier = `${schema}.fx_lock_control_scope_placement(${schema}.fx_installation_frontier_expected,text,text,text)`;
    yield* driver(() => owner.client.query(accessProfile !== "activationWriter"
      ? `grant execute on function ${frontierHelper} to ${role}`
      : `revoke all on function ${frontierHelper} from ${role}`));
    yield* driver(() => owner.client.query(accessProfile === "controlRead"
      ? `grant execute on function ${placementFrontier} to ${role}`
      : `revoke all on function ${placementFrontier} from ${role}`));
    const frontierTypes = `${schema}.fx_installation_frontier_expected,${schema}.fx_installation_frontier`;
    yield* driver(() => owner.client.query(accessProfile !== "activationWriter"
      ? `grant usage on type ${frontierTypes} to ${role}`
      : `revoke all on type ${frontierTypes} from ${role}`));
    yield* driver(() => owner.client.query(accessProfile === "controlRead"
      ? `grant usage on type ${schema}.fx_control_scope_placement to ${role}`
      : `revoke all on type ${schema}.fx_control_scope_placement from ${role}`));
    yield* driver(() => owner.client.query(accessProfile === "dataRuntime"
      ? `grant usage on type ${schema}.fx_finite_capture_frontier,${schema}.fx_finite_read_expected to ${role}`
      : `revoke all on type ${schema}.fx_finite_capture_frontier,${schema}.fx_finite_read_expected from ${role}`));
    yield* driver(() => owner.client.query(accessProfile !== "controlRead"
      ? `grant execute on function ${schema}.fx_publish_application_read_binding(bytea,bytea) to ${role}`
      : `revoke all on function ${schema}.fx_publish_application_read_binding(bytea,bytea) from ${role}`));
    const maintenancePublishers = INDEX_MAINTENANCE_PUBLISHER_FUNCTIONS
      .map(operation => `${schema}.${operation.name}(${operation.signature})`).join(",");
    yield* driver(() => owner.client.query(`revoke all on function ${maintenancePublishers} from public`));
    yield* driver(() => owner.client.query(accessProfile === "activationWriter"
      ? `grant execute on function ${maintenancePublishers} to ${role}`
      : `revoke all on function ${maintenancePublishers} from ${role}`));
    yield* driver(() => owner.client.query(accessProfile === "dataRuntime" ?
      `grant execute on function ${schema}.fx_observe_finite_entry(text,uuid,text,text),
        ${schema}.fx_complete_finite_entry(${schema}.fx_finite_entry_expected,boolean),
        ${schema}.fx_compare_finite_metadata(text,bigint,jsonb),
        ${schema}.fx_accept_finite_storage_capture(text,${schema}.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer,${schema}.fx_finite_read_expected),
        ${schema}.fx_read_snapshot_rows(uuid,integer,bytea[],bigint,bigint,boolean),
        ${schema}.fx_read_historical_row_identity(uuid,integer,bytea),
        ${schema}.fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,integer),
        ${schema}.fx_read_application_ownership_unique_closure(text,text,integer,integer) to ${role}` :
      `revoke all on function ${schema}.fx_observe_finite_entry(text,uuid,text,text),
        ${schema}.fx_complete_finite_entry(${schema}.fx_finite_entry_expected,boolean),
        ${schema}.fx_compare_finite_metadata(text,bigint,jsonb),
        ${schema}.fx_accept_finite_storage_capture(text,${schema}.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer,${schema}.fx_finite_read_expected),
        ${schema}.fx_read_snapshot_rows(uuid,integer,bytea[],bigint,bigint,boolean),
        ${schema}.fx_read_historical_row_identity(uuid,integer,bytea),
        ${schema}.fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,integer) from ${role}`));
    // Activation validates retained ownership in its original target transaction.
    // These bounded invoker reads expose no publication or finite-body capability.
    const ownershipReads = `${schema}.fx_read_application_write_ownership_snapshot(text,integer,integer),
      ${schema}.fx_read_application_ownership_manifest(text,text,integer,integer)`;
    yield* driver(() => owner.client.query(`revoke all on function ${ownershipReads} from public`));
    yield* driver(() => owner.client.query(accessProfile !== "controlRead"
      ? `grant execute on function ${ownershipReads} to ${role}`
      : `revoke all on function ${ownershipReads} from ${role}`));
    if (accessProfile === "controlRead") yield* driver(() => owner.client.query(
      `grant execute on function ${schema}.fx_read_application_ownership_unique_closure(text,text,integer,integer) to ${role}`));
    if (accessProfile === "activationWriter") yield* driver(() => owner.client.query(
      `revoke all on function ${schema}.fx_read_application_ownership_unique_closure(text,text,integer,integer) from ${role}`));
    const publicationFunctions = [...FINITE_PUBLICATION_FUNCTIONS, ...APPLICATION_DOMAIN_FUNCTIONS]
      .map(operation => `${schema}.${operation.name}(${operation.signature.replaceAll("fx_app_", `${schema}.fx_app_`)})`).join(",");
    const publicationTypes = APPLICATION_DOMAIN_TYPES.map(type => `${schema}.${quoteIdentifier(type.name)}`).join(",");
    yield* driver(() => owner.client.query(accessProfile === "dataRuntime"
      ? `grant execute on function ${publicationFunctions} to ${role}`
      : `revoke all on function ${publicationFunctions} from ${role}`));
    yield* driver(() => owner.client.query(accessProfile === "dataRuntime"
      ? `grant usage on type ${publicationTypes} to ${role}`
      : `revoke all on type ${publicationTypes} from ${role}`));
    yield* driver(() => owner.client.query(`revoke all on function ${schema}.fx_require_active_installation(),
      ${schema}.fx_invalidate_prepared_metadata(), ${schema}.fx_check_scope_execution_authority() from ${role}`));
  },
);

/** Verify while all serving is closed, publish exact restricted-login policy,
 * then reopen. A failure leaves durable draining and no reusable runtime fact. */
export const publishVerifiedInstallation = Effect.fn("InstallationMaintenance.publishVerified")(
  function* (handle: InstallationMaintenance, runtimePolicies: ReadonlyArray<Readonly<{
    database: FlarexMetadataDatabase; endpointPolicy: string; accessProfile?: InstallationAccessProfile;
  }>>, journal: InstallationMigrationJournal) {
    const owner = owners.get(handle);
    if (owner === undefined || owner.phase !== "commands") return yield* Effect.fail(fail("invalidCapability"));
    if (runtimePolicies.length < 1 || runtimePolicies.length > 64) return yield* Effect.fail(fail("invalidInstallation"));
    owner.phase = "verifying";
    return yield* owner.lane.withPermits(1)(verifyAndPublish(owner, runtimePolicies, journal));
  },
);

export const publishFullProofInstallation = Effect.fn("InstallationMaintenance.publishFullProof")(
  function* (handle: InstallationMaintenance, journal: InstallationMigrationJournal) {
    const owner = owners.get(handle);
    if (owner === undefined || owner.phase !== "commands") return yield* Effect.fail(fail("invalidCapability"));
    owner.phase = "verifying";
    return yield* owner.lane.withPermits(1)(verifyAndPublish(owner, [], journal));
  },
);

const verifyAndPublish = Effect.fn("InstallationMaintenance.verifyAndPublish")(
  function* (owner: Owner, runtimePolicies: ReadonlyArray<Readonly<{
    database: FlarexMetadataDatabase; endpointPolicy: string; accessProfile?: InstallationAccessProfile;
  }>>, journal: InstallationMigrationJournal) {
    yield* assertOwner(owner);
    yield* verifyInstallationWriterProtection(owner.database, owner.schemaName, {
      schemaName: journal.migrationsSchema ?? "drizzle", tableName: journal.migrationsTable ?? "__drizzle_migrations",
    });
    const gateResult = yield* driver(() => owner.client.query(`select incarnation::text,
      structural_generation::text as generation, database_name as "databaseName", namespace_oid::text as "namespaceOid"
      from ${quoteIdentifier(owner.schemaName)}.fx_system_installation where singleton_id = 1`));
    const [gate] = yield* decodeGate(gateResult.rows).pipe(Effect.mapError(cause => fail("invalidInstallation", cause)));
    for (const policy of runtimePolicies) {
      const accessProfile = policy.accessProfile ?? "dataRuntime";
      if (policy.endpointPolicy.length === 0) return yield* Effect.fail(fail("invalidInstallation"));
      const observed = yield* Effect.tryPromise({ try: () => policy.database.execute(`select session_user as login,
        current_database() as "databaseName", current_schema() as "schemaName", current_user = session_user as "sameLogin"`),
        catch: cause => fail("resourceFailure", cause) });
      const runtimeRows = yield* Schema.decodeUnknownEffect(Schema.Struct({ rows: Schema.Unknown }))(observed).pipe(
        Effect.mapError(cause => fail("invalidInstallation", cause)));
      const [runtime] = yield* decodeRuntime(runtimeRows.rows).pipe(Effect.mapError(cause => fail("invalidInstallation", cause)));
      if (!runtime.sameLogin || runtime.databaseName !== gate.databaseName ||
        (accessProfile !== "controlRead" && runtime.schemaName !== owner.schemaName))
        return yield* Effect.fail(fail("changed"));
      yield* configureRuntimePermissions(owner, runtime.login, journal, accessProfile);
      // One finite read-only transaction observes the actual login under the
      // selected installed namespace. SET LOCAL never changes its pool default.
      const verified = yield* Effect.uninterruptible(Effect.tryPromise({
        try: () => policy.database.transaction(async tx => {
          await tx.execute(sql`select pg_catalog.set_config('search_path',
            pg_catalog.format('%I, pg_temp', ${owner.schemaName}::text), true)`);
          return Effect.runPromiseExit(Effect.gen(function* () {
            const attestation = yield* attestProtectedMetadataInstallation(tx).pipe(
              Effect.mapError(cause => fail("invalidInstallation", cause)));
            yield* verifyManagedRuntimePrivileges(tx, owner.schemaName, {
              schemaName: journal.migrationsSchema ?? "drizzle", tableName: journal.migrationsTable ?? "__drizzle_migrations",
            }, accessProfile);
            return attestation;
          }));
        }), catch: cause => fail("resourceFailure", cause),
      }));
      if (Exit.isFailure(verified)) return yield* Effect.failCause(verified.cause);
      const attestation = verified.value;
      if (attestation.databaseName !== gate.databaseName || attestation.namespaceOid.toString() !== gate.namespaceOid)
        return yield* Effect.fail(fail("changed"));
      // Check installation tables cannot be forged and the actual login can only
      // invoke the pinned gate. The old full attestation covers the other roles,
      // functions, triggers, epoch permissions and restricted-login predicates.
      yield* driver(() => owner.client.query(`insert into ${quoteIdentifier(owner.schemaName)}.fx_system_installation_runtime
        (login, login_oid, endpoint_policy, incarnation, structural_generation, metadata_incarnation, access_profile)
        select $1::text, $1::text::pg_catalog.regrole::oid::bigint, $2, incarnation, structural_generation, $3, $5
        from ${quoteIdentifier(owner.schemaName)}.fx_system_installation where singleton_id = 1 and maintenance_owner = $4`,
      [attestation.login, policy.endpointPolicy, attestation.incarnation, owner.job, accessProfile]));
    }
    yield* assertOwner(owner);
    const opened = yield* driver(() => owner.client.query(`update ${quoteIdentifier(owner.schemaName)}.fx_system_installation
      set state = 'active', maintenance_owner = null, maintenance_pid = null, maintenance_backend_start = null
      where singleton_id = 1 and state = 'draining' and maintenance_owner = $1 and maintenance_pid = pg_backend_pid()
        and structural_generation = $2::bigint and incarnation = $3::uuid
        and maintenance_backend_start = (select backend_start from pg_catalog.pg_stat_activity where pid = pg_backend_pid())`,
      [owner.job, owner.generation, owner.incarnation]));
    if (opened.rowCount !== 1) return yield* Effect.fail(fail("changed"));
    owner.phase = "reopened";
  },
);

const command = Effect.fn("InstallationMaintenance.commandLane")(
  function* <Value, Failure, Requirements>(handle: InstallationMaintenance,
    operation: (owner: Owner) => Effect.Effect<Value, Failure, Requirements>) {
    const owner = owners.get(handle);
    if (owner === undefined || owner.phase !== "commands") return yield* Effect.fail(fail("invalidCapability"));
    if (owner.queued >= 64) return yield* Effect.fail(fail("busy"));
    owner.queued++;
    return yield* owner.lane.withPermits(1)(Effect.gen(function* () {
      if (owner.phase !== "commands") return yield* Effect.fail(fail("invalidCapability"));
      yield* assertOwner(owner);
      // Every foreign command or finite backfill unit owns its settlement mask.
      // The lane remains cancellable between units, then drains before close.
      return yield* operation(owner);
    })).pipe(Effect.ensuring(Effect.sync(() => { owner.queued--; })));
  },
);

const assertOwner = Effect.fn("InstallationMaintenance.assertOwner")(function* (owner: Owner) {
  const result = yield* driver(() => owner.client.query(`select 1 from ${quoteIdentifier(owner.schemaName)}.fx_system_installation
    where singleton_id = 1 and state = 'draining' and maintenance_owner = $1
      and structural_generation = $2::bigint and incarnation = $3::uuid
      and maintenance_pid = pg_backend_pid() and maintenance_backend_start = (
        select backend_start from pg_catalog.pg_stat_activity where pid = pg_backend_pid())`, [owner.job, owner.generation, owner.incarnation]));
  if (result.rows.length !== 1) return yield* Effect.fail(fail("changed"));
});

function driver<Value>(run: () => Promise<Value>): Effect.Effect<Value, InstallationLifecycleError> {
  return Effect.uninterruptible(Effect.tryPromise({ try: run, catch: cause => new MaintenanceDriverFailure({ cause }) }).pipe(
    Effect.mapError(error => fail("resourceFailure", error.cause))));
}
function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function journalName(journal: InstallationMigrationJournal): string {
  return `${quoteIdentifier(journal.migrationsSchema ?? "drizzle")}.${quoteIdentifier(journal.migrationsTable ?? "__drizzle_migrations")}`;
}

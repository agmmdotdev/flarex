import { sql } from "drizzle-orm";
import { Data, Effect } from "effect";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxSystemPreparedMetadataEpoch } from "./schema";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";

/** Immutable target projection and complete sidecar membership. Control,
 * coverage, live heads and physical catalogs keep their owned fresh proofs. */
const coveredTables = [
  "fx_system_application_candidate_v1",
  "fx_system_application_analysis_v1",
  "fx_system_application_revision_v2",
  "fx_system_application_publication_v1",
  "fx_system_application_function_v1",
  "fx_system_application_task_catalog_v1",
  "fx_system_application_task_definition_v1",
  "fx_system_application_revision_schema_v1",
  "fx_system_application_readiness_v1",
  "fx_system_application_readiness_function_v1",
  "fx_system_application_publication",
  "fx_system_application_function",
  "fx_system_application_task_catalog",
  "fx_system_application_task_definition",
  "fx_system_application_revision_schema",
  "fx_system_application_readiness",
  "fx_system_application_readiness_relation",
  "fx_system_application_readiness_function",
  "fx_system_application_activation",
  "fx_system_application_write_ownership",
  "fx_system_data_binding_candidate",
  "fx_system_data_binding_physical_lane",
  "fx_system_data_binding_activation",
] as const;

export class PreparedMetadataEpochError extends Data.TaggedError("PreparedMetadataEpochError")<{
  readonly reason: "unprotectedRuntime" | "invalidEpoch" | "changed" | "busy" | "resourceFailure";
  readonly cause?: unknown;
}> {}

const issue = (reason: PreparedMetadataEpochError["reason"], cause?: unknown) =>
  new PreparedMetadataEpochError({ reason, ...(cause === undefined ? {} : { cause }) });

const coveredNames = sql`ARRAY[${sql.join(coveredTables.map(name => sql`${name}`), sql`, `)}]::text[]`;

// The security proof is deliberately checked on the authenticated login. A
// restricted current_user reached through SET ROLE is insufficient. The
// installation owner and privileged repair actor are outside the cache lane.
const protectionSql = sql<boolean>`(
  current_user = session_user
  and pg_catalog.current_setting('session_replication_role') = 'origin'
  and exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = session_user and r.rolcanlogin
      and not (r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls)
      and not exists(select 1 from pg_catalog.pg_auth_members m where m.member = r.oid)
      and not pg_catalog.has_parameter_privilege(r.oid, 'session_replication_role', 'SET')
      and not pg_catalog.has_database_privilege(r.oid, current_database(), 'CREATE')
      and not pg_catalog.has_schema_privilege(r.oid, current_schema(), 'CREATE')
      and not exists(select 1 from pg_catalog.pg_database d where d.datname = current_database() and d.datdba = r.oid)
      and not exists(select 1 from pg_catalog.pg_namespace n where n.nspname = current_schema() and n.nspowner = r.oid)
  )
  and exists (
    select 1 from pg_catalog.pg_class e
    where e.relnamespace = pg_catalog.current_schema()::pg_catalog.regnamespace
      and e.relname = 'fx_system_prepared_metadata_epoch'
      and e.relkind = 'r' and not e.relispartition
      and e.relowner <> (select oid from pg_catalog.pg_roles where rolname = session_user)
      and not pg_catalog.has_table_privilege(session_user, e.oid, 'INSERT')
      and not pg_catalog.has_table_privilege(session_user, e.oid, 'UPDATE')
      and not pg_catalog.has_any_column_privilege(session_user, e.oid, 'INSERT')
      and not pg_catalog.has_any_column_privilege(session_user, e.oid, 'UPDATE')
      and not pg_catalog.has_table_privilege(session_user, e.oid, 'DELETE')
      and not pg_catalog.has_table_privilege(session_user, e.oid, 'TRUNCATE')
      and not pg_catalog.has_table_privilege(session_user, e.oid, 'TRIGGER')
  )
  and exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    join pg_catalog.pg_class e on e.relnamespace = p.pronamespace
      and e.relname = 'fx_system_prepared_metadata_epoch'
    where p.pronamespace = pg_catalog.current_schema()::pg_catalog.regnamespace
      and p.proname = 'fx_invalidate_prepared_metadata' and p.pronargs = 0
      and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
      and l.lanname = 'plpgsql' and p.provolatile = 'v'
      and p.prosecdef and p.proconfig = array['search_path=pg_catalog, pg_temp']
      and p.proowner = e.relowner
      and p.proowner <> (select oid from pg_catalog.pg_roles where rolname = session_user)
      and not pg_catalog.has_function_privilege(session_user, p.oid, 'EXECUTE')
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.replace(p.prosrc, E'\\r\\n', E'\\n'), 'UTF8')), 'hex') =
        'b6a3a503098f229e336443c57088f500fefc7e957394d68499a4fd0ca25976be'
  )
  and exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    join pg_catalog.pg_class e on e.relnamespace = p.pronamespace
      and e.relname = 'fx_system_prepared_metadata_epoch'
    where p.pronamespace = pg_catalog.current_schema()::pg_catalog.regnamespace
      and p.proname = 'fx_lock_prepared_metadata_epoch' and p.pronargs = 0
      and l.lanname = 'sql' and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype
      and p.proallargtypes = ARRAY[25, 20, 2950, 20]::oid[]
      and p.proargmodes::text = '{t,t,t,t}'
      and p.proargnames = ARRAY['database_name', 'namespace_oid', 'incarnation', 'generation']::text[]
      and p.prosecdef and p.provolatile = 'v'
      and p.proconfig = array['search_path=pg_catalog, pg_temp']
      and p.proowner = e.relowner
      and p.proowner <> (select oid from pg_catalog.pg_roles where rolname = session_user)
      and pg_catalog.has_function_privilege(session_user, p.oid, 'EXECUTE')
      and p.prosrc = pg_catalog.format(E'\n      SELECT e.database_name, e.namespace_oid, e.incarnation, e.generation\n      FROM %I.fx_system_prepared_metadata_epoch e\n      WHERE e.singleton_id = 1 AND e.database_name = current_database()\n      FOR SHARE NOWAIT\n    ', current_schema())
  )
  and (
    select count(*) = ${coveredTables.length} and bool_and(
      c.relkind = 'r' and not c.relispartition and not c.relhasrules
      and not c.relrowsecurity
      and c.relowner <> (select oid from pg_catalog.pg_roles where rolname = session_user)
      and not pg_catalog.has_table_privilege(session_user, c.oid, 'TRUNCATE')
      and not pg_catalog.has_table_privilege(session_user, c.oid, 'TRIGGER')
      and exists (
        select 1 from pg_catalog.pg_trigger t join pg_catalog.pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = c.oid and t.tgname = 'fx_prepared_metadata_invalidate'
          and not t.tgisinternal and t.tgenabled = 'O' and t.tgtype = 62
          and t.tgconstraint = 0 and t.tgqual is null and t.tgoldtable is null
          and t.tgnewtable is null and t.tgnargs = 0
          and p.pronamespace = c.relnamespace and p.proname = 'fx_invalidate_prepared_metadata'
      )
    )
    from pg_catalog.pg_class c
    where c.relnamespace = pg_catalog.current_schema()::pg_catalog.regnamespace
      and c.relname = any(${coveredNames})
  )
)`;

export interface ProtectedMetadataEpochIdentity {
  readonly databaseName: string;
  readonly namespaceOid: bigint;
  readonly incarnation: string;
  readonly generation: bigint;
  readonly login: string;
}

/** Internal issuer-owned evidence; the preparation token remains nominal. */
export interface ProtectedTargetMetadataEvidence {
  readonly database: FlarexMetadataDatabase;
  readonly token: ProtectedMetadataPreparation;
  readonly epoch: ProtectedMetadataEpochIdentity;
}

declare const protectedMetadataBrand: unique symbol;
export interface ProtectedMetadataPreparation {
  readonly [protectedMetadataBrand]: true;
}
const preparations = new WeakMap<object, Readonly<{ database: FlarexMetadataDatabase; identity: ProtectedMetadataEpochIdentity }>>();
const finalGuardScopes = new WeakMap<object, Map<FlarexMetadataDatabase, Readonly<{
  prepared: ProtectedMetadataPreparation;
  expected: ProtectedMetadataEpochIdentity;
}>>>();

const readIdentity = Effect.fn("PreparedMetadataEpoch.readIdentity")(function* (
  db: FlarexMetadataDatabase | FlarexMetadataTransaction,
  lock: boolean,
) {
  const source = lock ? sql`fx_lock_prepared_metadata_epoch()` : sql`${fxSystemPreparedMetadataEpoch}`;
  const query = db.select({
    databaseName: sql<string>`epoch.database_name`,
    namespaceOid: sql<string>`epoch.namespace_oid::text`,
    incarnation: sql<string>`epoch.incarnation::text`,
    generation: sql<string>`epoch.generation::text`,
    login: sql<string>`session_user`,
    actualDatabase: sql<string>`current_database()`,
    actualNamespaceOid: sql<string>`(select oid::text from pg_catalog.pg_namespace where nspname = current_schema())`,
    sameLogin: sql<boolean>`current_user = session_user`,
    protected: protectionSql,
  }).from(sql`${source} as epoch`).limit(2);
  const rows = yield* runDrizzleStatementEffect(
    query,
    cause => issue(isLockUnavailable(cause) ? "busy" : "resourceFailure", cause),
  );
  const row = rows[0];
  if (rows.length !== 1 || row === undefined ||
    row.databaseName !== row.actualDatabase || row.namespaceOid !== row.actualNamespaceOid ||
    !/^[1-9][0-9]*$/.test(row.generation) || typeof row.incarnation !== "string") {
    return yield* Effect.fail(issue("invalidEpoch"));
  }
  if (row.protected !== true || row.sameLogin !== true || typeof row.login !== "string") {
    return yield* Effect.fail(issue("unprotectedRuntime"));
  }
  return Object.freeze({ databaseName: row.databaseName, namespaceOid: BigInt(row.namespaceOid),
    incarnation: row.incarnation, generation: BigInt(row.generation), login: row.login }) satisfies ProtectedMetadataEpochIdentity;
});

/** Called only for a PostgreSQL restricted-runtime pool. A PGlite owner pool or
 * migration credential cannot mint this capability and keeps full hash checks. */
export const prepareProtectedMetadata = Effect.fn("PreparedMetadataEpoch.prepare")(function* (
  database: FlarexMetadataDatabase,
) {
  const identity = yield* readIdentity(database, false);
  // SAFETY: only this issuer records a newly frozen token in the private
  // WeakMap; consumers cannot manufacture a recognized preparation.
  const token = Object.freeze({}) as ProtectedMetadataPreparation;
  preparations.set(token, Object.freeze({ database, identity }));
  return token;
});

/** Captures the generation in a preparation snapshot after structural reads. */
export const captureProtectedMetadataEpoch = Effect.fn("PreparedMetadataEpoch.capture")(function* (
  prepared: ProtectedMetadataPreparation, database: FlarexMetadataDatabase,
  tx: FlarexMetadataTransaction,
) {
  const state = preparations.get(prepared);
  if (state === undefined || state.database !== database) return yield* Effect.fail(issue("unprotectedRuntime"));
  const current = yield* readIdentity(tx, false);
  if (!sameInstallation(current, state.identity)) return yield* Effect.fail(issue("changed"));
  return current;
});

/** After a complete first canonical read, authenticate it against the original
 * preparation's before-anchor before retaining any cross-transaction structure.
 * This read takes no epoch lock; the accepting tail still owns NOWAIT locking. */
export const authenticateProtectedTargetMetadataSnapshot = Effect.fn("PreparedMetadataEpoch.authenticateTargetSnapshot")(
  function* (evidence: ProtectedTargetMetadataEvidence, tx: FlarexMetadataTransaction) {
    const current = yield* captureProtectedMetadataEpoch(evidence.token, evidence.database, tx);
    if (!sameInstallation(current, evidence.epoch) || current.generation !== evidence.epoch.generation)
      return yield* Effect.fail(issue("changed"));
  },
);

/** Last metadata acquisition in an accepting transaction. NOWAIT avoids a
 * clock/row versus epoch lock cycle; busy rejects this whole transaction. */
export const guardProtectedMetadataEpoch = Effect.fn("PreparedMetadataEpoch.guard")(function* (
  prepared: ProtectedMetadataPreparation, database: FlarexMetadataDatabase,
  expected: ProtectedMetadataEpochIdentity, tx: FlarexMetadataTransaction,
) {
  const state = preparations.get(prepared);
  if (state === undefined || state.database !== database ||
    !sameInstallation(expected, state.identity)) return yield* Effect.fail(issue("unprotectedRuntime"));
  const current = yield* readIdentity(tx, true);
  if (!sameInstallation(current, expected) || current.generation !== expected.generation)
    return yield* Effect.fail(issue("changed"));
});

const sameInstallation = (left: ProtectedMetadataEpochIdentity, right: ProtectedMetadataEpochIdentity) =>
  left.databaseName === right.databaseName && left.namespaceOid === right.namespaceOid &&
  left.incarnation === right.incarnation && left.login === right.login;

/** Only the exact running-attempt transaction kernel opens and flushes this
 * scope. A cached admission attempted from another transaction fails closed. */
export function openProtectedMetadataFinalGuardScope(tx: FlarexMetadataTransaction): void {
  if (finalGuardScopes.has(tx)) throw new Error("Protected metadata guard scope already opened");
  finalGuardScopes.set(tx, new Map());
}

export function closeProtectedMetadataFinalGuardScope(tx: FlarexMetadataTransaction): void {
  finalGuardScopes.delete(tx);
}

/** Callers outside the exact running-attempt owner use their full live proof. */
export function hasProtectedMetadataFinalGuardScope(tx: FlarexMetadataTransaction): boolean {
  return finalGuardScopes.has(tx);
}

export const registerProtectedMetadataFinalGuard = Effect.fn("PreparedMetadataEpoch.registerFinalGuard")(function* (
  tx: FlarexMetadataTransaction, prepared: ProtectedMetadataPreparation,
  database: FlarexMetadataDatabase, expected: ProtectedMetadataEpochIdentity,
) {
  const scope = finalGuardScopes.get(tx);
  if (scope === undefined) return yield* Effect.fail(issue("unprotectedRuntime"));
  const prior = scope.get(database);
  if (prior !== undefined && (!sameInstallation(prior.expected, expected) ||
    prior.expected.generation !== expected.generation)) {
    return yield* Effect.fail(issue("changed"));
  }
  scope.set(database, Object.freeze({ prepared, expected }));
});

export const flushProtectedMetadataFinalGuards = Effect.fn("PreparedMetadataEpoch.flushFinalGuards")(function* (
  tx: FlarexMetadataTransaction,
) {
  const scope = finalGuardScopes.get(tx);
  if (scope === undefined) return yield* Effect.fail(issue("unprotectedRuntime"));
  for (const [database, guard] of scope) {
    yield* guardProtectedMetadataEpoch(guard.prepared, database, guard.expected, tx);
  }
  finalGuardScopes.delete(tx);
});

function isLockUnavailable(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if ("code" in value && value.code === "55P03") return true;
  return "cause" in value && isLockUnavailable(value.cause);
}

import { sql, type SQL } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import { copyBytesToArrayBuffer, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";

import type { FlarexMetadataDatabase } from "./deployments";
import { fxSystemPreparedMetadataEpoch } from "./schema";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { runningAttemptTailProtectionSql } from "./exactRunningAttemptTail";
import { acquireInstallationAdmission, lockInstallationForCurrentTransaction,
  isManagedInstallationTransaction, managedInstallationMetadataIncarnation, managedInstallationSchema,
  managedInstallationIdentity,
  isCoLocatedInstallationTransaction,
  type PreparedInstallation } from "./installationLifecycle";

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
  "fx_system_application_active_head",
  "fx_system_application_write_ownership",
  "fx_system_data_binding_candidate",
  "fx_system_data_binding_physical_lane",
  "fx_system_data_binding_activation",
  "fx_system_application_read_binding",
  "fx_control_logical_read_source",
  "fx_control_logical_read_table",
  "fx_control_logical_read_access",
] as const;

export class PreparedMetadataEpochError extends Data.TaggedError("PreparedMetadataEpochError")<{
  readonly reason: "unprotectedRuntime" | "invalidEpoch" | "changed" | "busy" | "resourceFailure";
  readonly cause?: unknown;
}> {}

class PreparedMetadataDigestRejection extends Data.TaggedError("PreparedMetadataDigestRejection")<{
  readonly cause: unknown;
}> {}

const issue = (reason: PreparedMetadataEpochError["reason"], cause?: unknown) =>
  new PreparedMetadataEpochError({ reason, ...(cause === undefined ? {} : { cause }) });

const coveredNames = sql`ARRAY[${sql.join(coveredTables.map(name => sql`${name}`), sql`, `)}]::text[]`;

// The security proof is deliberately checked on the authenticated login. A
// restricted current_user reached through SET ROLE is insufficient. The
// installation owner and privileged repair actor are outside the cache lane.
// Materialization bounds catalog planning and resolves each installation fact
// once per complete attestation. These observations never cross a statement.
const protectionSql = sql<boolean>`(
  with attestation_context as materialized (
    select r.*, current_schema() as schema_name, ${coveredNames} as covered_names,
      current_schema()::pg_catalog.regnamespace as namespace_oid
    from pg_catalog.pg_roles r where r.rolname = session_user
  ), attestation_tables as materialized (
    select c.* from pg_catalog.pg_class c cross join attestation_context bounds
    where c.relnamespace = bounds.namespace_oid
      and (c.relname = any(bounds.covered_names) or c.relname in (
        'fx_system_prepared_metadata_epoch', 'fx_system_tx_journal', 'fx_system_tx_execution_claim'))
  ), attestation_functions as materialized (
    select p.*, l.lanname from pg_catalog.pg_proc p
    left join pg_catalog.pg_language l on l.oid = p.prolang
    where p.pronamespace = (select namespace_oid from attestation_context)
      and p.proname in ('fx_invalidate_prepared_metadata', 'fx_lock_prepared_metadata_epoch', 'fx_lock_running_attempt_tail')
  ), attestation_guarded_tables as materialized (
    select distinct t.tgrelid from pg_catalog.pg_trigger t
    join attestation_tables c on c.oid = t.tgrelid
    join attestation_functions p on p.oid = t.tgfoid
    cross join attestation_context bounds
    where c.relname = any(bounds.covered_names)
      and t.tgname = 'fx_prepared_metadata_invalidate'
      and not t.tgisinternal and t.tgenabled = 'O' and t.tgtype = 62
      and t.tgconstraint = 0 and t.tgqual is null and t.tgoldtable is null
      and t.tgnewtable is null and t.tgnargs = 0
      and p.pronamespace = c.relnamespace and p.proname = 'fx_invalidate_prepared_metadata'
  )
  select ${runningAttemptTailProtectionSql(sql`attestation_functions`, sql`attestation_tables`, sql`attestation_context`)}
  and
  current_user = session_user
  and pg_catalog.current_setting('session_replication_role') = 'origin'
  and exists (
    select 1 from attestation_context r
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
    select 1 from attestation_tables e
    where e.relnamespace = (select namespace_oid from attestation_context)
      and e.relname = 'fx_system_prepared_metadata_epoch'
      and e.relkind = 'r' and not e.relispartition
      and e.relowner <> (select oid from attestation_context)
      and not pg_catalog.has_table_privilege((select oid from attestation_context), e.oid, 'INSERT')
      and not pg_catalog.has_table_privilege((select oid from attestation_context), e.oid, 'UPDATE')
      and not pg_catalog.has_any_column_privilege((select oid from attestation_context), e.oid, 'INSERT')
      and not pg_catalog.has_any_column_privilege((select oid from attestation_context), e.oid, 'UPDATE')
      and not pg_catalog.has_table_privilege((select oid from attestation_context), e.oid, 'DELETE')
      and not pg_catalog.has_table_privilege((select oid from attestation_context), e.oid, 'TRUNCATE')
      and not pg_catalog.has_table_privilege((select oid from attestation_context), e.oid, 'TRIGGER')
  )
  and exists (
    select 1 from attestation_functions p
    join attestation_tables e on e.relnamespace = p.pronamespace
      and e.relname = 'fx_system_prepared_metadata_epoch'
    where p.pronamespace = (select namespace_oid from attestation_context)
      and p.proname = 'fx_invalidate_prepared_metadata' and p.pronargs = 0
      and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
      and p.lanname = 'plpgsql' and p.provolatile = 'v'
      and p.prosecdef and p.proconfig = array['search_path=pg_catalog, pg_temp']
      and p.proowner = e.relowner
      and p.proowner <> (select oid from attestation_context)
      and not pg_catalog.has_function_privilege((select oid from attestation_context), p.oid, 'EXECUTE')
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        pg_catalog.replace(p.prosrc, E'\\r\\n', E'\\n'), 'UTF8')), 'hex') =
        'b6a3a503098f229e336443c57088f500fefc7e957394d68499a4fd0ca25976be'
  )
  and exists (
    select 1 from attestation_functions p
    join attestation_tables e on e.relnamespace = p.pronamespace
      and e.relname = 'fx_system_prepared_metadata_epoch'
    where p.pronamespace = (select namespace_oid from attestation_context)
      and p.proname = 'fx_lock_prepared_metadata_epoch' and p.pronargs = 0
      and p.lanname = 'sql' and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype
      and p.proallargtypes = ARRAY[25, 20, 2950, 20]::oid[]
      and p.proargmodes::text = '{t,t,t,t}'
      and p.proargnames = ARRAY['database_name', 'namespace_oid', 'incarnation', 'generation']::text[]
      and p.prosecdef and p.provolatile = 'v'
      and p.proconfig = array['search_path=pg_catalog, pg_temp']
      and p.proowner = e.relowner
      and p.proowner <> (select oid from attestation_context)
      and pg_catalog.has_function_privilege((select oid from attestation_context), p.oid, 'EXECUTE')
      and p.prosrc = pg_catalog.format(E'\n      SELECT e.database_name, e.namespace_oid, e.incarnation, e.generation\n      FROM %I.fx_system_prepared_metadata_epoch e\n      WHERE e.singleton_id = 1 AND e.database_name = current_database()\n      FOR SHARE NOWAIT\n    ', (select schema_name from attestation_context))
  )
  and (
    select count(*) = ${coveredTables.length} and bool_and(
      c.relkind = 'r' and not c.relispartition and not c.relhasrules
      and not c.relrowsecurity
      and c.relowner <> (select oid from attestation_context)
      and not pg_catalog.has_table_privilege((select oid from attestation_context), c.oid, 'TRUNCATE')
      and not pg_catalog.has_table_privilege((select oid from attestation_context), c.oid, 'TRIGGER')
      and guarded.tgrelid is not null
    )
    from attestation_tables c
    left join attestation_guarded_tables guarded on guarded.tgrelid = c.oid
    cross join attestation_context bounds
    where c.relnamespace = bounds.namespace_oid
      and c.relname = any(bounds.covered_names)
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
const preparations = new WeakMap<object, Readonly<{ database: FlarexMetadataDatabase; identity: ProtectedMetadataEpochIdentity;
  installation?: PreparedInstallation }>>();
const finalGuardScopes = new WeakMap<object, Map<string, Readonly<{
  database: FlarexMetadataDatabase;
  prepared: ProtectedMetadataPreparation;
  expected: ProtectedMetadataEpochIdentity;
}>>>();
const managedSnapshots = new WeakMap<object, Map<PreparedInstallation, ProtectedMetadataEpochIdentity>>();
const pendingFinalGuardBatches = new WeakMap<object, ReadonlyArray<Readonly<{
  key: string; database: FlarexMetadataDatabase; prepared: ProtectedMetadataPreparation;
  expected: ProtectedMetadataEpochIdentity;
}>>>();
const epochIdentitySchema = Schema.Struct({ databaseName: Schema.NonEmptyString,
  namespaceOid: Schema.BigInt.check(Schema.isGreaterThanBigInt(0n)),
  incarnation: Schema.String.check(Schema.isUUID()),
  generation: Schema.BigInt.check(Schema.isGreaterThanBigInt(0n)), login: Schema.NonEmptyString });
const decodeEpochIdentity = Schema.decodeUnknownEffect(epochIdentitySchema);
const positiveIntegerText = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/));
const decodeManagedEpochRows = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({
  ...epochIdentitySchema.fields, namespaceOid: positiveIntegerText, generation: positiveIntegerText,
  actualDatabase: Schema.NonEmptyString, sameLogin: Schema.Boolean,
})]));
const decodeFinalGuardRows = Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ valid: Schema.Boolean })]));

/** Only a pair-admitted accepting query may record its actual bounded epoch
 * projection. Reuse ends with this transaction; final NOWAIT remains fresh. */
export const recordManagedMetadataEpochSnapshot = Effect.fn("PreparedMetadataEpoch.recordManagedSnapshot")(
  function* (tx: FlarexMetadataTransaction, database: FlarexMetadataDatabase,
    installation: PreparedInstallation, raw: unknown) {
    const installed = managedInstallationIdentity(installation, database);
    const metadataIncarnation = managedInstallationMetadataIncarnation(installation, database);
    if (installed === undefined || metadataIncarnation === undefined ||
      !isCoLocatedInstallationTransaction(tx, database, installation))
      return yield* Effect.fail(issue("unprotectedRuntime"));
    const identity = yield* decodeEpochIdentity(raw).pipe(
      Effect.mapError(cause => issue("invalidEpoch", cause)));
    if (identity.databaseName !== installed.databaseName || identity.namespaceOid.toString() !== installed.namespaceOid ||
      identity.incarnation !== metadataIncarnation || identity.login !== installed.login)
      return yield* Effect.fail(issue("changed"));
    const snapshots = managedSnapshots.get(tx) ?? new Map();
    const prior = snapshots.get(installation);
    if (prior !== undefined && (!sameInstallation(identity, prior) || identity.generation !== prior.generation))
      return yield* Effect.fail(issue("changed"));
    snapshots.set(installation, Object.freeze(identity));
    managedSnapshots.set(tx, snapshots);
  },
);

/** Transaction entry owns this interlock before any scope/head/clock lock.
 * A protected preparation authenticates immutable bytes; admission stays fresh. */
export const acquireProtectedMetadataInstallationAdmission = Effect.fn("PreparedMetadataEpoch.acquireInstallation")(
  function* (prepared: ProtectedMetadataPreparation, database: FlarexMetadataDatabase,
    tx: FlarexMetadataTransaction) {
    const state = preparations.get(prepared);
    if (state === undefined || state.database !== database)
      return yield* Effect.fail(issue("unprotectedRuntime"));
    yield* (state.installation === undefined ? lockInstallationForCurrentTransaction(tx) :
      acquireInstallationAdmission(state.installation, database, tx)).pipe(
      Effect.mapError(cause => issue(cause.reason === "busy" ? "busy" :
        cause.reason === "changed" ? "changed" : "unprotectedRuntime", cause)));
  },
);

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
    // Single-table selection copies its outer SQL field. Keep the public
    // inline flag on this nested, entirely owner-constant proof fragment.
    protected: sql<boolean>`${protectionSql.inlineParams()}`,
  }).from(sql`(select database_name, namespace_oid, incarnation, generation from ${source} limit 2) as epoch`);
  // These two complete shapes contain only fixed names/count and the bounded
  // source. No request, authority or expected epoch enters statement naming.
  const compiled = query.toSQL();
  if (compiled.params.length !== 0)
    return yield* Effect.die(new Error("Metadata identity SQL contains unexpected parameters"));
  const bytes = new TextEncoder().encode(compiled.sql);
  const { subtle, digest: nativeDigest } = yield* Effect.sync(() => {
    const crypto = globalThis.crypto;
    const capturedSubtle = crypto?.subtle;
    const capturedDigest = capturedSubtle?.digest;
    return { subtle: capturedSubtle, digest: capturedDigest };
  });
  if (subtle === undefined || typeof nativeDigest !== "function")
    return yield* Effect.fail(issue("resourceFailure", new Error("Metadata identity WebCrypto is unavailable")));
  const digest = yield* Effect.tryPromise({
    try: () => nativeDigest.call(subtle, "SHA-256", copyBytesToArrayBuffer(bytes)),
    catch: cause => new PreparedMetadataDigestRejection({ cause }),
  }).pipe(Effect.catchTag("PreparedMetadataDigestRejection", rejection =>
    typeof DOMException !== "undefined" && rejection.cause instanceof DOMException
      ? Effect.fail(issue("resourceFailure", rejection.cause)) : Effect.die(rejection.cause)));
  // PostgreSQL statement names are limited to 63 characters. A different SQL
  // shape gets a different name; driver collisions fail without retry/fallback.
  const name = `fx_pm_${encodeBytesToLowercaseHex(new Uint8Array(digest)).slice(0, 56)}`;
  const statement = query.prepare(name);
  const rows = yield* Effect.tryPromise({
    try: () => statement.execute(),
    catch: cause => issue(isLockUnavailable(cause) ? "busy" : "resourceFailure", cause),
  });
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
  installation?: PreparedInstallation,
) {
  const identity = installation === undefined ? yield* readIdentity(database, false) :
    yield* readManagedIdentity(database, database, installation, false);
  // SAFETY: only this issuer records a newly frozen token in the private
  // WeakMap; consumers cannot manufacture a recognized preparation.
  const token = Object.freeze({}) as ProtectedMetadataPreparation;
  preparations.set(token, Object.freeze({ database, identity, ...(installation === undefined ? {} : { installation }) }));
  return token;
});

/** Captures the generation in a preparation snapshot after structural reads. */
export const captureProtectedMetadataEpoch = Effect.fn("PreparedMetadataEpoch.capture")(function* (
  prepared: ProtectedMetadataPreparation, database: FlarexMetadataDatabase,
  tx: FlarexMetadataTransaction,
) {
  const state = preparations.get(prepared);
  if (state === undefined || state.database !== database) return yield* Effect.fail(issue("unprotectedRuntime"));
  if (state.installation !== undefined && !isManagedInstallationTransaction(tx, database, state.installation))
    return yield* Effect.fail(issue("unprotectedRuntime"));
  const snapshot = state.installation === undefined ? undefined : managedSnapshots.get(tx)?.get(state.installation);
  const current = snapshot ?? (state.installation === undefined ? yield* readIdentity(tx, false) :
    yield* readManagedIdentity(tx, database, state.installation, false));
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
  if (state.installation !== undefined && !isManagedInstallationTransaction(tx, database, state.installation))
    return yield* Effect.fail(issue("unprotectedRuntime"));
  const current = state.installation === undefined ? yield* readIdentity(tx, true) :
    yield* readManagedIdentity(tx, database, state.installation, true);
  if (!sameInstallation(current, expected) || current.generation !== expected.generation)
    return yield* Effect.fail(issue("changed"));
});

/** Installer-only structural proof. Serving callers use the installed policy. */
export const attestProtectedMetadataInstallation = Effect.fn("PreparedMetadataEpoch.attestInstallation")(
  (database: FlarexMetadataDatabase) => readIdentity(database, false),
);

const readManagedIdentity = Effect.fn("PreparedMetadataEpoch.readManagedIdentity")(function* (
  db: FlarexMetadataDatabase | FlarexMetadataTransaction, database: FlarexMetadataDatabase,
  installation: PreparedInstallation, lock: boolean,
) {
  const schemaName = managedInstallationSchema(installation, database);
  const incarnation = managedInstallationMetadataIncarnation(installation, database);
  if (schemaName === undefined || incarnation === undefined) return yield* Effect.fail(issue("unprotectedRuntime"));
  const source = lock ? sql`${sql.identifier(schemaName)}.fx_lock_prepared_metadata_epoch()` :
    sql`${sql.identifier(schemaName)}.fx_system_prepared_metadata_epoch`;
  const rows = yield* Effect.tryPromise({
    try: () => db.select({
      databaseName: sql<string>`epoch.database_name`, namespaceOid: sql<string>`epoch.namespace_oid::text`,
      incarnation: sql<string>`epoch.incarnation::text`, generation: sql<string>`epoch.generation::text`,
      login: sql<string>`session_user`, actualDatabase: sql<string>`current_database()`,
      sameLogin: sql<boolean>`current_user = session_user`,
    }).from(sql`${source} as epoch`).limit(2),
    catch: cause => issue(isLockUnavailable(cause) ? "busy" : "resourceFailure", cause),
  });
  const [row] = yield* decodeManagedEpochRows(rows).pipe(Effect.mapError(cause => issue("invalidEpoch", cause)));
  if (row.databaseName !== row.actualDatabase || row.incarnation !== incarnation || !row.sameLogin)
    return yield* Effect.fail(issue("invalidEpoch"));
  return Object.freeze({ databaseName: row.databaseName, namespaceOid: BigInt(row.namespaceOid),
    incarnation: row.incarnation, generation: BigInt(row.generation), login: row.login }) satisfies ProtectedMetadataEpochIdentity;
});

const sameInstallation = (left: ProtectedMetadataEpochIdentity, right: ProtectedMetadataEpochIdentity) =>
  left.databaseName === right.databaseName && left.namespaceOid === right.namespaceOid &&
  left.incarnation === right.incarnation && left.login === right.login;

/** The running-attempt kernel and managed standalone accepting owner open and
 * flush this scope. Admission from another transaction still fails closed. */
export function openProtectedMetadataFinalGuardScope(tx: FlarexMetadataTransaction): void {
  if (finalGuardScopes.has(tx)) throw new Error("Protected metadata guard scope already opened");
  finalGuardScopes.set(tx, new Map());
}

export function closeProtectedMetadataFinalGuardScope(tx: FlarexMetadataTransaction): void {
  finalGuardScopes.delete(tx);
  managedSnapshots.delete(tx);
  pendingFinalGuardBatches.delete(tx);
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
  const state = preparations.get(prepared);
  if (state === undefined || state.database !== database || !sameInstallation(expected, state.identity))
    return yield* Effect.fail(issue("unprotectedRuntime"));
  const key = expected.namespaceOid.toString();
  const prior = scope.get(key);
  if (prior !== undefined && (!sameInstallation(prior.expected, expected) ||
    prior.expected.generation !== expected.generation)) {
    return yield* Effect.fail(issue("changed"));
  }
  scope.set(key, Object.freeze({ database, prepared, expected }));
});

/** One bounded final submission compares each original registered anchor.
 * Functions retain FOR SHARE NOWAIT; no current verdict is retained. */
export const prepareProtectedMetadataFinalGuardBatch = Effect.fn("PreparedMetadataEpoch.prepareFinalBatch")(
  function* (tx: FlarexMetadataTransaction) {
    const scope = finalGuardScopes.get(tx);
    if (scope === undefined || scope.size < 1 || scope.size > 2)
      return yield* Effect.fail(issue("unprotectedRuntime"));
    const guards = [...scope.entries()].map(([key, guard]) => ({ key, ...guard }))
      .toSorted((left, right) => left.expected.namespaceOid < right.expected.namespaceOid ? -1 : 1);
    const terms: SQL[] = [];
    for (const [index, guard] of guards.entries()) {
      const state = preparations.get(guard.prepared);
      if (state === undefined || state.database !== guard.database || state.installation === undefined ||
        !sameInstallation(guard.expected, state.identity) ||
        !isManagedInstallationTransaction(tx, guard.database, state.installation))
        return yield* Effect.fail(issue("unprotectedRuntime"));
      const schemaName = managedInstallationSchema(state.installation, guard.database);
      if (schemaName === undefined) return yield* Effect.fail(issue("unprotectedRuntime"));
      const name = sql.identifier(`epoch_guard_${index}`);
      terms.push(sql`${name} as materialized (select
        epoch.database_name = ${guard.expected.databaseName} and epoch.database_name = current_database()
        and epoch.namespace_oid = ${guard.expected.namespaceOid.toString()}::bigint
        and epoch.incarnation = ${guard.expected.incarnation}::uuid
        and epoch.generation = ${guard.expected.generation.toString()}::bigint
        and session_user = ${guard.expected.login} and current_user = session_user as valid
        from ${sql.identifier(schemaName)}.fx_lock_prepared_metadata_epoch() epoch)`);
    }
    const checks = guards.map((_, index) => sql`coalesce((select bool_and(valid)
      from ${sql.identifier(`epoch_guard_${index}`)}),false)`);
    pendingFinalGuardBatches.set(tx, Object.freeze(guards));
    return Object.freeze({ source: sql`(with ${sql.join(terms, sql`, `)}
      select ${sql.join(checks, sql` and `)} as valid)` });
  },
);

export const acceptProtectedMetadataFinalGuardBatch = Effect.fn("PreparedMetadataEpoch.acceptFinalBatch")(
  function* (tx: FlarexMetadataTransaction, rows: unknown) {
    const pending = pendingFinalGuardBatches.get(tx), scope = finalGuardScopes.get(tx);
    if (pending === undefined || scope === undefined || pending.length !== scope.size || pending.some(guard => {
      const current = scope.get(guard.key);
      return current?.database !== guard.database || current.prepared !== guard.prepared ||
        !sameInstallation(current.expected, guard.expected) || current.expected.generation !== guard.expected.generation;
    })) return yield* Effect.fail(issue("unprotectedRuntime"));
    const [row] = yield* decodeFinalGuardRows(rows)
      .pipe(Effect.mapError(cause => issue("invalidEpoch", cause)));
    if (!row.valid) return yield* Effect.fail(issue("changed"));
    closeProtectedMetadataFinalGuardScope(tx);
  },
);

export const flushProtectedMetadataFinalGuards = Effect.fn("PreparedMetadataEpoch.flushFinalGuards")(function* (
  tx: FlarexMetadataTransaction,
) {
  const scope = finalGuardScopes.get(tx);
  if (scope === undefined) return yield* Effect.fail(issue("unprotectedRuntime"));
  for (const guard of scope.values()) {
    yield* guardProtectedMetadataEpoch(guard.prepared, guard.database, guard.expected, tx);
  }
  closeProtectedMetadataFinalGuardScope(tx);
});

function isLockUnavailable(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if ("code" in value && value.code === "55P03") return true;
  return "cause" in value && isLockUnavailable(value.cause);
}

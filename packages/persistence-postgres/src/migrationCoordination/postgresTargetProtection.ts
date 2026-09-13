import { Effect, Schema } from "effect";

import type { PostgresMigrationConnection } from "./postgresTargetConnection";
import { FrameworkMigrationSessionResourceIssue } from "./targetSession";

// This is the installed integrity contract, not a second migration planner.
// Function fingerprints pin the bodies in 0100_framework_metadata_protection.sql;
// the catalog conformance test checks that migration and this contract together.
const historyTables = [
  "fx_system_framework_schema_target_namespace",
  "fx_system_framework_migration_collision_domain",
  "fx_system_relational_physical_name_assignment",
  "fx_system_framework_migration_plan",
  "fx_system_framework_migration_plan_step",
  "fx_system_framework_migration_plan_step_dependency",
  "fx_system_framework_migration_plan_base",
  "fx_system_framework_migration_plan_admission",
  "fx_system_framework_migration_admission_assignment",
  "fx_system_framework_migration_attempt_start",
  "fx_system_framework_migration_step_receipt",
  "fx_system_framework_migration_step_receipt_dependency",
  "fx_system_framework_migration_attempt_terminal",
  "fx_system_framework_migration_event",
  "fx_system_framework_schema_installation",
  "fx_system_framework_schema_readiness",
  "fx_system_framework_schema_availability_history",
] as const;
const rootTables = [
  "fx_system_framework_migration_plan",
  "fx_system_framework_migration_plan_admission",
  "fx_system_framework_migration_step_receipt",
];
const children = [
  [
    "fx_system_framework_migration_plan_step",
    "fx_system_framework_migration_plan",
    "plan_storage_id",
  ],
  [
    "fx_system_framework_migration_plan_step_dependency",
    "fx_system_framework_migration_plan",
    "plan_storage_id",
  ],
  [
    "fx_system_framework_migration_plan_base",
    "fx_system_framework_migration_plan",
    "plan_storage_id",
  ],
  [
    "fx_system_framework_migration_admission_assignment",
    "fx_system_framework_migration_plan_admission",
    "admission_storage_id",
  ],
  [
    "fx_system_framework_migration_step_receipt_dependency",
    "fx_system_framework_migration_step_receipt",
    "receipt_storage_id",
  ],
] as const;
const functions = [
  [
    "fx_framework_stamp_creation_transaction",
    "09f4419ce5bd9290c42d07f4ec9cccf098ee9c53bd4d87fb747e5d0f71f035c5",
  ],
  [
    "fx_framework_reject_history_mutation",
    "3496713dc443a131137c176ee4675b6a9cab4ce959a761b35e69a141aa531892",
  ],
  [
    "fx_framework_require_creation_transaction",
    "61cf212f761c63d0401ecf064f43d4ab5b7a8a4da6b6435c93727e263578f96f",
  ],
] as const;

const decodeNamespace = Schema.decodeUnknownEffect(
  Schema.Tuple([Schema.Struct({ name: Schema.String })]),
);
const decodeProtection = Schema.decodeUnknownEffect(
  Schema.Tuple([
    Schema.Struct({ login: Schema.Boolean, metadata: Schema.Boolean }),
  ]),
);

/** Runs on the acquired connection, inside its existing deadline and cleanup.
 * No cached proof: every ordinary and recovery transaction checks its own login
 * and the fixed-size guard catalog. Historical row verification has another owner.
 * Privileged online repair is excluded by the provisioning/repair contract. */
export const protectPostgresMigrationTransaction = Effect.fn(
  "FrameworkMigrationPostgresTarget.protectTransaction",
)(function* (connection: PostgresMigrationConnection) {
  // RESET SESSION AUTHORIZATION reveals the authenticated login even if a pool
  // borrower previously used SET ROLE or SET SESSION AUTHORIZATION. A restricted
  // current_user alone is not proof; RESET ROLE must not restore an owner either.
  yield* query(connection, "reset role");
  yield* query(connection, "reset session authorization");
  const namespaceRows = yield* query(
    connection,
    "select pg_catalog.current_schema() as name",
  );
  const [namespace] = yield* decodeNamespace(namespaceRows.rows).pipe(
    Effect.mapError(refusal),
  );
  // Pin ORM name resolution. Explicit pg_temp last prevents implicit temp-table
  // precedence; built-ins and the guard functions use pg_catalog first.
  yield* query(
    connection,
    "select pg_catalog.set_config('search_path', 'pg_catalog,' || pg_catalog.quote_ident($1) || ',pg_temp', true)",
    [namespace.name],
  );
  const result = yield* query(connection, protectionSql, [
    namespace.name,
    historyTables,
    [
      "fx_system_framework_migration_collision_head",
      "fx_system_framework_schema_availability_head",
    ],
    rootTables,
    JSON.stringify(children),
    JSON.stringify(functions),
  ]);
  const [protection] = yield* decodeProtection(result.rows).pipe(
    Effect.mapError(refusal),
  );
  if (!protection.login)
    return yield* Effect.fail(
      refusal(
        new Error(
          "Framework installation requires a restricted authenticated login with no role memberships or privileged execution grants.",
        ),
      ),
    );
  if (!protection.metadata)
    return yield* Effect.fail(
      refusal(
        new Error(
          "Framework installation requires non-owned metadata with the exact enabled history and sealing guards.",
        ),
      ),
    );
});

const refusal = (cause: unknown) =>
  new FrameworkMigrationSessionResourceIssue({
    phase: "beginOrConfigure",
    cause,
  });
const query = Effect.fn("FrameworkMigrationPostgresTarget.protectionQuery")(
  (
    connection: PostgresMigrationConnection,
    text: string,
    values?: readonly unknown[],
  ) =>
    Effect.tryPromise({
      try: () => connection.query("configure", text, values),
      catch: refusal,
    }),
);

// Catalog SQL is intentionally explicit. Count and anti-join checks reject
// missing, extra, disabled, rewired or replaced guards, not just familiar names.
const protectionSql = `
with namespace as (
  select oid, nspowner from pg_catalog.pg_namespace where nspname = $1
), login_role as (
  select * from pg_catalog.pg_roles where rolname = session_user
), tables as (
  select c.* from pg_catalog.pg_class c join namespace n on n.oid = c.relnamespace
  where c.relname = any($2::text[] || $3::text[])
), expected_functions as (
  select item->>0 as name, item->>1 as digest from pg_catalog.jsonb_array_elements($6::jsonb) item
), guard_functions as (
  select p.* from pg_catalog.pg_proc p join namespace n on n.oid = p.pronamespace
  join expected_functions e on e.name = p.proname
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.pronargs = 0 and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
    and p.prokind = 'f' and not p.prosecdef and not p.proisstrict and not p.proleakproof
    and p.provolatile = 'v' and p.proparallel = 'u' and l.lanname = 'plpgsql'
    and p.proconfig = array['search_path=pg_catalog']
    and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
      pg_catalog.replace(p.prosrc, E'\\r\\n', E'\\n'), 'UTF8')), 'hex') = e.digest
), expected_triggers as (
  select name as table_name, 'fx_framework_history_immutable' as name,
    'fx_framework_reject_history_mutation' as function_name, 25 as bits, '' as args, 0 as nargs
  from pg_catalog.unnest($2::text[]) name
  union all select name, 'fx_framework_history_no_truncate', 'fx_framework_reject_history_mutation', 34, '', 0
  from pg_catalog.unnest($2::text[]) name
  union all select name, 'fx_framework_creation_transaction', 'fx_framework_stamp_creation_transaction', 7, '', 0
  from pg_catalog.unnest($4::text[]) name
  union all select item->>0, 'fx_framework_children_sealed', 'fx_framework_require_creation_transaction', 5,
    pg_catalog.encode(pg_catalog.convert_to(item->>1, 'UTF8'), 'hex') || '00' ||
    pg_catalog.encode(pg_catalog.convert_to(item->>2, 'UTF8'), 'hex') || '00', 2
  from pg_catalog.jsonb_array_elements($5::jsonb) item
), actual_triggers as (
  select t.*, c.relname as table_name from pg_catalog.pg_trigger t join tables c on c.oid = t.tgrelid
  where not t.tgisinternal
)
select coalesce((select r.rolcanlogin and not (r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls)
  and current_user = session_user and current_setting('session_replication_role') = 'origin'
  and not exists(select 1 from pg_catalog.pg_auth_members where member = r.oid)
  and not pg_catalog.has_parameter_privilege(r.oid, 'session_replication_role', 'SET')
  and not pg_catalog.has_database_privilege(r.oid, current_database(), 'CREATE')
  and not exists(select 1 from pg_catalog.pg_database where datname = current_database() and datdba = r.oid)
  and not exists(select 1 from pg_catalog.pg_extension where extowner = r.oid)
  and not exists(select 1 from pg_catalog.pg_language where lanowner = r.oid)
  and not exists(select 1 from pg_catalog.pg_proc p
    where p.prosecdef and p.proowner <> r.oid
      and pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE'))
  and not exists(select 1 from pg_catalog.pg_class c
    where c.relkind in ('r', 'p') and c.relowner <> r.oid
      and pg_catalog.has_any_column_privilege(r.oid, c.oid, 'REFERENCES'))
  and not exists(select 1 from pg_catalog.pg_constraint fk
    join pg_catalog.pg_class child on child.oid = fk.conrelid
    join pg_catalog.pg_class parent on parent.oid = fk.confrelid
    where fk.contype = 'f' and child.relowner = r.oid and parent.relowner <> r.oid)
  and not exists(select 1 from pg_catalog.pg_constraint fk
    join pg_catalog.pg_class child on child.oid = fk.conrelid
    join pg_catalog.pg_class parent on parent.oid = fk.confrelid
    join pg_catalog.pg_attribute child_key on child_key.attrelid = child.oid and child_key.attnum = fk.conkey[1]
    join pg_catalog.pg_attribute parent_key on parent_key.attrelid = parent.oid and parent_key.attnum = fk.confkey[1]
    where fk.contype = 'f' and parent.relowner = r.oid and child.relowner <> r.oid
      and not (
        fk.confdeltype in ('a', 'r') and fk.confupdtype in ('a', 'r')
        and cardinality(fk.conkey) = 1 and cardinality(fk.confkey) = 1
        and child_key.atttypid = parent_key.atttypid
        and (
          (child_key.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
            and fk.conpfeqop = array['pg_catalog.=(pg_catalog.uuid,pg_catalog.uuid)'::pg_catalog.regoperator::oid])
          or (child_key.atttypid = 'pg_catalog.text'::pg_catalog.regtype
            and child_key.attcollation in ('pg_catalog.default'::pg_catalog.regcollation, 'pg_catalog."C"'::pg_catalog.regcollation)
            and parent_key.attcollation in ('pg_catalog.default'::pg_catalog.regcollation, 'pg_catalog."C"'::pg_catalog.regcollation)
            and fk.conpfeqop = array['pg_catalog.=(pg_catalog.text,pg_catalog.text)'::pg_catalog.regoperator::oid])
        )
        and fk.conppeqop = fk.conpfeqop and fk.conffeqop = fk.conpfeqop
      ))
  from login_role r), false) as login,
  (select count(*) = 1 and bool_and(nspowner <> (select oid from login_role)) from namespace)
  and (select count(*) = cardinality($2::text[] || $3::text[]) and bool_and(relkind = 'r' and not relispartition
    and not relhasrules and not relrowsecurity and relowner <> (select oid from login_role)
    and not pg_catalog.has_table_privilege(current_user, oid, 'TRIGGER')) from tables)
  and not exists(select 1 from pg_catalog.pg_inherits i join tables t on t.oid in (i.inhrelid, i.inhparent))
  and (select count(*) = (select count(*) from expected_functions)
    and bool_and(proowner <> (select oid from login_role)) from guard_functions)
  and not exists(select 1 from expected_triggers e where not exists (
    select 1 from actual_triggers t join guard_functions f on f.oid = t.tgfoid
    where t.table_name = e.table_name and t.tgname = e.name and f.proname = e.function_name
      and t.tgtype = e.bits and t.tgenabled = 'O' and t.tgconstraint = 0
      and t.tgqual is null and t.tgoldtable is null and t.tgnewtable is null
      and t.tgattr::text = '' and t.tgnargs = e.nargs and pg_catalog.encode(t.tgargs, 'hex') = e.args
  ))
  and (select count(*) = (select count(*) from expected_triggers) from actual_triggers)
  and (select count(*) = cardinality($4::text[]) from pg_catalog.pg_attribute a join tables t on t.oid=a.attrelid
    where t.relname=any($4::text[]) and a.attname='created_transaction_id' and a.attnotnull
      and not a.attisdropped and a.atttypid='pg_catalog.int8'::pg_catalog.regtype)
  as metadata
`;

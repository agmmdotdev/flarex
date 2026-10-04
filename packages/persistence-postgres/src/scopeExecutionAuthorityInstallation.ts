import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities, fxSystemMetadataContractObservations,
  fxSystemSnapshotLeases, fxSystemTransactionSessions, fxSystemTransactionJournals,
  fxSystemTransactionExecutionClaims } from "./schema";
import { FINITE_RUNNING_ATTEMPT_FUNCTION_BODY_SHA256, FINITE_SCOPE_OBSERVATION_FUNCTION_BODY_SHA256 } from "./finiteRunningAttempt";

const tables = [fxSystemScopeClocks, fxSystemScopeExecutionAuthorities, fxSystemMetadataContractObservations,
  fxSystemSnapshotLeases, fxSystemTransactionSessions, fxSystemTransactionJournals, fxSystemTransactionExecutionClaims];
const nonBlankCharacters = " \t\n\u000b\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
const tableNames = sql`array[${sql.join(tables.map(table => sql`${getTableName(table)}`), sql`,`)}]::text[]`;
const columns = sql.join(tables.flatMap(table => Object.values(getTableColumns(table)).map(column =>
  sql`(${getTableName(table)},${column.name},${column.getSQLType()}::pg_catalog.regtype::oid,${column.notNull}::boolean,${column.generated === undefined ? "" : "s"})`)), sql`,`);
const expressions = sql.join([
  ["fx_system_scope_clock", "scope_id", null],
  ["fx_system_scope_clock", "last_commit_seq", "0"],
  ["fx_system_scope_clock", "last_metadata_sequence", "0"],
  ["fx_system_scope_clock", "updated_at", "now()"],
  ["fx_system_scope_clock", "scope_uuid", "CASE WHEN (scope_id ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN (SUBSTRING(scope_id FROM 7))::uuid ELSE NULL::uuid END"],
  ["fx_system_scope_execution_authority", "scope_id", null],
  ["fx_system_scope_execution_authority", "storage_generation", null],
  ["fx_system_scope_execution_authority", "epoch", null],
  ["fx_system_scope_execution_authority", "storage_generation_fence", "1"],
  ["fx_system_scope_execution_authority", "oldest_available_commit_seq", "0"],
  ["fx_system_scope_execution_authority", "authorization_revocation_epoch", "0"],
  ["fx_system_scope_execution_authority", "updated_at", "now()"],
  ["fx_system_scope_execution_authority", "epoch_uuid", "CASE WHEN (epoch ~ '^epoch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN (SUBSTRING(epoch FROM 7))::uuid ELSE NULL::uuid END"],
  ...Object.values(getTableColumns(fxSystemMetadataContractObservations)).map(column =>
    ["fx_system_metadata_contract_observation", column.name, null]),
  ["fx_system_snapshot_lease", "metadata_watermark", null],
  ["fx_system_snapshot_lease", "finite_metadata_reservation_bytes", null],
  ["fx_system_snapshot_lease", "finite_metadata_reservation_sha256", null],
].map(([table, column, expression]) => sql`(${table},${column},${expression}::text)`), sql`,`);
const checks = sql.join([
  ["fx_system_scope_clock", "fx_system_scope_clock_last_metadata_sequence_non_negative_check", "(last_metadata_sequence>=0)"],
  ["fx_system_scope_execution_authority", "fx_scope_execution_authority_generation_check", "(storage_generation=ANY(ARRAY['legacy_v1','flarexdb_v1']))"],
  ["fx_system_scope_execution_authority", "fx_scope_execution_authority_fence_check", "(storage_generation_fence>=1)"],
  ["fx_system_scope_execution_authority", "fx_scope_execution_authority_floor_check", "(oldest_available_commit_seq>=0)"],
  ["fx_system_scope_execution_authority", "fx_scope_execution_authority_revocation_check", "(authorization_revocation_epoch>=0)"],
  ["fx_system_scope_execution_authority", "fx_scope_execution_authority_epoch_check", `(btrim(epoch, '${nonBlankCharacters}') <> '')`],
  ["fx_system_metadata_contract_observation", "fx_metadata_contract_namespace_check", "(namespace=ANY(ARRAY['application','binding','execution']))"],
  ["fx_system_metadata_contract_observation", "fx_metadata_contract_owner_check", `(btrim(owner_key, '${nonBlankCharacters}') <> '')`],
  ["fx_system_metadata_contract_observation", "fx_metadata_contract_key_check", `(btrim(contract_key, '${nonBlankCharacters}') <> '')`],
  ["fx_system_metadata_contract_observation", "fx_metadata_contract_sequence_check", "(last_changed_metadata_sequence>0)"],
  ["fx_system_metadata_contract_observation", "fx_metadata_contract_digest_check", "((present=(semantic_sha256_hexISNOTNULL))AND((semantic_sha256_hexISNULL)OR(semantic_sha256_hex~'^[0-9a-f]{64}$')))"],
  ["fx_system_snapshot_lease", "fx_snapshot_lease_finite_metadata_reservation_check", "(((metadata_watermarkISNULL)AND(finite_metadata_reservation_bytesISNULL)AND(finite_metadata_reservation_sha256ISNULL))OR((metadata_watermarkISNOTNULL)AND(metadata_watermark>=0)AND(finite_metadata_reservation_bytesISNOTNULL)AND((octet_length(finite_metadata_reservation_bytes)>=1)AND(octet_length(finite_metadata_reservation_bytes)<=65536))AND(finite_metadata_reservation_sha256ISNOTNULL)AND(octet_length(finite_metadata_reservation_sha256)=32)))"],
].map(([table, name, expression]) => sql`(${table},${name},${expression})`), sql`,`);

/** Installation-only structural proof. Mutable semantic observations retain ordinary
 * managed DML; they never invalidate the immutable prepared-target epoch. */
export const scopeExecutionAuthorityInstallationSql = (schemaName: SQL) => sql<boolean>`(
  with bounds as materialized (select n.oid as namespace_oid, c.relowner as owner_oid
    from pg_catalog.pg_namespace n join pg_catalog.pg_class c on c.relnamespace = n.oid
    where n.nspname = ${schemaName} and c.relname = 'fx_system_installation'),
  relations as materialized (select c.* from pg_catalog.pg_class c, bounds b
    where c.relnamespace = b.namespace_oid and c.relname = any(${tableNames})),
  expected_columns(table_name,column_name,type_oid,required,generated) as (values ${columns}),
  expected_checks(table_name,constraint_name,expression) as (values ${checks}),
  expected_expressions(table_name,column_name,expression) as (values ${expressions}),
  expected_keys(table_name,column_names) as (values
    ('fx_system_scope_clock',array['scope_id']::text[]),
    ('fx_system_scope_execution_authority',array['scope_id']::text[]),
    ('fx_system_metadata_contract_observation',array['scope_id','namespace','owner_key','contract_key']::text[]))
  select (select count(*) = ${tables.length} and bool_and(c.relkind = 'r' and not c.relispartition
    and c.relowner = b.owner_oid and not c.relhasrules and not c.relrowsecurity) from relations c, bounds b)
  and not exists (select 1 from expected_columns e where not exists (
    select 1 from relations c join pg_catalog.pg_attribute a on a.attrelid = c.oid
      where c.relname = e.table_name and a.attname = e.column_name and a.attnum > 0 and not a.attisdropped
      and a.atttypid = e.type_oid and a.attnotnull = e.required and a.attidentity = '' and a.attgenerated = e.generated))
  and not exists (select 1 from relations c join pg_catalog.pg_attribute a on a.attrelid = c.oid
    where a.attnum > 0 and not a.attisdropped and not exists (select 1 from expected_columns e
      where e.table_name = c.relname and e.column_name = a.attname))
  and not exists (select 1 from expected_expressions e where not exists (
    select 1 from relations c join pg_catalog.pg_attribute a on a.attrelid = c.oid
      left join pg_catalog.pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
      where c.relname = e.table_name and a.attname = e.column_name
        and pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid), '::text', ''),
          '[[:space:]]', '', 'g') is not distinct from
          pg_catalog.regexp_replace(e.expression, '[[:space:]]', '', 'g')))
  and not exists (select 1 from expected_keys e where not exists (
    select 1 from relations c join pg_catalog.pg_constraint k on k.conrelid = c.oid
      join pg_catalog.pg_index x on x.indexrelid = k.conindid
      join pg_catalog.pg_class ic on ic.oid = x.indexrelid
      join pg_catalog.pg_am am on am.oid = ic.relam
      where c.relname = e.table_name and k.contype = 'p' and k.convalidated
        and not k.condeferrable and not k.condeferred and x.indisprimary and x.indisunique
        and x.indisvalid and x.indisready and x.indislive and x.indimmediate
        and x.indnkeyatts = cardinality(e.column_names) and x.indnatts = cardinality(e.column_names)
        and x.indpred is null and x.indexprs is null and am.amname = 'btree'
        and (select array_agg(a.attname::text order by ordinal.position)
          from unnest(k.conkey) with ordinality ordinal(attnum,position)
          join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = ordinal.attnum)
          = e.column_names))
  and not exists (select 1 from expected_checks e where not exists (
    select 1 from relations c join pg_catalog.pg_constraint k on k.conrelid = c.oid
      where c.relname = e.table_name and k.conname = e.constraint_name and k.contype = 'c'
        and k.convalidated and not k.condeferrable and not k.condeferred
        and case when e.constraint_name in ('fx_scope_execution_authority_epoch_check',
          'fx_metadata_contract_owner_check', 'fx_metadata_contract_key_check') then
          pg_catalog.replace(pg_catalog.pg_get_expr(k.conbin,k.conrelid), '::text', '') = e.expression
        else pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(k.conbin,k.conrelid), '::text', ''),
          '[[:space:]]', '', 'g') = pg_catalog.regexp_replace(e.expression, '[[:space:]]', '', 'g') end))
  and not exists (select 1 from relations c where c.relname in ('fx_system_scope_execution_authority','fx_system_metadata_contract_observation')
    and not exists (select 1 from pg_catalog.pg_constraint k join relations target on target.oid = k.confrelid
      join pg_catalog.pg_attribute source_column on source_column.attrelid = c.oid and source_column.attname = 'scope_id'
      join pg_catalog.pg_attribute target_column on target_column.attrelid = target.oid and target_column.attname = 'scope_id'
      where k.conrelid = c.oid and k.contype = 'f' and k.convalidated and not k.condeferrable
        and target.relname = 'fx_system_scope_clock' and k.conkey = array[source_column.attnum]::smallint[]
        and k.confkey = array[target_column.attnum]::smallint[] and k.confupdtype = 'r' and k.confdeltype = 'r'))
  and (select count(*) = 1 from pg_catalog.pg_proc p, bounds b where p.pronamespace = b.namespace_oid
    and p.proname = 'fx_lock_finite_scope_observation')
  and exists (select 1 from pg_catalog.pg_proc p, bounds b, relations a, relations c
    where p.pronamespace = b.namespace_oid and p.proname = 'fx_lock_finite_scope_observation'
      and a.relname = 'fx_system_scope_execution_authority' and c.relname = 'fx_system_scope_clock'
      and p.proowner = b.owner_oid and p.pronargs = 1 and p.pronargdefaults = 0
      and p.proargtypes = '25'::pg_catalog.oidvector
      and p.proallargtypes = array[25,a.reltype,c.reltype]::oid[]
      and p.proargmodes::text = '{i,t,t}'
      and p.proargnames = array['p_scope_id','authority_row','sequence_row']::text[]
      and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype and p.proretset
      and p.prokind = 'f' and p.provolatile = 'v' and not p.prosecdef and not p.proisstrict
      and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
      and p.proconfig = array['search_path=pg_catalog, pg_temp'] and p.prolang =
        (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
      and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
        pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".'), 'UTF8')), 'hex')
        = ${FINITE_SCOPE_OBSERVATION_FUNCTION_BODY_SHA256})
  and (select count(*) = 1 from pg_catalog.pg_proc p, bounds b where p.pronamespace = b.namespace_oid
    and p.proname = 'fx_lock_finite_running_attempt')
  and exists (select 1 from pg_catalog.pg_proc p, bounds b, relations a, relations s, relations l, relations r, relations c
    where p.pronamespace = b.namespace_oid and p.proname = 'fx_lock_finite_running_attempt'
      and a.relname = 'fx_system_scope_execution_authority' and s.relname = 'fx_system_tx_session'
      and l.relname = 'fx_system_snapshot_lease' and r.relname = 'fx_system_tx_journal' and c.relname = 'fx_system_tx_execution_claim'
      and p.proowner = b.owner_oid and p.pronargs = 6 and p.pronargdefaults = 0
      and p.proargtypes = '25 2950 20 25 20 25'::pg_catalog.oidvector
      and p.proallargtypes = array[25,2950,20,25,20,25,25,2950,a.reltype,s.reltype,l.reltype,r.reltype,c.reltype,25]::oid[]
      and p.proargmodes::text = '{i,i,i,i,i,i,t,t,t,t,t,t,t,t}'
      and p.proargnames = array['p_scope_id','p_session_id','p_attempt_fence','p_storage_generation','p_storage_fence','p_epoch',
        'disposition','scope_uuid','authority_row','session_row','lease_row','journal_root','execution_claim','database_now_epoch_milliseconds']::text[]
      and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype and p.proretset
      and p.prokind = 'f' and p.provolatile = 'v' and not p.prosecdef and not p.proisstrict
      and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
      and p.proconfig = array['search_path=pg_catalog, pg_temp'] and p.prolang =
        (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
      and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
        pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".'), 'UTF8')), 'hex')
        = ${FINITE_RUNNING_ATTEMPT_FUNCTION_BODY_SHA256})
  and exists (select 1 from pg_catalog.pg_proc p, bounds b where p.pronamespace = b.namespace_oid
    and p.proname = 'fx_check_scope_execution_authority' and p.pronargs = 0 and p.pronargdefaults = 0
    and p.proowner = b.owner_oid and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype and not p.proretset
    and p.prokind = 'f' and p.provolatile = 'v' and not p.prosecdef and not p.proisstrict
    and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
    and p.proconfig = array['search_path=pg_catalog, pg_temp'] and p.prolang =
      (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
    and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
      pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".'), 'UTF8')), 'hex')
      = '41e0d45db8be52ef6a9ed4ffd906c9eae3ae3a0f08ff52bede68e7576cfd8fb8'
    and (select count(*) = 2 from pg_catalog.pg_trigger t join relations c on c.oid = t.tgrelid
      join pg_catalog.pg_constraint k on k.oid = t.tgconstraint where t.tgfoid = p.oid
        and c.relname in ('fx_system_scope_clock','fx_system_scope_execution_authority')
        and t.tgname = 'fx_scope_authority_pair_integrity' and t.tgenabled = 'O' and t.tgtype = 29
        and t.tgdeferrable and t.tginitdeferred and k.condeferrable and k.condeferred
        and t.tgqual is null and t.tgnargs = 0 and t.tgoldtable is null and t.tgnewtable is null))
)`;

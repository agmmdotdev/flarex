import { createHash } from "node:crypto";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { fxSystemScopeClocks, fxSystemScopeExecutionAuthorities, fxSystemMetadataContractObservations,
  fxSystemSnapshotLeases, fxSystemTransactionSessions, fxSystemTransactionJournals,
  fxSystemTransactionExecutionClaims } from "../database/schema";
import { finiteEntryCompletionInstallationSql } from "../execution/finiteEntryCompletionInstallation";
import { finiteEntryObservationInstallationSql } from "../execution/finiteEntryObservation";
import { finitePublicationInstallationSql } from "../commit/finitePublicationInstallation";
import { finiteCaptureFrontierInstallationSql } from "../execution/finiteCaptureFrontierInstallation";
import { applicationDomainInstallationSql } from "../storage/materialization/domainInstallation";
import { INDEX_BUILD_INTRINSIC_VALIDITY_SQL, INDEX_MAINTENANCE_OPENING_VALIDITY_SQL } from "../storage/indexes/indexBuildSqlPredicates";

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
function finiteCaptureInstallationSql(schemaName: SQL) {

const captureExpectedFields = [["scope_uuid","uuid"],
  ["session_id","uuid"],
  ["attempt_fence","bigint"],
  ["policy_version","text"],
  ["protocol_version","integer"],
  ["execution_profile","text"],
  ["execution_authority_generation","text"],
  ["function_path","text"],
  ["function_kind","text"],
  ["execution_module","text"],
  ["package_id","text"],
  ["artifact_runtime","text"],
  ["artifact_id","text"],
  ["source_package_hash","text"],
  ["validated_args_value_codec_version","integer"],
  ["authorization_grant_value_codec_version","integer"],
  ["schema_version_id","text"],
  ["storage_generation","text"],
  ["storage_generation_fence","bigint"],
  ["request_key","text"],
  ["authorization_revocation_epoch","bigint"],
  ["authorization_grant_id","text"],
  ["authorization_grant_expires_at","bigint"],
  ["hard_expires_at","bigint"],
  ["created_at","bigint"],
  ["identity_access_policy_sha256","text"],
  ["request_sha256","text"],
  ["validated_args_sha256","text"],
  ["authorization_grant_sha256","text"],
  ["application_execution_authority_sha256","text"]] as const;
const captureFunctions = [
  { name: "fx_read_historical_row_identity", signature: sql`pg_catalog.quote_ident(${schemaName}) || '.fx_read_historical_row_identity(uuid,integer,bytea)'`,
    body: "cac90a3bd1168ac81ec557ef9a3852bd99d939a6de0578ad1d406e7ee243d728", argumentNames: ["p_scope_uuid","p_table_id","p_row_id","ordinal","identity_exists"],
    argumentTypes: ["uuid","integer","bytea","integer","boolean"], argumentModes: ["i","i","i","t","t"] },
  { name: "fx_accept_finite_storage_capture", signature: sql`pg_catalog.quote_ident(${schemaName}) || '.fx_accept_finite_storage_capture(text,' || pg_catalog.quote_ident(${schemaName}) || '.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer,' || pg_catalog.quote_ident(${schemaName}) || '.fx_finite_read_expected)'`,
    body: createHash("sha256").update(FINITE_STORAGE_CAPTURE_FUNCTION_SQL.split("$body$")[1]!).digest("hex"), argumentNames: ["p_scope_id","p_expected","p_anchor_bytes","p_anchor_sha256","p_snapshot_epoch_uuid","p_snapshot_commit_seq","p_metadata_watermark","p_claim_owner","p_claim_fence","p_generation","p_generation_fence","p_epoch","p_index_definition_id","p_table_id","p_unique_definition_id","p_read_basis"], argumentTypes: ["text","@target@.fx_finite_capture_expected","bytea","bytea","uuid","bigint","bigint","uuid","bigint","text","bigint","text","integer","integer","integer","@target@.fx_finite_read_expected"], argumentModes: ["i","i","i","i","i","i","i","i","i","i","i","i","i","i","i","i"] },
  { name: "fx_read_snapshot_rows", signature: sql`pg_catalog.quote_ident(${schemaName}) || '.fx_read_snapshot_rows(uuid,integer,bytea[],bigint,bigint,boolean)'`,
    body: "aa6e17ea61a64c8383342c8bf90e531616e13b3cf9b4f2310f1a8ae5aa5a5ddc", argumentNames: ["p_scope_uuid","p_table_id","p_row_ids","p_snapshot_commit_seq","p_transfer_budget","p_settlement_window","ordinal","requested_row_id","row_present","scope_uuid","table_id","row_id","commit_seq_text","prev_commit_seq_text","write_epoch_uuid","schema_version_id","creation_time","value_codec_version","is_tombstone","value_sha256","value_bytes","body_withheld"], argumentTypes: ["uuid","integer","bytea[]","bigint","bigint","boolean","integer","bytea","boolean","uuid","integer","bytea","text","text","uuid","text","double precision","integer","boolean","bytea","bytea","boolean"], argumentModes: ["i","i","i","i","i","i","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t"] },
  { name: "fx_read_snapshot_index_page", signature: sql`pg_catalog.quote_ident(${schemaName}) || '.fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,integer)'`,
    body: "df4c684cd48b066eb097978e0fef6f85809d517ec446cc3bbf3278bc21bd8895", argumentNames: ["p_scope_uuid","p_index_definition_id","p_snapshot_commit_seq","p_start_inclusive","p_end_exclusive","p_after_key","p_after_row_id","p_limit","ordinal","table_id_text","key_codec_version_text","physical_spec_sha256","encoded_key_bytes","key_sha256","row_id_bytes","commit_seq_text","is_tombstone"], argumentTypes: ["uuid","integer","bigint","bytea","bytea","bytea","bytea","integer","integer","text","text","bytea","bytea","bytea","bytea","text","boolean"], argumentModes: ["i","i","i","i","i","i","i","i","t","t","t","t","t","t","t","t","t"] },
  { name: "fx_read_application_write_ownership_snapshot", signature: sql`pg_catalog.quote_ident(${schemaName}) || '.fx_read_application_write_ownership_snapshot(text,integer,integer)'`,
    body: "625eb7926c5c695198afaec9657f8ed78924cbcfe32690bc02a1049cbf8682ef", argumentNames: ["p_scope_id","p_remaining_records","p_remaining_bytes","kind","ordinal","scopeId","sequenceText","previousSequenceText","revisionId","readinessContractVersion","relationCount","activatedAtText","createdAtText","updatedAtText","evidenceLength","evidenceBytes","evidenceSha256","bodyWithheld","readinessSha256","relationSetReadinessSha256","writePolicySetSha256","writeOwnershipSha256","activationSha256","activationRequestSha256","legacyReadinessSha256","relationReadinessSha256"], argumentTypes: ["text","integer","integer","text","integer","text","text","text","text","integer","integer","text","text","text","integer","bytea","bytea","boolean","bytea","bytea","bytea","bytea","bytea","bytea","bytea","bytea"], argumentModes: ["i","i","i","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t"] },
  { name: "fx_read_application_ownership_manifest", signature: sql`pg_catalog.quote_ident(${schemaName}) || '.fx_read_application_ownership_manifest(text,text,integer,integer)'`,
    body: "cc60187a7d005ee098abda1d32d8e5b3cc73cce5a366ba8981c36cb3c2804706", argumentNames: ["p_scope_id","p_revision_id","p_remaining_records","p_remaining_bytes","evidenceLength","bytes","hash","publicationHash","analysisHash","deploymentId","schemaVersionId"], argumentTypes: ["text","text","integer","integer","integer","bytea","bytea","bytea","bytea","text","text"], argumentModes: ["i","i","i","i","t","t","t","t","t","t","t"] },
  { name: "fx_read_application_ownership_unique_closure", signature: sql`pg_catalog.quote_ident(${schemaName}) || '.fx_read_application_ownership_unique_closure(text,text,integer,integer)'`,
    body: "f4c936ae55784665c52395678d1e957abe59ee6ba35655af270c6d1d4cefef3a", argumentNames: ["p_deployment_id","p_schema_version_id","p_remaining_records","p_remaining_bytes","kind","ordinal","evidenceLength","deploymentId","schemaVersionId","setCodecVersion","definitionCount","definitionSetSha256","closedAtText","uniqueConstraintDefinitionId","logicalUniqueConstraintId","tableId","physicalSpecCodecVersion","physicalSpecJson","physicalSpecBytes","physicalSpecSha256","definitionCreatedAtText","bindingDefinitionId","bindingLogicalId","requiredForActivation","bindingCreatedAtText"], argumentTypes: ["text","text","integer","integer","text","integer","integer","text","text","integer","integer","bytea","text","integer","integer","integer","integer","jsonb","bytea","bytea","text","integer","integer","boolean","text"], argumentModes: ["i","i","i","i","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t","t"] },
] as const;
const captureStructure = sql`
  exists (select 1 from pg_catalog.pg_type t, bounds b where t.typnamespace = b.namespace_oid
    and t.typname = 'fx_finite_capture_expected' and t.typtype = 'c' and t.typowner = b.owner_oid
    and (select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a
      where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) =
      array[${sql.join(captureExpectedFields.map(([name]) => sql`${name}`), sql`,`)}]::text[]
    and (select array_agg(a.atttypid order by a.attnum) from pg_catalog.pg_attribute a
      where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) =
      array[${sql.join(captureExpectedFields.map(([, type]) => sql`${type}::pg_catalog.regtype::oid`), sql`,`)}]::oid[])
  and ${sql.join(captureFunctions.map(fn => sql`(
    (select count(*) = 1 from pg_catalog.pg_proc p, bounds b
      where p.pronamespace = b.namespace_oid and p.proname = ${fn.name})
    and exists (select 1 from pg_catalog.pg_proc p, bounds b where p.oid = (${fn.signature})::pg_catalog.regprocedure
      and p.pronamespace = b.namespace_oid and p.proowner = b.owner_oid
      and p.proargnames = array[${sql.join(fn.argumentNames.map(name => sql`${name}`), sql`,`)}]::text[]
      and ${fn.name === "fx_accept_finite_storage_capture" ? sql`p.proallargtypes is null and p.proargtypes::text = array_to_string(array[${sql.join(fn.argumentTypes.map(type => type.startsWith("@target@.") ?
        sql`(pg_catalog.quote_ident(${schemaName}) || ${type.slice(8)})::pg_catalog.regtype::oid` : sql`${type}::pg_catalog.regtype::oid`), sql`,`)}]::oid[], ' ')` : sql`p.proallargtypes = array[${sql.join(fn.argumentTypes.map(type => type.startsWith("@target@.") ?
        sql`(pg_catalog.quote_ident(${schemaName}) || ${type.slice(8)})::pg_catalog.regtype::oid` : sql`${type}::pg_catalog.regtype::oid`), sql`,`)}]::oid[]`}
      and ${fn.name === "fx_accept_finite_storage_capture" ? sql`p.proargmodes is null` : sql`p.proargmodes = array[${sql.join(fn.argumentModes.map(mode => sql`${mode}`), sql`,`)}]::"char"[]`}
      and p.pronargdefaults = 0 and p.prokind = 'f' and p.provolatile = 'v' and not p.prosecdef and not p.proisstrict
      and ${fn.name === "fx_accept_finite_storage_capture" ? sql`not p.proretset and p.prorettype = (pg_catalog.quote_ident(${schemaName}) || '.fx_finite_capture_frontier')::pg_catalog.regtype` : sql`p.proretset and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype`}
      and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
      and p.proconfig = array['search_path=pg_catalog, pg_temp']
      and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
      and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.replace(
        pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".'), 'UTF8')), 'hex') = ${fn.body}
    ))`), sql` and `)}
`;

return sql`${captureStructure} and ${finiteCaptureFrontierInstallationSql(schemaName)} and ${finiteEntryCompletionInstallationSql(schemaName)}
  and not exists (select 1 from pg_catalog.pg_proc p where p.pronamespace=${schemaName}::pg_catalog.regnamespace
    and p.proname='fx_accept_finite_placement_frontier')
  and not exists (select 1 from pg_catalog.pg_type t where t.typnamespace=${schemaName}::pg_catalog.regnamespace
    and t.typname='fx_finite_placement_frontier')
  and ${finiteEntryObservationInstallationSql(schemaName)} and ${finitePublicationInstallationSql(schemaName)}
  and ${applicationDomainInstallationSql(schemaName)}`;
}

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
  and not exists (select 1 from pg_catalog.pg_proc p, bounds b where p.pronamespace = b.namespace_oid
    and p.proname = 'fx_lock_finite_scope_observation')
  and ${finiteCaptureInstallationSql(schemaName)}
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

/** Canonical fixed capture body; actual table composites follow the installed schema. */
export const FINITE_STORAGE_CAPTURE_FUNCTION_SQL = `    CREATE OR REPLACE FUNCTION "__flarex_target__".fx_accept_finite_storage_capture(p_scope_id text,
      p_expected "__flarex_target__".fx_finite_capture_expected, p_anchor_bytes bytea, p_anchor_sha256 bytea,
      p_snapshot_epoch_uuid uuid, p_snapshot_commit_seq bigint, p_metadata_watermark bigint,
      p_claim_owner uuid, p_claim_fence bigint, p_generation text, p_generation_fence bigint, p_epoch text,
      p_index_definition_id integer, p_table_id integer, p_unique_definition_id integer,
      p_read_basis "__flarex_target__".fx_finite_read_expected)
    RETURNS "__flarex_target__".fx_finite_capture_frontier
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE reason text; database_now_epoch_milliseconds text; serving_commit_seq bigint;
      authority_row "__flarex_target__".fx_system_scope_execution_authority;
      session_row "__flarex_target__".fx_system_tx_session;
      build_row "__flarex_target__".fx_system_index_build_state;
      unique_row "__flarex_target__".fx_system_unique_constraint_build;
      table_frontier bigint; historical_change boolean; body_eligible boolean := false;
      retained_floor bigint;
      index_maintenance "__flarex_target__".fx_system_index_maintenance_obligation;
      unique_maintenance "__flarex_target__".fx_system_unique_maintenance_obligation;
      index_ready boolean; unique_ready boolean;
      s "__flarex_target__".fx_system_tx_session; clock_row "__flarex_target__".fx_system_scope_clock; current_time_ms bigint;
      effective_statement_timeout interval;
    BEGIN
      -- Startup arms the statement before execution. Re-check the actual pooled
      -- session setting before authority, attempt or build locks and body access.
      effective_statement_timeout := current_setting('statement_timeout')::interval;
      IF effective_statement_timeout <= interval '0 milliseconds'
        OR effective_statement_timeout > interval '30000 milliseconds' THEN
        reason := 'resourceFailure'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      reason := 'invalidAuthority';
      IF p_scope_id IS NULL THEN RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      SELECT a.* INTO authority_row FROM "__flarex_target__".fx_system_scope_execution_authority a WHERE a.scope_id = p_scope_id FOR SHARE;
      IF authority_row.scope_id IS NULL THEN RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      -- Intrinsic scope corruption precedes generation verdicts and session waits.
      SELECT c.* INTO clock_row FROM "__flarex_target__".fx_system_scope_clock c WHERE c.scope_id = p_scope_id;
      IF clock_row.scope_id IS NULL OR clock_row.scope_uuid IS DISTINCT FROM (p_expected).scope_uuid
        OR authority_row.storage_generation NOT IN ('legacy_v1','flarexdb_v1')
        OR authority_row.storage_generation_fence < 1
        OR clock_row.last_commit_seq < 0 OR clock_row.last_metadata_sequence < 0
        OR authority_row.oldest_available_commit_seq < 0 OR authority_row.oldest_available_commit_seq > clock_row.last_commit_seq
        OR authority_row.authorization_revocation_epoch < 0
        OR NOT isfinite(clock_row.updated_at) OR NOT isfinite(authority_row.updated_at)
        OR btrim(authority_row.epoch) = '' OR authority_row.epoch_uuid IS NULL THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_generation <> 'flarexdb_v1' OR authority_row.storage_generation <> 'flarexdb_v1' THEN
        reason := 'unsupportedStorageGeneration'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF authority_row.storage_generation_fence IS DISTINCT FROM p_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF authority_row.epoch IS DISTINCT FROM p_epoch THEN reason := 'scopeEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      -- Identity lookup precedes fence interpretation, including corrupt replaced rows.
      SELECT a.* INTO s FROM "__flarex_target__".fx_system_tx_session a
        WHERE a.scope_uuid = (substring(p_scope_id FROM 7))::uuid AND a.session_id = (p_expected).session_id FOR SHARE;
      IF s.session_id IS NULL THEN reason := 'attemptMissing'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      IF NOT isfinite(s.authorization_grant_expires_at) OR NOT isfinite(s.hard_expires_at)
        OR NOT isfinite(s.created_at) OR NOT isfinite(s.updated_at)
        OR s.finite_lease_expires_at IS NULL OR NOT isfinite(s.finite_lease_expires_at)
        OR s.finite_claimed_at IS NULL OR NOT isfinite(s.finite_claimed_at)
        OR s.finite_claim_expires_at IS NULL OR NOT isfinite(s.finite_claim_expires_at) THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.finite_attempt_bytes IS NULL OR octet_length(s.finite_attempt_bytes) NOT BETWEEN 1 AND 131072
        OR s.finite_attempt_sha256 IS NULL OR octet_length(s.finite_attempt_sha256) <> 32
        OR s.finite_snapshot_epoch_uuid IS NULL OR s.finite_snapshot_commit_seq IS NULL
        OR s.finite_snapshot_commit_seq < 0 OR s.attempt_fence < 1
        OR s.finite_claim_owner IS NULL OR s.finite_claim_fence IS NULL OR s.finite_claim_fence < 1
        OR s.finite_claim_expires_at <= s.finite_claimed_at OR s.finite_claim_expires_at > s.finite_lease_expires_at
        OR s.finite_lease_expires_at > s.hard_expires_at THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.attempt_fence <> (p_expected).attempt_fence THEN
        -- The owning canonical decoder checks this fresh frontier before the
        -- replacement verdict. No business body is selected for this header.
        session_row := s; reason := 'attemptReplaced'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.finite_attempt_bytes IS DISTINCT FROM p_anchor_bytes OR s.finite_attempt_sha256 IS DISTINCT FROM p_anchor_sha256
        OR s.finite_snapshot_epoch_uuid IS DISTINCT FROM p_snapshot_epoch_uuid
        OR s.finite_snapshot_commit_seq IS DISTINCT FROM p_snapshot_commit_seq
        OR s.finite_metadata_watermark IS DISTINCT FROM p_metadata_watermark
        OR s.scope_uuid IS DISTINCT FROM (p_expected).scope_uuid
        OR s.session_id IS DISTINCT FROM (p_expected).session_id
        OR s.attempt_fence IS DISTINCT FROM (p_expected).attempt_fence
        OR s.policy_version IS DISTINCT FROM (p_expected).policy_version
        OR s.protocol_version IS DISTINCT FROM (p_expected).protocol_version
        OR s.execution_profile IS DISTINCT FROM (p_expected).execution_profile
        OR s.execution_authority_generation IS DISTINCT FROM (p_expected).execution_authority_generation
        OR s.function_path IS DISTINCT FROM (p_expected).function_path
        OR s.function_kind IS DISTINCT FROM (p_expected).function_kind
        OR s.execution_module IS DISTINCT FROM (p_expected).execution_module
        OR s.package_id IS DISTINCT FROM (p_expected).package_id
        OR s.artifact_runtime IS DISTINCT FROM (p_expected).artifact_runtime
        OR s.artifact_id IS DISTINCT FROM (p_expected).artifact_id
        OR s.source_package_hash IS DISTINCT FROM (p_expected).source_package_hash
        OR s.validated_args_value_codec_version IS DISTINCT FROM (p_expected).validated_args_value_codec_version
        OR s.authorization_grant_value_codec_version IS DISTINCT FROM (p_expected).authorization_grant_value_codec_version
        OR s.schema_version_id IS DISTINCT FROM (p_expected).schema_version_id
        OR s.storage_generation IS DISTINCT FROM (p_expected).storage_generation
        OR s.storage_generation_fence IS DISTINCT FROM (p_expected).storage_generation_fence
        OR s.request_key IS DISTINCT FROM (p_expected).request_key
        OR s.authorization_revocation_epoch IS DISTINCT FROM (p_expected).authorization_revocation_epoch
        OR s.authorization_grant_id IS DISTINCT FROM (p_expected).authorization_grant_id
        OR floor(extract(epoch FROM s.authorization_grant_expires_at) * 1000)::bigint IS DISTINCT FROM (p_expected).authorization_grant_expires_at
        OR floor(extract(epoch FROM s.hard_expires_at) * 1000)::bigint IS DISTINCT FROM (p_expected).hard_expires_at
        OR floor(extract(epoch FROM s.created_at) * 1000)::bigint IS DISTINCT FROM (p_expected).created_at
        OR encode(s.identity_access_policy_sha256,'hex') IS DISTINCT FROM (p_expected).identity_access_policy_sha256
        OR encode(s.request_sha256,'hex') IS DISTINCT FROM (p_expected).request_sha256
        OR encode(s.validated_args_sha256,'hex') IS DISTINCT FROM (p_expected).validated_args_sha256
        OR encode(s.authorization_grant_sha256,'hex') IS DISTINCT FROM (p_expected).authorization_grant_sha256
        OR encode(s.application_execution_authority_sha256,'hex') IS DISTINCT FROM (p_expected).application_execution_authority_sha256
        OR s.finite_lease_expires_at IS NULL OR s.finite_claim_owner IS NULL OR s.finite_claim_fence IS NULL
        OR s.finite_claimed_at IS NULL OR s.finite_claim_expires_at IS NULL
        OR s.finite_claim_expires_at <= s.finite_claimed_at OR s.finite_claim_expires_at > s.finite_lease_expires_at
        OR s.finite_lease_expires_at > s.hard_expires_at THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.finite_claim_owner <> p_claim_owner OR s.finite_claim_fence <> p_claim_fence THEN
        reason := 'ownershipChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_unique_definition_id IS NOT NULL THEN
        SELECT b.* INTO unique_row FROM "__flarex_target__".fx_system_unique_constraint_build b
          WHERE b.scope_id = p_scope_id AND b.unique_constraint_definition_id = p_unique_definition_id FOR KEY SHARE;
      END IF;
      IF p_index_definition_id IS NOT NULL THEN
        SELECT b.* INTO build_row FROM "__flarex_target__".fx_system_index_build_state b
          WHERE b.scope_id = p_scope_id AND b.index_definition_id = p_index_definition_id FOR KEY SHARE;
      END IF;
      -- Separate VOLATILE commands reacquire fresh snapshots after every selected build wait.
      SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint INTO current_time_ms;
      SELECT c.last_commit_seq INTO serving_commit_seq FROM "__flarex_target__".fx_system_scope_clock c WHERE c.scope_id = p_scope_id;
      database_now_epoch_milliseconds := current_time_ms::text;
      historical_change := false;
      IF build_row.covered_through_commit_seq IS NOT NULL AND build_row.covered_through_commit_seq < p_snapshot_commit_seq THEN
        SELECT r.commit_seq INTO table_frontier FROM "__flarex_target__".fx_app_row_current r
          WHERE r.scope_uuid = s.scope_uuid AND r.table_id = p_table_id ORDER BY r.commit_seq DESC LIMIT 1;
        IF table_frontier > build_row.covered_through_commit_seq THEN
          SELECT EXISTS(SELECT 1 FROM "__flarex_target__".fx_system_commit_app_row_change h WHERE h.scope_uuid = s.scope_uuid
            AND h.table_id = p_table_id AND h.commit_seq > build_row.covered_through_commit_seq
            AND h.commit_seq <= p_snapshot_commit_seq) INTO historical_change;
        END IF;
      ELSIF unique_row.covered_through_commit_seq IS NOT NULL AND unique_row.covered_through_commit_seq < p_snapshot_commit_seq THEN
        SELECT r.commit_seq INTO table_frontier FROM "__flarex_target__".fx_app_row_current r
          WHERE r.scope_uuid = s.scope_uuid AND r.table_id = p_table_id ORDER BY r.commit_seq DESC LIMIT 1;
        IF table_frontier > unique_row.covered_through_commit_seq THEN
          SELECT EXISTS(SELECT 1 FROM "__flarex_target__".fx_system_commit_app_row_change h WHERE h.scope_uuid = s.scope_uuid
            AND h.table_id = p_table_id AND h.commit_seq > unique_row.covered_through_commit_seq
            AND h.commit_seq <= p_snapshot_commit_seq) INTO historical_change;
        END IF;
      END IF;
      IF s.lifecycle <> 'running' THEN reason := 'lifecycleChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      IF current_time_ms >= floor(extract(epoch FROM s.finite_lease_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.finite_claim_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.authorization_grant_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.hard_expires_at)*1000) THEN
        reason := 'expired'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.storage_generation <> authority_row.storage_generation OR s.storage_generation_fence <> authority_row.storage_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_epoch <> authority_row.epoch OR p_snapshot_epoch_uuid <> authority_row.epoch_uuid THEN
        reason := 'scopeEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.authorization_revocation_epoch <> authority_row.authorization_revocation_epoch THEN
        reason := 'authorizationRevocationEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_snapshot_commit_seq < authority_row.oldest_available_commit_seq THEN reason := 'expired'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      -- Complete mutable readiness belongs to this fresh accepting command.
      -- Corruption precedes availability; index fast paths retain their original
      -- early return before an optional unique demand. No live verdict is cached.
      retained_floor := authority_row.oldest_available_commit_seq;
      IF serving_commit_seq IS NULL OR serving_commit_seq < p_snapshot_commit_seq
        OR retained_floor > serving_commit_seq OR table_frontier < 1 THEN
        reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_index_definition_id IS NOT NULL AND (p_read_basis).accept_readiness THEN
        IF build_row.scope_id IS NULL THEN reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF (${INDEX_BUILD_INTRINSIC_VALIDITY_SQL}) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        SELECT m.* INTO index_maintenance FROM "__flarex_target__".fx_system_index_maintenance_obligation m
          WHERE m.scope_id = build_row.scope_id AND m.index_definition_id = build_row.index_definition_id
            AND m.activation_sequence = build_row.maintenance_activation_sequence;
        IF (build_row.maintenance_activation_sequence IS NULL) IS DISTINCT FROM (index_maintenance.scope_id IS NULL) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF index_maintenance.scope_id IS NOT NULL AND (${INDEX_MAINTENANCE_OPENING_VALIDITY_SQL}) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF build_row.start_commit_seq > serving_commit_seq OR build_row.covered_through_commit_seq > serving_commit_seq
          OR build_row.storage_generation IS DISTINCT FROM authority_row.storage_generation
          OR build_row.storage_generation_fence IS DISTINCT FROM authority_row.storage_generation_fence
          OR build_row.epoch IS DISTINCT FROM authority_row.epoch THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF build_row.lifecycle <> 'enabled' OR build_row.first_readable_commit_seq IS NULL
          OR build_row.first_readable_commit_seq > p_snapshot_commit_seq OR build_row.covered_through_commit_seq IS NULL THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF index_maintenance.scope_id IS NOT NULL AND (index_maintenance.table_id IS DISTINCT FROM p_table_id
          OR index_maintenance.physical_spec_sha256 IS DISTINCT FROM (p_read_basis).index_physical_spec_sha256) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        index_ready := build_row.covered_through_commit_seq >= p_snapshot_commit_seq
          OR index_maintenance.scope_id IS NOT NULL
            AND index_maintenance.deployment_id = (p_read_basis).deployment_id
            AND index_maintenance.schema_version_id = (p_read_basis).schema_version_id
            AND index_maintenance.activation_sequence = (p_read_basis).activation_sequence
            AND index_maintenance.head_sha256 = (p_read_basis).head_sha256
            AND index_maintenance.activation_sha256 = (p_read_basis).activation_sha256
            AND index_maintenance.schema_manifest_sha256 = (p_read_basis).manifest_sha256
          OR table_frontier IS NULL OR table_frontier <= build_row.covered_through_commit_seq;
        IF index_ready IS TRUE THEN reason := 'accepted'; body_eligible := true; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF build_row.covered_through_commit_seq < retained_floor OR historical_change THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
      END IF;
      IF p_unique_definition_id IS NOT NULL AND (p_read_basis).accept_readiness THEN
        IF unique_row.scope_id IS NULL THEN reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF (unique_row.scope_id = p_scope_id
          AND unique_row.unique_constraint_definition_id = p_unique_definition_id
          AND unique_row.unique_constraint_definition_id > 0
          AND unique_row.start_commit_seq >= 0
          AND (unique_row.covered_through_commit_seq IS NULL OR unique_row.covered_through_commit_seq >= unique_row.start_commit_seq)
          AND unique_row.attempt_fence > 0
          AND unique_row.storage_generation = 'flarexdb_v1'
          AND unique_row.storage_generation_fence > 0
          AND length(unique_row.epoch) > 0
          AND unique_row.lifecycle IN ('declared','building','backfilling','validating','enabled')
          AND (unique_row.cursor_row_id IS NULL OR octet_length(unique_row.cursor_row_id) = 16)
          AND (unique_row.lifecycle NOT IN ('declared','building','enabled') OR unique_row.cursor_row_id IS NULL)
          AND (unique_row.lifecycle NOT IN ('declared','building') OR unique_row.covered_through_commit_seq IS NULL)
          AND (unique_row.lifecycle <> 'enabled' OR unique_row.covered_through_commit_seq IS NOT NULL)
          AND isfinite(unique_row.created_at)
          AND isfinite(unique_row.updated_at)
          AND abs(floor(extract(epoch FROM unique_row.created_at)*1000)) <= 8640000000000000
          AND abs(floor(extract(epoch FROM unique_row.updated_at)*1000)) <= 8640000000000000
          AND floor(extract(epoch FROM unique_row.updated_at)*1000) >= floor(extract(epoch FROM unique_row.created_at)*1000)
          AND unique_row.start_commit_seq <= serving_commit_seq
          AND (unique_row.covered_through_commit_seq IS NULL OR unique_row.covered_through_commit_seq <= serving_commit_seq)) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        SELECT m.* INTO unique_maintenance FROM "__flarex_target__".fx_system_unique_maintenance_obligation m
          WHERE m.scope_id = unique_row.scope_id AND m.unique_constraint_definition_id = unique_row.unique_constraint_definition_id
            AND m.activation_sequence = unique_row.maintenance_activation_sequence;
        IF (unique_row.maintenance_activation_sequence IS NULL) IS DISTINCT FROM (unique_maintenance.scope_id IS NULL) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_maintenance.scope_id IS NOT NULL AND (unique_maintenance.activation_sequence > 0
          AND unique_maintenance.storage_generation = 'flarexdb_v1'
          AND unique_maintenance.storage_generation_fence > 0
          AND length(unique_maintenance.epoch) > 0
          AND unique_maintenance.opened_commit_seq >= 0
          AND unique_maintenance.table_id > 0
          AND octet_length(unique_maintenance.physical_spec_sha256) = 32
          AND length(unique_maintenance.deployment_id) > 0
          AND length(unique_maintenance.schema_version_id) > 0
          AND octet_length(unique_maintenance.activation_sha256) = 32
          AND octet_length(unique_maintenance.head_sha256) = 32
          AND unique_maintenance.unique_constraint_definition_id > 0
          AND unique_maintenance.attempt_fence > 0
          AND unique_maintenance.start_commit_seq >= 0
          AND unique_maintenance.start_commit_seq <= unique_maintenance.opened_commit_seq
          AND unique_row.lifecycle = 'enabled'
          AND unique_maintenance.activation_sequence = unique_row.maintenance_activation_sequence
          AND unique_maintenance.scope_id = unique_row.scope_id
          AND unique_maintenance.unique_constraint_definition_id = unique_row.unique_constraint_definition_id
          AND unique_maintenance.storage_generation = unique_row.storage_generation
          AND unique_maintenance.storage_generation_fence = unique_row.storage_generation_fence
          AND unique_maintenance.epoch = unique_row.epoch
          AND unique_maintenance.attempt_fence = unique_row.attempt_fence
          AND unique_maintenance.start_commit_seq = unique_row.start_commit_seq
          AND unique_maintenance.opened_commit_seq = unique_row.covered_through_commit_seq) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_row.storage_generation IS DISTINCT FROM authority_row.storage_generation
          OR unique_row.storage_generation_fence IS DISTINCT FROM authority_row.storage_generation_fence
          OR unique_row.epoch IS DISTINCT FROM authority_row.epoch OR unique_row.lifecycle <> 'enabled'
          OR unique_row.start_commit_seq > p_snapshot_commit_seq OR unique_row.covered_through_commit_seq IS NULL THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_maintenance.scope_id IS NOT NULL AND (unique_maintenance.table_id IS DISTINCT FROM p_table_id
          OR unique_maintenance.physical_spec_sha256 IS DISTINCT FROM (p_read_basis).unique_physical_spec_sha256) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        unique_ready := unique_row.covered_through_commit_seq >= p_snapshot_commit_seq
          OR unique_maintenance.scope_id IS NOT NULL
            AND unique_maintenance.deployment_id = (p_read_basis).deployment_id
            AND unique_maintenance.schema_version_id = (p_read_basis).schema_version_id
            AND unique_maintenance.activation_sequence = (p_read_basis).activation_sequence
            AND unique_maintenance.head_sha256 = (p_read_basis).head_sha256
            AND unique_maintenance.activation_sha256 = (p_read_basis).activation_sha256
          OR table_frontier IS NULL OR table_frontier <= unique_row.covered_through_commit_seq;
        IF unique_ready IS NOT TRUE AND (unique_row.covered_through_commit_seq < retained_floor OR historical_change) THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
      END IF;
      reason := 'accepted'; body_eligible := true; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
    END;
    $body$`;

import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { fxSystemTransactionSessions } from "./schema";
import { FINITE_METADATA_COMPARISON_FUNCTION_SQL } from "./finiteMetadataComparison";

const columns = Object.values(getTableColumns(fxSystemTransactionSessions));
const namespace = sql.raw("%1$I");
const session = sql`${namespace}.${sql.identifier(getTableName(fxSystemTransactionSessions))}`;
const field = (name: string) => sql.identifier(name);
const compile = (statement: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(statement).sql;

/** The installed expectation is private parameter structure, not durable data.
 * Named assignments keep physical table column order out of this contract. */
export const FINITE_ENTRY_EXPECTED_TYPE_SQL = compile(sql`CREATE TYPE ${namespace}.fx_finite_entry_expected AS (
  ${sql.join(columns.map(column => sql`${field(column.name)} ${sql.raw(column.getSQLType())}`), sql`,\n  `)}
);`);

/** One owner-authored complete insertion and fresh stored-column proof. All
 * table and column names come from the real session schema owner. */
export const FINITE_ENTRY_COMPLETION_FUNCTION_SQL = compile(sql`
CREATE FUNCTION ${namespace}.fx_complete_finite_entry(
  p_expected ${namespace}.fx_finite_entry_expected, p_guard_valid boolean)
RETURNS TABLE(reason text, database_now timestamptz, lease_expires_at timestamptz,
  claim_expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $completion$
DECLARE expected_row ${session}; actual_row ${session}; inserted_id uuid;
BEGIN
  IF p_guard_valid IS DISTINCT FROM true THEN reason := 'protectedMetadataChanged'; RETURN NEXT; RETURN; END IF;
  ${sql.join(columns.map(column => sql`expected_row.${field(column.name)} := (p_expected).${field(column.name)};`), sql`\n  `)}
  -- Time is sampled after the real metadata/epoch work. Original preparation
  -- bounds must still be live; renewal never revives an expired entry.
  database_now := to_timestamp(trunc(extract(epoch from clock_timestamp()) * 1000) / 1000);
  IF expected_row.${field(fxSystemTransactionSessions.finiteClaimExpiresAt.name)} <= database_now
    OR expected_row.${field(fxSystemTransactionSessions.finiteLeaseExpiresAt.name)} <= database_now
    OR expected_row.${field(fxSystemTransactionSessions.authorizationGrantExpiresAt.name)} <= database_now
    OR expected_row.${field(fxSystemTransactionSessions.hardExpiresAt.name)} <= database_now THEN
    reason := 'expired'; RETURN NEXT; RETURN;
  END IF;
  lease_expires_at := greatest(expected_row.${field(fxSystemTransactionSessions.finiteLeaseExpiresAt.name)},
    least(database_now + (expected_row.${field(fxSystemTransactionSessions.finiteLeaseExpiresAt.name)}
      - expected_row.${field(fxSystemTransactionSessions.finiteClaimedAt.name)}),
      expected_row.${field(fxSystemTransactionSessions.authorizationGrantExpiresAt.name)}, expected_row.${field(fxSystemTransactionSessions.hardExpiresAt.name)}));
  claim_expires_at := greatest(expected_row.${field(fxSystemTransactionSessions.finiteClaimExpiresAt.name)},
    least(database_now + (expected_row.${field(fxSystemTransactionSessions.finiteClaimExpiresAt.name)}
      - expected_row.${field(fxSystemTransactionSessions.finiteClaimedAt.name)}), lease_expires_at,
      expected_row.${field(fxSystemTransactionSessions.authorizationGrantExpiresAt.name)}, expected_row.${field(fxSystemTransactionSessions.hardExpiresAt.name)}));
  expected_row.${field(fxSystemTransactionSessions.finiteLeaseExpiresAt.name)} := lease_expires_at;
  expected_row.${field(fxSystemTransactionSessions.finiteClaimExpiresAt.name)} := claim_expires_at;
  INSERT INTO ${session} (${sql.join(columns.map(column => field(column.name)), sql`, `)})
    VALUES (${sql.join(columns.map(column => sql`expected_row.${field(column.name)}`), sql`, `)})
    ON CONFLICT (${field(fxSystemTransactionSessions.scopeUuid.name)}, ${field(fxSystemTransactionSessions.sessionId.name)}) DO NOTHING
    RETURNING ${field(fxSystemTransactionSessions.sessionId.name)} INTO inserted_id;
  IF inserted_id IS NULL THEN reason := 'sessionIdCollision'; RETURN NEXT; RETURN; END IF;
  -- A separate VOLATILE statement sees AFTER INSERT updates. No stored body is
  -- returned to the caller, and every column participates in exact equality.
  SELECT s.* INTO STRICT actual_row FROM ${session} s
    WHERE s.${field(fxSystemTransactionSessions.scopeUuid.name)} = expected_row.${field(fxSystemTransactionSessions.scopeUuid.name)}
      AND s.${field(fxSystemTransactionSessions.sessionId.name)} = expected_row.${field(fxSystemTransactionSessions.sessionId.name)};
  IF actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  reason := 'accepted'; RETURN NEXT;
END;
$completion$;
`);

const completionBody = FINITE_ENTRY_COMPLETION_FUNCTION_SQL.split("$completion$")[1]!
  .replaceAll("%1$I.", '"__flarex_target__".');
const comparisonBody = FINITE_METADATA_COMPARISON_FUNCTION_SQL.split("$metadata$")[1]!
  .replaceAll("%1$I.", '"__flarex_target__".');

/** Installation-only exact structural attestation. Serving compares live facts
 * through the installed owner, without retaining another integrity verdict. */
export function finiteEntryCompletionInstallationSql(schemaName: SQL): SQL<boolean> {
  const expectedType = sql`(pg_catalog.quote_ident(${schemaName}) || '.fx_finite_entry_expected')::pg_catalog.regtype::oid`;
  const normalizedBody = sql`pg_catalog.replace(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),
    pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".')`;
  const common = sql`p.pronamespace = b.namespace_oid and p.proowner = b.owner_oid
    and p.pronargdefaults = 0 and p.prokind = 'f' and not p.prosecdef and not p.proisstrict
    and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
    and p.proconfig = array['search_path=pg_catalog, pg_temp']
    and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')`;
  return sql<boolean>`(
    exists (select 1 from pg_catalog.pg_type t, bounds b where t.oid = ${expectedType}
      and t.typnamespace = b.namespace_oid and t.typtype = 'c' and t.typowner = b.owner_oid
      and (select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a
        where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) =
        array[${sql.join(columns.map(column => sql`${column.name}`), sql`,`)}]::text[]
      and (select array_agg(a.atttypid order by a.attnum) from pg_catalog.pg_attribute a
        where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) =
        array[${sql.join(columns.map(column => sql`${column.getSQLType()}::pg_catalog.regtype::oid`), sql`,`)}]::oid[]
      and (select array_agg(a.atttypmod order by a.attnum) from pg_catalog.pg_attribute a
        where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) =
        array[${sql.join(columns.map(column => sql`(select a.atttypmod from pg_catalog.pg_attribute a
          where a.attrelid = (pg_catalog.quote_ident(${schemaName}) || '.' ||
            ${getTableName(fxSystemTransactionSessions)})::pg_catalog.regclass
            and a.attname = ${column.name} and a.attnum > 0 and not a.attisdropped)`), sql`,`)}]::integer[])
    and (select count(*) = 1 from pg_catalog.pg_proc p, bounds b
      where p.pronamespace = b.namespace_oid and p.proname = 'fx_complete_finite_entry')
    and exists (select 1 from pg_catalog.pg_proc p, bounds b
      where p.oid = (pg_catalog.quote_ident(${schemaName}) ||
        '.fx_complete_finite_entry(' || pg_catalog.quote_ident(${schemaName}) || '.fx_finite_entry_expected,boolean)')::pg_catalog.regprocedure
      and ${common} and p.provolatile = 'v' and p.proretset and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype
      and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
      and p.proargnames = array['p_expected','p_guard_valid',
        'reason','database_now','lease_expires_at','claim_expires_at']::text[]
      and p.proallargtypes = array[${expectedType},'boolean'::pg_catalog.regtype::oid,'text'::pg_catalog.regtype::oid,
        'timestamptz'::pg_catalog.regtype::oid,'timestamptz'::pg_catalog.regtype::oid,
        'timestamptz'::pg_catalog.regtype::oid]::oid[]
      and p.proargmodes = array['i','i','t','t','t','t']::"char"[]
      and ${normalizedBody} = ${completionBody})
    and (select count(*) = 1 from pg_catalog.pg_proc p, bounds b
      where p.pronamespace = b.namespace_oid and p.proname = 'fx_compare_finite_metadata')
    and exists (select 1 from pg_catalog.pg_proc p, bounds b
      where p.oid = (pg_catalog.quote_ident(${schemaName}) || '.fx_compare_finite_metadata(text,bigint,jsonb)')::pg_catalog.regprocedure
      and ${common} and p.provolatile = 's' and not p.proretset and p.prorettype = 'jsonb'::pg_catalog.regtype
      and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'sql')
      and p.proargnames = array['p_scope_id','p_watermark','p_expected']::text[]
      and p.proallargtypes is null and p.proargmodes is null
      and p.proargtypes = array['text'::pg_catalog.regtype::oid,'bigint'::pg_catalog.regtype::oid,'jsonb'::pg_catalog.regtype::oid]::oidvector
      and ${normalizedBody} = ${comparisonBody})
  )`;
}

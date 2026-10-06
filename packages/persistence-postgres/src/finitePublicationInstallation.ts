import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { fxSystemCommits, fxSystemIdempotency, fxSystemTransactionSessions } from "./schema";
import { SCOPE_PUBLICATION_CLOCK_FUNCTION_SQL, SCOPE_PUBLICATION_GUARD_REFUSAL_FUNCTION_SQL } from "./commitPublication/installation";
import { SCOPE_PUBLICATION_PREFIX_FUNCTIONS } from "./commitPublication/prefixInstallation";

/** Renewal and terminal state are freshly observed after the stable anchor lock.
 * Every other real session column participates in complete immutable equality. */
export const FINITE_PUBLICATION_MUTABLE_SESSION_COLUMNS = [
  fxSystemTransactionSessions.lifecycle,
  fxSystemTransactionSessions.updatedAt,
  fxSystemTransactionSessions.finiteLeaseExpiresAt,
  fxSystemTransactionSessions.finiteClaimOwner,
  fxSystemTransactionSessions.finiteClaimFence,
  fxSystemTransactionSessions.finiteClaimedAt,
  fxSystemTransactionSessions.finiteClaimExpiresAt,
] as const;

const mutableNames = new Set<string>(FINITE_PUBLICATION_MUTABLE_SESSION_COLUMNS.map(column => column.name));
export const FINITE_PUBLICATION_IMMUTABLE_SESSION_COLUMNS = Object.values(getTableColumns(fxSystemTransactionSessions))
  .filter(column => !mutableNames.has(column.name));
const sessions = sql`${sql.raw("%1$I")}.${sql.identifier(getTableName(fxSystemTransactionSessions))}`;
const outcomes = sql`${sql.raw("%1$I")}.${sql.identifier(getTableName(fxSystemIdempotency))}`;
const commits = sql`${sql.raw("%1$I")}.${sql.identifier(getTableName(fxSystemCommits))}`;
const actual = (name: string) => sql`actual_session.${sql.identifier(name)}`;
const expected = (name: string) => sql`expected_session.${sql.identifier(name)}`;
const equality = sql.join(FINITE_PUBLICATION_IMMUTABLE_SESSION_COLUMNS.map(column =>
  sql`${actual(column.name)} IS NOT DISTINCT FROM ${expected(column.name)}`), sql` AND `);
const mutableReturnColumns = sql.join(FINITE_PUBLICATION_MUTABLE_SESSION_COLUMNS.map(column =>
  sql`${sql.identifier(column.name)} ${sql.raw(column.getSQLType())}`), sql`, `);
const absentMutableColumns = sql.join(FINITE_PUBLICATION_MUTABLE_SESSION_COLUMNS.map(column =>
  sql`NULL::${sql.raw(column.getSQLType())}`), sql`, `);
const mutableProjection = sql.join(FINITE_PUBLICATION_MUTABLE_SESSION_COLUMNS.map(column => actual(column.name)), sql`, `);

/** The callback profile uses this same real stable lock before sessionLocked.
 * The complete observation invokes it internally in the healthy profile. */
export const FINITE_PUBLICATION_ANCHOR_LOCK_FUNCTION_SQL = new PgDialect().sqlToQuery(sql`
CREATE FUNCTION %1$I.fx_lock_finite_publication_anchor(p_scope_uuid uuid, p_session_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $publication_lock$
DECLARE found_session boolean;
BEGIN
  SELECT true INTO found_session FROM ${sessions} s
    WHERE s.${sql.identifier(fxSystemTransactionSessions.scopeUuid.name)} = p_scope_uuid
      AND s.${sql.identifier(fxSystemTransactionSessions.sessionId.name)} = p_session_id
    FOR UPDATE;
  RETURN coalesce(found_session, false);
END
$publication_lock$;
`).sql;

/** Fixed finite publisher observation. Separate procedural SELECT statements
 * obtain the outcome snapshot after an actual anchor wait. Neither the serving
 * capture procedure nor an outer CTE can substitute for that ordering. */
export const FINITE_PUBLICATION_ANCHOR_FUNCTION_SQL = new PgDialect().sqlToQuery(sql`
CREATE FUNCTION %1$I.fx_observe_finite_publication(
  p_scope_uuid uuid, p_session_id uuid, p_request_key text, p_expected jsonb)
RETURNS TABLE(reason text, outcome ${outcomes}, retained_header ${commits}, database_now timestamptz, ${mutableReturnColumns})
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $publication_anchor$
DECLARE
  actual_session ${sessions};
  expected_session ${sessions};
  actual_outcome ${outcomes};
  actual_header ${commits};
BEGIN
  IF NOT %1$I.fx_lock_finite_publication_anchor(p_scope_uuid, p_session_id) THEN
    RETURN QUERY SELECT 'attemptMissing'::text, NULL::${outcomes}, NULL::${commits}, NULL::timestamptz, ${absentMutableColumns};
    RETURN;
  END IF;
  SELECT o.* INTO actual_outcome FROM ${outcomes} o
    WHERE o.${sql.identifier(fxSystemIdempotency.scopeUuid.name)} = p_scope_uuid
      AND o.${sql.identifier(fxSystemIdempotency.requestKey.name)} = p_request_key;
  IF FOUND THEN
    SELECT c.* INTO actual_header FROM ${commits} c
      WHERE c.${sql.identifier(fxSystemCommits.scopeUuid.name)} = p_scope_uuid
        AND c.${sql.identifier(fxSystemCommits.commitSeq.name)} = actual_outcome.${sql.identifier(fxSystemIdempotency.commitSeq.name)};
    RETURN QUERY SELECT 'replay'::text, actual_outcome, actual_header, NULL::timestamptz, ${absentMutableColumns};
    RETURN;
  END IF;
  SELECT s.* INTO actual_session FROM ${sessions} s
    WHERE s.${sql.identifier(fxSystemTransactionSessions.scopeUuid.name)} = p_scope_uuid
      AND s.${sql.identifier(fxSystemTransactionSessions.sessionId.name)} = p_session_id;
  SELECT * INTO expected_session FROM jsonb_populate_record(NULL::${sessions}, p_expected);
  IF NOT (${equality}) THEN
    RETURN QUERY SELECT 'storedCorruption'::text, NULL::${outcomes}, NULL::${commits}, NULL::timestamptz, ${absentMutableColumns};
    RETURN;
  END IF;
  RETURN QUERY SELECT 'accepted'::text, NULL::${outcomes}, NULL::${commits}, clock_timestamp(), ${mutableProjection};
END
$publication_anchor$;
`).sql;

export const FINITE_PUBLICATION_FUNCTIONS = [
  { name: "fx_lock_finite_publication_anchor", signature: "uuid,uuid", ddl: FINITE_PUBLICATION_ANCHOR_LOCK_FUNCTION_SQL,
    delimiter: "$publication_lock$", inputs: ["p_scope_uuid", "p_session_id"], outputs: [], outputTypes: [], result: "boolean" },
  { name: "fx_observe_finite_publication", signature: "uuid,uuid,text,jsonb", ddl: FINITE_PUBLICATION_ANCHOR_FUNCTION_SQL,
    delimiter: "$publication_anchor$", inputs: ["p_scope_uuid", "p_session_id", "p_request_key", "p_expected"],
    outputs: ["reason", "outcome", "retained_header", "database_now", ...FINITE_PUBLICATION_MUTABLE_SESSION_COLUMNS.map(column => column.name)],
    outputTypes: ["text", getTableName(fxSystemIdempotency), getTableName(fxSystemCommits), "timestamptz",
      ...FINITE_PUBLICATION_MUTABLE_SESSION_COLUMNS.map(column => column.getSQLType())], result: "record" },
  { name: "fx_advance_scope_publication_clock", signature: "uuid,bigint,bigint,timestamptz", ddl: SCOPE_PUBLICATION_CLOCK_FUNCTION_SQL,
    delimiter: "$publication_clock$", inputs: ["p_scope_uuid", "p_previous_commit_seq", "p_commit_seq", "p_publication_time"],
    outputs: ["reason", "last_commit_seq"], outputTypes: ["text", "bigint"], result: "record" },
  ...SCOPE_PUBLICATION_PREFIX_FUNCTIONS,
  { name: "fx_refuse_scope_publication_metadata", signature: "", ddl: SCOPE_PUBLICATION_GUARD_REFUSAL_FUNCTION_SQL,
    delimiter: "$publication_guard$", inputs: [], outputs: [], outputTypes: [], result: "boolean" },
] as const;

/** Exact installation proof for the fixed publication owners. */
export function finitePublicationInstallationSql(schemaName: SQL): SQL<boolean> {
  return sql<boolean>`(${sql.join(FINITE_PUBLICATION_FUNCTIONS.map(operation => {
    const body = operation.ddl.split(operation.delimiter)[1]!.replaceAll("%1$I.", '"__flarex_target__".');
    const typeOid = (type: string) => type.startsWith("fx_")
      ? sql`(pg_catalog.quote_ident(${schemaName}) || '.' || ${type})::pg_catalog.regtype::oid`
      : sql`${type}::pg_catalog.regtype::oid`;
    return sql`(select count(*) = 1 from pg_catalog.pg_proc p, bounds b
      where p.pronamespace = b.namespace_oid and p.proname = ${operation.name})
      and exists (select 1 from pg_catalog.pg_proc p, bounds b where
        p.oid = (pg_catalog.quote_ident(${schemaName}) || '.' || ${operation.name} || '(' || ${operation.signature} || ')')::pg_catalog.regprocedure
        and p.pronamespace = b.namespace_oid and p.proowner = b.owner_oid and p.pronargdefaults = 0
        and p.prokind = 'f' and not p.prosecdef and not p.proisstrict and not p.proleakproof
        and p.proparallel = 'u' and p.prosupport = 0 and p.provolatile = 'v'
        and p.proretset = ${operation.result === "record"}
        and p.prorettype = ${operation.result}::pg_catalog.regtype
        and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
        and ${operation.inputs.length + operation.outputs.length === 0 ? sql`p.proargnames is null`
          : sql`p.proargnames = array[${sql.join([...operation.inputs, ...operation.outputs].map(name => sql`${name}`), sql`,`)}]::text[]`}
        and ${operation.signature.length === 0 ? sql`p.proargtypes = ''::oidvector`
          : sql`p.proargtypes = array[${sql.join(operation.signature.split(",").map(typeOid), sql`,`)}]::oidvector`}
        and ${operation.result === "record" ? sql`p.proallargtypes = array[${sql.join([...operation.signature.split(","), ...operation.outputTypes].map(typeOid), sql`,`)}]::oid[]
          and p.proargmodes = array[${sql.join([...operation.inputs.map(() => sql`'i'`), ...operation.outputs.map(() => sql`'t'`)], sql`,`)}]::"char"[]`
          : sql`p.proallargtypes is null and p.proargmodes is null`}
        and p.proconfig = array['search_path=pg_catalog, pg_temp']
        and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
        and pg_catalog.replace(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'),
          pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".') = ${body})`;
  }), sql` and `)})`;
}

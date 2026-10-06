import { getTableName, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { fxSystemScopeClocks } from "../schema";

const clocks = sql`${sql.raw("%1$I")}.${sql.identifier(getTableName(fxSystemScopeClocks))}`;
const scopeColumn = sql.identifier(fxSystemScopeClocks.scopeUuid.name);
const sequenceColumn = sql.identifier(fxSystemScopeClocks.lastCommitSeq.name);
const updatedColumn = sql.identifier(fxSystemScopeClocks.updatedAt.name);

/** The actual fenced clock operation precedes any protected metadata guard.
 * A current stored-row comparison follows the UPDATE, including AFTER triggers;
 * an UPDATE RETURNING tuple alone is not the complete stored-row witness. */
export const SCOPE_PUBLICATION_CLOCK_FUNCTION_SQL = new PgDialect().sqlToQuery(sql`
CREATE FUNCTION %1$I.fx_advance_scope_publication_clock(
  p_scope_uuid uuid, p_previous_commit_seq bigint, p_commit_seq bigint,
  p_publication_time timestamptz)
RETURNS TABLE(reason text, last_commit_seq bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $publication_clock$
DECLARE
  expected_clock ${clocks};
  actual_clock ${clocks};
BEGIN
  SELECT c.* INTO expected_clock FROM ${clocks} c
    WHERE c.${scopeColumn} = p_scope_uuid
      AND c.${sequenceColumn} = p_previous_commit_seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scope publication clock changed' USING ERRCODE = 'FX001', DETAIL = 'publicationClockChanged';
  END IF;
  expected_clock.${sequenceColumn} := p_commit_seq;
  expected_clock.${updatedColumn} := p_publication_time;
  UPDATE ${clocks} actual SET ${sequenceColumn} = p_commit_seq, ${updatedColumn} = p_publication_time
    WHERE actual.${scopeColumn} = p_scope_uuid AND actual.${sequenceColumn} = p_previous_commit_seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scope publication clock changed' USING ERRCODE = 'FX001', DETAIL = 'publicationClockChanged';
  END IF;
  SELECT c.* INTO actual_clock FROM ${clocks} c WHERE c.${scopeColumn} = p_scope_uuid;
  IF NOT FOUND OR actual_clock IS DISTINCT FROM expected_clock THEN
    RAISE EXCEPTION 'Scope publication clock stored row changed' USING ERRCODE = 'FX001', DETAIL = 'publicationClockStoredCorruption';
  END IF;
  RETURN QUERY SELECT 'accepted'::text, actual_clock.${sequenceColumn};
END
$publication_clock$;
`).sql;

/** A negative genuine final guard poisons the owning SQL transaction after its
 * clock advance. It accepts no caller-authored acceptance argument. */
export const SCOPE_PUBLICATION_GUARD_REFUSAL_FUNCTION_SQL = new PgDialect().sqlToQuery(sql`
CREATE FUNCTION %1$I.fx_refuse_scope_publication_metadata() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_guard$
BEGIN
  RAISE EXCEPTION 'Scope publication metadata changed' USING ERRCODE = 'FX001', DETAIL = 'publicationMetadataChanged';
END;
$publication_guard$;
`).sql;

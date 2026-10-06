import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { fxSystemCommits, fxSystemCommitAppRowChanges, fxSystemCommitRelationAdjacencyChanges,
  fxSystemIdempotency, fxSystemCommitWakes, fxSystemTransactionSessions } from "../schema";
import { fxSystemCommitRelationalChanges } from "./relationalFactsSchema";
import { fxSystemCommitEvents, fxSystemCommitEventDeliveries } from "../commitEvents/schema";

const owned = (table: PgTable) => sql`${sql.raw("%1$I")}.${sql.identifier(getTableName(table))}`;
const compile = (statement: SQL) => new PgDialect().sqlToQuery(statement).sql;
const field = (name: string) => sql.identifier(name);
const refuse = sql`RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption';`;

// These are the fixed publication families, not a caller-selected operation
// vocabulary. Every generated primitive has one named table and tuple contract.
const families = [
  { name: "header", table: fxSystemCommits, functionName: "fx_write_scope_publication_header", maximum: 1,
    keys: [fxSystemCommits.scopeUuid, fxSystemCommits.commitSeq] },
  { name: "rows", table: fxSystemCommitAppRowChanges, functionName: "fx_write_scope_publication_rows", maximum: 500,
    keys: [fxSystemCommitAppRowChanges.scopeUuid, fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal] },
  { name: "relations", table: fxSystemCommitRelationAdjacencyChanges, functionName: "fx_write_scope_publication_relations", maximum: 500,
    keys: [fxSystemCommitRelationAdjacencyChanges.scopeUuid, fxSystemCommitRelationAdjacencyChanges.commitSeq, fxSystemCommitRelationAdjacencyChanges.changeOrdinal] },
  { name: "relational", table: fxSystemCommitRelationalChanges, functionName: "fx_write_scope_publication_relational", maximum: 500,
    keys: [fxSystemCommitRelationalChanges.scopeUuid, fxSystemCommitRelationalChanges.commitSeq, fxSystemCommitRelationalChanges.changeOrdinal] },
  { name: "events", table: fxSystemCommitEvents, functionName: "fx_write_scope_publication_events", maximum: 64,
    keys: [fxSystemCommitEvents.scopeUuid, fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal] },
  { name: "deliveries", table: fxSystemCommitEventDeliveries, functionName: "fx_write_scope_publication_deliveries", maximum: 512,
    keys: [fxSystemCommitEventDeliveries.scopeUuid, fxSystemCommitEventDeliveries.commitSeq,
      fxSystemCommitEventDeliveries.eventOrdinal, fxSystemCommitEventDeliveries.subscriberId] },
  { name: "outcome", table: fxSystemIdempotency, functionName: "fx_write_scope_publication_outcome", maximum: 1,
    keys: [fxSystemIdempotency.scopeUuid, fxSystemIdempotency.requestKey] },
  { name: "wake", table: fxSystemCommitWakes, functionName: "fx_write_scope_publication_wake", maximum: 1,
    keys: [fxSystemCommitWakes.scopeUuid, fxSystemCommitWakes.commitSeq] },
] as const;

const familyFunctions = families.map(family => {
  const columns = Object.values(getTableColumns(family.table));
  const table = owned(family.table);
  const keys = sql.join(family.keys.map(column => sql`actual.${field(column.name)} IS NOT DISTINCT FROM expected.${field(column.name)}`), sql` AND `);
  const completePage = family.name === "rows";
  return { name: family.functionName, signature: completePage ? "jsonb,jsonb" : "jsonb", inputs: completePage ? ["p_rows", "p_verify"] : ["p_rows"], outputs: [], outputTypes: [], result: "integer",
    delimiter: "$publication_family$", ddl: compile(sql`
CREATE FUNCTION %1$I.${field(family.functionName)}(p_rows jsonb${completePage ? sql`, p_verify jsonb` : sql``}) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows ${table}[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > ${sql.raw(String(family.maximum))} THEN ${refuse} END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::${table}[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::${table}, p_rows) expected;
  WITH written AS (
    INSERT INTO ${table} (${sql.join(columns.map(column => field(column.name)), sql`, `)})
      SELECT ${sql.join(columns.map(column => sql`expected.${field(column.name)}`), sql`, `)} FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::${table} IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN ${refuse} END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN ${table} actual ON ${keys}
    WHERE actual IS DISTINCT FROM expected) THEN ${refuse} END IF;
  ${completePage ? sql`
    IF jsonb_typeof(p_verify) IS DISTINCT FROM 'array' OR jsonb_array_length(p_verify) > 16000 THEN ${refuse} END IF;
    IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::${table}, p_verify) expected
      LEFT JOIN ${table} actual ON ${keys} WHERE actual IS DISTINCT FROM expected) THEN ${refuse} END IF;
  ` : sql``}
  RETURN written_count;
END;
$publication_family$;
`) };
});

const session = owned(fxSystemTransactionSessions);
const sessionTransition = sql`
  expected_session.${field(fxSystemTransactionSessions.lifecycle.name)} := 'committed';
  expected_session.${field(fxSystemTransactionSessions.updatedAt.name)} := publication_time;
  expected_session.${field(fxSystemTransactionSessions.validatedArgsJson.name)} := NULL;
  expected_session.${field(fxSystemTransactionSessions.validatedArgsCanonicalBytes.name)} := NULL;
  expected_session.${field(fxSystemTransactionSessions.authorizationGrantJson.name)} := NULL;
  expected_session.${field(fxSystemTransactionSessions.authorizationGrantCanonicalBytes.name)} := NULL;
  expected_session.${field(fxSystemTransactionSessions.applicationExecutionAuthorityJson.name)} := NULL;
  expected_session.${field(fxSystemTransactionSessions.applicationExecutionAuthorityCanonicalBytes.name)} := NULL;
`;
const sessionFunction = { name: "fx_finish_scope_publication_session", signature: "jsonb,timestamptz", inputs: ["p_session", "publication_time"],
  outputs: [], outputTypes: [], result: "boolean", delimiter: "$publication_session$", ddl: compile(sql`
CREATE FUNCTION %1$I.fx_finish_scope_publication_session(p_session jsonb, publication_time timestamptz) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_session$
DECLARE expected_session ${session}; actual_session ${session};
BEGIN
  IF p_session IS NULL THEN RETURN true; END IF;
  SELECT * INTO expected_session FROM jsonb_populate_record(NULL::${session}, p_session);
  SELECT actual.* INTO actual_session FROM ${session} actual
    WHERE actual.${field(fxSystemTransactionSessions.scopeUuid.name)} = expected_session.${field(fxSystemTransactionSessions.scopeUuid.name)}
      AND actual.${field(fxSystemTransactionSessions.sessionId.name)} = expected_session.${field(fxSystemTransactionSessions.sessionId.name)};
  IF NOT FOUND OR actual_session.${field(fxSystemTransactionSessions.lifecycle.name)} <> 'running'
    OR actual_session.${field(fxSystemTransactionSessions.attemptFence.name)} IS DISTINCT FROM expected_session.${field(fxSystemTransactionSessions.attemptFence.name)}
    OR actual_session.${field(fxSystemTransactionSessions.finiteClaimOwner.name)} IS DISTINCT FROM expected_session.${field(fxSystemTransactionSessions.finiteClaimOwner.name)}
    OR actual_session.${field(fxSystemTransactionSessions.finiteClaimFence.name)} IS DISTINCT FROM expected_session.${field(fxSystemTransactionSessions.finiteClaimFence.name)} THEN
    RAISE EXCEPTION 'Scope publication session changed' USING ERRCODE = 'FX001', DETAIL = 'publicationSessionChanged';
  END IF;
  IF actual_session IS DISTINCT FROM expected_session THEN ${refuse} END IF;
  ${sessionTransition}
  UPDATE ${session} actual SET
    ${sql.join([fxSystemTransactionSessions.lifecycle, fxSystemTransactionSessions.updatedAt,
      fxSystemTransactionSessions.validatedArgsJson, fxSystemTransactionSessions.validatedArgsCanonicalBytes,
      fxSystemTransactionSessions.authorizationGrantJson, fxSystemTransactionSessions.authorizationGrantCanonicalBytes,
      fxSystemTransactionSessions.applicationExecutionAuthorityJson, fxSystemTransactionSessions.applicationExecutionAuthorityCanonicalBytes]
      .map(column => sql`${field(column.name)} = expected_session.${field(column.name)}`), sql`, `)}
    WHERE actual.${field(fxSystemTransactionSessions.scopeUuid.name)} = expected_session.${field(fxSystemTransactionSessions.scopeUuid.name)}
      AND actual.${field(fxSystemTransactionSessions.sessionId.name)} = expected_session.${field(fxSystemTransactionSessions.sessionId.name)}
    RETURNING actual.* INTO actual_session;
  IF NOT FOUND OR actual_session IS DISTINCT FROM expected_session THEN ${refuse} END IF;
  SELECT actual.* INTO actual_session FROM ${session} actual
    WHERE actual.${field(fxSystemTransactionSessions.scopeUuid.name)} = expected_session.${field(fxSystemTransactionSessions.scopeUuid.name)}
      AND actual.${field(fxSystemTransactionSessions.sessionId.name)} = expected_session.${field(fxSystemTransactionSessions.sessionId.name)};
  IF NOT FOUND OR actual_session IS DISTINCT FROM expected_session THEN ${refuse} END IF;
  RETURN true;
END;
$publication_session$;
`) };

const proofFunction = { name: "fx_prove_scope_publication_prefix", signature: "jsonb", inputs: ["p_expected"], outputs: [], outputTypes: [],
  result: "boolean", delimiter: "$publication_proof$", ddl: compile(sql`
CREATE FUNCTION %1$I.fx_prove_scope_publication_prefix(p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_proof$
DECLARE header ${owned(fxSystemCommits)}; expected_session ${session}; actual_session ${session}; publication_time timestamptz;
BEGIN
  IF jsonb_typeof(p_expected->'header') IS DISTINCT FROM 'array' OR jsonb_array_length(p_expected->'header') <> 1 THEN ${refuse} END IF;
  SELECT * INTO header FROM jsonb_populate_record(NULL::${owned(fxSystemCommits)}, p_expected->'header'->0);
  ${sql.join(families.map(family => {
    const table = owned(family.table);
    const matches = sql.join(family.keys.map(column => sql`actual.${field(column.name)} IS NOT DISTINCT FROM expected.${field(column.name)}`), sql` AND `);
    return sql`
    IF p_expected ? ${sql.raw(`'${family.name}'`)} THEN
      IF (SELECT count(*) FROM ${table} actual WHERE actual.${field(family.table.scopeUuid.name)} = header.${field(fxSystemCommits.scopeUuid.name)}
        AND actual.${field(family.table.commitSeq.name)} = header.${field(fxSystemCommits.commitSeq.name)}) <> jsonb_array_length(p_expected->${sql.raw(`'${family.name}'`)})
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::${table}, p_expected->${sql.raw(`'${family.name}'`)}) expected
          LEFT JOIN ${table} actual ON ${matches} WHERE actual IS DISTINCT FROM expected) THEN ${refuse} END IF;
    END IF;`;
  }), sql`\n`)}
  IF p_expected->'session' IS NOT NULL AND p_expected->'session' <> 'null'::jsonb THEN
    SELECT * INTO expected_session FROM jsonb_populate_record(NULL::${session}, p_expected->'session');
    publication_time := header.${field(fxSystemCommits.committedAt.name)};
    ${sessionTransition}
    SELECT actual.* INTO actual_session FROM ${session} actual
      WHERE actual.${field(fxSystemTransactionSessions.scopeUuid.name)} = expected_session.${field(fxSystemTransactionSessions.scopeUuid.name)}
        AND actual.${field(fxSystemTransactionSessions.sessionId.name)} = expected_session.${field(fxSystemTransactionSessions.sessionId.name)};
    IF NOT FOUND OR actual_session IS DISTINCT FROM expected_session THEN ${refuse} END IF;
  END IF;
  RETURN true;
END;
$publication_proof$;
`) };

const completeFunction = { name: "fx_write_scope_publication_prefix", signature: "jsonb", inputs: ["p_expected"], outputs: [], outputTypes: [],
  result: "boolean", delimiter: "$publication_complete$", ddl: compile(sql`
CREATE FUNCTION %1$I.fx_write_scope_publication_prefix(p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_complete$
DECLARE batch jsonb; publication_time timestamptz;
BEGIN
  ${sql.join(families.slice(0, 2).map(family => sql`
    IF jsonb_typeof(p_expected->${sql.raw(`'${family.name}'`)}) IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->${sql.raw(`'${family.name}'`)}) > ${sql.raw(String(family.name === "events" ? 2048 : family.name === "deliveries" ? 16384 : family.name === "header" || family.name === "outcome" || family.name === "wake" ? 1 : 16000))}
      ${family.maximum === 1 ? sql`OR jsonb_array_length(p_expected->${sql.raw(`'${family.name}'`)}) <> 1` : sql``} THEN ${refuse} END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->${sql.raw(`'${family.name}'`)}) WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / ${sql.raw(String(family.maximum))} ORDER BY (member.ordinality - 1) / ${sql.raw(String(family.maximum))}
    LOOP PERFORM %1$I.${field(family.functionName)}(batch${family.name === "rows" ? sql`, '[]'::jsonb` : sql``}); END LOOP;
  `), sql`\n`)}
  RETURN %1$I.fx_finish_scope_publication_prefix(p_expected);
END;
$publication_complete$;
`) };

const terminalFunction = { name: "fx_finish_scope_publication_prefix", signature: "jsonb", inputs: ["p_expected"], outputs: [], outputTypes: [],
  result: "boolean", delimiter: "$publication_terminal$", ddl: compile(sql`
CREATE FUNCTION %1$I.fx_finish_scope_publication_prefix(p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_terminal$
DECLARE batch jsonb; publication_time timestamptz;
BEGIN
  ${sql.join(families.slice(2).map(family => sql`
    IF jsonb_typeof(p_expected->${sql.raw(`'${family.name}'`)}) IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->${sql.raw(`'${family.name}'`)}) > ${sql.raw(String(family.name === "events" ? 2048 : family.name === "deliveries" ? 16384 : family.maximum === 1 ? 1 : 16000))}
      ${family.maximum === 1 ? sql`OR jsonb_array_length(p_expected->${sql.raw(`'${family.name}'`)}) <> 1` : sql``} THEN ${refuse} END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->${sql.raw(`'${family.name}'`)}) WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / ${sql.raw(String(family.maximum))} ORDER BY (member.ordinality - 1) / ${sql.raw(String(family.maximum))}
    LOOP PERFORM %1$I.${field(family.functionName)}(batch); END LOOP;
  `), sql`\n`)}
  publication_time := (p_expected->'header'->0->>${sql.raw(`'${fxSystemCommits.committedAt.name}'`)})::timestamptz;
  PERFORM %1$I.fx_finish_scope_publication_session(nullif(p_expected->'session', 'null'::jsonb), publication_time);
  RETURN %1$I.fx_prove_scope_publication_prefix(p_expected);
END;
$publication_terminal$;
`) };

const updateHeaderFunction = { name: "fx_set_scope_publication_header_counts", signature: "jsonb", inputs: ["p_header"], outputs: [], outputTypes: [],
  result: "integer", delimiter: "$publication_counts$", ddl: compile(sql`
CREATE FUNCTION %1$I.fx_set_scope_publication_header_counts(p_header jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_counts$
DECLARE expected ${owned(fxSystemCommits)}; previous ${owned(fxSystemCommits)}; actual ${owned(fxSystemCommits)};
BEGIN
  SELECT * INTO expected FROM jsonb_populate_record(NULL::${owned(fxSystemCommits)}, p_header->0);
  SELECT stored.* INTO actual FROM ${owned(fxSystemCommits)} stored
    WHERE stored.${field(fxSystemCommits.scopeUuid.name)} = expected.${field(fxSystemCommits.scopeUuid.name)}
      AND stored.${field(fxSystemCommits.commitSeq.name)} = expected.${field(fxSystemCommits.commitSeq.name)};
  IF NOT FOUND THEN ${refuse} END IF;
  previous := actual;
  previous.${field(fxSystemCommits.changeCount.name)} := expected.${field(fxSystemCommits.changeCount.name)};
  previous.${field(fxSystemCommits.relationAdjacencyChangeCount.name)} := expected.${field(fxSystemCommits.relationAdjacencyChangeCount.name)};
  IF previous IS DISTINCT FROM expected THEN ${refuse} END IF;
  UPDATE ${owned(fxSystemCommits)} SET ${field(fxSystemCommits.changeCount.name)} = expected.${field(fxSystemCommits.changeCount.name)},
    ${field(fxSystemCommits.relationAdjacencyChangeCount.name)} = expected.${field(fxSystemCommits.relationAdjacencyChangeCount.name)}
    WHERE ${field(fxSystemCommits.scopeUuid.name)} = expected.${field(fxSystemCommits.scopeUuid.name)}
      AND ${field(fxSystemCommits.commitSeq.name)} = expected.${field(fxSystemCommits.commitSeq.name)} RETURNING * INTO actual;
  IF NOT FOUND OR actual IS DISTINCT FROM expected THEN ${refuse} END IF;
  SELECT stored.* INTO actual FROM ${owned(fxSystemCommits)} stored
    WHERE stored.${field(fxSystemCommits.scopeUuid.name)} = expected.${field(fxSystemCommits.scopeUuid.name)}
      AND stored.${field(fxSystemCommits.commitSeq.name)} = expected.${field(fxSystemCommits.commitSeq.name)};
  IF NOT FOUND OR actual IS DISTINCT FROM expected THEN ${refuse} END IF;
  RETURN 1;
END;
$publication_counts$;
`) };

export const SCOPE_PUBLICATION_PREFIX_FUNCTIONS = [...familyFunctions, sessionFunction, proofFunction, terminalFunction, completeFunction, updateHeaderFunction];

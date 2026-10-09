import { MAX_CATALOG_TABLE_ID, MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID } from "flarex-protocol/catalog";
import { MAX_ORDERED_INDEX_KEY_BYTES_V1 } from "flarex-protocol/ordered-index";
import { APP_UNIQUE_KEY_CODEC_VERSION_V1 } from "flarex-protocol/app-unique-constraint-definition";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable, type PgColumn } from "drizzle-orm/pg-core";
import { fxAppRowRevisions, fxAppRowCurrent, fxAppIndexEntryRevisions, fxAppIndexEntryCurrent,
  fxAppUniqueKeys, fxAppSearchEntryCurrent, fxAppJsonEntryCurrent, fxSystemSearchBuildStates, fxSystemIndexBuildStates,
  fxSystemUniqueConstraintBuilds } from "../schema";
import { fxSystemApplicationActiveHeads, fxSystemApplicationActivations } from "../applicationActivationSchema";
import { fxSystemApplicationRevisionSchemas } from "../applicationRelationSchema";
import { fxSystemApplicationRevisionSchemasV1 } from "../schema";
import { APP_PUBLICATION_ACCEPTANCE_FUNCTION, APP_PUBLICATION_APPLICATION_FUNCTION } from "./publicationStagesInstallation";

const namespace = sql.raw("%1$I");
const table = (target: PgTable) => sql`${namespace}.${sql.identifier(getTableName(target))}`;
const field = (name: string) => sql.identifier(name);
const compile = (statement: SQL) => new PgDialect().sqlToQuery(statement).sql;
/** Expected refusals poison the real borrowed transaction, including writes
 * from earlier pages. Driver boundaries decode only this exact private error. */
function compileApplication(statement: SQL, operation: string): string {
  const detail = operation === "fx_apply_app_row_batch"
    ? "jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time)"
    : operation === "fx_apply_app_index_batch"
      ? "jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text)"
      : operation === "fx_apply_app_unique_batch"
        ? "jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec)"
        : operation === "fx_advance_app_coverage" ? "jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal)"
          : "jsonb_build_object('reason', reason)";
  return compile(statement).replaceAll("RETURN NEXT; RETURN;", `RAISE EXCEPTION '${operation}' USING ERRCODE = 'FX001', DETAIL = (${detail})::text;`);
}
const row = table(fxAppRowRevisions);
const current = table(fxAppRowCurrent);
const index = table(fxAppIndexEntryRevisions);
const membership = table(fxAppIndexEntryCurrent);
const unique = table(fxAppUniqueKeys);
const rowColumns = Object.values(getTableColumns(fxAppRowRevisions));
const indexColumns = Object.values(getTableColumns(fxAppIndexEntryRevisions));
const uniqueColumns = Object.values(getTableColumns(fxAppUniqueKeys));
const uniqueOwnerColumns = [fxAppUniqueKeys.scopeUuid, fxAppUniqueKeys.constraintId,
  fxAppUniqueKeys.localeKey, fxAppUniqueKeys.tableId, fxAppUniqueKeys.rowId];
const search = table(fxAppSearchEntryCurrent);
const json = table(fxAppJsonEntryCurrent);
const searchBuild = table(fxSystemSearchBuildStates);
const searchColumns = Object.values(getTableColumns(fxAppSearchEntryCurrent));
const jsonColumns = Object.values(getTableColumns(fxAppJsonEntryCurrent));
const appHead = table(fxSystemApplicationActiveHeads);
const indexBuild = table(fxSystemIndexBuildStates);
const uniqueBuild = table(fxSystemUniqueConstraintBuilds);
const indexCoverageColumns = [fxSystemIndexBuildStates.scopeId, fxSystemIndexBuildStates.indexDefinitionId,
  fxSystemIndexBuildStates.attemptFence, fxSystemIndexBuildStates.epoch, fxSystemIndexBuildStates.storageGenerationFence];
const uniqueCoverageColumns = [fxSystemUniqueConstraintBuilds.scopeId, fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
  fxSystemUniqueConstraintBuilds.attemptFence, fxSystemUniqueConstraintBuilds.epoch, fxSystemUniqueConstraintBuilds.storageGenerationFence];
const sameFields = (left: string, right: string, columns: readonly PgColumn[]) => sql.join(columns.map(column =>
  sql`${sql.raw(left)}.${field(column.name)} IS NOT DISTINCT FROM ${sql.raw(right)}.${field(column.name)}`), sql` AND `);
const equalFields = (left: string, right: string, columns: readonly PgColumn[]) => sql.join(columns.map(column =>
  sql`${sql.raw(left)}.${field(column.name)} = ${sql.raw(right)}.${field(column.name)}`), sql` AND `);
const uniqueSlotColumns = [fxAppUniqueKeys.scopeUuid, fxAppUniqueKeys.constraintId, fxAppUniqueKeys.localeKey, fxAppUniqueKeys.canonicalKeySha256];
const uniqueAdmissionRefusal = sql`RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;`;
const indexTransitionRefusal = sql`RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text;`;

/** Key pairs are immutable obligations. Current membership selects the actual
 * transition, rather than returning heads for another JavaScript planner. */
export const APP_INDEX_TRANSITIONS_FUNCTION_SQL = compile(sql`
CREATE FUNCTION ${namespace}.fx_accept_app_index_transitions(p_scope text, p_scope_uuid uuid,
  p_indexes integer[], p_access text[], p_tables integer[], p_codecs integer[], p_specs bytea[], p_ids bytea[],
  p_previous bytea[], p_previous_sha bytea[], p_final bytea[], p_final_sha bytea[], p_row_previous bigint[],
  p_attempts bigint[], p_epochs text[], p_fences bigint[], p_maximum integer)
RETURNS TABLE(reason text, pair_ordinal integer, key_ordinal integer, transition_kind text,
  prior_commit_seq bigint, prior_is_tombstone boolean, emitted_count integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $index_transitions$
DECLARE n integer := coalesce(array_length(p_indexes,1),0); i integer := 1; j integer; refusal text;
  b ${indexBuild}; latest ${index}; pointer_seq bigint; captured record; selected_key bytea; selected_sha bytea;
  previous_seq bigint[] := ARRAY[]::bigint[]; final_seq bigint[] := ARRAY[]::bigint[];
  previous_tomb boolean[] := ARRAY[]::boolean[]; final_tomb boolean[] := ARRAY[]::boolean[];
  lifecycles text[] := ARRAY[]::text[]; last_index integer; last_attempt bigint; last_epoch text; last_fence bigint;
BEGIN
  emitted_count := 0;
  IF p_scope IS NULL OR p_scope_uuid IS NULL OR p_maximum IS NULL OR p_maximum < 0 OR p_maximum > 4096 OR
    coalesce(array_length(p_access,1),0) <> n OR coalesce(array_length(p_tables,1),0) <> n OR coalesce(array_length(p_codecs,1),0) <> n OR
    coalesce(array_length(p_specs,1),0) <> n OR coalesce(array_length(p_ids,1),0) <> n OR
    coalesce(array_length(p_previous,1),0) <> n OR coalesce(array_length(p_previous_sha,1),0) <> n OR
    coalesce(array_length(p_final,1),0) <> n OR coalesce(array_length(p_final_sha,1),0) <> n OR
    coalesce(array_length(p_row_previous,1),0) <> n OR coalesce(array_length(p_attempts,1),0) <> n OR
    coalesce(array_length(p_epochs,1),0) <> n OR coalesce(array_length(p_fences,1),0) <> n THEN
    refusal := 'invalidBatch'; ${indexTransitionRefusal}
  END IF;
  IF n > 0 THEN FOR i IN 1..n LOOP
    IF p_access[i] IS NULL OR p_access[i] NOT IN ('developer','by_creation_time') OR p_indexes[i] IS NULL OR p_indexes[i] <= 0 OR p_tables[i] IS NULL OR p_tables[i] <= 0 OR
      p_codecs[i] IS DISTINCT FROM 1 OR octet_length(p_specs[i]) IS DISTINCT FROM 32 OR
      octet_length(p_ids[i]) IS DISTINCT FROM 16 OR p_attempts[i] IS NULL OR p_epochs[i] IS NULL OR p_fences[i] IS NULL OR
      (p_row_previous[i] IS NOT NULL AND p_row_previous[i] <= 0) THEN refusal := 'invalidBatch'; ${indexTransitionRefusal} END IF;
    IF i = 1 OR last_index IS DISTINCT FROM p_indexes[i] OR last_attempt IS DISTINCT FROM p_attempts[i] OR
      last_epoch IS DISTINCT FROM p_epochs[i] OR last_fence IS DISTINCT FROM p_fences[i] THEN
    SELECT x.* INTO b FROM ${indexBuild} x WHERE x.${field(fxSystemIndexBuildStates.scopeId.name)} = p_scope
      AND x.${field(fxSystemIndexBuildStates.indexDefinitionId.name)} = p_indexes[i];
    IF NOT FOUND OR b.${field(fxSystemIndexBuildStates.attemptFence.name)} IS DISTINCT FROM p_attempts[i] OR
      b.${field(fxSystemIndexBuildStates.epoch.name)} IS DISTINCT FROM p_epochs[i] OR
      b.${field(fxSystemIndexBuildStates.storageGenerationFence.name)} IS DISTINCT FROM p_fences[i] OR
      b.${field(fxSystemIndexBuildStates.lifecycle.name)} IS NULL OR
      b.${field(fxSystemIndexBuildStates.lifecycle.name)} NOT IN ('declared','building','backfilling','validating','enabled')
      THEN refusal := 'buildInvalid'; ${indexTransitionRefusal} END IF;
      last_index := p_indexes[i]; last_attempt := p_attempts[i]; last_epoch := p_epochs[i]; last_fence := p_fences[i];
    END IF;
    lifecycles[i] := b.${field(fxSystemIndexBuildStates.lifecycle.name)};
    FOR j IN 0..1 LOOP
      selected_key := CASE WHEN j = 0 THEN p_previous[i] ELSE p_final[i] END;
      selected_sha := CASE WHEN j = 0 THEN p_previous_sha[i] ELSE p_final_sha[i] END;
      IF j = 1 AND p_previous[i] IS NOT NULL AND p_previous[i] IS NOT DISTINCT FROM p_final[i] THEN
        IF p_previous_sha[i] IS DISTINCT FROM p_final_sha[i] THEN refusal := 'invalidBatch'; ${indexTransitionRefusal} END IF;
        final_seq[i] := previous_seq[i]; final_tomb[i] := previous_tomb[i]; CONTINUE;
      END IF;
      pointer_seq := NULL; latest := NULL;
      IF selected_key IS NULL THEN
        IF selected_sha IS NOT NULL THEN refusal := 'invalidBatch'; ${indexTransitionRefusal} END IF;
      ELSE
        IF octet_length(selected_key) < 1 OR octet_length(selected_key) > ${sql.raw(String(MAX_ORDERED_INDEX_KEY_BYTES_V1))} OR
          octet_length(selected_sha) IS DISTINCT FROM 32 OR pg_catalog.sha256(selected_key) IS DISTINCT FROM selected_sha
          THEN refusal := 'invalidBatch'; ${indexTransitionRefusal} END IF;
        SELECT c.${field(fxAppIndexEntryCurrent.commitSeq.name)} AS pointer_seq, r AS latest_row INTO captured
          FROM (VALUES (1)) request(dummy)
          LEFT JOIN ${membership} c ON c.${field(fxAppIndexEntryCurrent.scopeUuid.name)} = p_scope_uuid
            AND c.${field(fxAppIndexEntryCurrent.indexDefinitionId.name)} = p_indexes[i]
            AND c.${field(fxAppIndexEntryCurrent.encodedKey.name)} = selected_key AND c.${field(fxAppIndexEntryCurrent.rowId.name)} = p_ids[i]
          LEFT JOIN LATERAL (SELECT rev.* FROM ${index} rev WHERE rev.${field(fxAppIndexEntryRevisions.scopeUuid.name)} = p_scope_uuid
            AND rev.${field(fxAppIndexEntryRevisions.indexDefinitionId.name)} = p_indexes[i]
            AND rev.${field(fxAppIndexEntryRevisions.encodedKey.name)} = selected_key AND rev.${field(fxAppIndexEntryRevisions.rowId.name)} = p_ids[i]
            ORDER BY rev.${field(fxAppIndexEntryRevisions.commitSeq.name)} DESC LIMIT 1) r ON true;
        pointer_seq := captured.pointer_seq; latest := captured.latest_row;
        IF latest.${field(fxAppIndexEntryRevisions.commitSeq.name)} IS NULL THEN
          IF pointer_seq IS NOT NULL THEN refusal := 'storedCorruption'; ${indexTransitionRefusal} END IF;
        ELSIF latest.${field(fxAppIndexEntryRevisions.commitSeq.name)} <= 0 OR
          latest.${field(fxAppIndexEntryRevisions.tableId.name)} IS DISTINCT FROM p_tables[i] OR
          latest.${field(fxAppIndexEntryRevisions.keyCodecVersion.name)} IS DISTINCT FROM p_codecs[i] OR
          latest.${field(fxAppIndexEntryRevisions.physicalSpecSha256.name)} IS DISTINCT FROM p_specs[i] OR
          latest.${field(fxAppIndexEntryRevisions.keySha256.name)} IS DISTINCT FROM selected_sha OR
          latest.${field(fxAppIndexEntryRevisions.isTombstone.name)} IS NULL OR
          (latest.${field(fxAppIndexEntryRevisions.isTombstone.name)} AND pointer_seq IS NOT NULL) OR
          (NOT latest.${field(fxAppIndexEntryRevisions.isTombstone.name)} AND pointer_seq IS DISTINCT FROM latest.${field(fxAppIndexEntryRevisions.commitSeq.name)})
          THEN refusal := 'storedCorruption'; ${indexTransitionRefusal}
        END IF;
      END IF;
      IF j = 0 THEN previous_seq[i] := latest.${field(fxAppIndexEntryRevisions.commitSeq.name)};
        previous_tomb[i] := latest.${field(fxAppIndexEntryRevisions.isTombstone.name)};
      ELSE final_seq[i] := latest.${field(fxAppIndexEntryRevisions.commitSeq.name)};
        final_tomb[i] := latest.${field(fxAppIndexEntryRevisions.isTombstone.name)}; END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1..n LOOP
    pair_ordinal := i-1;
    IF p_previous[i] IS NOT NULL THEN
      IF (previous_seq[i] IS NOT NULL AND (previous_tomb[i] OR p_row_previous[i] IS NULL OR previous_seq[i] > p_row_previous[i])) OR
        (previous_seq[i] IS NULL AND lifecycles[i] = 'enabled')
        THEN refusal := 'transitionInvalid'; ${indexTransitionRefusal} END IF;
      IF p_previous[i] IS NOT DISTINCT FROM p_final[i] AND previous_seq[i] IS NULL THEN
        reason := 'transition'; key_ordinal := 0; transition_kind := 'live'; prior_commit_seq := NULL; prior_is_tombstone := NULL;
        emitted_count := emitted_count+1; RETURN NEXT;
      ELSIF p_previous[i] IS DISTINCT FROM p_final[i] AND previous_seq[i] IS NOT NULL THEN
        reason := 'transition'; key_ordinal := 0; transition_kind := 'tombstone'; prior_commit_seq := previous_seq[i]; prior_is_tombstone := previous_tomb[i];
        emitted_count := emitted_count+1; RETURN NEXT;
      END IF;
    END IF;
    IF p_final[i] IS NOT NULL AND p_previous[i] IS DISTINCT FROM p_final[i] THEN
      IF final_seq[i] IS NOT NULL AND (final_tomb[i] = false OR p_access[i] = 'by_creation_time') THEN refusal := 'transitionInvalid'; ${indexTransitionRefusal} END IF;
      reason := 'transition'; key_ordinal := 1; transition_kind := 'live'; prior_commit_seq := final_seq[i]; prior_is_tombstone := final_tomb[i];
      emitted_count := emitted_count+1; RETURN NEXT;
    END IF;
  END LOOP; END IF;
  IF emitted_count > p_maximum THEN i := greatest(n,1); refusal := 'limitExceeded'; ${indexTransitionRefusal} END IF;
  reason := 'accepted'; pair_ordinal := NULL; key_ordinal := NULL; transition_kind := NULL; prior_commit_seq := NULL; prior_is_tombstone := NULL; RETURN NEXT;
END;
$index_transitions$;`);

export const APPLICATION_DOMAIN_TYPES = [
  { name: "fx_app_row_write", columns: rowColumns, source: fxAppRowRevisions },
  { name: "fx_app_index_write", columns: indexColumns, source: fxAppIndexEntryRevisions },
  { name: "fx_app_unique_write", columns: uniqueColumns, source: fxAppUniqueKeys },
  { name: "fx_app_unique_owner", columns: uniqueOwnerColumns, source: fxAppUniqueKeys },
  { name: "fx_app_search_write", columns: searchColumns, source: fxAppSearchEntryCurrent },
  { name: "fx_app_json_write", columns: jsonColumns, source: fxAppJsonEntryCurrent },
  { name: "fx_app_index_coverage", columns: indexCoverageColumns, source: fxSystemIndexBuildStates },
  { name: "fx_app_unique_coverage", columns: uniqueCoverageColumns, source: fxSystemUniqueConstraintBuilds },
] as const;
export const APPLICATION_DOMAIN_TYPE_SQL = APPLICATION_DOMAIN_TYPES.map(({ name, columns }) => compile(sql`
CREATE TYPE ${namespace}.${field(name)} AS (
  ${sql.join(columns.map(column => sql`${field(column.name)} ${sql.raw(column.getSQLType())}`), sql`,\n  `)}
);`));

/** Early original-owner proof deliberately excludes destination and parent
 * admission. Those belong after the row/index writes in the existing mutator. */
export const APP_UNIQUE_OWNER_ACCEPTANCE_FUNCTION_SQL = compile(sql`
CREATE FUNCTION ${namespace}.fx_accept_app_unique_owners(p_owners ${namespace}.fx_app_unique_owner[], p_previous bytea[], p_row_previous bigint[])
RETURNS TABLE(reason text, owners integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $unique_owners$
DECLARE n integer := coalesce(array_length(p_owners,1),0); i integer := 1; expected ${namespace}.fx_app_unique_owner;
  stored ${unique}; count integer; observed ${unique}[] := ARRAY[]::${unique}[]; counts integer[] := ARRAY[]::integer[];
BEGIN
  IF coalesce(array_length(p_previous,1),0) <> n OR coalesce(array_length(p_row_previous,1),0) <> n THEN
    RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','invalidBatch','ordinal',0)::text;
  END IF;
  IF n > 0 THEN FOR i IN 1..n LOOP
    expected := p_owners[i]; count := 0;
    IF expected.${field(fxAppUniqueKeys.scopeUuid.name)} IS NULL OR expected.${field(fxAppUniqueKeys.constraintId.name)} IS NULL OR
      expected.${field(fxAppUniqueKeys.localeKey.name)} IS NULL OR expected.${field(fxAppUniqueKeys.tableId.name)} IS NULL OR
      octet_length(expected.${field(fxAppUniqueKeys.rowId.name)}) IS DISTINCT FROM 16 THEN
      RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','invalidBatch','ordinal',i-1)::text;
    END IF;
    FOR stored IN SELECT u.* FROM ${unique} u WHERE u.${field(fxAppUniqueKeys.scopeUuid.name)} = expected.${field(fxAppUniqueKeys.scopeUuid.name)}
      AND u.${field(fxAppUniqueKeys.constraintId.name)} = expected.${field(fxAppUniqueKeys.constraintId.name)}
      AND u.${field(fxAppUniqueKeys.tableId.name)} = expected.${field(fxAppUniqueKeys.tableId.name)}
      AND u.${field(fxAppUniqueKeys.rowId.name)} = expected.${field(fxAppUniqueKeys.rowId.name)} LOOP
      count := count+1;
      IF count > 1 OR stored.${field(fxAppUniqueKeys.scopeUuid.name)} IS NULL OR stored.${field(fxAppUniqueKeys.constraintId.name)} IS NULL OR
        stored.${field(fxAppUniqueKeys.localeKey.name)} IS NULL OR stored.${field(fxAppUniqueKeys.tableId.name)} IS NULL OR
        stored.${field(fxAppUniqueKeys.constraintId.name)} < 1 OR stored.${field(fxAppUniqueKeys.constraintId.name)} > ${sql.raw(String(MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID))} OR
        stored.${field(fxAppUniqueKeys.tableId.name)} < 1 OR stored.${field(fxAppUniqueKeys.tableId.name)} > ${sql.raw(String(MAX_CATALOG_TABLE_ID))} OR
        stored.${field(fxAppUniqueKeys.keyCodecVersion.name)} IS DISTINCT FROM ${sql.raw(String(APP_UNIQUE_KEY_CODEC_VERSION_V1))} OR
        stored.${field(fxAppUniqueKeys.encodedKey.name)} IS NULL OR octet_length(stored.${field(fxAppUniqueKeys.encodedKey.name)}) < 1 OR
        octet_length(stored.${field(fxAppUniqueKeys.encodedKey.name)}) > ${sql.raw(String(MAX_ORDERED_INDEX_KEY_BYTES_V1))} OR
        octet_length(stored.${field(fxAppUniqueKeys.canonicalKeySha256.name)}) IS DISTINCT FROM 32 OR
        octet_length(stored.${field(fxAppUniqueKeys.rowId.name)}) IS DISTINCT FROM 16 THEN
        RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text;
      END IF;
      IF pg_catalog.sha256(stored.${field(fxAppUniqueKeys.encodedKey.name)}) IS DISTINCT FROM stored.${field(fxAppUniqueKeys.canonicalKeySha256.name)} THEN
        RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text;
      END IF;
      observed[i] := stored;
    END LOOP;
    counts[i] := count;
  END LOOP;
  FOR i IN 1..n LOOP
    expected := p_owners[i]; stored := observed[i];
    IF counts[i] = 0 THEN
      IF p_previous[i] IS NOT NULL THEN
        RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','previousMismatch','ordinal',i-1)::text;
      END IF;
    ELSIF p_row_previous[i] IS NULL OR p_row_previous[i] <= 0 OR p_previous[i] IS NULL OR
      stored.${field(fxAppUniqueKeys.localeKey.name)} IS DISTINCT FROM expected.${field(fxAppUniqueKeys.localeKey.name)} OR
      stored.${field(fxAppUniqueKeys.encodedKey.name)} IS DISTINCT FROM p_previous[i] THEN
      RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','previousMismatch','ordinal',i-1)::text;
    END IF;
  END LOOP; END IF;
  reason := 'accepted'; owners := n; RETURN NEXT;
END;
$unique_owners$;`);

/** The first lowering time is real database time, sampled before any context
 * work. Only the first head is captured; later locks stay behind TS decoding. */
export const APP_MATERIALIZATION_BEGIN_FUNCTION_SQL = compile(sql`
CREATE FUNCTION ${namespace}.fx_begin_app_materialization(p_scope text, p_deadline timestamptz, p_snapshot boolean)
RETURNS TABLE(reason text, database_now timestamptz, application_head ${appHead},
  application_activation ${table(fxSystemApplicationActivations)}, legacy_schema ${table(fxSystemApplicationRevisionSchemasV1)},
  relation_schema ${table(fxSystemApplicationRevisionSchemas)})
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $materialization_begin$
DECLARE captured record;
BEGIN
  database_now := to_timestamp(trunc(extract(epoch from clock_timestamp()) * 1000) / 1000);
  IF p_deadline <= database_now THEN reason := 'expired'; RETURN NEXT; RETURN; END IF;
  IF p_snapshot THEN
    SELECT h AS head_row, a AS activation_row, l AS legacy_row, s AS relation_row INTO captured
      FROM ${appHead} h LEFT JOIN ${table(fxSystemApplicationActivations)} a
        ON a.${field(fxSystemApplicationActivations.scopeId.name)} = h.${field(fxSystemApplicationActiveHeads.scopeId.name)}
        AND a.${field(fxSystemApplicationActivations.activationSequence.name)} = h.${field(fxSystemApplicationActiveHeads.activationSequence.name)}
      LEFT JOIN ${table(fxSystemApplicationRevisionSchemasV1)} l
        ON l.${field(fxSystemApplicationRevisionSchemasV1.scopeId.name)} = h.${field(fxSystemApplicationActiveHeads.scopeId.name)}
        AND l.${field(fxSystemApplicationRevisionSchemasV1.revisionId.name)} = h.${field(fxSystemApplicationActiveHeads.revisionId.name)}
      LEFT JOIN ${table(fxSystemApplicationRevisionSchemas)} s
        ON s.${field(fxSystemApplicationRevisionSchemas.scopeId.name)} = h.${field(fxSystemApplicationActiveHeads.scopeId.name)}
        AND s.${field(fxSystemApplicationRevisionSchemas.revisionId.name)} = h.${field(fxSystemApplicationActiveHeads.revisionId.name)}
      WHERE h.${field(fxSystemApplicationActiveHeads.scopeId.name)} = p_scope;
    IF FOUND THEN application_head := captured.head_row; application_activation := captured.activation_row;
      legacy_schema := captured.legacy_row; relation_schema := captured.relation_row; END IF;
  ELSE
    SELECT h.* INTO application_head FROM ${appHead} h
      WHERE h.${field(fxSystemApplicationActiveHeads.scopeId.name)} = p_scope FOR SHARE;
  END IF;
  reason := 'accepted'; RETURN NEXT;
END;
$materialization_begin$;`);

/** Fixed domain data only. Predecessor proof precedes every row write; separate
 * procedural statements retain fresh visibility and include AFTER triggers. */
export const APP_ROW_BATCH_FUNCTION_SQL = compileApplication(sql`
CREATE FUNCTION ${namespace}.fx_apply_app_row_batch(p_rows ${namespace}.fx_app_row_write[], p_verify ${namespace}.fx_app_row_write[])
RETURNS TABLE(reason text, ordinal integer, actual_commit_seq bigint, actual_creation_time double precision)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $row_batch$
DECLARE i integer; n integer := coalesce(array_length(p_rows, 1), 0);
  expected_row ${row}; actual_row ${row}; pointer_seq bigint; predecessor_time double precision;
  inserted_seq bigint; phase text := 'write'; proof_rows ${namespace}.fx_app_row_write[]; verification record;
BEGIN
  IF n < 1 OR n > 32 OR n + coalesce(array_length(p_verify, 1), 0) > 512 THEN reason := 'invalidBatch'; ordinal := 0; RETURN NEXT; RETURN; END IF;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    IF (p_rows[i]).${field(fxAppRowRevisions.prevCommitSeq.name)} IS NOT NULL THEN
      SELECT r.${field(fxAppRowRevisions.creationTime.name)} INTO predecessor_time FROM ${row} r
        WHERE r.${field(fxAppRowRevisions.scopeUuid.name)} = (p_rows[i]).${field(fxAppRowRevisions.scopeUuid.name)} AND r.${field(fxAppRowRevisions.tableId.name)} = (p_rows[i]).${field(fxAppRowRevisions.tableId.name)}
          AND r.${field(fxAppRowRevisions.rowId.name)} = (p_rows[i]).${field(fxAppRowRevisions.rowId.name)} AND r.${field(fxAppRowRevisions.commitSeq.name)} = (p_rows[i]).${field(fxAppRowRevisions.prevCommitSeq.name)};
      IF NOT FOUND THEN
        SELECT c.${field(fxAppRowCurrent.commitSeq.name)} INTO actual_commit_seq FROM ${current} c
          WHERE c.${field(fxAppRowCurrent.scopeUuid.name)} = (p_rows[i]).${field(fxAppRowRevisions.scopeUuid.name)} AND c.${field(fxAppRowCurrent.tableId.name)} = (p_rows[i]).${field(fxAppRowRevisions.tableId.name)} AND c.${field(fxAppRowCurrent.rowId.name)} = (p_rows[i]).${field(fxAppRowRevisions.rowId.name)};
        reason := 'chainConflict'; RETURN NEXT; RETURN;
      END IF;
      IF predecessor_time IS DISTINCT FROM (p_rows[i]).${field(fxAppRowRevisions.creationTime.name)} THEN
        reason := 'creationTimeConflict'; actual_creation_time := predecessor_time; RETURN NEXT; RETURN;
      END IF;
    END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    ${sql.join(rowColumns.map(column => sql`expected_row.${field(column.name)} := (p_rows[i]).${field(column.name)};`), sql`\n    `)}
    INSERT INTO ${row} (${sql.join(rowColumns.map(column => field(column.name)), sql`, `)})
      VALUES (${sql.join(rowColumns.map(column => sql`expected_row.${field(column.name)}`), sql`, `)})
      ON CONFLICT DO NOTHING RETURNING * INTO actual_row;
    IF NOT FOUND THEN reason := 'revisionExists'; RETURN NEXT; RETURN; END IF;
    IF actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    IF (p_rows[i]).${field(fxAppRowRevisions.prevCommitSeq.name)} IS NULL THEN
      INSERT INTO ${current}(${field(fxAppRowCurrent.scopeUuid.name)}, ${field(fxAppRowCurrent.tableId.name)}, ${field(fxAppRowCurrent.rowId.name)}, ${field(fxAppRowCurrent.commitSeq.name)})
        VALUES ((p_rows[i]).${field(fxAppRowRevisions.scopeUuid.name)}, (p_rows[i]).${field(fxAppRowRevisions.tableId.name)}, (p_rows[i]).${field(fxAppRowRevisions.rowId.name)}, (p_rows[i]).${field(fxAppRowRevisions.commitSeq.name)})
        ON CONFLICT DO NOTHING RETURNING ${field(fxAppRowCurrent.commitSeq.name)} INTO inserted_seq;
    ELSE
      UPDATE ${current} c SET ${field(fxAppRowCurrent.commitSeq.name)} = (p_rows[i]).${field(fxAppRowRevisions.commitSeq.name)}
        WHERE c.${field(fxAppRowCurrent.scopeUuid.name)} = (p_rows[i]).${field(fxAppRowRevisions.scopeUuid.name)} AND c.${field(fxAppRowCurrent.tableId.name)} = (p_rows[i]).${field(fxAppRowRevisions.tableId.name)}
          AND c.${field(fxAppRowCurrent.rowId.name)} = (p_rows[i]).${field(fxAppRowRevisions.rowId.name)} AND c.${field(fxAppRowCurrent.commitSeq.name)} = (p_rows[i]).${field(fxAppRowRevisions.prevCommitSeq.name)}
        RETURNING c.${field(fxAppRowCurrent.commitSeq.name)} INTO inserted_seq;
    END IF;
    IF inserted_seq IS NULL THEN
      SELECT c.${field(fxAppRowCurrent.commitSeq.name)} INTO actual_commit_seq FROM ${current} c
        WHERE c.${field(fxAppRowCurrent.scopeUuid.name)} = (p_rows[i]).${field(fxAppRowRevisions.scopeUuid.name)} AND c.${field(fxAppRowCurrent.tableId.name)} = (p_rows[i]).${field(fxAppRowRevisions.tableId.name)} AND c.${field(fxAppRowCurrent.rowId.name)} = (p_rows[i]).${field(fxAppRowRevisions.rowId.name)};
      reason := 'chainConflict'; RETURN NEXT; RETURN;
    END IF;
  END LOOP;
  phase := 'verify'; proof_rows := coalesce(p_verify, ARRAY[]::${namespace}.fx_app_row_write[]) || p_rows;
  -- One fresh statement observes complete revisions and pointers after every
  -- sequential write barrier, including AFTER changes to earlier page inputs.
  FOR verification IN SELECT proof.ordinality AS proof_ordinal,
      r.${field(fxAppRowRevisions.commitSeq.name)} IS NOT NULL AND ${sameFields("r", "proof", rowColumns)} AS revision_matches,
      c.${field(fxAppRowCurrent.commitSeq.name)} AS pointer_seq, proof.${field(fxAppRowRevisions.commitSeq.name)} AS expected_seq
    FROM unnest(proof_rows) WITH ORDINALITY proof
    LEFT JOIN ${row} r ON ${equalFields("r", "proof", [fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq])}
    LEFT JOIN ${current} c ON c.${field(fxAppRowCurrent.scopeUuid.name)} = proof.${field(fxAppRowRevisions.scopeUuid.name)}
      AND c.${field(fxAppRowCurrent.tableId.name)} = proof.${field(fxAppRowRevisions.tableId.name)} AND c.${field(fxAppRowCurrent.rowId.name)} = proof.${field(fxAppRowRevisions.rowId.name)}
    ORDER BY proof.ordinality LOOP
    ordinal := verification.proof_ordinal - 1;
    IF NOT verification.revision_matches THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    IF verification.pointer_seq IS DISTINCT FROM verification.expected_seq THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  END LOOP;
  reason := 'accepted'; ordinal := n; actual_commit_seq := NULL; actual_creation_time := NULL; RETURN NEXT;
END;
$row_batch$;`, "fx_apply_app_row_batch");

export const APP_INDEX_BATCH_FUNCTION_SQL = compileApplication(sql`
CREATE FUNCTION ${namespace}.fx_apply_app_index_batch(p_rows ${namespace}.fx_app_index_write[], p_prior bigint[], p_historical boolean[], p_verify ${namespace}.fx_app_index_write[])
RETURNS TABLE(reason text, ordinal integer, actual_commit_seq bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $index_batch$
DECLARE i integer; n integer := coalesce(array_length(p_rows, 1), 0); expected_row ${index}; actual_row ${index};
  latest_row ${index}; parent_tombstone boolean; pointer_seq bigint; inserted_seq bigint; phase text := 'write'; proof_rows ${namespace}.fx_app_index_write[]; verification record;
BEGIN
  IF n < 1 OR n > 32 OR n + coalesce(array_length(p_verify, 1), 0) > 4096 OR array_length(p_prior, 1) IS DISTINCT FROM n OR array_length(p_historical, 1) IS DISTINCT FROM n THEN
    reason := 'invalidBatch'; ordinal := 0; RETURN NEXT; RETURN;
  END IF;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT r.* INTO latest_row FROM ${index} r WHERE r.${field(fxAppIndexEntryRevisions.scopeUuid.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.scopeUuid.name)}
      AND r.${field(fxAppIndexEntryRevisions.indexDefinitionId.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.indexDefinitionId.name)} AND r.${field(fxAppIndexEntryRevisions.encodedKey.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.encodedKey.name)}
      AND r.${field(fxAppIndexEntryRevisions.rowId.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.rowId.name)} ORDER BY r.${field(fxAppIndexEntryRevisions.commitSeq.name)} DESC LIMIT 1;
    actual_commit_seq := latest_row.${field(fxAppIndexEntryRevisions.commitSeq.name)};
    IF latest_row.${field(fxAppIndexEntryRevisions.commitSeq.name)} IS DISTINCT FROM p_prior[i] THEN reason := 'transitionConflict'; RETURN NEXT; RETURN; END IF;
    IF latest_row.${field(fxAppIndexEntryRevisions.commitSeq.name)} IS NOT NULL AND (latest_row.${field(fxAppIndexEntryRevisions.tableId.name)} IS DISTINCT FROM (p_rows[i]).${field(fxAppIndexEntryRevisions.tableId.name)}
      OR latest_row.${field(fxAppIndexEntryRevisions.keyCodecVersion.name)} IS DISTINCT FROM (p_rows[i]).${field(fxAppIndexEntryRevisions.keyCodecVersion.name)}
      OR latest_row.${field(fxAppIndexEntryRevisions.physicalSpecSha256.name)} IS DISTINCT FROM (p_rows[i]).${field(fxAppIndexEntryRevisions.physicalSpecSha256.name)}
      OR latest_row.${field(fxAppIndexEntryRevisions.keySha256.name)} IS DISTINCT FROM (p_rows[i]).${field(fxAppIndexEntryRevisions.keySha256.name)}) THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    SELECT c.${field(fxAppIndexEntryCurrent.commitSeq.name)} INTO pointer_seq FROM ${membership} c WHERE c.${field(fxAppIndexEntryCurrent.scopeUuid.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.scopeUuid.name)}
      AND c.${field(fxAppIndexEntryCurrent.indexDefinitionId.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.indexDefinitionId.name)} AND c.${field(fxAppIndexEntryCurrent.encodedKey.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.encodedKey.name)} AND c.${field(fxAppIndexEntryCurrent.rowId.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.rowId.name)};
    IF (latest_row.${field(fxAppIndexEntryRevisions.commitSeq.name)} IS NULL OR latest_row.${field(fxAppIndexEntryRevisions.isTombstone.name)}) THEN
      IF pointer_seq IS NOT NULL THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    ELSIF pointer_seq IS DISTINCT FROM latest_row.${field(fxAppIndexEntryRevisions.commitSeq.name)} THEN reason := 'storedCorruption'; RETURN NEXT; RETURN;
    END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT r.${field(fxAppRowRevisions.isTombstone.name)} INTO parent_tombstone FROM ${current} c JOIN ${row} r
      ON r.${field(fxAppRowRevisions.scopeUuid.name)} = c.${field(fxAppRowCurrent.scopeUuid.name)} AND r.${field(fxAppRowRevisions.tableId.name)} = c.${field(fxAppRowCurrent.tableId.name)} AND r.${field(fxAppRowRevisions.rowId.name)} = c.${field(fxAppRowCurrent.rowId.name)} AND r.${field(fxAppRowRevisions.commitSeq.name)} = c.${field(fxAppRowCurrent.commitSeq.name)}
      WHERE c.${field(fxAppRowCurrent.scopeUuid.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.scopeUuid.name)} AND c.${field(fxAppRowCurrent.tableId.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.tableId.name)} AND c.${field(fxAppRowCurrent.rowId.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.rowId.name)};
    IF NOT FOUND THEN reason := 'parentMissing'; RETURN NEXT; RETURN; END IF;
    IF NOT p_historical[i] AND NOT (p_rows[i]).${field(fxAppIndexEntryRevisions.isTombstone.name)} AND parent_tombstone THEN reason := 'parentTombstone'; RETURN NEXT; RETURN; END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    ${sql.join(indexColumns.map(column => sql`expected_row.${field(column.name)} := (p_rows[i]).${field(column.name)};`), sql`\n    `)}
    INSERT INTO ${index} (${sql.join(indexColumns.map(column => field(column.name)), sql`, `)})
      VALUES (${sql.join(indexColumns.map(column => sql`expected_row.${field(column.name)}`), sql`, `)})
      ON CONFLICT DO NOTHING RETURNING * INTO actual_row;
    IF NOT FOUND THEN reason := 'revisionExists'; RETURN NEXT; RETURN; END IF;
    IF actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    IF NOT (p_rows[i]).${field(fxAppIndexEntryRevisions.isTombstone.name)} THEN
      INSERT INTO ${membership}(${field(fxAppIndexEntryCurrent.scopeUuid.name)}, ${field(fxAppIndexEntryCurrent.indexDefinitionId.name)}, ${field(fxAppIndexEntryCurrent.encodedKey.name)}, ${field(fxAppIndexEntryCurrent.rowId.name)}, ${field(fxAppIndexEntryCurrent.commitSeq.name)})
        VALUES ((p_rows[i]).${field(fxAppIndexEntryRevisions.scopeUuid.name)}, (p_rows[i]).${field(fxAppIndexEntryRevisions.indexDefinitionId.name)}, (p_rows[i]).${field(fxAppIndexEntryRevisions.encodedKey.name)}, (p_rows[i]).${field(fxAppIndexEntryRevisions.rowId.name)}, (p_rows[i]).${field(fxAppIndexEntryRevisions.commitSeq.name)})
        ON CONFLICT DO NOTHING RETURNING ${field(fxAppIndexEntryCurrent.commitSeq.name)} INTO inserted_seq;
    ELSE
      DELETE FROM ${membership} c WHERE c.${field(fxAppIndexEntryCurrent.scopeUuid.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.scopeUuid.name)}
        AND c.${field(fxAppIndexEntryCurrent.indexDefinitionId.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.indexDefinitionId.name)} AND c.${field(fxAppIndexEntryCurrent.encodedKey.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.encodedKey.name)}
        AND c.${field(fxAppIndexEntryCurrent.rowId.name)} = (p_rows[i]).${field(fxAppIndexEntryRevisions.rowId.name)} AND c.${field(fxAppIndexEntryCurrent.commitSeq.name)} = p_prior[i] RETURNING c.${field(fxAppIndexEntryCurrent.commitSeq.name)} INTO inserted_seq;
    END IF;
    IF inserted_seq IS NULL THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  END LOOP;
  phase := 'verify'; proof_rows := coalesce(p_verify, ARRAY[]::${namespace}.fx_app_index_write[]) || p_rows;
  FOR verification IN SELECT proof.ordinality AS proof_ordinal,
      r.${field(fxAppIndexEntryRevisions.commitSeq.name)} IS NOT NULL AND ${sameFields("r", "proof", indexColumns)} AS revision_matches,
      c.${field(fxAppIndexEntryCurrent.commitSeq.name)} AS pointer_seq,
      CASE WHEN proof.${field(fxAppIndexEntryRevisions.isTombstone.name)} THEN NULL ELSE proof.${field(fxAppIndexEntryRevisions.commitSeq.name)} END AS expected_seq
    FROM unnest(proof_rows) WITH ORDINALITY proof
    LEFT JOIN ${index} r ON ${equalFields("r", "proof", [fxAppIndexEntryRevisions.scopeUuid, fxAppIndexEntryRevisions.indexDefinitionId, fxAppIndexEntryRevisions.encodedKey, fxAppIndexEntryRevisions.rowId, fxAppIndexEntryRevisions.commitSeq])}
    LEFT JOIN ${membership} c ON c.${field(fxAppIndexEntryCurrent.scopeUuid.name)} = proof.${field(fxAppIndexEntryRevisions.scopeUuid.name)}
      AND c.${field(fxAppIndexEntryCurrent.indexDefinitionId.name)} = proof.${field(fxAppIndexEntryRevisions.indexDefinitionId.name)}
      AND c.${field(fxAppIndexEntryCurrent.encodedKey.name)} = proof.${field(fxAppIndexEntryRevisions.encodedKey.name)} AND c.${field(fxAppIndexEntryCurrent.rowId.name)} = proof.${field(fxAppIndexEntryRevisions.rowId.name)}
    ORDER BY proof.ordinality LOOP
    ordinal := verification.proof_ordinal - 1;
    IF NOT verification.revision_matches THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    IF verification.pointer_seq IS DISTINCT FROM verification.expected_seq THEN
      reason := 'storedCorruption'; RETURN NEXT; RETURN;
    END IF;
  END LOOP;
  reason := 'accepted'; ordinal := n; actual_commit_seq := NULL; RETURN NEXT;
END;
$index_batch$;`, "fx_apply_app_index_batch");

export const APP_UNIQUE_BATCH_FUNCTION_SQL = compileApplication(sql`
CREATE FUNCTION ${namespace}.fx_apply_app_unique_batch(p_releases ${namespace}.fx_app_unique_write[], p_claims ${namespace}.fx_app_unique_write[],
  p_verify_releases ${namespace}.fx_app_unique_write[], p_verify_claims ${namespace}.fx_app_unique_write[],
  p_absent_owners ${namespace}.fx_app_unique_owner[], p_absent_ordinals integer[])
RETURNS TABLE(reason text, ordinal integer, actual_table_id integer, actual_row_id bytea, actual_key bytea, actual_codec integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $unique_batch$
DECLARE i integer; releases integer := coalesce(array_length(p_releases, 1), 0); claims integer := coalesce(array_length(p_claims, 1), 0);
  expected_row ${unique}; actual_row ${unique}; parent_tombstone boolean; deleted_row ${unique}; phase text := 'claim'; stage text := 'write';
  proof_releases ${namespace}.fx_app_unique_write[]; proof_claims ${namespace}.fx_app_unique_write[];
BEGIN
  IF releases > 32 OR claims > 32 OR (releases + claims = 0 AND coalesce(array_length(p_absent_owners, 1), 0) = 0)
    OR releases + coalesce(array_length(p_verify_releases, 1), 0) > 512
    OR claims + coalesce(array_length(p_verify_claims, 1), 0) > 512
    OR coalesce(array_length(p_absent_owners, 1), 0) > 512
    OR coalesce(array_length(p_absent_owners, 1), 0) <> coalesce(array_length(p_absent_ordinals, 1), 0)
    OR EXISTS (SELECT 1 FROM unnest(p_absent_ordinals) input_ordinal WHERE input_ordinal IS NULL OR input_ordinal < 0 OR input_ordinal >= 512)
    THEN reason := 'invalidBatch'; ordinal := 0; RETURN NEXT; RETURN; END IF;
  IF claims > 0 THEN FOR i IN 1..claims LOOP
    ordinal := i - 1;
    SELECT r.${field(fxAppRowRevisions.isTombstone.name)} INTO parent_tombstone FROM ${current} c JOIN ${row} r
      ON r.${field(fxAppRowRevisions.scopeUuid.name)} = c.${field(fxAppRowCurrent.scopeUuid.name)} AND r.${field(fxAppRowRevisions.tableId.name)} = c.${field(fxAppRowCurrent.tableId.name)} AND r.${field(fxAppRowRevisions.rowId.name)} = c.${field(fxAppRowCurrent.rowId.name)} AND r.${field(fxAppRowRevisions.commitSeq.name)} = c.${field(fxAppRowCurrent.commitSeq.name)}
      WHERE c.${field(fxAppRowCurrent.scopeUuid.name)} = (p_claims[i]).${field(fxAppUniqueKeys.scopeUuid.name)} AND c.${field(fxAppRowCurrent.tableId.name)} = (p_claims[i]).${field(fxAppUniqueKeys.tableId.name)} AND c.${field(fxAppRowCurrent.rowId.name)} = (p_claims[i]).${field(fxAppUniqueKeys.rowId.name)};
    IF NOT FOUND THEN reason := 'parentMissing'; RETURN NEXT; RETURN; END IF;
    IF parent_tombstone THEN reason := 'parentTombstone'; RETURN NEXT; RETURN; END IF;
  END LOOP; END IF;
  phase := 'release';
  IF releases > 0 THEN FOR i IN 1..releases LOOP
    ordinal := i - 1;
    ${sql.join(uniqueColumns.map(column => sql`expected_row.${field(column.name)} := (p_releases[i]).${field(column.name)};`), sql`\n    `)}
    SELECT k.* INTO actual_row FROM ${unique} k WHERE k.${field(fxAppUniqueKeys.scopeUuid.name)} = expected_row.${field(fxAppUniqueKeys.scopeUuid.name)}
      AND k.${field(fxAppUniqueKeys.constraintId.name)} = expected_row.${field(fxAppUniqueKeys.constraintId.name)} AND k.${field(fxAppUniqueKeys.localeKey.name)} = expected_row.${field(fxAppUniqueKeys.localeKey.name)}
      AND k.${field(fxAppUniqueKeys.canonicalKeySha256.name)} = expected_row.${field(fxAppUniqueKeys.canonicalKeySha256.name)} FOR UPDATE;
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_row THEN reason := 'releaseMismatch'; RETURN NEXT; RETURN; END IF;
  END LOOP; END IF;
  -- Every selected release executes before the first claim. Later statements
  -- freshly see earlier writes; this also permits real canonical key swaps.
  IF releases > 0 THEN FOR i IN 1..releases LOOP
    ordinal := i - 1;
    ${sql.join(uniqueColumns.map(column => sql`expected_row.${field(column.name)} := (p_releases[i]).${field(column.name)};`), sql`\n    `)}
    DELETE FROM ${unique} k WHERE k.${field(fxAppUniqueKeys.scopeUuid.name)} = expected_row.${field(fxAppUniqueKeys.scopeUuid.name)} AND k.${field(fxAppUniqueKeys.constraintId.name)} = expected_row.${field(fxAppUniqueKeys.constraintId.name)}
      AND k.${field(fxAppUniqueKeys.localeKey.name)} = expected_row.${field(fxAppUniqueKeys.localeKey.name)} AND k.${field(fxAppUniqueKeys.canonicalKeySha256.name)} = expected_row.${field(fxAppUniqueKeys.canonicalKeySha256.name)} RETURNING k.* INTO deleted_row;
    IF NOT FOUND OR deleted_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    IF EXISTS (SELECT 1 FROM ${unique} k WHERE k.${field(fxAppUniqueKeys.scopeUuid.name)} = expected_row.${field(fxAppUniqueKeys.scopeUuid.name)} AND k.${field(fxAppUniqueKeys.constraintId.name)} = expected_row.${field(fxAppUniqueKeys.constraintId.name)}
      AND k.${field(fxAppUniqueKeys.localeKey.name)} = expected_row.${field(fxAppUniqueKeys.localeKey.name)} AND k.${field(fxAppUniqueKeys.canonicalKeySha256.name)} = expected_row.${field(fxAppUniqueKeys.canonicalKeySha256.name)}) THEN
      reason := 'storedCorruption'; RETURN NEXT; RETURN;
    END IF;
  END LOOP; END IF;
  phase := 'claim';
  IF claims > 0 THEN FOR i IN 1..claims LOOP
    ordinal := i - 1;
    ${sql.join(uniqueColumns.map(column => sql`expected_row.${field(column.name)} := (p_claims[i]).${field(column.name)};`), sql`\n    `)}
    SELECT k.* INTO actual_row FROM ${unique} k WHERE k.${field(fxAppUniqueKeys.scopeUuid.name)} = expected_row.${field(fxAppUniqueKeys.scopeUuid.name)}
      AND k.${field(fxAppUniqueKeys.constraintId.name)} = expected_row.${field(fxAppUniqueKeys.constraintId.name)} AND k.${field(fxAppUniqueKeys.localeKey.name)} = expected_row.${field(fxAppUniqueKeys.localeKey.name)}
      AND k.${field(fxAppUniqueKeys.canonicalKeySha256.name)} = expected_row.${field(fxAppUniqueKeys.canonicalKeySha256.name)} FOR UPDATE;
    IF FOUND THEN
      reason := 'claimConflict'; actual_table_id := actual_row.${field(fxAppUniqueKeys.tableId.name)}; actual_row_id := actual_row.${field(fxAppUniqueKeys.rowId.name)};
      actual_key := actual_row.${field(fxAppUniqueKeys.encodedKey.name)}; actual_codec := actual_row.${field(fxAppUniqueKeys.keyCodecVersion.name)}; RETURN NEXT; RETURN;
    END IF;
    INSERT INTO ${unique} (${sql.join(uniqueColumns.map(column => field(column.name)), sql`, `)})
      VALUES (${sql.join(uniqueColumns.map(column => sql`expected_row.${field(column.name)}`), sql`, `)});
  END LOOP; END IF;
  stage := 'verify'; phase := 'release';
  proof_releases := coalesce(p_verify_releases, ARRAY[]::${namespace}.fx_app_unique_write[]) || p_releases;
  proof_claims := coalesce(p_verify_claims, ARRAY[]::${namespace}.fx_app_unique_write[]) || p_claims;
  IF coalesce(array_length(proof_releases, 1), 0) > 0 THEN FOR i IN 1..array_length(proof_releases, 1) LOOP
    ordinal := i - 1;
    ${sql.join(uniqueColumns.map(column => sql`expected_row.${field(column.name)} := (proof_releases[i]).${field(column.name)};`), sql`\n    `)}
    IF NOT EXISTS (SELECT 1 FROM unnest(proof_claims) c WHERE
      c.${field(fxAppUniqueKeys.scopeUuid.name)} = expected_row.${field(fxAppUniqueKeys.scopeUuid.name)}
      AND c.${field(fxAppUniqueKeys.constraintId.name)} = expected_row.${field(fxAppUniqueKeys.constraintId.name)}
      AND c.${field(fxAppUniqueKeys.localeKey.name)} = expected_row.${field(fxAppUniqueKeys.localeKey.name)}
      AND c.${field(fxAppUniqueKeys.canonicalKeySha256.name)} = expected_row.${field(fxAppUniqueKeys.canonicalKeySha256.name)})
      AND EXISTS (SELECT 1 FROM ${unique} k WHERE k.${field(fxAppUniqueKeys.scopeUuid.name)} = expected_row.${field(fxAppUniqueKeys.scopeUuid.name)}
      AND k.${field(fxAppUniqueKeys.constraintId.name)} = expected_row.${field(fxAppUniqueKeys.constraintId.name)}
      AND k.${field(fxAppUniqueKeys.localeKey.name)} = expected_row.${field(fxAppUniqueKeys.localeKey.name)}
      AND k.${field(fxAppUniqueKeys.canonicalKeySha256.name)} = expected_row.${field(fxAppUniqueKeys.canonicalKeySha256.name)}) THEN
      reason := 'storedCorruption'; RETURN NEXT; RETURN;
    END IF;
  END LOOP; END IF;
  phase := 'claim';
  IF coalesce(array_length(proof_claims, 1), 0) > 0 THEN FOR i IN 1..array_length(proof_claims, 1) LOOP
    ordinal := i - 1;
    ${sql.join(uniqueColumns.map(column => sql`expected_row.${field(column.name)} := (proof_claims[i]).${field(column.name)};`), sql`\n    `)}
    SELECT k.* INTO actual_row FROM ${unique} k WHERE k.${field(fxAppUniqueKeys.scopeUuid.name)} = expected_row.${field(fxAppUniqueKeys.scopeUuid.name)}
      AND k.${field(fxAppUniqueKeys.constraintId.name)} = expected_row.${field(fxAppUniqueKeys.constraintId.name)} AND k.${field(fxAppUniqueKeys.localeKey.name)} = expected_row.${field(fxAppUniqueKeys.localeKey.name)}
      AND k.${field(fxAppUniqueKeys.canonicalKeySha256.name)} = expected_row.${field(fxAppUniqueKeys.canonicalKeySha256.name)};
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  END LOOP; END IF;
  phase := 'absentOwner';
  IF coalesce(array_length(p_absent_owners, 1), 0) > 0 THEN FOR i IN 1..array_length(p_absent_owners, 1) LOOP
    ordinal := p_absent_ordinals[i];
    IF EXISTS (SELECT 1 FROM ${unique} k WHERE
      ${sql.join(uniqueOwnerColumns.map(column => sql`k.${field(column.name)} IS NOT DISTINCT FROM (p_absent_owners[i]).${field(column.name)}`), sql` AND `)})
      THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  END LOOP; END IF;
  reason := 'accepted'; ordinal := releases + claims; RETURN NEXT;
END;
$unique_batch$;`, "fx_apply_app_unique_batch");

/** Fresh parent/slot admission belongs after preceding domain writes. Canonical
 * bytes originate in the TypeScript key owner; these are fixed complete tuples. */
export const APP_UNIQUE_MUTATIONS_FUNCTION_SQL = compile(sql`
CREATE FUNCTION ${namespace}.fx_apply_app_unique_mutations(p_owners ${namespace}.fx_app_unique_owner[],
  p_previous ${namespace}.fx_app_unique_write[], p_next ${namespace}.fx_app_unique_write[])
RETURNS TABLE(reason text, mutations integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $unique_mutations$
DECLARE n integer := coalesce(array_length(p_owners, 1), 0); i integer; j integer; start_at integer; end_at integer;
  ordinal integer := 0; stage text := 'stored'; actual_table_id integer; actual_row_id bytea;
  actual_row ${unique}; owner_row ${unique}; previous_row ${unique}; actual_parent ${row};
  stored_rows ${unique}[] := ARRAY[]::${unique}[]; parent_rows ${row}[];
  destinations ${namespace}.fx_app_unique_write[] := ARRAY[]::${namespace}.fx_app_unique_write[];
  releases ${namespace}.fx_app_unique_write[] := ARRAY[]::${namespace}.fx_app_unique_write[];
  claims ${namespace}.fx_app_unique_write[] := ARRAY[]::${namespace}.fx_app_unique_write[];
  retained ${namespace}.fx_app_unique_write[] := ARRAY[]::${namespace}.fx_app_unique_write[];
  absent ${namespace}.fx_app_unique_owner[] := ARRAY[]::${namespace}.fx_app_unique_owner[];
  absent_ordinals integer[] := ARRAY[]::integer[];
  working_releases ${namespace}.fx_app_unique_write[]; working_claims ${namespace}.fx_app_unique_write[];
  verify_releases ${namespace}.fx_app_unique_write[]; verify_claims ${namespace}.fx_app_unique_write[];
  release_offset integer := 0; claim_offset integer := 0; inner_message text; inner_detail text;
  slot_seen boolean; owner_seen boolean; releasing boolean; unchanged boolean;
BEGIN
  IF n > 512 OR n <> coalesce(array_length(p_previous, 1), 0) OR n <> coalesce(array_length(p_next, 1), 0) THEN
    reason := 'invalidBatch'; ${uniqueAdmissionRefusal}
  END IF;
  IF n = 0 THEN reason := 'accepted'; mutations := 0; RETURN NEXT; RETURN; END IF;
  FOR start_at IN 1..n BY 32 LOOP
    end_at := least(start_at + 31, n); stage := 'parent'; parent_rows := ARRAY[]::${row}[];
    -- Preserve the existing batch's found-parent/tombstone checks before its
    -- ordered missing-parent refusal, and then lock its real slot evidence.
    FOR actual_parent IN SELECT r.* FROM ${current} c JOIN ${row} r ON
      ${equalFields("r", "c", [fxAppRowRevisions.scopeUuid, fxAppRowRevisions.tableId, fxAppRowRevisions.rowId, fxAppRowRevisions.commitSeq])}
      WHERE EXISTS (SELECT 1 FROM unnest(p_owners) WITH ORDINALITY wanted WHERE wanted.ordinality BETWEEN start_at AND end_at
        AND p_next[wanted.ordinality::integer] IS NOT NULL
        AND ${equalFields("c", "wanted", [fxAppUniqueKeys.scopeUuid, fxAppUniqueKeys.tableId, fxAppUniqueKeys.rowId])}) LOOP
      SELECT wanted.ordinality::integer - 1 INTO ordinal FROM unnest(p_owners) WITH ORDINALITY wanted
        WHERE wanted.ordinality BETWEEN start_at AND end_at AND p_next[wanted.ordinality::integer] IS NOT NULL
          AND ${sameFields("actual_parent", "wanted", [fxAppUniqueKeys.scopeUuid, fxAppUniqueKeys.tableId, fxAppUniqueKeys.rowId])}
        ORDER BY wanted.ordinality LIMIT 1;
      IF actual_parent.${field(fxAppRowRevisions.isTombstone.name)} IS NULL THEN
        reason := 'storedCorruption'; ${uniqueAdmissionRefusal}
      END IF;
      IF actual_parent.${field(fxAppRowRevisions.isTombstone.name)} THEN reason := 'parentTombstone'; ${uniqueAdmissionRefusal} END IF;
      parent_rows := array_append(parent_rows, actual_parent);
    END LOOP;
    FOR i IN start_at..end_at LOOP
      ordinal := i - 1;
      IF p_next[i] IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(parent_rows) found_parent WHERE
        ${sameFields("found_parent", "(p_owners[i])", [fxAppUniqueKeys.scopeUuid, fxAppUniqueKeys.tableId, fxAppUniqueKeys.rowId])}) THEN
        reason := 'parentMissing'; ${uniqueAdmissionRefusal}
      END IF;
    END LOOP;
    stage := 'stored';
    FOR actual_row IN SELECT k.* FROM ${unique} k WHERE EXISTS (SELECT 1 FROM unnest(p_owners) WITH ORDINALITY wanted
      WHERE wanted.ordinality BETWEEN start_at AND end_at AND k.${field(fxAppUniqueKeys.scopeUuid.name)} = wanted.${field(fxAppUniqueKeys.scopeUuid.name)}
        AND k.${field(fxAppUniqueKeys.constraintId.name)} = wanted.${field(fxAppUniqueKeys.constraintId.name)} AND (
          ${equalFields("k", "wanted", uniqueOwnerColumns)} OR
          (p_previous[wanted.ordinality::integer] IS NOT NULL AND ${equalFields("k", "(p_previous[wanted.ordinality::integer])", uniqueSlotColumns)}) OR
          (p_next[wanted.ordinality::integer] IS NOT NULL AND ${equalFields("k", "(p_next[wanted.ordinality::integer])", uniqueSlotColumns)}))) FOR UPDATE OF k LOOP
      SELECT wanted.ordinality::integer - 1 INTO ordinal FROM unnest(p_owners) WITH ORDINALITY wanted
        WHERE wanted.ordinality BETWEEN start_at AND end_at
          AND actual_row.${field(fxAppUniqueKeys.scopeUuid.name)} = wanted.${field(fxAppUniqueKeys.scopeUuid.name)}
          AND actual_row.${field(fxAppUniqueKeys.constraintId.name)} = wanted.${field(fxAppUniqueKeys.constraintId.name)} AND (
            ${sameFields("actual_row", "wanted", uniqueOwnerColumns)} OR
            (p_previous[wanted.ordinality::integer] IS NOT NULL AND ${sameFields("actual_row", "(p_previous[wanted.ordinality::integer])", uniqueSlotColumns)}) OR
            (p_next[wanted.ordinality::integer] IS NOT NULL AND ${sameFields("actual_row", "(p_next[wanted.ordinality::integer])", uniqueSlotColumns)}))
        ORDER BY wanted.ordinality LIMIT 1;
      -- The former stored-row decoder runs before any canonical-key comparison.
      -- Native uuid/integer/text/bytea types retain its scalar representations;
      -- these checks retain every required value, range, codec and byte bound.
      IF ${sql.join(uniqueColumns.map(column => sql`actual_row.${field(column.name)} IS NULL`), sql` OR `)} OR
        actual_row.${field(fxAppUniqueKeys.constraintId.name)} NOT BETWEEN 1 AND ${sql.raw(String(MAX_CATALOG_UNIQUE_CONSTRAINT_DEFINITION_ID))} OR
        actual_row.${field(fxAppUniqueKeys.tableId.name)} NOT BETWEEN 1 AND ${sql.raw(String(MAX_CATALOG_TABLE_ID))} OR
        actual_row.${field(fxAppUniqueKeys.keyCodecVersion.name)} IS DISTINCT FROM ${sql.raw(String(APP_UNIQUE_KEY_CODEC_VERSION_V1))} OR
        octet_length(actual_row.${field(fxAppUniqueKeys.encodedKey.name)}) NOT BETWEEN 1 AND ${sql.raw(String(MAX_ORDERED_INDEX_KEY_BYTES_V1))} OR
        octet_length(actual_row.${field(fxAppUniqueKeys.canonicalKeySha256.name)}) IS DISTINCT FROM 32 OR
        octet_length(actual_row.${field(fxAppUniqueKeys.rowId.name)}) IS DISTINCT FROM 16 THEN
        reason := 'storedCorruption'; ${uniqueAdmissionRefusal}
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(stored_rows) prior WHERE
        (${sameFields("prior", "actual_row", uniqueOwnerColumns)} AND NOT (${sameFields("prior", "actual_row", uniqueSlotColumns)})) OR
        (${sameFields("prior", "actual_row", uniqueSlotColumns)} AND prior IS DISTINCT FROM actual_row)) THEN
        reason := 'storedCorruption'; ${uniqueAdmissionRefusal}
      END IF;
      IF NOT EXISTS (SELECT 1 FROM unnest(stored_rows) prior WHERE ${sameFields("prior", "actual_row", uniqueSlotColumns)}) THEN
        stored_rows := array_append(stored_rows, actual_row);
      END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1; actual_table_id := NULL; actual_row_id := NULL; stage := 'destination';
    IF p_next[i] IS NOT NULL THEN
      SELECT k.* INTO actual_row FROM unnest(stored_rows) k WHERE ${sameFields("k", "(p_next[i])", uniqueSlotColumns)} LIMIT 1;
      slot_seen := FOUND;
      IF NOT slot_seen THEN
        SELECT k.* INTO actual_row FROM unnest(destinations) k WHERE ${sameFields("k", "(p_next[i])", uniqueSlotColumns)} LIMIT 1;
        slot_seen := FOUND;
      END IF;
      IF slot_seen THEN
        IF actual_row.${field(fxAppUniqueKeys.keyCodecVersion.name)} IS DISTINCT FROM (p_next[i]).${field(fxAppUniqueKeys.keyCodecVersion.name)} THEN
          reason := 'storedCorruption'; ${uniqueAdmissionRefusal}
        END IF;
        IF actual_row.${field(fxAppUniqueKeys.encodedKey.name)} IS DISTINCT FROM (p_next[i]).${field(fxAppUniqueKeys.encodedKey.name)} THEN
          reason := 'hashCollision'; ${uniqueAdmissionRefusal}
        END IF;
        SELECT EXISTS (SELECT 1 FROM unnest(p_owners) WITH ORDINALITY selected WHERE
          ${sameFields("selected", "actual_row", uniqueOwnerColumns)} AND p_previous[selected.ordinality::integer] IS NOT NULL AND
          (p_next[selected.ordinality::integer] IS NULL OR p_previous[selected.ordinality::integer] IS DISTINCT FROM p_next[selected.ordinality::integer])) INTO releasing;
        IF NOT (p_previous[i] IS NOT NULL AND actual_row.${field(fxAppUniqueKeys.tableId.name)} = (p_owners[i]).${field(fxAppUniqueKeys.tableId.name)}
          AND actual_row.${field(fxAppUniqueKeys.rowId.name)} = (p_owners[i]).${field(fxAppUniqueKeys.rowId.name)}) AND
          (NOT releasing OR EXISTS (SELECT 1 FROM unnest(destinations) k WHERE ${sameFields("k", "(p_next[i])", uniqueSlotColumns)})) THEN
          reason := 'claimConflict'; actual_table_id := actual_row.${field(fxAppUniqueKeys.tableId.name)};
          actual_row_id := actual_row.${field(fxAppUniqueKeys.rowId.name)}; ${uniqueAdmissionRefusal}
        END IF;
      END IF;
    END IF;
    stage := 'previous';
    SELECT k.* INTO owner_row FROM unnest(stored_rows) k WHERE ${sameFields("k", "(p_owners[i])", uniqueOwnerColumns)} LIMIT 1;
    owner_seen := FOUND;
    IF p_previous[i] IS NULL THEN
      IF owner_seen THEN reason := 'previousMismatch'; ${uniqueAdmissionRefusal} END IF;
    ELSE
      SELECT k.* INTO previous_row FROM unnest(stored_rows) k WHERE ${sameFields("k", "(p_previous[i])", uniqueSlotColumns)} LIMIT 1;
      IF NOT FOUND OR NOT owner_seen THEN reason := 'previousMismatch'; ${uniqueAdmissionRefusal} END IF;
      IF previous_row.${field(fxAppUniqueKeys.keyCodecVersion.name)} IS DISTINCT FROM (p_previous[i]).${field(fxAppUniqueKeys.keyCodecVersion.name)} THEN
        reason := 'storedCorruption'; ${uniqueAdmissionRefusal}
      END IF;
      IF previous_row.${field(fxAppUniqueKeys.encodedKey.name)} IS DISTINCT FROM (p_previous[i]).${field(fxAppUniqueKeys.encodedKey.name)} THEN
        reason := 'hashCollision'; ${uniqueAdmissionRefusal}
      END IF;
      IF NOT (${sameFields("previous_row", "(p_owners[i])", uniqueOwnerColumns)}) OR
        NOT (${sameFields("previous_row", "owner_row", uniqueSlotColumns)}) THEN reason := 'previousMismatch'; ${uniqueAdmissionRefusal} END IF;
    END IF;
    unchanged := p_previous[i] IS NOT NULL AND p_next[i] IS NOT NULL AND p_previous[i] IS NOT DISTINCT FROM p_next[i];
    IF unchanged THEN retained := array_append(retained, p_previous[i]);
    ELSE
      IF p_previous[i] IS NOT NULL THEN releases := array_append(releases, p_previous[i]); END IF;
      IF p_next[i] IS NULL THEN absent := array_append(absent, p_owners[i]); absent_ordinals := array_append(absent_ordinals, i - 1);
      ELSE claims := array_append(claims, p_next[i]); retained := array_append(retained, p_next[i]); destinations := array_append(destinations, p_next[i]); END IF;
    END IF;
  END LOOP;
  -- This is delegation to the existing complete write engine, not another
  -- release/claim implementation. All release pages precede every claim page.
  IF cardinality(releases) <= 32 AND cardinality(claims) <= 32 AND cardinality(releases) + cardinality(claims) > 0 THEN
    working_releases := releases; working_claims := claims; verify_releases := ARRAY[]::${namespace}.fx_app_unique_write[];
    SELECT coalesce(array_agg(k), ARRAY[]::${namespace}.fx_app_unique_write[]) INTO verify_claims FROM unnest(retained) k
      WHERE NOT EXISTS (SELECT 1 FROM unnest(claims) c WHERE c IS NOT DISTINCT FROM k);
    BEGIN
      PERFORM * FROM ${namespace}.fx_apply_app_unique_batch(working_releases, working_claims, verify_releases, verify_claims, absent, absent_ordinals);
    EXCEPTION WHEN SQLSTATE 'FX001' THEN
      GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
      IF inner_message <> 'fx_apply_app_unique_batch' THEN RAISE; END IF;
      RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('kind','proof',
        'releaseOffset',0,'releaseCount',cardinality(working_releases),'claimOffset',0,'claimCount',cardinality(working_claims),'detail',inner_detail)::text;
    END;
  ELSE
    IF cardinality(releases) = 0 AND cardinality(claims) = 0 AND cardinality(absent) > 0 THEN
      BEGIN
        PERFORM * FROM ${namespace}.fx_apply_app_unique_batch(releases, claims, releases, retained, absent, absent_ordinals);
      EXCEPTION WHEN SQLSTATE 'FX001' THEN
        GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
        IF inner_message <> 'fx_apply_app_unique_batch' THEN RAISE; END IF;
        RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('kind','proof',
          'releaseOffset',0,'releaseCount',0,'claimOffset',0,'claimCount',0,'detail',inner_detail)::text;
      END;
    END IF;
    FOR start_at IN 1..cardinality(releases) BY 32 LOOP
      working_releases := releases[start_at:least(start_at+31,cardinality(releases))];
      verify_releases := ARRAY[]::${namespace}.fx_app_unique_write[]; verify_claims := ARRAY[]::${namespace}.fx_app_unique_write[];
      IF cardinality(claims) = 0 AND start_at + cardinality(working_releases) > cardinality(releases) THEN
        verify_releases := releases[1:start_at-1]; verify_claims := retained;
      END IF;
      BEGIN
        PERFORM * FROM ${namespace}.fx_apply_app_unique_batch(working_releases, ARRAY[]::${namespace}.fx_app_unique_write[], verify_releases, verify_claims,
          CASE WHEN cardinality(claims)=0 AND start_at+cardinality(working_releases)>cardinality(releases) THEN absent ELSE ARRAY[]::${namespace}.fx_app_unique_owner[] END,
          CASE WHEN cardinality(claims)=0 AND start_at+cardinality(working_releases)>cardinality(releases) THEN absent_ordinals ELSE ARRAY[]::integer[] END);
      EXCEPTION WHEN SQLSTATE 'FX001' THEN
        GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
        IF inner_message <> 'fx_apply_app_unique_batch' THEN RAISE; END IF;
        RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('kind','proof',
          'releaseOffset',start_at-1,'releaseCount',cardinality(working_releases),'claimOffset',0,'claimCount',0,'detail',inner_detail)::text;
      END;
    END LOOP;
    FOR start_at IN 1..cardinality(claims) BY 32 LOOP
      working_claims := claims[start_at:least(start_at+31,cardinality(claims))];
      verify_releases := ARRAY[]::${namespace}.fx_app_unique_write[]; verify_claims := ARRAY[]::${namespace}.fx_app_unique_write[];
      IF start_at + cardinality(working_claims) > cardinality(claims) THEN
        verify_releases := releases;
        SELECT coalesce(array_agg(k), ARRAY[]::${namespace}.fx_app_unique_write[]) INTO verify_claims FROM unnest(retained) k
          WHERE NOT EXISTS (SELECT 1 FROM unnest(working_claims) c WHERE c IS NOT DISTINCT FROM k);
      END IF;
      BEGIN
        PERFORM * FROM ${namespace}.fx_apply_app_unique_batch(ARRAY[]::${namespace}.fx_app_unique_write[], working_claims, verify_releases, verify_claims,
          CASE WHEN start_at+cardinality(working_claims)>cardinality(claims) THEN absent ELSE ARRAY[]::${namespace}.fx_app_unique_owner[] END,
          CASE WHEN start_at+cardinality(working_claims)>cardinality(claims) THEN absent_ordinals ELSE ARRAY[]::integer[] END);
      EXCEPTION WHEN SQLSTATE 'FX001' THEN
        GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
        IF inner_message <> 'fx_apply_app_unique_batch' THEN RAISE; END IF;
        RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('kind','proof',
          'releaseOffset',0,'releaseCount',0,'claimOffset',start_at-1,'claimCount',cardinality(working_claims),'detail',inner_detail)::text;
      END;
    END LOOP;
  END IF;
  reason := 'accepted'; mutations := n; RETURN NEXT;
END;
$unique_mutations$;`);

export const APP_INDEX_VALIDATION_FUNCTION_SQL = compile(sql`
CREATE FUNCTION ${namespace}.fx_reset_app_index_validation(p_rows ${namespace}.fx_app_index_coverage[])
RETURNS TABLE(reason text, rows integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $index_validation$
DECLARE i integer; n integer := coalesce(array_length(p_rows,1),0); expected_row ${indexBuild}; actual_row ${indexBuild};
  expected_rows ${indexBuild}[] := ARRAY[]::${indexBuild}[];
BEGIN
  IF n > 512 THEN RAISE EXCEPTION 'fx_reset_app_index_validation' USING ERRCODE='FX001', DETAIL='{"reason":"invalidBatch","ordinal":0}'; END IF;
  FOR i IN 1..n LOOP
    SELECT b.* INTO expected_row FROM ${indexBuild} b WHERE ${equalFields("b", "(p_rows[i])", indexCoverageColumns)}
      AND b.${field(fxSystemIndexBuildStates.lifecycle.name)} = 'validating';
    IF NOT FOUND THEN RAISE EXCEPTION 'fx_reset_app_index_validation' USING ERRCODE='FX001', DETAIL=jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text; END IF;
    expected_row.${field(fxSystemIndexBuildStates.backfillCursorRowId.name)} := NULL;
    expected_row.${field(fxSystemIndexBuildStates.updatedAt.name)} := clock_timestamp();
    UPDATE ${indexBuild} b SET ${field(fxSystemIndexBuildStates.backfillCursorRowId.name)} = NULL,
      ${field(fxSystemIndexBuildStates.updatedAt.name)} = expected_row.${field(fxSystemIndexBuildStates.updatedAt.name)}
      WHERE ${equalFields("b", "(p_rows[i])", indexCoverageColumns)} AND b.${field(fxSystemIndexBuildStates.lifecycle.name)} = 'validating';
    SELECT b.* INTO actual_row FROM ${indexBuild} b WHERE ${equalFields("b", "(p_rows[i])", indexCoverageColumns)};
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_row THEN RAISE EXCEPTION 'fx_reset_app_index_validation' USING ERRCODE='FX001', DETAIL=jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text; END IF;
    expected_rows := array_append(expected_rows, expected_row);
  END LOOP;
  FOR i IN 1..n LOOP
    SELECT b.* INTO actual_row FROM ${indexBuild} b WHERE ${equalFields("b", "(p_rows[i])", indexCoverageColumns)};
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_rows[i] THEN RAISE EXCEPTION 'fx_reset_app_index_validation' USING ERRCODE='FX001', DETAIL=jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text; END IF;
  END LOOP;
  reason := 'accepted'; rows := n; RETURN NEXT;
END;
$index_validation$;`);

export const APP_SEARCH_BATCH_FUNCTION_SQL = compileApplication(sql`
CREATE FUNCTION ${namespace}.fx_apply_app_search_batch(p_scope uuid, p_table integer, p_index integer, p_source text, p_seq bigint,
  p_ids bytea[], p_text ${namespace}.fx_app_search_write[], p_json ${namespace}.fx_app_json_write[], p_json_mode boolean, p_complete boolean,
  p_verify_ids bytea[], p_verify_text ${namespace}.fx_app_search_write[], p_verify_json ${namespace}.fx_app_json_write[])
RETURNS TABLE(reason text, entries integer, build_advanced boolean)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $search_batch$
DECLARE i integer; n integer; expected_text ${search}; actual_text ${search}; expected_json ${json}; actual_json ${json};
  expected_build ${searchBuild}; actual_build ${searchBuild}; actual_count integer;
  proof_ids bytea[]; proof_text ${namespace}.fx_app_search_write[]; proof_json ${namespace}.fx_app_json_write[];
BEGIN
  entries := coalesce(array_length(p_text, 1), 0) + coalesce(array_length(p_json, 1), 0); build_advanced := false;
  proof_ids := coalesce(p_verify_ids, ARRAY[]::bytea[]) || p_ids;
  proof_text := coalesce(p_verify_text, ARRAY[]::${namespace}.fx_app_search_write[]) || p_text;
  proof_json := coalesce(p_verify_json, ARRAY[]::${namespace}.fx_app_json_write[]) || p_json;
  IF coalesce(array_length(p_ids, 1), 0) < 1 OR array_length(p_ids, 1) > 32 OR array_length(proof_ids, 1) > 512
    OR coalesce(array_length(proof_text, 1), 0) + coalesce(array_length(proof_json, 1), 0) > 4096
    OR (p_json_mode AND coalesce(array_length(p_text, 1), 0) > 0)
    OR (NOT p_json_mode AND coalesce(array_length(p_json, 1), 0) > 0) THEN reason := 'invalidBatch'; RETURN NEXT; RETURN; END IF;
  IF p_json_mode THEN
    DELETE FROM ${json} j WHERE j.${field(fxAppJsonEntryCurrent.scopeUuid.name)} = p_scope AND j.${field(fxAppJsonEntryCurrent.tableId.name)} = p_table AND j.${field(fxAppJsonEntryCurrent.logicalIndexId.name)} = p_index AND j.${field(fxAppJsonEntryCurrent.rowId.name)} = ANY(p_ids);
    n := coalesce(array_length(p_json, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      ${sql.join(jsonColumns.map(column => sql`expected_json.${field(column.name)} := (p_json[i]).${field(column.name)};`), sql`\n      `)}
      IF expected_json.${field(fxAppJsonEntryCurrent.scopeUuid.name)} IS DISTINCT FROM p_scope OR expected_json.${field(fxAppJsonEntryCurrent.tableId.name)} IS DISTINCT FROM p_table
        OR expected_json.${field(fxAppJsonEntryCurrent.logicalIndexId.name)} IS DISTINCT FROM p_index OR expected_json.${field(fxAppJsonEntryCurrent.sourceSha256.name)} IS DISTINCT FROM p_source
        OR expected_json.${field(fxAppJsonEntryCurrent.commitSeq.name)} IS DISTINCT FROM p_seq OR NOT expected_json.${field(fxAppJsonEntryCurrent.rowId.name)} = ANY(p_ids) THEN reason := 'invalidBatch'; RETURN NEXT; RETURN; END IF;
      INSERT INTO ${json} (${sql.join(jsonColumns.map(column => field(column.name)), sql`, `)})
        VALUES (${sql.join(jsonColumns.map(column => sql`expected_json.${field(column.name)}`), sql`, `)});
    END LOOP; END IF;
    n := coalesce(array_length(proof_json, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      ${sql.join(jsonColumns.map(column => sql`expected_json.${field(column.name)} := (proof_json[i]).${field(column.name)};`), sql`\n      `)}
      SELECT j.* INTO actual_json FROM ${json} j WHERE j.${field(fxAppJsonEntryCurrent.scopeUuid.name)} = p_scope AND j.${field(fxAppJsonEntryCurrent.tableId.name)} = p_table
        AND j.${field(fxAppJsonEntryCurrent.logicalIndexId.name)} = p_index AND j.${field(fxAppJsonEntryCurrent.rowId.name)} = expected_json.${field(fxAppJsonEntryCurrent.rowId.name)} AND j.${field(fxAppJsonEntryCurrent.fieldId.name)} = expected_json.${field(fxAppJsonEntryCurrent.fieldId.name)};
      IF NOT FOUND OR actual_json IS DISTINCT FROM expected_json THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    END LOOP; END IF;
    SELECT count(*) INTO actual_count FROM ${json} j WHERE j.${field(fxAppJsonEntryCurrent.scopeUuid.name)} = p_scope AND j.${field(fxAppJsonEntryCurrent.tableId.name)} = p_table AND j.${field(fxAppJsonEntryCurrent.logicalIndexId.name)} = p_index AND j.${field(fxAppJsonEntryCurrent.rowId.name)} = ANY(proof_ids);
  ELSE
    DELETE FROM ${search} s WHERE s.${field(fxAppSearchEntryCurrent.scopeUuid.name)} = p_scope AND s.${field(fxAppSearchEntryCurrent.tableId.name)} = p_table AND s.${field(fxAppSearchEntryCurrent.logicalIndexId.name)} = p_index AND s.${field(fxAppSearchEntryCurrent.rowId.name)} = ANY(p_ids);
    n := coalesce(array_length(p_text, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      ${sql.join(searchColumns.map(column => sql`expected_text.${field(column.name)} := (p_text[i]).${field(column.name)};`), sql`\n      `)}
      IF expected_text.${field(fxAppSearchEntryCurrent.scopeUuid.name)} IS DISTINCT FROM p_scope OR expected_text.${field(fxAppSearchEntryCurrent.tableId.name)} IS DISTINCT FROM p_table
        OR expected_text.${field(fxAppSearchEntryCurrent.logicalIndexId.name)} IS DISTINCT FROM p_index OR expected_text.${field(fxAppSearchEntryCurrent.sourceSha256.name)} IS DISTINCT FROM p_source
        OR expected_text.${field(fxAppSearchEntryCurrent.commitSeq.name)} IS DISTINCT FROM p_seq OR NOT expected_text.${field(fxAppSearchEntryCurrent.rowId.name)} = ANY(p_ids) THEN reason := 'invalidBatch'; RETURN NEXT; RETURN; END IF;
      INSERT INTO ${search} (${sql.join(searchColumns.map(column => field(column.name)), sql`, `)})
        VALUES (${sql.join(searchColumns.map(column => sql`expected_text.${field(column.name)}`), sql`, `)});
    END LOOP; END IF;
    n := coalesce(array_length(proof_text, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      ${sql.join(searchColumns.map(column => sql`expected_text.${field(column.name)} := (proof_text[i]).${field(column.name)};`), sql`\n      `)}
      SELECT s.* INTO actual_text FROM ${search} s WHERE s.${field(fxAppSearchEntryCurrent.scopeUuid.name)} = p_scope AND s.${field(fxAppSearchEntryCurrent.tableId.name)} = p_table
        AND s.${field(fxAppSearchEntryCurrent.logicalIndexId.name)} = p_index AND s.${field(fxAppSearchEntryCurrent.rowId.name)} = expected_text.${field(fxAppSearchEntryCurrent.rowId.name)} AND s.${field(fxAppSearchEntryCurrent.fieldId.name)} = expected_text.${field(fxAppSearchEntryCurrent.fieldId.name)};
      IF NOT FOUND OR actual_text IS DISTINCT FROM expected_text THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    END LOOP; END IF;
    SELECT count(*) INTO actual_count FROM ${search} s WHERE s.${field(fxAppSearchEntryCurrent.scopeUuid.name)} = p_scope AND s.${field(fxAppSearchEntryCurrent.tableId.name)} = p_table AND s.${field(fxAppSearchEntryCurrent.logicalIndexId.name)} = p_index AND s.${field(fxAppSearchEntryCurrent.rowId.name)} = ANY(proof_ids);
  END IF;
  IF actual_count IS DISTINCT FROM n THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  IF p_complete THEN
    SELECT b.* INTO expected_build FROM ${searchBuild} b WHERE b.${field(fxSystemSearchBuildStates.scopeUuid.name)} = p_scope AND b.${field(fxSystemSearchBuildStates.tableId.name)} = p_table AND b.${field(fxSystemSearchBuildStates.logicalIndexId.name)} = p_index;
    IF FOUND THEN
      IF expected_build.${field(fxSystemSearchBuildStates.lifecycle.name)} <> 'ready' OR expected_build.${field(fxSystemSearchBuildStates.sourceSha256.name)} <> p_source OR expected_build.${field(fxSystemSearchBuildStates.coveredThroughCommitSeq.name)} > p_seq THEN
        reason := 'invalidAuthority'; RETURN NEXT; RETURN;
      END IF;
      IF expected_build.${field(fxSystemSearchBuildStates.coveredThroughCommitSeq.name)} < p_seq THEN
        UPDATE ${searchBuild} b SET ${field(fxSystemSearchBuildStates.coveredThroughCommitSeq.name)} = p_seq WHERE b.${field(fxSystemSearchBuildStates.scopeUuid.name)} = p_scope AND b.${field(fxSystemSearchBuildStates.tableId.name)} = p_table
          AND b.${field(fxSystemSearchBuildStates.logicalIndexId.name)} = p_index AND b.${field(fxSystemSearchBuildStates.sourceSha256.name)} = p_source AND b.${field(fxSystemSearchBuildStates.lifecycle.name)} = 'ready'
          AND b.${field(fxSystemSearchBuildStates.coveredThroughCommitSeq.name)} = expected_build.${field(fxSystemSearchBuildStates.coveredThroughCommitSeq.name)};
        IF NOT FOUND THEN reason := 'invalidAuthority'; RETURN NEXT; RETURN; END IF;
        expected_build.${field(fxSystemSearchBuildStates.coveredThroughCommitSeq.name)} := p_seq; build_advanced := true;
      END IF;
      SELECT b.* INTO actual_build FROM ${searchBuild} b WHERE b.${field(fxSystemSearchBuildStates.scopeUuid.name)} = p_scope AND b.${field(fxSystemSearchBuildStates.tableId.name)} = p_table AND b.${field(fxSystemSearchBuildStates.logicalIndexId.name)} = p_index;
      IF NOT FOUND OR actual_build IS DISTINCT FROM expected_build THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    END IF;
  END IF;
  IF p_json_mode THEN
    n := coalesce(array_length(proof_json, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      ${sql.join(jsonColumns.map(column => sql`expected_json.${field(column.name)} := (proof_json[i]).${field(column.name)};`), sql`\n      `)}
      SELECT j.* INTO actual_json FROM ${json} j WHERE j.${field(fxAppJsonEntryCurrent.scopeUuid.name)} = p_scope AND j.${field(fxAppJsonEntryCurrent.tableId.name)} = p_table
        AND j.${field(fxAppJsonEntryCurrent.logicalIndexId.name)} = p_index AND j.${field(fxAppJsonEntryCurrent.rowId.name)} = expected_json.${field(fxAppJsonEntryCurrent.rowId.name)} AND j.${field(fxAppJsonEntryCurrent.fieldId.name)} = expected_json.${field(fxAppJsonEntryCurrent.fieldId.name)};
      IF NOT FOUND OR actual_json IS DISTINCT FROM expected_json THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    END LOOP; END IF;
    SELECT count(*) INTO actual_count FROM ${json} j WHERE j.${field(fxAppJsonEntryCurrent.scopeUuid.name)} = p_scope AND j.${field(fxAppJsonEntryCurrent.tableId.name)} = p_table AND j.${field(fxAppJsonEntryCurrent.logicalIndexId.name)} = p_index AND j.${field(fxAppJsonEntryCurrent.rowId.name)} = ANY(proof_ids);
  ELSE
    n := coalesce(array_length(proof_text, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      ${sql.join(searchColumns.map(column => sql`expected_text.${field(column.name)} := (proof_text[i]).${field(column.name)};`), sql`\n      `)}
      SELECT s.* INTO actual_text FROM ${search} s WHERE s.${field(fxAppSearchEntryCurrent.scopeUuid.name)} = p_scope AND s.${field(fxAppSearchEntryCurrent.tableId.name)} = p_table
        AND s.${field(fxAppSearchEntryCurrent.logicalIndexId.name)} = p_index AND s.${field(fxAppSearchEntryCurrent.rowId.name)} = expected_text.${field(fxAppSearchEntryCurrent.rowId.name)} AND s.${field(fxAppSearchEntryCurrent.fieldId.name)} = expected_text.${field(fxAppSearchEntryCurrent.fieldId.name)};
      IF NOT FOUND OR actual_text IS DISTINCT FROM expected_text THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    END LOOP; END IF;
    SELECT count(*) INTO actual_count FROM ${search} s WHERE s.${field(fxAppSearchEntryCurrent.scopeUuid.name)} = p_scope AND s.${field(fxAppSearchEntryCurrent.tableId.name)} = p_table AND s.${field(fxAppSearchEntryCurrent.logicalIndexId.name)} = p_index AND s.${field(fxAppSearchEntryCurrent.rowId.name)} = ANY(proof_ids);
  END IF;
  IF actual_count IS DISTINCT FROM n THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  reason := 'accepted'; RETURN NEXT;
END;
$search_batch$;`, "fx_apply_app_search_batch");

export const APP_COVERAGE_FUNCTION_SQL = compileApplication(sql`
CREATE FUNCTION ${namespace}.fx_advance_app_coverage(p_indexes ${namespace}.fx_app_index_coverage[],
  p_unique ${namespace}.fx_app_unique_coverage[], p_seq bigint, p_prior bigint, p_check_prior boolean,
  p_verify_indexes ${namespace}.fx_app_index_coverage[], p_verify_unique ${namespace}.fx_app_unique_coverage[],
  p_verify_index_proofs text[], p_verify_unique_proofs text[])
RETURNS TABLE(reason text, family text, ordinal integer, index_proofs text[], unique_proofs text[])
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $coverage$
DECLARE i integer; n integer; stage text := 'write'; expected_index ${indexBuild}; actual_index ${indexBuild};
  expected_unique ${uniqueBuild}; actual_unique ${uniqueBuild}; sampled_now timestamptz := clock_timestamp();
  expected_indexes ${indexBuild}[] := ARRAY[]::${indexBuild}[];
  expected_uniques ${uniqueBuild}[] := ARRAY[]::${uniqueBuild}[];
BEGIN
  family := 'index'; ordinal := 0; index_proofs := ARRAY[]::text[]; unique_proofs := ARRAY[]::text[];
  IF coalesce(array_length(p_indexes, 1), 0) > 32 OR coalesce(array_length(p_unique, 1), 0) > 32
    OR coalesce(array_length(p_indexes, 1), 0) + coalesce(array_length(p_unique, 1), 0) +
       coalesce(array_length(p_verify_indexes, 1), 0) + coalesce(array_length(p_verify_unique, 1), 0) > 512
    OR coalesce(array_length(p_verify_indexes, 1), 0) <> coalesce(array_length(p_verify_index_proofs, 1), 0)
    OR coalesce(array_length(p_verify_unique, 1), 0) <> coalesce(array_length(p_verify_unique_proofs, 1), 0)
    THEN reason := 'invalidBatch'; RETURN NEXT; RETURN; END IF;
  n := coalesce(array_length(p_indexes, 1), 0);
  IF n > 0 THEN FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT b.* INTO expected_index FROM ${indexBuild} b WHERE
      ${equalFields("b", "(p_indexes[i])", indexCoverageColumns)}
      AND b.${field(fxSystemIndexBuildStates.lifecycle.name)} = 'enabled'
      AND b.${field(fxSystemIndexBuildStates.maintenanceActivationSequence.name)} IS NULL
      AND (NOT p_check_prior OR b.${field(fxSystemIndexBuildStates.coveredThroughCommitSeq.name)} IS NOT DISTINCT FROM p_prior);
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RETURN NEXT; RETURN; END IF;
    UPDATE ${indexBuild} b SET ${field(fxSystemIndexBuildStates.coveredThroughCommitSeq.name)} = p_seq,
      ${field(fxSystemIndexBuildStates.updatedAt.name)} = sampled_now WHERE
      ${equalFields("b", "(p_indexes[i])", indexCoverageColumns)}
      AND b.${field(fxSystemIndexBuildStates.lifecycle.name)} = 'enabled';
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RETURN NEXT; RETURN; END IF;
    expected_index.${field(fxSystemIndexBuildStates.coveredThroughCommitSeq.name)} := p_seq;
    expected_index.${field(fxSystemIndexBuildStates.updatedAt.name)} := sampled_now;
    expected_indexes := array_append(expected_indexes, expected_index);
    SELECT b.* INTO actual_index FROM ${indexBuild} b WHERE
      b.${field(fxSystemIndexBuildStates.scopeId.name)} = (p_indexes[i]).${field(fxSystemIndexBuildStates.scopeId.name)}
      AND b.${field(fxSystemIndexBuildStates.indexDefinitionId.name)} = (p_indexes[i]).${field(fxSystemIndexBuildStates.indexDefinitionId.name)};
    IF NOT FOUND OR actual_index IS DISTINCT FROM expected_index THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  END LOOP; END IF;
  family := 'unique'; n := coalesce(array_length(p_unique, 1), 0);
  IF n > 0 THEN FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT b.* INTO expected_unique FROM ${uniqueBuild} b WHERE
      ${equalFields("b", "(p_unique[i])", uniqueCoverageColumns)}
      AND b.${field(fxSystemUniqueConstraintBuilds.lifecycle.name)} = 'enabled'
      AND b.${field(fxSystemUniqueConstraintBuilds.maintenanceActivationSequence.name)} IS NULL;
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RETURN NEXT; RETURN; END IF;
    UPDATE ${uniqueBuild} b SET ${field(fxSystemUniqueConstraintBuilds.coveredThroughCommitSeq.name)} = p_seq,
      ${field(fxSystemUniqueConstraintBuilds.updatedAt.name)} = sampled_now WHERE
      ${equalFields("b", "(p_unique[i])", uniqueCoverageColumns)}
      AND b.${field(fxSystemUniqueConstraintBuilds.lifecycle.name)} = 'enabled';
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RETURN NEXT; RETURN; END IF;
    expected_unique.${field(fxSystemUniqueConstraintBuilds.coveredThroughCommitSeq.name)} := p_seq;
    expected_unique.${field(fxSystemUniqueConstraintBuilds.updatedAt.name)} := sampled_now;
    expected_uniques := array_append(expected_uniques, expected_unique);
    SELECT b.* INTO actual_unique FROM ${uniqueBuild} b WHERE
      b.${field(fxSystemUniqueConstraintBuilds.scopeId.name)} = (p_unique[i]).${field(fxSystemUniqueConstraintBuilds.scopeId.name)}
      AND b.${field(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId.name)} = (p_unique[i]).${field(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId.name)};
    IF NOT FOUND OR actual_unique IS DISTINCT FROM expected_unique THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  END LOOP; END IF;
  -- Keep exact server projections: timestamptz precision must not round through JS Date.
  IF coalesce(array_length(expected_indexes, 1), 0) > 0 THEN FOR i IN 1..array_length(expected_indexes, 1) LOOP
    index_proofs := array_append(index_proofs, row_to_json(expected_indexes[i])::text);
  END LOOP; END IF;
  IF coalesce(array_length(expected_uniques, 1), 0) > 0 THEN FOR i IN 1..array_length(expected_uniques, 1) LOOP
    unique_proofs := array_append(unique_proofs, row_to_json(expected_uniques[i])::text);
  END LOOP; END IF;
  -- The final page freshly verifies prior and current complete stored projections.
  stage := 'verify'; family := 'index';
  IF coalesce(array_length(p_verify_indexes, 1), 0) + coalesce(array_length(p_indexes, 1), 0) > 0 THEN
    FOR i IN 1..(coalesce(array_length(p_verify_indexes, 1), 0) + coalesce(array_length(p_indexes, 1), 0)) LOOP
      ordinal := i - 1;
      SELECT b.* INTO actual_index FROM ${indexBuild} b WHERE
        ${equalFields("b", "((p_verify_indexes || p_indexes)[i])", indexCoverageColumns)};
      IF NOT FOUND OR row_to_json(actual_index)::text IS DISTINCT FROM (p_verify_index_proofs || index_proofs)[i]
        THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    END LOOP;
  END IF;
  family := 'unique';
  IF coalesce(array_length(p_verify_unique, 1), 0) + coalesce(array_length(p_unique, 1), 0) > 0 THEN
    FOR i IN 1..(coalesce(array_length(p_verify_unique, 1), 0) + coalesce(array_length(p_unique, 1), 0)) LOOP
      ordinal := i - 1;
      SELECT b.* INTO actual_unique FROM ${uniqueBuild} b WHERE
        ${equalFields("b", "((p_verify_unique || p_unique)[i])", uniqueCoverageColumns)};
      IF NOT FOUND OR row_to_json(actual_unique)::text IS DISTINCT FROM (p_verify_unique_proofs || unique_proofs)[i]
        THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
    END LOOP;
  END IF;
  reason := 'accepted'; family := NULL;
  ordinal := coalesce(array_length(p_indexes, 1), 0) + n; RETURN NEXT;
END;
$coverage$;`, "fx_advance_app_coverage");


const composedCall = (family: string, operation: string, offset: SQL, call: SQL) => sql`
  BEGIN
    ${call}
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
    IF inner_message <> ${sql.raw(`'${operation}'`)} THEN RAISE; END IF;
    RAISE EXCEPTION 'fx_apply_app_materialization' USING ERRCODE='FX001', DETAIL=
      jsonb_build_object('family',${sql.raw(`'${family}'`)},'pageOffset',${offset},'detail',inner_detail)::text;
  END;`;

/** Only fixed domain obligations enter this accepting composition. Each later
 * VOLATILE statement sees earlier writes and invokes the same complete proof. */
export const APP_MATERIALIZATION_FUNCTION_SQL = compile(sql`
CREATE FUNCTION ${namespace}.fx_apply_app_materialization(
  p_rows ${namespace}.fx_app_row_write[], p_row_pages integer[],
  p_indexes ${namespace}.fx_app_index_write[], p_index_prior bigint[], p_index_historical boolean[],
  p_unique_owners ${namespace}.fx_app_unique_owner[], p_unique_previous ${namespace}.fx_app_unique_write[], p_unique_next ${namespace}.fx_app_unique_write[],
  p_validation ${namespace}.fx_app_index_coverage[], p_index_coverage ${namespace}.fx_app_index_coverage[], p_unique_coverage ${namespace}.fx_app_unique_coverage[],
  p_seq bigint, p_search_scope uuid, p_search_tables integer[], p_search_indexes integer[], p_search_sources text[], p_search_modes boolean[],
  p_search_row_counts integer[], p_search_ids bytea[], p_search_text_counts integer[], p_search_text ${namespace}.fx_app_search_write[],
  p_search_json_counts integer[], p_search_json ${namespace}.fx_app_json_write[])
RETURNS TABLE(reason text, row_count integer, index_count integer, unique_count integer, validation_count integer, coverage_count integer, search_count integer, search_build_count integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $materialization$
DECLARE i integer; j integer; page_size integer; page_offset integer := 0; n integer; packet_count integer;
  inner_message text; inner_detail text; proof record; index_proofs text[] := ARRAY[]::text[]; unique_proofs text[] := ARRAY[]::text[];
  id_offset integer := 0; text_offset integer := 0; json_offset integer := 0; packet_ids bytea[]; page_ids bytea[];
  packet_text ${namespace}.fx_app_search_write[]; packet_json ${namespace}.fx_app_json_write[];
  page_text ${namespace}.fx_app_search_write[]; page_json ${namespace}.fx_app_json_write[];
  verify_text ${namespace}.fx_app_search_write[]; verify_json ${namespace}.fx_app_json_write[];
BEGIN
  row_count := coalesce(cardinality(p_rows),0); index_count := coalesce(cardinality(p_indexes),0);
  unique_count := coalesce(cardinality(p_unique_owners),0); validation_count := coalesce(cardinality(p_validation),0);
  coverage_count := coalesce(cardinality(p_index_coverage),0) + coalesce(cardinality(p_unique_coverage),0); search_count := 0; search_build_count := 0;
  -- Authenticate each later packet at its actual stage, never before an
  -- earlier primitive has had the opportunity to refuse its own write.
  IF row_count > 512 OR EXISTS (SELECT 1 FROM unnest(p_row_pages) size WHERE size IS NULL OR size < 1 OR size > 32)
    OR row_count <> coalesce((SELECT sum(size) FROM unnest(p_row_pages) size),0) THEN
    RAISE EXCEPTION 'Invalid fixed row page segmentation' USING ERRCODE='22023';
  END IF;
  FOREACH page_size IN ARRAY p_row_pages LOOP
    ${composedCall("row", "fx_apply_app_row_batch", sql`page_offset`, sql`
      PERFORM * FROM ${namespace}.fx_apply_app_row_batch(p_rows[page_offset+1:page_offset+page_size],
        CASE WHEN page_offset+page_size=row_count THEN p_rows[1:page_offset] ELSE ARRAY[]::${namespace}.fx_app_row_write[] END);`)}
    page_offset := page_offset + page_size;
  END LOOP;
  IF index_count <> coalesce(cardinality(p_index_prior),0) OR index_count <> coalesce(cardinality(p_index_historical),0) OR index_count > 4096 THEN
    RAISE EXCEPTION 'Invalid fixed index segmentation' USING ERRCODE='22023';
  END IF;
  FOR i IN 1..index_count BY 32 LOOP
    page_offset := i-1; page_size := least(32,index_count-page_offset);
    ${composedCall("index", "fx_apply_app_index_batch", sql`page_offset`, sql`
      PERFORM * FROM ${namespace}.fx_apply_app_index_batch(p_indexes[i:i+page_size-1],p_index_prior[i:i+page_size-1],p_index_historical[i:i+page_size-1],
        CASE WHEN i+page_size>index_count THEN p_indexes[1:i-1] ELSE ARRAY[]::${namespace}.fx_app_index_write[] END);`)}
  END LOOP;
  IF validation_count > 0 THEN
    ${composedCall("indexValidation", "fx_reset_app_index_validation", sql`0`, sql`PERFORM * FROM ${namespace}.fx_reset_app_index_validation(p_validation);`)}
  END IF;
  IF unique_count > 0 OR coalesce(cardinality(p_unique_previous),0)>0 OR coalesce(cardinality(p_unique_next),0)>0 THEN
    ${composedCall("unique", "fx_apply_app_unique_mutations", sql`0`, sql`PERFORM * FROM ${namespace}.fx_apply_app_unique_mutations(p_unique_owners,p_unique_previous,p_unique_next);`)}
  END IF;
  n := coalesce(cardinality(p_index_coverage),0);
  IF n > 512 THEN RAISE EXCEPTION 'Invalid fixed index coverage count' USING ERRCODE='22023'; END IF;
  FOR i IN 1..n BY 32 LOOP
    page_offset := i-1; page_size := least(32,n-page_offset);
    ${composedCall("indexCoverage", "fx_advance_app_coverage", sql`page_offset`, sql`
      SELECT * INTO proof FROM ${namespace}.fx_advance_app_coverage(p_index_coverage[i:i+page_size-1],ARRAY[]::${namespace}.fx_app_unique_coverage[],p_seq,NULL,false,
        CASE WHEN i+page_size>n THEN p_index_coverage[1:i-1] ELSE ARRAY[]::${namespace}.fx_app_index_coverage[] END,ARRAY[]::${namespace}.fx_app_unique_coverage[],
        CASE WHEN i+page_size>n THEN index_proofs ELSE ARRAY[]::text[] END,ARRAY[]::text[]);`)}
    index_proofs := index_proofs || proof.index_proofs;
  END LOOP;
  n := coalesce(cardinality(p_unique_coverage),0);
  IF n > 512 THEN RAISE EXCEPTION 'Invalid fixed unique coverage count' USING ERRCODE='22023'; END IF;
  FOR i IN 1..n BY 32 LOOP
    page_offset := i-1; page_size := least(32,n-page_offset);
    ${composedCall("uniqueCoverage", "fx_advance_app_coverage", sql`page_offset`, sql`
      SELECT * INTO proof FROM ${namespace}.fx_advance_app_coverage(ARRAY[]::${namespace}.fx_app_index_coverage[],p_unique_coverage[i:i+page_size-1],p_seq,NULL,false,
        ARRAY[]::${namespace}.fx_app_index_coverage[],CASE WHEN i+page_size>n THEN p_unique_coverage[1:i-1] ELSE ARRAY[]::${namespace}.fx_app_unique_coverage[] END,
        ARRAY[]::text[],CASE WHEN i+page_size>n THEN unique_proofs ELSE ARRAY[]::text[] END);`)}
    unique_proofs := unique_proofs || proof.unique_proofs;
  END LOOP;
  packet_count := coalesce(cardinality(p_search_tables),0);
  IF packet_count <> coalesce(cardinality(p_search_indexes),0) OR packet_count <> coalesce(cardinality(p_search_sources),0)
    OR packet_count <> coalesce(cardinality(p_search_modes),0) OR packet_count <> coalesce(cardinality(p_search_row_counts),0)
    OR packet_count <> coalesce(cardinality(p_search_text_counts),0) OR packet_count <> coalesce(cardinality(p_search_json_counts),0)
    OR EXISTS (SELECT 1 FROM unnest(p_search_row_counts) size WHERE size IS NULL OR size<1 OR size>512)
    OR EXISTS (SELECT 1 FROM unnest(p_search_text_counts) size WHERE size IS NULL OR size<0)
    OR EXISTS (SELECT 1 FROM unnest(p_search_json_counts) size WHERE size IS NULL OR size<0)
    OR coalesce((SELECT sum(size) FROM unnest(p_search_row_counts) size),0) <> coalesce(cardinality(p_search_ids),0)
    OR coalesce((SELECT sum(size) FROM unnest(p_search_text_counts) size),0) <> coalesce(cardinality(p_search_text),0)
    OR coalesce((SELECT sum(size) FROM unnest(p_search_json_counts) size),0) <> coalesce(cardinality(p_search_json),0) THEN
    RAISE EXCEPTION 'Invalid fixed search segmentation' USING ERRCODE='22023';
  END IF;
  FOR j IN 1..packet_count LOOP
    n := p_search_row_counts[j]; packet_ids := p_search_ids[id_offset+1:id_offset+n];
    packet_text := p_search_text[text_offset+1:text_offset+p_search_text_counts[j]];
    packet_json := p_search_json[json_offset+1:json_offset+p_search_json_counts[j]];
    -- Full identities and segmentation are authenticated for this definition
    -- before its first delegated DELETE, retaining definition failure order.
    IF EXISTS (SELECT 1 FROM unnest(packet_text) entry WHERE
      entry.${field(fxAppSearchEntryCurrent.scopeUuid.name)} IS DISTINCT FROM p_search_scope OR entry.${field(fxAppSearchEntryCurrent.tableId.name)} IS DISTINCT FROM p_search_tables[j]
      OR entry.${field(fxAppSearchEntryCurrent.logicalIndexId.name)} IS DISTINCT FROM p_search_indexes[j] OR entry.${field(fxAppSearchEntryCurrent.sourceSha256.name)} IS DISTINCT FROM p_search_sources[j]
      OR entry.${field(fxAppSearchEntryCurrent.commitSeq.name)} IS DISTINCT FROM p_seq OR NOT entry.${field(fxAppSearchEntryCurrent.rowId.name)}=ANY(packet_ids))
      OR EXISTS (SELECT 1 FROM unnest(packet_json) entry WHERE
        entry.${field(fxAppJsonEntryCurrent.scopeUuid.name)} IS DISTINCT FROM p_search_scope OR entry.${field(fxAppJsonEntryCurrent.tableId.name)} IS DISTINCT FROM p_search_tables[j]
        OR entry.${field(fxAppJsonEntryCurrent.logicalIndexId.name)} IS DISTINCT FROM p_search_indexes[j] OR entry.${field(fxAppJsonEntryCurrent.sourceSha256.name)} IS DISTINCT FROM p_search_sources[j]
        OR entry.${field(fxAppJsonEntryCurrent.commitSeq.name)} IS DISTINCT FROM p_seq OR NOT entry.${field(fxAppJsonEntryCurrent.rowId.name)}=ANY(packet_ids)) THEN
      RAISE EXCEPTION 'Invalid fixed search tuple identity' USING ERRCODE='22023';
    END IF;
    FOR i IN 1..n BY 32 LOOP
      page_offset := i-1; page_size := least(32,n-page_offset); page_ids := packet_ids[i:i+page_size-1];
      SELECT coalesce(array_agg(entry),ARRAY[]::${namespace}.fx_app_search_write[]) INTO page_text FROM unnest(packet_text) entry
        WHERE entry.${field(fxAppSearchEntryCurrent.rowId.name)}=ANY(page_ids);
      SELECT coalesce(array_agg(entry),ARRAY[]::${namespace}.fx_app_json_write[]) INTO page_json FROM unnest(packet_json) entry
        WHERE entry.${field(fxAppJsonEntryCurrent.rowId.name)}=ANY(page_ids);
      verify_text := ARRAY[]::${namespace}.fx_app_search_write[]; verify_json := ARRAY[]::${namespace}.fx_app_json_write[];
      IF i+page_size>n THEN
        SELECT coalesce(array_agg(entry),ARRAY[]::${namespace}.fx_app_search_write[]) INTO verify_text FROM unnest(packet_text) entry
          WHERE entry.${field(fxAppSearchEntryCurrent.rowId.name)}=ANY(packet_ids[1:i-1]);
        SELECT coalesce(array_agg(entry),ARRAY[]::${namespace}.fx_app_json_write[]) INTO verify_json FROM unnest(packet_json) entry
          WHERE entry.${field(fxAppJsonEntryCurrent.rowId.name)}=ANY(packet_ids[1:i-1]);
      END IF;
      ${composedCall("search", "fx_apply_app_search_batch", sql`id_offset+page_offset`, sql`
        SELECT * INTO proof FROM ${namespace}.fx_apply_app_search_batch(p_search_scope,p_search_tables[j],p_search_indexes[j],p_search_sources[j],p_seq,
          page_ids,page_text,page_json,p_search_modes[j],i+page_size>n,
          CASE WHEN i+page_size>n THEN packet_ids[1:i-1] ELSE ARRAY[]::bytea[] END,verify_text,verify_json);`)}
      search_count := search_count + proof.entries;
      IF proof.build_advanced THEN search_build_count := search_build_count + 1; END IF;
    END LOOP;
    id_offset := id_offset+n; text_offset := text_offset+p_search_text_counts[j]; json_offset := json_offset+p_search_json_counts[j];
  END LOOP;
  reason := 'accepted'; RETURN NEXT;
END;
$materialization$;`);

export const APPLICATION_DOMAIN_FUNCTIONS = [
  APP_PUBLICATION_ACCEPTANCE_FUNCTION,
  APP_PUBLICATION_APPLICATION_FUNCTION,
  { name: "fx_accept_app_unique_owners", signature: "fx_app_unique_owner[],bytea[],bigint[]", delimiter: "$unique_owners$", ddl: APP_UNIQUE_OWNER_ACCEPTANCE_FUNCTION_SQL,
    inputs: ["p_owners", "p_previous", "p_row_previous"], outputs: ["reason", "owners"], outputTypes: ["text", "integer"] },
  { name: "fx_accept_app_index_transitions", signature: "text,uuid,integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],bigint[],text[],bigint[],integer", delimiter: "$index_transitions$", ddl: APP_INDEX_TRANSITIONS_FUNCTION_SQL,
    inputs: ["p_scope", "p_scope_uuid", "p_indexes", "p_access", "p_tables", "p_codecs", "p_specs", "p_ids", "p_previous", "p_previous_sha", "p_final", "p_final_sha", "p_row_previous", "p_attempts", "p_epochs", "p_fences", "p_maximum"],
    outputs: ["reason", "pair_ordinal", "key_ordinal", "transition_kind", "prior_commit_seq", "prior_is_tombstone", "emitted_count"], outputTypes: ["text", "integer", "integer", "text", "bigint", "boolean", "integer"] },
  { name: "fx_apply_app_unique_mutations", signature: "fx_app_unique_owner[],fx_app_unique_write[],fx_app_unique_write[]", delimiter: "$unique_mutations$", ddl: APP_UNIQUE_MUTATIONS_FUNCTION_SQL,
    inputs: ["p_owners", "p_previous", "p_next"], outputs: ["reason", "mutations"], outputTypes: ["text", "integer"] },
  { name: "fx_reset_app_index_validation", signature: "fx_app_index_coverage[]", delimiter: "$index_validation$", ddl: APP_INDEX_VALIDATION_FUNCTION_SQL,
    inputs: ["p_rows"], outputs: ["reason", "rows"], outputTypes: ["text", "integer"] },
  { name: "fx_apply_app_materialization", signature: "fx_app_row_write[],integer[],fx_app_index_write[],bigint[],boolean[],fx_app_unique_owner[],fx_app_unique_write[],fx_app_unique_write[],fx_app_index_coverage[],fx_app_index_coverage[],fx_app_unique_coverage[],bigint,uuid,integer[],integer[],text[],boolean[],integer[],bytea[],integer[],fx_app_search_write[],integer[],fx_app_json_write[]", delimiter: "$materialization$", ddl: APP_MATERIALIZATION_FUNCTION_SQL,
    inputs: ["p_rows", "p_row_pages", "p_indexes", "p_index_prior", "p_index_historical", "p_unique_owners", "p_unique_previous", "p_unique_next", "p_validation", "p_index_coverage", "p_unique_coverage", "p_seq", "p_search_scope", "p_search_tables", "p_search_indexes", "p_search_sources", "p_search_modes", "p_search_row_counts", "p_search_ids", "p_search_text_counts", "p_search_text", "p_search_json_counts", "p_search_json"],
    outputs: ["reason", "row_count", "index_count", "unique_count", "validation_count", "coverage_count", "search_count", "search_build_count"], outputTypes: ["text", "integer", "integer", "integer", "integer", "integer", "integer", "integer"] },
  { name: "fx_advance_app_coverage", signature: "fx_app_index_coverage[],fx_app_unique_coverage[],bigint,bigint,boolean,fx_app_index_coverage[],fx_app_unique_coverage[],text[],text[]", delimiter: "$coverage$", ddl: APP_COVERAGE_FUNCTION_SQL,
    inputs: ["p_indexes", "p_unique", "p_seq", "p_prior", "p_check_prior", "p_verify_indexes", "p_verify_unique", "p_verify_index_proofs", "p_verify_unique_proofs"], outputs: ["reason", "family", "ordinal", "index_proofs", "unique_proofs"], outputTypes: ["text", "text", "integer", "text[]", "text[]"] },
  { name: "fx_begin_app_materialization", signature: "text,timestamptz,boolean", delimiter: "$materialization_begin$", ddl: APP_MATERIALIZATION_BEGIN_FUNCTION_SQL,
    inputs: ["p_scope", "p_deadline", "p_snapshot"], outputs: ["reason", "database_now", "application_head", "application_activation", "legacy_schema", "relation_schema"],
    outputTypes: ["text", "timestamptz", getTableName(fxSystemApplicationActiveHeads), getTableName(fxSystemApplicationActivations), getTableName(fxSystemApplicationRevisionSchemasV1), getTableName(fxSystemApplicationRevisionSchemas)] },
  { name: "fx_apply_app_row_batch", signature: "fx_app_row_write[],fx_app_row_write[]", delimiter: "$row_batch$", ddl: APP_ROW_BATCH_FUNCTION_SQL,
    inputs: ["p_rows", "p_verify"], outputs: ["reason", "ordinal", "actual_commit_seq", "actual_creation_time"], outputTypes: ["text", "integer", "bigint", "double precision"] },
  { name: "fx_apply_app_index_batch", signature: "fx_app_index_write[],bigint[],boolean[],fx_app_index_write[]", delimiter: "$index_batch$", ddl: APP_INDEX_BATCH_FUNCTION_SQL,
    inputs: ["p_rows", "p_prior", "p_historical", "p_verify"], outputs: ["reason", "ordinal", "actual_commit_seq"], outputTypes: ["text", "integer", "bigint"] },
  { name: "fx_apply_app_unique_batch", signature: "fx_app_unique_write[],fx_app_unique_write[],fx_app_unique_write[],fx_app_unique_write[],fx_app_unique_owner[],integer[]", delimiter: "$unique_batch$", ddl: APP_UNIQUE_BATCH_FUNCTION_SQL,
    inputs: ["p_releases", "p_claims", "p_verify_releases", "p_verify_claims", "p_absent_owners", "p_absent_ordinals"], outputs: ["reason", "ordinal", "actual_table_id", "actual_row_id", "actual_key", "actual_codec"], outputTypes: ["text", "integer", "integer", "bytea", "bytea", "integer"] },
  { name: "fx_apply_app_search_batch", signature: "uuid,integer,integer,text,bigint,bytea[],fx_app_search_write[],fx_app_json_write[],boolean,boolean,bytea[],fx_app_search_write[],fx_app_json_write[]", delimiter: "$search_batch$", ddl: APP_SEARCH_BATCH_FUNCTION_SQL,
    inputs: ["p_scope", "p_table", "p_index", "p_source", "p_seq", "p_ids", "p_text", "p_json", "p_json_mode", "p_complete", "p_verify_ids", "p_verify_text", "p_verify_json"], outputs: ["reason", "entries", "build_advanced"], outputTypes: ["text", "integer", "boolean"] },
] as const;

/** Installation owner composes these exact private types and fixed bodies into
 * its existing namespace attestation. This is not a serving permission cache. */
export function applicationDomainInstallationSql(schemaName: SQL): SQL<boolean> {
  return sql<boolean>`(${sql.join(APPLICATION_DOMAIN_TYPES.map(({ name, columns, source }) => sql`
    exists (select 1 from pg_catalog.pg_type t, bounds b
      where t.typnamespace = b.namespace_oid and t.typowner = b.owner_oid and t.typtype = 'c' and t.typname = ${name}
        and (select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a
          where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) = array[${sql.join(columns.map(column => sql`${column.name}`), sql`,`)}]::text[]
        and (select array_agg(a.atttypid order by a.attnum) from pg_catalog.pg_attribute a
          where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) = array[${sql.join(columns.map(column => sql`${column.getSQLType()}::pg_catalog.regtype::oid`), sql`,`)}]::oid[]
        and (select array_agg(a.atttypmod order by a.attnum) from pg_catalog.pg_attribute a
          where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped) = array[${sql.join(columns.map(column => sql`(select a.atttypmod from pg_catalog.pg_attribute a
            where a.attrelid = (pg_catalog.quote_ident(${schemaName}) || '.' || ${getTableName(source)})::pg_catalog.regclass
              and a.attname = ${column.name} and a.attnum > 0 and not a.attisdropped)`), sql`,`)}]::integer[])
  `), sql` and `)} and ${sql.join(APPLICATION_DOMAIN_FUNCTIONS.map(operation => {
    const signature = operation.signature.replaceAll("fx_app_", '"__flarex_schema__".fx_app_');
    const body = operation.ddl.split(operation.delimiter)[1]!.replaceAll("%1$I.", '"__flarex_target__".');
    return sql`(select count(*) = 1 from pg_catalog.pg_proc p, bounds b where p.pronamespace = b.namespace_oid and p.proname = ${operation.name})
      and exists (select 1 from pg_catalog.pg_proc p, bounds b where
        p.oid = (pg_catalog.quote_ident(${schemaName}) || '.' || ${operation.name} || '(' ||
          pg_catalog.replace(${signature}, '"__flarex_schema__"', pg_catalog.quote_ident(${schemaName})) || ')')::pg_catalog.regprocedure
        and p.pronamespace = b.namespace_oid and p.proowner = b.owner_oid and p.pronargdefaults = 0
        and p.prokind = 'f' and not p.prosecdef and not p.proisstrict and not p.proleakproof and p.proparallel = 'u' and p.prosupport = 0
        and p.provolatile = 'v' and p.proretset and p.prorettype = 'pg_catalog.record'::pg_catalog.regtype
        and p.prolang = (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
        and p.proargnames = array[${sql.join([...operation.inputs, ...operation.outputs].map(name => sql`${name}`), sql`,`)}]::text[]
        and p.proargmodes = array[${sql.join([...operation.inputs.map(() => sql`'i'`), ...operation.outputs.map(() => sql`'t'`)], sql`,`)}]::"char"[]
        and p.proallargtypes = array[${sql.join([...operation.signature.split(","), ...operation.outputTypes].map(type =>
          type.startsWith("fx_") ? sql`(pg_catalog.quote_ident(${schemaName}) || '.' || ${type})::pg_catalog.regtype::oid`
            : sql`${type}::pg_catalog.regtype::oid`), sql`,`)}]::oid[]
        and p.proconfig = array['search_path=pg_catalog, pg_temp']
        and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
        and pg_catalog.replace(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n'), pg_catalog.quote_ident(${schemaName}) || '.', '"__flarex_target__".') = ${body})`;
  }), sql` and `)})`;
}

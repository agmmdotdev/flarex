import { MAX_ORDERED_INDEX_KEY_BYTES_V1 } from "flarex-protocol/ordered-index";
import { getTableColumns, getTableName, sql, type SQL } from "drizzle-orm";
import { PgDialect, type PgColumn, type PgTable } from "drizzle-orm/pg-core";
import { fxAppRowCurrent, fxAppRowRevisions, fxAppIndexEntryRevisions, fxAppEdgeAdjacencyVersions,
  fxSystemIndexBuildStates, fxSystemIndexMaintenanceObligations, fxSystemAppSchemaCandidateValidations,
  fxSystemUniqueConstraintBuilds, fxSystemUniqueMaintenanceObligations } from "../../database/schema";
import { fxSystemApplicationActiveHeads, fxSystemApplicationActivations } from "../../application/applicationActivationSchema";
import { fxSystemApplicationRevisionSchemas } from "../../application/relations/applicationRelationSchema";
import { fxSystemApplicationRevisionSchemasV1 } from "../../database/schema";

const namespace = sql.raw("%1$I");
const table = (target: PgTable) => sql`${namespace}.${sql.identifier(getTableName(target))}`;
const column = (alias: string, target: PgColumn) => sql`${sql.raw(alias)}.${sql.identifier(target.name)}`;
const build = fxSystemIndexBuildStates;
const maintenance = fxSystemIndexMaintenanceObligations;
const rows = fxAppRowRevisions;
const current = fxAppRowCurrent;
const entries = fxAppIndexEntryRevisions;
const adjacency = fxAppEdgeAdjacencyVersions;
const compile = (statement: SQL) => new PgDialect().sqlToQuery(statement).sql;
const scalarRow = (alias: string) => sql`row(${sql.join(Object.values(getTableColumns(rows)).map(target =>
  target === rows.valueBytes ? sql`NULL::bytea` : column(alias, target)), sql`, `)})::${table(rows)}`;

/** Complete scalar build acceptance. The fixed publication stage owns these
 * reads and locks; an accepted composite is a server-local value, never JSON. */
const buildInvalid = sql`(
  ${column("b", build.scopeId)} IS DISTINCT FROM p_scope OR
  ${column("b", build.indexDefinitionId)} IS DISTINCT FROM selected_id OR
  ${column("b", build.storageGeneration)} IS DISTINCT FROM p_generation OR
  ${column("b", build.storageGenerationFence)} IS DISTINCT FROM p_fence OR
  ${column("b", build.epoch)} IS DISTINCT FROM p_epoch OR
  ${column("b", build.startCommitSeq)} IS NULL OR ${column("b", build.startCommitSeq)} < 0 OR
  ${column("b", build.startCommitSeq)} > p_last OR
  (${column("b", build.coveredThroughCommitSeq)} IS NOT NULL AND
    (${column("b", build.coveredThroughCommitSeq)} < 0 OR ${column("b", build.coveredThroughCommitSeq)} > p_last)) OR
  (${column("b", build.firstReadableCommitSeq)} IS NOT NULL AND
    (${column("b", build.firstReadableCommitSeq)} < 0 OR ${column("b", build.coveredThroughCommitSeq)} IS NULL OR
      ${column("b", build.firstReadableCommitSeq)} > ${column("b", build.coveredThroughCommitSeq)})) OR
  ${column("b", build.lifecycle)} IS NULL OR
  ${column("b", build.lifecycle)} NOT IN ('declared','building','backfilling','validating','enabled') OR
  ${column("b", build.cursorCodecVersion)} IS DISTINCT FROM 1 OR
  (${column("b", build.backfillCursorRowId)} IS NOT NULL AND
    (octet_length(${column("b", build.backfillCursorRowId)}) <> 16 OR ${column("b", build.lifecycle)} IN ('declared','building'))) OR
  ${column("b", build.attemptFence)} IS NULL OR ${column("b", build.attemptFence)} <= 0 OR
  ${column("b", build.createdAt)} IS NULL OR ${column("b", build.updatedAt)} IS NULL OR
  NOT isfinite(${column("b", build.createdAt)}) OR NOT isfinite(${column("b", build.updatedAt)}) OR
  abs(extract(epoch FROM ${column("b", build.createdAt)}) * 1000) > 8640000000000000 OR
  abs(extract(epoch FROM ${column("b", build.updatedAt)}) * 1000) > 8640000000000000 OR
  date_trunc('milliseconds', ${column("b", build.updatedAt)}) < date_trunc('milliseconds', ${column("b", build.createdAt)}) OR
  ((${column("b", build.maintenanceActivationSequence)} IS NULL) <> (${column("m", maintenance.activationSequence)} IS NULL)))`;

const maintenanceInvalid = sql`(${column("m", maintenance.activationSequence)} IS NOT NULL AND (
  ${column("b", build.lifecycle)} IS DISTINCT FROM 'enabled' OR
  ${column("m", maintenance.activationSequence)} <= 0 OR
  ${column("m", maintenance.scopeId)} IS DISTINCT FROM ${column("b", build.scopeId)} OR
  ${column("m", maintenance.indexDefinitionId)} IS DISTINCT FROM ${column("b", build.indexDefinitionId)} OR
  ${column("m", maintenance.storageGeneration)} IS DISTINCT FROM ${column("b", build.storageGeneration)} OR
  ${column("m", maintenance.storageGenerationFence)} IS DISTINCT FROM ${column("b", build.storageGenerationFence)} OR
  ${column("m", maintenance.epoch)} IS DISTINCT FROM ${column("b", build.epoch)} OR
  ${column("m", maintenance.attemptFence)} IS DISTINCT FROM ${column("b", build.attemptFence)} OR
  ${column("m", maintenance.firstReadableCommitSeq)} IS NULL OR ${column("m", maintenance.firstReadableCommitSeq)} < 0 OR
  ${column("m", maintenance.openedCommitSeq)} IS NULL OR ${column("m", maintenance.openedCommitSeq)} < ${column("m", maintenance.firstReadableCommitSeq)} OR
  ${column("m", maintenance.firstReadableCommitSeq)} IS DISTINCT FROM ${column("b", build.firstReadableCommitSeq)} OR
  ${column("m", maintenance.openedCommitSeq)} IS DISTINCT FROM ${column("b", build.coveredThroughCommitSeq)} OR
  ${column("m", maintenance.tableId)} IS NULL OR ${column("m", maintenance.tableId)} < 1 OR
  ${column("m", maintenance.deploymentId)} IS NULL OR length(${column("m", maintenance.deploymentId)}) = 0 OR
  ${column("m", maintenance.schemaVersionId)} IS NULL OR length(${column("m", maintenance.schemaVersionId)}) = 0 OR
  octet_length(${column("m", maintenance.physicalSpecSha256)}) IS DISTINCT FROM 32 OR
  octet_length(${column("m", maintenance.schemaManifestSha256)}) IS DISTINCT FROM 32 OR
  octet_length(${column("m", maintenance.activationSha256)}) IS DISTINCT FROM 32 OR
  octet_length(${column("m", maintenance.headSha256)}) IS DISTINCT FROM 32))`;

const acceptanceInputs = [
  ["p_scope", "text"], ["p_scope_uuid", "uuid"], ["p_generation", "text"], ["p_fence", "bigint"], ["p_epoch", "text"],
  ["p_last", "bigint"], ["p_snapshot", "bigint"], ["p_oldest", "bigint"], ["p_deadline", "timestamptz"], ["p_capture_snapshot", "boolean"],
  ["p_original_build_locks", "boolean"],
  ["p_intrinsic", "integer[]"], ["p_developer", "integer[]"], ["p_developer_access", "text[]"],
  ["p_point_tables", "integer[]"], ["p_point_ids", "bytea[]"], ["p_point_kinds", "text[]"], ["p_point_sequences", "bigint[]"],
  ["p_point_snapshots", "bigint[]"], ["p_changed", "boolean[]"], ["p_need_original", "boolean[]"],
  ["p_original_sequences", "bigint[]"], ["p_original_scopes", "uuid[]"], ["p_original_epochs", "uuid[]"],
  ["p_original_previous", "bigint[]"], ["p_original_schemas", "text[]"], ["p_original_lengths", "integer[]"],
  ["p_original_digests", "bytea[]"], ["p_original_times", "double precision[]"],
  ["p_range_indexes", "integer[]"], ["p_range_tables", "integer[]"], ["p_range_specs", "bytea[]"],
  ["p_range_lower", "bytea[]"], ["p_range_upper_kinds", "text[]"], ["p_range_upper", "bytea[]"], ["p_range_upper_ids", "bytea[]"],
  ["p_relation_indexes", "integer[]"], ["p_relation_ids", "bytea[]"], ["p_relation_versions", "bigint[]"],
  ["p_indexes", "integer[]"], ["p_access", "text[]"], ["p_tables", "integer[]"], ["p_codecs", "integer[]"], ["p_specs", "bytea[]"],
  ["p_ids", "bytea[]"], ["p_previous", "bytea[]"], ["p_previous_sha", "bytea[]"], ["p_final", "bytea[]"], ["p_final_sha", "bytea[]"],
  ["p_row_previous", "bigint[]"], ["p_maximum", "integer"],
  ["p_unique_owners", "fx_app_unique_owner[]"], ["p_unique_previous", "bytea[]"], ["p_unique_row_previous", "bigint[]"],
  ["p_target_tables", "integer[]"], ["p_target_ids", "bytea[]"], ["p_candidate", "boolean"], ["p_stop", "text"],
] as const;
const acceptanceOutputs = [
  ["kind", "text"], ["ordinal", "integer"],
  ["pointer_sequence", "bigint"], ["latest_sequence", "bigint"], ["latest_tombstone", "boolean"], ["latest_creation_time", "double precision"],
  ["transition_reason", "text"], ["pair_ordinal", "integer"], ["key_ordinal", "integer"], ["transition_kind", "text"],
  ["prior_commit_seq", "bigint"], ["prior_is_tombstone", "boolean"], ["emitted_count", "integer"], ["accepted_unique_owners", "integer"],
  ["validation_definition", "integer"], ["validation_attempt", "bigint"], ["validation_epoch", "text"], ["validation_fence", "bigint"],
  ["database_now", "timestamptz"], ["candidate_head", getTableName(fxSystemAppSchemaCandidateValidations)],
  ["application_head", getTableName(fxSystemApplicationActiveHeads)], ["application_activation", getTableName(fxSystemApplicationActivations)],
  ["legacy_schema", getTableName(fxSystemApplicationRevisionSchemasV1)], ["relation_schema", getTableName(fxSystemApplicationRevisionSchemas)],
] as const;
const parameter = (name: string, type: string) => sql`${sql.identifier(name)} ${type.startsWith("fx_") ? sql`${namespace}.${sql.raw(type)}` : sql.raw(type)}`;
const refusal = sql`RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;`;

/** One fixed ordered acceptance procedure. A retained local failure stops at
 * its named boundary before any later SQL and is rethrown by the Effect owner. */
export const APP_PUBLICATION_ACCEPTANCE_FUNCTION = {
  name: "fx_accept_app_publication", signature: acceptanceInputs.map(([, type]) => type).join(","),
  inputs: acceptanceInputs.map(([name]) => name), outputs: acceptanceOutputs.map(([name]) => name),
  outputTypes: acceptanceOutputs.map(([, type]) => type), delimiter: "$publication_acceptance$",
  ddl: compile(sql`
CREATE FUNCTION ${namespace}.fx_accept_app_publication(${sql.join(acceptanceInputs.map(([name, type]) => parameter(name, type)), sql`, `)})
RETURNS TABLE(${sql.join(acceptanceOutputs.map(([name, type]) => parameter(name, type)), sql`, `)})
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_acceptance$
DECLARE i integer := 1; j integer; phase text := 'intrinsicBuild'; refusal text; selected_id integer; actual_sequence bigint;
  b ${table(build)}; m ${table(maintenance)}; latest ${table(rows)}; pointer_seq bigint; captured record; transition record; coverage record;
  intrinsic ${table(build)}[] := ARRAY[]::${table(build)}[]; developer ${table(build)}[] := ARRAY[]::${table(build)}[];
  intrinsic_maintenance ${table(maintenance)}[] := ARRAY[]::${table(maintenance)}[];
  developer_maintenance ${table(maintenance)}[] := ARRAY[]::${table(maintenance)}[];
  heads ${table(rows)}[] := ARRAY[]::${table(rows)}[]; pointers bigint[] := ARRAY[]::bigint[]; original_lengths integer[] := ARRAY[]::integer[];
  attempts bigint[] := ARRAY[]::bigint[]; epochs text[] := ARRAY[]::text[]; fences bigint[] := ARRAY[]::bigint[];
  range_row ${table(entries)}; version bigint; target ${table(rows)}; original ${table(rows)}; first_point_conflict integer;
BEGIN
  IF p_scope IS NULL OR length(p_scope) = 0 OR p_generation IS DISTINCT FROM 'flarexdb_v1' OR p_fence IS NULL OR p_fence <= 0 OR
    p_epoch IS NULL OR length(p_epoch) = 0 OR p_last IS NULL OR p_last < 0 OR p_scope_uuid IS NULL THEN
    refusal := 'invalidAuthority'; ${refusal}
  END IF;
  IF cardinality(p_intrinsic) <> (SELECT count(DISTINCT value) FROM unnest(p_intrinsic) value) THEN
    refusal := 'intrinsicIndexBuildInvalid'; ${refusal}
  END IF;
  IF cardinality(p_intrinsic) > 0 THEN FOR j IN 0..(cardinality(p_intrinsic)-1)/32 LOOP
    IF NOT p_original_build_locks THEN PERFORM 1 FROM ${table(build)} x WHERE ${column("x", build.scopeId)} = p_scope
      AND ${column("x", build.indexDefinitionId)} = ANY(p_intrinsic[j*32+1:least((j+1)*32,cardinality(p_intrinsic))])
      ORDER BY array_position(p_intrinsic, ${column("x", build.indexDefinitionId)}) FOR SHARE; END IF;
    FOR i IN j*32+1..least((j+1)*32,cardinality(p_intrinsic)) LOOP
      selected_id := p_intrinsic[i];
      SELECT x.* INTO b FROM ${table(build)} x WHERE ${column("x", build.scopeId)} = p_scope AND ${column("x", build.indexDefinitionId)} = selected_id;
      SELECT x.* INTO m FROM ${table(maintenance)} x WHERE ${column("x", maintenance.scopeId)} = p_scope
        AND ${column("x", maintenance.indexDefinitionId)} = selected_id AND ${column("x", maintenance.activationSequence)} = ${column("b", build.maintenanceActivationSequence)};
      IF ${buildInvalid} OR ${maintenanceInvalid} THEN refusal := 'intrinsicIndexBuildInvalid'; ${refusal} END IF;
      intrinsic[i] := b; intrinsic_maintenance[i] := m;
    END LOOP;
  END LOOP; END IF;
  phase := 'developerBuild'; i := 1;
  IF NOT p_original_build_locks THEN PERFORM 1 FROM ${table(build)} x WHERE ${column("x", build.scopeId)} = p_scope AND ${column("x", build.indexDefinitionId)} = ANY(p_developer)
    ORDER BY ${column("x", build.indexDefinitionId)} FOR SHARE; END IF;
  IF cardinality(p_developer) <> (SELECT count(DISTINCT value) FROM unnest(p_developer) value) THEN
    refusal := 'developerIndexBuildInvalid'; ${refusal}
  END IF;
  IF cardinality(p_developer) > 0 THEN FOR i IN 1..cardinality(p_developer) LOOP
    selected_id := p_developer[i];
    SELECT x.* INTO b FROM ${table(build)} x WHERE ${column("x", build.scopeId)} = p_scope AND ${column("x", build.indexDefinitionId)} = selected_id;
    SELECT x.* INTO m FROM ${table(maintenance)} x WHERE ${column("x", maintenance.scopeId)} = p_scope
      AND ${column("x", maintenance.indexDefinitionId)} = selected_id AND ${column("x", maintenance.activationSequence)} = ${column("b", build.maintenanceActivationSequence)};
    IF p_developer_access[i] IS DISTINCT FROM 'developer' OR ${buildInvalid} OR ${maintenanceInvalid} THEN refusal := 'developerIndexBuildInvalid'; ${refusal} END IF;
    developer[i] := b; developer_maintenance[i] := m;
  END LOOP; END IF;
  phase := 'point'; actual_sequence := NULL;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    SELECT c.${sql.identifier(current.commitSeq.name)} AS pointer, ${scalarRow("r")} AS revision, octet_length(r.value_bytes) AS byte_length INTO captured
      FROM (VALUES (1)) request(dummy) LEFT JOIN ${table(current)} c ON ${column("c", current.scopeUuid)} = p_scope_uuid
        AND ${column("c", current.tableId)} = p_point_tables[i] AND ${column("c", current.rowId)} = p_point_ids[i]
      LEFT JOIN LATERAL (SELECT x.* FROM ${table(rows)} x WHERE ${column("x", rows.scopeUuid)} = p_scope_uuid
        AND ${column("x", rows.tableId)} = p_point_tables[i] AND ${column("x", rows.rowId)} = p_point_ids[i]
        ORDER BY ${column("x", rows.commitSeq)} DESC LIMIT 1) r ON true;
    pointer_seq := captured.pointer; latest := captured.revision;
    original_lengths[i] := captured.byte_length;
    heads[i] := latest; pointers[i] := pointer_seq;
    IF pointer_seq IS DISTINCT FROM ${column("latest", rows.commitSeq)} OR
      (${column("latest", rows.commitSeq)} IS NOT NULL AND (${column("latest", rows.commitSeq)} <= 0 OR ${column("latest", rows.commitSeq)} > p_last OR
        ${column("latest", rows.isTombstone)} IS NULL OR ${column("latest", rows.creationTime)} IS NULL OR
        ${column("latest", rows.creationTime)} <= 0 OR ${column("latest", rows.creationTime)} > 9007199254740991)) THEN
      refusal := 'rowHeadInvalid'; ${refusal}
    END IF;
  END LOOP; END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_point_snapshots[i] IS NULL OR p_point_snapshots[i] < 0 OR p_point_snapshots[i] > p_last OR
      p_point_kinds[i] IS NULL OR p_point_kinds[i] NOT IN ('present','tombstone','noVisibleRevision','generatedInsertion','noVisibleRevisionInsertion') OR
      (p_point_kinds[i] IN ('present','tombstone') AND (p_point_sequences[i] IS NULL OR p_point_sequences[i] <= 0 OR p_point_sequences[i] > p_point_snapshots[i])) OR
      (p_point_kinds[i] IN ('noVisibleRevision','generatedInsertion','noVisibleRevisionInsertion') AND p_point_sequences[i] IS NOT NULL) THEN
      refusal := 'occEvidenceInvalid'; ${refusal}
    END IF;
    IF p_point_kinds[i] = 'generatedInsertion' THEN CONTINUE; END IF;
    IF ${column("latest", rows.commitSeq)} > p_point_snapshots[i] THEN
      IF actual_sequence IS NULL THEN actual_sequence := ${column("latest", rows.commitSeq)}; first_point_conflict := i; END IF;
    ELSIF (p_point_kinds[i] = 'present' AND (${column("latest", rows.isTombstone)} IS DISTINCT FROM false OR ${column("latest", rows.commitSeq)} IS DISTINCT FROM p_point_sequences[i])) OR
      (p_point_kinds[i] = 'tombstone' AND (${column("latest", rows.isTombstone)} IS DISTINCT FROM true OR ${column("latest", rows.commitSeq)} IS DISTINCT FROM p_point_sequences[i])) OR
      (p_point_kinds[i] IN ('noVisibleRevision','noVisibleRevisionInsertion') AND ${column("latest", rows.commitSeq)} IS NOT NULL) THEN
      refusal := 'occEvidenceInvalid'; ${refusal}
    END IF;
  END LOOP; END IF;
  IF actual_sequence IS NOT NULL THEN i := first_point_conflict; refusal := 'pointConflict'; ${refusal} END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_point_kinds[i] IN ('generatedInsertion','noVisibleRevisionInsertion') AND ${column("latest", rows.commitSeq)} IS NOT NULL THEN
      refusal := 'generatedInsertionConflict'; ${refusal}
    END IF;
  END LOOP; END IF;
  phase := 'range'; actual_sequence := NULL;
  IF cardinality(p_range_indexes) > 0 AND (p_snapshot < p_oldest OR p_last > p_snapshot + 128) THEN i := 1; refusal := 'rangeWindowExceeded'; ${refusal} END IF;
  IF cardinality(p_range_indexes) > 0 AND p_last > p_snapshot THEN FOR i IN 1..cardinality(p_range_indexes) LOOP
    SELECT x.* INTO range_row FROM ${table(entries)} x WHERE ${column("x", entries.scopeUuid)} = p_scope_uuid
      AND ${column("x", entries.indexDefinitionId)} = p_range_indexes[i] AND ${column("x", entries.commitSeq)} > p_snapshot AND ${column("x", entries.commitSeq)} <= p_last
      AND (p_range_lower[i] IS NULL OR ${column("x", entries.encodedKey)} >= p_range_lower[i])
      AND (p_range_upper_kinds[i] = 'unbounded' OR (p_range_upper_kinds[i] = 'key' AND ${column("x", entries.encodedKey)} < p_range_upper[i]) OR
        (p_range_upper_kinds[i] = 'position' AND (${column("x", entries.encodedKey)} < p_range_upper[i] OR
          (${column("x", entries.encodedKey)} = p_range_upper[i] AND ${column("x", entries.rowId)} <= p_range_upper_ids[i]))))
      ORDER BY ${column("x", entries.commitSeq)}, ${column("x", entries.encodedKey)}, ${column("x", entries.rowId)} LIMIT 1;
    IF FOUND THEN
      IF ${column("range_row", entries.tableId)} IS DISTINCT FROM p_range_tables[i] OR ${column("range_row", entries.keyCodecVersion)} IS DISTINCT FROM 1 OR
        ${column("range_row", entries.physicalSpecSha256)} IS DISTINCT FROM p_range_specs[i] OR octet_length(${column("range_row", entries.rowId)}) IS DISTINCT FROM 16 OR
        octet_length(${column("range_row", entries.encodedKey)}) NOT BETWEEN 1 AND ${sql.raw(String(MAX_ORDERED_INDEX_KEY_BYTES_V1))} THEN refusal := 'occEvidenceInvalid'; ${refusal} END IF;
      RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('phase', phase, 'reason', 'rangeConflict', 'ordinal', i-1,
        'actualSequence', ${column("range_row", entries.commitSeq)}::text, 'encodedKey', encode(${column("range_row", entries.encodedKey)}, 'hex'),
        'rowId', encode(${column("range_row", entries.rowId)}, 'hex'))::text;
    END IF;
  END LOOP; END IF;
  phase := 'relation';
  IF cardinality(p_relation_ids) > 0 THEN FOR i IN 1..cardinality(p_relation_ids) LOOP
    SELECT ${column("x", adjacency.lastChangedCommitSeq)} INTO version FROM ${table(adjacency)} x WHERE ${column("x", adjacency.scopeUuid)} = p_scope_uuid
      AND ${column("x", adjacency.edgeDefinitionId)} = p_relation_indexes[i] AND ${column("x", adjacency.direction)} = 'incoming'
      AND ${column("x", adjacency.endpointRowId)} = p_relation_ids[i];
    IF FOUND AND (version IS NULL OR version <= 0) THEN refusal := 'occEvidenceInvalid'; ${refusal} END IF;
    version := coalesce(version,0);
    IF version < p_relation_versions[i] OR version > p_last OR (version <> p_relation_versions[i] AND version <= p_snapshot) THEN refusal := 'occEvidenceInvalid'; ${refusal} END IF;
    IF version <> p_relation_versions[i] THEN actual_sequence := version; refusal := 'relationConflict'; ${refusal} END IF;
  END LOOP; END IF;
  phase := 'deadline'; i := 1; actual_sequence := NULL;
  database_now := to_timestamp(trunc(extract(epoch from clock_timestamp()) * 1000) / 1000);
  IF p_deadline <= database_now THEN kind := 'expired'; RETURN NEXT; RETURN; END IF;
  IF p_capture_snapshot THEN
    SELECT * INTO coverage FROM ${namespace}.fx_begin_app_materialization(p_scope, p_deadline, true);
    IF coverage.reason = 'expired' THEN kind := 'expired'; RETURN NEXT; RETURN; END IF;
    application_head := coverage.application_head; application_activation := coverage.application_activation;
    legacy_schema := coverage.legacy_schema; relation_schema := coverage.relation_schema;
  END IF;
  phase := 'original';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_changed[i] AND p_need_original[i] AND p_point_kinds[i] = 'present' AND p_original_sequences[i] IS NULL THEN refusal := 'priorDocumentInvalid'; ${refusal} END IF;
    IF p_changed[i] AND p_need_original[i] AND ${column("latest", rows.commitSeq)} IS NOT NULL AND NOT ${column("latest", rows.isTombstone)} THEN
      IF ${column("latest", rows.commitSeq)} IS DISTINCT FROM p_original_sequences[i] OR
        ${column("latest", rows.creationTime)} IS DISTINCT FROM p_original_times[i] OR
        ${column("latest", rows.scopeUuid)} IS DISTINCT FROM p_original_scopes[i] OR
        ${column("latest", rows.writeEpochUuid)} IS DISTINCT FROM p_original_epochs[i] OR
        ${column("latest", rows.prevCommitSeq)} IS DISTINCT FROM p_original_previous[i] OR
        ${column("latest", rows.schemaVersionId)} IS DISTINCT FROM p_original_schemas[i] OR
        ${column("latest", rows.valueCodecVersion)} IS DISTINCT FROM 1 OR
        original_lengths[i] IS DISTINCT FROM p_original_lengths[i] OR
        ${column("latest", rows.valueSha256)} IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; ${refusal} END IF;
      SELECT x.* INTO original FROM ${table(rows)} x WHERE ${column("x", rows.scopeUuid)} = p_scope_uuid
        AND ${column("x", rows.tableId)} = p_point_tables[i] AND ${column("x", rows.rowId)} = p_point_ids[i]
        AND ${column("x", rows.commitSeq)} = ${column("latest", rows.commitSeq)}
        AND octet_length(${column("x", rows.valueBytes)}) = p_original_lengths[i];
      IF NOT FOUND OR octet_length(${column("original", rows.valueBytes)}) IS DISTINCT FROM p_original_lengths[i] OR
        ${column("original", rows.valueCodecVersion)} IS DISTINCT FROM 1 OR
        ${column("original", rows.valueSha256)} IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; ${refusal} END IF;
      IF pg_catalog.sha256(${column("original", rows.valueBytes)}) IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; ${refusal} END IF;
    END IF;
  END LOOP; END IF;
  phase := 'developerTransition';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_indexes) > 0 THEN FOR i IN 1..cardinality(p_indexes) LOOP
    SELECT x.* INTO b FROM unnest(developer) x WHERE ${column("x", build.indexDefinitionId)} = p_indexes[i];
    IF NOT FOUND THEN refusal := 'developerIndexBuildInvalid'; ${refusal} END IF;
    attempts[i] := ${column("b", build.attemptFence)}; epochs[i] := ${column("b", build.epoch)}; fences[i] := ${column("b", build.storageGenerationFence)};
  END LOOP; END IF;
  FOR transition IN SELECT * FROM ${namespace}.fx_accept_app_index_transitions(p_scope, p_scope_uuid, p_indexes, p_access, p_tables, p_codecs,
    p_specs, p_ids, p_previous, p_previous_sha, p_final, p_final_sha, p_row_previous, attempts, epochs, fences, p_maximum) LOOP
    kind := 'transition'; transition_reason := transition.reason; pair_ordinal := transition.pair_ordinal; key_ordinal := transition.key_ordinal;
    transition_kind := transition.transition_kind; prior_commit_seq := transition.prior_commit_seq; prior_is_tombstone := transition.prior_is_tombstone;
    emitted_count := transition.emitted_count; RETURN NEXT;
  END LOOP;
  transition_reason := NULL; pair_ordinal := NULL; key_ordinal := NULL; transition_kind := NULL; prior_commit_seq := NULL; prior_is_tombstone := NULL; emitted_count := NULL;
  phase := 'uniqueOwner';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  SELECT owners INTO accepted_unique_owners FROM ${namespace}.fx_accept_app_unique_owners(p_unique_owners, p_unique_previous, p_unique_row_previous);
  IF p_stop = 'afterUniqueOwner' THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  phase := 'relationTarget';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_target_ids) > 0 THEN FOR i IN 1..cardinality(p_target_ids) LOOP
    SELECT c.${sql.identifier(current.commitSeq.name)} AS pointer, ${scalarRow("r")} AS revision INTO captured
      FROM (VALUES (1)) request(dummy) LEFT JOIN ${table(current)} c ON ${column("c", current.scopeUuid)} = p_scope_uuid
        AND ${column("c", current.tableId)} = p_target_tables[i] AND ${column("c", current.rowId)} = p_target_ids[i]
      LEFT JOIN ${table(rows)} r ON ${column("r", rows.scopeUuid)} = p_scope_uuid AND ${column("r", rows.tableId)} = p_target_tables[i]
        AND ${column("r", rows.rowId)} = p_target_ids[i] AND ${column("r", rows.commitSeq)} = ${column("c", current.commitSeq)};
    pointer_seq := captured.pointer; target := captured.revision;
    IF pointer_seq IS NULL AND ${column("target", rows.commitSeq)} IS NULL AND ${column("target", rows.isTombstone)} IS NULL THEN refusal := 'relationTargetMissing'; ${refusal} END IF;
    IF pointer_seq IS NULL OR ${column("target", rows.commitSeq)} IS NULL OR pointer_seq <> ${column("target", rows.commitSeq)} OR
      ${column("target", rows.commitSeq)} > p_last OR ${column("target", rows.isTombstone)} IS NULL THEN refusal := 'relationTargetEvidenceInvalid'; ${refusal} END IF;
    IF ${column("target", rows.isTombstone)} THEN refusal := 'relationTargetMissing'; ${refusal} END IF;
  END LOOP; END IF;
  phase := 'candidate';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF p_candidate THEN SELECT x.* INTO candidate_head FROM ${table(fxSystemAppSchemaCandidateValidations)} x
    WHERE ${column("x", fxSystemAppSchemaCandidateValidations.scopeId)} = p_scope FOR UPDATE; END IF;
  IF cardinality(heads) > 0 THEN FOR i IN 1..cardinality(heads) LOOP
    kind := 'head'; ordinal := i-1; latest := heads[i]; pointer_sequence := pointers[i]; latest_sequence := ${column("latest", rows.commitSeq)};
    latest_tombstone := ${column("latest", rows.isTombstone)}; latest_creation_time := ${column("latest", rows.creationTime)}; RETURN NEXT;
  END LOOP; END IF;
  ordinal := NULL; pointer_sequence := NULL; latest_sequence := NULL; latest_tombstone := NULL; latest_creation_time := NULL;
  IF cardinality(developer)>0 THEN FOR i IN 1..cardinality(developer) LOOP
    b:=developer[i];
    IF ${column("b",build.lifecycle)}='validating' THEN
      kind:='developerValidation'; ordinal:=i-1;
      validation_definition:=${column("b",build.indexDefinitionId)}; validation_attempt:=${column("b",build.attemptFence)};
      validation_epoch:=${column("b",build.epoch)}; validation_fence:=${column("b",build.storageGenerationFence)};
      RETURN NEXT;
    END IF;
  END LOOP; END IF;
  ordinal:=NULL; validation_definition:=NULL; validation_attempt:=NULL; validation_epoch:=NULL; validation_fence:=NULL;
  kind := 'accepted'; RETURN NEXT;
END;
$publication_acceptance$;`),
} as const;

const uniqueBuild = fxSystemUniqueConstraintBuilds;
const uniqueMaintenance = fxSystemUniqueMaintenanceObligations;
const indexCoverage = sql`${namespace}.fx_app_index_coverage`;
const uniqueCoverage = sql`${namespace}.fx_app_unique_coverage`;
const materializationInputs = [
  ["p_rows", "fx_app_row_write[]"], ["p_row_pages", "integer[]"], ["p_indexes", "fx_app_index_write[]"],
  ["p_index_prior", "bigint[]"], ["p_index_historical", "boolean[]"], ["p_unique_owners", "fx_app_unique_owner[]"],
  ["p_unique_previous", "fx_app_unique_write[]"], ["p_unique_next", "fx_app_unique_write[]"],
  ["p_validation", "fx_app_index_coverage[]"], ["p_index_coverage", "fx_app_index_coverage[]"], ["p_unique_coverage", "fx_app_unique_coverage[]"],
  ["p_seq", "bigint"], ["p_search_scope", "uuid"], ["p_search_tables", "integer[]"], ["p_search_indexes", "integer[]"],
  ["p_search_sources", "text[]"], ["p_search_modes", "boolean[]"], ["p_search_row_counts", "integer[]"], ["p_search_ids", "bytea[]"],
  ["p_search_text_counts", "integer[]"], ["p_search_text", "fx_app_search_write[]"], ["p_search_json_counts", "integer[]"], ["p_search_json", "fx_app_json_write[]"],
] as const;
const applicationInputs = [
  ["p_scope", "text"], ["p_generation", "text"], ["p_fence", "bigint"], ["p_epoch", "text"], ["p_last", "bigint"],
  ["p_deployment", "text"], ["p_schema", "text"], ["p_mixed", "boolean"], ["p_source_bound", "boolean"],
  ["p_active", "boolean"], ["p_active_deployment", "text"], ["p_active_schema", "text"], ["p_active_manifest", "bytea"],
  ["p_active_sequence", "bigint"], ["p_active_activation", "bytea"], ["p_active_head", "bytea"],
  ["p_build_ids", "integer[]"], ["p_build_tables", "integer[]"], ["p_build_specs", "bytea[]"], ["p_build_active", "boolean[]"],
  ["p_unique_ids", "integer[]"], ["p_unique_tables", "integer[]"], ["p_unique_specs", "bytea[]"], ["p_unique_active", "boolean[]"],
  ["p_unique_schemas", "text[]"], ["p_unique_deployments", "text[]"], ["p_defer", "boolean"],
  ["p_intrinsic_indexes", "integer[]"], ["p_intrinsic_access", "text[]"], ["p_intrinsic_tables", "integer[]"], ["p_intrinsic_codecs", "integer[]"],
  ["p_intrinsic_specs", "bytea[]"], ["p_intrinsic_ids", "bytea[]"], ["p_intrinsic_previous", "bytea[]"], ["p_intrinsic_previous_sha", "bytea[]"],
  ["p_intrinsic_final", "bytea[]"], ["p_intrinsic_final_sha", "bytea[]"], ["p_intrinsic_row_previous", "bigint[]"], ["p_stop", "text"],
  ...materializationInputs,
] as const;
const applicationOutputs = [["kind", "text"], ["coverage_ordinal", "integer"], ["coverage_definition", "integer"], ["coverage_attempt", "bigint"],
  ["coverage_epoch", "text"], ["coverage_fence", "bigint"], ["reason", "text"], ["row_count", "integer"], ["index_count", "integer"], ["unique_count", "integer"],
  ["validation_count", "integer"], ["coverage_count", "integer"], ["search_count", "integer"], ["search_build_count", "integer"],
  ["intrinsic_count", "integer"], ["intrinsic_live_count", "integer"], ["intrinsic_tombstone_count", "integer"],
  ["intrinsic_key_bytes", "integer"], ["index_coverage_count", "integer"], ["unique_coverage_count", "integer"]] as const;
const stage2Refusal = sql`RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;`;
const coverageTuple = (alias: string, target: typeof build | typeof uniqueBuild, family: "index" | "unique") => sql`row(
  ${column(alias,target.scopeId)}, ${column(alias, family === "index" ? build.indexDefinitionId : uniqueBuild.uniqueConstraintDefinitionId)},
  ${column(alias,target.attemptFence)}, ${column(alias,target.epoch)}, ${column(alias,target.storageGenerationFence)})::${family === "index" ? indexCoverage : uniqueCoverage}`;
const intrinsicIndexTuple = sql`row(${sql.join(Object.entries(getTableColumns(entries)).map(([key, target]) => {
  switch (key) {
    case "scopeUuid": return sql`p_search_scope`;
    case "indexDefinitionId": return sql`p_intrinsic_indexes[k]`;
    case "encodedKey": return sql`CASE WHEN t.key_ordinal=0 THEN p_intrinsic_previous[k] ELSE p_intrinsic_final[k] END`;
    case "rowId": return sql`p_intrinsic_ids[k]`;
    case "commitSeq": return sql`p_seq`;
    case "writeEpochUuid": return sql`(p_rows[row_ordinal]).${sql.identifier(rows.writeEpochUuid.name)}`;
    case "isTombstone": return sql`t.transition_kind='tombstone'`;
    case "tableId": return sql`p_intrinsic_tables[k]`;
    case "keyCodecVersion": return sql`p_intrinsic_codecs[k]`;
    case "physicalSpecSha256": return sql`p_intrinsic_specs[k]`;
    case "keySha256": return sql`CASE WHEN t.key_ordinal=0 THEN p_intrinsic_previous_sha[k] ELSE p_intrinsic_final_sha[k] END`;
    default: throw new Error(`Unclassified intrinsic materialization column ${target.name}`);
  }
}), sql`, `)})::${namespace}.fx_app_index_write`;

/** Selected coverage and intrinsic memberships stay at their accepting owner.
 * This procedure calls the existing write engine and its same-page/AFTER proofs. */
export const APP_PUBLICATION_APPLICATION_FUNCTION = {
  name: "fx_apply_app_publication", signature: applicationInputs.map(([, type]) => type).join(","),
  inputs: applicationInputs.map(([name]) => name), outputs: applicationOutputs.map(([name]) => name),
  outputTypes: applicationOutputs.map(([, type]) => type), delimiter: "$publication_application$",
  ddl: compile(sql`
CREATE FUNCTION ${namespace}.fx_apply_app_publication(${sql.join(applicationInputs.map(([name,type]) => parameter(name,type)),sql`, `)})
RETURNS TABLE(${sql.join(applicationOutputs.map(([name,type]) => parameter(name,type)),sql`, `)})
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $publication_application$
DECLARE i integer:=1; k integer; row_ordinal integer; phase text:='uniqueCoverage'; refusal text; frontier bigint; t record; proof record;
  inner_message text; inner_detail text; intrinsic_transitions jsonb:='[]'::jsonb;
  u ${table(uniqueBuild)}; um ${table(uniqueMaintenance)}; b ${table(build)}; m ${table(maintenance)};
  indices ${namespace}.fx_app_index_write[]:=ARRAY[]::${namespace}.fx_app_index_write[];
  priors bigint[]:=ARRAY[]::bigint[]; historical boolean[]:=ARRAY[]::boolean[];
  validations ${indexCoverage}[]:=ARRAY[]::${indexCoverage}[];
  index_coverage ${indexCoverage}[]:=ARRAY[]::${indexCoverage}[];
  unique_coverage ${uniqueCoverage}[]:=ARRAY[]::${uniqueCoverage}[];
  attempts bigint[]:=ARRAY[]::bigint[]; epochs text[]:=ARRAY[]::text[]; fences bigint[]:=ARRAY[]::bigint[];
BEGIN
  IF cardinality(p_unique_ids)>0 THEN
    IF p_source_bound THEN
      PERFORM 1 FROM ${table(uniqueBuild)} x WHERE ${column("x",uniqueBuild.scopeId)}=p_scope AND ${column("x",uniqueBuild.uniqueConstraintDefinitionId)}=ANY(p_unique_ids)
        ORDER BY ${column("x",uniqueBuild.uniqueConstraintDefinitionId)} FOR NO KEY UPDATE;
    ELSIF NOT p_active THEN
      PERFORM 1 FROM ${table(uniqueBuild)} x WHERE ${column("x",uniqueBuild.scopeId)}=p_scope AND ${column("x",uniqueBuild.uniqueConstraintDefinitionId)}=ANY(p_unique_ids)
        ORDER BY ${column("x",uniqueBuild.uniqueConstraintDefinitionId)} FOR UPDATE;
    ELSE
      PERFORM 1 FROM ${table(uniqueBuild)} x WHERE ${column("x",uniqueBuild.scopeId)}=p_scope AND ${column("x",uniqueBuild.uniqueConstraintDefinitionId)}=ANY(p_unique_ids)
        ORDER BY ${column("x",uniqueBuild.uniqueConstraintDefinitionId)} FOR SHARE;
    END IF;
    FOR i IN 1..cardinality(p_unique_ids) LOOP
      SELECT x.* INTO u FROM ${table(uniqueBuild)} x WHERE ${column("x",uniqueBuild.scopeId)}=p_scope AND ${column("x",uniqueBuild.uniqueConstraintDefinitionId)}=p_unique_ids[i];
      SELECT x.* INTO um FROM ${table(uniqueMaintenance)} x WHERE ${column("x",uniqueMaintenance.scopeId)}=p_scope
        AND ${column("x",uniqueMaintenance.uniqueConstraintDefinitionId)}=p_unique_ids[i] AND ${column("x",uniqueMaintenance.activationSequence)}=${column("u",uniqueBuild.maintenanceActivationSequence)};
      IF ${column("u",uniqueBuild.scopeId)} IS DISTINCT FROM p_scope OR ${column("u",uniqueBuild.uniqueConstraintDefinitionId)} IS DISTINCT FROM p_unique_ids[i] OR
        ${column("u",uniqueBuild.storageGeneration)} IS DISTINCT FROM p_generation OR ${column("u",uniqueBuild.storageGenerationFence)} IS DISTINCT FROM p_fence OR
        ${column("u",uniqueBuild.epoch)} IS DISTINCT FROM p_epoch OR ${column("u",uniqueBuild.lifecycle)} IS DISTINCT FROM 'enabled' OR
        ${column("u",uniqueBuild.cursorRowId)} IS NOT NULL OR ${column("u",uniqueBuild.startCommitSeq)} IS NULL OR ${column("u",uniqueBuild.startCommitSeq)}<0 OR
        ${column("u",uniqueBuild.coveredThroughCommitSeq)} IS NULL OR ${column("u",uniqueBuild.coveredThroughCommitSeq)}<${column("u",uniqueBuild.startCommitSeq)} OR
        ${column("u",uniqueBuild.coveredThroughCommitSeq)}>p_last OR ${column("u",uniqueBuild.startCommitSeq)}>p_last OR
        ${column("u",uniqueBuild.attemptFence)} IS NULL OR ${column("u",uniqueBuild.attemptFence)}<=0 OR
        ${column("u",uniqueBuild.createdAt)} IS NULL OR ${column("u",uniqueBuild.updatedAt)} IS NULL OR
        NOT isfinite(${column("u",uniqueBuild.createdAt)}) OR NOT isfinite(${column("u",uniqueBuild.updatedAt)}) OR
        abs(extract(epoch FROM ${column("u",uniqueBuild.createdAt)})*1000)>8640000000000000 OR abs(extract(epoch FROM ${column("u",uniqueBuild.updatedAt)})*1000)>8640000000000000 OR
        date_trunc('milliseconds',${column("u",uniqueBuild.updatedAt)})<date_trunc('milliseconds',${column("u",uniqueBuild.createdAt)}) OR
        ((${column("u",uniqueBuild.maintenanceActivationSequence)} IS NULL)<>(${column("um",uniqueMaintenance.activationSequence)} IS NULL)) THEN
        refusal:='uniqueBuildInvalid'; ${stage2Refusal}
      END IF;
      IF (p_unique_active[i] AND p_active AND ${column("um",uniqueMaintenance.activationSequence)} IS NULL) OR
        (NOT p_unique_active[i] AND ${column("um",uniqueMaintenance.activationSequence)} IS NOT NULL) OR
        (p_mixed AND p_unique_active[i] AND NOT p_active) THEN refusal:='uniqueCoverageMissing'; ${stage2Refusal} END IF;
      IF ${column("um",uniqueMaintenance.activationSequence)} IS NOT NULL THEN
        IF ${column("um",uniqueMaintenance.activationSequence)}<=0 OR ${column("um",uniqueMaintenance.scopeId)} IS DISTINCT FROM p_scope OR
          ${column("um",uniqueMaintenance.uniqueConstraintDefinitionId)} IS DISTINCT FROM p_unique_ids[i] OR
          ${column("um",uniqueMaintenance.storageGeneration)} IS DISTINCT FROM p_generation OR ${column("um",uniqueMaintenance.storageGenerationFence)} IS DISTINCT FROM p_fence OR
          ${column("um",uniqueMaintenance.epoch)} IS DISTINCT FROM p_epoch OR ${column("um",uniqueMaintenance.attemptFence)} IS DISTINCT FROM ${column("u",uniqueBuild.attemptFence)} OR
          ${column("um",uniqueMaintenance.startCommitSeq)} IS DISTINCT FROM ${column("u",uniqueBuild.startCommitSeq)} OR
          ${column("um",uniqueMaintenance.openedCommitSeq)} IS DISTINCT FROM ${column("u",uniqueBuild.coveredThroughCommitSeq)} OR
          ${column("um",uniqueMaintenance.tableId)} IS DISTINCT FROM p_unique_tables[i] OR ${column("um",uniqueMaintenance.physicalSpecSha256)} IS DISTINCT FROM p_unique_specs[i] OR
          ${column("um",uniqueMaintenance.deploymentId)} IS DISTINCT FROM p_unique_deployments[i] OR
          ${column("um",uniqueMaintenance.schemaVersionId)} IS DISTINCT FROM (CASE WHEN p_mixed AND p_unique_active[i] THEN p_active_schema ELSE p_unique_schemas[i] END) OR
          NOT p_active OR ${column("um",uniqueMaintenance.deploymentId)} IS DISTINCT FROM p_active_deployment OR
          ${column("um",uniqueMaintenance.schemaVersionId)} IS DISTINCT FROM p_active_schema OR
          ${column("um",uniqueMaintenance.activationSequence)} IS DISTINCT FROM p_active_sequence OR
          ${column("um",uniqueMaintenance.activationSha256)} IS DISTINCT FROM p_active_activation OR ${column("um",uniqueMaintenance.headSha256)} IS DISTINCT FROM p_active_head THEN
          refusal:='uniqueBuildInvalid'; ${stage2Refusal}
        END IF;
      ELSIF ${column("u",uniqueBuild.coveredThroughCommitSeq)}<p_last THEN
        SELECT ${column("x",current.commitSeq)} INTO frontier FROM ${table(current)} x WHERE ${column("x",current.scopeUuid)}=p_search_scope AND ${column("x",current.tableId)}=p_unique_tables[i]
          ORDER BY ${column("x",current.commitSeq)} DESC LIMIT 1;
        IF FOUND AND (frontier IS NULL OR frontier<=0) THEN refusal:='uniqueBuildInvalid'; ${stage2Refusal} END IF;
        IF frontier>${column("u",uniqueBuild.coveredThroughCommitSeq)} THEN refusal:='uniqueCoverageMissing'; ${stage2Refusal} END IF;
        IF p_defer AND NOT p_unique_active[i] THEN
          PERFORM * FROM ${namespace}.fx_advance_app_coverage(ARRAY[]::${indexCoverage}[],ARRAY[${coverageTuple("u",uniqueBuild,"unique")}],p_last,NULL,false,
            ARRAY[]::${indexCoverage}[],ARRAY[]::${uniqueCoverage}[],ARRAY[]::text[],ARRAY[]::text[]);
        END IF;
      END IF;
      IF ${column("um",uniqueMaintenance.activationSequence)} IS NULL THEN unique_coverage:=array_append(unique_coverage,${coverageTuple("u",uniqueBuild,"unique")}); END IF;
    END LOOP;
  END IF;
  phase:='indexCoverage';
  IF cardinality(p_build_ids)>0 THEN FOR i IN 1..cardinality(p_build_ids) LOOP
    SELECT x.* INTO b FROM ${table(build)} x WHERE ${column("x",build.scopeId)}=p_scope AND ${column("x",build.indexDefinitionId)}=p_build_ids[i];
    SELECT x.* INTO m FROM ${table(maintenance)} x WHERE ${column("x",maintenance.scopeId)}=p_scope AND ${column("x",maintenance.indexDefinitionId)}=p_build_ids[i]
      AND ${column("x",maintenance.activationSequence)}=${column("b",build.maintenanceActivationSequence)};
    IF (p_build_active[i] AND p_active AND (${column("b",build.lifecycle)} IS DISTINCT FROM 'enabled' OR ${column("m",maintenance.activationSequence)} IS NULL)) OR
      (NOT p_build_active[i] AND (${column("b",build.lifecycle)} IS DISTINCT FROM 'enabled' OR ${column("m",maintenance.activationSequence)} IS NOT NULL)) OR
      (p_mixed AND p_build_active[i] AND NOT p_active) THEN refusal:='indexCoverageMissing'; ${stage2Refusal} END IF;
    IF ${column("m",maintenance.activationSequence)} IS NOT NULL THEN
      IF ${column("m",maintenance.schemaVersionId)} IS DISTINCT FROM (CASE WHEN p_mixed AND p_build_active[i] THEN p_active_schema ELSE p_schema END) OR
        ${column("m",maintenance.deploymentId)} IS DISTINCT FROM p_deployment OR ${column("m",maintenance.physicalSpecSha256)} IS DISTINCT FROM p_build_specs[i] THEN
        refusal:='indexBuildInvalid'; ${stage2Refusal}
      END IF;
    END IF;
    IF ${column("b",build.lifecycle)}='enabled' THEN
      IF ${column("b",build.coveredThroughCommitSeq)} IS NULL OR ${column("b",build.firstReadableCommitSeq)} IS NULL OR ${column("b",build.firstReadableCommitSeq)}>p_last THEN
        refusal:='indexCoverageMissing'; ${stage2Refusal} END IF;
      IF ${column("m",maintenance.activationSequence)} IS NOT NULL THEN
        IF ${column("m",maintenance.tableId)} IS DISTINCT FROM p_build_tables[i] OR NOT p_active OR
          ${column("m",maintenance.deploymentId)} IS DISTINCT FROM p_active_deployment OR ${column("m",maintenance.schemaVersionId)} IS DISTINCT FROM p_active_schema OR
          ${column("m",maintenance.schemaManifestSha256)} IS DISTINCT FROM p_active_manifest OR ${column("m",maintenance.activationSequence)} IS DISTINCT FROM p_active_sequence OR
          ${column("m",maintenance.activationSha256)} IS DISTINCT FROM p_active_activation OR ${column("m",maintenance.headSha256)} IS DISTINCT FROM p_active_head THEN
          refusal:='indexBuildInvalid'; ${stage2Refusal} END IF;
      ELSIF ${column("b",build.coveredThroughCommitSeq)}<p_last THEN
        SELECT ${column("x",current.commitSeq)} INTO frontier FROM ${table(current)} x WHERE ${column("x",current.scopeUuid)}=p_search_scope AND ${column("x",current.tableId)}=p_build_tables[i]
          ORDER BY ${column("x",current.commitSeq)} DESC LIMIT 1;
        IF FOUND AND (frontier IS NULL OR frontier<=0) THEN refusal:='indexBuildInvalid'; ${stage2Refusal} END IF;
        IF frontier>${column("b",build.coveredThroughCommitSeq)} THEN refusal:='indexCoverageMissing'; ${stage2Refusal} END IF;
        IF p_defer AND NOT p_build_active[i] THEN
          PERFORM * FROM ${namespace}.fx_advance_app_coverage(ARRAY[${coverageTuple("b",build,"index")}],ARRAY[]::${uniqueCoverage}[],p_last,${column("b",build.coveredThroughCommitSeq)},true,
            ARRAY[]::${indexCoverage}[],ARRAY[]::${uniqueCoverage}[],ARRAY[]::text[],ARRAY[]::text[]);
        END IF;
      END IF;
      IF ${column("m",maintenance.activationSequence)} IS NULL THEN index_coverage:=array_append(index_coverage,${coverageTuple("b",build,"index")}); END IF;
    ELSIF ${column("b",build.lifecycle)}='validating' AND p_build_ids[i]=ANY(p_intrinsic_indexes) THEN
      validations:=array_append(validations,${coverageTuple("b",build,"index")});
    END IF;
  END LOOP; END IF;
  phase:='intrinsic';
  IF p_stop=phase THEN kind:='terminal'; reason:='stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_intrinsic_indexes)>0 THEN FOR i IN 1..cardinality(p_intrinsic_indexes) LOOP
    SELECT x.* INTO b FROM ${table(build)} x WHERE ${column("x",build.scopeId)}=p_scope AND ${column("x",build.indexDefinitionId)}=p_intrinsic_indexes[i];
    attempts[i]:=${column("b",build.attemptFence)}; epochs[i]:=${column("b",build.epoch)}; fences[i]:=${column("b",build.storageGenerationFence)};
  END LOOP; END IF;
  intrinsic_count:=0; intrinsic_live_count:=0; intrinsic_tombstone_count:=0; intrinsic_key_bytes:=0;
  FOR t IN SELECT * FROM ${namespace}.fx_accept_app_index_transitions(p_scope,p_search_scope,p_intrinsic_indexes,p_intrinsic_access,p_intrinsic_tables,
    p_intrinsic_codecs,p_intrinsic_specs,p_intrinsic_ids,p_intrinsic_previous,p_intrinsic_previous_sha,p_intrinsic_final,p_intrinsic_final_sha,
    p_intrinsic_row_previous,attempts,epochs,fences,cardinality(p_intrinsic_indexes)) LOOP
    IF t.reason='transition' THEN
      k:=t.pair_ordinal+1;
      SELECT x.ordinality::integer INTO row_ordinal FROM unnest(p_rows) WITH ORDINALITY x WHERE x.${sql.identifier(rows.tableId.name)}=p_intrinsic_tables[k]
        AND x.${sql.identifier(rows.rowId.name)}=p_intrinsic_ids[k];
      IF p_stop IS DISTINCT FROM 'row' THEN
        IF row_ordinal IS NULL THEN refusal:='intrinsicTransitionInvalid'; i:=k; ${stage2Refusal} END IF;
        indices:=array_append(indices,${intrinsicIndexTuple}); priors:=array_append(priors,t.prior_commit_seq); historical:=array_append(historical,false);
      END IF;
      intrinsic_count:=intrinsic_count+1;
      IF t.transition_kind='live' THEN intrinsic_live_count:=intrinsic_live_count+1;
      ELSE intrinsic_tombstone_count:=intrinsic_tombstone_count+1; END IF;
      intrinsic_key_bytes:=intrinsic_key_bytes+octet_length(CASE WHEN t.key_ordinal=0 THEN p_intrinsic_previous[k] ELSE p_intrinsic_final[k] END);
      intrinsic_transitions:=intrinsic_transitions||jsonb_build_array(jsonb_build_object('pairOrdinal',t.pair_ordinal,'keyOrdinal',t.key_ordinal,'kind',t.transition_kind));
    END IF;
  END LOOP;
  IF p_stop='row' THEN kind:='terminal'; reason:='stopped'; RETURN NEXT; RETURN; END IF;
  BEGIN
    SELECT * INTO proof FROM ${namespace}.fx_apply_app_materialization(p_rows,p_row_pages,
    CASE WHEN p_stop='index' THEN ARRAY[]::${namespace}.fx_app_index_write[] ELSE indices||p_indexes END,
    CASE WHEN p_stop='index' THEN ARRAY[]::bigint[] ELSE priors||p_index_prior END,
    CASE WHEN p_stop='index' THEN ARRAY[]::boolean[] ELSE historical||p_index_historical END,
    p_unique_owners,p_unique_previous,p_unique_next,CASE WHEN p_stop='index' THEN ARRAY[]::${indexCoverage}[] ELSE validations END,
    CASE WHEN p_defer OR p_stop IN ('index','unique') THEN ARRAY[]::${indexCoverage}[] ELSE index_coverage END,
    CASE WHEN p_defer OR p_stop IN ('index','unique') THEN ARRAY[]::${uniqueCoverage}[] ELSE unique_coverage END,
    p_seq,p_search_scope,p_search_tables,p_search_indexes,p_search_sources,p_search_modes,p_search_row_counts,p_search_ids,
    p_search_text_counts,p_search_text,p_search_json_counts,p_search_json);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message=MESSAGE_TEXT,inner_detail=PG_EXCEPTION_DETAIL;
    IF inner_message='fx_apply_app_materialization' THEN
      RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',DETAIL=jsonb_build_object('phase','materialization',
        'detail',inner_detail,'intrinsicTransitions',intrinsic_transitions)::text;
    END IF;
    RAISE;
  END;
  reason:=CASE WHEN p_stop IS NULL THEN 'accepted' ELSE 'stopped' END;
  row_count:=proof.row_count; index_count:=proof.index_count; unique_count:=proof.unique_count; validation_count:=proof.validation_count;
  coverage_count:=proof.coverage_count; search_count:=proof.search_count; search_build_count:=proof.search_build_count;
  index_coverage_count:=CASE WHEN p_defer OR p_stop IN ('index','unique') THEN 0 ELSE cardinality(index_coverage) END;
  unique_coverage_count:=CASE WHEN p_defer OR p_stop IN ('index','unique') THEN 0 ELSE cardinality(unique_coverage) END;
  IF p_defer THEN
    IF cardinality(index_coverage)>0 THEN FOR i IN 1..cardinality(index_coverage) LOOP
      kind:='indexCoverage'; coverage_ordinal:=i-1; coverage_definition:=(index_coverage[i]).${sql.identifier(build.indexDefinitionId.name)};
      coverage_attempt:=(index_coverage[i]).${sql.identifier(build.attemptFence.name)}; coverage_epoch:=(index_coverage[i]).${sql.identifier(build.epoch.name)};
      coverage_fence:=(index_coverage[i]).${sql.identifier(build.storageGenerationFence.name)}; RETURN NEXT;
    END LOOP; END IF;
    IF cardinality(unique_coverage)>0 THEN FOR i IN 1..cardinality(unique_coverage) LOOP
      kind:='uniqueCoverage'; coverage_ordinal:=i-1; coverage_definition:=(unique_coverage[i]).${sql.identifier(uniqueBuild.uniqueConstraintDefinitionId.name)};
      coverage_attempt:=(unique_coverage[i]).${sql.identifier(uniqueBuild.attemptFence.name)}; coverage_epoch:=(unique_coverage[i]).${sql.identifier(uniqueBuild.epoch.name)};
      coverage_fence:=(unique_coverage[i]).${sql.identifier(uniqueBuild.storageGenerationFence.name)}; RETURN NEXT;
    END LOOP; END IF;
  END IF;
  kind:='terminal'; coverage_ordinal:=NULL; coverage_definition:=NULL; coverage_attempt:=NULL; coverage_epoch:=NULL; coverage_fence:=NULL;
  RETURN NEXT;
END;
$publication_application$;`),
} as const;

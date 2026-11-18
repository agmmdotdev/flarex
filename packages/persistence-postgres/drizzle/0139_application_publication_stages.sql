-- Replace private accepting proof topology under the real maintenance interlock.
-- Borrowing transactions drain before this routine/type cutover. Populated
-- application rows, history, sessions, journals and durable outcomes are retained.
DO $gate$
DECLARE gate fx_system_installation;
BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id=1;
  IF NOT pg_try_advisory_xact_lock(2147483002,(gate.namespace_oid-2147483648)::integer) THEN
    RAISE EXCEPTION 'publication stage migration requires installation quiescence' USING ERRCODE='55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state='draining' AND gate.maintenance_pid=pg_backend_pid()
    AND gate.maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid())) THEN
    RAISE EXCEPTION 'publication stage migration requires its managed maintenance owner' USING ERRCODE='55000';
  END IF;
END;
$gate$;

--> statement-breakpoint
-- BEGIN schema-derived journal insertion constraint
DO $journal_point$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($constraint$ALTER TABLE %1$I."fx_system_tx_journal_point"
  DROP CONSTRAINT "fx_system_tx_journal_point_dependency_check",
  ADD CONSTRAINT "fx_system_tx_journal_point_dependency_check" CHECK (
        (
          "fx_system_tx_journal_point"."dependency_kind" = 'present'
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" is not null
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" >= 1
        )
        or (
          "fx_system_tx_journal_point"."dependency_kind" = 'missing_no_visible_revision'
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" is null
        )
        or (
          "fx_system_tx_journal_point"."dependency_kind" = 'missing_tombstone'
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" is not null
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" >= 1
        )
        or (
          "fx_system_tx_journal_point"."dependency_kind" = 'generated_insertion'
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" is null
        )
      )$constraint$,target_schema);
END;
$journal_point$;
-- END schema-derived journal insertion constraint
--> statement-breakpoint
DO $publication$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format('DROP FUNCTION IF EXISTS %I.fx_observe_app_developer_heads(text,uuid,integer[],integer[],bytea[],integer[])',target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_accept_app_publication("p_scope" text, "p_scope_uuid" uuid, "p_generation" text, "p_fence" bigint, "p_epoch" text, "p_last" bigint, "p_snapshot" bigint, "p_oldest" bigint, "p_deadline" timestamptz, "p_capture_snapshot" boolean, "p_original_build_locks" boolean, "p_intrinsic" integer[], "p_developer" integer[], "p_developer_access" text[], "p_point_tables" integer[], "p_point_ids" bytea[], "p_point_kinds" text[], "p_point_sequences" bigint[], "p_point_snapshots" bigint[], "p_changed" boolean[], "p_need_original" boolean[], "p_original_sequences" bigint[], "p_original_scopes" uuid[], "p_original_epochs" uuid[], "p_original_previous" bigint[], "p_original_schemas" text[], "p_original_lengths" integer[], "p_original_digests" bytea[], "p_original_times" double precision[], "p_range_indexes" integer[], "p_range_tables" integer[], "p_range_specs" bytea[], "p_range_lower" bytea[], "p_range_upper_kinds" text[], "p_range_upper" bytea[], "p_range_upper_ids" bytea[], "p_relation_indexes" integer[], "p_relation_ids" bytea[], "p_relation_versions" bigint[], "p_indexes" integer[], "p_access" text[], "p_tables" integer[], "p_codecs" integer[], "p_specs" bytea[], "p_ids" bytea[], "p_previous" bytea[], "p_previous_sha" bytea[], "p_final" bytea[], "p_final_sha" bytea[], "p_row_previous" bigint[], "p_maximum" integer, "p_unique_owners" %1$I.fx_app_unique_owner[], "p_unique_previous" bytea[], "p_unique_row_previous" bigint[], "p_target_tables" integer[], "p_target_ids" bytea[], "p_candidate" boolean, "p_stop" text)
RETURNS TABLE("kind" text, "ordinal" integer, "pointer_sequence" bigint, "latest_sequence" bigint, "latest_tombstone" boolean, "latest_creation_time" double precision, "transition_reason" text, "pair_ordinal" integer, "key_ordinal" integer, "transition_kind" text, "prior_commit_seq" bigint, "prior_is_tombstone" boolean, "emitted_count" integer, "accepted_unique_owners" integer, "validation_definition" integer, "validation_attempt" bigint, "validation_epoch" text, "validation_fence" bigint, "database_now" timestamptz, "candidate_head" %1$I.fx_system_app_schema_candidate_validation, "application_head" %1$I.fx_system_application_active_head, "application_activation" %1$I.fx_system_application_activation, "legacy_schema" %1$I.fx_system_application_revision_schema_v1, "relation_schema" %1$I.fx_system_application_revision_schema)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_acceptance$
DECLARE i integer := 1; j integer; phase text := 'intrinsicBuild'; refusal text; selected_id integer; actual_sequence bigint;
  b %1$I."fx_system_index_build_state"; m %1$I."fx_system_index_maintenance_obligation"; latest %1$I."fx_app_row_rev"; pointer_seq bigint; captured record; transition record; coverage record;
  intrinsic %1$I."fx_system_index_build_state"[] := ARRAY[]::%1$I."fx_system_index_build_state"[]; developer %1$I."fx_system_index_build_state"[] := ARRAY[]::%1$I."fx_system_index_build_state"[];
  intrinsic_maintenance %1$I."fx_system_index_maintenance_obligation"[] := ARRAY[]::%1$I."fx_system_index_maintenance_obligation"[];
  developer_maintenance %1$I."fx_system_index_maintenance_obligation"[] := ARRAY[]::%1$I."fx_system_index_maintenance_obligation"[];
  heads %1$I."fx_app_row_rev"[] := ARRAY[]::%1$I."fx_app_row_rev"[]; pointers bigint[] := ARRAY[]::bigint[]; original_lengths integer[] := ARRAY[]::integer[];
  attempts bigint[] := ARRAY[]::bigint[]; epochs text[] := ARRAY[]::text[]; fences bigint[] := ARRAY[]::bigint[];
  range_row %1$I."fx_app_index_entry_rev"; version bigint; target %1$I."fx_app_row_rev"; original %1$I."fx_app_row_rev"; first_point_conflict integer;
BEGIN
  IF p_scope IS NULL OR length(p_scope) = 0 OR p_generation IS DISTINCT FROM 'flarexdb_v1' OR p_fence IS NULL OR p_fence <= 0 OR
    p_epoch IS NULL OR length(p_epoch) = 0 OR p_last IS NULL OR p_last < 0 OR p_scope_uuid IS NULL THEN
    refusal := 'invalidAuthority'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
  END IF;
  IF cardinality(p_intrinsic) <> (SELECT count(DISTINCT value) FROM unnest(p_intrinsic) value) THEN
    refusal := 'intrinsicIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
  END IF;
  IF cardinality(p_intrinsic) > 0 THEN FOR j IN 0..(cardinality(p_intrinsic)-1)/32 LOOP
    IF NOT p_original_build_locks THEN PERFORM 1 FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope
      AND x."index_definition_id" = ANY(p_intrinsic[j*32+1:least((j+1)*32,cardinality(p_intrinsic))])
      ORDER BY array_position(p_intrinsic, x."index_definition_id") FOR SHARE; END IF;
    FOR i IN j*32+1..least((j+1)*32,cardinality(p_intrinsic)) LOOP
      selected_id := p_intrinsic[i];
      SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope AND x."index_definition_id" = selected_id;
      SELECT x.* INTO m FROM %1$I."fx_system_index_maintenance_obligation" x WHERE x."scope_id" = p_scope
        AND x."index_definition_id" = selected_id AND x."activation_sequence" = b."maintenance_activation_sequence";
      IF (
  b."scope_id" IS DISTINCT FROM p_scope OR
  b."index_definition_id" IS DISTINCT FROM selected_id OR
  b."storage_generation" IS DISTINCT FROM p_generation OR
  b."storage_generation_fence" IS DISTINCT FROM p_fence OR
  b."epoch" IS DISTINCT FROM p_epoch OR
  b."start_commit_seq" IS NULL OR b."start_commit_seq" < 0 OR
  b."start_commit_seq" > p_last OR
  (b."covered_through_commit_seq" IS NOT NULL AND
    (b."covered_through_commit_seq" < 0 OR b."covered_through_commit_seq" > p_last)) OR
  (b."first_readable_commit_seq" IS NOT NULL AND
    (b."first_readable_commit_seq" < 0 OR b."covered_through_commit_seq" IS NULL OR
      b."first_readable_commit_seq" > b."covered_through_commit_seq")) OR
  b."lifecycle" IS NULL OR
  b."lifecycle" NOT IN ('declared','building','backfilling','validating','enabled') OR
  b."cursor_codec_version" IS DISTINCT FROM 1 OR
  (b."backfill_cursor_row_id" IS NOT NULL AND
    (octet_length(b."backfill_cursor_row_id") <> 16 OR b."lifecycle" IN ('declared','building'))) OR
  b."attempt_fence" IS NULL OR b."attempt_fence" <= 0 OR
  b."created_at" IS NULL OR b."updated_at" IS NULL OR
  NOT isfinite(b."created_at") OR NOT isfinite(b."updated_at") OR
  abs(extract(epoch FROM b."created_at") * 1000) > 8640000000000000 OR
  abs(extract(epoch FROM b."updated_at") * 1000) > 8640000000000000 OR
  date_trunc('milliseconds', b."updated_at") < date_trunc('milliseconds', b."created_at") OR
  ((b."maintenance_activation_sequence" IS NULL) <> (m."activation_sequence" IS NULL))) OR (m."activation_sequence" IS NOT NULL AND (
  b."lifecycle" IS DISTINCT FROM 'enabled' OR
  m."activation_sequence" <= 0 OR
  m."scope_id" IS DISTINCT FROM b."scope_id" OR
  m."index_definition_id" IS DISTINCT FROM b."index_definition_id" OR
  m."storage_generation" IS DISTINCT FROM b."storage_generation" OR
  m."storage_generation_fence" IS DISTINCT FROM b."storage_generation_fence" OR
  m."epoch" IS DISTINCT FROM b."epoch" OR
  m."attempt_fence" IS DISTINCT FROM b."attempt_fence" OR
  m."first_readable_commit_seq" IS NULL OR m."first_readable_commit_seq" < 0 OR
  m."opened_commit_seq" IS NULL OR m."opened_commit_seq" < m."first_readable_commit_seq" OR
  m."first_readable_commit_seq" IS DISTINCT FROM b."first_readable_commit_seq" OR
  m."opened_commit_seq" IS DISTINCT FROM b."covered_through_commit_seq" OR
  m."table_id" IS NULL OR m."table_id" < 1 OR
  m."deployment_id" IS NULL OR length(m."deployment_id") = 0 OR
  m."schema_version_id" IS NULL OR length(m."schema_version_id") = 0 OR
  octet_length(m."physical_spec_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."schema_manifest_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."activation_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."head_sha256") IS DISTINCT FROM 32)) THEN refusal := 'intrinsicIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
      intrinsic[i] := b; intrinsic_maintenance[i] := m;
    END LOOP;
  END LOOP; END IF;
  phase := 'developerBuild'; i := 1;
  IF NOT p_original_build_locks THEN PERFORM 1 FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope AND x."index_definition_id" = ANY(p_developer)
    ORDER BY x."index_definition_id" FOR SHARE; END IF;
  IF cardinality(p_developer) <> (SELECT count(DISTINCT value) FROM unnest(p_developer) value) THEN
    refusal := 'developerIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
  END IF;
  IF cardinality(p_developer) > 0 THEN FOR i IN 1..cardinality(p_developer) LOOP
    selected_id := p_developer[i];
    SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope AND x."index_definition_id" = selected_id;
    SELECT x.* INTO m FROM %1$I."fx_system_index_maintenance_obligation" x WHERE x."scope_id" = p_scope
      AND x."index_definition_id" = selected_id AND x."activation_sequence" = b."maintenance_activation_sequence";
    IF p_developer_access[i] IS DISTINCT FROM 'developer' OR (
  b."scope_id" IS DISTINCT FROM p_scope OR
  b."index_definition_id" IS DISTINCT FROM selected_id OR
  b."storage_generation" IS DISTINCT FROM p_generation OR
  b."storage_generation_fence" IS DISTINCT FROM p_fence OR
  b."epoch" IS DISTINCT FROM p_epoch OR
  b."start_commit_seq" IS NULL OR b."start_commit_seq" < 0 OR
  b."start_commit_seq" > p_last OR
  (b."covered_through_commit_seq" IS NOT NULL AND
    (b."covered_through_commit_seq" < 0 OR b."covered_through_commit_seq" > p_last)) OR
  (b."first_readable_commit_seq" IS NOT NULL AND
    (b."first_readable_commit_seq" < 0 OR b."covered_through_commit_seq" IS NULL OR
      b."first_readable_commit_seq" > b."covered_through_commit_seq")) OR
  b."lifecycle" IS NULL OR
  b."lifecycle" NOT IN ('declared','building','backfilling','validating','enabled') OR
  b."cursor_codec_version" IS DISTINCT FROM 1 OR
  (b."backfill_cursor_row_id" IS NOT NULL AND
    (octet_length(b."backfill_cursor_row_id") <> 16 OR b."lifecycle" IN ('declared','building'))) OR
  b."attempt_fence" IS NULL OR b."attempt_fence" <= 0 OR
  b."created_at" IS NULL OR b."updated_at" IS NULL OR
  NOT isfinite(b."created_at") OR NOT isfinite(b."updated_at") OR
  abs(extract(epoch FROM b."created_at") * 1000) > 8640000000000000 OR
  abs(extract(epoch FROM b."updated_at") * 1000) > 8640000000000000 OR
  date_trunc('milliseconds', b."updated_at") < date_trunc('milliseconds', b."created_at") OR
  ((b."maintenance_activation_sequence" IS NULL) <> (m."activation_sequence" IS NULL))) OR (m."activation_sequence" IS NOT NULL AND (
  b."lifecycle" IS DISTINCT FROM 'enabled' OR
  m."activation_sequence" <= 0 OR
  m."scope_id" IS DISTINCT FROM b."scope_id" OR
  m."index_definition_id" IS DISTINCT FROM b."index_definition_id" OR
  m."storage_generation" IS DISTINCT FROM b."storage_generation" OR
  m."storage_generation_fence" IS DISTINCT FROM b."storage_generation_fence" OR
  m."epoch" IS DISTINCT FROM b."epoch" OR
  m."attempt_fence" IS DISTINCT FROM b."attempt_fence" OR
  m."first_readable_commit_seq" IS NULL OR m."first_readable_commit_seq" < 0 OR
  m."opened_commit_seq" IS NULL OR m."opened_commit_seq" < m."first_readable_commit_seq" OR
  m."first_readable_commit_seq" IS DISTINCT FROM b."first_readable_commit_seq" OR
  m."opened_commit_seq" IS DISTINCT FROM b."covered_through_commit_seq" OR
  m."table_id" IS NULL OR m."table_id" < 1 OR
  m."deployment_id" IS NULL OR length(m."deployment_id") = 0 OR
  m."schema_version_id" IS NULL OR length(m."schema_version_id") = 0 OR
  octet_length(m."physical_spec_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."schema_manifest_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."activation_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."head_sha256") IS DISTINCT FROM 32)) THEN refusal := 'developerIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    developer[i] := b; developer_maintenance[i] := m;
  END LOOP; END IF;
  phase := 'point'; actual_sequence := NULL;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    SELECT c."commit_seq" AS pointer, row(r."scope_uuid", r."table_id", r."row_id", r."commit_seq", r."prev_commit_seq", r."write_epoch_uuid", r."schema_version_id", r."creation_time", r."value_codec_version", r."is_tombstone", NULL::bytea, r."value_sha256")::%1$I."fx_app_row_rev" AS revision, octet_length(r.value_bytes) AS byte_length INTO captured
      FROM (VALUES (1)) request(dummy) LEFT JOIN %1$I."fx_app_row_current" c ON c."scope_uuid" = p_scope_uuid
        AND c."table_id" = p_point_tables[i] AND c."row_id" = p_point_ids[i]
      LEFT JOIN LATERAL (SELECT x.* FROM %1$I."fx_app_row_rev" x WHERE x."scope_uuid" = p_scope_uuid
        AND x."table_id" = p_point_tables[i] AND x."row_id" = p_point_ids[i]
        ORDER BY x."commit_seq" DESC LIMIT 1) r ON true;
    pointer_seq := captured.pointer; latest := captured.revision;
    original_lengths[i] := captured.byte_length;
    heads[i] := latest; pointers[i] := pointer_seq;
    IF pointer_seq IS DISTINCT FROM latest."commit_seq" OR
      (latest."commit_seq" IS NOT NULL AND (latest."commit_seq" <= 0 OR latest."commit_seq" > p_last OR
        latest."is_tombstone" IS NULL OR latest."creation_time" IS NULL OR
        latest."creation_time" <= 0 OR latest."creation_time" > 9007199254740991)) THEN
      refusal := 'rowHeadInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
    END IF;
  END LOOP; END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_point_snapshots[i] IS NULL OR p_point_snapshots[i] < 0 OR p_point_snapshots[i] > p_last OR
      p_point_kinds[i] IS NULL OR p_point_kinds[i] NOT IN ('present','tombstone','noVisibleRevision','generatedInsertion','noVisibleRevisionInsertion') OR
      (p_point_kinds[i] IN ('present','tombstone') AND (p_point_sequences[i] IS NULL OR p_point_sequences[i] <= 0 OR p_point_sequences[i] > p_point_snapshots[i])) OR
      (p_point_kinds[i] IN ('noVisibleRevision','generatedInsertion','noVisibleRevisionInsertion') AND p_point_sequences[i] IS NOT NULL) THEN
      refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
    END IF;
    IF p_point_kinds[i] = 'generatedInsertion' THEN CONTINUE; END IF;
    IF latest."commit_seq" > p_point_snapshots[i] THEN
      IF actual_sequence IS NULL THEN actual_sequence := latest."commit_seq"; first_point_conflict := i; END IF;
    ELSIF (p_point_kinds[i] = 'present' AND (latest."is_tombstone" IS DISTINCT FROM false OR latest."commit_seq" IS DISTINCT FROM p_point_sequences[i])) OR
      (p_point_kinds[i] = 'tombstone' AND (latest."is_tombstone" IS DISTINCT FROM true OR latest."commit_seq" IS DISTINCT FROM p_point_sequences[i])) OR
      (p_point_kinds[i] IN ('noVisibleRevision','noVisibleRevisionInsertion') AND latest."commit_seq" IS NOT NULL) THEN
      refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
    END IF;
  END LOOP; END IF;
  IF actual_sequence IS NOT NULL THEN i := first_point_conflict; refusal := 'pointConflict'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_point_kinds[i] IN ('generatedInsertion','noVisibleRevisionInsertion') AND latest."commit_seq" IS NOT NULL THEN
      refusal := 'generatedInsertionConflict'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
    END IF;
  END LOOP; END IF;
  phase := 'range'; actual_sequence := NULL;
  IF cardinality(p_range_indexes) > 0 AND (p_snapshot < p_oldest OR p_last > p_snapshot + 128) THEN i := 1; refusal := 'rangeWindowExceeded'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
  IF cardinality(p_range_indexes) > 0 AND p_last > p_snapshot THEN FOR i IN 1..cardinality(p_range_indexes) LOOP
    SELECT x.* INTO range_row FROM %1$I."fx_app_index_entry_rev" x WHERE x."scope_uuid" = p_scope_uuid
      AND x."index_definition_id" = p_range_indexes[i] AND x."commit_seq" > p_snapshot AND x."commit_seq" <= p_last
      AND (p_range_lower[i] IS NULL OR x."encoded_key" >= p_range_lower[i])
      AND (p_range_upper_kinds[i] = 'unbounded' OR (p_range_upper_kinds[i] = 'key' AND x."encoded_key" < p_range_upper[i]) OR
        (p_range_upper_kinds[i] = 'position' AND (x."encoded_key" < p_range_upper[i] OR
          (x."encoded_key" = p_range_upper[i] AND x."row_id" <= p_range_upper_ids[i]))))
      ORDER BY x."commit_seq", x."encoded_key", x."row_id" LIMIT 1;
    IF FOUND THEN
      IF range_row."table_id" IS DISTINCT FROM p_range_tables[i] OR range_row."key_codec_version" IS DISTINCT FROM 1 OR
        range_row."physical_spec_sha256" IS DISTINCT FROM p_range_specs[i] OR octet_length(range_row."row_id") IS DISTINCT FROM 16 OR
        octet_length(range_row."encoded_key") NOT BETWEEN 1 AND 2048 THEN refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
      RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('phase', phase, 'reason', 'rangeConflict', 'ordinal', i-1,
        'actualSequence', range_row."commit_seq"::text, 'encodedKey', encode(range_row."encoded_key", 'hex'),
        'rowId', encode(range_row."row_id", 'hex'))::text;
    END IF;
  END LOOP; END IF;
  phase := 'relation';
  IF cardinality(p_relation_ids) > 0 THEN FOR i IN 1..cardinality(p_relation_ids) LOOP
    SELECT x."last_changed_commit_seq" INTO version FROM %1$I."fx_app_edge_adjacency_version" x WHERE x."scope_uuid" = p_scope_uuid
      AND x."edge_definition_id" = p_relation_indexes[i] AND x."direction" = 'incoming'
      AND x."endpoint_row_id" = p_relation_ids[i];
    IF FOUND AND (version IS NULL OR version <= 0) THEN refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    version := coalesce(version,0);
    IF version < p_relation_versions[i] OR version > p_last OR (version <> p_relation_versions[i] AND version <= p_snapshot) THEN refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    IF version <> p_relation_versions[i] THEN actual_sequence := version; refusal := 'relationConflict'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
  END LOOP; END IF;
  phase := 'deadline'; i := 1; actual_sequence := NULL;
  database_now := to_timestamp(trunc(extract(epoch from clock_timestamp()) * 1000) / 1000);
  IF p_deadline <= database_now THEN kind := 'expired'; RETURN NEXT; RETURN; END IF;
  IF p_capture_snapshot THEN
    SELECT * INTO coverage FROM %1$I.fx_begin_app_materialization(p_scope, p_deadline, true);
    IF coverage.reason = 'expired' THEN kind := 'expired'; RETURN NEXT; RETURN; END IF;
    application_head := coverage.application_head; application_activation := coverage.application_activation;
    legacy_schema := coverage.legacy_schema; relation_schema := coverage.relation_schema;
  END IF;
  phase := 'original';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_changed[i] AND p_need_original[i] AND p_point_kinds[i] = 'present' AND p_original_sequences[i] IS NULL THEN refusal := 'priorDocumentInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    IF p_changed[i] AND p_need_original[i] AND latest."commit_seq" IS NOT NULL AND NOT latest."is_tombstone" THEN
      IF latest."commit_seq" IS DISTINCT FROM p_original_sequences[i] OR
        latest."creation_time" IS DISTINCT FROM p_original_times[i] OR
        latest."scope_uuid" IS DISTINCT FROM p_original_scopes[i] OR
        latest."write_epoch_uuid" IS DISTINCT FROM p_original_epochs[i] OR
        latest."prev_commit_seq" IS DISTINCT FROM p_original_previous[i] OR
        latest."schema_version_id" IS DISTINCT FROM p_original_schemas[i] OR
        latest."value_codec_version" IS DISTINCT FROM 1 OR
        original_lengths[i] IS DISTINCT FROM p_original_lengths[i] OR
        latest."value_sha256" IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
      SELECT x.* INTO original FROM %1$I."fx_app_row_rev" x WHERE x."scope_uuid" = p_scope_uuid
        AND x."table_id" = p_point_tables[i] AND x."row_id" = p_point_ids[i]
        AND x."commit_seq" = latest."commit_seq"
        AND octet_length(x."value_bytes") = p_original_lengths[i];
      IF NOT FOUND OR octet_length(original."value_bytes") IS DISTINCT FROM p_original_lengths[i] OR
        original."value_codec_version" IS DISTINCT FROM 1 OR
        original."value_sha256" IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
      IF pg_catalog.sha256(original."value_bytes") IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    END IF;
  END LOOP; END IF;
  phase := 'developerTransition';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_indexes) > 0 THEN FOR i IN 1..cardinality(p_indexes) LOOP
    SELECT x.* INTO b FROM unnest(developer) x WHERE x."index_definition_id" = p_indexes[i];
    IF NOT FOUND THEN refusal := 'developerIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    attempts[i] := b."attempt_fence"; epochs[i] := b."epoch"; fences[i] := b."storage_generation_fence";
  END LOOP; END IF;
  FOR transition IN SELECT * FROM %1$I.fx_accept_app_index_transitions(p_scope, p_scope_uuid, p_indexes, p_access, p_tables, p_codecs,
    p_specs, p_ids, p_previous, p_previous_sha, p_final, p_final_sha, p_row_previous, attempts, epochs, fences, p_maximum) LOOP
    kind := 'transition'; transition_reason := transition.reason; pair_ordinal := transition.pair_ordinal; key_ordinal := transition.key_ordinal;
    transition_kind := transition.transition_kind; prior_commit_seq := transition.prior_commit_seq; prior_is_tombstone := transition.prior_is_tombstone;
    emitted_count := transition.emitted_count; RETURN NEXT;
  END LOOP;
  transition_reason := NULL; pair_ordinal := NULL; key_ordinal := NULL; transition_kind := NULL; prior_commit_seq := NULL; prior_is_tombstone := NULL; emitted_count := NULL;
  phase := 'uniqueOwner';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  SELECT owners INTO accepted_unique_owners FROM %1$I.fx_accept_app_unique_owners(p_unique_owners, p_unique_previous, p_unique_row_previous);
  IF p_stop = 'afterUniqueOwner' THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  phase := 'relationTarget';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_target_ids) > 0 THEN FOR i IN 1..cardinality(p_target_ids) LOOP
    SELECT c."commit_seq" AS pointer, row(r."scope_uuid", r."table_id", r."row_id", r."commit_seq", r."prev_commit_seq", r."write_epoch_uuid", r."schema_version_id", r."creation_time", r."value_codec_version", r."is_tombstone", NULL::bytea, r."value_sha256")::%1$I."fx_app_row_rev" AS revision INTO captured
      FROM (VALUES (1)) request(dummy) LEFT JOIN %1$I."fx_app_row_current" c ON c."scope_uuid" = p_scope_uuid
        AND c."table_id" = p_target_tables[i] AND c."row_id" = p_target_ids[i]
      LEFT JOIN %1$I."fx_app_row_rev" r ON r."scope_uuid" = p_scope_uuid AND r."table_id" = p_target_tables[i]
        AND r."row_id" = p_target_ids[i] AND r."commit_seq" = c."commit_seq";
    pointer_seq := captured.pointer; target := captured.revision;
    IF pointer_seq IS NULL AND target."commit_seq" IS NULL AND target."is_tombstone" IS NULL THEN refusal := 'relationTargetMissing'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    IF pointer_seq IS NULL OR target."commit_seq" IS NULL OR pointer_seq <> target."commit_seq" OR
      target."commit_seq" > p_last OR target."is_tombstone" IS NULL THEN refusal := 'relationTargetEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    IF target."is_tombstone" THEN refusal := 'relationTargetMissing'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
  END LOOP; END IF;
  phase := 'candidate';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF p_candidate THEN SELECT x.* INTO candidate_head FROM %1$I."fx_system_app_schema_candidate_validation" x
    WHERE x."scope_id" = p_scope FOR UPDATE; END IF;
  IF cardinality(heads) > 0 THEN FOR i IN 1..cardinality(heads) LOOP
    kind := 'head'; ordinal := i-1; latest := heads[i]; pointer_sequence := pointers[i]; latest_sequence := latest."commit_seq";
    latest_tombstone := latest."is_tombstone"; latest_creation_time := latest."creation_time"; RETURN NEXT;
  END LOOP; END IF;
  ordinal := NULL; pointer_sequence := NULL; latest_sequence := NULL; latest_tombstone := NULL; latest_creation_time := NULL;
  IF cardinality(developer)>0 THEN FOR i IN 1..cardinality(developer) LOOP
    b:=developer[i];
    IF b."lifecycle"='validating' THEN
      kind:='developerValidation'; ordinal:=i-1;
      validation_definition:=b."index_definition_id"; validation_attempt:=b."attempt_fence";
      validation_epoch:=b."epoch"; validation_fence:=b."storage_generation_fence";
      RETURN NEXT;
    END IF;
  END LOOP; END IF;
  ordinal:=NULL; validation_definition:=NULL; validation_attempt:=NULL; validation_epoch:=NULL; validation_fence:=NULL;
  kind := 'accepted'; RETURN NEXT;
END;
$publication_acceptance$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_app_publication(text,uuid,text,bigint,text,bigint,bigint,bigint,timestamptz,boolean,boolean,integer[],integer[],text[],integer[],bytea[],text[],bigint[],bigint[],boolean[],boolean[],bigint[],uuid[],uuid[],bigint[],text[],integer[],bytea[],double precision[],integer[],integer[],bytea[],bytea[],text[],bytea[],bytea[],integer[],bytea[],bigint[],integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],integer,%1$I.fx_app_unique_owner[],bytea[],bigint[],integer[],bytea[],boolean,text) FROM PUBLIC',target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_apply_app_publication("p_scope" text, "p_generation" text, "p_fence" bigint, "p_epoch" text, "p_last" bigint, "p_deployment" text, "p_schema" text, "p_mixed" boolean, "p_source_bound" boolean, "p_active" boolean, "p_active_deployment" text, "p_active_schema" text, "p_active_manifest" bytea, "p_active_sequence" bigint, "p_active_activation" bytea, "p_active_head" bytea, "p_build_ids" integer[], "p_build_tables" integer[], "p_build_specs" bytea[], "p_build_active" boolean[], "p_unique_ids" integer[], "p_unique_tables" integer[], "p_unique_specs" bytea[], "p_unique_active" boolean[], "p_unique_schemas" text[], "p_unique_deployments" text[], "p_defer" boolean, "p_intrinsic_indexes" integer[], "p_intrinsic_access" text[], "p_intrinsic_tables" integer[], "p_intrinsic_codecs" integer[], "p_intrinsic_specs" bytea[], "p_intrinsic_ids" bytea[], "p_intrinsic_previous" bytea[], "p_intrinsic_previous_sha" bytea[], "p_intrinsic_final" bytea[], "p_intrinsic_final_sha" bytea[], "p_intrinsic_row_previous" bigint[], "p_stop" text, "p_rows" %1$I.fx_app_row_write[], "p_row_pages" integer[], "p_indexes" %1$I.fx_app_index_write[], "p_index_prior" bigint[], "p_index_historical" boolean[], "p_unique_owners" %1$I.fx_app_unique_owner[], "p_unique_previous" %1$I.fx_app_unique_write[], "p_unique_next" %1$I.fx_app_unique_write[], "p_validation" %1$I.fx_app_index_coverage[], "p_index_coverage" %1$I.fx_app_index_coverage[], "p_unique_coverage" %1$I.fx_app_unique_coverage[], "p_seq" bigint, "p_search_scope" uuid, "p_search_tables" integer[], "p_search_indexes" integer[], "p_search_sources" text[], "p_search_modes" boolean[], "p_search_row_counts" integer[], "p_search_ids" bytea[], "p_search_text_counts" integer[], "p_search_text" %1$I.fx_app_search_write[], "p_search_json_counts" integer[], "p_search_json" %1$I.fx_app_json_write[])
RETURNS TABLE("kind" text, "coverage_ordinal" integer, "coverage_definition" integer, "coverage_attempt" bigint, "coverage_epoch" text, "coverage_fence" bigint, "reason" text, "row_count" integer, "index_count" integer, "unique_count" integer, "validation_count" integer, "coverage_count" integer, "search_count" integer, "search_build_count" integer, "intrinsic_count" integer, "intrinsic_live_count" integer, "intrinsic_tombstone_count" integer, "intrinsic_key_bytes" integer, "index_coverage_count" integer, "unique_coverage_count" integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $publication_application$
DECLARE i integer:=1; k integer; row_ordinal integer; phase text:='uniqueCoverage'; refusal text; frontier bigint; t record; proof record;
  inner_message text; inner_detail text; intrinsic_transitions jsonb:='[]'::jsonb;
  u %1$I."fx_system_unique_constraint_build"; um %1$I."fx_system_unique_maintenance_obligation"; b %1$I."fx_system_index_build_state"; m %1$I."fx_system_index_maintenance_obligation";
  indices %1$I.fx_app_index_write[]:=ARRAY[]::%1$I.fx_app_index_write[];
  priors bigint[]:=ARRAY[]::bigint[]; historical boolean[]:=ARRAY[]::boolean[];
  validations %1$I.fx_app_index_coverage[]:=ARRAY[]::%1$I.fx_app_index_coverage[];
  index_coverage %1$I.fx_app_index_coverage[]:=ARRAY[]::%1$I.fx_app_index_coverage[];
  unique_coverage %1$I.fx_app_unique_coverage[]:=ARRAY[]::%1$I.fx_app_unique_coverage[];
  attempts bigint[]:=ARRAY[]::bigint[]; epochs text[]:=ARRAY[]::text[]; fences bigint[]:=ARRAY[]::bigint[];
BEGIN
  IF cardinality(p_unique_ids)>0 THEN
    IF p_source_bound THEN
      PERFORM 1 FROM %1$I."fx_system_unique_constraint_build" x WHERE x."scope_id"=p_scope AND x."unique_constraint_definition_id"=ANY(p_unique_ids)
        ORDER BY x."unique_constraint_definition_id" FOR NO KEY UPDATE;
    ELSIF NOT p_active THEN
      PERFORM 1 FROM %1$I."fx_system_unique_constraint_build" x WHERE x."scope_id"=p_scope AND x."unique_constraint_definition_id"=ANY(p_unique_ids)
        ORDER BY x."unique_constraint_definition_id" FOR UPDATE;
    ELSE
      PERFORM 1 FROM %1$I."fx_system_unique_constraint_build" x WHERE x."scope_id"=p_scope AND x."unique_constraint_definition_id"=ANY(p_unique_ids)
        ORDER BY x."unique_constraint_definition_id" FOR SHARE;
    END IF;
    FOR i IN 1..cardinality(p_unique_ids) LOOP
      SELECT x.* INTO u FROM %1$I."fx_system_unique_constraint_build" x WHERE x."scope_id"=p_scope AND x."unique_constraint_definition_id"=p_unique_ids[i];
      SELECT x.* INTO um FROM %1$I."fx_system_unique_maintenance_obligation" x WHERE x."scope_id"=p_scope
        AND x."unique_constraint_definition_id"=p_unique_ids[i] AND x."activation_sequence"=u."maintenance_activation_sequence";
      IF u."scope_id" IS DISTINCT FROM p_scope OR u."unique_constraint_definition_id" IS DISTINCT FROM p_unique_ids[i] OR
        u."storage_generation" IS DISTINCT FROM p_generation OR u."storage_generation_fence" IS DISTINCT FROM p_fence OR
        u."epoch" IS DISTINCT FROM p_epoch OR u."lifecycle" IS DISTINCT FROM 'enabled' OR
        u."cursor_row_id" IS NOT NULL OR u."start_commit_seq" IS NULL OR u."start_commit_seq"<0 OR
        u."covered_through_commit_seq" IS NULL OR u."covered_through_commit_seq"<u."start_commit_seq" OR
        u."covered_through_commit_seq">p_last OR u."start_commit_seq">p_last OR
        u."attempt_fence" IS NULL OR u."attempt_fence"<=0 OR
        u."created_at" IS NULL OR u."updated_at" IS NULL OR
        NOT isfinite(u."created_at") OR NOT isfinite(u."updated_at") OR
        abs(extract(epoch FROM u."created_at")*1000)>8640000000000000 OR abs(extract(epoch FROM u."updated_at")*1000)>8640000000000000 OR
        date_trunc('milliseconds',u."updated_at")<date_trunc('milliseconds',u."created_at") OR
        ((u."maintenance_activation_sequence" IS NULL)<>(um."activation_sequence" IS NULL)) THEN
        refusal:='uniqueBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;
      END IF;
      IF (p_unique_active[i] AND p_active AND um."activation_sequence" IS NULL) OR
        (NOT p_unique_active[i] AND um."activation_sequence" IS NOT NULL) OR
        (p_mixed AND p_unique_active[i] AND NOT p_active) THEN refusal:='uniqueCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
      IF um."activation_sequence" IS NOT NULL THEN
        IF um."activation_sequence"<=0 OR um."scope_id" IS DISTINCT FROM p_scope OR
          um."unique_constraint_definition_id" IS DISTINCT FROM p_unique_ids[i] OR
          um."storage_generation" IS DISTINCT FROM p_generation OR um."storage_generation_fence" IS DISTINCT FROM p_fence OR
          um."epoch" IS DISTINCT FROM p_epoch OR um."attempt_fence" IS DISTINCT FROM u."attempt_fence" OR
          um."start_commit_seq" IS DISTINCT FROM u."start_commit_seq" OR
          um."opened_commit_seq" IS DISTINCT FROM u."covered_through_commit_seq" OR
          um."table_id" IS DISTINCT FROM p_unique_tables[i] OR um."physical_spec_sha256" IS DISTINCT FROM p_unique_specs[i] OR
          um."deployment_id" IS DISTINCT FROM p_unique_deployments[i] OR
          um."schema_version_id" IS DISTINCT FROM (CASE WHEN p_mixed AND p_unique_active[i] THEN p_active_schema ELSE p_unique_schemas[i] END) OR
          NOT p_active OR um."deployment_id" IS DISTINCT FROM p_active_deployment OR
          um."schema_version_id" IS DISTINCT FROM p_active_schema OR
          um."activation_sequence" IS DISTINCT FROM p_active_sequence OR
          um."activation_sha256" IS DISTINCT FROM p_active_activation OR um."head_sha256" IS DISTINCT FROM p_active_head THEN
          refusal:='uniqueBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;
        END IF;
      ELSIF u."covered_through_commit_seq"<p_last THEN
        SELECT x."commit_seq" INTO frontier FROM %1$I."fx_app_row_current" x WHERE x."scope_uuid"=p_search_scope AND x."table_id"=p_unique_tables[i]
          ORDER BY x."commit_seq" DESC LIMIT 1;
        IF FOUND AND (frontier IS NULL OR frontier<=0) THEN refusal:='uniqueBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        IF frontier>u."covered_through_commit_seq" THEN refusal:='uniqueCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        IF p_defer AND NOT p_unique_active[i] THEN
          PERFORM * FROM %1$I.fx_advance_app_coverage(ARRAY[]::%1$I.fx_app_index_coverage[],ARRAY[row(
  u."scope_id", u."unique_constraint_definition_id",
  u."attempt_fence", u."epoch", u."storage_generation_fence")::%1$I.fx_app_unique_coverage],p_last,NULL,false,
            ARRAY[]::%1$I.fx_app_index_coverage[],ARRAY[]::%1$I.fx_app_unique_coverage[],ARRAY[]::text[],ARRAY[]::text[]);
        END IF;
      END IF;
      IF um."activation_sequence" IS NULL THEN unique_coverage:=array_append(unique_coverage,row(
  u."scope_id", u."unique_constraint_definition_id",
  u."attempt_fence", u."epoch", u."storage_generation_fence")::%1$I.fx_app_unique_coverage); END IF;
    END LOOP;
  END IF;
  phase:='indexCoverage';
  IF cardinality(p_build_ids)>0 THEN FOR i IN 1..cardinality(p_build_ids) LOOP
    SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id"=p_scope AND x."index_definition_id"=p_build_ids[i];
    SELECT x.* INTO m FROM %1$I."fx_system_index_maintenance_obligation" x WHERE x."scope_id"=p_scope AND x."index_definition_id"=p_build_ids[i]
      AND x."activation_sequence"=b."maintenance_activation_sequence";
    IF (p_build_active[i] AND p_active AND (b."lifecycle" IS DISTINCT FROM 'enabled' OR m."activation_sequence" IS NULL)) OR
      (NOT p_build_active[i] AND (b."lifecycle" IS DISTINCT FROM 'enabled' OR m."activation_sequence" IS NOT NULL)) OR
      (p_mixed AND p_build_active[i] AND NOT p_active) THEN refusal:='indexCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
    IF m."activation_sequence" IS NOT NULL THEN
      IF m."schema_version_id" IS DISTINCT FROM (CASE WHEN p_mixed AND p_build_active[i] THEN p_active_schema ELSE p_schema END) OR
        m."deployment_id" IS DISTINCT FROM p_deployment OR m."physical_spec_sha256" IS DISTINCT FROM p_build_specs[i] THEN
        refusal:='indexBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;
      END IF;
    END IF;
    IF b."lifecycle"='enabled' THEN
      IF b."covered_through_commit_seq" IS NULL OR b."first_readable_commit_seq" IS NULL OR b."first_readable_commit_seq">p_last THEN
        refusal:='indexCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
      IF m."activation_sequence" IS NOT NULL THEN
        IF m."table_id" IS DISTINCT FROM p_build_tables[i] OR NOT p_active OR
          m."deployment_id" IS DISTINCT FROM p_active_deployment OR m."schema_version_id" IS DISTINCT FROM p_active_schema OR
          m."schema_manifest_sha256" IS DISTINCT FROM p_active_manifest OR m."activation_sequence" IS DISTINCT FROM p_active_sequence OR
          m."activation_sha256" IS DISTINCT FROM p_active_activation OR m."head_sha256" IS DISTINCT FROM p_active_head THEN
          refusal:='indexBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
      ELSIF b."covered_through_commit_seq"<p_last THEN
        SELECT x."commit_seq" INTO frontier FROM %1$I."fx_app_row_current" x WHERE x."scope_uuid"=p_search_scope AND x."table_id"=p_build_tables[i]
          ORDER BY x."commit_seq" DESC LIMIT 1;
        IF FOUND AND (frontier IS NULL OR frontier<=0) THEN refusal:='indexBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        IF frontier>b."covered_through_commit_seq" THEN refusal:='indexCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        IF p_defer AND NOT p_build_active[i] THEN
          PERFORM * FROM %1$I.fx_advance_app_coverage(ARRAY[row(
  b."scope_id", b."index_definition_id",
  b."attempt_fence", b."epoch", b."storage_generation_fence")::%1$I.fx_app_index_coverage],ARRAY[]::%1$I.fx_app_unique_coverage[],p_last,b."covered_through_commit_seq",true,
            ARRAY[]::%1$I.fx_app_index_coverage[],ARRAY[]::%1$I.fx_app_unique_coverage[],ARRAY[]::text[],ARRAY[]::text[]);
        END IF;
      END IF;
      IF m."activation_sequence" IS NULL THEN index_coverage:=array_append(index_coverage,row(
  b."scope_id", b."index_definition_id",
  b."attempt_fence", b."epoch", b."storage_generation_fence")::%1$I.fx_app_index_coverage); END IF;
    ELSIF b."lifecycle"='validating' AND p_build_ids[i]=ANY(p_intrinsic_indexes) THEN
      validations:=array_append(validations,row(
  b."scope_id", b."index_definition_id",
  b."attempt_fence", b."epoch", b."storage_generation_fence")::%1$I.fx_app_index_coverage);
    END IF;
  END LOOP; END IF;
  phase:='intrinsic';
  IF p_stop=phase THEN kind:='terminal'; reason:='stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_intrinsic_indexes)>0 THEN FOR i IN 1..cardinality(p_intrinsic_indexes) LOOP
    SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id"=p_scope AND x."index_definition_id"=p_intrinsic_indexes[i];
    attempts[i]:=b."attempt_fence"; epochs[i]:=b."epoch"; fences[i]:=b."storage_generation_fence";
  END LOOP; END IF;
  intrinsic_count:=0; intrinsic_live_count:=0; intrinsic_tombstone_count:=0; intrinsic_key_bytes:=0;
  FOR t IN SELECT * FROM %1$I.fx_accept_app_index_transitions(p_scope,p_search_scope,p_intrinsic_indexes,p_intrinsic_access,p_intrinsic_tables,
    p_intrinsic_codecs,p_intrinsic_specs,p_intrinsic_ids,p_intrinsic_previous,p_intrinsic_previous_sha,p_intrinsic_final,p_intrinsic_final_sha,
    p_intrinsic_row_previous,attempts,epochs,fences,cardinality(p_intrinsic_indexes)) LOOP
    IF t.reason='transition' THEN
      k:=t.pair_ordinal+1;
      SELECT x.ordinality::integer INTO row_ordinal FROM unnest(p_rows) WITH ORDINALITY x WHERE x."table_id"=p_intrinsic_tables[k]
        AND x."row_id"=p_intrinsic_ids[k];
      IF p_stop IS DISTINCT FROM 'row' THEN
        IF row_ordinal IS NULL THEN refusal:='intrinsicTransitionInvalid'; i:=k; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        indices:=array_append(indices,row(p_search_scope, p_intrinsic_indexes[k], p_intrinsic_tables[k], p_intrinsic_codecs[k], p_intrinsic_specs[k], CASE WHEN t.key_ordinal=0 THEN p_intrinsic_previous[k] ELSE p_intrinsic_final[k] END, CASE WHEN t.key_ordinal=0 THEN p_intrinsic_previous_sha[k] ELSE p_intrinsic_final_sha[k] END, p_intrinsic_ids[k], p_seq, t.transition_kind='tombstone')::%1$I.fx_app_index_write); priors:=array_append(priors,t.prior_commit_seq); historical:=array_append(historical,false);
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
    SELECT * INTO proof FROM %1$I.fx_apply_app_materialization(p_rows,p_row_pages,
    CASE WHEN p_stop='index' THEN ARRAY[]::%1$I.fx_app_index_write[] ELSE indices||p_indexes END,
    CASE WHEN p_stop='index' THEN ARRAY[]::bigint[] ELSE priors||p_index_prior END,
    CASE WHEN p_stop='index' THEN ARRAY[]::boolean[] ELSE historical||p_index_historical END,
    p_unique_owners,p_unique_previous,p_unique_next,CASE WHEN p_stop='index' THEN ARRAY[]::%1$I.fx_app_index_coverage[] ELSE validations END,
    CASE WHEN p_defer OR p_stop IN ('index','unique') THEN ARRAY[]::%1$I.fx_app_index_coverage[] ELSE index_coverage END,
    CASE WHEN p_defer OR p_stop IN ('index','unique') THEN ARRAY[]::%1$I.fx_app_unique_coverage[] ELSE unique_coverage END,
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
      kind:='indexCoverage'; coverage_ordinal:=i-1; coverage_definition:=(index_coverage[i])."index_definition_id";
      coverage_attempt:=(index_coverage[i])."attempt_fence"; coverage_epoch:=(index_coverage[i])."epoch";
      coverage_fence:=(index_coverage[i])."storage_generation_fence"; RETURN NEXT;
    END LOOP; END IF;
    IF cardinality(unique_coverage)>0 THEN FOR i IN 1..cardinality(unique_coverage) LOOP
      kind:='uniqueCoverage'; coverage_ordinal:=i-1; coverage_definition:=(unique_coverage[i])."unique_constraint_definition_id";
      coverage_attempt:=(unique_coverage[i])."attempt_fence"; coverage_epoch:=(unique_coverage[i])."epoch";
      coverage_fence:=(unique_coverage[i])."storage_generation_fence"; RETURN NEXT;
    END LOOP; END IF;
  END IF;
  kind:='terminal'; coverage_ordinal:=NULL; coverage_definition:=NULL; coverage_attempt:=NULL; coverage_epoch:=NULL; coverage_fence:=NULL;
  RETURN NEXT;
END;
$publication_application$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_publication(text,text,bigint,text,bigint,text,text,boolean,boolean,boolean,text,text,bytea,bigint,bytea,bytea,integer[],integer[],bytea[],boolean[],integer[],integer[],bytea[],boolean[],text[],text[],boolean,integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],text,%1$I.fx_app_row_write[],integer[],%1$I.fx_app_index_write[],bigint[],boolean[],%1$I.fx_app_unique_owner[],%1$I.fx_app_unique_write[],%1$I.fx_app_unique_write[],%1$I.fx_app_index_coverage[],%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],bigint,uuid,integer[],integer[],text[],boolean[],integer[],bytea[],integer[],%1$I.fx_app_search_write[],integer[],%1$I.fx_app_json_write[]) FROM PUBLIC',target_schema);
END;
$publication$;

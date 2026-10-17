-- Retain authoritative insertion-generation evidence without guessing old order.
-- Existing rows keep unknown metadata; public values and creation times are unchanged.
DO $stage$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER TABLE %I.fx_app_row_rev ADD COLUMN insertion_commit_seq bigint, ADD COLUMN insertion_attempt_ordinal bigint', target_schema);
  EXECUTE format($ddl$ALTER TABLE %I.fx_app_row_rev ADD CONSTRAINT fx_app_row_rev_insertion_generation_check CHECK (
    (insertion_commit_seq IS NULL AND insertion_attempt_ordinal IS NULL) OR
    (insertion_commit_seq IS NOT NULL AND insertion_attempt_ordinal IS NOT NULL
      AND insertion_commit_seq >= 1 AND insertion_commit_seq <= commit_seq
      AND insertion_attempt_ordinal BETWEEN 0 AND 9007199254740991)
  )$ddl$, target_schema);
  EXECUTE format('CREATE UNIQUE INDEX fx_app_row_rev_insertion_birth_unique ON %I.fx_app_row_rev (scope_uuid, insertion_commit_seq, insertion_attempt_ordinal) WHERE insertion_commit_seq = commit_seq', target_schema);
  -- Append attributes so existing positional fields retain their exact order.
  EXECUTE format('ALTER TYPE %I.fx_app_row_write ADD ATTRIBUTE insertion_commit_seq bigint, ADD ATTRIBUTE insertion_attempt_ordinal bigint', target_schema);
  EXECUTE format($ddl$
CREATE OR REPLACE FUNCTION %1$I.fx_apply_app_row_batch(p_rows %1$I.fx_app_row_write[], p_verify %1$I.fx_app_row_write[])
RETURNS TABLE(reason text, ordinal integer, actual_commit_seq bigint, actual_creation_time double precision)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $row_batch$
DECLARE i integer; n integer := coalesce(array_length(p_rows, 1), 0);
  expected_row %1$I."fx_app_row_rev"; actual_row %1$I."fx_app_row_rev"; pointer_seq bigint; predecessor_time double precision; predecessor_insertion_commit bigint; predecessor_insertion_ordinal bigint;
  inserted_seq bigint; phase text := 'write'; proof_rows %1$I.fx_app_row_write[]; verification record;
BEGIN
  IF n < 1 OR n > 32 OR n + coalesce(array_length(p_verify, 1), 0) > 512 THEN reason := 'invalidBatch'; ordinal := 0; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text; END IF;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    IF (p_rows[i])."prev_commit_seq" IS NOT NULL THEN
      SELECT r."creation_time", r."insertion_commit_seq", r."insertion_attempt_ordinal" INTO predecessor_time, predecessor_insertion_commit, predecessor_insertion_ordinal FROM %1$I."fx_app_row_rev" r
        WHERE r."scope_uuid" = (p_rows[i])."scope_uuid" AND r."table_id" = (p_rows[i])."table_id"
          AND r."row_id" = (p_rows[i])."row_id" AND r."commit_seq" = (p_rows[i])."prev_commit_seq";
      IF NOT FOUND THEN
        SELECT c."commit_seq" INTO actual_commit_seq FROM %1$I."fx_app_row_current" c
          WHERE c."scope_uuid" = (p_rows[i])."scope_uuid" AND c."table_id" = (p_rows[i])."table_id" AND c."row_id" = (p_rows[i])."row_id";
        reason := 'chainConflict'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text;
      END IF;
      IF predecessor_time IS DISTINCT FROM (p_rows[i])."creation_time" THEN
        reason := 'creationTimeConflict'; actual_creation_time := predecessor_time; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text;
      END IF;
      -- Preserve known and unknown predecessor evidence, except an authenticated
      -- live insertion generation in this actual accepting commit.
      IF ((p_rows[i])."insertion_commit_seq" IS DISTINCT FROM predecessor_insertion_commit
          OR (p_rows[i])."insertion_attempt_ordinal" IS DISTINCT FROM predecessor_insertion_ordinal)
        AND ((p_rows[i])."is_tombstone" OR (p_rows[i])."insertion_commit_seq" IS DISTINCT FROM (p_rows[i])."commit_seq"
          OR (p_rows[i])."insertion_attempt_ordinal" IS NULL) THEN
        reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text;
      END IF;
    ELSIF (p_rows[i])."insertion_commit_seq" IS NOT NULL
      AND ((p_rows[i])."is_tombstone" OR
        (p_rows[i])."insertion_commit_seq" IS DISTINCT FROM (p_rows[i])."commit_seq") THEN
      reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text;
    END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (p_rows[i])."scope_uuid";
    expected_row."table_id" := (p_rows[i])."table_id";
    expected_row."row_id" := (p_rows[i])."row_id";
    expected_row."commit_seq" := (p_rows[i])."commit_seq";
    expected_row."prev_commit_seq" := (p_rows[i])."prev_commit_seq";
    expected_row."write_epoch_uuid" := (p_rows[i])."write_epoch_uuid";
    expected_row."schema_version_id" := (p_rows[i])."schema_version_id";
    expected_row."creation_time" := (p_rows[i])."creation_time";
    expected_row."value_codec_version" := (p_rows[i])."value_codec_version";
    expected_row."is_tombstone" := (p_rows[i])."is_tombstone";
    expected_row."value_bytes" := (p_rows[i])."value_bytes";
    expected_row."value_sha256" := (p_rows[i])."value_sha256";
    expected_row."insertion_commit_seq" := (p_rows[i])."insertion_commit_seq";
    expected_row."insertion_attempt_ordinal" := (p_rows[i])."insertion_attempt_ordinal";
    INSERT INTO %1$I."fx_app_row_rev" ("scope_uuid", "table_id", "row_id", "commit_seq", "prev_commit_seq", "write_epoch_uuid", "schema_version_id", "creation_time", "value_codec_version", "is_tombstone", "value_bytes", "value_sha256", "insertion_commit_seq", "insertion_attempt_ordinal")
      VALUES (expected_row."scope_uuid", expected_row."table_id", expected_row."row_id", expected_row."commit_seq", expected_row."prev_commit_seq", expected_row."write_epoch_uuid", expected_row."schema_version_id", expected_row."creation_time", expected_row."value_codec_version", expected_row."is_tombstone", expected_row."value_bytes", expected_row."value_sha256", expected_row."insertion_commit_seq", expected_row."insertion_attempt_ordinal")
      ON CONFLICT DO NOTHING RETURNING * INTO actual_row;
    IF NOT FOUND THEN
      reason := CASE WHEN EXISTS (SELECT 1 FROM %1$I."fx_app_row_rev" birth
        WHERE birth."scope_uuid" = expected_row."scope_uuid"
          AND birth."commit_seq" = expected_row."insertion_commit_seq"
          AND birth."insertion_commit_seq" = expected_row."insertion_commit_seq"
          AND birth."insertion_attempt_ordinal" = expected_row."insertion_attempt_ordinal"
          AND (birth."table_id" IS DISTINCT FROM expected_row."table_id"
            OR birth."row_id" IS DISTINCT FROM expected_row."row_id"))
        THEN 'storedCorruption' ELSE 'revisionExists' END;
      RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text;
    END IF;
    IF actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text; END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    IF (p_rows[i])."prev_commit_seq" IS NULL THEN
      INSERT INTO %1$I."fx_app_row_current"("scope_uuid", "table_id", "row_id", "commit_seq")
        VALUES ((p_rows[i])."scope_uuid", (p_rows[i])."table_id", (p_rows[i])."row_id", (p_rows[i])."commit_seq")
        ON CONFLICT DO NOTHING RETURNING "commit_seq" INTO inserted_seq;
    ELSE
      UPDATE %1$I."fx_app_row_current" c SET "commit_seq" = (p_rows[i])."commit_seq"
        WHERE c."scope_uuid" = (p_rows[i])."scope_uuid" AND c."table_id" = (p_rows[i])."table_id"
          AND c."row_id" = (p_rows[i])."row_id" AND c."commit_seq" = (p_rows[i])."prev_commit_seq"
        RETURNING c."commit_seq" INTO inserted_seq;
    END IF;
    IF inserted_seq IS NULL THEN
      SELECT c."commit_seq" INTO actual_commit_seq FROM %1$I."fx_app_row_current" c
        WHERE c."scope_uuid" = (p_rows[i])."scope_uuid" AND c."table_id" = (p_rows[i])."table_id" AND c."row_id" = (p_rows[i])."row_id";
      reason := 'chainConflict'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text;
    END IF;
  END LOOP;
  phase := 'verify'; proof_rows := coalesce(p_verify, ARRAY[]::%1$I.fx_app_row_write[]) || p_rows;
  -- One fresh statement observes complete revisions and pointers after every
  -- sequential write barrier, including AFTER changes to earlier page inputs.
  FOR verification IN SELECT proof.ordinality AS proof_ordinal,
      r."commit_seq" IS NOT NULL AND r."scope_uuid" IS NOT DISTINCT FROM proof."scope_uuid" AND r."table_id" IS NOT DISTINCT FROM proof."table_id" AND r."row_id" IS NOT DISTINCT FROM proof."row_id" AND r."commit_seq" IS NOT DISTINCT FROM proof."commit_seq" AND r."prev_commit_seq" IS NOT DISTINCT FROM proof."prev_commit_seq" AND r."write_epoch_uuid" IS NOT DISTINCT FROM proof."write_epoch_uuid" AND r."schema_version_id" IS NOT DISTINCT FROM proof."schema_version_id" AND r."creation_time" IS NOT DISTINCT FROM proof."creation_time" AND r."value_codec_version" IS NOT DISTINCT FROM proof."value_codec_version" AND r."is_tombstone" IS NOT DISTINCT FROM proof."is_tombstone" AND r."value_bytes" IS NOT DISTINCT FROM proof."value_bytes" AND r."value_sha256" IS NOT DISTINCT FROM proof."value_sha256" AND r."insertion_commit_seq" IS NOT DISTINCT FROM proof."insertion_commit_seq" AND r."insertion_attempt_ordinal" IS NOT DISTINCT FROM proof."insertion_attempt_ordinal" AS revision_matches,
      c."commit_seq" AS pointer_seq, proof."commit_seq" AS expected_seq
    FROM unnest(proof_rows) WITH ORDINALITY proof
    LEFT JOIN %1$I."fx_app_row_rev" r ON r."scope_uuid" = proof."scope_uuid" AND r."table_id" = proof."table_id" AND r."row_id" = proof."row_id" AND r."commit_seq" = proof."commit_seq"
    LEFT JOIN %1$I."fx_app_row_current" c ON c."scope_uuid" = proof."scope_uuid"
      AND c."table_id" = proof."table_id" AND c."row_id" = proof."row_id"
    ORDER BY proof.ordinality LOOP
    ordinal := verification.proof_ordinal - 1;
    IF NOT verification.revision_matches THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text; END IF;
    IF verification.pointer_seq IS DISTINCT FROM verification.expected_seq THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text; END IF;
  END LOOP;
  reason := 'accepted'; ordinal := n; actual_commit_seq := NULL; actual_creation_time := NULL; RETURN NEXT;
END;
$row_batch$;$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_row_batch(%1$I.fx_app_row_write[], %1$I.fx_app_row_write[]) FROM PUBLIC', target_schema);
END;
$stage$;

--> statement-breakpoint
-- Replace the private bounded snapshot reader under installation quiescence.
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format('DROP FUNCTION %I.fx_read_snapshot_rows(uuid,integer,bytea[],bigint,bigint,boolean)', target_schema);
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_read_snapshot_rows(p_scope_uuid uuid, p_table_id integer,
      p_row_ids bytea[], p_snapshot_commit_seq bigint, p_transfer_budget bigint, p_settlement_window boolean)
    RETURNS TABLE(ordinal integer, requested_row_id bytea, row_present boolean,
      scope_uuid uuid, table_id integer, row_id bytea, commit_seq_text text, prev_commit_seq_text text,
      write_epoch_uuid uuid, schema_version_id text, creation_time double precision,
      value_codec_version integer, is_tombstone boolean, value_sha256 bytea, value_bytes bytea, body_withheld boolean,
      insertion_commit_seq_text text, insertion_attempt_ordinal_text text)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF p_scope_uuid IS NULL OR p_table_id IS NULL OR p_table_id < 1 OR p_row_ids IS NULL
        OR cardinality(p_row_ids) > 256 OR p_snapshot_commit_seq IS NULL OR p_snapshot_commit_seq < 0
        OR p_settlement_window IS NULL OR p_transfer_budget < 0 OR p_transfer_budget > 1048576
        OR EXISTS(SELECT 1 FROM unnest(p_row_ids) id WHERE id IS NULL OR octet_length(id) <> 16)
        OR cardinality(p_row_ids) <> (SELECT count(DISTINCT id) FROM unnest(p_row_ids) id) THEN
        RAISE EXCEPTION 'invalid snapshot row demand' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY
      WITH selected AS MATERIALIZED (
        SELECT (requested.position - 1)::integer AS request_ordinal, requested.id AS requested_id, r.*
        FROM unnest(p_row_ids) WITH ORDINALITY requested(id, position)
        LEFT JOIN LATERAL (
          SELECT revision.* FROM %1$I.fx_app_row_rev revision
          WHERE revision.scope_uuid = p_scope_uuid AND revision.table_id = p_table_id
            AND revision.row_id = requested.id AND revision.commit_seq <= p_snapshot_commit_seq
          ORDER BY revision.commit_seq DESC LIMIT 1
        ) r ON true
      ), budgeted AS (
        SELECT selected.*, coalesce(sum(coalesce(octet_length(selected.value_bytes), 0))
          OVER (ORDER BY selected.request_ordinal ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS preceding_bytes
        FROM selected
      ), withheld AS (
        SELECT budgeted.*, CASE WHEN p_transfer_budget IS NULL THEN false
          WHEN p_settlement_window THEN preceding_bytes > 0
            AND preceding_bytes + coalesce(octet_length(budgeted.value_bytes), 0) > p_transfer_budget
          ELSE preceding_bytes > p_transfer_budget END AS withheld_body
        FROM budgeted
      )
      SELECT w.request_ordinal, w.requested_id, w.commit_seq IS NOT NULL,
        w.scope_uuid, w.table_id, w.row_id, w.commit_seq::text, w.prev_commit_seq::text,
        w.write_epoch_uuid, w.schema_version_id, w.creation_time, w.value_codec_version,
        w.is_tombstone, w.value_sha256,
        CASE WHEN w.withheld_body THEN NULL ELSE w.value_bytes END, w.withheld_body,
        w.insertion_commit_seq::text, w.insertion_attempt_ordinal::text
      FROM withheld w ORDER BY w.request_ordinal;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_read_snapshot_rows(uuid,integer,bytea[],bigint,bigint,boolean) FROM PUBLIC', target_schema);
END $$;

--> statement-breakpoint
-- Retain exact predecessor insertion evidence through the fixed publication head proof.
DO $stage$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format('DROP FUNCTION %1$I.fx_accept_app_publication(text,uuid,text,bigint,text,bigint,bigint,bigint,timestamptz,boolean,boolean,integer[],integer[],text[],integer[],bytea[],text[],bigint[],bigint[],boolean[],boolean[],bigint[],uuid[],uuid[],bigint[],text[],integer[],bytea[],double precision[],integer[],integer[],bytea[],bytea[],text[],bytea[],bytea[],integer[],bytea[],bigint[],integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],integer,%1$I.fx_app_unique_owner[],bytea[],bigint[],integer[],bytea[],boolean,text)', target_schema);
  EXECUTE format($ddl$

CREATE FUNCTION %1$I.fx_accept_app_publication("p_scope" text, "p_scope_uuid" uuid, "p_generation" text, "p_fence" bigint, "p_epoch" text, "p_last" bigint, "p_snapshot" bigint, "p_oldest" bigint, "p_deadline" timestamptz, "p_capture_snapshot" boolean, "p_original_build_locks" boolean, "p_intrinsic" integer[], "p_developer" integer[], "p_developer_access" text[], "p_point_tables" integer[], "p_point_ids" bytea[], "p_point_kinds" text[], "p_point_sequences" bigint[], "p_point_snapshots" bigint[], "p_changed" boolean[], "p_need_original" boolean[], "p_original_sequences" bigint[], "p_original_scopes" uuid[], "p_original_epochs" uuid[], "p_original_previous" bigint[], "p_original_schemas" text[], "p_original_lengths" integer[], "p_original_digests" bytea[], "p_original_times" double precision[], "p_range_indexes" integer[], "p_range_tables" integer[], "p_range_specs" bytea[], "p_range_lower" bytea[], "p_range_upper_kinds" text[], "p_range_upper" bytea[], "p_range_upper_ids" bytea[], "p_relation_indexes" integer[], "p_relation_ids" bytea[], "p_relation_versions" bigint[], "p_indexes" integer[], "p_access" text[], "p_tables" integer[], "p_codecs" integer[], "p_specs" bytea[], "p_ids" bytea[], "p_previous" bytea[], "p_previous_sha" bytea[], "p_final" bytea[], "p_final_sha" bytea[], "p_row_previous" bigint[], "p_maximum" integer, "p_unique_owners" %1$I.fx_app_unique_owner[], "p_unique_previous" bytea[], "p_unique_row_previous" bigint[], "p_target_tables" integer[], "p_target_ids" bytea[], "p_candidate" boolean, "p_stop" text)
RETURNS TABLE("kind" text, "ordinal" integer, "pointer_sequence" bigint, "latest_sequence" bigint, "latest_tombstone" boolean, "latest_creation_time" double precision, "transition_reason" text, "pair_ordinal" integer, "key_ordinal" integer, "transition_kind" text, "prior_commit_seq" bigint, "prior_is_tombstone" boolean, "emitted_count" integer, "accepted_unique_owners" integer, "validation_definition" integer, "validation_attempt" bigint, "validation_epoch" text, "validation_fence" bigint, "database_now" timestamptz, "candidate_head" %1$I.fx_system_app_schema_candidate_validation, "application_head" %1$I.fx_system_application_active_head, "application_activation" %1$I.fx_system_application_activation, "legacy_schema" %1$I.fx_system_application_revision_schema_v1, "relation_schema" %1$I.fx_system_application_revision_schema, "latest_insertion_commit_seq" bigint, "latest_insertion_attempt_ordinal" bigint)
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
        AND x."index_definition_id" = selected_id AND x."authority_kind" = b."maintenance_authority_kind" AND x."activation_sequence" = b."maintenance_activation_sequence";
      IF (
  ((b."maintenance_authority_kind" IS NULL) <> (b."maintenance_activation_sequence" IS NULL)) OR
  (b."maintenance_authority_kind" IS NOT NULL AND b."maintenance_authority_kind" NOT IN ('application','binding')) OR
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
  m."authority_kind" IS DISTINCT FROM b."maintenance_authority_kind" OR
  m."authority_kind" NOT IN ('application','binding') OR
  (m."authority_kind"='application' AND m."candidate_sha256" IS NOT NULL) OR
  (m."authority_kind"='binding' AND octet_length(m."candidate_sha256") IS DISTINCT FROM 32) OR
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
      AND x."index_definition_id" = selected_id AND x."authority_kind" = b."maintenance_authority_kind" AND x."activation_sequence" = b."maintenance_activation_sequence";
    IF p_developer_access[i] IS DISTINCT FROM 'developer' OR (
  ((b."maintenance_authority_kind" IS NULL) <> (b."maintenance_activation_sequence" IS NULL)) OR
  (b."maintenance_authority_kind" IS NOT NULL AND b."maintenance_authority_kind" NOT IN ('application','binding')) OR
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
  m."authority_kind" IS DISTINCT FROM b."maintenance_authority_kind" OR
  m."authority_kind" NOT IN ('application','binding') OR
  (m."authority_kind"='application' AND m."candidate_sha256" IS NOT NULL) OR
  (m."authority_kind"='binding' AND octet_length(m."candidate_sha256") IS DISTINCT FROM 32) OR
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
    SELECT c."commit_seq" AS pointer, row(r."scope_uuid", r."table_id", r."row_id", r."commit_seq", r."prev_commit_seq", r."write_epoch_uuid", r."schema_version_id", r."creation_time", r."value_codec_version", r."is_tombstone", NULL::bytea, r."value_sha256", r."insertion_commit_seq", r."insertion_attempt_ordinal")::%1$I."fx_app_row_rev" AS revision, octet_length(r.value_bytes) AS byte_length INTO captured
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
    SELECT c."commit_seq" AS pointer, row(r."scope_uuid", r."table_id", r."row_id", r."commit_seq", r."prev_commit_seq", r."write_epoch_uuid", r."schema_version_id", r."creation_time", r."value_codec_version", r."is_tombstone", NULL::bytea, r."value_sha256", r."insertion_commit_seq", r."insertion_attempt_ordinal")::%1$I."fx_app_row_rev" AS revision INTO captured
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
    latest_tombstone := latest."is_tombstone"; latest_creation_time := latest."creation_time";
    latest_insertion_commit_seq := latest."insertion_commit_seq";
    latest_insertion_attempt_ordinal := latest."insertion_attempt_ordinal"; RETURN NEXT;
  END LOOP; END IF;
  ordinal := NULL; pointer_sequence := NULL; latest_sequence := NULL; latest_tombstone := NULL; latest_creation_time := NULL;
  latest_insertion_commit_seq := NULL; latest_insertion_attempt_ordinal := NULL;
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
$publication_acceptance$;
$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_app_publication(text,uuid,text,bigint,text,bigint,bigint,bigint,timestamptz,boolean,boolean,integer[],integer[],text[],integer[],bytea[],text[],bigint[],bigint[],boolean[],boolean[],bigint[],uuid[],uuid[],bigint[],text[],integer[],bytea[],double precision[],integer[],integer[],bytea[],bytea[],text[],bytea[],bytea[],integer[],bytea[],bigint[],integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],integer,%1$I.fx_app_unique_owner[],bytea[],bigint[],integer[],bytea[],boolean,text) FROM PUBLIC', target_schema);
END; $stage$;

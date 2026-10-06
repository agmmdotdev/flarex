-- Observe full retained row/index revisions and pointers in one fresh ordered proof per page.
-- Preserve sequential write barriers, function signatures, grants and durable data.
DO $stage$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
CREATE OR REPLACE FUNCTION %1$I.fx_apply_app_row_batch(p_rows %1$I.fx_app_row_write[], p_verify %1$I.fx_app_row_write[])
RETURNS TABLE(reason text, ordinal integer, actual_commit_seq bigint, actual_creation_time double precision)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $row_batch$
DECLARE i integer; n integer := coalesce(array_length(p_rows, 1), 0);
  expected_row %1$I."fx_app_row_rev"; actual_row %1$I."fx_app_row_rev"; pointer_seq bigint; predecessor_time double precision;
  inserted_seq bigint; phase text := 'write'; proof_rows %1$I.fx_app_row_write[]; verification record;
BEGIN
  IF n < 1 OR n > 32 OR n + coalesce(array_length(p_verify, 1), 0) > 512 THEN reason := 'invalidBatch'; ordinal := 0; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text; END IF;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    IF (p_rows[i])."prev_commit_seq" IS NOT NULL THEN
      SELECT r."creation_time" INTO predecessor_time FROM %1$I."fx_app_row_rev" r
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
    INSERT INTO %1$I."fx_app_row_rev" ("scope_uuid", "table_id", "row_id", "commit_seq", "prev_commit_seq", "write_epoch_uuid", "schema_version_id", "creation_time", "value_codec_version", "is_tombstone", "value_bytes", "value_sha256")
      VALUES (expected_row."scope_uuid", expected_row."table_id", expected_row."row_id", expected_row."commit_seq", expected_row."prev_commit_seq", expected_row."write_epoch_uuid", expected_row."schema_version_id", expected_row."creation_time", expected_row."value_codec_version", expected_row."is_tombstone", expected_row."value_bytes", expected_row."value_sha256")
      ON CONFLICT DO NOTHING RETURNING * INTO actual_row;
    IF NOT FOUND THEN reason := 'revisionExists'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text; END IF;
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
      r."commit_seq" IS NOT NULL AND r."scope_uuid" IS NOT DISTINCT FROM proof."scope_uuid" AND r."table_id" IS NOT DISTINCT FROM proof."table_id" AND r."row_id" IS NOT DISTINCT FROM proof."row_id" AND r."commit_seq" IS NOT DISTINCT FROM proof."commit_seq" AND r."prev_commit_seq" IS NOT DISTINCT FROM proof."prev_commit_seq" AND r."write_epoch_uuid" IS NOT DISTINCT FROM proof."write_epoch_uuid" AND r."schema_version_id" IS NOT DISTINCT FROM proof."schema_version_id" AND r."creation_time" IS NOT DISTINCT FROM proof."creation_time" AND r."value_codec_version" IS NOT DISTINCT FROM proof."value_codec_version" AND r."is_tombstone" IS NOT DISTINCT FROM proof."is_tombstone" AND r."value_bytes" IS NOT DISTINCT FROM proof."value_bytes" AND r."value_sha256" IS NOT DISTINCT FROM proof."value_sha256" AS revision_matches,
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
  EXECUTE format($ddl$
CREATE OR REPLACE FUNCTION %1$I.fx_apply_app_index_batch(p_rows %1$I.fx_app_index_write[], p_prior bigint[], p_historical boolean[], p_verify %1$I.fx_app_index_write[])
RETURNS TABLE(reason text, ordinal integer, actual_commit_seq bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $index_batch$
DECLARE i integer; n integer := coalesce(array_length(p_rows, 1), 0); expected_row %1$I."fx_app_index_entry_rev"; actual_row %1$I."fx_app_index_entry_rev";
  latest_row %1$I."fx_app_index_entry_rev"; parent_tombstone boolean; pointer_seq bigint; inserted_seq bigint; phase text := 'write'; proof_rows %1$I.fx_app_index_write[]; verification record;
BEGIN
  IF n < 1 OR n > 32 OR n + coalesce(array_length(p_verify, 1), 0) > 4096 OR array_length(p_prior, 1) IS DISTINCT FROM n OR array_length(p_historical, 1) IS DISTINCT FROM n THEN
    reason := 'invalidBatch'; ordinal := 0; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text;
  END IF;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT r.* INTO latest_row FROM %1$I."fx_app_index_entry_rev" r WHERE r."scope_uuid" = (p_rows[i])."scope_uuid"
      AND r."index_definition_id" = (p_rows[i])."index_definition_id" AND r."encoded_key" = (p_rows[i])."encoded_key"
      AND r."row_id" = (p_rows[i])."row_id" ORDER BY r."commit_seq" DESC LIMIT 1;
    actual_commit_seq := latest_row."commit_seq";
    IF latest_row."commit_seq" IS DISTINCT FROM p_prior[i] THEN reason := 'transitionConflict'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
    IF latest_row."commit_seq" IS NOT NULL AND (latest_row."table_id" IS DISTINCT FROM (p_rows[i])."table_id"
      OR latest_row."key_codec_version" IS DISTINCT FROM (p_rows[i])."key_codec_version"
      OR latest_row."physical_spec_sha256" IS DISTINCT FROM (p_rows[i])."physical_spec_sha256"
      OR latest_row."key_sha256" IS DISTINCT FROM (p_rows[i])."key_sha256") THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
    SELECT c."commit_seq" INTO pointer_seq FROM %1$I."fx_app_index_entry_current" c WHERE c."scope_uuid" = (p_rows[i])."scope_uuid"
      AND c."index_definition_id" = (p_rows[i])."index_definition_id" AND c."encoded_key" = (p_rows[i])."encoded_key" AND c."row_id" = (p_rows[i])."row_id";
    IF (latest_row."commit_seq" IS NULL OR latest_row."is_tombstone") THEN
      IF pointer_seq IS NOT NULL THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
    ELSIF pointer_seq IS DISTINCT FROM latest_row."commit_seq" THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text;
    END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT r."is_tombstone" INTO parent_tombstone FROM %1$I."fx_app_row_current" c JOIN %1$I."fx_app_row_rev" r
      ON r."scope_uuid" = c."scope_uuid" AND r."table_id" = c."table_id" AND r."row_id" = c."row_id" AND r."commit_seq" = c."commit_seq"
      WHERE c."scope_uuid" = (p_rows[i])."scope_uuid" AND c."table_id" = (p_rows[i])."table_id" AND c."row_id" = (p_rows[i])."row_id";
    IF NOT FOUND THEN reason := 'parentMissing'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
    IF NOT p_historical[i] AND NOT (p_rows[i])."is_tombstone" AND parent_tombstone THEN reason := 'parentTombstone'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (p_rows[i])."scope_uuid";
    expected_row."index_definition_id" := (p_rows[i])."index_definition_id";
    expected_row."table_id" := (p_rows[i])."table_id";
    expected_row."key_codec_version" := (p_rows[i])."key_codec_version";
    expected_row."physical_spec_sha256" := (p_rows[i])."physical_spec_sha256";
    expected_row."encoded_key" := (p_rows[i])."encoded_key";
    expected_row."key_sha256" := (p_rows[i])."key_sha256";
    expected_row."row_id" := (p_rows[i])."row_id";
    expected_row."commit_seq" := (p_rows[i])."commit_seq";
    expected_row."is_tombstone" := (p_rows[i])."is_tombstone";
    INSERT INTO %1$I."fx_app_index_entry_rev" ("scope_uuid", "index_definition_id", "table_id", "key_codec_version", "physical_spec_sha256", "encoded_key", "key_sha256", "row_id", "commit_seq", "is_tombstone")
      VALUES (expected_row."scope_uuid", expected_row."index_definition_id", expected_row."table_id", expected_row."key_codec_version", expected_row."physical_spec_sha256", expected_row."encoded_key", expected_row."key_sha256", expected_row."row_id", expected_row."commit_seq", expected_row."is_tombstone")
      ON CONFLICT DO NOTHING RETURNING * INTO actual_row;
    IF NOT FOUND THEN reason := 'revisionExists'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
    IF actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1;
    IF NOT (p_rows[i])."is_tombstone" THEN
      INSERT INTO %1$I."fx_app_index_entry_current"("scope_uuid", "index_definition_id", "encoded_key", "row_id", "commit_seq")
        VALUES ((p_rows[i])."scope_uuid", (p_rows[i])."index_definition_id", (p_rows[i])."encoded_key", (p_rows[i])."row_id", (p_rows[i])."commit_seq")
        ON CONFLICT DO NOTHING RETURNING "commit_seq" INTO inserted_seq;
    ELSE
      DELETE FROM %1$I."fx_app_index_entry_current" c WHERE c."scope_uuid" = (p_rows[i])."scope_uuid"
        AND c."index_definition_id" = (p_rows[i])."index_definition_id" AND c."encoded_key" = (p_rows[i])."encoded_key"
        AND c."row_id" = (p_rows[i])."row_id" AND c."commit_seq" = p_prior[i] RETURNING c."commit_seq" INTO inserted_seq;
    END IF;
    IF inserted_seq IS NULL THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
  END LOOP;
  phase := 'verify'; proof_rows := coalesce(p_verify, ARRAY[]::%1$I.fx_app_index_write[]) || p_rows;
  FOR verification IN SELECT proof.ordinality AS proof_ordinal,
      r."commit_seq" IS NOT NULL AND r."scope_uuid" IS NOT DISTINCT FROM proof."scope_uuid" AND r."index_definition_id" IS NOT DISTINCT FROM proof."index_definition_id" AND r."table_id" IS NOT DISTINCT FROM proof."table_id" AND r."key_codec_version" IS NOT DISTINCT FROM proof."key_codec_version" AND r."physical_spec_sha256" IS NOT DISTINCT FROM proof."physical_spec_sha256" AND r."encoded_key" IS NOT DISTINCT FROM proof."encoded_key" AND r."key_sha256" IS NOT DISTINCT FROM proof."key_sha256" AND r."row_id" IS NOT DISTINCT FROM proof."row_id" AND r."commit_seq" IS NOT DISTINCT FROM proof."commit_seq" AND r."is_tombstone" IS NOT DISTINCT FROM proof."is_tombstone" AS revision_matches,
      c."commit_seq" AS pointer_seq,
      CASE WHEN proof."is_tombstone" THEN NULL ELSE proof."commit_seq" END AS expected_seq
    FROM unnest(proof_rows) WITH ORDINALITY proof
    LEFT JOIN %1$I."fx_app_index_entry_rev" r ON r."scope_uuid" = proof."scope_uuid" AND r."index_definition_id" = proof."index_definition_id" AND r."encoded_key" = proof."encoded_key" AND r."row_id" = proof."row_id" AND r."commit_seq" = proof."commit_seq"
    LEFT JOIN %1$I."fx_app_index_entry_current" c ON c."scope_uuid" = proof."scope_uuid"
      AND c."index_definition_id" = proof."index_definition_id"
      AND c."encoded_key" = proof."encoded_key" AND c."row_id" = proof."row_id"
    ORDER BY proof.ordinality LOOP
    ordinal := verification.proof_ordinal - 1;
    IF NOT verification.revision_matches THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
    IF verification.pointer_seq IS DISTINCT FROM verification.expected_seq THEN
      reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text;
    END IF;
  END LOOP;
  reason := 'accepted'; ordinal := n; actual_commit_seq := NULL; RETURN NEXT;
END;
$index_batch$;$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_row_batch(%1$I.fx_app_row_write[], %1$I.fx_app_row_write[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_index_batch(%1$I.fx_app_index_write[], bigint[], boolean[], %1$I.fx_app_index_write[]) FROM PUBLIC', target_schema);
END;
$stage$;

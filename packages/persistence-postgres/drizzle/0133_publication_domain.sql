-- Fixed finite publication observations and shared bounded Application writers.
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
CREATE TYPE %1$I."fx_app_row_write" AS (
  "scope_uuid" uuid,
  "table_id" integer,
  "row_id" bytea,
  "commit_seq" bigint,
  "prev_commit_seq" bigint,
  "write_epoch_uuid" uuid,
  "schema_version_id" text,
  "creation_time" double precision,
  "value_codec_version" integer,
  "is_tombstone" boolean,
  "value_bytes" bytea,
  "value_sha256" bytea
);$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE TYPE %1$I."fx_app_index_write" AS (
  "scope_uuid" uuid,
  "index_definition_id" integer,
  "table_id" integer,
  "key_codec_version" integer,
  "physical_spec_sha256" bytea,
  "encoded_key" bytea,
  "key_sha256" bytea,
  "row_id" bytea,
  "commit_seq" bigint,
  "is_tombstone" boolean
);$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE TYPE %1$I."fx_app_unique_write" AS (
  "scope_uuid" uuid,
  "constraint_id" integer,
  "locale_key" text,
  "canonical_key_sha256" bytea,
  "key_codec_version" integer,
  "encoded_key" bytea,
  "table_id" integer,
  "row_id" bytea
);$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE TYPE %1$I."fx_app_unique_owner" AS (
  "scope_uuid" uuid,
  "constraint_id" integer,
  "locale_key" text,
  "table_id" integer,
  "row_id" bytea
);$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE TYPE %1$I."fx_app_search_write" AS (
  "scope_uuid" uuid,
  "table_id" integer,
  "logical_index_id" integer,
  "source_sha256" text,
  "field_id" text,
  "row_id" bytea,
  "commit_seq" bigint,
  "folded_text" text
);$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE TYPE %1$I."fx_app_json_write" AS (
  "scope_uuid" uuid,
  "table_id" integer,
  "logical_index_id" integer,
  "source_sha256" text,
  "field_id" text,
  "row_id" bytea,
  "commit_seq" bigint,
  "value_json" jsonb
);$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE TYPE %1$I."fx_app_index_coverage" AS (
  "scope_id" text,
  "index_definition_id" integer,
  "attempt_fence" bigint,
  "epoch" text,
  "storage_generation_fence" bigint
);$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE TYPE %1$I."fx_app_unique_coverage" AS (
  "scope_id" text,
  "unique_constraint_definition_id" integer,
  "attempt_fence" bigint,
  "epoch" text,
  "storage_generation_fence" bigint
);$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_lock_finite_publication_anchor(p_scope_uuid uuid, p_session_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $publication_lock$
DECLARE found_session boolean;
BEGIN
  SELECT true INTO found_session FROM %1$I."fx_system_tx_session" s
    WHERE s."scope_uuid" = p_scope_uuid
      AND s."session_id" = p_session_id
    FOR UPDATE;
  RETURN coalesce(found_session, false);
END
$publication_lock$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_observe_finite_publication(
  p_scope_uuid uuid, p_session_id uuid, p_request_key text, p_expected jsonb)
RETURNS TABLE(reason text, outcome %1$I."fx_system_idempotency", retained_header %1$I."fx_system_commit", database_now timestamptz, "lifecycle" text, "updated_at" timestamp with time zone, "finite_lease_expires_at" timestamp with time zone, "finite_claim_owner" uuid, "finite_claim_fence" bigint, "finite_claimed_at" timestamp with time zone, "finite_claim_expires_at" timestamp with time zone)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $publication_anchor$
DECLARE
  actual_session %1$I."fx_system_tx_session";
  expected_session %1$I."fx_system_tx_session";
  actual_outcome %1$I."fx_system_idempotency";
  actual_header %1$I."fx_system_commit";
BEGIN
  IF NOT %1$I.fx_lock_finite_publication_anchor(p_scope_uuid, p_session_id) THEN
    RETURN QUERY SELECT 'attemptMissing'::text, NULL::%1$I."fx_system_idempotency", NULL::%1$I."fx_system_commit", NULL::timestamptz, NULL::text, NULL::timestamp with time zone, NULL::timestamp with time zone, NULL::uuid, NULL::bigint, NULL::timestamp with time zone, NULL::timestamp with time zone;
    RETURN;
  END IF;
  SELECT o.* INTO actual_outcome FROM %1$I."fx_system_idempotency" o
    WHERE o."scope_uuid" = p_scope_uuid
      AND o."request_key" = p_request_key;
  IF FOUND THEN
    SELECT c.* INTO actual_header FROM %1$I."fx_system_commit" c
      WHERE c."scope_uuid" = p_scope_uuid
        AND c."commit_seq" = actual_outcome."commit_seq";
    RETURN QUERY SELECT 'replay'::text, actual_outcome, actual_header, NULL::timestamptz, NULL::text, NULL::timestamp with time zone, NULL::timestamp with time zone, NULL::uuid, NULL::bigint, NULL::timestamp with time zone, NULL::timestamp with time zone;
    RETURN;
  END IF;
  SELECT s.* INTO actual_session FROM %1$I."fx_system_tx_session" s
    WHERE s."scope_uuid" = p_scope_uuid
      AND s."session_id" = p_session_id;
  SELECT * INTO expected_session FROM jsonb_populate_record(NULL::%1$I."fx_system_tx_session", p_expected);
  IF NOT (actual_session."scope_uuid" IS NOT DISTINCT FROM expected_session."scope_uuid" AND actual_session."session_id" IS NOT DISTINCT FROM expected_session."session_id" AND actual_session."execution_profile" IS NOT DISTINCT FROM expected_session."execution_profile" AND actual_session."finite_attempt_bytes" IS NOT DISTINCT FROM expected_session."finite_attempt_bytes" AND actual_session."finite_attempt_sha256" IS NOT DISTINCT FROM expected_session."finite_attempt_sha256" AND actual_session."finite_snapshot_epoch_uuid" IS NOT DISTINCT FROM expected_session."finite_snapshot_epoch_uuid" AND actual_session."finite_snapshot_commit_seq" IS NOT DISTINCT FROM expected_session."finite_snapshot_commit_seq" AND actual_session."finite_metadata_watermark" IS NOT DISTINCT FROM expected_session."finite_metadata_watermark" AND actual_session."storage_generation" IS NOT DISTINCT FROM expected_session."storage_generation" AND actual_session."storage_generation_fence" IS NOT DISTINCT FROM expected_session."storage_generation_fence" AND actual_session."execution_authority_generation" IS NOT DISTINCT FROM expected_session."execution_authority_generation" AND actual_session."application_execution_authority_json" IS NOT DISTINCT FROM expected_session."application_execution_authority_json" AND actual_session."application_execution_authority_canonical_bytes" IS NOT DISTINCT FROM expected_session."application_execution_authority_canonical_bytes" AND actual_session."application_execution_authority_sha256" IS NOT DISTINCT FROM expected_session."application_execution_authority_sha256" AND actual_session."package_id" IS NOT DISTINCT FROM expected_session."package_id" AND actual_session."artifact_runtime" IS NOT DISTINCT FROM expected_session."artifact_runtime" AND actual_session."artifact_id" IS NOT DISTINCT FROM expected_session."artifact_id" AND actual_session."source_package_hash" IS NOT DISTINCT FROM expected_session."source_package_hash" AND actual_session."execution_module" IS NOT DISTINCT FROM expected_session."execution_module" AND actual_session."function_path" IS NOT DISTINCT FROM expected_session."function_path" AND actual_session."function_kind" IS NOT DISTINCT FROM expected_session."function_kind" AND actual_session."schema_version_id" IS NOT DISTINCT FROM expected_session."schema_version_id" AND actual_session."policy_version" IS NOT DISTINCT FROM expected_session."policy_version" AND actual_session."identity_access_policy_sha256" IS NOT DISTINCT FROM expected_session."identity_access_policy_sha256" AND actual_session."validated_args_json" IS NOT DISTINCT FROM expected_session."validated_args_json" AND actual_session."validated_args_value_codec_version" IS NOT DISTINCT FROM expected_session."validated_args_value_codec_version" AND actual_session."validated_args_canonical_bytes" IS NOT DISTINCT FROM expected_session."validated_args_canonical_bytes" AND actual_session."validated_args_sha256" IS NOT DISTINCT FROM expected_session."validated_args_sha256" AND actual_session."authorization_grant_id" IS NOT DISTINCT FROM expected_session."authorization_grant_id" AND actual_session."authorization_grant_json" IS NOT DISTINCT FROM expected_session."authorization_grant_json" AND actual_session."authorization_grant_value_codec_version" IS NOT DISTINCT FROM expected_session."authorization_grant_value_codec_version" AND actual_session."authorization_grant_canonical_bytes" IS NOT DISTINCT FROM expected_session."authorization_grant_canonical_bytes" AND actual_session."authorization_grant_sha256" IS NOT DISTINCT FROM expected_session."authorization_grant_sha256" AND actual_session."authorization_revocation_epoch" IS NOT DISTINCT FROM expected_session."authorization_revocation_epoch" AND actual_session."authorization_grant_expires_at" IS NOT DISTINCT FROM expected_session."authorization_grant_expires_at" AND actual_session."request_key" IS NOT DISTINCT FROM expected_session."request_key" AND actual_session."request_sha256" IS NOT DISTINCT FROM expected_session."request_sha256" AND actual_session."attempt_fence" IS NOT DISTINCT FROM expected_session."attempt_fence" AND actual_session."protocol_version" IS NOT DISTINCT FROM expected_session."protocol_version" AND actual_session."hard_expires_at" IS NOT DISTINCT FROM expected_session."hard_expires_at" AND actual_session."created_at" IS NOT DISTINCT FROM expected_session."created_at") THEN
    RETURN QUERY SELECT 'storedCorruption'::text, NULL::%1$I."fx_system_idempotency", NULL::%1$I."fx_system_commit", NULL::timestamptz, NULL::text, NULL::timestamp with time zone, NULL::timestamp with time zone, NULL::uuid, NULL::bigint, NULL::timestamp with time zone, NULL::timestamp with time zone;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'accepted'::text, NULL::%1$I."fx_system_idempotency", NULL::%1$I."fx_system_commit", clock_timestamp(), actual_session."lifecycle", actual_session."updated_at", actual_session."finite_lease_expires_at", actual_session."finite_claim_owner", actual_session."finite_claim_fence", actual_session."finite_claimed_at", actual_session."finite_claim_expires_at";
END
$publication_anchor$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_advance_scope_publication_clock(
  p_scope_uuid uuid, p_previous_commit_seq bigint, p_commit_seq bigint,
  p_publication_time timestamptz)
RETURNS TABLE(reason text, last_commit_seq bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $publication_clock$
DECLARE
  expected_clock %1$I."fx_system_scope_clock";
  actual_clock %1$I."fx_system_scope_clock";
BEGIN
  SELECT c.* INTO expected_clock FROM %1$I."fx_system_scope_clock" c
    WHERE c."scope_uuid" = p_scope_uuid
      AND c."last_commit_seq" = p_previous_commit_seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scope publication clock changed' USING ERRCODE = 'FX001', DETAIL = 'publicationClockChanged';
  END IF;
  expected_clock."last_commit_seq" := p_commit_seq;
  expected_clock."updated_at" := p_publication_time;
  UPDATE %1$I."fx_system_scope_clock" actual SET "last_commit_seq" = p_commit_seq, "updated_at" = p_publication_time
    WHERE actual."scope_uuid" = p_scope_uuid AND actual."last_commit_seq" = p_previous_commit_seq;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scope publication clock changed' USING ERRCODE = 'FX001', DETAIL = 'publicationClockChanged';
  END IF;
  SELECT c.* INTO actual_clock FROM %1$I."fx_system_scope_clock" c WHERE c."scope_uuid" = p_scope_uuid;
  IF NOT FOUND OR actual_clock IS DISTINCT FROM expected_clock THEN
    RAISE EXCEPTION 'Scope publication clock stored row changed' USING ERRCODE = 'FX001', DETAIL = 'publicationClockStoredCorruption';
  END IF;
  RETURN QUERY SELECT 'accepted'::text, actual_clock."last_commit_seq";
END
$publication_clock$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I."fx_write_scope_publication_header"(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows %1$I."fx_system_commit"[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 1 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::%1$I."fx_system_commit"[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit", p_rows) expected;
  WITH written AS (
    INSERT INTO %1$I."fx_system_commit" ("scope_uuid", "epoch_uuid", "commit_seq", "change_count", "relation_adjacency_change_count", "payload_preference_deletion_count", "relational_change_count", "event_count", "event_sha256", "committed_at")
      SELECT expected."scope_uuid", expected."epoch_uuid", expected."commit_seq", expected."change_count", expected."relation_adjacency_change_count", expected."payload_preference_deletion_count", expected."relational_change_count", expected."event_count", expected."event_sha256", expected."committed_at" FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::%1$I."fx_system_commit" IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN %1$I."fx_system_commit" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq"
    WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  RETURN written_count;
END;
$publication_family$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I."fx_write_scope_publication_rows"(p_rows jsonb, p_verify jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows %1$I."fx_system_commit_app_row_change"[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::%1$I."fx_system_commit_app_row_change"[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_app_row_change", p_rows) expected;
  WITH written AS (
    INSERT INTO %1$I."fx_system_commit_app_row_change" ("scope_uuid", "epoch_uuid", "commit_seq", "change_ordinal", "table_id", "row_id")
      SELECT expected."scope_uuid", expected."epoch_uuid", expected."commit_seq", expected."change_ordinal", expected."table_id", expected."row_id" FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::%1$I."fx_system_commit_app_row_change" IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN %1$I."fx_system_commit_app_row_change" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."change_ordinal" IS NOT DISTINCT FROM expected."change_ordinal"
    WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
    IF jsonb_typeof(p_verify) IS DISTINCT FROM 'array' OR jsonb_array_length(p_verify) > 16000 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_app_row_change", p_verify) expected
      LEFT JOIN %1$I."fx_system_commit_app_row_change" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."change_ordinal" IS NOT DISTINCT FROM expected."change_ordinal" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  RETURN written_count;
END;
$publication_family$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I."fx_write_scope_publication_relations"(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows %1$I."fx_system_commit_relation_adjacency_change"[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::%1$I."fx_system_commit_relation_adjacency_change"[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_relation_adjacency_change", p_rows) expected;
  WITH written AS (
    INSERT INTO %1$I."fx_system_commit_relation_adjacency_change" ("scope_uuid", "epoch_uuid", "commit_seq", "change_ordinal", "edge_definition_id", "direction", "endpoint_row_id")
      SELECT expected."scope_uuid", expected."epoch_uuid", expected."commit_seq", expected."change_ordinal", expected."edge_definition_id", expected."direction", expected."endpoint_row_id" FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::%1$I."fx_system_commit_relation_adjacency_change" IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN %1$I."fx_system_commit_relation_adjacency_change" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."change_ordinal" IS NOT DISTINCT FROM expected."change_ordinal"
    WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  RETURN written_count;
END;
$publication_family$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I."fx_write_scope_publication_relational"(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows %1$I."fx_system_commit_relational_change"[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 500 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::%1$I."fx_system_commit_relational_change"[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_relational_change", p_rows) expected;
  WITH written AS (
    INSERT INTO %1$I."fx_system_commit_relational_change" ("scope_uuid", "epoch_uuid", "commit_seq", "change_ordinal", "codec_version", "installation_sha256", "artifact_sha256", "table_id", "key_bytes", "operation")
      SELECT expected."scope_uuid", expected."epoch_uuid", expected."commit_seq", expected."change_ordinal", expected."codec_version", expected."installation_sha256", expected."artifact_sha256", expected."table_id", expected."key_bytes", expected."operation" FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::%1$I."fx_system_commit_relational_change" IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN %1$I."fx_system_commit_relational_change" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."change_ordinal" IS NOT DISTINCT FROM expected."change_ordinal"
    WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  RETURN written_count;
END;
$publication_family$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I."fx_write_scope_publication_events"(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows %1$I."fx_system_commit_event"[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 64 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::%1$I."fx_system_commit_event"[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_event", p_rows) expected;
  WITH written AS (
    INSERT INTO %1$I."fx_system_commit_event" ("scope_uuid", "epoch_uuid", "commit_seq", "event_ordinal", "envelope")
      SELECT expected."scope_uuid", expected."epoch_uuid", expected."commit_seq", expected."event_ordinal", expected."envelope" FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::%1$I."fx_system_commit_event" IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN %1$I."fx_system_commit_event" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."event_ordinal" IS NOT DISTINCT FROM expected."event_ordinal"
    WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  RETURN written_count;
END;
$publication_family$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I."fx_write_scope_publication_deliveries"(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows %1$I."fx_system_commit_event_delivery"[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 512 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::%1$I."fx_system_commit_event_delivery"[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_event_delivery", p_rows) expected;
  WITH written AS (
    INSERT INTO %1$I."fx_system_commit_event_delivery" ("scope_uuid", "epoch_uuid", "commit_seq", "event_ordinal", "subscriber_id", "handler_revision", "state", "attempts", "fence", "owner", "lease_expires_at", "next_attempt_at", "failure_code", "settled_at")
      SELECT expected."scope_uuid", expected."epoch_uuid", expected."commit_seq", expected."event_ordinal", expected."subscriber_id", expected."handler_revision", expected."state", expected."attempts", expected."fence", expected."owner", expected."lease_expires_at", expected."next_attempt_at", expected."failure_code", expected."settled_at" FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::%1$I."fx_system_commit_event_delivery" IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN %1$I."fx_system_commit_event_delivery" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."event_ordinal" IS NOT DISTINCT FROM expected."event_ordinal" AND actual."subscriber_id" IS NOT DISTINCT FROM expected."subscriber_id"
    WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  RETURN written_count;
END;
$publication_family$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I."fx_write_scope_publication_outcome"(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows %1$I."fx_system_idempotency"[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 1 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::%1$I."fx_system_idempotency"[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::%1$I."fx_system_idempotency", p_rows) expected;
  WITH written AS (
    INSERT INTO %1$I."fx_system_idempotency" ("scope_uuid", "request_key", "identity_access_policy_sha256", "function_path", "request_sha256", "epoch_uuid", "commit_seq", "result_state", "result_encoding", "result_value_codec_version", "result_semantic_bytes", "result_bytes", "result_sha256", "result_expired_at", "created_at")
      SELECT expected."scope_uuid", expected."request_key", expected."identity_access_policy_sha256", expected."function_path", expected."request_sha256", expected."epoch_uuid", expected."commit_seq", expected."result_state", expected."result_encoding", expected."result_value_codec_version", expected."result_semantic_bytes", expected."result_bytes", expected."result_sha256", expected."result_expired_at", expected."created_at" FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::%1$I."fx_system_idempotency" IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN %1$I."fx_system_idempotency" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."request_key" IS NOT DISTINCT FROM expected."request_key"
    WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  RETURN written_count;
END;
$publication_family$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I."fx_write_scope_publication_wake"(p_rows jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_family$
DECLARE expected_rows %1$I."fx_system_commit_wake"[]; written_count integer; written_match boolean;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 1 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT coalesce(array_agg(expected), ARRAY[]::%1$I."fx_system_commit_wake"[]) INTO expected_rows
    FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_wake", p_rows) expected;
  WITH written AS (
    INSERT INTO %1$I."fx_system_commit_wake" ("scope_uuid", "epoch_uuid", "commit_seq", "delivery_state", "created_at", "next_attempt_at", "claim_fence", "claim_owner", "claimed_at", "claim_expires_at", "last_failure_code", "last_failure_summary", "last_failed_at", "delivered_at", "dead_lettered_at")
      SELECT expected."scope_uuid", expected."epoch_uuid", expected."commit_seq", expected."delivery_state", expected."created_at", expected."next_attempt_at", expected."claim_fence", expected."claim_owner", expected."claimed_at", expected."claim_expires_at", expected."last_failure_code", expected."last_failure_summary", expected."last_failed_at", expected."delivered_at", expected."dead_lettered_at" FROM unnest(expected_rows) expected
      RETURNING *
  ) SELECT count(*)::integer, coalesce(bool_and(EXISTS(SELECT 1 FROM unnest(expected_rows) expected
    WHERE ROW(written.*)::%1$I."fx_system_commit_wake" IS NOT DISTINCT FROM expected)), true)
    INTO written_count, written_match FROM written;
  IF written_count <> cardinality(expected_rows) OR NOT written_match THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(expected_rows) expected LEFT JOIN %1$I."fx_system_commit_wake" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq"
    WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  RETURN written_count;
END;
$publication_family$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_finish_scope_publication_session(p_session jsonb, publication_time timestamptz) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_session$
DECLARE expected_session %1$I."fx_system_tx_session"; actual_session %1$I."fx_system_tx_session";
BEGIN
  IF p_session IS NULL THEN RETURN true; END IF;
  SELECT * INTO expected_session FROM jsonb_populate_record(NULL::%1$I."fx_system_tx_session", p_session);
  SELECT actual.* INTO actual_session FROM %1$I."fx_system_tx_session" actual
    WHERE actual."scope_uuid" = expected_session."scope_uuid"
      AND actual."session_id" = expected_session."session_id";
  IF NOT FOUND OR actual_session."lifecycle" <> 'running'
    OR actual_session."attempt_fence" IS DISTINCT FROM expected_session."attempt_fence"
    OR actual_session."finite_claim_owner" IS DISTINCT FROM expected_session."finite_claim_owner"
    OR actual_session."finite_claim_fence" IS DISTINCT FROM expected_session."finite_claim_fence" THEN
    RAISE EXCEPTION 'Scope publication session changed' USING ERRCODE = 'FX001', DETAIL = 'publicationSessionChanged';
  END IF;
  IF actual_session IS DISTINCT FROM expected_session THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  
  expected_session."lifecycle" := 'committed';
  expected_session."updated_at" := publication_time;
  expected_session."validated_args_json" := NULL;
  expected_session."validated_args_canonical_bytes" := NULL;
  expected_session."authorization_grant_json" := NULL;
  expected_session."authorization_grant_canonical_bytes" := NULL;
  expected_session."application_execution_authority_json" := NULL;
  expected_session."application_execution_authority_canonical_bytes" := NULL;

  UPDATE %1$I."fx_system_tx_session" actual SET
    "lifecycle" = expected_session."lifecycle", "updated_at" = expected_session."updated_at", "validated_args_json" = expected_session."validated_args_json", "validated_args_canonical_bytes" = expected_session."validated_args_canonical_bytes", "authorization_grant_json" = expected_session."authorization_grant_json", "authorization_grant_canonical_bytes" = expected_session."authorization_grant_canonical_bytes", "application_execution_authority_json" = expected_session."application_execution_authority_json", "application_execution_authority_canonical_bytes" = expected_session."application_execution_authority_canonical_bytes"
    WHERE actual."scope_uuid" = expected_session."scope_uuid"
      AND actual."session_id" = expected_session."session_id"
    RETURNING actual.* INTO actual_session;
  IF NOT FOUND OR actual_session IS DISTINCT FROM expected_session THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT actual.* INTO actual_session FROM %1$I."fx_system_tx_session" actual
    WHERE actual."scope_uuid" = expected_session."scope_uuid"
      AND actual."session_id" = expected_session."session_id";
  IF NOT FOUND OR actual_session IS DISTINCT FROM expected_session THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  RETURN true;
END;
$publication_session$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_prove_scope_publication_prefix(p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_proof$
DECLARE header %1$I."fx_system_commit"; expected_session %1$I."fx_system_tx_session"; actual_session %1$I."fx_system_tx_session"; publication_time timestamptz;
BEGIN
  IF jsonb_typeof(p_expected->'header') IS DISTINCT FROM 'array' OR jsonb_array_length(p_expected->'header') <> 1 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT * INTO header FROM jsonb_populate_record(NULL::%1$I."fx_system_commit", p_expected->'header'->0);
  
    IF p_expected ? 'header' THEN
      IF (SELECT count(*) FROM %1$I."fx_system_commit" actual WHERE actual."scope_uuid" = header."scope_uuid"
        AND actual."commit_seq" = header."commit_seq") <> jsonb_array_length(p_expected->'header')
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit", p_expected->'header') expected
          LEFT JOIN %1$I."fx_system_commit" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    END IF;

    IF p_expected ? 'rows' THEN
      IF (SELECT count(*) FROM %1$I."fx_system_commit_app_row_change" actual WHERE actual."scope_uuid" = header."scope_uuid"
        AND actual."commit_seq" = header."commit_seq") <> jsonb_array_length(p_expected->'rows')
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_app_row_change", p_expected->'rows') expected
          LEFT JOIN %1$I."fx_system_commit_app_row_change" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."change_ordinal" IS NOT DISTINCT FROM expected."change_ordinal" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    END IF;

    IF p_expected ? 'relations' THEN
      IF (SELECT count(*) FROM %1$I."fx_system_commit_relation_adjacency_change" actual WHERE actual."scope_uuid" = header."scope_uuid"
        AND actual."commit_seq" = header."commit_seq") <> jsonb_array_length(p_expected->'relations')
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_relation_adjacency_change", p_expected->'relations') expected
          LEFT JOIN %1$I."fx_system_commit_relation_adjacency_change" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."change_ordinal" IS NOT DISTINCT FROM expected."change_ordinal" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    END IF;

    IF p_expected ? 'relational' THEN
      IF (SELECT count(*) FROM %1$I."fx_system_commit_relational_change" actual WHERE actual."scope_uuid" = header."scope_uuid"
        AND actual."commit_seq" = header."commit_seq") <> jsonb_array_length(p_expected->'relational')
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_relational_change", p_expected->'relational') expected
          LEFT JOIN %1$I."fx_system_commit_relational_change" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."change_ordinal" IS NOT DISTINCT FROM expected."change_ordinal" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    END IF;

    IF p_expected ? 'events' THEN
      IF (SELECT count(*) FROM %1$I."fx_system_commit_event" actual WHERE actual."scope_uuid" = header."scope_uuid"
        AND actual."commit_seq" = header."commit_seq") <> jsonb_array_length(p_expected->'events')
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_event", p_expected->'events') expected
          LEFT JOIN %1$I."fx_system_commit_event" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."event_ordinal" IS NOT DISTINCT FROM expected."event_ordinal" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    END IF;

    IF p_expected ? 'deliveries' THEN
      IF (SELECT count(*) FROM %1$I."fx_system_commit_event_delivery" actual WHERE actual."scope_uuid" = header."scope_uuid"
        AND actual."commit_seq" = header."commit_seq") <> jsonb_array_length(p_expected->'deliveries')
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_event_delivery", p_expected->'deliveries') expected
          LEFT JOIN %1$I."fx_system_commit_event_delivery" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" AND actual."event_ordinal" IS NOT DISTINCT FROM expected."event_ordinal" AND actual."subscriber_id" IS NOT DISTINCT FROM expected."subscriber_id" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    END IF;

    IF p_expected ? 'outcome' THEN
      IF (SELECT count(*) FROM %1$I."fx_system_idempotency" actual WHERE actual."scope_uuid" = header."scope_uuid"
        AND actual."commit_seq" = header."commit_seq") <> jsonb_array_length(p_expected->'outcome')
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_idempotency", p_expected->'outcome') expected
          LEFT JOIN %1$I."fx_system_idempotency" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."request_key" IS NOT DISTINCT FROM expected."request_key" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    END IF;

    IF p_expected ? 'wake' THEN
      IF (SELECT count(*) FROM %1$I."fx_system_commit_wake" actual WHERE actual."scope_uuid" = header."scope_uuid"
        AND actual."commit_seq" = header."commit_seq") <> jsonb_array_length(p_expected->'wake')
        OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::%1$I."fx_system_commit_wake", p_expected->'wake') expected
          LEFT JOIN %1$I."fx_system_commit_wake" actual ON actual."scope_uuid" IS NOT DISTINCT FROM expected."scope_uuid" AND actual."commit_seq" IS NOT DISTINCT FROM expected."commit_seq" WHERE actual IS DISTINCT FROM expected) THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    END IF;
  IF p_expected->'session' IS NOT NULL AND p_expected->'session' <> 'null'::jsonb THEN
    SELECT * INTO expected_session FROM jsonb_populate_record(NULL::%1$I."fx_system_tx_session", p_expected->'session');
    publication_time := header."committed_at";
    
  expected_session."lifecycle" := 'committed';
  expected_session."updated_at" := publication_time;
  expected_session."validated_args_json" := NULL;
  expected_session."validated_args_canonical_bytes" := NULL;
  expected_session."authorization_grant_json" := NULL;
  expected_session."authorization_grant_canonical_bytes" := NULL;
  expected_session."application_execution_authority_json" := NULL;
  expected_session."application_execution_authority_canonical_bytes" := NULL;

    SELECT actual.* INTO actual_session FROM %1$I."fx_system_tx_session" actual
      WHERE actual."scope_uuid" = expected_session."scope_uuid"
        AND actual."session_id" = expected_session."session_id";
    IF NOT FOUND OR actual_session IS DISTINCT FROM expected_session THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  END IF;
  RETURN true;
END;
$publication_proof$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_finish_scope_publication_prefix(p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_terminal$
DECLARE batch jsonb; publication_time timestamptz;
BEGIN
  
    IF jsonb_typeof(p_expected->'relations') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->'relations') > 16000
       THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->'relations') WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / 500 ORDER BY (member.ordinality - 1) / 500
    LOOP PERFORM %1$I."fx_write_scope_publication_relations"(batch); END LOOP;
  

    IF jsonb_typeof(p_expected->'relational') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->'relational') > 16000
       THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->'relational') WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / 500 ORDER BY (member.ordinality - 1) / 500
    LOOP PERFORM %1$I."fx_write_scope_publication_relational"(batch); END LOOP;
  

    IF jsonb_typeof(p_expected->'events') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->'events') > 2048
       THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->'events') WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / 64 ORDER BY (member.ordinality - 1) / 64
    LOOP PERFORM %1$I."fx_write_scope_publication_events"(batch); END LOOP;
  

    IF jsonb_typeof(p_expected->'deliveries') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->'deliveries') > 16384
       THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->'deliveries') WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / 512 ORDER BY (member.ordinality - 1) / 512
    LOOP PERFORM %1$I."fx_write_scope_publication_deliveries"(batch); END LOOP;
  

    IF jsonb_typeof(p_expected->'outcome') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->'outcome') > 1
      OR jsonb_array_length(p_expected->'outcome') <> 1 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->'outcome') WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / 1 ORDER BY (member.ordinality - 1) / 1
    LOOP PERFORM %1$I."fx_write_scope_publication_outcome"(batch); END LOOP;
  

    IF jsonb_typeof(p_expected->'wake') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->'wake') > 1
      OR jsonb_array_length(p_expected->'wake') <> 1 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->'wake') WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / 1 ORDER BY (member.ordinality - 1) / 1
    LOOP PERFORM %1$I."fx_write_scope_publication_wake"(batch); END LOOP;
  
  publication_time := (p_expected->'header'->0->>'committed_at')::timestamptz;
  PERFORM %1$I.fx_finish_scope_publication_session(nullif(p_expected->'session', 'null'::jsonb), publication_time);
  RETURN %1$I.fx_prove_scope_publication_prefix(p_expected);
END;
$publication_terminal$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_write_scope_publication_prefix(p_expected jsonb) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_complete$
DECLARE batch jsonb; publication_time timestamptz;
BEGIN
  
    IF jsonb_typeof(p_expected->'header') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->'header') > 1
      OR jsonb_array_length(p_expected->'header') <> 1 THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->'header') WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / 1 ORDER BY (member.ordinality - 1) / 1
    LOOP PERFORM %1$I."fx_write_scope_publication_header"(batch); END LOOP;
  

    IF jsonb_typeof(p_expected->'rows') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_expected->'rows') > 16000
       THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
    FOR batch IN SELECT jsonb_agg(member.value ORDER BY member.ordinality)
      FROM jsonb_array_elements(p_expected->'rows') WITH ORDINALITY member(value, ordinality)
      GROUP BY (member.ordinality - 1) / 500 ORDER BY (member.ordinality - 1) / 500
    LOOP PERFORM %1$I."fx_write_scope_publication_rows"(batch, '[]'::jsonb); END LOOP;
  
  RETURN %1$I.fx_finish_scope_publication_prefix(p_expected);
END;
$publication_complete$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_set_scope_publication_header_counts(p_header jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_counts$
DECLARE expected %1$I."fx_system_commit"; previous %1$I."fx_system_commit"; actual %1$I."fx_system_commit";
BEGIN
  SELECT * INTO expected FROM jsonb_populate_record(NULL::%1$I."fx_system_commit", p_header->0);
  SELECT stored.* INTO actual FROM %1$I."fx_system_commit" stored
    WHERE stored."scope_uuid" = expected."scope_uuid"
      AND stored."commit_seq" = expected."commit_seq";
  IF NOT FOUND THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  previous := actual;
  previous."change_count" := expected."change_count";
  previous."relation_adjacency_change_count" := expected."relation_adjacency_change_count";
  IF previous IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  UPDATE %1$I."fx_system_commit" SET "change_count" = expected."change_count",
    "relation_adjacency_change_count" = expected."relation_adjacency_change_count"
    WHERE "scope_uuid" = expected."scope_uuid"
      AND "commit_seq" = expected."commit_seq" RETURNING * INTO actual;
  IF NOT FOUND OR actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  SELECT stored.* INTO actual FROM %1$I."fx_system_commit" stored
    WHERE stored."scope_uuid" = expected."scope_uuid"
      AND stored."commit_seq" = expected."commit_seq";
  IF NOT FOUND OR actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Scope publication stored contribution differs' USING ERRCODE = 'FX001', DETAIL = 'publicationStoredCorruption'; END IF;
  RETURN 1;
END;
$publication_counts$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_refuse_scope_publication_metadata() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_guard$
BEGIN
  RAISE EXCEPTION 'Scope publication metadata changed' USING ERRCODE = 'FX001', DETAIL = 'publicationMetadataChanged';
END;
$publication_guard$;
$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_advance_app_coverage(p_indexes %1$I.fx_app_index_coverage[],
  p_unique %1$I.fx_app_unique_coverage[], p_seq bigint, p_prior bigint, p_check_prior boolean,
  p_verify_indexes %1$I.fx_app_index_coverage[], p_verify_unique %1$I.fx_app_unique_coverage[],
  p_verify_index_proofs text[], p_verify_unique_proofs text[])
RETURNS TABLE(reason text, family text, ordinal integer, index_proofs text[], unique_proofs text[])
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $coverage$
DECLARE i integer; n integer; stage text := 'write'; expected_index %1$I."fx_system_index_build_state"; actual_index %1$I."fx_system_index_build_state";
  expected_unique %1$I."fx_system_unique_constraint_build"; actual_unique %1$I."fx_system_unique_constraint_build"; sampled_now timestamptz := clock_timestamp();
  expected_indexes %1$I."fx_system_index_build_state"[] := ARRAY[]::%1$I."fx_system_index_build_state"[];
  expected_uniques %1$I."fx_system_unique_constraint_build"[] := ARRAY[]::%1$I."fx_system_unique_constraint_build"[];
BEGIN
  family := 'index'; ordinal := 0; index_proofs := ARRAY[]::text[]; unique_proofs := ARRAY[]::text[];
  IF coalesce(array_length(p_indexes, 1), 0) > 32 OR coalesce(array_length(p_unique, 1), 0) > 32
    OR coalesce(array_length(p_indexes, 1), 0) + coalesce(array_length(p_unique, 1), 0) +
       coalesce(array_length(p_verify_indexes, 1), 0) + coalesce(array_length(p_verify_unique, 1), 0) > 512
    OR coalesce(array_length(p_verify_indexes, 1), 0) <> coalesce(array_length(p_verify_index_proofs, 1), 0)
    OR coalesce(array_length(p_verify_unique, 1), 0) <> coalesce(array_length(p_verify_unique_proofs, 1), 0)
    THEN reason := 'invalidBatch'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
  n := coalesce(array_length(p_indexes, 1), 0);
  IF n > 0 THEN FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT b.* INTO expected_index FROM %1$I."fx_system_index_build_state" b WHERE
      b."scope_id" IS NOT DISTINCT FROM (p_indexes[i])."scope_id" AND b."index_definition_id" IS NOT DISTINCT FROM (p_indexes[i])."index_definition_id" AND b."attempt_fence" IS NOT DISTINCT FROM (p_indexes[i])."attempt_fence" AND b."epoch" IS NOT DISTINCT FROM (p_indexes[i])."epoch" AND b."storage_generation_fence" IS NOT DISTINCT FROM (p_indexes[i])."storage_generation_fence"
      AND b."lifecycle" = 'enabled'
      AND b."maintenance_bytes" IS NULL
      AND (NOT p_check_prior OR b."covered_through_commit_seq" IS NOT DISTINCT FROM p_prior);
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    UPDATE %1$I."fx_system_index_build_state" b SET "covered_through_commit_seq" = p_seq,
      "updated_at" = sampled_now WHERE
      b."scope_id" IS NOT DISTINCT FROM (p_indexes[i])."scope_id" AND b."index_definition_id" IS NOT DISTINCT FROM (p_indexes[i])."index_definition_id" AND b."attempt_fence" IS NOT DISTINCT FROM (p_indexes[i])."attempt_fence" AND b."epoch" IS NOT DISTINCT FROM (p_indexes[i])."epoch" AND b."storage_generation_fence" IS NOT DISTINCT FROM (p_indexes[i])."storage_generation_fence"
      AND b."lifecycle" = 'enabled';
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    expected_index."covered_through_commit_seq" := p_seq;
    expected_index."updated_at" := sampled_now;
    expected_indexes := array_append(expected_indexes, expected_index);
    SELECT b.* INTO actual_index FROM %1$I."fx_system_index_build_state" b WHERE
      b."scope_id" = (p_indexes[i])."scope_id"
      AND b."index_definition_id" = (p_indexes[i])."index_definition_id";
    IF NOT FOUND OR actual_index IS DISTINCT FROM expected_index THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
  END LOOP; END IF;
  family := 'unique'; n := coalesce(array_length(p_unique, 1), 0);
  IF n > 0 THEN FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT b.* INTO expected_unique FROM %1$I."fx_system_unique_constraint_build" b WHERE
      b."scope_id" IS NOT DISTINCT FROM (p_unique[i])."scope_id" AND b."unique_constraint_definition_id" IS NOT DISTINCT FROM (p_unique[i])."unique_constraint_definition_id" AND b."attempt_fence" IS NOT DISTINCT FROM (p_unique[i])."attempt_fence" AND b."epoch" IS NOT DISTINCT FROM (p_unique[i])."epoch" AND b."storage_generation_fence" IS NOT DISTINCT FROM (p_unique[i])."storage_generation_fence"
      AND b."lifecycle" = 'enabled'
      AND b."maintenance_bytes" IS NULL;
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    UPDATE %1$I."fx_system_unique_constraint_build" b SET "covered_through_commit_seq" = p_seq,
      "updated_at" = sampled_now WHERE
      b."scope_id" IS NOT DISTINCT FROM (p_unique[i])."scope_id" AND b."unique_constraint_definition_id" IS NOT DISTINCT FROM (p_unique[i])."unique_constraint_definition_id" AND b."attempt_fence" IS NOT DISTINCT FROM (p_unique[i])."attempt_fence" AND b."epoch" IS NOT DISTINCT FROM (p_unique[i])."epoch" AND b."storage_generation_fence" IS NOT DISTINCT FROM (p_unique[i])."storage_generation_fence"
      AND b."lifecycle" = 'enabled';
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    expected_unique."covered_through_commit_seq" := p_seq;
    expected_unique."updated_at" := sampled_now;
    expected_uniques := array_append(expected_uniques, expected_unique);
    SELECT b.* INTO actual_unique FROM %1$I."fx_system_unique_constraint_build" b WHERE
      b."scope_id" = (p_unique[i])."scope_id"
      AND b."unique_constraint_definition_id" = (p_unique[i])."unique_constraint_definition_id";
    IF NOT FOUND OR actual_unique IS DISTINCT FROM expected_unique THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
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
      SELECT b.* INTO actual_index FROM %1$I."fx_system_index_build_state" b WHERE
        b."scope_id" IS NOT DISTINCT FROM ((p_verify_indexes || p_indexes)[i])."scope_id" AND b."index_definition_id" IS NOT DISTINCT FROM ((p_verify_indexes || p_indexes)[i])."index_definition_id" AND b."attempt_fence" IS NOT DISTINCT FROM ((p_verify_indexes || p_indexes)[i])."attempt_fence" AND b."epoch" IS NOT DISTINCT FROM ((p_verify_indexes || p_indexes)[i])."epoch" AND b."storage_generation_fence" IS NOT DISTINCT FROM ((p_verify_indexes || p_indexes)[i])."storage_generation_fence";
      IF NOT FOUND OR row_to_json(actual_index)::text IS DISTINCT FROM (p_verify_index_proofs || index_proofs)[i]
        THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    END LOOP;
  END IF;
  family := 'unique';
  IF coalesce(array_length(p_verify_unique, 1), 0) + coalesce(array_length(p_unique, 1), 0) > 0 THEN
    FOR i IN 1..(coalesce(array_length(p_verify_unique, 1), 0) + coalesce(array_length(p_unique, 1), 0)) LOOP
      ordinal := i - 1;
      SELECT b.* INTO actual_unique FROM %1$I."fx_system_unique_constraint_build" b WHERE
        b."scope_id" IS NOT DISTINCT FROM ((p_verify_unique || p_unique)[i])."scope_id" AND b."unique_constraint_definition_id" IS NOT DISTINCT FROM ((p_verify_unique || p_unique)[i])."unique_constraint_definition_id" AND b."attempt_fence" IS NOT DISTINCT FROM ((p_verify_unique || p_unique)[i])."attempt_fence" AND b."epoch" IS NOT DISTINCT FROM ((p_verify_unique || p_unique)[i])."epoch" AND b."storage_generation_fence" IS NOT DISTINCT FROM ((p_verify_unique || p_unique)[i])."storage_generation_fence";
      IF NOT FOUND OR row_to_json(actual_unique)::text IS DISTINCT FROM (p_verify_unique_proofs || unique_proofs)[i]
        THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    END LOOP;
  END IF;
  reason := 'accepted'; family := NULL;
  ordinal := coalesce(array_length(p_indexes, 1), 0) + n; RETURN NEXT;
END;
$coverage$;$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_begin_app_materialization(p_scope text, p_deadline timestamptz, p_snapshot boolean)
RETURNS TABLE(reason text, database_now timestamptz, application_head %1$I."fx_system_application_active_head",
  application_activation %1$I."fx_system_application_activation", legacy_schema %1$I."fx_system_application_revision_schema_v1",
  relation_schema %1$I."fx_system_application_revision_schema")
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $materialization_begin$
DECLARE captured record;
BEGIN
  database_now := to_timestamp(trunc(extract(epoch from clock_timestamp()) * 1000) / 1000);
  IF p_deadline <= database_now THEN reason := 'expired'; RETURN NEXT; RETURN; END IF;
  IF p_snapshot THEN
    SELECT h AS head_row, a AS activation_row, l AS legacy_row, s AS relation_row INTO captured
      FROM %1$I."fx_system_application_active_head" h LEFT JOIN %1$I."fx_system_application_activation" a
        ON a."scope_id" = h."scope_id"
        AND a."activation_sequence" = h."activation_sequence"
      LEFT JOIN %1$I."fx_system_application_revision_schema_v1" l
        ON l."scope_id" = h."scope_id"
        AND l."revision_id" = h."revision_id"
      LEFT JOIN %1$I."fx_system_application_revision_schema" s
        ON s."scope_id" = h."scope_id"
        AND s."revision_id" = h."revision_id"
      WHERE h."scope_id" = p_scope;
    IF FOUND THEN application_head := captured.head_row; application_activation := captured.activation_row;
      legacy_schema := captured.legacy_row; relation_schema := captured.relation_row; END IF;
  ELSE
    SELECT h.* INTO application_head FROM %1$I."fx_system_application_active_head" h
      WHERE h."scope_id" = p_scope FOR SHARE;
  END IF;
  reason := 'accepted'; RETURN NEXT;
END;
$materialization_begin$;$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_observe_app_developer_heads(p_scope text, p_scope_uuid uuid, p_indexes integer[],
  p_tables integer[], p_ids bytea[], p_lengths integer[])
RETURNS TABLE(kind text, ordinal integer, developer_build %1$I."fx_system_index_build_state", pointer_commit_seq_text text,
  latest_commit_seq_text text, latest_is_tombstone boolean, latest_creation_time_text text,
  original_scope_uuid uuid, original_write_epoch_uuid uuid, original_prev_commit_seq_text text,
  original_schema_version_id text, original_codec_version integer, original_byte_length_text text,
  original_stored_sha256 bytea, original_actual_sha256 bytea)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $developer_heads$
DECLARE i integer; pointer_seq bigint; latest %1$I."fx_app_row_rev"; captured record;
BEGIN
  ordinal := 0;
  FOR developer_build IN SELECT b.* FROM %1$I."fx_system_index_build_state" b
    WHERE b."scope_id" = p_scope
      AND b."index_definition_id" = ANY(p_indexes)
    ORDER BY b."index_definition_id" FOR SHARE LOOP
    kind := 'developerBuild'; RETURN NEXT; ordinal := ordinal + 1;
  END LOOP;
  developer_build := NULL;
  IF coalesce(array_length(p_ids, 1), 0) > 0 THEN FOR i IN 1..array_length(p_ids, 1) LOOP
    SELECT c."commit_seq" AS pointer_seq, r AS latest_row INTO captured
      FROM (VALUES (1)) AS request(dummy)
      LEFT JOIN %1$I."fx_app_row_current" c ON c."scope_uuid" = p_scope_uuid
        AND c."table_id" = p_tables[i] AND c."row_id" = p_ids[i]
      LEFT JOIN LATERAL (SELECT rev.* FROM %1$I."fx_app_row_rev" rev WHERE rev."scope_uuid" = p_scope_uuid
        AND rev."table_id" = p_tables[i] AND rev."row_id" = p_ids[i]
        ORDER BY rev."commit_seq" DESC LIMIT 1) r ON true;
    pointer_seq := captured.pointer_seq; latest := captured.latest_row;
    kind := 'head'; ordinal := i - 1;
    pointer_commit_seq_text := pointer_seq::text; latest_commit_seq_text := latest."commit_seq"::text;
    latest_is_tombstone := latest."is_tombstone";
    latest_creation_time_text := latest."creation_time"::text;
    original_scope_uuid := latest."scope_uuid";
    original_write_epoch_uuid := latest."write_epoch_uuid";
    original_prev_commit_seq_text := latest."prev_commit_seq"::text;
    original_schema_version_id := latest."schema_version_id";
    original_codec_version := latest."value_codec_version";
    original_byte_length_text := octet_length(latest."value_bytes")::text;
    original_stored_sha256 := latest."value_sha256";
    original_actual_sha256 := CASE WHEN p_lengths[i] IS NOT NULL AND latest."is_tombstone" = false
      AND latest."value_codec_version" = 1 AND octet_length(latest."value_bytes") = p_lengths[i]
      THEN pg_catalog.sha256(latest."value_bytes") ELSE NULL END;
    RETURN NEXT;
  END LOOP; END IF;
END;
$developer_heads$;$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_apply_app_row_batch(p_rows %1$I.fx_app_row_write[], p_verify %1$I.fx_app_row_write[])
RETURNS TABLE(reason text, ordinal integer, actual_commit_seq bigint, actual_creation_time double precision)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $row_batch$
DECLARE i integer; n integer := coalesce(array_length(p_rows, 1), 0);
  expected_row %1$I."fx_app_row_rev"; actual_row %1$I."fx_app_row_rev"; pointer_seq bigint; predecessor_time double precision;
  inserted_seq bigint; phase text := 'write'; proof_rows %1$I.fx_app_row_write[];
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
  FOR i IN 1..array_length(proof_rows, 1) LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (proof_rows[i])."scope_uuid";
    expected_row."table_id" := (proof_rows[i])."table_id";
    expected_row."row_id" := (proof_rows[i])."row_id";
    expected_row."commit_seq" := (proof_rows[i])."commit_seq";
    expected_row."prev_commit_seq" := (proof_rows[i])."prev_commit_seq";
    expected_row."write_epoch_uuid" := (proof_rows[i])."write_epoch_uuid";
    expected_row."schema_version_id" := (proof_rows[i])."schema_version_id";
    expected_row."creation_time" := (proof_rows[i])."creation_time";
    expected_row."value_codec_version" := (proof_rows[i])."value_codec_version";
    expected_row."is_tombstone" := (proof_rows[i])."is_tombstone";
    expected_row."value_bytes" := (proof_rows[i])."value_bytes";
    expected_row."value_sha256" := (proof_rows[i])."value_sha256";
    SELECT r.* INTO actual_row FROM %1$I."fx_app_row_rev" r WHERE r."scope_uuid" = expected_row."scope_uuid"
      AND r."table_id" = expected_row."table_id" AND r."row_id" = expected_row."row_id" AND r."commit_seq" = expected_row."commit_seq";
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text; END IF;
    SELECT c."commit_seq" INTO pointer_seq FROM %1$I."fx_app_row_current" c WHERE c."scope_uuid" = expected_row."scope_uuid"
      AND c."table_id" = expected_row."table_id" AND c."row_id" = expected_row."row_id";
    IF pointer_seq IS DISTINCT FROM expected_row."commit_seq" THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_row_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text, 'actualCreationTime', actual_creation_time))::text; END IF;
  END LOOP;
  reason := 'accepted'; ordinal := n; actual_commit_seq := NULL; actual_creation_time := NULL; RETURN NEXT;
END;
$row_batch$;$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_apply_app_index_batch(p_rows %1$I.fx_app_index_write[], p_prior bigint[], p_historical boolean[], p_verify %1$I.fx_app_index_write[])
RETURNS TABLE(reason text, ordinal integer, actual_commit_seq bigint)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $index_batch$
DECLARE i integer; n integer := coalesce(array_length(p_rows, 1), 0); expected_row %1$I."fx_app_index_entry_rev"; actual_row %1$I."fx_app_index_entry_rev";
  latest_row %1$I."fx_app_index_entry_rev"; parent_tombstone boolean; pointer_seq bigint; inserted_seq bigint; phase text := 'write'; proof_rows %1$I.fx_app_index_write[];
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
  FOR i IN 1..array_length(proof_rows, 1) LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (proof_rows[i])."scope_uuid";
    expected_row."index_definition_id" := (proof_rows[i])."index_definition_id";
    expected_row."table_id" := (proof_rows[i])."table_id";
    expected_row."key_codec_version" := (proof_rows[i])."key_codec_version";
    expected_row."physical_spec_sha256" := (proof_rows[i])."physical_spec_sha256";
    expected_row."encoded_key" := (proof_rows[i])."encoded_key";
    expected_row."key_sha256" := (proof_rows[i])."key_sha256";
    expected_row."row_id" := (proof_rows[i])."row_id";
    expected_row."commit_seq" := (proof_rows[i])."commit_seq";
    expected_row."is_tombstone" := (proof_rows[i])."is_tombstone";
    SELECT r.* INTO actual_row FROM %1$I."fx_app_index_entry_rev" r WHERE r."scope_uuid" = expected_row."scope_uuid"
      AND r."index_definition_id" = expected_row."index_definition_id" AND r."encoded_key" = expected_row."encoded_key"
      AND r."row_id" = expected_row."row_id" AND r."commit_seq" = expected_row."commit_seq";
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text; END IF;
    SELECT c."commit_seq" INTO pointer_seq FROM %1$I."fx_app_index_entry_current" c WHERE c."scope_uuid" = expected_row."scope_uuid"
      AND c."index_definition_id" = expected_row."index_definition_id" AND c."encoded_key" = expected_row."encoded_key" AND c."row_id" = expected_row."row_id";
    IF pointer_seq IS DISTINCT FROM (CASE WHEN expected_row."is_tombstone" THEN NULL ELSE expected_row."commit_seq" END) THEN
      reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_index_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'ordinal', ordinal, 'actualCommitSeqText', actual_commit_seq::text))::text;
    END IF;
  END LOOP;
  reason := 'accepted'; ordinal := n; actual_commit_seq := NULL; RETURN NEXT;
END;
$index_batch$;$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_apply_app_unique_batch(p_releases %1$I.fx_app_unique_write[], p_claims %1$I.fx_app_unique_write[],
  p_verify_releases %1$I.fx_app_unique_write[], p_verify_claims %1$I.fx_app_unique_write[],
  p_absent_owners %1$I.fx_app_unique_owner[], p_absent_ordinals integer[])
RETURNS TABLE(reason text, ordinal integer, actual_table_id integer, actual_row_id bytea, actual_key bytea, actual_codec integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $unique_batch$
DECLARE i integer; releases integer := coalesce(array_length(p_releases, 1), 0); claims integer := coalesce(array_length(p_claims, 1), 0);
  expected_row %1$I."fx_app_unique_key"; actual_row %1$I."fx_app_unique_key"; parent_tombstone boolean; deleted_row %1$I."fx_app_unique_key"; phase text := 'claim'; stage text := 'write';
  proof_releases %1$I.fx_app_unique_write[]; proof_claims %1$I.fx_app_unique_write[];
BEGIN
  IF releases > 32 OR claims > 32 OR (releases + claims = 0 AND coalesce(array_length(p_absent_owners, 1), 0) = 0)
    OR releases + coalesce(array_length(p_verify_releases, 1), 0) > 512
    OR claims + coalesce(array_length(p_verify_claims, 1), 0) > 512
    OR coalesce(array_length(p_absent_owners, 1), 0) > 512
    OR coalesce(array_length(p_absent_owners, 1), 0) <> coalesce(array_length(p_absent_ordinals, 1), 0)
    OR EXISTS (SELECT 1 FROM unnest(p_absent_ordinals) input_ordinal WHERE input_ordinal IS NULL OR input_ordinal < 0 OR input_ordinal >= 512)
    THEN reason := 'invalidBatch'; ordinal := 0; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text; END IF;
  IF claims > 0 THEN FOR i IN 1..claims LOOP
    ordinal := i - 1;
    SELECT r."is_tombstone" INTO parent_tombstone FROM %1$I."fx_app_row_current" c JOIN %1$I."fx_app_row_rev" r
      ON r."scope_uuid" = c."scope_uuid" AND r."table_id" = c."table_id" AND r."row_id" = c."row_id" AND r."commit_seq" = c."commit_seq"
      WHERE c."scope_uuid" = (p_claims[i])."scope_uuid" AND c."table_id" = (p_claims[i])."table_id" AND c."row_id" = (p_claims[i])."row_id";
    IF NOT FOUND THEN reason := 'parentMissing'; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text; END IF;
    IF parent_tombstone THEN reason := 'parentTombstone'; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text; END IF;
  END LOOP; END IF;
  phase := 'release';
  IF releases > 0 THEN FOR i IN 1..releases LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (p_releases[i])."scope_uuid";
    expected_row."constraint_id" := (p_releases[i])."constraint_id";
    expected_row."locale_key" := (p_releases[i])."locale_key";
    expected_row."canonical_key_sha256" := (p_releases[i])."canonical_key_sha256";
    expected_row."key_codec_version" := (p_releases[i])."key_codec_version";
    expected_row."encoded_key" := (p_releases[i])."encoded_key";
    expected_row."table_id" := (p_releases[i])."table_id";
    expected_row."row_id" := (p_releases[i])."row_id";
    SELECT k.* INTO actual_row FROM %1$I."fx_app_unique_key" k WHERE k."scope_uuid" = expected_row."scope_uuid"
      AND k."constraint_id" = expected_row."constraint_id" AND k."locale_key" = expected_row."locale_key"
      AND k."canonical_key_sha256" = expected_row."canonical_key_sha256" FOR UPDATE;
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_row THEN reason := 'releaseMismatch'; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text; END IF;
  END LOOP; END IF;
  -- Every selected release executes before the first claim. Later statements
  -- freshly see earlier writes; this also permits real canonical key swaps.
  IF releases > 0 THEN FOR i IN 1..releases LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (p_releases[i])."scope_uuid";
    expected_row."constraint_id" := (p_releases[i])."constraint_id";
    expected_row."locale_key" := (p_releases[i])."locale_key";
    expected_row."canonical_key_sha256" := (p_releases[i])."canonical_key_sha256";
    expected_row."key_codec_version" := (p_releases[i])."key_codec_version";
    expected_row."encoded_key" := (p_releases[i])."encoded_key";
    expected_row."table_id" := (p_releases[i])."table_id";
    expected_row."row_id" := (p_releases[i])."row_id";
    DELETE FROM %1$I."fx_app_unique_key" k WHERE k."scope_uuid" = expected_row."scope_uuid" AND k."constraint_id" = expected_row."constraint_id"
      AND k."locale_key" = expected_row."locale_key" AND k."canonical_key_sha256" = expected_row."canonical_key_sha256" RETURNING k.* INTO deleted_row;
    IF NOT FOUND OR deleted_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text; END IF;
    IF EXISTS (SELECT 1 FROM %1$I."fx_app_unique_key" k WHERE k."scope_uuid" = expected_row."scope_uuid" AND k."constraint_id" = expected_row."constraint_id"
      AND k."locale_key" = expected_row."locale_key" AND k."canonical_key_sha256" = expected_row."canonical_key_sha256") THEN
      reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text;
    END IF;
  END LOOP; END IF;
  phase := 'claim';
  IF claims > 0 THEN FOR i IN 1..claims LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (p_claims[i])."scope_uuid";
    expected_row."constraint_id" := (p_claims[i])."constraint_id";
    expected_row."locale_key" := (p_claims[i])."locale_key";
    expected_row."canonical_key_sha256" := (p_claims[i])."canonical_key_sha256";
    expected_row."key_codec_version" := (p_claims[i])."key_codec_version";
    expected_row."encoded_key" := (p_claims[i])."encoded_key";
    expected_row."table_id" := (p_claims[i])."table_id";
    expected_row."row_id" := (p_claims[i])."row_id";
    SELECT k.* INTO actual_row FROM %1$I."fx_app_unique_key" k WHERE k."scope_uuid" = expected_row."scope_uuid"
      AND k."constraint_id" = expected_row."constraint_id" AND k."locale_key" = expected_row."locale_key"
      AND k."canonical_key_sha256" = expected_row."canonical_key_sha256" FOR UPDATE;
    IF FOUND THEN
      reason := 'claimConflict'; actual_table_id := actual_row."table_id"; actual_row_id := actual_row."row_id";
      actual_key := actual_row."encoded_key"; actual_codec := actual_row."key_codec_version"; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text;
    END IF;
    INSERT INTO %1$I."fx_app_unique_key" ("scope_uuid", "constraint_id", "locale_key", "canonical_key_sha256", "key_codec_version", "encoded_key", "table_id", "row_id")
      VALUES (expected_row."scope_uuid", expected_row."constraint_id", expected_row."locale_key", expected_row."canonical_key_sha256", expected_row."key_codec_version", expected_row."encoded_key", expected_row."table_id", expected_row."row_id");
  END LOOP; END IF;
  stage := 'verify'; phase := 'release';
  proof_releases := coalesce(p_verify_releases, ARRAY[]::%1$I.fx_app_unique_write[]) || p_releases;
  proof_claims := coalesce(p_verify_claims, ARRAY[]::%1$I.fx_app_unique_write[]) || p_claims;
  IF coalesce(array_length(proof_releases, 1), 0) > 0 THEN FOR i IN 1..array_length(proof_releases, 1) LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (proof_releases[i])."scope_uuid";
    expected_row."constraint_id" := (proof_releases[i])."constraint_id";
    expected_row."locale_key" := (proof_releases[i])."locale_key";
    expected_row."canonical_key_sha256" := (proof_releases[i])."canonical_key_sha256";
    expected_row."key_codec_version" := (proof_releases[i])."key_codec_version";
    expected_row."encoded_key" := (proof_releases[i])."encoded_key";
    expected_row."table_id" := (proof_releases[i])."table_id";
    expected_row."row_id" := (proof_releases[i])."row_id";
    IF NOT EXISTS (SELECT 1 FROM unnest(proof_claims) c WHERE
      c."scope_uuid" = expected_row."scope_uuid"
      AND c."constraint_id" = expected_row."constraint_id"
      AND c."locale_key" = expected_row."locale_key"
      AND c."canonical_key_sha256" = expected_row."canonical_key_sha256")
      AND EXISTS (SELECT 1 FROM %1$I."fx_app_unique_key" k WHERE k."scope_uuid" = expected_row."scope_uuid"
      AND k."constraint_id" = expected_row."constraint_id"
      AND k."locale_key" = expected_row."locale_key"
      AND k."canonical_key_sha256" = expected_row."canonical_key_sha256") THEN
      reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text;
    END IF;
  END LOOP; END IF;
  phase := 'claim';
  IF coalesce(array_length(proof_claims, 1), 0) > 0 THEN FOR i IN 1..array_length(proof_claims, 1) LOOP
    ordinal := i - 1;
    expected_row."scope_uuid" := (proof_claims[i])."scope_uuid";
    expected_row."constraint_id" := (proof_claims[i])."constraint_id";
    expected_row."locale_key" := (proof_claims[i])."locale_key";
    expected_row."canonical_key_sha256" := (proof_claims[i])."canonical_key_sha256";
    expected_row."key_codec_version" := (proof_claims[i])."key_codec_version";
    expected_row."encoded_key" := (proof_claims[i])."encoded_key";
    expected_row."table_id" := (proof_claims[i])."table_id";
    expected_row."row_id" := (proof_claims[i])."row_id";
    SELECT k.* INTO actual_row FROM %1$I."fx_app_unique_key" k WHERE k."scope_uuid" = expected_row."scope_uuid"
      AND k."constraint_id" = expected_row."constraint_id" AND k."locale_key" = expected_row."locale_key"
      AND k."canonical_key_sha256" = expected_row."canonical_key_sha256";
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text; END IF;
  END LOOP; END IF;
  phase := 'absentOwner';
  IF coalesce(array_length(p_absent_owners, 1), 0) > 0 THEN FOR i IN 1..array_length(p_absent_owners, 1) LOOP
    ordinal := p_absent_ordinals[i];
    IF EXISTS (SELECT 1 FROM %1$I."fx_app_unique_key" k WHERE
      k."scope_uuid" IS NOT DISTINCT FROM (p_absent_owners[i])."scope_uuid" AND k."constraint_id" IS NOT DISTINCT FROM (p_absent_owners[i])."constraint_id" AND k."locale_key" IS NOT DISTINCT FROM (p_absent_owners[i])."locale_key" AND k."table_id" IS NOT DISTINCT FROM (p_absent_owners[i])."table_id" AND k."row_id" IS NOT DISTINCT FROM (p_absent_owners[i])."row_id")
      THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'phase', phase, 'stage', stage, 'ordinal', ordinal, 'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'), 'actualKeyHex', encode(actual_key, 'hex'), 'actualCodec', actual_codec))::text; END IF;
  END LOOP; END IF;
  reason := 'accepted'; ordinal := releases + claims; RETURN NEXT;
END;
$unique_batch$;$ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_apply_app_search_batch(p_scope uuid, p_table integer, p_index integer, p_source text, p_seq bigint,
  p_ids bytea[], p_text %1$I.fx_app_search_write[], p_json %1$I.fx_app_json_write[], p_json_mode boolean, p_complete boolean,
  p_verify_ids bytea[], p_verify_text %1$I.fx_app_search_write[], p_verify_json %1$I.fx_app_json_write[])
RETURNS TABLE(reason text, entries integer, build_advanced boolean)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $search_batch$
DECLARE i integer; n integer; expected_text %1$I."fx_app_search_entry_current"; actual_text %1$I."fx_app_search_entry_current"; expected_json %1$I."fx_app_json_entry_current"; actual_json %1$I."fx_app_json_entry_current";
  expected_build %1$I."fx_system_search_build_state"; actual_build %1$I."fx_system_search_build_state"; actual_count integer;
  proof_ids bytea[]; proof_text %1$I.fx_app_search_write[]; proof_json %1$I.fx_app_json_write[];
BEGIN
  entries := coalesce(array_length(p_text, 1), 0) + coalesce(array_length(p_json, 1), 0); build_advanced := false;
  proof_ids := coalesce(p_verify_ids, ARRAY[]::bytea[]) || p_ids;
  proof_text := coalesce(p_verify_text, ARRAY[]::%1$I.fx_app_search_write[]) || p_text;
  proof_json := coalesce(p_verify_json, ARRAY[]::%1$I.fx_app_json_write[]) || p_json;
  IF coalesce(array_length(p_ids, 1), 0) < 1 OR array_length(p_ids, 1) > 32 OR array_length(proof_ids, 1) > 512
    OR coalesce(array_length(proof_text, 1), 0) + coalesce(array_length(proof_json, 1), 0) > 4096
    OR (p_json_mode AND coalesce(array_length(p_text, 1), 0) > 0)
    OR (NOT p_json_mode AND coalesce(array_length(p_json, 1), 0) > 0) THEN reason := 'invalidBatch'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
  IF p_json_mode THEN
    DELETE FROM %1$I."fx_app_json_entry_current" j WHERE j."scope_uuid" = p_scope AND j."table_id" = p_table AND j."logical_index_id" = p_index AND j."row_id" = ANY(p_ids);
    n := coalesce(array_length(p_json, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      expected_json."scope_uuid" := (p_json[i])."scope_uuid";
      expected_json."table_id" := (p_json[i])."table_id";
      expected_json."logical_index_id" := (p_json[i])."logical_index_id";
      expected_json."source_sha256" := (p_json[i])."source_sha256";
      expected_json."field_id" := (p_json[i])."field_id";
      expected_json."row_id" := (p_json[i])."row_id";
      expected_json."commit_seq" := (p_json[i])."commit_seq";
      expected_json."value_json" := (p_json[i])."value_json";
      IF expected_json."scope_uuid" IS DISTINCT FROM p_scope OR expected_json."table_id" IS DISTINCT FROM p_table
        OR expected_json."logical_index_id" IS DISTINCT FROM p_index OR expected_json."source_sha256" IS DISTINCT FROM p_source
        OR expected_json."commit_seq" IS DISTINCT FROM p_seq OR NOT expected_json."row_id" = ANY(p_ids) THEN reason := 'invalidBatch'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
      INSERT INTO %1$I."fx_app_json_entry_current" ("scope_uuid", "table_id", "logical_index_id", "source_sha256", "field_id", "row_id", "commit_seq", "value_json")
        VALUES (expected_json."scope_uuid", expected_json."table_id", expected_json."logical_index_id", expected_json."source_sha256", expected_json."field_id", expected_json."row_id", expected_json."commit_seq", expected_json."value_json");
    END LOOP; END IF;
    n := coalesce(array_length(proof_json, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      expected_json."scope_uuid" := (proof_json[i])."scope_uuid";
      expected_json."table_id" := (proof_json[i])."table_id";
      expected_json."logical_index_id" := (proof_json[i])."logical_index_id";
      expected_json."source_sha256" := (proof_json[i])."source_sha256";
      expected_json."field_id" := (proof_json[i])."field_id";
      expected_json."row_id" := (proof_json[i])."row_id";
      expected_json."commit_seq" := (proof_json[i])."commit_seq";
      expected_json."value_json" := (proof_json[i])."value_json";
      SELECT j.* INTO actual_json FROM %1$I."fx_app_json_entry_current" j WHERE j."scope_uuid" = p_scope AND j."table_id" = p_table
        AND j."logical_index_id" = p_index AND j."row_id" = expected_json."row_id" AND j."field_id" = expected_json."field_id";
      IF NOT FOUND OR actual_json IS DISTINCT FROM expected_json THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
    END LOOP; END IF;
    SELECT count(*) INTO actual_count FROM %1$I."fx_app_json_entry_current" j WHERE j."scope_uuid" = p_scope AND j."table_id" = p_table AND j."logical_index_id" = p_index AND j."row_id" = ANY(proof_ids);
  ELSE
    DELETE FROM %1$I."fx_app_search_entry_current" s WHERE s."scope_uuid" = p_scope AND s."table_id" = p_table AND s."logical_index_id" = p_index AND s."row_id" = ANY(p_ids);
    n := coalesce(array_length(p_text, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      expected_text."scope_uuid" := (p_text[i])."scope_uuid";
      expected_text."table_id" := (p_text[i])."table_id";
      expected_text."logical_index_id" := (p_text[i])."logical_index_id";
      expected_text."source_sha256" := (p_text[i])."source_sha256";
      expected_text."field_id" := (p_text[i])."field_id";
      expected_text."row_id" := (p_text[i])."row_id";
      expected_text."commit_seq" := (p_text[i])."commit_seq";
      expected_text."folded_text" := (p_text[i])."folded_text";
      IF expected_text."scope_uuid" IS DISTINCT FROM p_scope OR expected_text."table_id" IS DISTINCT FROM p_table
        OR expected_text."logical_index_id" IS DISTINCT FROM p_index OR expected_text."source_sha256" IS DISTINCT FROM p_source
        OR expected_text."commit_seq" IS DISTINCT FROM p_seq OR NOT expected_text."row_id" = ANY(p_ids) THEN reason := 'invalidBatch'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
      INSERT INTO %1$I."fx_app_search_entry_current" ("scope_uuid", "table_id", "logical_index_id", "source_sha256", "field_id", "row_id", "commit_seq", "folded_text")
        VALUES (expected_text."scope_uuid", expected_text."table_id", expected_text."logical_index_id", expected_text."source_sha256", expected_text."field_id", expected_text."row_id", expected_text."commit_seq", expected_text."folded_text");
    END LOOP; END IF;
    n := coalesce(array_length(proof_text, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      expected_text."scope_uuid" := (proof_text[i])."scope_uuid";
      expected_text."table_id" := (proof_text[i])."table_id";
      expected_text."logical_index_id" := (proof_text[i])."logical_index_id";
      expected_text."source_sha256" := (proof_text[i])."source_sha256";
      expected_text."field_id" := (proof_text[i])."field_id";
      expected_text."row_id" := (proof_text[i])."row_id";
      expected_text."commit_seq" := (proof_text[i])."commit_seq";
      expected_text."folded_text" := (proof_text[i])."folded_text";
      SELECT s.* INTO actual_text FROM %1$I."fx_app_search_entry_current" s WHERE s."scope_uuid" = p_scope AND s."table_id" = p_table
        AND s."logical_index_id" = p_index AND s."row_id" = expected_text."row_id" AND s."field_id" = expected_text."field_id";
      IF NOT FOUND OR actual_text IS DISTINCT FROM expected_text THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
    END LOOP; END IF;
    SELECT count(*) INTO actual_count FROM %1$I."fx_app_search_entry_current" s WHERE s."scope_uuid" = p_scope AND s."table_id" = p_table AND s."logical_index_id" = p_index AND s."row_id" = ANY(proof_ids);
  END IF;
  IF actual_count IS DISTINCT FROM n THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
  IF p_complete THEN
    SELECT b.* INTO expected_build FROM %1$I."fx_system_search_build_state" b WHERE b."scope_uuid" = p_scope AND b."table_id" = p_table AND b."logical_index_id" = p_index;
    IF FOUND THEN
      IF expected_build."lifecycle" <> 'ready' OR expected_build."source_sha256" <> p_source OR expected_build."covered_through_commit_seq" > p_seq THEN
        reason := 'invalidAuthority'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text;
      END IF;
      IF expected_build."covered_through_commit_seq" < p_seq THEN
        UPDATE %1$I."fx_system_search_build_state" b SET "covered_through_commit_seq" = p_seq WHERE b."scope_uuid" = p_scope AND b."table_id" = p_table
          AND b."logical_index_id" = p_index AND b."source_sha256" = p_source AND b."lifecycle" = 'ready'
          AND b."covered_through_commit_seq" = expected_build."covered_through_commit_seq";
        IF NOT FOUND THEN reason := 'invalidAuthority'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
        expected_build."covered_through_commit_seq" := p_seq; build_advanced := true;
      END IF;
      SELECT b.* INTO actual_build FROM %1$I."fx_system_search_build_state" b WHERE b."scope_uuid" = p_scope AND b."table_id" = p_table AND b."logical_index_id" = p_index;
      IF NOT FOUND OR actual_build IS DISTINCT FROM expected_build THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
    END IF;
  END IF;
  IF p_json_mode THEN
    n := coalesce(array_length(proof_json, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      expected_json."scope_uuid" := (proof_json[i])."scope_uuid";
      expected_json."table_id" := (proof_json[i])."table_id";
      expected_json."logical_index_id" := (proof_json[i])."logical_index_id";
      expected_json."source_sha256" := (proof_json[i])."source_sha256";
      expected_json."field_id" := (proof_json[i])."field_id";
      expected_json."row_id" := (proof_json[i])."row_id";
      expected_json."commit_seq" := (proof_json[i])."commit_seq";
      expected_json."value_json" := (proof_json[i])."value_json";
      SELECT j.* INTO actual_json FROM %1$I."fx_app_json_entry_current" j WHERE j."scope_uuid" = p_scope AND j."table_id" = p_table
        AND j."logical_index_id" = p_index AND j."row_id" = expected_json."row_id" AND j."field_id" = expected_json."field_id";
      IF NOT FOUND OR actual_json IS DISTINCT FROM expected_json THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
    END LOOP; END IF;
    SELECT count(*) INTO actual_count FROM %1$I."fx_app_json_entry_current" j WHERE j."scope_uuid" = p_scope AND j."table_id" = p_table AND j."logical_index_id" = p_index AND j."row_id" = ANY(proof_ids);
  ELSE
    n := coalesce(array_length(proof_text, 1), 0);
    IF n > 0 THEN FOR i IN 1..n LOOP
      expected_text."scope_uuid" := (proof_text[i])."scope_uuid";
      expected_text."table_id" := (proof_text[i])."table_id";
      expected_text."logical_index_id" := (proof_text[i])."logical_index_id";
      expected_text."source_sha256" := (proof_text[i])."source_sha256";
      expected_text."field_id" := (proof_text[i])."field_id";
      expected_text."row_id" := (proof_text[i])."row_id";
      expected_text."commit_seq" := (proof_text[i])."commit_seq";
      expected_text."folded_text" := (proof_text[i])."folded_text";
      SELECT s.* INTO actual_text FROM %1$I."fx_app_search_entry_current" s WHERE s."scope_uuid" = p_scope AND s."table_id" = p_table
        AND s."logical_index_id" = p_index AND s."row_id" = expected_text."row_id" AND s."field_id" = expected_text."field_id";
      IF NOT FOUND OR actual_text IS DISTINCT FROM expected_text THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
    END LOOP; END IF;
    SELECT count(*) INTO actual_count FROM %1$I."fx_app_search_entry_current" s WHERE s."scope_uuid" = p_scope AND s."table_id" = p_table AND s."logical_index_id" = p_index AND s."row_id" = ANY(proof_ids);
  END IF;
  IF actual_count IS DISTINCT FROM n THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_search_batch' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason))::text; END IF;
  reason := 'accepted'; RETURN NEXT;
END;
$search_batch$;$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_lock_finite_publication_anchor(uuid,uuid) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_observe_finite_publication(uuid,uuid,text,jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_advance_scope_publication_clock(uuid,bigint,bigint,timestamptz) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_header(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_rows(jsonb,jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_relations(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_relational(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_events(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_deliveries(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_outcome(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_wake(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_finish_scope_publication_session(jsonb,timestamptz) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_prove_scope_publication_prefix(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_finish_scope_publication_prefix(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_write_scope_publication_prefix(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_set_scope_publication_header_counts(jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_refuse_scope_publication_metadata() FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_advance_app_coverage(%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],bigint,bigint,boolean,%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],text[],text[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_begin_app_materialization(text,timestamptz,boolean) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_observe_app_developer_heads(text,uuid,integer[],integer[],bytea[],integer[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_row_batch(%1$I.fx_app_row_write[],%1$I.fx_app_row_write[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_index_batch(%1$I.fx_app_index_write[],bigint[],boolean[],%1$I.fx_app_index_write[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_unique_batch(%1$I.fx_app_unique_write[],%1$I.fx_app_unique_write[],%1$I.fx_app_unique_write[],%1$I.fx_app_unique_write[],%1$I.fx_app_unique_owner[],integer[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_search_batch(uuid,integer,integer,text,bigint,bytea[],%1$I.fx_app_search_write[],%1$I.fx_app_json_write[],boolean,boolean,bytea[],%1$I.fx_app_search_write[],%1$I.fx_app_json_write[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %1$I.fx_app_row_write FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %1$I.fx_app_index_write FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %1$I.fx_app_unique_write FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %1$I.fx_app_unique_owner FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %1$I.fx_app_search_write FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %1$I.fx_app_json_write FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %1$I.fx_app_index_coverage FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %1$I.fx_app_unique_coverage FROM PUBLIC', target_schema);
END $$;

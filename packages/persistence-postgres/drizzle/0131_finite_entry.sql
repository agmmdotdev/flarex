-- Complete finite entry. Durable anchor meaning and recovery identity are unchanged.
-- Named finite capture accepts the genuine expected entry. No durable format changes.
DO $$ DECLARE gate fx_system_installation; BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id = 1;
  IF NOT pg_try_advisory_xact_lock(2147483002, (gate.namespace_oid - 2147483648)::integer) THEN
    RAISE EXCEPTION 'finite capture migration requires installation quiescence' USING ERRCODE = '55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state = 'draining' AND gate.maintenance_pid = pg_backend_pid()
    AND gate.maintenance_backend_start = (SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid = pg_backend_pid())) THEN
    RAISE EXCEPTION 'finite capture migration requires its managed maintenance owner' USING ERRCODE = '55000';
  END IF;
END $$;

--> statement-breakpoint
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
CREATE TYPE %1$I.fx_finite_entry_expected AS (
  "scope_uuid" uuid,
  "session_id" uuid,
  "execution_profile" text,
  "finite_attempt_bytes" bytea,
  "finite_attempt_sha256" bytea,
  "finite_snapshot_epoch_uuid" uuid,
  "finite_snapshot_commit_seq" bigint,
  "finite_metadata_watermark" bigint,
  "finite_lease_expires_at" timestamp with time zone,
  "finite_claim_owner" uuid,
  "finite_claim_fence" bigint,
  "finite_claimed_at" timestamp with time zone,
  "finite_claim_expires_at" timestamp with time zone,
  "storage_generation" text,
  "storage_generation_fence" bigint,
  "execution_authority_generation" text,
  "application_execution_authority_json" jsonb,
  "application_execution_authority_canonical_bytes" bytea,
  "application_execution_authority_sha256" bytea,
  "package_id" text,
  "artifact_runtime" text,
  "artifact_id" text,
  "source_package_hash" text,
  "execution_module" text,
  "function_path" text,
  "function_kind" text,
  "schema_version_id" text,
  "policy_version" text,
  "identity_access_policy_sha256" bytea,
  "validated_args_json" jsonb,
  "validated_args_value_codec_version" integer,
  "validated_args_canonical_bytes" bytea,
  "validated_args_sha256" bytea,
  "authorization_grant_id" text,
  "authorization_grant_json" jsonb,
  "authorization_grant_value_codec_version" integer,
  "authorization_grant_canonical_bytes" bytea,
  "authorization_grant_sha256" bytea,
  "authorization_revocation_epoch" bigint,
  "authorization_grant_expires_at" timestamp with time zone,
  "request_key" text,
  "request_sha256" bytea,
  "lifecycle" text,
  "attempt_fence" bigint,
  "protocol_version" integer,
  "hard_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
);
  $ddl$, target_schema);
  EXECUTE format($ddl$

CREATE FUNCTION %1$I.fx_compare_finite_metadata(p_scope_id text, p_watermark bigint, p_expected jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, pg_temp AS $metadata$
  WITH expected AS (
    SELECT element.ordinality - 1 AS ordinal, tuple.*
    FROM jsonb_array_elements(p_expected) WITH ORDINALITY AS element(value, ordinality)
    CROSS JOIN LATERAL jsonb_to_record(element.value) AS tuple(
      namespace text, "ownerKey" text, "contractKey" text, present boolean,
      "semanticSha256Hex" text, "semanticBytesHex" text)
  ), compared AS (
    SELECT expected.ordinal,
      CASE
        WHEN p_watermark IS NOT NULL AND "actual"."last_changed_metadata_sequence" > p_watermark
          THEN 'writeConflict'
        WHEN expected.present AND ("actual"."scope_id" IS NULL OR NOT "actual"."present"
          OR "actual"."semantic_sha256_hex" IS DISTINCT FROM expected."semanticSha256Hex"
          OR (expected."semanticBytesHex" IS NOT NULL AND
            "actual"."semantic_bytes" IS DISTINCT FROM decode(expected."semanticBytesHex", 'hex')))
          OR NOT expected.present AND "actual"."present" THEN 'projectionMissing'
        ELSE NULL
      END AS reason,
      CASE WHEN "actual"."scope_id" IS NULL THEN NULL ELSE jsonb_build_object(
        'present', "actual"."present", 'semanticSha256Hex', "actual"."semantic_sha256_hex",
        'lastChangedMetadataSequence', "actual"."last_changed_metadata_sequence"::text)
      END AS current_observation
    FROM expected LEFT JOIN %1$I."fx_system_metadata_contract_observation" actual
      ON "actual"."scope_id" = p_scope_id AND "actual"."namespace" = expected.namespace
        AND "actual"."owner_key" = expected."ownerKey" AND "actual"."contract_key" = expected."contractKey"
  )
  SELECT coalesce((SELECT jsonb_build_object('reason', reason, 'ordinal', ordinal,
    'currentObservation', current_observation) FROM compared
    WHERE reason IS NOT NULL ORDER BY ordinal LIMIT 1), jsonb_build_object('reason', 'accepted'))
$metadata$;

  $ddl$, target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_observe_finite_entry(
    p_scope_id text, p_scope_uuid uuid, p_generation text, p_request_key text)
    RETURNS TABLE(has_session boolean, has_observation boolean, database_now timestamptz,
      session %1$I."fx_system_tx_session", application_head %1$I."fx_system_application_active_head",
      application_activation %1$I."fx_system_application_activation", binding_head %1$I."fx_system_data_binding_head",
      binding_activation %1$I."fx_system_data_binding_activation", binding_candidate %1$I."fx_system_data_binding_candidate",
      planning_head %1$I."fx_system_app_schema_candidate_validation", lane %1$I."fx_system_data_binding_physical_lane")
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $finite_entry_observation$
    DECLARE
      v_s %1$I."fx_system_tx_session"%%ROWTYPE;
      v_ah %1$I."fx_system_application_active_head"%%ROWTYPE;
      v_aa %1$I."fx_system_application_activation"%%ROWTYPE;
      v_bh %1$I."fx_system_data_binding_head"%%ROWTYPE;
      v_ba %1$I."fx_system_data_binding_activation"%%ROWTYPE;
      v_bc %1$I."fx_system_data_binding_candidate"%%ROWTYPE;
      v_p %1$I."fx_system_app_schema_candidate_validation"%%ROWTYPE;
      v_replay boolean := false;
      v_now timestamptz;
    BEGIN
      FOR v_s IN SELECT s.* FROM %1$I."fx_system_tx_session" AS s
        WHERE s."scope_uuid" = p_scope_uuid
          AND s."request_key" = p_request_key
        ORDER BY s."session_id" LIMIT 2 FOR UPDATE
      LOOP
        v_replay := true;
        v_now := date_trunc('milliseconds', clock_timestamp());
        RETURN QUERY SELECT true, false, v_now, v_s, NULL::%1$I."fx_system_application_active_head",
          NULL::%1$I."fx_system_application_activation", NULL::%1$I."fx_system_data_binding_head", NULL::%1$I."fx_system_data_binding_activation",
          NULL::%1$I."fx_system_data_binding_candidate", NULL::%1$I."fx_system_app_schema_candidate_validation", NULL::%1$I."fx_system_data_binding_physical_lane";
      END LOOP;
      IF v_replay THEN RETURN; END IF;
      SELECT h.* INTO v_ah FROM %1$I."fx_system_application_active_head" AS h
        WHERE h."scope_id" = p_scope_id FOR SHARE;
      IF v_ah."scope_id" IS NOT NULL THEN
        SELECT a.* INTO v_aa FROM %1$I."fx_system_application_activation" AS a
          WHERE a."scope_id" = p_scope_id
            AND a."activation_sequence" = v_ah."activation_sequence" FOR SHARE;
      END IF;
      SELECT h.* INTO v_bh FROM %1$I."fx_system_data_binding_head" AS h
        WHERE h."scope_id" = p_scope_id
          AND h."storage_generation" = p_generation FOR SHARE;
      IF v_bh."scope_id" IS NOT NULL THEN
        SELECT a.* INTO v_ba FROM %1$I."fx_system_data_binding_activation" AS a
          WHERE a."scope_id" = p_scope_id
            AND a."storage_generation" = p_generation
            AND a."sequence" = v_bh."sequence";
        SELECT c.* INTO v_bc FROM %1$I."fx_system_data_binding_candidate" AS c
          WHERE c."scope_id" = p_scope_id
            AND c."storage_generation" = p_generation
            AND c."sha256" = v_bh."candidate_sha256";
      END IF;
      SELECT p.* INTO v_p FROM %1$I."fx_system_app_schema_candidate_validation" AS p
        WHERE p."scope_id" = p_scope_id;
      v_now := date_trunc('milliseconds', clock_timestamp());
      RETURN QUERY SELECT false, true, v_now, NULL::%1$I."fx_system_tx_session",
        CASE WHEN row_number() OVER (ORDER BY l."slot", l."installation_storage_id") = 1 THEN v_ah END,
        CASE WHEN row_number() OVER (ORDER BY l."slot", l."installation_storage_id") = 1 THEN v_aa END,
        CASE WHEN row_number() OVER (ORDER BY l."slot", l."installation_storage_id") = 1 THEN v_bh END,
        CASE WHEN row_number() OVER (ORDER BY l."slot", l."installation_storage_id") = 1 THEN v_ba END,
        CASE WHEN row_number() OVER (ORDER BY l."slot", l."installation_storage_id") = 1 THEN v_bc END,
        CASE WHEN row_number() OVER (ORDER BY l."slot", l."installation_storage_id") = 1 THEN v_p END,
        l::%1$I."fx_system_data_binding_physical_lane"
        FROM (SELECT 1) AS singleton LEFT JOIN LATERAL (
          SELECT observed_lane.* FROM %1$I."fx_system_data_binding_physical_lane" AS observed_lane
            WHERE observed_lane."scope_id" = p_scope_id
              AND observed_lane."storage_generation" = p_generation
              AND observed_lane."candidate_sha256" = v_bh."candidate_sha256"
            ORDER BY observed_lane."slot", observed_lane."installation_storage_id" LIMIT 10
        ) AS l ON true
        ORDER BY l."slot", l."installation_storage_id";
    END;
    $finite_entry_observation$;
  $ddl$, target_schema);
  EXECUTE format($ddl$

CREATE FUNCTION %1$I.fx_complete_finite_entry(
  p_expected %1$I.fx_finite_entry_expected, p_guard_valid boolean)
RETURNS TABLE(reason text, database_now timestamptz, lease_expires_at timestamptz,
  claim_expires_at timestamptz)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $completion$
DECLARE expected_row %1$I."fx_system_tx_session"; actual_row %1$I."fx_system_tx_session"; inserted_id uuid;
BEGIN
  IF p_guard_valid IS DISTINCT FROM true THEN reason := 'protectedMetadataChanged'; RETURN NEXT; RETURN; END IF;
  expected_row."scope_uuid" := (p_expected)."scope_uuid";
  expected_row."session_id" := (p_expected)."session_id";
  expected_row."execution_profile" := (p_expected)."execution_profile";
  expected_row."finite_attempt_bytes" := (p_expected)."finite_attempt_bytes";
  expected_row."finite_attempt_sha256" := (p_expected)."finite_attempt_sha256";
  expected_row."finite_snapshot_epoch_uuid" := (p_expected)."finite_snapshot_epoch_uuid";
  expected_row."finite_snapshot_commit_seq" := (p_expected)."finite_snapshot_commit_seq";
  expected_row."finite_metadata_watermark" := (p_expected)."finite_metadata_watermark";
  expected_row."finite_lease_expires_at" := (p_expected)."finite_lease_expires_at";
  expected_row."finite_claim_owner" := (p_expected)."finite_claim_owner";
  expected_row."finite_claim_fence" := (p_expected)."finite_claim_fence";
  expected_row."finite_claimed_at" := (p_expected)."finite_claimed_at";
  expected_row."finite_claim_expires_at" := (p_expected)."finite_claim_expires_at";
  expected_row."storage_generation" := (p_expected)."storage_generation";
  expected_row."storage_generation_fence" := (p_expected)."storage_generation_fence";
  expected_row."execution_authority_generation" := (p_expected)."execution_authority_generation";
  expected_row."application_execution_authority_json" := (p_expected)."application_execution_authority_json";
  expected_row."application_execution_authority_canonical_bytes" := (p_expected)."application_execution_authority_canonical_bytes";
  expected_row."application_execution_authority_sha256" := (p_expected)."application_execution_authority_sha256";
  expected_row."package_id" := (p_expected)."package_id";
  expected_row."artifact_runtime" := (p_expected)."artifact_runtime";
  expected_row."artifact_id" := (p_expected)."artifact_id";
  expected_row."source_package_hash" := (p_expected)."source_package_hash";
  expected_row."execution_module" := (p_expected)."execution_module";
  expected_row."function_path" := (p_expected)."function_path";
  expected_row."function_kind" := (p_expected)."function_kind";
  expected_row."schema_version_id" := (p_expected)."schema_version_id";
  expected_row."policy_version" := (p_expected)."policy_version";
  expected_row."identity_access_policy_sha256" := (p_expected)."identity_access_policy_sha256";
  expected_row."validated_args_json" := (p_expected)."validated_args_json";
  expected_row."validated_args_value_codec_version" := (p_expected)."validated_args_value_codec_version";
  expected_row."validated_args_canonical_bytes" := (p_expected)."validated_args_canonical_bytes";
  expected_row."validated_args_sha256" := (p_expected)."validated_args_sha256";
  expected_row."authorization_grant_id" := (p_expected)."authorization_grant_id";
  expected_row."authorization_grant_json" := (p_expected)."authorization_grant_json";
  expected_row."authorization_grant_value_codec_version" := (p_expected)."authorization_grant_value_codec_version";
  expected_row."authorization_grant_canonical_bytes" := (p_expected)."authorization_grant_canonical_bytes";
  expected_row."authorization_grant_sha256" := (p_expected)."authorization_grant_sha256";
  expected_row."authorization_revocation_epoch" := (p_expected)."authorization_revocation_epoch";
  expected_row."authorization_grant_expires_at" := (p_expected)."authorization_grant_expires_at";
  expected_row."request_key" := (p_expected)."request_key";
  expected_row."request_sha256" := (p_expected)."request_sha256";
  expected_row."lifecycle" := (p_expected)."lifecycle";
  expected_row."attempt_fence" := (p_expected)."attempt_fence";
  expected_row."protocol_version" := (p_expected)."protocol_version";
  expected_row."hard_expires_at" := (p_expected)."hard_expires_at";
  expected_row."created_at" := (p_expected)."created_at";
  expected_row."updated_at" := (p_expected)."updated_at";
  -- Time is sampled after the real metadata/epoch work. Original preparation
  -- bounds must still be live; renewal never revives an expired entry.
  database_now := to_timestamp(trunc(extract(epoch from clock_timestamp()) * 1000) / 1000);
  IF expected_row."finite_claim_expires_at" <= database_now
    OR expected_row."finite_lease_expires_at" <= database_now
    OR expected_row."authorization_grant_expires_at" <= database_now
    OR expected_row."hard_expires_at" <= database_now THEN
    reason := 'expired'; RETURN NEXT; RETURN;
  END IF;
  lease_expires_at := greatest(expected_row."finite_lease_expires_at",
    least(database_now + (expected_row."finite_lease_expires_at"
      - expected_row."finite_claimed_at"),
      expected_row."authorization_grant_expires_at", expected_row."hard_expires_at"));
  claim_expires_at := greatest(expected_row."finite_claim_expires_at",
    least(database_now + (expected_row."finite_claim_expires_at"
      - expected_row."finite_claimed_at"), lease_expires_at,
      expected_row."authorization_grant_expires_at", expected_row."hard_expires_at"));
  expected_row."finite_lease_expires_at" := lease_expires_at;
  expected_row."finite_claim_expires_at" := claim_expires_at;
  INSERT INTO %1$I."fx_system_tx_session" ("scope_uuid", "session_id", "execution_profile", "finite_attempt_bytes", "finite_attempt_sha256", "finite_snapshot_epoch_uuid", "finite_snapshot_commit_seq", "finite_metadata_watermark", "finite_lease_expires_at", "finite_claim_owner", "finite_claim_fence", "finite_claimed_at", "finite_claim_expires_at", "storage_generation", "storage_generation_fence", "execution_authority_generation", "application_execution_authority_json", "application_execution_authority_canonical_bytes", "application_execution_authority_sha256", "package_id", "artifact_runtime", "artifact_id", "source_package_hash", "execution_module", "function_path", "function_kind", "schema_version_id", "policy_version", "identity_access_policy_sha256", "validated_args_json", "validated_args_value_codec_version", "validated_args_canonical_bytes", "validated_args_sha256", "authorization_grant_id", "authorization_grant_json", "authorization_grant_value_codec_version", "authorization_grant_canonical_bytes", "authorization_grant_sha256", "authorization_revocation_epoch", "authorization_grant_expires_at", "request_key", "request_sha256", "lifecycle", "attempt_fence", "protocol_version", "hard_expires_at", "created_at", "updated_at")
    VALUES (expected_row."scope_uuid", expected_row."session_id", expected_row."execution_profile", expected_row."finite_attempt_bytes", expected_row."finite_attempt_sha256", expected_row."finite_snapshot_epoch_uuid", expected_row."finite_snapshot_commit_seq", expected_row."finite_metadata_watermark", expected_row."finite_lease_expires_at", expected_row."finite_claim_owner", expected_row."finite_claim_fence", expected_row."finite_claimed_at", expected_row."finite_claim_expires_at", expected_row."storage_generation", expected_row."storage_generation_fence", expected_row."execution_authority_generation", expected_row."application_execution_authority_json", expected_row."application_execution_authority_canonical_bytes", expected_row."application_execution_authority_sha256", expected_row."package_id", expected_row."artifact_runtime", expected_row."artifact_id", expected_row."source_package_hash", expected_row."execution_module", expected_row."function_path", expected_row."function_kind", expected_row."schema_version_id", expected_row."policy_version", expected_row."identity_access_policy_sha256", expected_row."validated_args_json", expected_row."validated_args_value_codec_version", expected_row."validated_args_canonical_bytes", expected_row."validated_args_sha256", expected_row."authorization_grant_id", expected_row."authorization_grant_json", expected_row."authorization_grant_value_codec_version", expected_row."authorization_grant_canonical_bytes", expected_row."authorization_grant_sha256", expected_row."authorization_revocation_epoch", expected_row."authorization_grant_expires_at", expected_row."request_key", expected_row."request_sha256", expected_row."lifecycle", expected_row."attempt_fence", expected_row."protocol_version", expected_row."hard_expires_at", expected_row."created_at", expected_row."updated_at")
    ON CONFLICT ("scope_uuid", "session_id") DO NOTHING
    RETURNING "session_id" INTO inserted_id;
  IF inserted_id IS NULL THEN reason := 'sessionIdCollision'; RETURN NEXT; RETURN; END IF;
  -- A separate VOLATILE statement sees AFTER INSERT updates. No stored body is
  -- returned to the caller, and every column participates in exact equality.
  SELECT s.* INTO STRICT actual_row FROM %1$I."fx_system_tx_session" s
    WHERE s."scope_uuid" = expected_row."scope_uuid"
      AND s."session_id" = expected_row."session_id";
  IF actual_row IS DISTINCT FROM expected_row THEN reason := 'storedCorruption'; RETURN NEXT; RETURN; END IF;
  reason := 'accepted'; RETURN NEXT;
END;
$completion$;

  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_compare_finite_metadata(text,bigint,jsonb) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_observe_finite_entry(text,uuid,text,text) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_complete_finite_entry(%1$I.fx_finite_entry_expected,boolean) FROM PUBLIC', target_schema);
END $$;

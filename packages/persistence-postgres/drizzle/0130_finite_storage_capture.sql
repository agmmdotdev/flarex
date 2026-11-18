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
  EXECUTE format($ddl$ CREATE TYPE %1$I.fx_finite_capture_expected AS (
    scope_uuid uuid,
    session_id uuid,
    attempt_fence bigint,
    policy_version text,
    protocol_version integer,
    execution_profile text,
    execution_authority_generation text,
    function_path text,
    function_kind text,
    execution_module text,
    package_id text,
    artifact_runtime text,
    artifact_id text,
    source_package_hash text,
    validated_args_value_codec_version integer,
    authorization_grant_value_codec_version integer,
    schema_version_id text,
    storage_generation text,
    storage_generation_fence bigint,
    request_key text,
    authorization_revocation_epoch bigint,
    authorization_grant_id text,
    authorization_grant_expires_at bigint,
    hard_expires_at bigint,
    created_at bigint,
    identity_access_policy_sha256 text,
    request_sha256 text,
    validated_args_sha256 text,
    authorization_grant_sha256 text,
    application_execution_authority_sha256 text
  ) $ddl$, target_schema);
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_accept_finite_storage_capture(p_scope_id text,
      p_expected %1$I.fx_finite_capture_expected, p_anchor_bytes bytea, p_anchor_sha256 bytea,
      p_snapshot_epoch_uuid uuid, p_snapshot_commit_seq bigint, p_metadata_watermark bigint,
      p_claim_owner uuid, p_claim_fence bigint, p_generation text, p_generation_fence bigint, p_epoch text,
      p_index_definition_id integer, p_table_id integer, p_unique_definition_id integer)
    RETURNS TABLE(reason text, database_now_epoch_milliseconds text, serving_commit_seq bigint,
      authority_row %1$I.fx_system_scope_execution_authority, session_row %1$I.fx_system_tx_session,
      build_row %1$I.fx_system_index_build_state, unique_row %1$I.fx_system_unique_constraint_build,
      table_frontier bigint, historical_change boolean, body_eligible boolean)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE s %1$I.fx_system_tx_session; clock_row %1$I.fx_system_scope_clock; current_time_ms bigint;
      effective_statement_timeout interval;
    BEGIN
      -- Startup arms the statement before execution. Re-check the actual pooled
      -- session setting before authority, attempt or build locks and body access.
      effective_statement_timeout := current_setting('statement_timeout')::interval;
      IF effective_statement_timeout <= interval '0 milliseconds'
        OR effective_statement_timeout > interval '30000 milliseconds' THEN
        reason := 'resourceFailure'; body_eligible := false; RETURN NEXT; RETURN;
      END IF;
      reason := 'invalidAuthority';
      IF p_scope_id IS NULL THEN RETURN NEXT; RETURN; END IF;
      SELECT a.* INTO authority_row FROM %1$I.fx_system_scope_execution_authority a WHERE a.scope_id = p_scope_id FOR SHARE;
      IF authority_row.scope_id IS NULL THEN RETURN NEXT; RETURN; END IF;
      -- Intrinsic scope corruption precedes generation verdicts and session waits.
      SELECT c.* INTO clock_row FROM %1$I.fx_system_scope_clock c WHERE c.scope_id = p_scope_id;
      IF clock_row.scope_id IS NULL OR clock_row.scope_uuid IS DISTINCT FROM (p_expected).scope_uuid
        OR authority_row.storage_generation NOT IN ('legacy_v1','flarexdb_v1')
        OR authority_row.storage_generation_fence < 1
        OR clock_row.last_commit_seq < 0 OR clock_row.last_metadata_sequence < 0
        OR authority_row.oldest_available_commit_seq < 0 OR authority_row.oldest_available_commit_seq > clock_row.last_commit_seq
        OR authority_row.authorization_revocation_epoch < 0
        OR NOT isfinite(clock_row.updated_at) OR NOT isfinite(authority_row.updated_at)
        OR btrim(authority_row.epoch) = '' OR authority_row.epoch_uuid IS NULL THEN
        reason := 'storedCorruption'; RETURN NEXT; RETURN;
      END IF;
      IF p_generation <> 'flarexdb_v1' OR authority_row.storage_generation <> 'flarexdb_v1' THEN
        reason := 'unsupportedStorageGeneration'; RETURN NEXT; RETURN;
      END IF;
      IF authority_row.storage_generation_fence IS DISTINCT FROM p_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN NEXT; RETURN;
      END IF;
      IF authority_row.epoch IS DISTINCT FROM p_epoch THEN reason := 'scopeEpochChanged'; RETURN NEXT; RETURN; END IF;
      -- Identity lookup precedes fence interpretation, including corrupt replaced rows.
      SELECT a.* INTO s FROM %1$I.fx_system_tx_session a
        WHERE a.scope_uuid = (substring(p_scope_id FROM 7))::uuid AND a.session_id = (p_expected).session_id FOR SHARE;
      IF s.session_id IS NULL THEN reason := 'attemptMissing'; RETURN NEXT; RETURN; END IF;
      IF NOT isfinite(s.authorization_grant_expires_at) OR NOT isfinite(s.hard_expires_at)
        OR NOT isfinite(s.created_at) OR NOT isfinite(s.updated_at)
        OR s.finite_lease_expires_at IS NULL OR NOT isfinite(s.finite_lease_expires_at)
        OR s.finite_claimed_at IS NULL OR NOT isfinite(s.finite_claimed_at)
        OR s.finite_claim_expires_at IS NULL OR NOT isfinite(s.finite_claim_expires_at) THEN
        reason := 'storedCorruption'; RETURN NEXT; RETURN;
      END IF;
      IF s.finite_attempt_bytes IS NULL OR octet_length(s.finite_attempt_bytes) NOT BETWEEN 1 AND 131072
        OR s.finite_attempt_sha256 IS NULL OR octet_length(s.finite_attempt_sha256) <> 32
        OR s.finite_snapshot_epoch_uuid IS NULL OR s.finite_snapshot_commit_seq IS NULL
        OR s.finite_snapshot_commit_seq < 0 OR s.attempt_fence < 1
        OR s.finite_claim_owner IS NULL OR s.finite_claim_fence IS NULL OR s.finite_claim_fence < 1
        OR s.finite_claim_expires_at <= s.finite_claimed_at OR s.finite_claim_expires_at > s.finite_lease_expires_at
        OR s.finite_lease_expires_at > s.hard_expires_at THEN
        reason := 'storedCorruption'; RETURN NEXT; RETURN;
      END IF;
      IF s.attempt_fence <> (p_expected).attempt_fence THEN
        -- The owning canonical decoder checks this fresh frontier before the
        -- replacement verdict. No business body is selected for this header.
        session_row := s; reason := 'attemptReplaced'; RETURN NEXT; RETURN;
      END IF;
      IF s.finite_attempt_bytes IS DISTINCT FROM p_anchor_bytes OR s.finite_attempt_sha256 IS DISTINCT FROM p_anchor_sha256
        OR s.finite_snapshot_epoch_uuid IS DISTINCT FROM p_snapshot_epoch_uuid
        OR s.finite_snapshot_commit_seq IS DISTINCT FROM p_snapshot_commit_seq
        OR s.finite_metadata_watermark IS DISTINCT FROM p_metadata_watermark
        OR s.scope_uuid IS DISTINCT FROM (p_expected).scope_uuid
        OR s.session_id IS DISTINCT FROM (p_expected).session_id
        OR s.attempt_fence IS DISTINCT FROM (p_expected).attempt_fence
        OR s.policy_version IS DISTINCT FROM (p_expected).policy_version
        OR s.protocol_version IS DISTINCT FROM (p_expected).protocol_version
        OR s.execution_profile IS DISTINCT FROM (p_expected).execution_profile
        OR s.execution_authority_generation IS DISTINCT FROM (p_expected).execution_authority_generation
        OR s.function_path IS DISTINCT FROM (p_expected).function_path
        OR s.function_kind IS DISTINCT FROM (p_expected).function_kind
        OR s.execution_module IS DISTINCT FROM (p_expected).execution_module
        OR s.package_id IS DISTINCT FROM (p_expected).package_id
        OR s.artifact_runtime IS DISTINCT FROM (p_expected).artifact_runtime
        OR s.artifact_id IS DISTINCT FROM (p_expected).artifact_id
        OR s.source_package_hash IS DISTINCT FROM (p_expected).source_package_hash
        OR s.validated_args_value_codec_version IS DISTINCT FROM (p_expected).validated_args_value_codec_version
        OR s.authorization_grant_value_codec_version IS DISTINCT FROM (p_expected).authorization_grant_value_codec_version
        OR s.schema_version_id IS DISTINCT FROM (p_expected).schema_version_id
        OR s.storage_generation IS DISTINCT FROM (p_expected).storage_generation
        OR s.storage_generation_fence IS DISTINCT FROM (p_expected).storage_generation_fence
        OR s.request_key IS DISTINCT FROM (p_expected).request_key
        OR s.authorization_revocation_epoch IS DISTINCT FROM (p_expected).authorization_revocation_epoch
        OR s.authorization_grant_id IS DISTINCT FROM (p_expected).authorization_grant_id
        OR floor(extract(epoch FROM s.authorization_grant_expires_at) * 1000)::bigint IS DISTINCT FROM (p_expected).authorization_grant_expires_at
        OR floor(extract(epoch FROM s.hard_expires_at) * 1000)::bigint IS DISTINCT FROM (p_expected).hard_expires_at
        OR floor(extract(epoch FROM s.created_at) * 1000)::bigint IS DISTINCT FROM (p_expected).created_at
        OR encode(s.identity_access_policy_sha256,'hex') IS DISTINCT FROM (p_expected).identity_access_policy_sha256
        OR encode(s.request_sha256,'hex') IS DISTINCT FROM (p_expected).request_sha256
        OR encode(s.validated_args_sha256,'hex') IS DISTINCT FROM (p_expected).validated_args_sha256
        OR encode(s.authorization_grant_sha256,'hex') IS DISTINCT FROM (p_expected).authorization_grant_sha256
        OR encode(s.application_execution_authority_sha256,'hex') IS DISTINCT FROM (p_expected).application_execution_authority_sha256
        OR s.finite_lease_expires_at IS NULL OR s.finite_claim_owner IS NULL OR s.finite_claim_fence IS NULL
        OR s.finite_claimed_at IS NULL OR s.finite_claim_expires_at IS NULL
        OR s.finite_claim_expires_at <= s.finite_claimed_at OR s.finite_claim_expires_at > s.finite_lease_expires_at
        OR s.finite_lease_expires_at > s.hard_expires_at THEN
        reason := 'storedCorruption'; RETURN NEXT; RETURN;
      END IF;
      IF s.finite_claim_owner <> p_claim_owner OR s.finite_claim_fence <> p_claim_fence THEN
        reason := 'ownershipChanged'; RETURN NEXT; RETURN;
      END IF;
      IF p_unique_definition_id IS NOT NULL THEN
        SELECT b.* INTO unique_row FROM %1$I.fx_system_unique_constraint_build b
          WHERE b.scope_id = p_scope_id AND b.unique_constraint_definition_id = p_unique_definition_id FOR KEY SHARE;
      END IF;
      IF p_index_definition_id IS NOT NULL THEN
        SELECT b.* INTO build_row FROM %1$I.fx_system_index_build_state b
          WHERE b.scope_id = p_scope_id AND b.index_definition_id = p_index_definition_id FOR KEY SHARE;
      END IF;
      -- Separate VOLATILE commands reacquire fresh snapshots after every selected build wait.
      SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint INTO current_time_ms;
      SELECT c.last_commit_seq INTO serving_commit_seq FROM %1$I.fx_system_scope_clock c WHERE c.scope_id = p_scope_id;
      database_now_epoch_milliseconds := current_time_ms::text;
      historical_change := false;
      IF build_row.covered_through_commit_seq IS NOT NULL AND build_row.covered_through_commit_seq < p_snapshot_commit_seq THEN
        SELECT r.commit_seq INTO table_frontier FROM %1$I.fx_app_row_current r
          WHERE r.scope_uuid = s.scope_uuid AND r.table_id = p_table_id ORDER BY r.commit_seq DESC LIMIT 1;
        IF table_frontier > build_row.covered_through_commit_seq THEN
          SELECT EXISTS(SELECT 1 FROM %1$I.fx_system_commit_app_row_change h WHERE h.scope_uuid = s.scope_uuid
            AND h.table_id = p_table_id AND h.commit_seq > build_row.covered_through_commit_seq
            AND h.commit_seq <= p_snapshot_commit_seq) INTO historical_change;
        END IF;
      ELSIF unique_row.covered_through_commit_seq IS NOT NULL AND unique_row.covered_through_commit_seq < p_snapshot_commit_seq THEN
        SELECT r.commit_seq INTO table_frontier FROM %1$I.fx_app_row_current r
          WHERE r.scope_uuid = s.scope_uuid AND r.table_id = p_table_id ORDER BY r.commit_seq DESC LIMIT 1;
        IF table_frontier > unique_row.covered_through_commit_seq THEN
          SELECT EXISTS(SELECT 1 FROM %1$I.fx_system_commit_app_row_change h WHERE h.scope_uuid = s.scope_uuid
            AND h.table_id = p_table_id AND h.commit_seq > unique_row.covered_through_commit_seq
            AND h.commit_seq <= p_snapshot_commit_seq) INTO historical_change;
        END IF;
      END IF;
      IF s.lifecycle <> 'running' THEN reason := 'lifecycleChanged'; RETURN NEXT; RETURN; END IF;
      IF current_time_ms >= floor(extract(epoch FROM s.finite_lease_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.finite_claim_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.authorization_grant_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.hard_expires_at)*1000) THEN
        reason := 'expired'; RETURN NEXT; RETURN;
      END IF;
      IF s.storage_generation <> authority_row.storage_generation OR s.storage_generation_fence <> authority_row.storage_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN NEXT; RETURN;
      END IF;
      IF p_epoch <> authority_row.epoch OR p_snapshot_epoch_uuid <> authority_row.epoch_uuid THEN
        reason := 'scopeEpochChanged'; RETURN NEXT; RETURN;
      END IF;
      IF s.authorization_revocation_epoch <> authority_row.authorization_revocation_epoch THEN
        reason := 'authorizationRevocationEpochChanged'; RETURN NEXT; RETURN;
      END IF;
      IF p_snapshot_commit_seq < authority_row.oldest_available_commit_seq THEN reason := 'expired'; RETURN NEXT; RETURN; END IF;
      -- Native cheap guards govern transfer eligibility. Canonical build
      -- evidence retains the original decoder's corruption/refusal ordering.
      body_eligible := serving_commit_seq >= p_snapshot_commit_seq;
      IF p_index_definition_id IS NOT NULL THEN
        body_eligible := body_eligible AND build_row.scope_id = p_scope_id
          AND build_row.storage_generation = authority_row.storage_generation
          AND build_row.storage_generation_fence = authority_row.storage_generation_fence
          AND build_row.epoch = authority_row.epoch AND build_row.lifecycle = 'enabled'
          AND build_row.first_readable_commit_seq <= p_snapshot_commit_seq
          AND build_row.covered_through_commit_seq IS NOT NULL
          AND build_row.covered_through_commit_seq <= serving_commit_seq
          AND (build_row.covered_through_commit_seq >= p_snapshot_commit_seq OR build_row.maintenance_bytes IS NOT NULL
            OR table_frontier IS NULL OR table_frontier <= build_row.covered_through_commit_seq
            OR build_row.covered_through_commit_seq >= authority_row.oldest_available_commit_seq AND NOT historical_change);
      END IF;
      IF p_unique_definition_id IS NOT NULL THEN
        body_eligible := body_eligible AND unique_row.scope_id = p_scope_id
          AND unique_row.storage_generation = authority_row.storage_generation
          AND unique_row.storage_generation_fence = authority_row.storage_generation_fence
          AND unique_row.epoch = authority_row.epoch AND unique_row.lifecycle = 'enabled'
          AND unique_row.start_commit_seq <= p_snapshot_commit_seq
          AND unique_row.covered_through_commit_seq IS NOT NULL
          AND unique_row.covered_through_commit_seq <= serving_commit_seq
          AND (unique_row.covered_through_commit_seq >= p_snapshot_commit_seq OR unique_row.maintenance_bytes IS NOT NULL
            OR table_frontier IS NULL OR table_frontier <= unique_row.covered_through_commit_seq
            OR unique_row.covered_through_commit_seq >= authority_row.oldest_available_commit_seq AND NOT historical_change);
      END IF;
      session_row := s; reason := 'accepted'; RETURN NEXT;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_finite_storage_capture(text,%1$I.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer) FROM PUBLIC', target_schema);
  EXECUTE format('DROP FUNCTION %1$I.fx_observe_finite_storage_frontier(text,integer,integer,bigint)', target_schema);
END $$;

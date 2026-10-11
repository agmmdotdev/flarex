-- Move complete finite readiness into the installed accepting owner.
-- Borrowing transactions drain before this routine/type cutover. Populated
-- application rows, history, sessions, journals and durable outcomes are retained.
DO $gate$
DECLARE gate fx_system_installation;
BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id=1;
  IF NOT pg_try_advisory_xact_lock(2147483002,(gate.namespace_oid-2147483648)::integer) THEN
    RAISE EXCEPTION 'finite accepting migration requires installation quiescence' USING ERRCODE='55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state='draining' AND gate.maintenance_pid=pg_backend_pid()
    AND gate.maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid())) THEN
    RAISE EXCEPTION 'finite accepting migration requires its managed maintenance owner' USING ERRCODE='55000';
  END IF;
END;
$gate$;
--> statement-breakpoint
DO $accepting$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format('DROP FUNCTION %1$I.fx_accept_finite_storage_capture(text,%1$I.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer) RESTRICT',target_schema);
  EXECUTE format('DROP TYPE %I.fx_finite_capture_frontier RESTRICT',target_schema);
  EXECUTE format($ddl$CREATE TYPE %1$I.fx_finite_read_expected AS (
    deployment_id text,schema_version_id text,activation_sequence bigint,
    manifest_sha256 bytea,head_sha256 bytea,activation_sha256 bytea,
    index_physical_spec_sha256 bytea,unique_physical_spec_sha256 bytea,accept_readiness boolean)$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %I.fx_finite_read_expected FROM PUBLIC',target_schema);
  EXECUTE format($ddl$CREATE TYPE %1$I.fx_finite_capture_frontier AS (
    reason text,database_now_epoch_milliseconds text,serving_commit_seq bigint,retained_floor bigint,
    session_row %1$I.fx_system_tx_session,body_eligible boolean)$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %I.fx_finite_capture_frontier FROM PUBLIC',target_schema);
  EXECUTE format($ddl$    CREATE FUNCTION %1$I.fx_accept_finite_storage_capture(p_scope_id text,
      p_expected %1$I.fx_finite_capture_expected, p_anchor_bytes bytea, p_anchor_sha256 bytea,
      p_snapshot_epoch_uuid uuid, p_snapshot_commit_seq bigint, p_metadata_watermark bigint,
      p_claim_owner uuid, p_claim_fence bigint, p_generation text, p_generation_fence bigint, p_epoch text,
      p_index_definition_id integer, p_table_id integer, p_unique_definition_id integer,
      p_read_basis %1$I.fx_finite_read_expected)
    RETURNS %1$I.fx_finite_capture_frontier
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE reason text; database_now_epoch_milliseconds text; serving_commit_seq bigint;
      authority_row %1$I.fx_system_scope_execution_authority;
      session_row %1$I.fx_system_tx_session;
      build_row %1$I.fx_system_index_build_state;
      unique_row %1$I.fx_system_unique_constraint_build;
      table_frontier bigint; historical_change boolean; body_eligible boolean := false;
      retained_floor bigint;
      index_maintenance %1$I.fx_system_index_maintenance_obligation;
      unique_maintenance %1$I.fx_system_unique_maintenance_obligation;
      index_ready boolean; unique_ready boolean;
      s %1$I.fx_system_tx_session; clock_row %1$I.fx_system_scope_clock; current_time_ms bigint;
      effective_statement_timeout interval;
    BEGIN
      -- Startup arms the statement before execution. Re-check the actual pooled
      -- session setting before authority, attempt or build locks and body access.
      effective_statement_timeout := current_setting('statement_timeout')::interval;
      IF effective_statement_timeout <= interval '0 milliseconds'
        OR effective_statement_timeout > interval '30000 milliseconds' THEN
        reason := 'resourceFailure'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      reason := 'invalidAuthority';
      IF p_scope_id IS NULL THEN RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      SELECT a.* INTO authority_row FROM %1$I.fx_system_scope_execution_authority a WHERE a.scope_id = p_scope_id FOR SHARE;
      IF authority_row.scope_id IS NULL THEN RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
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
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_generation <> 'flarexdb_v1' OR authority_row.storage_generation <> 'flarexdb_v1' THEN
        reason := 'unsupportedStorageGeneration'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF authority_row.storage_generation_fence IS DISTINCT FROM p_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF authority_row.epoch IS DISTINCT FROM p_epoch THEN reason := 'scopeEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      -- Identity lookup precedes fence interpretation, including corrupt replaced rows.
      SELECT a.* INTO s FROM %1$I.fx_system_tx_session a
        WHERE a.scope_uuid = (substring(p_scope_id FROM 7))::uuid AND a.session_id = (p_expected).session_id FOR SHARE;
      IF s.session_id IS NULL THEN reason := 'attemptMissing'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      IF NOT isfinite(s.authorization_grant_expires_at) OR NOT isfinite(s.hard_expires_at)
        OR NOT isfinite(s.created_at) OR NOT isfinite(s.updated_at)
        OR s.finite_lease_expires_at IS NULL OR NOT isfinite(s.finite_lease_expires_at)
        OR s.finite_claimed_at IS NULL OR NOT isfinite(s.finite_claimed_at)
        OR s.finite_claim_expires_at IS NULL OR NOT isfinite(s.finite_claim_expires_at) THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.finite_attempt_bytes IS NULL OR octet_length(s.finite_attempt_bytes) NOT BETWEEN 1 AND 131072
        OR s.finite_attempt_sha256 IS NULL OR octet_length(s.finite_attempt_sha256) <> 32
        OR s.finite_snapshot_epoch_uuid IS NULL OR s.finite_snapshot_commit_seq IS NULL
        OR s.finite_snapshot_commit_seq < 0 OR s.attempt_fence < 1
        OR s.finite_claim_owner IS NULL OR s.finite_claim_fence IS NULL OR s.finite_claim_fence < 1
        OR s.finite_claim_expires_at <= s.finite_claimed_at OR s.finite_claim_expires_at > s.finite_lease_expires_at
        OR s.finite_lease_expires_at > s.hard_expires_at THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.attempt_fence <> (p_expected).attempt_fence THEN
        -- The owning canonical decoder checks this fresh frontier before the
        -- replacement verdict. No business body is selected for this header.
        session_row := s; reason := 'attemptReplaced'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
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
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.finite_claim_owner <> p_claim_owner OR s.finite_claim_fence <> p_claim_fence THEN
        reason := 'ownershipChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
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
      IF s.lifecycle <> 'running' THEN reason := 'lifecycleChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      IF current_time_ms >= floor(extract(epoch FROM s.finite_lease_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.finite_claim_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.authorization_grant_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.hard_expires_at)*1000) THEN
        reason := 'expired'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.storage_generation <> authority_row.storage_generation OR s.storage_generation_fence <> authority_row.storage_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_epoch <> authority_row.epoch OR p_snapshot_epoch_uuid <> authority_row.epoch_uuid THEN
        reason := 'scopeEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.authorization_revocation_epoch <> authority_row.authorization_revocation_epoch THEN
        reason := 'authorizationRevocationEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_snapshot_commit_seq < authority_row.oldest_available_commit_seq THEN reason := 'expired'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      -- Complete mutable readiness belongs to this fresh accepting command.
      -- Corruption precedes availability; index fast paths retain their original
      -- early return before an optional unique demand. No live verdict is cached.
      retained_floor := authority_row.oldest_available_commit_seq;
      IF serving_commit_seq IS NULL OR serving_commit_seq < p_snapshot_commit_seq
        OR retained_floor > serving_commit_seq OR table_frontier < 1 THEN
        reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_index_definition_id IS NOT NULL AND (p_read_basis).accept_readiness THEN
        IF build_row.scope_id IS NULL THEN reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF (build_row.cursor_codec_version = 1
          AND build_row.scope_id = p_scope_id
          AND build_row.index_definition_id = p_index_definition_id
          AND build_row.index_definition_id > 0
          AND build_row.storage_generation = 'flarexdb_v1'
          AND build_row.storage_generation_fence > 0
          AND length(build_row.epoch) > 0
          AND build_row.start_commit_seq >= 0
          AND (build_row.covered_through_commit_seq IS NULL OR build_row.covered_through_commit_seq >= 0)
          AND (build_row.first_readable_commit_seq IS NULL OR build_row.first_readable_commit_seq >= 0 AND build_row.covered_through_commit_seq IS NOT NULL AND build_row.first_readable_commit_seq <= build_row.covered_through_commit_seq)
          AND build_row.lifecycle IN ('declared','building','backfilling','validating','enabled','retiring')
          AND (build_row.backfill_cursor_row_id IS NULL OR octet_length(build_row.backfill_cursor_row_id) = 16)
          AND (build_row.lifecycle NOT IN ('declared','building') OR build_row.backfill_cursor_row_id IS NULL)
          AND build_row.attempt_fence > 0
          AND isfinite(build_row.created_at)
          AND isfinite(build_row.updated_at)
          AND abs(floor(extract(epoch FROM build_row.created_at)*1000)) <= 8640000000000000
          AND abs(floor(extract(epoch FROM build_row.updated_at)*1000)) <= 8640000000000000
          AND floor(extract(epoch FROM build_row.updated_at)*1000) >= floor(extract(epoch FROM build_row.created_at)*1000)) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        SELECT m.* INTO index_maintenance FROM %1$I.fx_system_index_maintenance_obligation m
          WHERE m.scope_id = build_row.scope_id AND m.index_definition_id = build_row.index_definition_id
            AND m.activation_sequence = build_row.maintenance_activation_sequence;
        IF (build_row.maintenance_activation_sequence IS NULL) IS DISTINCT FROM (index_maintenance.scope_id IS NULL) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF index_maintenance.scope_id IS NOT NULL AND (index_maintenance.activation_sequence > 0
          AND index_maintenance.storage_generation = 'flarexdb_v1'
          AND index_maintenance.storage_generation_fence > 0
          AND length(index_maintenance.epoch) > 0
          AND index_maintenance.opened_commit_seq >= 0
          AND index_maintenance.table_id > 0
          AND octet_length(index_maintenance.physical_spec_sha256) = 32
          AND length(index_maintenance.deployment_id) > 0
          AND length(index_maintenance.schema_version_id) > 0
          AND octet_length(index_maintenance.activation_sha256) = 32
          AND octet_length(index_maintenance.head_sha256) = 32
          AND index_maintenance.index_definition_id > 0
          AND index_maintenance.attempt_fence > 0
          AND index_maintenance.first_readable_commit_seq >= 0
          AND index_maintenance.first_readable_commit_seq <= index_maintenance.opened_commit_seq
          AND octet_length(index_maintenance.schema_manifest_sha256) = 32
          AND build_row.lifecycle = 'enabled'
          AND index_maintenance.activation_sequence = build_row.maintenance_activation_sequence
          AND index_maintenance.scope_id = build_row.scope_id
          AND index_maintenance.index_definition_id = build_row.index_definition_id
          AND index_maintenance.storage_generation = build_row.storage_generation
          AND index_maintenance.storage_generation_fence = build_row.storage_generation_fence
          AND index_maintenance.epoch = build_row.epoch
          AND index_maintenance.attempt_fence = build_row.attempt_fence
          AND index_maintenance.first_readable_commit_seq = build_row.first_readable_commit_seq
          AND index_maintenance.opened_commit_seq = build_row.covered_through_commit_seq) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF build_row.start_commit_seq > serving_commit_seq OR build_row.covered_through_commit_seq > serving_commit_seq
          OR build_row.storage_generation IS DISTINCT FROM authority_row.storage_generation
          OR build_row.storage_generation_fence IS DISTINCT FROM authority_row.storage_generation_fence
          OR build_row.epoch IS DISTINCT FROM authority_row.epoch THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF build_row.lifecycle <> 'enabled' OR build_row.first_readable_commit_seq IS NULL
          OR build_row.first_readable_commit_seq > p_snapshot_commit_seq OR build_row.covered_through_commit_seq IS NULL THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF index_maintenance.scope_id IS NOT NULL AND (index_maintenance.table_id IS DISTINCT FROM p_table_id
          OR index_maintenance.physical_spec_sha256 IS DISTINCT FROM (p_read_basis).index_physical_spec_sha256) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        index_ready := build_row.covered_through_commit_seq >= p_snapshot_commit_seq
          OR index_maintenance.scope_id IS NOT NULL
            AND index_maintenance.deployment_id = (p_read_basis).deployment_id
            AND index_maintenance.schema_version_id = (p_read_basis).schema_version_id
            AND index_maintenance.activation_sequence = (p_read_basis).activation_sequence
            AND index_maintenance.head_sha256 = (p_read_basis).head_sha256
            AND index_maintenance.activation_sha256 = (p_read_basis).activation_sha256
            AND index_maintenance.schema_manifest_sha256 = (p_read_basis).manifest_sha256
          OR table_frontier IS NULL OR table_frontier <= build_row.covered_through_commit_seq;
        IF index_ready IS TRUE THEN reason := 'accepted'; body_eligible := true; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF build_row.covered_through_commit_seq < retained_floor OR historical_change THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
      END IF;
      IF p_unique_definition_id IS NOT NULL AND (p_read_basis).accept_readiness THEN
        IF unique_row.scope_id IS NULL THEN reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF (unique_row.scope_id = p_scope_id
          AND unique_row.unique_constraint_definition_id = p_unique_definition_id
          AND unique_row.unique_constraint_definition_id > 0
          AND unique_row.start_commit_seq >= 0
          AND (unique_row.covered_through_commit_seq IS NULL OR unique_row.covered_through_commit_seq >= unique_row.start_commit_seq)
          AND unique_row.attempt_fence > 0
          AND unique_row.storage_generation = 'flarexdb_v1'
          AND unique_row.storage_generation_fence > 0
          AND length(unique_row.epoch) > 0
          AND unique_row.lifecycle IN ('declared','building','backfilling','validating','enabled')
          AND (unique_row.cursor_row_id IS NULL OR octet_length(unique_row.cursor_row_id) = 16)
          AND (unique_row.lifecycle NOT IN ('declared','building','enabled') OR unique_row.cursor_row_id IS NULL)
          AND (unique_row.lifecycle NOT IN ('declared','building') OR unique_row.covered_through_commit_seq IS NULL)
          AND (unique_row.lifecycle <> 'enabled' OR unique_row.covered_through_commit_seq IS NOT NULL)
          AND isfinite(unique_row.created_at)
          AND isfinite(unique_row.updated_at)
          AND abs(floor(extract(epoch FROM unique_row.created_at)*1000)) <= 8640000000000000
          AND abs(floor(extract(epoch FROM unique_row.updated_at)*1000)) <= 8640000000000000
          AND floor(extract(epoch FROM unique_row.updated_at)*1000) >= floor(extract(epoch FROM unique_row.created_at)*1000)
          AND unique_row.start_commit_seq <= serving_commit_seq
          AND (unique_row.covered_through_commit_seq IS NULL OR unique_row.covered_through_commit_seq <= serving_commit_seq)) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        SELECT m.* INTO unique_maintenance FROM %1$I.fx_system_unique_maintenance_obligation m
          WHERE m.scope_id = unique_row.scope_id AND m.unique_constraint_definition_id = unique_row.unique_constraint_definition_id
            AND m.activation_sequence = unique_row.maintenance_activation_sequence;
        IF (unique_row.maintenance_activation_sequence IS NULL) IS DISTINCT FROM (unique_maintenance.scope_id IS NULL) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_maintenance.scope_id IS NOT NULL AND (unique_maintenance.activation_sequence > 0
          AND unique_maintenance.storage_generation = 'flarexdb_v1'
          AND unique_maintenance.storage_generation_fence > 0
          AND length(unique_maintenance.epoch) > 0
          AND unique_maintenance.opened_commit_seq >= 0
          AND unique_maintenance.table_id > 0
          AND octet_length(unique_maintenance.physical_spec_sha256) = 32
          AND length(unique_maintenance.deployment_id) > 0
          AND length(unique_maintenance.schema_version_id) > 0
          AND octet_length(unique_maintenance.activation_sha256) = 32
          AND octet_length(unique_maintenance.head_sha256) = 32
          AND unique_maintenance.unique_constraint_definition_id > 0
          AND unique_maintenance.attempt_fence > 0
          AND unique_maintenance.start_commit_seq >= 0
          AND unique_maintenance.start_commit_seq <= unique_maintenance.opened_commit_seq
          AND unique_row.lifecycle = 'enabled'
          AND unique_maintenance.activation_sequence = unique_row.maintenance_activation_sequence
          AND unique_maintenance.scope_id = unique_row.scope_id
          AND unique_maintenance.unique_constraint_definition_id = unique_row.unique_constraint_definition_id
          AND unique_maintenance.storage_generation = unique_row.storage_generation
          AND unique_maintenance.storage_generation_fence = unique_row.storage_generation_fence
          AND unique_maintenance.epoch = unique_row.epoch
          AND unique_maintenance.attempt_fence = unique_row.attempt_fence
          AND unique_maintenance.start_commit_seq = unique_row.start_commit_seq
          AND unique_maintenance.opened_commit_seq = unique_row.covered_through_commit_seq) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_row.storage_generation IS DISTINCT FROM authority_row.storage_generation
          OR unique_row.storage_generation_fence IS DISTINCT FROM authority_row.storage_generation_fence
          OR unique_row.epoch IS DISTINCT FROM authority_row.epoch OR unique_row.lifecycle <> 'enabled'
          OR unique_row.start_commit_seq > p_snapshot_commit_seq OR unique_row.covered_through_commit_seq IS NULL THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_maintenance.scope_id IS NOT NULL AND (unique_maintenance.table_id IS DISTINCT FROM p_table_id
          OR unique_maintenance.physical_spec_sha256 IS DISTINCT FROM (p_read_basis).unique_physical_spec_sha256) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        unique_ready := unique_row.covered_through_commit_seq >= p_snapshot_commit_seq
          OR unique_maintenance.scope_id IS NOT NULL
            AND unique_maintenance.deployment_id = (p_read_basis).deployment_id
            AND unique_maintenance.schema_version_id = (p_read_basis).schema_version_id
            AND unique_maintenance.activation_sequence = (p_read_basis).activation_sequence
            AND unique_maintenance.head_sha256 = (p_read_basis).head_sha256
            AND unique_maintenance.activation_sha256 = (p_read_basis).activation_sha256
          OR table_frontier IS NULL OR table_frontier <= unique_row.covered_through_commit_seq;
        IF unique_ready IS NOT TRUE AND (unique_row.covered_through_commit_seq < retained_floor OR historical_change) THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
      END IF;
      reason := 'accepted'; body_eligible := true; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
    END;
    $body$$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_finite_storage_capture(text,%1$I.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer,%1$I.fx_finite_read_expected) FROM PUBLIC',target_schema);
END;
$accepting$;

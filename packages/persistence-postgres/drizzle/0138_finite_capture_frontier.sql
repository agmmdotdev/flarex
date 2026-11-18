-- Replace private accepting proof topology under the real maintenance interlock.
-- Borrowing transactions drain before this routine/type cutover. Populated
-- application rows, history, sessions, journals and durable outcomes are retained.
DO $gate$
DECLARE gate fx_system_installation;
BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id=1;
  IF NOT pg_try_advisory_xact_lock(2147483002,(gate.namespace_oid-2147483648)::integer) THEN
    RAISE EXCEPTION 'finite frontier migration requires installation quiescence' USING ERRCODE='55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state='draining' AND gate.maintenance_pid=pg_backend_pid()
    AND gate.maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid())) THEN
    RAISE EXCEPTION 'finite frontier migration requires its managed maintenance owner' USING ERRCODE='55000';
  END IF;
END;
$gate$;
--> statement-breakpoint
DO $frontier$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$CREATE TYPE %1$I.fx_installation_frontier_expected AS (
    database_name text,
    schema_name text,
    namespace_oid bigint,
    incarnation uuid,
    structural_generation bigint,
    login text,
    endpoint_policy text,
    access_profile text,
    metadata_incarnation uuid)$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %I.fx_installation_frontier_expected FROM PUBLIC',target_schema);
  EXECUTE format($ddl$CREATE TYPE %1$I.fx_installation_frontier AS (
    accepted boolean,
    metadata_generation bigint)$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %I.fx_installation_frontier FROM PUBLIC',target_schema);
  EXECUTE format($ddl$CREATE TYPE %1$I.fx_finite_placement_frontier AS (
    reason text,
    scope_id text,
    deployment_id text,
    active_schema_version_id text,
    isolation_kind text,
    physical_locator_json jsonb,
    created_at timestamptz,
    receipt_scope_id text,
    receipt_protocol_version text,
    receipt_state text,
    receipt_physical_locator_json jsonb,
    receipt_initial_epoch text,
    receipt_reserved_at timestamptz,
    receipt_ready_at timestamptz,
    target_metadata_generation bigint,
    control_metadata_generation bigint)$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %I.fx_finite_placement_frontier FROM PUBLIC',target_schema);
  EXECUTE format($ddl$CREATE TYPE %1$I.fx_finite_capture_frontier AS (
    reason text,
    database_now_epoch_milliseconds text,
    serving_commit_seq bigint,
    authority_row %1$I.fx_system_scope_execution_authority,
    session_row %1$I.fx_system_tx_session,
    build_row %1$I.fx_system_index_build_state,
    unique_row %1$I.fx_system_unique_constraint_build,
    table_frontier bigint,
    historical_change boolean,
    body_eligible boolean)$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %I.fx_finite_capture_frontier FROM PUBLIC',target_schema);
  EXECUTE format('DROP FUNCTION %1$I.fx_accept_finite_storage_capture(text,%1$I.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer) RESTRICT',target_schema);
  -- Scalar capture owns authority, sequencer and post-wait observations. No
  -- serving consumer remains for the displaced separate scope observation.
  EXECUTE format('DROP FUNCTION %1$I.fx_lock_finite_scope_observation(text) RESTRICT',target_schema);
  -- All scoped entry, renewal, settlement and snapshot consumers now use the
  -- scalar placement frontier. Scope-less pair admission has its own direct gates.
  EXECUTE format('DROP FUNCTION %1$I.fx_lock_read_scope_placement(text,text) RESTRICT',target_schema);
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_lock_installation_frontier(
  p_expected %1$I.fx_installation_frontier_expected)
RETURNS %1$I.fx_installation_frontier
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE admitted record; generation bigint;
BEGIN
  -- A SECURITY DEFINER body retains the original SET ROLE setting. Authenticate
  -- the actual login, including callers entering through the placement owner.
  IF current_setting('role') NOT IN ('none', session_user)
    OR (p_expected).login IS DISTINCT FROM session_user THEN RETURN ROW(false,NULL::bigint); END IF;
  SELECT * INTO STRICT admitted FROM %1$I.fx_lock_installation_admission();
  SELECT e.generation INTO generation FROM %1$I.fx_system_installation_runtime p
    JOIN %1$I.fx_system_prepared_metadata_epoch e ON e.singleton_id = 1
    WHERE p.login = session_user AND p.login_oid = session_user::regrole::oid::bigint
      AND p.incarnation = admitted.incarnation AND p.structural_generation = admitted.structural_generation
      AND p.endpoint_policy = (p_expected).endpoint_policy AND p.access_profile = (p_expected).access_profile
      AND p.metadata_incarnation = (p_expected).metadata_incarnation
      AND admitted.database_name = current_database() AND admitted.database_name = (p_expected).database_name
      AND admitted.schema_name = (p_expected).schema_name
      AND admitted.namespace_oid = (p_expected).namespace_oid
      AND admitted.namespace_oid = (p_expected).schema_name::regnamespace::oid::bigint
      AND admitted.incarnation = (p_expected).incarnation
      AND admitted.structural_generation = (p_expected).structural_generation
      AND e.database_name = admitted.database_name AND e.namespace_oid = admitted.namespace_oid
      AND e.incarnation = (p_expected).metadata_incarnation AND e.generation > 0;
  RETURN ROW(FOUND,generation);
END;
$body$$ddl$,target_schema);
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_accept_finite_placement_frontier(
  p_target %1$I.fx_installation_frontier_expected,
  p_control %1$I.fx_installation_frontier_expected, p_deployment_id text, p_scope_id text)
RETURNS %1$I.fx_finite_placement_frontier
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE frontier %1$I.fx_finite_placement_frontier;
  control_gate %1$I.fx_installation_frontier; target_gate record;
  scope_row %1$I.fx_control_scope;
  receipt_row %1$I.fx_control_scope_provisioning;
  target_helper regprocedure; target_command text; effective_timeout interval;
BEGIN
  frontier.reason := 'invalidAuthority';
  effective_timeout := current_setting('statement_timeout')::interval;
  IF effective_timeout <= interval '0 milliseconds' OR effective_timeout > interval '30000 milliseconds' THEN
    frontier.reason := 'resourceFailure'; RETURN frontier;
  END IF;
  IF current_setting('role') NOT IN ('none',session_user)
    OR (p_target).login IS DISTINCT FROM session_user OR (p_control).login IS DISTINCT FROM session_user
    OR (p_target).access_profile IS DISTINCT FROM 'dataRuntime'
    OR (p_control).access_profile IS DISTINCT FROM 'controlRead'
    OR (p_control).schema_name IS DISTINCT FROM %1$L
    OR (p_target).schema_name IS NULL OR (p_target).schema_name = (p_control).schema_name THEN RETURN frontier; END IF;
  -- Authorize only the selected current placement's namespace before a
  -- privileged dynamic invocation. This unlocked read lends no serving verdict;
  -- installation admission and the final locked placement remain mandatory.
  IF NOT EXISTS(SELECT 1 FROM %1$I.fx_control_scope s
    WHERE s.id=p_scope_id AND s.deployment_id=p_deployment_id
      AND s.physical_locator_json ->> 'schemaName' = (p_target).schema_name) THEN RETURN frontier; END IF;
  target_helper := to_regprocedure(format('%%I.fx_lock_installation_frontier(%%I.fx_installation_frontier_expected)',
    (p_target).schema_name,(p_target).schema_name));
  IF target_helper IS NULL OR NOT has_function_privilege(session_user,target_helper,'EXECUTE') THEN RETURN frontier; END IF;
  -- Only one fixed installed helper is selectable. Its own owner authenticates
  -- the actual login and policy; this owner never reads an arbitrary target table.
  target_command := format('WITH accepted AS MATERIALIZED (SELECT %%I.fx_lock_installation_frontier(
    ROW(($1).database_name,($1).schema_name,($1).namespace_oid,($1).incarnation,
      ($1).structural_generation,($1).login,($1).endpoint_policy,($1).access_profile,
      ($1).metadata_incarnation)::%%I.fx_installation_frontier_expected) AS frontier)
    SELECT (frontier).accepted,(frontier).metadata_generation FROM accepted',
    (p_target).schema_name,(p_target).schema_name);
  IF (p_target).schema_name COLLATE "C" < (p_control).schema_name COLLATE "C" THEN
    EXECUTE target_command INTO target_gate USING p_target;
    IF target_gate.accepted IS DISTINCT FROM true THEN RETURN frontier; END IF;
    control_gate := %1$I.fx_lock_installation_frontier(p_control);
  ELSE
    control_gate := %1$I.fx_lock_installation_frontier(p_control);
    IF control_gate.accepted IS DISTINCT FROM true THEN RETURN frontier; END IF;
    EXECUTE target_command INTO target_gate USING p_target;
  END IF;
  IF target_gate.accepted IS DISTINCT FROM true OR control_gate.accepted IS DISTINCT FROM true THEN RETURN frontier; END IF;
  SELECT s.* INTO scope_row FROM %1$I.fx_control_scope s
    WHERE s.id = p_scope_id AND s.deployment_id = p_deployment_id FOR SHARE;
  IF NOT FOUND OR scope_row.physical_locator_json ->> 'schemaName'
    IS DISTINCT FROM (p_target).schema_name THEN RETURN frontier; END IF;
  SELECT r.* INTO receipt_row FROM %1$I.fx_control_scope_provisioning r
    WHERE r.scope_id = scope_row.id FOR SHARE;
  frontier.reason := 'accepted'; frontier.scope_id := scope_row.id;
  frontier.deployment_id := scope_row.deployment_id;
  frontier.active_schema_version_id := scope_row.active_schema_version_id;
  frontier.isolation_kind := scope_row.isolation_kind; frontier.physical_locator_json := scope_row.physical_locator_json;
  frontier.created_at := scope_row.created_at; frontier.receipt_scope_id := receipt_row.scope_id;
  frontier.receipt_protocol_version := receipt_row.protocol_version; frontier.receipt_state := receipt_row.state;
  frontier.receipt_physical_locator_json := receipt_row.physical_locator_json;
  frontier.receipt_initial_epoch := receipt_row.initial_epoch; frontier.receipt_reserved_at := receipt_row.reserved_at;
  frontier.receipt_ready_at := receipt_row.ready_at;
  frontier.target_metadata_generation := target_gate.metadata_generation;
  frontier.control_metadata_generation := control_gate.metadata_generation;
  RETURN frontier;
END;
$body$$ddl$,target_schema);
  EXECUTE format($ddl$    CREATE OR REPLACE FUNCTION %1$I.fx_accept_finite_storage_capture(p_scope_id text,
      p_expected %1$I.fx_finite_capture_expected, p_anchor_bytes bytea, p_anchor_sha256 bytea,
      p_snapshot_epoch_uuid uuid, p_snapshot_commit_seq bigint, p_metadata_watermark bigint,
      p_claim_owner uuid, p_claim_fence bigint, p_generation text, p_generation_fence bigint, p_epoch text,
      p_index_definition_id integer, p_table_id integer, p_unique_definition_id integer)
    RETURNS %1$I.fx_finite_capture_frontier
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE reason text; database_now_epoch_milliseconds text; serving_commit_seq bigint;
      authority_row %1$I.fx_system_scope_execution_authority;
      session_row %1$I.fx_system_tx_session;
      build_row %1$I.fx_system_index_build_state;
      unique_row %1$I.fx_system_unique_constraint_build;
      table_frontier bigint; historical_change boolean; body_eligible boolean;
      s %1$I.fx_system_tx_session; clock_row %1$I.fx_system_scope_clock; current_time_ms bigint;
      effective_statement_timeout interval;
    BEGIN
      -- Startup arms the statement before execution. Re-check the actual pooled
      -- session setting before authority, attempt or build locks and body access.
      effective_statement_timeout := current_setting('statement_timeout')::interval;
      IF effective_statement_timeout <= interval '0 milliseconds'
        OR effective_statement_timeout > interval '30000 milliseconds' THEN
        reason := 'resourceFailure'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      reason := 'invalidAuthority';
      IF p_scope_id IS NULL THEN RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible); END IF;
      SELECT a.* INTO authority_row FROM %1$I.fx_system_scope_execution_authority a WHERE a.scope_id = p_scope_id FOR SHARE;
      IF authority_row.scope_id IS NULL THEN RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible); END IF;
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
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF p_generation <> 'flarexdb_v1' OR authority_row.storage_generation <> 'flarexdb_v1' THEN
        reason := 'unsupportedStorageGeneration'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF authority_row.storage_generation_fence IS DISTINCT FROM p_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF authority_row.epoch IS DISTINCT FROM p_epoch THEN reason := 'scopeEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible); END IF;
      -- Identity lookup precedes fence interpretation, including corrupt replaced rows.
      SELECT a.* INTO s FROM %1$I.fx_system_tx_session a
        WHERE a.scope_uuid = (substring(p_scope_id FROM 7))::uuid AND a.session_id = (p_expected).session_id FOR SHARE;
      IF s.session_id IS NULL THEN reason := 'attemptMissing'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible); END IF;
      IF NOT isfinite(s.authorization_grant_expires_at) OR NOT isfinite(s.hard_expires_at)
        OR NOT isfinite(s.created_at) OR NOT isfinite(s.updated_at)
        OR s.finite_lease_expires_at IS NULL OR NOT isfinite(s.finite_lease_expires_at)
        OR s.finite_claimed_at IS NULL OR NOT isfinite(s.finite_claimed_at)
        OR s.finite_claim_expires_at IS NULL OR NOT isfinite(s.finite_claim_expires_at) THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF s.finite_attempt_bytes IS NULL OR octet_length(s.finite_attempt_bytes) NOT BETWEEN 1 AND 131072
        OR s.finite_attempt_sha256 IS NULL OR octet_length(s.finite_attempt_sha256) <> 32
        OR s.finite_snapshot_epoch_uuid IS NULL OR s.finite_snapshot_commit_seq IS NULL
        OR s.finite_snapshot_commit_seq < 0 OR s.attempt_fence < 1
        OR s.finite_claim_owner IS NULL OR s.finite_claim_fence IS NULL OR s.finite_claim_fence < 1
        OR s.finite_claim_expires_at <= s.finite_claimed_at OR s.finite_claim_expires_at > s.finite_lease_expires_at
        OR s.finite_lease_expires_at > s.hard_expires_at THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF s.attempt_fence <> (p_expected).attempt_fence THEN
        -- The owning canonical decoder checks this fresh frontier before the
        -- replacement verdict. No business body is selected for this header.
        session_row := s; reason := 'attemptReplaced'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
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
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF s.finite_claim_owner <> p_claim_owner OR s.finite_claim_fence <> p_claim_fence THEN
        reason := 'ownershipChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
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
      IF s.lifecycle <> 'running' THEN reason := 'lifecycleChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible); END IF;
      IF current_time_ms >= floor(extract(epoch FROM s.finite_lease_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.finite_claim_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.authorization_grant_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.hard_expires_at)*1000) THEN
        reason := 'expired'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF s.storage_generation <> authority_row.storage_generation OR s.storage_generation_fence <> authority_row.storage_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF p_epoch <> authority_row.epoch OR p_snapshot_epoch_uuid <> authority_row.epoch_uuid THEN
        reason := 'scopeEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF s.authorization_revocation_epoch <> authority_row.authorization_revocation_epoch THEN
        reason := 'authorizationRevocationEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
      END IF;
      IF p_snapshot_commit_seq < authority_row.oldest_available_commit_seq THEN reason := 'expired'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible); END IF;
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
          AND (build_row.covered_through_commit_seq >= p_snapshot_commit_seq OR build_row.maintenance_activation_sequence IS NOT NULL
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
          AND (unique_row.covered_through_commit_seq >= p_snapshot_commit_seq OR unique_row.maintenance_activation_sequence IS NOT NULL
            OR table_frontier IS NULL OR table_frontier <= unique_row.covered_through_commit_seq
            OR unique_row.covered_through_commit_seq >= authority_row.oldest_available_commit_seq AND NOT historical_change);
      END IF;
      session_row := s; reason := 'accepted'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, authority_row, session_row, build_row, unique_row, table_frontier, historical_change, body_eligible);
    END;
    $body$$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_lock_installation_frontier(%1$I.fx_installation_frontier_expected) FROM PUBLIC',target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_finite_placement_frontier(%1$I.fx_installation_frontier_expected,%1$I.fx_installation_frontier_expected,text,text) FROM PUBLIC',target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_finite_storage_capture(text,%1$I.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer) FROM PUBLIC',target_schema);
END;
$frontier$;

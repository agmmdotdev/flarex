-- Replace dynamic placement dispatch with native static installed composition.
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
DO $placement$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format('DROP FUNCTION %1$I.fx_accept_finite_placement_frontier(%1$I.fx_installation_frontier_expected,%1$I.fx_installation_frontier_expected,text,text) RESTRICT',target_schema);
  EXECUTE format('DROP TYPE %1$I.fx_finite_placement_frontier RESTRICT',target_schema);
  EXECUTE format($ddl$CREATE TYPE %1$I.fx_control_scope_placement AS (
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
    receipt_ready_at timestamptz)$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON TYPE %I.fx_control_scope_placement FROM PUBLIC',target_schema);
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_lock_control_scope_placement(
  p_control %1$I.fx_installation_frontier_expected,
  p_deployment_id text, p_scope_id text, p_target_schema text)
RETURNS %1$I.fx_control_scope_placement
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $body$
DECLARE frontier %1$I.fx_control_scope_placement;
  admitted record; generation bigint;
  scope_row %1$I.fx_control_scope;
  receipt_row %1$I.fx_control_scope_provisioning;
  effective_timeout interval;
BEGIN
  frontier.reason := 'invalidAuthority';
  effective_timeout := current_setting('statement_timeout')::interval;
  IF effective_timeout <= interval '0 milliseconds' OR effective_timeout > interval '30000 milliseconds' THEN
    frontier.reason := 'resourceFailure'; RETURN frontier;
  END IF;
  IF current_setting('role') NOT IN ('none',session_user)
    OR (p_control).login IS DISTINCT FROM session_user
    OR (p_control).access_profile IS DISTINCT FROM 'controlRead'
    OR (p_control).schema_name IS DISTINCT FROM %1$L
    OR p_target_schema IS NULL OR p_target_schema = (p_control).schema_name THEN RETURN frontier; END IF;
  -- Independently callable control locks authenticate their own installation.
  -- The native outer command owns ordered target/control acceptance. No client
  -- supplied accepted flag or privileged target invocation enters this helper.
  SELECT * INTO STRICT admitted FROM %1$I.fx_lock_installation_admission();
  SELECT e.generation INTO generation FROM %1$I.fx_system_installation_runtime p
    JOIN %1$I.fx_system_prepared_metadata_epoch e ON e.singleton_id = 1
    WHERE p.login = session_user AND p.login_oid = session_user::regrole::oid::bigint
      AND p.incarnation = admitted.incarnation AND p.structural_generation = admitted.structural_generation
      AND p.endpoint_policy = (p_control).endpoint_policy AND p.access_profile = (p_control).access_profile
      AND p.metadata_incarnation = (p_control).metadata_incarnation
      AND admitted.database_name = current_database() AND admitted.database_name = (p_control).database_name
      AND admitted.schema_name = (p_control).schema_name
      AND admitted.namespace_oid = (p_control).namespace_oid
      AND admitted.namespace_oid = (p_control).schema_name::regnamespace::oid::bigint
      AND admitted.incarnation = (p_control).incarnation
      AND admitted.structural_generation = (p_control).structural_generation
      AND e.database_name = admitted.database_name AND e.namespace_oid = admitted.namespace_oid
      AND e.incarnation = (p_control).metadata_incarnation AND e.generation > 0;
  IF NOT FOUND THEN RETURN frontier; END IF;
  SELECT s.* INTO scope_row FROM %1$I.fx_control_scope s
    WHERE s.id = p_scope_id AND s.deployment_id = p_deployment_id FOR SHARE;
  IF NOT FOUND OR scope_row.physical_locator_json ->> 'schemaName'
    IS DISTINCT FROM p_target_schema THEN RETURN frontier; END IF;
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
  RETURN frontier;
END;
$body$
$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_lock_control_scope_placement(%1$I.fx_installation_frontier_expected,text,text,text) FROM PUBLIC',target_schema);
END;
$placement$;

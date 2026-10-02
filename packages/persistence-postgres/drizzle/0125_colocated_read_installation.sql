-- A colocated reader has one login in two independently fenced namespaces.
-- Its control policy denies direct DML; this fixed function supplies only the
-- exact scope/receipt SHARE locks that require UPDATE privilege in PostgreSQL.
ALTER TABLE fx_system_installation_runtime ADD COLUMN access_profile text NOT NULL
  DEFAULT 'dataRuntime' CHECK (access_profile IN ('dataRuntime','controlRead'));
--> statement-breakpoint
DO $placement$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_lock_read_scope_placement(p_deployment_id text, p_scope_id text)
    RETURNS TABLE(scope_id text, deployment_id text, active_schema_version_id text,
      isolation_kind text, physical_locator_json jsonb, created_at timestamptz,
      receipt_scope_id text, receipt_protocol_version text, receipt_state text,
      receipt_physical_locator_json jsonb, receipt_initial_epoch text,
      receipt_reserved_at timestamptz, receipt_ready_at timestamptz)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp AS $body$
DECLARE admitted record; scope_row %1$I.fx_control_scope;
  receipt_row %1$I.fx_control_scope_provisioning;
BEGIN
  SELECT * INTO STRICT admitted FROM %1$I.fx_lock_installation_admission();
  IF NOT EXISTS (SELECT 1 FROM %1$I.fx_system_installation_runtime p
    WHERE p.login = session_user AND p.login_oid = session_user::pg_catalog.regrole::oid::bigint
      AND p.incarnation = admitted.incarnation
      AND p.structural_generation = admitted.structural_generation
      AND p.access_profile = 'controlRead') THEN
    RAISE EXCEPTION 'No installed control read policy' USING ERRCODE = '42501';
  END IF;
  SELECT s.* INTO scope_row FROM %1$I.fx_control_scope s
    WHERE s.id = p_scope_id AND s.deployment_id = p_deployment_id FOR SHARE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT r.* INTO receipt_row FROM %1$I.fx_control_scope_provisioning r
    WHERE r.scope_id = scope_row.id FOR SHARE;
  scope_id := scope_row.id;
  deployment_id := scope_row.deployment_id;
  active_schema_version_id := scope_row.active_schema_version_id;
  isolation_kind := scope_row.isolation_kind;
  physical_locator_json := scope_row.physical_locator_json;
  created_at := scope_row.created_at;
  receipt_scope_id := receipt_row.scope_id;
  receipt_protocol_version := receipt_row.protocol_version;
  receipt_state := receipt_row.state;
  receipt_physical_locator_json := receipt_row.physical_locator_json;
  receipt_initial_epoch := receipt_row.initial_epoch;
  receipt_reserved_at := receipt_row.reserved_at;
  receipt_ready_at := receipt_row.ready_at;
  RETURN NEXT;
END;
$body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_lock_read_scope_placement(text,text) FROM PUBLIC', target_schema);
END;
$placement$;

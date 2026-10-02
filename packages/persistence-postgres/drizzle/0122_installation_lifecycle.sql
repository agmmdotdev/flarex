-- Installation protection is independent of ordinary metadata invalidation.
-- Existing installations must be quiescent while this migration is installed.
-- Reserved two-int advisory namespaces: 2147483001 is dedicated maintenance
-- session ownership; 2147483002 is shared-transaction/exclusive-session entry.
-- namespace_oid - 2147483648 maps unsigned PostgreSQL OIDs injectively to int4.
-- The row remains the authoritative active/incarnation/generation snapshot fence.
CREATE TABLE fx_system_installation (
  singleton_id integer PRIMARY KEY CHECK (singleton_id = 1),
  database_name text NOT NULL,
  schema_name text NOT NULL,
  namespace_oid bigint NOT NULL,
  incarnation uuid NOT NULL,
  structural_generation bigint NOT NULL CHECK (structural_generation >= 1),
  state text NOT NULL CHECK (state IN ('unverified', 'draining', 'active')),
  maintenance_owner uuid,
  maintenance_pid integer,
  maintenance_backend_start timestamptz,
  CHECK ((state = 'draining') = (maintenance_owner IS NOT NULL
    AND maintenance_pid IS NOT NULL AND maintenance_backend_start IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE fx_system_installation_runtime (
  login text PRIMARY KEY,
  login_oid bigint NOT NULL,
  endpoint_policy text NOT NULL,
  incarnation uuid NOT NULL,
  structural_generation bigint NOT NULL,
  metadata_incarnation uuid NOT NULL
);
--> statement-breakpoint
INSERT INTO fx_system_installation
  (singleton_id, database_name, schema_name, namespace_oid, incarnation, structural_generation, state)
SELECT 1, current_database(), current_schema(), oid::bigint, gen_random_uuid(), 1, 'unverified'
FROM pg_catalog.pg_namespace WHERE nspname = current_schema();
--> statement-breakpoint
REVOKE ALL ON fx_system_installation, fx_system_installation_runtime FROM PUBLIC;
--> statement-breakpoint
DO $installation$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_lock_installation_admission()
    RETURNS TABLE(database_name text, schema_name text, namespace_oid bigint,
      incarnation uuid, structural_generation bigint)
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp AS $body$
DECLARE gate %1$I.fx_system_installation;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(2147483002,
    (SELECT (i.namespace_oid - 2147483648)::integer FROM %1$I.fx_system_installation i WHERE singleton_id = 1)) THEN
    RAISE EXCEPTION 'Installation maintenance admission is busy' USING ERRCODE = '55P03';
  END IF;
  SELECT i.* INTO STRICT gate FROM %1$I.fx_system_installation i
  WHERE singleton_id = 1 FOR SHARE NOWAIT;
  IF gate.state <> 'active' OR gate.database_name <> current_database() THEN
    RAISE EXCEPTION 'Installation is not active' USING ERRCODE = '55000';
  END IF;
  database_name := gate.database_name;
  schema_name := gate.schema_name;
  namespace_oid := gate.namespace_oid;
  incarnation := gate.incarnation;
  structural_generation := gate.structural_generation;
  RETURN NEXT;
END;
$body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_lock_installation_admission() FROM PUBLIC', target_schema);
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_require_active_installation() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER
    SET search_path = pg_catalog, pg_temp AS $body$
DECLARE gate %1$I.fx_system_installation;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(2147483002,
    (SELECT (i.namespace_oid - 2147483648)::integer FROM %1$I.fx_system_installation i WHERE singleton_id = 1)) THEN
    RAISE EXCEPTION 'Installation maintenance admission is busy' USING ERRCODE = '55P03';
  END IF;
  SELECT i.* INTO STRICT gate FROM %1$I.fx_system_installation i
  WHERE singleton_id = 1 FOR SHARE NOWAIT;
  -- Only the exact dedicated maintenance backend may write while draining.
  -- Owner/superuser status alone is not an admission bypass.
  IF gate.state = 'draining' AND gate.maintenance_pid = pg_backend_pid()
    AND gate.maintenance_backend_start = (
      SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid = pg_backend_pid()
    ) THEN
    RETURN NULL;
  END IF;
  IF gate.state <> 'active' OR gate.database_name <> current_database() THEN
    RAISE EXCEPTION 'Installation is not active' USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END;
$body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_require_active_installation() FROM PUBLIC', target_schema);
END;
$installation$;
--> statement-breakpoint
DO $writers$
DECLARE target_schema text := current_schema(); managed_table record;
  -- The trusted migrator selects one exact journal relation. It is protected
  -- by actual runtime DML/column privilege denial, including same-schema use.
  migration_journal oid := pg_catalog.to_regclass(nullif(
    pg_catalog.current_setting('flarex.installation_migration_journal', true), ''));
BEGIN
  FOR managed_table IN SELECT c.relname FROM pg_catalog.pg_class c
    WHERE c.relnamespace = target_schema::pg_catalog.regnamespace
      AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND c.relname NOT IN ('fx_system_installation', 'fx_system_installation_runtime')
      AND c.oid IS DISTINCT FROM migration_journal
  LOOP
    -- Alphabetically first, before protected metadata invalidation acquires its root.
    EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.fx_require_active_installation()',
      target_schema, managed_table.relname, target_schema);
  END LOOP;
END;
$writers$;

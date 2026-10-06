-- Installed frontier observations preserve every existing session/outcome/history.
-- Structural changes run only through bootstrap or the real closed installer.
DO $$ DECLARE gate fx_system_installation; BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id = 1;
  IF NOT pg_try_advisory_xact_lock(2147483002, (gate.namespace_oid - 2147483648)::integer) THEN
    RAISE EXCEPTION 'finite frontier migration requires installation quiescence' USING ERRCODE = '55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state = 'draining' AND gate.maintenance_pid = pg_backend_pid()
    AND gate.maintenance_backend_start = (SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid = pg_backend_pid())) THEN
    RAISE EXCEPTION 'finite frontier migration requires its managed maintenance owner' USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_observe_finite_storage_frontier(p_scope_id text, p_index_definition_id integer,
      p_table_id integer, p_snapshot_commit_seq bigint)
    RETURNS TABLE(database_now_epoch_milliseconds text, serving_commit_seq bigint,
      build_row %1$I.fx_system_index_build_state, table_frontier bigint, historical_change boolean)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF p_snapshot_commit_seq < 0 OR (p_index_definition_id IS NULL) <> (p_table_id IS NULL)
        OR p_index_definition_id < 1 OR p_table_id < 1 THEN
        RAISE EXCEPTION 'invalid finite frontier demand' USING ERRCODE = '22023';
      END IF;
      IF p_index_definition_id IS NOT NULL THEN
        SELECT b.* INTO build_row FROM %1$I.fx_system_index_build_state b
          WHERE b.scope_id = p_scope_id AND b.index_definition_id = p_index_definition_id FOR KEY SHARE;
      END IF;
      -- VOLATILE PL/pgSQL starts this command with a fresh Read Committed
      -- snapshot after the caller's anchor lock and this function's build wait.
      SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text, c.last_commit_seq
        INTO database_now_epoch_milliseconds, serving_commit_seq
        FROM %1$I.fx_system_scope_clock c WHERE c.scope_id = p_scope_id;
      historical_change := false;
      IF build_row.index_definition_id IS NOT NULL AND build_row.covered_through_commit_seq IS NOT NULL
        AND build_row.covered_through_commit_seq < p_snapshot_commit_seq THEN
        SELECT r.commit_seq INTO table_frontier FROM %1$I.fx_app_row_current r
          WHERE r.scope_uuid = (substring(p_scope_id FROM 7))::uuid AND r.table_id = p_table_id
          ORDER BY r.commit_seq DESC LIMIT 1;
        IF table_frontier > build_row.covered_through_commit_seq THEN
          SELECT EXISTS(SELECT 1 FROM %1$I.fx_system_commit_app_row_change h
            WHERE h.scope_uuid = (substring(p_scope_id FROM 7))::uuid AND h.table_id = p_table_id
              AND h.commit_seq > build_row.covered_through_commit_seq AND h.commit_seq <= p_snapshot_commit_seq)
            INTO historical_change;
        END IF;
      END IF;
      RETURN NEXT;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_observe_finite_storage_frontier(text,integer,integer,bigint) FROM PUBLIC', target_schema);
END $$;
--> statement-breakpoint
CREATE TRIGGER fx_prepared_metadata_invalidate
  BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON fx_control_schema_version
  FOR EACH STATEMENT EXECUTE FUNCTION fx_invalidate_prepared_metadata();
-- Managed structural maintenance changes installation incarnation and structural
-- generation before this migration. Prior preparations therefore fail installation
-- admission; no artifact content changes here require guarded metadata-epoch DML.

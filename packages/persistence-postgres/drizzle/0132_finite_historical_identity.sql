-- Historical identity is observed by a fresh internal Read Committed command
-- after the authentic capture's original-session and readiness waits.
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_read_historical_row_identity(p_scope_uuid uuid, p_table_id integer, p_row_id bytea)
    RETURNS TABLE(ordinal integer, identity_exists boolean)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    BEGIN
      IF p_scope_uuid IS NULL OR p_table_id IS NULL OR p_table_id < 1
        OR p_row_id IS NULL OR octet_length(p_row_id) <> 16 THEN
        RAISE EXCEPTION 'invalid historical row identity demand' USING ERRCODE = '22023';
      END IF;
      RETURN QUERY SELECT 0, EXISTS(SELECT 1 FROM %1$I.fx_app_row_rev r
        WHERE r.scope_uuid = p_scope_uuid AND r.table_id = p_table_id AND r.row_id = p_row_id);
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_read_historical_row_identity(uuid,integer,bytea) FROM PUBLIC', target_schema);
END $$;

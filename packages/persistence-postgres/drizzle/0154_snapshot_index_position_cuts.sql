-- Replace the private snapshot reader with exact full-position cuts. Durable rows are unchanged.
DO $maintenance_gate$
DECLARE gate fx_system_installation;
BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id=1;
  IF NOT pg_try_advisory_xact_lock(2147483002,(gate.namespace_oid-2147483648)::integer) THEN
    RAISE EXCEPTION 'Maintenance authority migration requires installation quiescence' USING ERRCODE='55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state='draining' AND gate.maintenance_pid=pg_backend_pid()
    AND gate.maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid())) THEN
    RAISE EXCEPTION 'Maintenance authority migration requires its managed owner' USING ERRCODE='55000';
  END IF;
END;
$maintenance_gate$;
--> statement-breakpoint
DO $snapshot_index_cuts$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$
    CREATE FUNCTION %1$I.fx_read_snapshot_index_page(p_scope_uuid uuid, p_index_definition_id integer,
      p_snapshot_commit_seq bigint, p_start_inclusive bytea, p_end_exclusive bytea,
      p_lower_key bytea, p_lower_row_id bytea, p_lower_inclusive boolean,
      p_upper_key bytea, p_upper_row_id bytea, p_upper_inclusive boolean, p_limit integer)
    RETURNS TABLE(ordinal integer, table_id_text text, key_codec_version_text text,
      physical_spec_sha256 bytea, encoded_key_bytes bytea, key_sha256 bytea, row_id_bytes bytea,
      commit_seq_text text, is_tombstone boolean)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE statement text;
    BEGIN
      IF p_scope_uuid IS NULL OR p_index_definition_id IS NULL OR p_index_definition_id < 1
        OR p_snapshot_commit_seq IS NULL OR p_snapshot_commit_seq < 0 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000
        OR p_lower_inclusive IS NULL OR p_upper_inclusive IS NULL
        OR (p_lower_key IS NULL) <> (p_lower_row_id IS NULL)
        OR (p_upper_key IS NULL) <> (p_upper_row_id IS NULL)
        OR (p_lower_row_id IS NOT NULL AND octet_length(p_lower_row_id) <> 16)
        OR (p_upper_row_id IS NOT NULL AND octet_length(p_upper_row_id) <> 16)
        OR (p_lower_key IS NOT NULL AND p_upper_key IS NOT NULL
          AND (p_lower_key,p_lower_row_id) > (p_upper_key,p_upper_row_id)) THEN
        RAISE EXCEPTION 'invalid snapshot index demand' USING ERRCODE = '22023';
      END IF;
      -- Only fixed predicate/operator fragments select the shape; all positions
      -- remain bound values. EXECUTE plans these actual cutoffs before selecting
      -- revisions and pagination, including after repeated generic outer plans.
      statement := $query$
        WITH latest AS (
          SELECT DISTINCT ON (r.encoded_key,r.row_id) r.table_id,r.key_codec_version,
            r.physical_spec_sha256,r.encoded_key,r.key_sha256,r.row_id,r.commit_seq,r.is_tombstone
          FROM %1$I.fx_app_index_entry_rev r
          WHERE r.scope_uuid=$1 AND r.index_definition_id=$2 AND r.commit_seq<=$3
      $query$;
      IF p_start_inclusive IS NOT NULL THEN statement := statement || ' AND r.encoded_key >= $4'; END IF;
      IF p_end_exclusive IS NOT NULL THEN statement := statement || ' AND r.encoded_key < $5'; END IF;
      IF p_lower_key IS NOT NULL THEN
        statement := statement || CASE WHEN p_lower_inclusive
          THEN ' AND (r.encoded_key,r.row_id) >= ($6,$7)'
          ELSE ' AND (r.encoded_key,r.row_id) > ($6,$7)' END;
      END IF;
      IF p_upper_key IS NOT NULL THEN
        statement := statement || CASE WHEN p_upper_inclusive
          THEN ' AND (r.encoded_key,r.row_id) <= ($8,$9)'
          ELSE ' AND (r.encoded_key,r.row_id) < ($8,$9)' END;
      END IF;
      statement := statement || $query$
          ORDER BY r.encoded_key,r.row_id,r.commit_seq DESC
        ), page AS MATERIALIZED (
          SELECT latest.* FROM latest WHERE NOT latest.is_tombstone
          ORDER BY latest.encoded_key,latest.row_id LIMIT $10 + 1
        )
        SELECT (row_number() OVER (ORDER BY page.encoded_key,page.row_id)-1)::integer,
          page.table_id::text,page.key_codec_version::text,page.physical_spec_sha256,
          page.encoded_key,page.key_sha256,page.row_id,page.commit_seq::text,page.is_tombstone
        FROM page ORDER BY page.encoded_key,page.row_id
      $query$;
      RETURN QUERY EXECUTE statement USING p_scope_uuid,p_index_definition_id,p_snapshot_commit_seq,
        p_start_inclusive,p_end_exclusive,p_lower_key,p_lower_row_id,p_upper_key,p_upper_row_id,p_limit;
    END;
    $body$
  $ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %I.fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,boolean,bytea,bytea,boolean,integer) FROM PUBLIC', target_schema);
  EXECUTE format('DROP FUNCTION %I.fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,integer)', target_schema);
END;
$snapshot_index_cuts$;

-- Fixed Application materialization composition through existing domain writers.
-- Changes private installed functions; preserves all durable data meanings.
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$

CREATE FUNCTION %1$I.fx_apply_app_unique_mutations(p_owners %1$I.fx_app_unique_owner[],
  p_previous %1$I.fx_app_unique_write[], p_next %1$I.fx_app_unique_write[])
RETURNS TABLE(reason text, mutations integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $unique_mutations$
DECLARE n integer := coalesce(array_length(p_owners, 1), 0); i integer; j integer; start_at integer; end_at integer;
  ordinal integer := 0; stage text := 'stored'; actual_table_id integer; actual_row_id bytea;
  actual_row %1$I."fx_app_unique_key"; owner_row %1$I."fx_app_unique_key"; previous_row %1$I."fx_app_unique_key"; actual_parent %1$I."fx_app_row_rev";
  stored_rows %1$I."fx_app_unique_key"[] := ARRAY[]::%1$I."fx_app_unique_key"[]; parent_rows %1$I."fx_app_row_rev"[];
  destinations %1$I.fx_app_unique_write[] := ARRAY[]::%1$I.fx_app_unique_write[];
  releases %1$I.fx_app_unique_write[] := ARRAY[]::%1$I.fx_app_unique_write[];
  claims %1$I.fx_app_unique_write[] := ARRAY[]::%1$I.fx_app_unique_write[];
  retained %1$I.fx_app_unique_write[] := ARRAY[]::%1$I.fx_app_unique_write[];
  absent %1$I.fx_app_unique_owner[] := ARRAY[]::%1$I.fx_app_unique_owner[];
  absent_ordinals integer[] := ARRAY[]::integer[];
  working_releases %1$I.fx_app_unique_write[]; working_claims %1$I.fx_app_unique_write[];
  verify_releases %1$I.fx_app_unique_write[]; verify_claims %1$I.fx_app_unique_write[];
  release_offset integer := 0; claim_offset integer := 0; inner_message text; inner_detail text;
  slot_seen boolean; owner_seen boolean; releasing boolean; unchanged boolean;
BEGIN
  IF n > 512 OR n <> coalesce(array_length(p_previous, 1), 0) OR n <> coalesce(array_length(p_next, 1), 0) THEN
    reason := 'invalidBatch'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
  END IF;
  IF n = 0 THEN reason := 'accepted'; mutations := 0; RETURN NEXT; RETURN; END IF;
  FOR start_at IN 1..n BY 32 LOOP
    end_at := least(start_at + 31, n); stage := 'parent'; parent_rows := ARRAY[]::%1$I."fx_app_row_rev"[];
    -- Preserve the existing batch's found-parent/tombstone checks before its
    -- ordered missing-parent refusal, and then lock its real slot evidence.
    FOR actual_parent IN SELECT r.* FROM %1$I."fx_app_row_current" c JOIN %1$I."fx_app_row_rev" r ON
      r."scope_uuid" = c."scope_uuid" AND r."table_id" = c."table_id" AND r."row_id" = c."row_id" AND r."commit_seq" = c."commit_seq"
      WHERE EXISTS (SELECT 1 FROM unnest(p_owners) WITH ORDINALITY wanted WHERE wanted.ordinality BETWEEN start_at AND end_at
        AND p_next[wanted.ordinality::integer] IS NOT NULL
        AND c."scope_uuid" = wanted."scope_uuid" AND c."table_id" = wanted."table_id" AND c."row_id" = wanted."row_id") LOOP
      SELECT wanted.ordinality::integer - 1 INTO ordinal FROM unnest(p_owners) WITH ORDINALITY wanted
        WHERE wanted.ordinality BETWEEN start_at AND end_at AND p_next[wanted.ordinality::integer] IS NOT NULL
          AND actual_parent."scope_uuid" IS NOT DISTINCT FROM wanted."scope_uuid" AND actual_parent."table_id" IS NOT DISTINCT FROM wanted."table_id" AND actual_parent."row_id" IS NOT DISTINCT FROM wanted."row_id"
        ORDER BY wanted.ordinality LIMIT 1;
      IF actual_parent."is_tombstone" IS NULL THEN
        reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
      END IF;
      IF actual_parent."is_tombstone" THEN reason := 'parentTombstone'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text; END IF;
      parent_rows := array_append(parent_rows, actual_parent);
    END LOOP;
    FOR i IN start_at..end_at LOOP
      ordinal := i - 1;
      IF p_next[i] IS NOT NULL AND NOT EXISTS (SELECT 1 FROM unnest(parent_rows) found_parent WHERE
        found_parent."scope_uuid" IS NOT DISTINCT FROM (p_owners[i])."scope_uuid" AND found_parent."table_id" IS NOT DISTINCT FROM (p_owners[i])."table_id" AND found_parent."row_id" IS NOT DISTINCT FROM (p_owners[i])."row_id") THEN
        reason := 'parentMissing'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
      END IF;
    END LOOP;
    stage := 'stored';
    FOR actual_row IN SELECT k.* FROM %1$I."fx_app_unique_key" k WHERE EXISTS (SELECT 1 FROM unnest(p_owners) WITH ORDINALITY wanted
      WHERE wanted.ordinality BETWEEN start_at AND end_at AND k."scope_uuid" = wanted."scope_uuid"
        AND k."constraint_id" = wanted."constraint_id" AND (
          k."scope_uuid" = wanted."scope_uuid" AND k."constraint_id" = wanted."constraint_id" AND k."locale_key" = wanted."locale_key" AND k."table_id" = wanted."table_id" AND k."row_id" = wanted."row_id" OR
          (p_previous[wanted.ordinality::integer] IS NOT NULL AND k."scope_uuid" = (p_previous[wanted.ordinality::integer])."scope_uuid" AND k."constraint_id" = (p_previous[wanted.ordinality::integer])."constraint_id" AND k."locale_key" = (p_previous[wanted.ordinality::integer])."locale_key" AND k."canonical_key_sha256" = (p_previous[wanted.ordinality::integer])."canonical_key_sha256") OR
          (p_next[wanted.ordinality::integer] IS NOT NULL AND k."scope_uuid" = (p_next[wanted.ordinality::integer])."scope_uuid" AND k."constraint_id" = (p_next[wanted.ordinality::integer])."constraint_id" AND k."locale_key" = (p_next[wanted.ordinality::integer])."locale_key" AND k."canonical_key_sha256" = (p_next[wanted.ordinality::integer])."canonical_key_sha256"))) FOR UPDATE OF k LOOP
      SELECT wanted.ordinality::integer - 1 INTO ordinal FROM unnest(p_owners) WITH ORDINALITY wanted
        WHERE wanted.ordinality BETWEEN start_at AND end_at
          AND actual_row."scope_uuid" = wanted."scope_uuid"
          AND actual_row."constraint_id" = wanted."constraint_id" AND (
            actual_row."scope_uuid" IS NOT DISTINCT FROM wanted."scope_uuid" AND actual_row."constraint_id" IS NOT DISTINCT FROM wanted."constraint_id" AND actual_row."locale_key" IS NOT DISTINCT FROM wanted."locale_key" AND actual_row."table_id" IS NOT DISTINCT FROM wanted."table_id" AND actual_row."row_id" IS NOT DISTINCT FROM wanted."row_id" OR
            (p_previous[wanted.ordinality::integer] IS NOT NULL AND actual_row."scope_uuid" IS NOT DISTINCT FROM (p_previous[wanted.ordinality::integer])."scope_uuid" AND actual_row."constraint_id" IS NOT DISTINCT FROM (p_previous[wanted.ordinality::integer])."constraint_id" AND actual_row."locale_key" IS NOT DISTINCT FROM (p_previous[wanted.ordinality::integer])."locale_key" AND actual_row."canonical_key_sha256" IS NOT DISTINCT FROM (p_previous[wanted.ordinality::integer])."canonical_key_sha256") OR
            (p_next[wanted.ordinality::integer] IS NOT NULL AND actual_row."scope_uuid" IS NOT DISTINCT FROM (p_next[wanted.ordinality::integer])."scope_uuid" AND actual_row."constraint_id" IS NOT DISTINCT FROM (p_next[wanted.ordinality::integer])."constraint_id" AND actual_row."locale_key" IS NOT DISTINCT FROM (p_next[wanted.ordinality::integer])."locale_key" AND actual_row."canonical_key_sha256" IS NOT DISTINCT FROM (p_next[wanted.ordinality::integer])."canonical_key_sha256"))
        ORDER BY wanted.ordinality LIMIT 1;
      -- The former stored-row decoder runs before any canonical-key comparison.
      -- Native uuid/integer/text/bytea types retain its scalar representations;
      -- these checks retain every required value, range, codec and byte bound.
      IF actual_row."scope_uuid" IS NULL OR actual_row."constraint_id" IS NULL OR actual_row."locale_key" IS NULL OR actual_row."canonical_key_sha256" IS NULL OR actual_row."key_codec_version" IS NULL OR actual_row."encoded_key" IS NULL OR actual_row."table_id" IS NULL OR actual_row."row_id" IS NULL OR
        actual_row."constraint_id" NOT BETWEEN 1 AND 2147483647 OR
        actual_row."table_id" NOT BETWEEN 1 AND 2147483647 OR
        actual_row."key_codec_version" IS DISTINCT FROM 1 OR
        octet_length(actual_row."encoded_key") NOT BETWEEN 1 AND 2048 OR
        octet_length(actual_row."canonical_key_sha256") IS DISTINCT FROM 32 OR
        octet_length(actual_row."row_id") IS DISTINCT FROM 16 THEN
        reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(stored_rows) prior WHERE
        (prior."scope_uuid" IS NOT DISTINCT FROM actual_row."scope_uuid" AND prior."constraint_id" IS NOT DISTINCT FROM actual_row."constraint_id" AND prior."locale_key" IS NOT DISTINCT FROM actual_row."locale_key" AND prior."table_id" IS NOT DISTINCT FROM actual_row."table_id" AND prior."row_id" IS NOT DISTINCT FROM actual_row."row_id" AND NOT (prior."scope_uuid" IS NOT DISTINCT FROM actual_row."scope_uuid" AND prior."constraint_id" IS NOT DISTINCT FROM actual_row."constraint_id" AND prior."locale_key" IS NOT DISTINCT FROM actual_row."locale_key" AND prior."canonical_key_sha256" IS NOT DISTINCT FROM actual_row."canonical_key_sha256")) OR
        (prior."scope_uuid" IS NOT DISTINCT FROM actual_row."scope_uuid" AND prior."constraint_id" IS NOT DISTINCT FROM actual_row."constraint_id" AND prior."locale_key" IS NOT DISTINCT FROM actual_row."locale_key" AND prior."canonical_key_sha256" IS NOT DISTINCT FROM actual_row."canonical_key_sha256" AND prior IS DISTINCT FROM actual_row)) THEN
        reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM unnest(stored_rows) prior WHERE prior."scope_uuid" IS NOT DISTINCT FROM actual_row."scope_uuid" AND prior."constraint_id" IS NOT DISTINCT FROM actual_row."constraint_id" AND prior."locale_key" IS NOT DISTINCT FROM actual_row."locale_key" AND prior."canonical_key_sha256" IS NOT DISTINCT FROM actual_row."canonical_key_sha256") THEN
        stored_rows := array_append(stored_rows, actual_row);
      END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1..n LOOP
    ordinal := i - 1; actual_table_id := NULL; actual_row_id := NULL; stage := 'destination';
    IF p_next[i] IS NOT NULL THEN
      SELECT k.* INTO actual_row FROM unnest(stored_rows) k WHERE k."scope_uuid" IS NOT DISTINCT FROM (p_next[i])."scope_uuid" AND k."constraint_id" IS NOT DISTINCT FROM (p_next[i])."constraint_id" AND k."locale_key" IS NOT DISTINCT FROM (p_next[i])."locale_key" AND k."canonical_key_sha256" IS NOT DISTINCT FROM (p_next[i])."canonical_key_sha256" LIMIT 1;
      slot_seen := FOUND;
      IF NOT slot_seen THEN
        SELECT k.* INTO actual_row FROM unnest(destinations) k WHERE k."scope_uuid" IS NOT DISTINCT FROM (p_next[i])."scope_uuid" AND k."constraint_id" IS NOT DISTINCT FROM (p_next[i])."constraint_id" AND k."locale_key" IS NOT DISTINCT FROM (p_next[i])."locale_key" AND k."canonical_key_sha256" IS NOT DISTINCT FROM (p_next[i])."canonical_key_sha256" LIMIT 1;
        slot_seen := FOUND;
      END IF;
      IF slot_seen THEN
        IF actual_row."key_codec_version" IS DISTINCT FROM (p_next[i])."key_codec_version" THEN
          reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
        END IF;
        IF actual_row."encoded_key" IS DISTINCT FROM (p_next[i])."encoded_key" THEN
          reason := 'hashCollision'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
        END IF;
        SELECT EXISTS (SELECT 1 FROM unnest(p_owners) WITH ORDINALITY selected WHERE
          selected."scope_uuid" IS NOT DISTINCT FROM actual_row."scope_uuid" AND selected."constraint_id" IS NOT DISTINCT FROM actual_row."constraint_id" AND selected."locale_key" IS NOT DISTINCT FROM actual_row."locale_key" AND selected."table_id" IS NOT DISTINCT FROM actual_row."table_id" AND selected."row_id" IS NOT DISTINCT FROM actual_row."row_id" AND p_previous[selected.ordinality::integer] IS NOT NULL AND
          (p_next[selected.ordinality::integer] IS NULL OR p_previous[selected.ordinality::integer] IS DISTINCT FROM p_next[selected.ordinality::integer])) INTO releasing;
        IF NOT (p_previous[i] IS NOT NULL AND actual_row."table_id" = (p_owners[i])."table_id"
          AND actual_row."row_id" = (p_owners[i])."row_id") AND
          (NOT releasing OR EXISTS (SELECT 1 FROM unnest(destinations) k WHERE k."scope_uuid" IS NOT DISTINCT FROM (p_next[i])."scope_uuid" AND k."constraint_id" IS NOT DISTINCT FROM (p_next[i])."constraint_id" AND k."locale_key" IS NOT DISTINCT FROM (p_next[i])."locale_key" AND k."canonical_key_sha256" IS NOT DISTINCT FROM (p_next[i])."canonical_key_sha256")) THEN
          reason := 'claimConflict'; actual_table_id := actual_row."table_id";
          actual_row_id := actual_row."row_id"; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
        END IF;
      END IF;
    END IF;
    stage := 'previous';
    SELECT k.* INTO owner_row FROM unnest(stored_rows) k WHERE k."scope_uuid" IS NOT DISTINCT FROM (p_owners[i])."scope_uuid" AND k."constraint_id" IS NOT DISTINCT FROM (p_owners[i])."constraint_id" AND k."locale_key" IS NOT DISTINCT FROM (p_owners[i])."locale_key" AND k."table_id" IS NOT DISTINCT FROM (p_owners[i])."table_id" AND k."row_id" IS NOT DISTINCT FROM (p_owners[i])."row_id" LIMIT 1;
    owner_seen := FOUND;
    IF p_previous[i] IS NULL THEN
      IF owner_seen THEN reason := 'previousMismatch'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text; END IF;
    ELSE
      SELECT k.* INTO previous_row FROM unnest(stored_rows) k WHERE k."scope_uuid" IS NOT DISTINCT FROM (p_previous[i])."scope_uuid" AND k."constraint_id" IS NOT DISTINCT FROM (p_previous[i])."constraint_id" AND k."locale_key" IS NOT DISTINCT FROM (p_previous[i])."locale_key" AND k."canonical_key_sha256" IS NOT DISTINCT FROM (p_previous[i])."canonical_key_sha256" LIMIT 1;
      IF NOT FOUND OR NOT owner_seen THEN reason := 'previousMismatch'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text; END IF;
      IF previous_row."key_codec_version" IS DISTINCT FROM (p_previous[i])."key_codec_version" THEN
        reason := 'storedCorruption'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
      END IF;
      IF previous_row."encoded_key" IS DISTINCT FROM (p_previous[i])."encoded_key" THEN
        reason := 'hashCollision'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text;
      END IF;
      IF NOT (previous_row."scope_uuid" IS NOT DISTINCT FROM (p_owners[i])."scope_uuid" AND previous_row."constraint_id" IS NOT DISTINCT FROM (p_owners[i])."constraint_id" AND previous_row."locale_key" IS NOT DISTINCT FROM (p_owners[i])."locale_key" AND previous_row."table_id" IS NOT DISTINCT FROM (p_owners[i])."table_id" AND previous_row."row_id" IS NOT DISTINCT FROM (p_owners[i])."row_id") OR
        NOT (previous_row."scope_uuid" IS NOT DISTINCT FROM owner_row."scope_uuid" AND previous_row."constraint_id" IS NOT DISTINCT FROM owner_row."constraint_id" AND previous_row."locale_key" IS NOT DISTINCT FROM owner_row."locale_key" AND previous_row."canonical_key_sha256" IS NOT DISTINCT FROM owner_row."canonical_key_sha256") THEN reason := 'previousMismatch'; RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('kind', 'admission', 'reason', reason, 'stage', stage, 'ordinal', ordinal,
    'actualTableId', actual_table_id, 'actualRowIdHex', encode(actual_row_id, 'hex'))::text; END IF;
    END IF;
    unchanged := p_previous[i] IS NOT NULL AND p_next[i] IS NOT NULL AND p_previous[i] IS NOT DISTINCT FROM p_next[i];
    IF unchanged THEN retained := array_append(retained, p_previous[i]);
    ELSE
      IF p_previous[i] IS NOT NULL THEN releases := array_append(releases, p_previous[i]); END IF;
      IF p_next[i] IS NULL THEN absent := array_append(absent, p_owners[i]); absent_ordinals := array_append(absent_ordinals, i - 1);
      ELSE claims := array_append(claims, p_next[i]); retained := array_append(retained, p_next[i]); destinations := array_append(destinations, p_next[i]); END IF;
    END IF;
  END LOOP;
  -- This is delegation to the existing complete write engine, not another
  -- release/claim implementation. All release pages precede every claim page.
  IF cardinality(releases) <= 32 AND cardinality(claims) <= 32 AND cardinality(releases) + cardinality(claims) > 0 THEN
    working_releases := releases; working_claims := claims; verify_releases := ARRAY[]::%1$I.fx_app_unique_write[];
    SELECT coalesce(array_agg(k), ARRAY[]::%1$I.fx_app_unique_write[]) INTO verify_claims FROM unnest(retained) k
      WHERE NOT EXISTS (SELECT 1 FROM unnest(claims) c WHERE c IS NOT DISTINCT FROM k);
    BEGIN
      PERFORM * FROM %1$I.fx_apply_app_unique_batch(working_releases, working_claims, verify_releases, verify_claims, absent, absent_ordinals);
    EXCEPTION WHEN SQLSTATE 'FX001' THEN
      GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
      IF inner_message <> 'fx_apply_app_unique_batch' THEN RAISE; END IF;
      RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('kind','proof',
        'releaseOffset',0,'releaseCount',cardinality(working_releases),'claimOffset',0,'claimCount',cardinality(working_claims),'detail',inner_detail)::text;
    END;
  ELSE
    IF cardinality(releases) = 0 AND cardinality(claims) = 0 AND cardinality(absent) > 0 THEN
      BEGIN
        PERFORM * FROM %1$I.fx_apply_app_unique_batch(releases, claims, releases, retained, absent, absent_ordinals);
      EXCEPTION WHEN SQLSTATE 'FX001' THEN
        GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
        IF inner_message <> 'fx_apply_app_unique_batch' THEN RAISE; END IF;
        RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('kind','proof',
          'releaseOffset',0,'releaseCount',0,'claimOffset',0,'claimCount',0,'detail',inner_detail)::text;
      END;
    END IF;
    FOR start_at IN 1..cardinality(releases) BY 32 LOOP
      working_releases := releases[start_at:least(start_at+31,cardinality(releases))];
      verify_releases := ARRAY[]::%1$I.fx_app_unique_write[]; verify_claims := ARRAY[]::%1$I.fx_app_unique_write[];
      IF cardinality(claims) = 0 AND start_at + cardinality(working_releases) > cardinality(releases) THEN
        verify_releases := releases[1:start_at-1]; verify_claims := retained;
      END IF;
      BEGIN
        PERFORM * FROM %1$I.fx_apply_app_unique_batch(working_releases, ARRAY[]::%1$I.fx_app_unique_write[], verify_releases, verify_claims,
          CASE WHEN cardinality(claims)=0 AND start_at+cardinality(working_releases)>cardinality(releases) THEN absent ELSE ARRAY[]::%1$I.fx_app_unique_owner[] END,
          CASE WHEN cardinality(claims)=0 AND start_at+cardinality(working_releases)>cardinality(releases) THEN absent_ordinals ELSE ARRAY[]::integer[] END);
      EXCEPTION WHEN SQLSTATE 'FX001' THEN
        GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
        IF inner_message <> 'fx_apply_app_unique_batch' THEN RAISE; END IF;
        RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('kind','proof',
          'releaseOffset',start_at-1,'releaseCount',cardinality(working_releases),'claimOffset',0,'claimCount',0,'detail',inner_detail)::text;
      END;
    END LOOP;
    FOR start_at IN 1..cardinality(claims) BY 32 LOOP
      working_claims := claims[start_at:least(start_at+31,cardinality(claims))];
      verify_releases := ARRAY[]::%1$I.fx_app_unique_write[]; verify_claims := ARRAY[]::%1$I.fx_app_unique_write[];
      IF start_at + cardinality(working_claims) > cardinality(claims) THEN
        verify_releases := releases;
        SELECT coalesce(array_agg(k), ARRAY[]::%1$I.fx_app_unique_write[]) INTO verify_claims FROM unnest(retained) k
          WHERE NOT EXISTS (SELECT 1 FROM unnest(working_claims) c WHERE c IS NOT DISTINCT FROM k);
      END IF;
      BEGIN
        PERFORM * FROM %1$I.fx_apply_app_unique_batch(ARRAY[]::%1$I.fx_app_unique_write[], working_claims, verify_releases, verify_claims,
          CASE WHEN start_at+cardinality(working_claims)>cardinality(claims) THEN absent ELSE ARRAY[]::%1$I.fx_app_unique_owner[] END,
          CASE WHEN start_at+cardinality(working_claims)>cardinality(claims) THEN absent_ordinals ELSE ARRAY[]::integer[] END);
      EXCEPTION WHEN SQLSTATE 'FX001' THEN
        GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
        IF inner_message <> 'fx_apply_app_unique_batch' THEN RAISE; END IF;
        RAISE EXCEPTION 'fx_apply_app_unique_mutations' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('kind','proof',
          'releaseOffset',0,'releaseCount',0,'claimOffset',start_at-1,'claimCount',cardinality(working_claims),'detail',inner_detail)::text;
      END;
    END LOOP;
  END IF;
  reason := 'accepted'; mutations := n; RETURN NEXT;
END;
$unique_mutations$;$ddl$, target_schema);
  EXECUTE format($ddl$

CREATE FUNCTION %1$I.fx_reset_app_index_validation(p_rows %1$I.fx_app_index_coverage[])
RETURNS TABLE(reason text, rows integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $index_validation$
DECLARE i integer; n integer := coalesce(array_length(p_rows,1),0); expected_row %1$I."fx_system_index_build_state"; actual_row %1$I."fx_system_index_build_state";
  expected_rows %1$I."fx_system_index_build_state"[] := ARRAY[]::%1$I."fx_system_index_build_state"[];
BEGIN
  IF n > 512 THEN RAISE EXCEPTION 'fx_reset_app_index_validation' USING ERRCODE='FX001', DETAIL='{"reason":"invalidBatch","ordinal":0}'; END IF;
  FOR i IN 1..n LOOP
    SELECT b.* INTO expected_row FROM %1$I."fx_system_index_build_state" b WHERE b."scope_id" = (p_rows[i])."scope_id" AND b."index_definition_id" = (p_rows[i])."index_definition_id" AND b."attempt_fence" = (p_rows[i])."attempt_fence" AND b."epoch" = (p_rows[i])."epoch" AND b."storage_generation_fence" = (p_rows[i])."storage_generation_fence"
      AND b."lifecycle" = 'validating';
    IF NOT FOUND THEN RAISE EXCEPTION 'fx_reset_app_index_validation' USING ERRCODE='FX001', DETAIL=jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text; END IF;
    expected_row."backfill_cursor_row_id" := NULL;
    expected_row."updated_at" := clock_timestamp();
    UPDATE %1$I."fx_system_index_build_state" b SET "backfill_cursor_row_id" = NULL,
      "updated_at" = expected_row."updated_at"
      WHERE b."scope_id" = (p_rows[i])."scope_id" AND b."index_definition_id" = (p_rows[i])."index_definition_id" AND b."attempt_fence" = (p_rows[i])."attempt_fence" AND b."epoch" = (p_rows[i])."epoch" AND b."storage_generation_fence" = (p_rows[i])."storage_generation_fence" AND b."lifecycle" = 'validating';
    SELECT b.* INTO actual_row FROM %1$I."fx_system_index_build_state" b WHERE b."scope_id" = (p_rows[i])."scope_id" AND b."index_definition_id" = (p_rows[i])."index_definition_id" AND b."attempt_fence" = (p_rows[i])."attempt_fence" AND b."epoch" = (p_rows[i])."epoch" AND b."storage_generation_fence" = (p_rows[i])."storage_generation_fence";
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_row THEN RAISE EXCEPTION 'fx_reset_app_index_validation' USING ERRCODE='FX001', DETAIL=jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text; END IF;
    expected_rows := array_append(expected_rows, expected_row);
  END LOOP;
  FOR i IN 1..n LOOP
    SELECT b.* INTO actual_row FROM %1$I."fx_system_index_build_state" b WHERE b."scope_id" = (p_rows[i])."scope_id" AND b."index_definition_id" = (p_rows[i])."index_definition_id" AND b."attempt_fence" = (p_rows[i])."attempt_fence" AND b."epoch" = (p_rows[i])."epoch" AND b."storage_generation_fence" = (p_rows[i])."storage_generation_fence";
    IF NOT FOUND OR actual_row IS DISTINCT FROM expected_rows[i] THEN RAISE EXCEPTION 'fx_reset_app_index_validation' USING ERRCODE='FX001', DETAIL=jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text; END IF;
  END LOOP;
  reason := 'accepted'; rows := n; RETURN NEXT;
END;
$index_validation$;$ddl$, target_schema);
  EXECUTE format($ddl$

CREATE OR REPLACE FUNCTION %1$I.fx_advance_app_coverage(p_indexes %1$I.fx_app_index_coverage[],
  p_unique %1$I.fx_app_unique_coverage[], p_seq bigint, p_prior bigint, p_check_prior boolean,
  p_verify_indexes %1$I.fx_app_index_coverage[], p_verify_unique %1$I.fx_app_unique_coverage[],
  p_verify_index_proofs text[], p_verify_unique_proofs text[])
RETURNS TABLE(reason text, family text, ordinal integer, index_proofs text[], unique_proofs text[])
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $coverage$
DECLARE i integer; n integer; stage text := 'write'; expected_index %1$I."fx_system_index_build_state"; actual_index %1$I."fx_system_index_build_state";
  expected_unique %1$I."fx_system_unique_constraint_build"; actual_unique %1$I."fx_system_unique_constraint_build"; sampled_now timestamptz := clock_timestamp();
  expected_indexes %1$I."fx_system_index_build_state"[] := ARRAY[]::%1$I."fx_system_index_build_state"[];
  expected_uniques %1$I."fx_system_unique_constraint_build"[] := ARRAY[]::%1$I."fx_system_unique_constraint_build"[];
BEGIN
  family := 'index'; ordinal := 0; index_proofs := ARRAY[]::text[]; unique_proofs := ARRAY[]::text[];
  IF coalesce(array_length(p_indexes, 1), 0) > 32 OR coalesce(array_length(p_unique, 1), 0) > 32
    OR coalesce(array_length(p_indexes, 1), 0) + coalesce(array_length(p_unique, 1), 0) +
       coalesce(array_length(p_verify_indexes, 1), 0) + coalesce(array_length(p_verify_unique, 1), 0) > 512
    OR coalesce(array_length(p_verify_indexes, 1), 0) <> coalesce(array_length(p_verify_index_proofs, 1), 0)
    OR coalesce(array_length(p_verify_unique, 1), 0) <> coalesce(array_length(p_verify_unique_proofs, 1), 0)
    THEN reason := 'invalidBatch'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
  n := coalesce(array_length(p_indexes, 1), 0);
  IF n > 0 THEN FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT b.* INTO expected_index FROM %1$I."fx_system_index_build_state" b WHERE
      b."scope_id" = (p_indexes[i])."scope_id" AND b."index_definition_id" = (p_indexes[i])."index_definition_id" AND b."attempt_fence" = (p_indexes[i])."attempt_fence" AND b."epoch" = (p_indexes[i])."epoch" AND b."storage_generation_fence" = (p_indexes[i])."storage_generation_fence"
      AND b."lifecycle" = 'enabled'
      AND b."maintenance_bytes" IS NULL
      AND (NOT p_check_prior OR b."covered_through_commit_seq" IS NOT DISTINCT FROM p_prior);
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    UPDATE %1$I."fx_system_index_build_state" b SET "covered_through_commit_seq" = p_seq,
      "updated_at" = sampled_now WHERE
      b."scope_id" = (p_indexes[i])."scope_id" AND b."index_definition_id" = (p_indexes[i])."index_definition_id" AND b."attempt_fence" = (p_indexes[i])."attempt_fence" AND b."epoch" = (p_indexes[i])."epoch" AND b."storage_generation_fence" = (p_indexes[i])."storage_generation_fence"
      AND b."lifecycle" = 'enabled';
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    expected_index."covered_through_commit_seq" := p_seq;
    expected_index."updated_at" := sampled_now;
    expected_indexes := array_append(expected_indexes, expected_index);
    SELECT b.* INTO actual_index FROM %1$I."fx_system_index_build_state" b WHERE
      b."scope_id" = (p_indexes[i])."scope_id"
      AND b."index_definition_id" = (p_indexes[i])."index_definition_id";
    IF NOT FOUND OR actual_index IS DISTINCT FROM expected_index THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
  END LOOP; END IF;
  family := 'unique'; n := coalesce(array_length(p_unique, 1), 0);
  IF n > 0 THEN FOR i IN 1..n LOOP
    ordinal := i - 1;
    SELECT b.* INTO expected_unique FROM %1$I."fx_system_unique_constraint_build" b WHERE
      b."scope_id" = (p_unique[i])."scope_id" AND b."unique_constraint_definition_id" = (p_unique[i])."unique_constraint_definition_id" AND b."attempt_fence" = (p_unique[i])."attempt_fence" AND b."epoch" = (p_unique[i])."epoch" AND b."storage_generation_fence" = (p_unique[i])."storage_generation_fence"
      AND b."lifecycle" = 'enabled'
      AND b."maintenance_bytes" IS NULL;
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    UPDATE %1$I."fx_system_unique_constraint_build" b SET "covered_through_commit_seq" = p_seq,
      "updated_at" = sampled_now WHERE
      b."scope_id" = (p_unique[i])."scope_id" AND b."unique_constraint_definition_id" = (p_unique[i])."unique_constraint_definition_id" AND b."attempt_fence" = (p_unique[i])."attempt_fence" AND b."epoch" = (p_unique[i])."epoch" AND b."storage_generation_fence" = (p_unique[i])."storage_generation_fence"
      AND b."lifecycle" = 'enabled';
    IF NOT FOUND THEN reason := 'concurrentStateChange'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    expected_unique."covered_through_commit_seq" := p_seq;
    expected_unique."updated_at" := sampled_now;
    expected_uniques := array_append(expected_uniques, expected_unique);
    SELECT b.* INTO actual_unique FROM %1$I."fx_system_unique_constraint_build" b WHERE
      b."scope_id" = (p_unique[i])."scope_id"
      AND b."unique_constraint_definition_id" = (p_unique[i])."unique_constraint_definition_id";
    IF NOT FOUND OR actual_unique IS DISTINCT FROM expected_unique THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
  END LOOP; END IF;
  -- Keep exact server projections: timestamptz precision must not round through JS Date.
  IF coalesce(array_length(expected_indexes, 1), 0) > 0 THEN FOR i IN 1..array_length(expected_indexes, 1) LOOP
    index_proofs := array_append(index_proofs, row_to_json(expected_indexes[i])::text);
  END LOOP; END IF;
  IF coalesce(array_length(expected_uniques, 1), 0) > 0 THEN FOR i IN 1..array_length(expected_uniques, 1) LOOP
    unique_proofs := array_append(unique_proofs, row_to_json(expected_uniques[i])::text);
  END LOOP; END IF;
  -- The final page freshly verifies prior and current complete stored projections.
  stage := 'verify'; family := 'index';
  IF coalesce(array_length(p_verify_indexes, 1), 0) + coalesce(array_length(p_indexes, 1), 0) > 0 THEN
    FOR i IN 1..(coalesce(array_length(p_verify_indexes, 1), 0) + coalesce(array_length(p_indexes, 1), 0)) LOOP
      ordinal := i - 1;
      SELECT b.* INTO actual_index FROM %1$I."fx_system_index_build_state" b WHERE
        b."scope_id" = ((p_verify_indexes || p_indexes)[i])."scope_id" AND b."index_definition_id" = ((p_verify_indexes || p_indexes)[i])."index_definition_id" AND b."attempt_fence" = ((p_verify_indexes || p_indexes)[i])."attempt_fence" AND b."epoch" = ((p_verify_indexes || p_indexes)[i])."epoch" AND b."storage_generation_fence" = ((p_verify_indexes || p_indexes)[i])."storage_generation_fence";
      IF NOT FOUND OR row_to_json(actual_index)::text IS DISTINCT FROM (p_verify_index_proofs || index_proofs)[i]
        THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    END LOOP;
  END IF;
  family := 'unique';
  IF coalesce(array_length(p_verify_unique, 1), 0) + coalesce(array_length(p_unique, 1), 0) > 0 THEN
    FOR i IN 1..(coalesce(array_length(p_verify_unique, 1), 0) + coalesce(array_length(p_unique, 1), 0)) LOOP
      ordinal := i - 1;
      SELECT b.* INTO actual_unique FROM %1$I."fx_system_unique_constraint_build" b WHERE
        b."scope_id" = ((p_verify_unique || p_unique)[i])."scope_id" AND b."unique_constraint_definition_id" = ((p_verify_unique || p_unique)[i])."unique_constraint_definition_id" AND b."attempt_fence" = ((p_verify_unique || p_unique)[i])."attempt_fence" AND b."epoch" = ((p_verify_unique || p_unique)[i])."epoch" AND b."storage_generation_fence" = ((p_verify_unique || p_unique)[i])."storage_generation_fence";
      IF NOT FOUND OR row_to_json(actual_unique)::text IS DISTINCT FROM (p_verify_unique_proofs || unique_proofs)[i]
        THEN reason := 'storedCorruption'; RAISE EXCEPTION 'fx_advance_app_coverage' USING ERRCODE = 'FX001', DETAIL = (jsonb_build_object('reason', reason, 'family', family, 'stage', stage, 'ordinal', ordinal))::text; END IF;
    END LOOP;
  END IF;
  reason := 'accepted'; family := NULL;
  ordinal := coalesce(array_length(p_indexes, 1), 0) + n; RETURN NEXT;
END;
$coverage$;$ddl$, target_schema);
  EXECUTE format($ddl$

CREATE FUNCTION %1$I.fx_apply_app_materialization(
  p_rows %1$I.fx_app_row_write[], p_row_pages integer[],
  p_indexes %1$I.fx_app_index_write[], p_index_prior bigint[], p_index_historical boolean[],
  p_unique_owners %1$I.fx_app_unique_owner[], p_unique_previous %1$I.fx_app_unique_write[], p_unique_next %1$I.fx_app_unique_write[],
  p_validation %1$I.fx_app_index_coverage[], p_index_coverage %1$I.fx_app_index_coverage[], p_unique_coverage %1$I.fx_app_unique_coverage[],
  p_seq bigint, p_search_scope uuid, p_search_tables integer[], p_search_indexes integer[], p_search_sources text[], p_search_modes boolean[],
  p_search_row_counts integer[], p_search_ids bytea[], p_search_text_counts integer[], p_search_text %1$I.fx_app_search_write[],
  p_search_json_counts integer[], p_search_json %1$I.fx_app_json_write[])
RETURNS TABLE(reason text, row_count integer, index_count integer, unique_count integer, validation_count integer, coverage_count integer, search_count integer, search_build_count integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $materialization$
DECLARE i integer; j integer; page_size integer; page_offset integer := 0; n integer; packet_count integer;
  inner_message text; inner_detail text; proof record; index_proofs text[] := ARRAY[]::text[]; unique_proofs text[] := ARRAY[]::text[];
  id_offset integer := 0; text_offset integer := 0; json_offset integer := 0; packet_ids bytea[]; page_ids bytea[];
  packet_text %1$I.fx_app_search_write[]; packet_json %1$I.fx_app_json_write[];
  page_text %1$I.fx_app_search_write[]; page_json %1$I.fx_app_json_write[];
  verify_text %1$I.fx_app_search_write[]; verify_json %1$I.fx_app_json_write[];
BEGIN
  row_count := coalesce(cardinality(p_rows),0); index_count := coalesce(cardinality(p_indexes),0);
  unique_count := coalesce(cardinality(p_unique_owners),0); validation_count := coalesce(cardinality(p_validation),0);
  coverage_count := coalesce(cardinality(p_index_coverage),0) + coalesce(cardinality(p_unique_coverage),0); search_count := 0; search_build_count := 0;
  -- Authenticate each later packet at its actual stage, never before an
  -- earlier primitive has had the opportunity to refuse its own write.
  IF row_count > 512 OR EXISTS (SELECT 1 FROM unnest(p_row_pages) size WHERE size IS NULL OR size < 1 OR size > 32)
    OR row_count <> coalesce((SELECT sum(size) FROM unnest(p_row_pages) size),0) THEN
    RAISE EXCEPTION 'Invalid fixed row page segmentation' USING ERRCODE='22023';
  END IF;
  FOREACH page_size IN ARRAY p_row_pages LOOP
    
  BEGIN
    
      PERFORM * FROM %1$I.fx_apply_app_row_batch(p_rows[page_offset+1:page_offset+page_size],
        CASE WHEN page_offset+page_size=row_count THEN p_rows[1:page_offset] ELSE ARRAY[]::%1$I.fx_app_row_write[] END);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
    IF inner_message <> 'fx_apply_app_row_batch' THEN RAISE; END IF;
    RAISE EXCEPTION 'fx_apply_app_materialization' USING ERRCODE='FX001', DETAIL=
      jsonb_build_object('family','row','pageOffset',page_offset,'detail',inner_detail)::text;
  END;
    page_offset := page_offset + page_size;
  END LOOP;
  IF index_count <> coalesce(cardinality(p_index_prior),0) OR index_count <> coalesce(cardinality(p_index_historical),0) OR index_count > 4096 THEN
    RAISE EXCEPTION 'Invalid fixed index segmentation' USING ERRCODE='22023';
  END IF;
  FOR i IN 1..index_count BY 32 LOOP
    page_offset := i-1; page_size := least(32,index_count-page_offset);
    
  BEGIN
    
      PERFORM * FROM %1$I.fx_apply_app_index_batch(p_indexes[i:i+page_size-1],p_index_prior[i:i+page_size-1],p_index_historical[i:i+page_size-1],
        CASE WHEN i+page_size>index_count THEN p_indexes[1:i-1] ELSE ARRAY[]::%1$I.fx_app_index_write[] END);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
    IF inner_message <> 'fx_apply_app_index_batch' THEN RAISE; END IF;
    RAISE EXCEPTION 'fx_apply_app_materialization' USING ERRCODE='FX001', DETAIL=
      jsonb_build_object('family','index','pageOffset',page_offset,'detail',inner_detail)::text;
  END;
  END LOOP;
  IF validation_count > 0 THEN
    
  BEGIN
    PERFORM * FROM %1$I.fx_reset_app_index_validation(p_validation);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
    IF inner_message <> 'fx_reset_app_index_validation' THEN RAISE; END IF;
    RAISE EXCEPTION 'fx_apply_app_materialization' USING ERRCODE='FX001', DETAIL=
      jsonb_build_object('family','indexValidation','pageOffset',0,'detail',inner_detail)::text;
  END;
  END IF;
  IF unique_count > 0 OR coalesce(cardinality(p_unique_previous),0)>0 OR coalesce(cardinality(p_unique_next),0)>0 THEN
    
  BEGIN
    PERFORM * FROM %1$I.fx_apply_app_unique_mutations(p_unique_owners,p_unique_previous,p_unique_next);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
    IF inner_message <> 'fx_apply_app_unique_mutations' THEN RAISE; END IF;
    RAISE EXCEPTION 'fx_apply_app_materialization' USING ERRCODE='FX001', DETAIL=
      jsonb_build_object('family','unique','pageOffset',0,'detail',inner_detail)::text;
  END;
  END IF;
  n := coalesce(cardinality(p_index_coverage),0);
  IF n > 512 THEN RAISE EXCEPTION 'Invalid fixed index coverage count' USING ERRCODE='22023'; END IF;
  FOR i IN 1..n BY 32 LOOP
    page_offset := i-1; page_size := least(32,n-page_offset);
    
  BEGIN
    
      SELECT * INTO proof FROM %1$I.fx_advance_app_coverage(p_index_coverage[i:i+page_size-1],ARRAY[]::%1$I.fx_app_unique_coverage[],p_seq,NULL,false,
        CASE WHEN i+page_size>n THEN p_index_coverage[1:i-1] ELSE ARRAY[]::%1$I.fx_app_index_coverage[] END,ARRAY[]::%1$I.fx_app_unique_coverage[],
        CASE WHEN i+page_size>n THEN index_proofs ELSE ARRAY[]::text[] END,ARRAY[]::text[]);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
    IF inner_message <> 'fx_advance_app_coverage' THEN RAISE; END IF;
    RAISE EXCEPTION 'fx_apply_app_materialization' USING ERRCODE='FX001', DETAIL=
      jsonb_build_object('family','indexCoverage','pageOffset',page_offset,'detail',inner_detail)::text;
  END;
    index_proofs := index_proofs || proof.index_proofs;
  END LOOP;
  n := coalesce(cardinality(p_unique_coverage),0);
  IF n > 512 THEN RAISE EXCEPTION 'Invalid fixed unique coverage count' USING ERRCODE='22023'; END IF;
  FOR i IN 1..n BY 32 LOOP
    page_offset := i-1; page_size := least(32,n-page_offset);
    
  BEGIN
    
      SELECT * INTO proof FROM %1$I.fx_advance_app_coverage(ARRAY[]::%1$I.fx_app_index_coverage[],p_unique_coverage[i:i+page_size-1],p_seq,NULL,false,
        ARRAY[]::%1$I.fx_app_index_coverage[],CASE WHEN i+page_size>n THEN p_unique_coverage[1:i-1] ELSE ARRAY[]::%1$I.fx_app_unique_coverage[] END,
        ARRAY[]::text[],CASE WHEN i+page_size>n THEN unique_proofs ELSE ARRAY[]::text[] END);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
    IF inner_message <> 'fx_advance_app_coverage' THEN RAISE; END IF;
    RAISE EXCEPTION 'fx_apply_app_materialization' USING ERRCODE='FX001', DETAIL=
      jsonb_build_object('family','uniqueCoverage','pageOffset',page_offset,'detail',inner_detail)::text;
  END;
    unique_proofs := unique_proofs || proof.unique_proofs;
  END LOOP;
  packet_count := coalesce(cardinality(p_search_tables),0);
  IF packet_count <> coalesce(cardinality(p_search_indexes),0) OR packet_count <> coalesce(cardinality(p_search_sources),0)
    OR packet_count <> coalesce(cardinality(p_search_modes),0) OR packet_count <> coalesce(cardinality(p_search_row_counts),0)
    OR packet_count <> coalesce(cardinality(p_search_text_counts),0) OR packet_count <> coalesce(cardinality(p_search_json_counts),0)
    OR EXISTS (SELECT 1 FROM unnest(p_search_row_counts) size WHERE size IS NULL OR size<1 OR size>512)
    OR EXISTS (SELECT 1 FROM unnest(p_search_text_counts) size WHERE size IS NULL OR size<0)
    OR EXISTS (SELECT 1 FROM unnest(p_search_json_counts) size WHERE size IS NULL OR size<0)
    OR coalesce((SELECT sum(size) FROM unnest(p_search_row_counts) size),0) <> coalesce(cardinality(p_search_ids),0)
    OR coalesce((SELECT sum(size) FROM unnest(p_search_text_counts) size),0) <> coalesce(cardinality(p_search_text),0)
    OR coalesce((SELECT sum(size) FROM unnest(p_search_json_counts) size),0) <> coalesce(cardinality(p_search_json),0) THEN
    RAISE EXCEPTION 'Invalid fixed search segmentation' USING ERRCODE='22023';
  END IF;
  FOR j IN 1..packet_count LOOP
    n := p_search_row_counts[j]; packet_ids := p_search_ids[id_offset+1:id_offset+n];
    packet_text := p_search_text[text_offset+1:text_offset+p_search_text_counts[j]];
    packet_json := p_search_json[json_offset+1:json_offset+p_search_json_counts[j]];
    -- Full identities and segmentation are authenticated for this definition
    -- before its first delegated DELETE, retaining definition failure order.
    IF EXISTS (SELECT 1 FROM unnest(packet_text) entry WHERE
      entry."scope_uuid" IS DISTINCT FROM p_search_scope OR entry."table_id" IS DISTINCT FROM p_search_tables[j]
      OR entry."logical_index_id" IS DISTINCT FROM p_search_indexes[j] OR entry."source_sha256" IS DISTINCT FROM p_search_sources[j]
      OR entry."commit_seq" IS DISTINCT FROM p_seq OR NOT entry."row_id"=ANY(packet_ids))
      OR EXISTS (SELECT 1 FROM unnest(packet_json) entry WHERE
        entry."scope_uuid" IS DISTINCT FROM p_search_scope OR entry."table_id" IS DISTINCT FROM p_search_tables[j]
        OR entry."logical_index_id" IS DISTINCT FROM p_search_indexes[j] OR entry."source_sha256" IS DISTINCT FROM p_search_sources[j]
        OR entry."commit_seq" IS DISTINCT FROM p_seq OR NOT entry."row_id"=ANY(packet_ids)) THEN
      RAISE EXCEPTION 'Invalid fixed search tuple identity' USING ERRCODE='22023';
    END IF;
    FOR i IN 1..n BY 32 LOOP
      page_offset := i-1; page_size := least(32,n-page_offset); page_ids := packet_ids[i:i+page_size-1];
      SELECT coalesce(array_agg(entry),ARRAY[]::%1$I.fx_app_search_write[]) INTO page_text FROM unnest(packet_text) entry
        WHERE entry."row_id"=ANY(page_ids);
      SELECT coalesce(array_agg(entry),ARRAY[]::%1$I.fx_app_json_write[]) INTO page_json FROM unnest(packet_json) entry
        WHERE entry."row_id"=ANY(page_ids);
      verify_text := ARRAY[]::%1$I.fx_app_search_write[]; verify_json := ARRAY[]::%1$I.fx_app_json_write[];
      IF i+page_size>n THEN
        SELECT coalesce(array_agg(entry),ARRAY[]::%1$I.fx_app_search_write[]) INTO verify_text FROM unnest(packet_text) entry
          WHERE entry."row_id"=ANY(packet_ids[1:i-1]);
        SELECT coalesce(array_agg(entry),ARRAY[]::%1$I.fx_app_json_write[]) INTO verify_json FROM unnest(packet_json) entry
          WHERE entry."row_id"=ANY(packet_ids[1:i-1]);
      END IF;
      
  BEGIN
    
        SELECT * INTO proof FROM %1$I.fx_apply_app_search_batch(p_search_scope,p_search_tables[j],p_search_indexes[j],p_search_sources[j],p_seq,
          page_ids,page_text,page_json,p_search_modes[j],i+page_size>n,
          CASE WHEN i+page_size>n THEN packet_ids[1:i-1] ELSE ARRAY[]::bytea[] END,verify_text,verify_json);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message = MESSAGE_TEXT, inner_detail = PG_EXCEPTION_DETAIL;
    IF inner_message <> 'fx_apply_app_search_batch' THEN RAISE; END IF;
    RAISE EXCEPTION 'fx_apply_app_materialization' USING ERRCODE='FX001', DETAIL=
      jsonb_build_object('family','search','pageOffset',id_offset+page_offset,'detail',inner_detail)::text;
  END;
      search_count := search_count + proof.entries;
      IF proof.build_advanced THEN search_build_count := search_build_count + 1; END IF;
    END LOOP;
    id_offset := id_offset+n; text_offset := text_offset+p_search_text_counts[j]; json_offset := json_offset+p_search_json_counts[j];
  END LOOP;
  reason := 'accepted'; RETURN NEXT;
END;
$materialization$;$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_unique_mutations(%1$I.fx_app_unique_owner[],%1$I.fx_app_unique_write[],%1$I.fx_app_unique_write[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_reset_app_index_validation(%1$I.fx_app_index_coverage[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_advance_app_coverage(%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],bigint,bigint,boolean,%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],text[],text[]) FROM PUBLIC', target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_materialization(%1$I.fx_app_row_write[],integer[],%1$I.fx_app_index_write[],bigint[],boolean[],%1$I.fx_app_unique_owner[],%1$I.fx_app_unique_write[],%1$I.fx_app_unique_write[],%1$I.fx_app_index_coverage[],%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],bigint,uuid,integer[],integer[],text[],boolean[],integer[],bytea[],integer[],%1$I.fx_app_search_write[],integer[],%1$I.fx_app_json_write[]) FROM PUBLIC', target_schema);
END $$;

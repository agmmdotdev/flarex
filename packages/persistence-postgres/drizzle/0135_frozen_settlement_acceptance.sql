-- Fixed current-state acceptance for once-prepared canonical transitions.
-- Changes private installed functions; preserves durable business formats.
DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$

CREATE FUNCTION %1$I.fx_accept_app_unique_owners(p_owners %1$I.fx_app_unique_owner[], p_previous bytea[], p_row_previous bigint[])
RETURNS TABLE(reason text, owners integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $unique_owners$
DECLARE n integer := coalesce(array_length(p_owners,1),0); i integer := 1; expected %1$I.fx_app_unique_owner;
  stored %1$I."fx_app_unique_key"; count integer; observed %1$I."fx_app_unique_key"[] := ARRAY[]::%1$I."fx_app_unique_key"[]; counts integer[] := ARRAY[]::integer[];
BEGIN
  IF coalesce(array_length(p_previous,1),0) <> n OR coalesce(array_length(p_row_previous,1),0) <> n THEN
    RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','invalidBatch','ordinal',0)::text;
  END IF;
  IF n > 0 THEN FOR i IN 1..n LOOP
    expected := p_owners[i]; count := 0;
    IF expected."scope_uuid" IS NULL OR expected."constraint_id" IS NULL OR
      expected."locale_key" IS NULL OR expected."table_id" IS NULL OR
      octet_length(expected."row_id") IS DISTINCT FROM 16 THEN
      RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','invalidBatch','ordinal',i-1)::text;
    END IF;
    FOR stored IN SELECT u.* FROM %1$I."fx_app_unique_key" u WHERE u."scope_uuid" = expected."scope_uuid"
      AND u."constraint_id" = expected."constraint_id"
      AND u."table_id" = expected."table_id"
      AND u."row_id" = expected."row_id" LOOP
      count := count+1;
      IF count > 1 OR stored."scope_uuid" IS NULL OR stored."constraint_id" IS NULL OR
        stored."locale_key" IS NULL OR stored."table_id" IS NULL OR
        stored."constraint_id" < 1 OR stored."constraint_id" > 2147483647 OR
        stored."table_id" < 1 OR stored."table_id" > 2147483647 OR
        stored."key_codec_version" IS DISTINCT FROM 1 OR
        stored."encoded_key" IS NULL OR octet_length(stored."encoded_key") < 1 OR
        octet_length(stored."encoded_key") > 2048 OR
        octet_length(stored."canonical_key_sha256") IS DISTINCT FROM 32 OR
        octet_length(stored."row_id") IS DISTINCT FROM 16 THEN
        RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text;
      END IF;
      IF pg_catalog.sha256(stored."encoded_key") IS DISTINCT FROM stored."canonical_key_sha256" THEN
        RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','storedCorruption','ordinal',i-1)::text;
      END IF;
      observed[i] := stored;
    END LOOP;
    counts[i] := count;
  END LOOP;
  FOR i IN 1..n LOOP
    expected := p_owners[i]; stored := observed[i];
    IF counts[i] = 0 THEN
      IF p_previous[i] IS NOT NULL THEN
        RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','previousMismatch','ordinal',i-1)::text;
      END IF;
    ELSIF p_row_previous[i] IS NULL OR p_row_previous[i] <= 0 OR p_previous[i] IS NULL OR
      stored."locale_key" IS DISTINCT FROM expected."locale_key" OR
      stored."encoded_key" IS DISTINCT FROM p_previous[i] THEN
      RAISE EXCEPTION 'fx_accept_app_unique_owners' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('reason','previousMismatch','ordinal',i-1)::text;
    END IF;
  END LOOP; END IF;
  reason := 'accepted'; owners := n; RETURN NEXT;
END;
$unique_owners$;
$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_app_unique_owners(%1$I.fx_app_unique_owner[],bytea[],bigint[]) FROM PUBLIC', target_schema);
END $$;

--> statement-breakpoint

DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$

CREATE FUNCTION %1$I.fx_accept_app_index_transitions(p_scope text, p_scope_uuid uuid,
  p_indexes integer[], p_access text[], p_tables integer[], p_codecs integer[], p_specs bytea[], p_ids bytea[],
  p_previous bytea[], p_previous_sha bytea[], p_final bytea[], p_final_sha bytea[], p_row_previous bigint[],
  p_attempts bigint[], p_epochs text[], p_fences bigint[], p_maximum integer)
RETURNS TABLE(reason text, pair_ordinal integer, key_ordinal integer, transition_kind text,
  prior_commit_seq bigint, prior_is_tombstone boolean, emitted_count integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $index_transitions$
DECLARE n integer := coalesce(array_length(p_indexes,1),0); i integer := 1; j integer; refusal text;
  b %1$I."fx_system_index_build_state"; latest %1$I."fx_app_index_entry_rev"; pointer_seq bigint; captured record; selected_key bytea; selected_sha bytea;
  previous_seq bigint[] := ARRAY[]::bigint[]; final_seq bigint[] := ARRAY[]::bigint[];
  previous_tomb boolean[] := ARRAY[]::boolean[]; final_tomb boolean[] := ARRAY[]::boolean[];
  lifecycles text[] := ARRAY[]::text[]; last_index integer; last_attempt bigint; last_epoch text; last_fence bigint;
BEGIN
  emitted_count := 0;
  IF p_scope IS NULL OR p_scope_uuid IS NULL OR p_maximum IS NULL OR p_maximum < 0 OR p_maximum > 4096 OR
    coalesce(array_length(p_access,1),0) <> n OR coalesce(array_length(p_tables,1),0) <> n OR coalesce(array_length(p_codecs,1),0) <> n OR
    coalesce(array_length(p_specs,1),0) <> n OR coalesce(array_length(p_ids,1),0) <> n OR
    coalesce(array_length(p_previous,1),0) <> n OR coalesce(array_length(p_previous_sha,1),0) <> n OR
    coalesce(array_length(p_final,1),0) <> n OR coalesce(array_length(p_final_sha,1),0) <> n OR
    coalesce(array_length(p_row_previous,1),0) <> n OR coalesce(array_length(p_attempts,1),0) <> n OR
    coalesce(array_length(p_epochs,1),0) <> n OR coalesce(array_length(p_fences,1),0) <> n THEN
    refusal := 'invalidBatch'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text;
  END IF;
  IF n > 0 THEN FOR i IN 1..n LOOP
    IF p_access[i] IS NULL OR p_access[i] NOT IN ('developer','by_creation_time') OR p_indexes[i] IS NULL OR p_indexes[i] <= 0 OR p_tables[i] IS NULL OR p_tables[i] <= 0 OR
      p_codecs[i] IS DISTINCT FROM 1 OR octet_length(p_specs[i]) IS DISTINCT FROM 32 OR
      octet_length(p_ids[i]) IS DISTINCT FROM 16 OR p_attempts[i] IS NULL OR p_epochs[i] IS NULL OR p_fences[i] IS NULL OR
      (p_row_previous[i] IS NOT NULL AND p_row_previous[i] <= 0) THEN refusal := 'invalidBatch'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
    IF i = 1 OR last_index IS DISTINCT FROM p_indexes[i] OR last_attempt IS DISTINCT FROM p_attempts[i] OR
      last_epoch IS DISTINCT FROM p_epochs[i] OR last_fence IS DISTINCT FROM p_fences[i] THEN
    SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope
      AND x."index_definition_id" = p_indexes[i];
    IF NOT FOUND OR b."attempt_fence" IS DISTINCT FROM p_attempts[i] OR
      b."epoch" IS DISTINCT FROM p_epochs[i] OR
      b."storage_generation_fence" IS DISTINCT FROM p_fences[i] OR
      b."lifecycle" IS NULL OR
      b."lifecycle" NOT IN ('declared','building','backfilling','validating','enabled')
      THEN refusal := 'buildInvalid'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
      last_index := p_indexes[i]; last_attempt := p_attempts[i]; last_epoch := p_epochs[i]; last_fence := p_fences[i];
    END IF;
    lifecycles[i] := b."lifecycle";
    FOR j IN 0..1 LOOP
      selected_key := CASE WHEN j = 0 THEN p_previous[i] ELSE p_final[i] END;
      selected_sha := CASE WHEN j = 0 THEN p_previous_sha[i] ELSE p_final_sha[i] END;
      IF j = 1 AND p_previous[i] IS NOT NULL AND p_previous[i] IS NOT DISTINCT FROM p_final[i] THEN
        IF p_previous_sha[i] IS DISTINCT FROM p_final_sha[i] THEN refusal := 'invalidBatch'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
        final_seq[i] := previous_seq[i]; final_tomb[i] := previous_tomb[i]; CONTINUE;
      END IF;
      pointer_seq := NULL; latest := NULL;
      IF selected_key IS NULL THEN
        IF selected_sha IS NOT NULL THEN refusal := 'invalidBatch'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
      ELSE
        IF octet_length(selected_key) < 1 OR octet_length(selected_key) > 2048 OR
          octet_length(selected_sha) IS DISTINCT FROM 32 OR pg_catalog.sha256(selected_key) IS DISTINCT FROM selected_sha
          THEN refusal := 'invalidBatch'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
        SELECT c."commit_seq" AS pointer_seq, r AS latest_row INTO captured
          FROM (VALUES (1)) request(dummy)
          LEFT JOIN %1$I."fx_app_index_entry_current" c ON c."scope_uuid" = p_scope_uuid
            AND c."index_definition_id" = p_indexes[i]
            AND c."encoded_key" = selected_key AND c."row_id" = p_ids[i]
          LEFT JOIN LATERAL (SELECT rev.* FROM %1$I."fx_app_index_entry_rev" rev WHERE rev."scope_uuid" = p_scope_uuid
            AND rev."index_definition_id" = p_indexes[i]
            AND rev."encoded_key" = selected_key AND rev."row_id" = p_ids[i]
            ORDER BY rev."commit_seq" DESC LIMIT 1) r ON true;
        pointer_seq := captured.pointer_seq; latest := captured.latest_row;
        IF latest."commit_seq" IS NULL THEN
          IF pointer_seq IS NOT NULL THEN refusal := 'storedCorruption'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
        ELSIF latest."commit_seq" <= 0 OR
          latest."table_id" IS DISTINCT FROM p_tables[i] OR
          latest."key_codec_version" IS DISTINCT FROM p_codecs[i] OR
          latest."physical_spec_sha256" IS DISTINCT FROM p_specs[i] OR
          latest."key_sha256" IS DISTINCT FROM selected_sha OR
          latest."is_tombstone" IS NULL OR
          (latest."is_tombstone" AND pointer_seq IS NOT NULL) OR
          (NOT latest."is_tombstone" AND pointer_seq IS DISTINCT FROM latest."commit_seq")
          THEN refusal := 'storedCorruption'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text;
        END IF;
      END IF;
      IF j = 0 THEN previous_seq[i] := latest."commit_seq";
        previous_tomb[i] := latest."is_tombstone";
      ELSE final_seq[i] := latest."commit_seq";
        final_tomb[i] := latest."is_tombstone"; END IF;
    END LOOP;
  END LOOP;
  FOR i IN 1..n LOOP
    pair_ordinal := i-1;
    IF p_previous[i] IS NOT NULL THEN
      IF (previous_seq[i] IS NOT NULL AND (previous_tomb[i] OR p_row_previous[i] IS NULL OR previous_seq[i] > p_row_previous[i])) OR
        (previous_seq[i] IS NULL AND lifecycles[i] = 'enabled')
        THEN refusal := 'transitionInvalid'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
      IF p_previous[i] IS NOT DISTINCT FROM p_final[i] AND previous_seq[i] IS NULL THEN
        reason := 'transition'; key_ordinal := 0; transition_kind := 'live'; prior_commit_seq := NULL; prior_is_tombstone := NULL;
        emitted_count := emitted_count+1; RETURN NEXT;
      ELSIF p_previous[i] IS DISTINCT FROM p_final[i] AND previous_seq[i] IS NOT NULL THEN
        reason := 'transition'; key_ordinal := 0; transition_kind := 'tombstone'; prior_commit_seq := previous_seq[i]; prior_is_tombstone := previous_tomb[i];
        emitted_count := emitted_count+1; RETURN NEXT;
      END IF;
    END IF;
    IF p_final[i] IS NOT NULL AND p_previous[i] IS DISTINCT FROM p_final[i] THEN
      IF final_seq[i] IS NOT NULL AND (final_tomb[i] = false OR p_access[i] = 'by_creation_time') THEN refusal := 'transitionInvalid'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
      reason := 'transition'; key_ordinal := 1; transition_kind := 'live'; prior_commit_seq := final_seq[i]; prior_is_tombstone := final_tomb[i];
      emitted_count := emitted_count+1; RETURN NEXT;
    END IF;
  END LOOP; END IF;
  IF emitted_count > p_maximum THEN i := greatest(n,1); refusal := 'limitExceeded'; RAISE EXCEPTION 'fx_accept_app_index_transitions' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('reason', refusal, 'ordinal', i-1, 'observed', emitted_count)::text; END IF;
  reason := 'accepted'; pair_ordinal := NULL; key_ordinal := NULL; transition_kind := NULL; prior_commit_seq := NULL; prior_is_tombstone := NULL; RETURN NEXT;
END;
$index_transitions$;
$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_app_index_transitions(text,uuid,integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],bigint[],text[],bigint[],integer) FROM PUBLIC', target_schema);
END $$;

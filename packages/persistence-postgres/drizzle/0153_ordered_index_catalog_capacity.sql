-- Align complete ordered-index catalogs at the approved 1024-definition bound.
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
DO $index_catalog_capacity$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format($ddl$CREATE OR REPLACE FUNCTION %1$I.fx_replace_active_index_maintenance(
  p_scope text, p_expected_sequence bigint, p_expected_head bytea, p_incoming_sequence bigint,
  p_incoming_activation bytea, p_next_head bytea, p_outgoing_deployment text, p_outgoing_schema text,
  p_outgoing_manifest bytea, p_outgoing_members jsonb,
  p_incoming_deployment text, p_incoming_schema text, p_incoming_manifest bytea, p_incoming_members jsonb)
RETURNS TABLE(closed_count integer, opened_count integer) LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $index_maintenance_publisher$
DECLARE live_clock %1$I."fx_system_scope_clock"; live_authority %1$I."fx_system_scope_execution_authority"; outgoing_head %1$I."fx_system_application_active_head";
  prior_activation %1$I."fx_system_application_activation"; incoming_activation %1$I."fx_system_application_activation"; ready_root record;
  build %1$I."fx_system_index_build_state"; opening %1$I."fx_system_index_maintenance_obligation"; member_set record; requirement jsonb;
  outgoing_member jsonb; incoming_member jsonb; prior_id bigint; had_head boolean;
  closed_total integer := 0; opened_total integer := 0;
BEGIN
  
  IF jsonb_typeof(p_outgoing_members) IS DISTINCT FROM 'array' OR jsonb_typeof(p_incoming_members) IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  IF jsonb_array_length(p_outgoing_members) > 1024 OR jsonb_array_length(p_incoming_members) > 1024
    THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  FOR member_set IN SELECT p_outgoing_members AS members UNION ALL SELECT p_incoming_members LOOP
    prior_id := 0;
    FOR requirement IN SELECT value FROM jsonb_array_elements(member_set.members) LOOP
      IF jsonb_typeof(requirement) IS DISTINCT FROM 'object' OR
        jsonb_typeof(requirement->'definitionId') IS DISTINCT FROM 'number' OR
        jsonb_typeof(requirement->'tableId') IS DISTINCT FROM 'number' OR
        jsonb_typeof(requirement->'physicalSpecSha256') IS DISTINCT FROM 'string' OR
        requirement->>'definitionId' !~ '^[1-9][0-9]{0,9}$' OR
        requirement->>'tableId' !~ '^[1-9][0-9]{0,9}$' OR
        requirement->>'physicalSpecSha256' !~ '^[0-9a-f]{64}$' OR
        (requirement->>'definitionId')::bigint > 2147483647 OR (requirement->>'tableId')::bigint > 2147483647 OR
        (requirement->>'definitionId')::bigint <= prior_id OR
        (SELECT count(*) FROM jsonb_object_keys(requirement)) <> 3
        THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      prior_id := (requirement->>'definitionId')::bigint;
    END LOOP;
  END LOOP;
  
  IF p_scope IS NULL OR length(btrim(p_scope)) = 0 OR p_incoming_sequence IS NULL OR p_incoming_sequence <= 0 OR
    (p_expected_sequence IS NOT NULL AND (p_expected_sequence <= 0 OR p_expected_sequence = 9223372036854775807)) OR
    octet_length(p_incoming_activation) IS DISTINCT FROM 32 OR octet_length(p_next_head) IS DISTINCT FROM 32 OR
    (p_expected_sequence IS NOT NULL AND octet_length(p_expected_head) IS DISTINCT FROM 32)
    THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  SELECT * INTO live_authority FROM %1$I."fx_system_scope_execution_authority" WHERE "scope_id" = p_scope FOR UPDATE;
  IF NOT FOUND OR live_authority."storage_generation" <> 'flarexdb_v1' THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  SELECT * INTO live_clock FROM %1$I."fx_system_scope_clock" WHERE "scope_id" = p_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  SELECT * INTO outgoing_head FROM %1$I."fx_system_application_active_head" WHERE "scope_id" = p_scope FOR UPDATE;
  had_head := FOUND;
  IF had_head IS DISTINCT FROM (p_expected_sequence IS NOT NULL) OR
    (had_head AND (outgoing_head."activation_sequence" IS DISTINCT FROM p_expected_sequence OR
      outgoing_head."head_sha256" IS DISTINCT FROM p_expected_head)) OR
    (NOT had_head AND (p_expected_head IS NOT NULL OR p_outgoing_deployment IS NOT NULL OR p_outgoing_schema IS NOT NULL OR jsonb_array_length(p_outgoing_members) <> 0))
    THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  IF had_head THEN
    SELECT * INTO prior_activation FROM %1$I."fx_system_application_activation" WHERE "scope_id" = p_scope
      AND "activation_sequence" = p_expected_sequence FOR SHARE;
    IF NOT FOUND OR prior_activation."revision_id" IS DISTINCT FROM outgoing_head."revision_id" OR
      prior_activation."activation_sha256" IS DISTINCT FROM outgoing_head."activation_sha256" OR
      prior_activation."readiness_contract_version" IS DISTINCT FROM outgoing_head."readiness_contract_version" OR
      prior_activation."readiness_sha256" IS DISTINCT FROM outgoing_head."readiness_sha256" OR
      prior_activation."relation_set_readiness_sha256" IS DISTINCT FROM outgoing_head."relation_set_readiness_sha256" OR
      prior_activation."relation_count" IS DISTINCT FROM outgoing_head."relation_count" OR
      prior_activation."write_policy_set_sha256" IS DISTINCT FROM outgoing_head."write_policy_set_sha256" OR
      prior_activation."write_ownership_sha256" IS DISTINCT FROM outgoing_head."write_ownership_sha256"
      THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
    IF prior_activation."readiness_contract_version" = 1 THEN
      SELECT * INTO ready_root FROM %1$I."fx_system_application_readiness_v1" WHERE "scope_id" = p_scope
        AND "revision_id" = prior_activation."revision_id"
        AND "readiness_sha256" = prior_activation."readiness_sha256" FOR SHARE;
    ELSE
      SELECT * INTO ready_root FROM %1$I."fx_system_application_readiness" WHERE "scope_id" = p_scope
        AND "revision_id" = prior_activation."revision_id"
        AND "readiness_sha256" = prior_activation."readiness_sha256" FOR SHARE;
    END IF;
    IF NOT FOUND OR ready_root."deployment_id" IS DISTINCT FROM p_outgoing_deployment OR
      ready_root."schema_version_id" IS DISTINCT FROM p_outgoing_schema OR ready_root."schema_manifest_sha256" IS DISTINCT FROM p_outgoing_manifest
      THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  END IF;
  SELECT * INTO incoming_activation FROM %1$I."fx_system_application_activation" WHERE "scope_id" = p_scope
    AND "activation_sequence" = p_incoming_sequence FOR SHARE;
  IF NOT FOUND OR p_incoming_sequence IS DISTINCT FROM coalesce(p_expected_sequence, 0) + 1 OR
    incoming_activation."previous_activation_sequence" IS DISTINCT FROM p_expected_sequence OR
    incoming_activation."activation_sha256" IS DISTINCT FROM p_incoming_activation OR
    octet_length(p_next_head) IS DISTINCT FROM 32 THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  IF incoming_activation."readiness_contract_version" = 1 THEN
    SELECT * INTO ready_root FROM %1$I."fx_system_application_readiness_v1" WHERE "scope_id" = p_scope
      AND "revision_id" = incoming_activation."revision_id"
      AND "readiness_sha256" = incoming_activation."readiness_sha256" FOR SHARE;
  ELSE
    SELECT * INTO ready_root FROM %1$I."fx_system_application_readiness" WHERE "scope_id" = p_scope
      AND "revision_id" = incoming_activation."revision_id"
      AND "readiness_sha256" = incoming_activation."readiness_sha256" FOR SHARE;
  END IF;
  IF NOT FOUND OR ready_root."deployment_id" IS DISTINCT FROM p_incoming_deployment OR
    ready_root."schema_version_id" IS DISTINCT FROM p_incoming_schema OR
    ready_root."storage_generation" IS DISTINCT FROM live_authority."storage_generation" OR
    ready_root."storage_generation_fence" IS DISTINCT FROM live_authority."storage_generation_fence" OR
    ready_root."epoch" IS DISTINCT FROM live_authority."epoch" OR ready_root."schema_manifest_sha256" IS DISTINCT FROM p_incoming_manifest
    THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  
  FOR build IN SELECT * FROM %1$I."fx_system_index_build_state" WHERE "scope_id" = p_scope AND "maintenance_authority_kind" = 'application'
    ORDER BY "index_definition_id" FOR UPDATE LOOP 
    IF build."maintenance_authority_kind" = 'binding' THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
    IF build."lifecycle" <> 'enabled' OR build."storage_generation" IS DISTINCT FROM live_authority."storage_generation" OR
      build."storage_generation_fence" IS DISTINCT FROM live_authority."storage_generation_fence" OR
      build."epoch" IS DISTINCT FROM live_authority."epoch" OR
      build."first_readable_commit_seq" IS NULL OR build."covered_through_commit_seq" IS NULL OR
      build."first_readable_commit_seq" > build."covered_through_commit_seq" OR build."covered_through_commit_seq" > live_clock."last_commit_seq"
      THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','unavailable')::text; END IF; 
    IF build."maintenance_authority_kind" = 'application' THEN
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members)
        WHERE (value->>'definitionId')::integer = build."index_definition_id";
      IF NOT FOUND OR NOT had_head THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      SELECT * INTO opening FROM %1$I."fx_system_index_maintenance_obligation" WHERE "scope_id" = p_scope
        AND "index_definition_id" = build."index_definition_id"
        AND "authority_kind" = 'application'
        AND "activation_sequence" = build."maintenance_activation_sequence";
      IF NOT FOUND OR opening."activation_sequence" IS DISTINCT FROM p_expected_sequence OR
        opening."deployment_id" IS DISTINCT FROM p_outgoing_deployment OR opening."schema_version_id" IS DISTINCT FROM p_outgoing_schema OR
        opening."head_sha256" IS DISTINCT FROM p_expected_head OR
        opening."activation_sha256" IS DISTINCT FROM outgoing_head."activation_sha256" OR
        opening."table_id" IS DISTINCT FROM (outgoing_member->>'tableId')::integer OR
        opening."physical_spec_sha256" IS DISTINCT FROM decode(outgoing_member->>'physicalSpecSha256','hex') OR
        opening."storage_generation" IS DISTINCT FROM build."storage_generation" OR
        opening."storage_generation_fence" IS DISTINCT FROM build."storage_generation_fence" OR
        opening."epoch" IS DISTINCT FROM build."epoch" OR
        opening."attempt_fence" IS DISTINCT FROM build."attempt_fence" OR
        opening."opened_commit_seq" IS DISTINCT FROM build."covered_through_commit_seq" OR
        opening."first_readable_commit_seq" IS DISTINCT FROM build."first_readable_commit_seq"
        OR opening."schema_manifest_sha256" IS DISTINCT FROM p_outgoing_manifest
        THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
    END IF; END LOOP;
  FOR incoming_member IN SELECT value FROM jsonb_array_elements(p_incoming_members) LOOP
    SELECT * INTO build FROM %1$I."fx_system_index_build_state" WHERE "scope_id" = p_scope AND "index_definition_id" = (incoming_member->>'definitionId')::integer FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','unavailable')::text; END IF;
    
    IF build."maintenance_authority_kind" = 'binding' THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
    IF build."lifecycle" <> 'enabled' OR build."storage_generation" IS DISTINCT FROM live_authority."storage_generation" OR
      build."storage_generation_fence" IS DISTINCT FROM live_authority."storage_generation_fence" OR
      build."epoch" IS DISTINCT FROM live_authority."epoch" OR
      build."first_readable_commit_seq" IS NULL OR build."covered_through_commit_seq" IS NULL OR
      build."first_readable_commit_seq" > build."covered_through_commit_seq" OR build."covered_through_commit_seq" > live_clock."last_commit_seq"
      THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','unavailable')::text; END IF; 
    IF build."maintenance_authority_kind" = 'application' THEN
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members)
        WHERE (value->>'definitionId')::integer = build."index_definition_id";
      IF NOT FOUND OR NOT had_head THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      SELECT * INTO opening FROM %1$I."fx_system_index_maintenance_obligation" WHERE "scope_id" = p_scope
        AND "index_definition_id" = build."index_definition_id"
        AND "authority_kind" = 'application'
        AND "activation_sequence" = build."maintenance_activation_sequence";
      IF NOT FOUND OR opening."activation_sequence" IS DISTINCT FROM p_expected_sequence OR
        opening."deployment_id" IS DISTINCT FROM p_outgoing_deployment OR opening."schema_version_id" IS DISTINCT FROM p_outgoing_schema OR
        opening."head_sha256" IS DISTINCT FROM p_expected_head OR
        opening."activation_sha256" IS DISTINCT FROM outgoing_head."activation_sha256" OR
        opening."table_id" IS DISTINCT FROM (outgoing_member->>'tableId')::integer OR
        opening."physical_spec_sha256" IS DISTINCT FROM decode(outgoing_member->>'physicalSpecSha256','hex') OR
        opening."storage_generation" IS DISTINCT FROM build."storage_generation" OR
        opening."storage_generation_fence" IS DISTINCT FROM build."storage_generation_fence" OR
        opening."epoch" IS DISTINCT FROM build."epoch" OR
        opening."attempt_fence" IS DISTINCT FROM build."attempt_fence" OR
        opening."opened_commit_seq" IS DISTINCT FROM build."covered_through_commit_seq" OR
        opening."first_readable_commit_seq" IS DISTINCT FROM build."first_readable_commit_seq"
        OR opening."schema_manifest_sha256" IS DISTINCT FROM p_outgoing_manifest
        THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
    END IF; 
    IF incoming_member IS NOT NULL THEN
      IF build."maintenance_authority_kind" = 'application' THEN
        IF opening."table_id" IS DISTINCT FROM (incoming_member->>'tableId')::integer OR
          opening."physical_spec_sha256" IS DISTINCT FROM decode(incoming_member->>'physicalSpecSha256','hex')
          THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      ELSIF build."covered_through_commit_seq" < live_clock."last_commit_seq" AND EXISTS (
        SELECT 1 FROM %1$I."fx_app_row_current" WHERE "scope_uuid" = live_clock."scope_uuid"
          AND "table_id" = (incoming_member->>'tableId')::integer
          AND "commit_seq" > build."covered_through_commit_seq") THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','unavailable')::text; END IF;
    END IF;
  END LOOP;
  FOR build IN SELECT * FROM %1$I."fx_system_index_build_state" WHERE "scope_id" = p_scope AND
    ("maintenance_authority_kind" = 'application' OR "index_definition_id" IN
      (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY "index_definition_id" FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer = build."index_definition_id";
    IF incoming_member IS NOT NULL THEN
      INSERT INTO %1$I."fx_system_index_maintenance_obligation" ("scope_id","index_definition_id","authority_kind","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","first_readable_commit_seq","opened_commit_seq","table_id","physical_spec_sha256","deployment_id","schema_version_id","schema_manifest_sha256","activation_sha256","head_sha256","candidate_sha256") VALUES (
        p_scope, build."index_definition_id", 'application', p_incoming_sequence, build."storage_generation",
        build."storage_generation_fence", build."epoch", build."attempt_fence",
        build."first_readable_commit_seq", live_clock."last_commit_seq", (incoming_member->>'tableId')::integer,
        decode(incoming_member->>'physicalSpecSha256','hex'), p_incoming_deployment, p_incoming_schema,
        p_incoming_manifest, p_incoming_activation, p_next_head, NULL);
      UPDATE %1$I."fx_system_index_build_state" SET "covered_through_commit_seq" = live_clock."last_commit_seq",
        "maintenance_authority_kind" = 'application', "maintenance_activation_sequence" = p_incoming_sequence, "updated_at" = clock_timestamp()
        WHERE "scope_id" = p_scope AND "index_definition_id" = build."index_definition_id";
      opened_total := opened_total + 1;
    ELSE
      UPDATE %1$I."fx_system_index_build_state" SET "covered_through_commit_seq" = live_clock."last_commit_seq",
        "maintenance_authority_kind" = NULL, "maintenance_activation_sequence" = NULL, "updated_at" = clock_timestamp()
        WHERE "scope_id" = p_scope AND "index_definition_id" = build."index_definition_id";
      closed_total := closed_total + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT closed_total, opened_total;
END
$index_maintenance_publisher$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_replace_active_index_maintenance(text,bigint,bytea,bigint,bytea,bytea,text,text,bytea,jsonb,text,text,bytea,jsonb) FROM PUBLIC',target_schema);
  EXECUTE format($ddl$CREATE OR REPLACE FUNCTION %1$I.fx_replace_binding_index_maintenance(
  p_scope text,p_expected_sequence bigint,p_expected_head text,p_incoming_sequence bigint,p_incoming_activation text,
  p_next_head text,p_candidate text,p_outgoing_deployment text,p_outgoing_schema text,p_outgoing_manifest text,p_outgoing_members jsonb,
  p_incoming_deployment text,p_incoming_schema text,p_incoming_manifest text,p_incoming_members jsonb)
RETURNS TABLE(closed_count integer,opened_count integer) LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $binding_index_maintenance$
DECLARE live_clock %1$I."fx_system_scope_clock"; live_authority %1$I."fx_system_scope_execution_authority";
  old_head %1$I."fx_system_data_binding_head"; incoming %1$I."fx_system_data_binding_activation";
  candidate %1$I."fx_system_data_binding_candidate"; old_candidate %1$I."fx_system_data_binding_candidate";
  build %1$I."fx_system_index_build_state"; opening %1$I."fx_system_index_maintenance_obligation"; member_set record; requirement jsonb;
  incoming_member jsonb; outgoing_member jsonb; frame jsonb; old_frame jsonb; activation_frame jsonb;
  prior_id bigint; had_head boolean; maintenance_owned boolean; closed_total integer:=0; opened_total integer:=0;
BEGIN
  IF p_scope IS NULL OR length(btrim(p_scope))=0 OR p_incoming_sequence IS NULL OR p_incoming_sequence<=0 OR
    p_incoming_activation IS NULL OR p_incoming_activation !~ '^[0-9a-f]{64}$' OR
    p_next_head IS NULL OR p_next_head !~ '^[0-9a-f]{64}$' OR p_candidate IS NULL OR p_candidate !~ '^[0-9a-f]{64}$' OR
    (p_expected_sequence IS NOT NULL AND (p_expected_sequence<=0 OR p_expected_head IS NULL OR p_expected_head !~ '^[0-9a-f]{64}$'))
    THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  IF jsonb_typeof(p_outgoing_members) IS DISTINCT FROM 'array' OR jsonb_typeof(p_incoming_members) IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_outgoing_members)>1024 OR jsonb_array_length(p_incoming_members)>1024
    THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  FOR member_set IN SELECT p_outgoing_members AS members UNION ALL SELECT p_incoming_members LOOP
    prior_id:=0;
    FOR requirement IN SELECT value FROM jsonb_array_elements(member_set.members) LOOP
      IF jsonb_typeof(requirement) IS DISTINCT FROM 'object' OR
        jsonb_typeof(requirement->'definitionId') IS DISTINCT FROM 'number' OR jsonb_typeof(requirement->'tableId') IS DISTINCT FROM 'number' OR
        jsonb_typeof(requirement->'physicalSpecSha256') IS DISTINCT FROM 'string' OR
        requirement->>'definitionId' !~ '^[1-9][0-9]{0,9}$' OR requirement->>'tableId' !~ '^[1-9][0-9]{0,9}$' OR
        requirement->>'physicalSpecSha256' !~ '^[0-9a-f]{64}$' OR
        (requirement->>'definitionId')::bigint>2147483647 OR (requirement->>'tableId')::bigint>2147483647 OR
        (requirement->>'definitionId')::bigint<=prior_id OR (SELECT count(*) FROM jsonb_object_keys(requirement))<>3
        THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      prior_id:=(requirement->>'definitionId')::bigint;
    END LOOP;
  END LOOP;
  SELECT * INTO live_clock FROM %1$I."fx_system_scope_clock" WHERE scope_id=p_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  SELECT * INTO live_authority FROM %1$I."fx_system_scope_execution_authority" WHERE scope_id=p_scope FOR UPDATE;
  IF NOT FOUND OR live_authority.storage_generation IS DISTINCT FROM 'flarexdb_v1' OR
    live_authority.scope_id IS DISTINCT FROM live_clock.scope_id OR live_authority.epoch_uuid IS NULL
    THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  SELECT * INTO old_head FROM %1$I."fx_system_data_binding_head" WHERE scope_id=p_scope AND storage_generation=live_authority.storage_generation FOR UPDATE;
  had_head:=FOUND;
  IF had_head IS DISTINCT FROM (p_expected_sequence IS NOT NULL) OR
    (had_head AND (old_head.sequence IS DISTINCT FROM p_expected_sequence OR old_head.sha256 IS DISTINCT FROM p_expected_head)) OR
    (NOT had_head AND (p_expected_head IS NOT NULL OR p_outgoing_deployment IS NOT NULL OR p_outgoing_schema IS NOT NULL OR
      p_outgoing_manifest IS NOT NULL OR jsonb_array_length(p_outgoing_members)<>0)) THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  maintenance_owned:=EXISTS(SELECT 1 FROM %1$I.fx_system_installation WHERE singleton_id=1 AND state='draining'
    AND maintenance_pid=pg_backend_pid() AND maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid()));
  IF p_incoming_sequence IS DISTINCT FROM coalesce(p_expected_sequence,0)+1 AND
    NOT (maintenance_owned AND had_head AND p_incoming_sequence=p_expected_sequence AND p_next_head=p_expected_head)
    THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  SELECT * INTO incoming FROM %1$I."fx_system_data_binding_activation" WHERE scope_id=p_scope
    AND storage_generation=live_authority.storage_generation AND sequence=p_incoming_sequence FOR SHARE;
  IF NOT FOUND OR incoming.sha256 IS DISTINCT FROM p_incoming_activation OR incoming.candidate_sha256 IS DISTINCT FROM p_candidate
    THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  activation_frame:=convert_from(incoming.canonical_bytes,'UTF8')::jsonb;
  IF activation_frame->>'format' IS DISTINCT FROM 'flarex.data-binding-activation' OR
    activation_frame->>'sequence' IS DISTINCT FROM p_incoming_sequence::text OR
    activation_frame->'request'->>'scopeId' IS DISTINCT FROM p_scope OR
    activation_frame->'request'->>'storageGeneration' IS DISTINCT FROM live_authority.storage_generation OR
    activation_frame->'request'->>'candidateSha256' IS DISTINCT FROM p_candidate OR
    (NOT maintenance_owned AND (CASE WHEN had_head THEN
      activation_frame->'request'->'expectedHead'->>'sequence' IS DISTINCT FROM p_expected_sequence::text OR
      activation_frame->'request'->'expectedHead'->>'sha256' IS DISTINCT FROM p_expected_head
      ELSE activation_frame->'request'->'expectedHead' IS DISTINCT FROM 'null'::jsonb END)) THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  SELECT * INTO candidate FROM %1$I."fx_system_data_binding_candidate" WHERE scope_id=p_scope
    AND storage_generation=live_authority.storage_generation AND sha256=p_candidate FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  frame:=convert_from(candidate.canonical_bytes,'UTF8')::jsonb;
  IF frame->>'format' IS DISTINCT FROM 'flarex.data-binding-set' OR frame->'application'->>'deploymentId' IS DISTINCT FROM p_incoming_deployment OR
    frame->'application'->>'scopeId' IS DISTINCT FROM p_scope OR frame->'application'->>'storageGeneration' IS DISTINCT FROM live_authority.storage_generation OR
    (CASE WHEN frame->'logicalSchema'='null'::jsonb THEN p_incoming_schema IS NOT NULL OR p_incoming_manifest IS NOT NULL OR jsonb_array_length(p_incoming_members)<>0
      ELSE frame->'logicalSchema'->>'schemaVersionId' IS DISTINCT FROM p_incoming_schema OR
        frame->'logicalSchema'->>'manifestSha256' IS DISTINCT FROM p_incoming_manifest OR p_incoming_manifest !~ '^[0-9a-f]{64}$' END)
    THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  IF had_head THEN
    SELECT * INTO old_candidate FROM %1$I."fx_system_data_binding_candidate" WHERE scope_id=p_scope
      AND storage_generation=live_authority.storage_generation AND sha256=old_head.candidate_sha256 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
    old_frame:=convert_from(old_candidate.canonical_bytes,'UTF8')::jsonb;
    IF old_frame->'application'->>'deploymentId' IS DISTINCT FROM p_outgoing_deployment OR
      (CASE WHEN old_frame->'logicalSchema'='null'::jsonb THEN p_outgoing_schema IS NOT NULL OR p_outgoing_manifest IS NOT NULL OR jsonb_array_length(p_outgoing_members)<>0
        ELSE old_frame->'logicalSchema'->>'schemaVersionId' IS DISTINCT FROM p_outgoing_schema OR
          old_frame->'logicalSchema'->>'manifestSha256' IS DISTINCT FROM p_outgoing_manifest END) THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
  END IF;
  IF (SELECT count(*) FROM %1$I."fx_system_index_build_state" WHERE scope_id=p_scope AND "index_definition_id" IN
    (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))<>jsonb_array_length(p_incoming_members)
    THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','unavailable')::text; END IF;
  FOR build IN SELECT * FROM %1$I."fx_system_index_build_state" WHERE scope_id=p_scope AND
    (maintenance_authority_kind='binding' OR "index_definition_id" IN (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY "index_definition_id" FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer=build."index_definition_id";
    IF build.lifecycle IS DISTINCT FROM 'enabled' OR build.storage_generation IS DISTINCT FROM live_authority.storage_generation OR
      build.storage_generation_fence IS DISTINCT FROM live_authority.storage_generation_fence OR build.epoch IS DISTINCT FROM live_authority.epoch OR
      build."first_readable_commit_seq" IS NULL OR build.covered_through_commit_seq IS NULL OR build."first_readable_commit_seq">build.covered_through_commit_seq OR
      build.covered_through_commit_seq>live_clock.last_commit_seq THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','unavailable')::text; END IF;
    IF build.maintenance_authority_kind IS NOT NULL THEN
      SELECT * INTO opening FROM %1$I."fx_system_index_maintenance_obligation" WHERE scope_id=p_scope AND authority_kind=build.maintenance_authority_kind
        AND "index_definition_id"=build."index_definition_id" AND activation_sequence=build.maintenance_activation_sequence;
      IF NOT FOUND OR opening.storage_generation IS DISTINCT FROM build.storage_generation OR
        opening.storage_generation_fence IS DISTINCT FROM build.storage_generation_fence OR opening.epoch IS DISTINCT FROM build.epoch OR
        opening.attempt_fence IS DISTINCT FROM build.attempt_fence OR opening.opened_commit_seq IS DISTINCT FROM build.covered_through_commit_seq OR
        opening."first_readable_commit_seq" IS DISTINCT FROM build."first_readable_commit_seq" THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      IF incoming_member IS NOT NULL AND (opening.table_id IS DISTINCT FROM (incoming_member->>'tableId')::integer OR
        opening.physical_spec_sha256 IS DISTINCT FROM decode(incoming_member->>'physicalSpecSha256','hex')) THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      IF build.maintenance_authority_kind='application' THEN CONTINUE; END IF;
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members) WHERE (value->>'definitionId')::integer=build."index_definition_id";
      IF NOT had_head OR outgoing_member IS NULL OR opening.activation_sequence IS DISTINCT FROM p_expected_sequence OR
        opening.head_sha256 IS DISTINCT FROM decode(p_expected_head,'hex') OR opening.activation_sha256 IS DISTINCT FROM decode(old_head.activation_sha256,'hex') OR
        opening.candidate_sha256 IS DISTINCT FROM decode(old_head.candidate_sha256,'hex') OR
        opening.deployment_id IS DISTINCT FROM p_outgoing_deployment OR opening.schema_version_id IS DISTINCT FROM p_outgoing_schema OR
        opening.schema_manifest_sha256 IS DISTINCT FROM decode(p_outgoing_manifest,'hex') OR
        opening.table_id IS DISTINCT FROM (outgoing_member->>'tableId')::integer OR
        opening.physical_spec_sha256 IS DISTINCT FROM decode(outgoing_member->>'physicalSpecSha256','hex') THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      IF maintenance_owned AND p_incoming_sequence=p_expected_sequence THEN CONTINUE; END IF;
    ELSIF incoming_member IS NOT NULL AND build.covered_through_commit_seq<live_clock.last_commit_seq AND EXISTS (
      SELECT 1 FROM %1$I."fx_app_row_current" WHERE scope_uuid=live_clock.scope_uuid AND table_id=(incoming_member->>'tableId')::integer
        AND commit_seq>build.covered_through_commit_seq) THEN RAISE EXCEPTION 'fx_replace_binding_index_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','index','reason','unavailable')::text; END IF;
    IF incoming_member IS NOT NULL THEN
      INSERT INTO %1$I."fx_system_index_maintenance_obligation" ("scope_id","authority_kind","index_definition_id","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","first_readable_commit_seq","opened_commit_seq","table_id","physical_spec_sha256","deployment_id","schema_version_id","schema_manifest_sha256","activation_sha256","head_sha256","candidate_sha256") VALUES
        (p_scope,'binding',build."index_definition_id",p_incoming_sequence,build.storage_generation,build.storage_generation_fence,build.epoch,
          build.attempt_fence,build."first_readable_commit_seq",live_clock.last_commit_seq,(incoming_member->>'tableId')::integer,
          decode(incoming_member->>'physicalSpecSha256','hex'),p_incoming_deployment,p_incoming_schema,decode(p_incoming_manifest,'hex'),
          decode(p_incoming_activation,'hex'),decode(p_next_head,'hex'),decode(p_candidate,'hex'));
      UPDATE %1$I."fx_system_index_build_state" SET covered_through_commit_seq=live_clock.last_commit_seq,maintenance_authority_kind='binding',
        maintenance_activation_sequence=p_incoming_sequence,updated_at=clock_timestamp() WHERE scope_id=p_scope AND "index_definition_id"=build."index_definition_id";
      opened_total:=opened_total+1;
    ELSE
      UPDATE %1$I."fx_system_index_build_state" SET covered_through_commit_seq=live_clock.last_commit_seq,maintenance_authority_kind=NULL,
        maintenance_activation_sequence=NULL,updated_at=clock_timestamp() WHERE scope_id=p_scope AND "index_definition_id"=build."index_definition_id";
      closed_total:=closed_total+1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT closed_total,opened_total;
END
$binding_index_maintenance$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_replace_binding_index_maintenance(text,bigint,text,bigint,text,text,text,text,text,text,jsonb,text,text,text,jsonb) FROM PUBLIC',target_schema);
END;
$index_catalog_capacity$;

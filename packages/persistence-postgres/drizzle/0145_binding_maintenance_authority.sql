-- Binding-owned maintained suffixes and discriminated immutable opening authority.
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
DO $maintenance_authority$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_build_state" DROP CONSTRAINT IF EXISTS "fx_index_build_maintenance_opening_fk", DROP CONSTRAINT IF EXISTS "fx_system_index_build_maintenance_check"',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_build_state" ADD COLUMN IF NOT EXISTS maintenance_authority_kind text',target_schema);
  IF EXISTS (SELECT 1 FROM "fx_system_index_build_state" WHERE maintenance_activation_sequence IS NOT NULL AND maintenance_authority_kind IS NULL) THEN
    EXECUTE format('UPDATE %1$I."fx_system_index_build_state" SET maintenance_authority_kind = ''application'' WHERE maintenance_activation_sequence IS NOT NULL AND maintenance_authority_kind IS NULL',target_schema);
  END IF;
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_maintenance_obligation" ADD COLUMN IF NOT EXISTS authority_kind text NOT NULL DEFAULT ''application'', ADD COLUMN IF NOT EXISTS candidate_sha256 bytea',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_maintenance_obligation" ALTER COLUMN authority_kind DROP DEFAULT',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_maintenance_obligation" DROP CONSTRAINT IF EXISTS "fx_index_maintenance_obligation_pk"',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_maintenance_obligation" DROP CONSTRAINT IF EXISTS "fx_index_maintenance_opening_unique"',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_maintenance_obligation" ADD CONSTRAINT "fx_index_maintenance_obligation_pk" PRIMARY KEY ("scope_id","index_definition_id","authority_kind","activation_sequence")',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_maintenance_obligation" ADD CONSTRAINT "fx_index_maintenance_opening_unique" UNIQUE ("scope_id","index_definition_id","authority_kind","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","opened_commit_seq","first_readable_commit_seq")',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_maintenance_obligation" DROP CONSTRAINT IF EXISTS "fx_index_maintenance_owner_check"',target_schema);
  EXECUTE format($ddl$ALTER TABLE %1$I."fx_system_index_maintenance_obligation" ADD CONSTRAINT "fx_index_maintenance_owner_check" CHECK (("authority_kind" = 'application' and "candidate_sha256" is null) or ("authority_kind" = 'binding' and "candidate_sha256" is not null and octet_length("candidate_sha256") = 32))$ddl$,target_schema);
  EXECUTE format($ddl$ALTER TABLE %1$I."fx_system_index_build_state" ADD CONSTRAINT "fx_system_index_build_maintenance_check" CHECK (
      ("maintenance_activation_sequence" is null and "maintenance_authority_kind" is null)
      or ("maintenance_activation_sequence" is not null and "maintenance_authority_kind" is not null and ("maintenance_authority_kind" = 'application' or "maintenance_authority_kind" = 'binding') and "maintenance_activation_sequence" > 0
        and "lifecycle" = 'enabled' and "first_readable_commit_seq" is not null and "covered_through_commit_seq" is not null))$ddl$,target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_build_state" ADD CONSTRAINT "fx_index_build_maintenance_opening_fk" FOREIGN KEY ("scope_id","index_definition_id","maintenance_authority_kind","maintenance_activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","covered_through_commit_seq","first_readable_commit_seq") REFERENCES %1$I."fx_system_index_maintenance_obligation" ("scope_id","index_definition_id","authority_kind","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","opened_commit_seq","first_readable_commit_seq") ON UPDATE RESTRICT ON DELETE RESTRICT',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_constraint_build" DROP CONSTRAINT IF EXISTS "fx_unique_build_maintenance_opening_fk", DROP CONSTRAINT IF EXISTS "fx_system_unique_build_maintenance_check"',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_constraint_build" ADD COLUMN IF NOT EXISTS maintenance_authority_kind text',target_schema);
  IF EXISTS (SELECT 1 FROM "fx_system_unique_constraint_build" WHERE maintenance_activation_sequence IS NOT NULL AND maintenance_authority_kind IS NULL) THEN
    EXECUTE format('UPDATE %1$I."fx_system_unique_constraint_build" SET maintenance_authority_kind = ''application'' WHERE maintenance_activation_sequence IS NOT NULL AND maintenance_authority_kind IS NULL',target_schema);
  END IF;
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_maintenance_obligation" ADD COLUMN IF NOT EXISTS authority_kind text NOT NULL DEFAULT ''application'', ADD COLUMN IF NOT EXISTS candidate_sha256 bytea, ADD COLUMN IF NOT EXISTS schema_manifest_sha256 bytea',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_maintenance_obligation" ALTER COLUMN authority_kind DROP DEFAULT',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_maintenance_obligation" DROP CONSTRAINT IF EXISTS "fx_unique_maintenance_obligation_pk"',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_maintenance_obligation" DROP CONSTRAINT IF EXISTS "fx_unique_maintenance_opening_unique"',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_maintenance_obligation" ADD CONSTRAINT "fx_unique_maintenance_obligation_pk" PRIMARY KEY ("scope_id","unique_constraint_definition_id","authority_kind","activation_sequence")',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_maintenance_obligation" ADD CONSTRAINT "fx_unique_maintenance_opening_unique" UNIQUE ("scope_id","unique_constraint_definition_id","authority_kind","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","opened_commit_seq","start_commit_seq")',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_maintenance_obligation" DROP CONSTRAINT IF EXISTS "fx_unique_maintenance_owner_check"',target_schema);
  EXECUTE format($ddl$ALTER TABLE %1$I."fx_system_unique_maintenance_obligation" ADD CONSTRAINT "fx_unique_maintenance_owner_check" CHECK (("authority_kind" = 'application' and "candidate_sha256" is null and "schema_manifest_sha256" is null) or ("authority_kind" = 'binding' and "candidate_sha256" is not null and octet_length("candidate_sha256") = 32 and "schema_manifest_sha256" is not null and octet_length("schema_manifest_sha256") = 32))$ddl$,target_schema);
  EXECUTE format($ddl$ALTER TABLE %1$I."fx_system_unique_constraint_build" ADD CONSTRAINT "fx_system_unique_build_maintenance_check" CHECK (
      ("maintenance_activation_sequence" is null and "maintenance_authority_kind" is null)
      or ("maintenance_activation_sequence" is not null and "maintenance_authority_kind" is not null and ("maintenance_authority_kind" = 'application' or "maintenance_authority_kind" = 'binding') and "maintenance_activation_sequence" > 0
        and "lifecycle" = 'enabled' and "covered_through_commit_seq" is not null))$ddl$,target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_constraint_build" ADD CONSTRAINT "fx_unique_build_maintenance_opening_fk" FOREIGN KEY ("scope_id","unique_constraint_definition_id","maintenance_authority_kind","maintenance_activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","covered_through_commit_seq","start_commit_seq") REFERENCES %1$I."fx_system_unique_maintenance_obligation" ("scope_id","unique_constraint_definition_id","authority_kind","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","opened_commit_seq","start_commit_seq") ON UPDATE RESTRICT ON DELETE RESTRICT',target_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS "fx_index_maintenance_authority_idx" ON %1$I."fx_system_index_maintenance_obligation" ("scope_id","authority_kind","activation_sequence")',target_schema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS "fx_unique_maintenance_authority_idx" ON %1$I."fx_system_unique_maintenance_obligation" ("scope_id","authority_kind","activation_sequence")',target_schema);
  EXECUTE format('DROP FUNCTION IF EXISTS %1$I.fx_replace_active_index_maintenance(text,bigint,bytea,bigint,bytea,bytea,text,text,bytea,jsonb,text,text,bytea,jsonb)',target_schema);
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_replace_active_index_maintenance(
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
  IF jsonb_array_length(p_outgoing_members) > 512 OR jsonb_array_length(p_incoming_members) > 512
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
  EXECUTE format('DROP FUNCTION IF EXISTS %1$I.fx_replace_active_unique_maintenance(text,bigint,bytea,bigint,bytea,bytea,text,text,jsonb,text,text,jsonb)',target_schema);
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_replace_active_unique_maintenance(
  p_scope text, p_expected_sequence bigint, p_expected_head bytea, p_incoming_sequence bigint,
  p_incoming_activation bytea, p_next_head bytea, p_outgoing_deployment text, p_outgoing_schema text,
   p_outgoing_members jsonb,
  p_incoming_deployment text, p_incoming_schema text,  p_incoming_members jsonb)
RETURNS TABLE(closed_count integer, opened_count integer) LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $unique_maintenance_publisher$
DECLARE live_clock %1$I."fx_system_scope_clock"; live_authority %1$I."fx_system_scope_execution_authority"; outgoing_head %1$I."fx_system_application_active_head";
  prior_activation %1$I."fx_system_application_activation"; incoming_activation %1$I."fx_system_application_activation"; ready_root record;
  build %1$I."fx_system_unique_constraint_build"; opening %1$I."fx_system_unique_maintenance_obligation"; member_set record; requirement jsonb;
  outgoing_member jsonb; incoming_member jsonb; prior_id bigint; had_head boolean;
  closed_total integer := 0; opened_total integer := 0;
BEGIN
  
  IF jsonb_typeof(p_outgoing_members) IS DISTINCT FROM 'array' OR jsonb_typeof(p_incoming_members) IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  IF jsonb_array_length(p_outgoing_members) > 256 OR jsonb_array_length(p_incoming_members) > 256
    THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
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
        THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
      prior_id := (requirement->>'definitionId')::bigint;
    END LOOP;
  END LOOP;
  
  IF p_scope IS NULL OR length(btrim(p_scope)) = 0 OR p_incoming_sequence IS NULL OR p_incoming_sequence <= 0 OR
    (p_expected_sequence IS NOT NULL AND (p_expected_sequence <= 0 OR p_expected_sequence = 9223372036854775807)) OR
    octet_length(p_incoming_activation) IS DISTINCT FROM 32 OR octet_length(p_next_head) IS DISTINCT FROM 32 OR
    (p_expected_sequence IS NOT NULL AND octet_length(p_expected_head) IS DISTINCT FROM 32)
    THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  SELECT * INTO live_authority FROM %1$I."fx_system_scope_execution_authority" WHERE "scope_id" = p_scope FOR UPDATE;
  IF NOT FOUND OR live_authority."storage_generation" <> 'flarexdb_v1' THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  SELECT * INTO live_clock FROM %1$I."fx_system_scope_clock" WHERE "scope_id" = p_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  SELECT * INTO outgoing_head FROM %1$I."fx_system_application_active_head" WHERE "scope_id" = p_scope FOR UPDATE;
  had_head := FOUND;
  IF had_head IS DISTINCT FROM (p_expected_sequence IS NOT NULL) OR
    (had_head AND (outgoing_head."activation_sequence" IS DISTINCT FROM p_expected_sequence OR
      outgoing_head."head_sha256" IS DISTINCT FROM p_expected_head)) OR
    (NOT had_head AND (p_expected_head IS NOT NULL OR p_outgoing_deployment IS NOT NULL OR p_outgoing_schema IS NOT NULL OR jsonb_array_length(p_outgoing_members) <> 0))
    THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
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
      THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
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
      ready_root."schema_version_id" IS DISTINCT FROM p_outgoing_schema 
      THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  END IF;
  SELECT * INTO incoming_activation FROM %1$I."fx_system_application_activation" WHERE "scope_id" = p_scope
    AND "activation_sequence" = p_incoming_sequence FOR SHARE;
  IF NOT FOUND OR p_incoming_sequence IS DISTINCT FROM coalesce(p_expected_sequence, 0) + 1 OR
    incoming_activation."previous_activation_sequence" IS DISTINCT FROM p_expected_sequence OR
    incoming_activation."activation_sha256" IS DISTINCT FROM p_incoming_activation OR
    octet_length(p_next_head) IS DISTINCT FROM 32 THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
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
    ready_root."epoch" IS DISTINCT FROM live_authority."epoch" 
    THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  
  IF (SELECT count(*) FROM %1$I."fx_system_unique_constraint_build" WHERE "scope_id" = p_scope AND "unique_constraint_definition_id" IN
    (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members))) <> jsonb_array_length(p_incoming_members)
    THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','unavailable')::text; END IF;
  FOR build IN SELECT * FROM %1$I."fx_system_unique_constraint_build" WHERE "scope_id" = p_scope AND
    ("maintenance_authority_kind" = 'application' OR "unique_constraint_definition_id" IN
      (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY "unique_constraint_definition_id" FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer = build."unique_constraint_definition_id";
    
    IF build."maintenance_authority_kind" = 'binding' THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
    IF build."lifecycle" <> 'enabled' OR build."storage_generation" IS DISTINCT FROM live_authority."storage_generation" OR
      build."storage_generation_fence" IS DISTINCT FROM live_authority."storage_generation_fence" OR
      build."epoch" IS DISTINCT FROM live_authority."epoch" OR
      build."start_commit_seq" IS NULL OR build."covered_through_commit_seq" IS NULL OR
      build."start_commit_seq" > build."covered_through_commit_seq" OR build."covered_through_commit_seq" > live_clock."last_commit_seq"
      THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','unavailable')::text; END IF; 
    IF build."maintenance_authority_kind" = 'application' THEN
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members)
        WHERE (value->>'definitionId')::integer = build."unique_constraint_definition_id";
      IF NOT FOUND OR NOT had_head THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
      SELECT * INTO opening FROM %1$I."fx_system_unique_maintenance_obligation" WHERE "scope_id" = p_scope
        AND "unique_constraint_definition_id" = build."unique_constraint_definition_id"
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
        opening."start_commit_seq" IS DISTINCT FROM build."start_commit_seq"
        
        THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
    END IF; 
    IF incoming_member IS NOT NULL THEN
      IF build."maintenance_authority_kind" = 'application' THEN
        IF opening."table_id" IS DISTINCT FROM (incoming_member->>'tableId')::integer OR
          opening."physical_spec_sha256" IS DISTINCT FROM decode(incoming_member->>'physicalSpecSha256','hex')
          THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
      ELSIF build."covered_through_commit_seq" < live_clock."last_commit_seq" AND EXISTS (
        SELECT 1 FROM %1$I."fx_app_row_current" WHERE "scope_uuid" = live_clock."scope_uuid"
          AND "table_id" = (incoming_member->>'tableId')::integer
          AND "commit_seq" > build."covered_through_commit_seq") THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','unavailable')::text; END IF;
    END IF;
  END LOOP;
  FOR build IN SELECT * FROM %1$I."fx_system_unique_constraint_build" WHERE "scope_id" = p_scope AND
    ("maintenance_authority_kind" = 'application' OR "unique_constraint_definition_id" IN
      (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY "unique_constraint_definition_id" FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer = build."unique_constraint_definition_id";
    IF incoming_member IS NOT NULL THEN
      INSERT INTO %1$I."fx_system_unique_maintenance_obligation" ("scope_id","unique_constraint_definition_id","authority_kind","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","start_commit_seq","opened_commit_seq","table_id","physical_spec_sha256","deployment_id","schema_version_id","schema_manifest_sha256","activation_sha256","head_sha256","candidate_sha256") VALUES (
        p_scope, build."unique_constraint_definition_id", 'application', p_incoming_sequence, build."storage_generation",
        build."storage_generation_fence", build."epoch", build."attempt_fence",
        build."start_commit_seq", live_clock."last_commit_seq", (incoming_member->>'tableId')::integer,
        decode(incoming_member->>'physicalSpecSha256','hex'), p_incoming_deployment, p_incoming_schema,
        NULL, p_incoming_activation, p_next_head, NULL);
      UPDATE %1$I."fx_system_unique_constraint_build" SET "covered_through_commit_seq" = live_clock."last_commit_seq",
        "maintenance_authority_kind" = 'application', "maintenance_activation_sequence" = p_incoming_sequence, "updated_at" = clock_timestamp()
        WHERE "scope_id" = p_scope AND "unique_constraint_definition_id" = build."unique_constraint_definition_id";
      opened_total := opened_total + 1;
    ELSE
      UPDATE %1$I."fx_system_unique_constraint_build" SET "covered_through_commit_seq" = live_clock."last_commit_seq",
        "maintenance_authority_kind" = NULL, "maintenance_activation_sequence" = NULL, "updated_at" = clock_timestamp()
        WHERE "scope_id" = p_scope AND "unique_constraint_definition_id" = build."unique_constraint_definition_id";
      closed_total := closed_total + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT closed_total, opened_total;
END
$unique_maintenance_publisher$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_replace_active_unique_maintenance(text,bigint,bytea,bigint,bytea,bytea,text,text,jsonb,text,text,jsonb) FROM PUBLIC',target_schema);
  EXECUTE format('DROP FUNCTION IF EXISTS %1$I.fx_replace_binding_index_maintenance(text,bigint,text,bigint,text,text,text,text,text,text,jsonb,text,text,text,jsonb)',target_schema);
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_replace_binding_index_maintenance(
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
    jsonb_array_length(p_outgoing_members)>512 OR jsonb_array_length(p_incoming_members)>512
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
  EXECUTE format('DROP FUNCTION IF EXISTS %1$I.fx_replace_binding_unique_maintenance(text,bigint,text,bigint,text,text,text,text,text,text,jsonb,text,text,text,jsonb)',target_schema);
  EXECUTE format($ddl$CREATE FUNCTION %1$I.fx_replace_binding_unique_maintenance(
  p_scope text,p_expected_sequence bigint,p_expected_head text,p_incoming_sequence bigint,p_incoming_activation text,
  p_next_head text,p_candidate text,p_outgoing_deployment text,p_outgoing_schema text,p_outgoing_manifest text,p_outgoing_members jsonb,
  p_incoming_deployment text,p_incoming_schema text,p_incoming_manifest text,p_incoming_members jsonb)
RETURNS TABLE(closed_count integer,opened_count integer) LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $binding_unique_maintenance$
DECLARE live_clock %1$I."fx_system_scope_clock"; live_authority %1$I."fx_system_scope_execution_authority";
  old_head %1$I."fx_system_data_binding_head"; incoming %1$I."fx_system_data_binding_activation";
  candidate %1$I."fx_system_data_binding_candidate"; old_candidate %1$I."fx_system_data_binding_candidate";
  build %1$I."fx_system_unique_constraint_build"; opening %1$I."fx_system_unique_maintenance_obligation"; member_set record; requirement jsonb;
  incoming_member jsonb; outgoing_member jsonb; frame jsonb; old_frame jsonb; activation_frame jsonb;
  prior_id bigint; had_head boolean; maintenance_owned boolean; closed_total integer:=0; opened_total integer:=0;
BEGIN
  IF p_scope IS NULL OR length(btrim(p_scope))=0 OR p_incoming_sequence IS NULL OR p_incoming_sequence<=0 OR
    p_incoming_activation IS NULL OR p_incoming_activation !~ '^[0-9a-f]{64}$' OR
    p_next_head IS NULL OR p_next_head !~ '^[0-9a-f]{64}$' OR p_candidate IS NULL OR p_candidate !~ '^[0-9a-f]{64}$' OR
    (p_expected_sequence IS NOT NULL AND (p_expected_sequence<=0 OR p_expected_head IS NULL OR p_expected_head !~ '^[0-9a-f]{64}$'))
    THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  IF jsonb_typeof(p_outgoing_members) IS DISTINCT FROM 'array' OR jsonb_typeof(p_incoming_members) IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_outgoing_members)>256 OR jsonb_array_length(p_incoming_members)>256
    THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
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
        THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
      prior_id:=(requirement->>'definitionId')::bigint;
    END LOOP;
  END LOOP;
  SELECT * INTO live_clock FROM %1$I."fx_system_scope_clock" WHERE scope_id=p_scope FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  SELECT * INTO live_authority FROM %1$I."fx_system_scope_execution_authority" WHERE scope_id=p_scope FOR UPDATE;
  IF NOT FOUND OR live_authority.storage_generation IS DISTINCT FROM 'flarexdb_v1' OR
    live_authority.scope_id IS DISTINCT FROM live_clock.scope_id OR live_authority.epoch_uuid IS NULL
    THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  SELECT * INTO old_head FROM %1$I."fx_system_data_binding_head" WHERE scope_id=p_scope AND storage_generation=live_authority.storage_generation FOR UPDATE;
  had_head:=FOUND;
  IF had_head IS DISTINCT FROM (p_expected_sequence IS NOT NULL) OR
    (had_head AND (old_head.sequence IS DISTINCT FROM p_expected_sequence OR old_head.sha256 IS DISTINCT FROM p_expected_head)) OR
    (NOT had_head AND (p_expected_head IS NOT NULL OR p_outgoing_deployment IS NOT NULL OR p_outgoing_schema IS NOT NULL OR
      p_outgoing_manifest IS NOT NULL OR jsonb_array_length(p_outgoing_members)<>0)) THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  maintenance_owned:=EXISTS(SELECT 1 FROM %1$I.fx_system_installation WHERE singleton_id=1 AND state='draining'
    AND maintenance_pid=pg_backend_pid() AND maintenance_backend_start=(SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid()));
  IF p_incoming_sequence IS DISTINCT FROM coalesce(p_expected_sequence,0)+1 AND
    NOT (maintenance_owned AND had_head AND p_incoming_sequence=p_expected_sequence AND p_next_head=p_expected_head)
    THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  SELECT * INTO incoming FROM %1$I."fx_system_data_binding_activation" WHERE scope_id=p_scope
    AND storage_generation=live_authority.storage_generation AND sequence=p_incoming_sequence FOR SHARE;
  IF NOT FOUND OR incoming.sha256 IS DISTINCT FROM p_incoming_activation OR incoming.candidate_sha256 IS DISTINCT FROM p_candidate
    THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  activation_frame:=convert_from(incoming.canonical_bytes,'UTF8')::jsonb;
  IF activation_frame->>'format' IS DISTINCT FROM 'flarex.data-binding-activation' OR
    activation_frame->>'sequence' IS DISTINCT FROM p_incoming_sequence::text OR
    activation_frame->'request'->>'scopeId' IS DISTINCT FROM p_scope OR
    activation_frame->'request'->>'storageGeneration' IS DISTINCT FROM live_authority.storage_generation OR
    activation_frame->'request'->>'candidateSha256' IS DISTINCT FROM p_candidate OR
    (NOT maintenance_owned AND (CASE WHEN had_head THEN
      activation_frame->'request'->'expectedHead'->>'sequence' IS DISTINCT FROM p_expected_sequence::text OR
      activation_frame->'request'->'expectedHead'->>'sha256' IS DISTINCT FROM p_expected_head
      ELSE activation_frame->'request'->'expectedHead' IS DISTINCT FROM 'null'::jsonb END)) THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  SELECT * INTO candidate FROM %1$I."fx_system_data_binding_candidate" WHERE scope_id=p_scope
    AND storage_generation=live_authority.storage_generation AND sha256=p_candidate FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  frame:=convert_from(candidate.canonical_bytes,'UTF8')::jsonb;
  IF frame->>'format' IS DISTINCT FROM 'flarex.data-binding-set' OR frame->'application'->>'deploymentId' IS DISTINCT FROM p_incoming_deployment OR
    frame->'application'->>'scopeId' IS DISTINCT FROM p_scope OR frame->'application'->>'storageGeneration' IS DISTINCT FROM live_authority.storage_generation OR
    (CASE WHEN frame->'logicalSchema'='null'::jsonb THEN p_incoming_schema IS NOT NULL OR p_incoming_manifest IS NOT NULL OR jsonb_array_length(p_incoming_members)<>0
      ELSE frame->'logicalSchema'->>'schemaVersionId' IS DISTINCT FROM p_incoming_schema OR
        frame->'logicalSchema'->>'manifestSha256' IS DISTINCT FROM p_incoming_manifest OR p_incoming_manifest !~ '^[0-9a-f]{64}$' END)
    THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  IF had_head THEN
    SELECT * INTO old_candidate FROM %1$I."fx_system_data_binding_candidate" WHERE scope_id=p_scope
      AND storage_generation=live_authority.storage_generation AND sha256=old_head.candidate_sha256 FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
    old_frame:=convert_from(old_candidate.canonical_bytes,'UTF8')::jsonb;
    IF old_frame->'application'->>'deploymentId' IS DISTINCT FROM p_outgoing_deployment OR
      (CASE WHEN old_frame->'logicalSchema'='null'::jsonb THEN p_outgoing_schema IS NOT NULL OR p_outgoing_manifest IS NOT NULL OR jsonb_array_length(p_outgoing_members)<>0
        ELSE old_frame->'logicalSchema'->>'schemaVersionId' IS DISTINCT FROM p_outgoing_schema OR
          old_frame->'logicalSchema'->>'manifestSha256' IS DISTINCT FROM p_outgoing_manifest END) THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
  END IF;
  IF (SELECT count(*) FROM %1$I."fx_system_unique_constraint_build" WHERE scope_id=p_scope AND "unique_constraint_definition_id" IN
    (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))<>jsonb_array_length(p_incoming_members)
    THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','unavailable')::text; END IF;
  FOR build IN SELECT * FROM %1$I."fx_system_unique_constraint_build" WHERE scope_id=p_scope AND
    (maintenance_authority_kind='binding' OR "unique_constraint_definition_id" IN (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY "unique_constraint_definition_id" FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer=build."unique_constraint_definition_id";
    IF build.lifecycle IS DISTINCT FROM 'enabled' OR build.storage_generation IS DISTINCT FROM live_authority.storage_generation OR
      build.storage_generation_fence IS DISTINCT FROM live_authority.storage_generation_fence OR build.epoch IS DISTINCT FROM live_authority.epoch OR
      build."start_commit_seq" IS NULL OR build.covered_through_commit_seq IS NULL OR build."start_commit_seq">build.covered_through_commit_seq OR
      build.covered_through_commit_seq>live_clock.last_commit_seq THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','unavailable')::text; END IF;
    IF build.maintenance_authority_kind IS NOT NULL THEN
      SELECT * INTO opening FROM %1$I."fx_system_unique_maintenance_obligation" WHERE scope_id=p_scope AND authority_kind=build.maintenance_authority_kind
        AND "unique_constraint_definition_id"=build."unique_constraint_definition_id" AND activation_sequence=build.maintenance_activation_sequence;
      IF NOT FOUND OR opening.storage_generation IS DISTINCT FROM build.storage_generation OR
        opening.storage_generation_fence IS DISTINCT FROM build.storage_generation_fence OR opening.epoch IS DISTINCT FROM build.epoch OR
        opening.attempt_fence IS DISTINCT FROM build.attempt_fence OR opening.opened_commit_seq IS DISTINCT FROM build.covered_through_commit_seq OR
        opening."start_commit_seq" IS DISTINCT FROM build."start_commit_seq" THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
      IF incoming_member IS NOT NULL AND (opening.table_id IS DISTINCT FROM (incoming_member->>'tableId')::integer OR
        opening.physical_spec_sha256 IS DISTINCT FROM decode(incoming_member->>'physicalSpecSha256','hex')) THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
      IF build.maintenance_authority_kind='application' THEN CONTINUE; END IF;
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members) WHERE (value->>'definitionId')::integer=build."unique_constraint_definition_id";
      IF NOT had_head OR outgoing_member IS NULL OR opening.activation_sequence IS DISTINCT FROM p_expected_sequence OR
        opening.head_sha256 IS DISTINCT FROM decode(p_expected_head,'hex') OR opening.activation_sha256 IS DISTINCT FROM decode(old_head.activation_sha256,'hex') OR
        opening.candidate_sha256 IS DISTINCT FROM decode(old_head.candidate_sha256,'hex') OR
        opening.deployment_id IS DISTINCT FROM p_outgoing_deployment OR opening.schema_version_id IS DISTINCT FROM p_outgoing_schema OR
        opening.schema_manifest_sha256 IS DISTINCT FROM decode(p_outgoing_manifest,'hex') OR
        opening.table_id IS DISTINCT FROM (outgoing_member->>'tableId')::integer OR
        opening.physical_spec_sha256 IS DISTINCT FROM decode(outgoing_member->>'physicalSpecSha256','hex') THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
      IF maintenance_owned AND p_incoming_sequence=p_expected_sequence THEN CONTINUE; END IF;
    ELSIF incoming_member IS NOT NULL AND build.covered_through_commit_seq<live_clock.last_commit_seq AND EXISTS (
      SELECT 1 FROM %1$I."fx_app_row_current" WHERE scope_uuid=live_clock.scope_uuid AND table_id=(incoming_member->>'tableId')::integer
        AND commit_seq>build.covered_through_commit_seq) THEN RAISE EXCEPTION 'fx_replace_binding_unique_maintenance' USING ERRCODE='FX001', DETAIL=jsonb_build_object('domain','unique','reason','unavailable')::text; END IF;
    IF incoming_member IS NOT NULL THEN
      INSERT INTO %1$I."fx_system_unique_maintenance_obligation" ("scope_id","authority_kind","unique_constraint_definition_id","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","start_commit_seq","opened_commit_seq","table_id","physical_spec_sha256","deployment_id","schema_version_id","schema_manifest_sha256","activation_sha256","head_sha256","candidate_sha256") VALUES
        (p_scope,'binding',build."unique_constraint_definition_id",p_incoming_sequence,build.storage_generation,build.storage_generation_fence,build.epoch,
          build.attempt_fence,build."start_commit_seq",live_clock.last_commit_seq,(incoming_member->>'tableId')::integer,
          decode(incoming_member->>'physicalSpecSha256','hex'),p_incoming_deployment,p_incoming_schema,decode(p_incoming_manifest,'hex'),
          decode(p_incoming_activation,'hex'),decode(p_next_head,'hex'),decode(p_candidate,'hex'));
      UPDATE %1$I."fx_system_unique_constraint_build" SET covered_through_commit_seq=live_clock.last_commit_seq,maintenance_authority_kind='binding',
        maintenance_activation_sequence=p_incoming_sequence,updated_at=clock_timestamp() WHERE scope_id=p_scope AND "unique_constraint_definition_id"=build."unique_constraint_definition_id";
      opened_total:=opened_total+1;
    ELSE
      UPDATE %1$I."fx_system_unique_constraint_build" SET covered_through_commit_seq=live_clock.last_commit_seq,maintenance_authority_kind=NULL,
        maintenance_activation_sequence=NULL,updated_at=clock_timestamp() WHERE scope_id=p_scope AND "unique_constraint_definition_id"=build."unique_constraint_definition_id";
      closed_total:=closed_total+1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT closed_total,opened_total;
END
$binding_unique_maintenance$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_replace_binding_unique_maintenance(text,bigint,text,bigint,text,text,text,text,text,text,jsonb,text,text,text,jsonb) FROM PUBLIC',target_schema);
END;
$maintenance_authority$;
--> statement-breakpoint
DO $maintenance_acceptance$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format('DROP FUNCTION IF EXISTS %1$I.fx_apply_app_publication(text,text,bigint,text,bigint,text,text,boolean,boolean,boolean,text,text,bytea,bigint,bytea,bytea,integer[],integer[],bytea[],boolean[],integer[],integer[],bytea[],boolean[],text[],text[],boolean,integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],text,%1$I.fx_app_row_write[],integer[],%1$I.fx_app_index_write[],bigint[],boolean[],%1$I.fx_app_unique_owner[],%1$I.fx_app_unique_write[],%1$I.fx_app_unique_write[],%1$I.fx_app_index_coverage[],%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],bigint,uuid,integer[],integer[],text[],boolean[],integer[],bytea[],integer[],%1$I.fx_app_search_write[],integer[],%1$I.fx_app_json_write[])',target_schema);
  EXECUTE format($ddl$    CREATE OR REPLACE FUNCTION %1$I.fx_accept_finite_storage_capture(p_scope_id text,
      p_expected %1$I.fx_finite_capture_expected, p_anchor_bytes bytea, p_anchor_sha256 bytea,
      p_snapshot_epoch_uuid uuid, p_snapshot_commit_seq bigint, p_metadata_watermark bigint,
      p_claim_owner uuid, p_claim_fence bigint, p_generation text, p_generation_fence bigint, p_epoch text,
      p_index_definition_id integer, p_table_id integer, p_unique_definition_id integer,
      p_read_basis %1$I.fx_finite_read_expected)
    RETURNS %1$I.fx_finite_capture_frontier
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE reason text; database_now_epoch_milliseconds text; serving_commit_seq bigint;
      authority_row %1$I.fx_system_scope_execution_authority;
      session_row %1$I.fx_system_tx_session;
      build_row %1$I.fx_system_index_build_state;
      unique_row %1$I.fx_system_unique_constraint_build;
      table_frontier bigint; historical_change boolean; body_eligible boolean := false;
      retained_floor bigint;
      binding_selection %1$I.fx_system_index_maintenance_obligation; binding_captured boolean:=false;
      index_maintenance %1$I.fx_system_index_maintenance_obligation;
      unique_maintenance %1$I.fx_system_unique_maintenance_obligation;
      index_ready boolean; unique_ready boolean;
      s %1$I.fx_system_tx_session; clock_row %1$I.fx_system_scope_clock; current_time_ms bigint;
      effective_statement_timeout interval;
    BEGIN
      -- Startup arms the statement before execution. Re-check the actual pooled
      -- session setting before authority, attempt or build locks and body access.
      effective_statement_timeout := current_setting('statement_timeout')::interval;
      IF effective_statement_timeout <= interval '0 milliseconds'
        OR effective_statement_timeout > interval '30000 milliseconds' THEN
        reason := 'resourceFailure'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      reason := 'invalidAuthority';
      IF p_scope_id IS NULL THEN RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      SELECT a.* INTO authority_row FROM %1$I.fx_system_scope_execution_authority a WHERE a.scope_id = p_scope_id FOR SHARE;
      IF authority_row.scope_id IS NULL THEN RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
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
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_generation <> 'flarexdb_v1' OR authority_row.storage_generation <> 'flarexdb_v1' THEN
        reason := 'unsupportedStorageGeneration'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF authority_row.storage_generation_fence IS DISTINCT FROM p_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF authority_row.epoch IS DISTINCT FROM p_epoch THEN reason := 'scopeEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      -- Identity lookup precedes fence interpretation, including corrupt replaced rows.
      SELECT a.* INTO s FROM %1$I.fx_system_tx_session a
        WHERE a.scope_uuid = (substring(p_scope_id FROM 7))::uuid AND a.session_id = (p_expected).session_id FOR SHARE;
      IF s.session_id IS NULL THEN reason := 'attemptMissing'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      IF NOT isfinite(s.authorization_grant_expires_at) OR NOT isfinite(s.hard_expires_at)
        OR NOT isfinite(s.created_at) OR NOT isfinite(s.updated_at)
        OR s.finite_lease_expires_at IS NULL OR NOT isfinite(s.finite_lease_expires_at)
        OR s.finite_claimed_at IS NULL OR NOT isfinite(s.finite_claimed_at)
        OR s.finite_claim_expires_at IS NULL OR NOT isfinite(s.finite_claim_expires_at) THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.finite_attempt_bytes IS NULL OR octet_length(s.finite_attempt_bytes) NOT BETWEEN 1 AND 131072
        OR s.finite_attempt_sha256 IS NULL OR octet_length(s.finite_attempt_sha256) <> 32
        OR s.finite_snapshot_epoch_uuid IS NULL OR s.finite_snapshot_commit_seq IS NULL
        OR s.finite_snapshot_commit_seq < 0 OR s.attempt_fence < 1
        OR s.finite_claim_owner IS NULL OR s.finite_claim_fence IS NULL OR s.finite_claim_fence < 1
        OR s.finite_claim_expires_at <= s.finite_claimed_at OR s.finite_claim_expires_at > s.finite_lease_expires_at
        OR s.finite_lease_expires_at > s.hard_expires_at THEN
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.attempt_fence <> (p_expected).attempt_fence THEN
        -- The owning canonical decoder checks this fresh frontier before the
        -- replacement verdict. No business body is selected for this header.
        session_row := s; reason := 'attemptReplaced'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
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
        reason := 'storedCorruption'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.finite_claim_owner <> p_claim_owner OR s.finite_claim_fence <> p_claim_fence THEN
        reason := 'ownershipChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
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
      IF s.lifecycle <> 'running' THEN reason := 'lifecycleChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      IF current_time_ms >= floor(extract(epoch FROM s.finite_lease_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.finite_claim_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.authorization_grant_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.hard_expires_at)*1000) THEN
        reason := 'expired'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.storage_generation <> authority_row.storage_generation OR s.storage_generation_fence <> authority_row.storage_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_epoch <> authority_row.epoch OR p_snapshot_epoch_uuid <> authority_row.epoch_uuid THEN
        reason := 'scopeEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF s.authorization_revocation_epoch <> authority_row.authorization_revocation_epoch THEN
        reason := 'authorizationRevocationEpochChanged'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_snapshot_commit_seq < authority_row.oldest_available_commit_seq THEN reason := 'expired'; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
      -- Complete mutable readiness belongs to this fresh accepting command.
      -- Corruption precedes availability; index fast paths retain their original
      -- early return before an optional unique demand. No live verdict is cached.
      retained_floor := authority_row.oldest_available_commit_seq;
      IF serving_commit_seq IS NULL OR serving_commit_seq < p_snapshot_commit_seq
        OR retained_floor > serving_commit_seq OR table_frontier < 1 THEN
        reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
      END IF;
      IF p_index_definition_id IS NOT NULL AND (p_read_basis).accept_readiness THEN
        IF build_row.scope_id IS NULL THEN reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF (build_row.cursor_codec_version = 1
          AND (build_row.maintenance_authority_kind IS NULL) = (build_row.maintenance_activation_sequence IS NULL)
          AND (build_row.maintenance_authority_kind IS NULL OR build_row.maintenance_authority_kind IN ('application','binding'))
          AND build_row.scope_id = p_scope_id
          AND build_row.index_definition_id = p_index_definition_id
          AND build_row.index_definition_id > 0
          AND build_row.storage_generation = 'flarexdb_v1'
          AND build_row.storage_generation_fence > 0
          AND length(build_row.epoch) > 0
          AND build_row.start_commit_seq >= 0
          AND (build_row.covered_through_commit_seq IS NULL OR build_row.covered_through_commit_seq >= 0)
          AND (build_row.first_readable_commit_seq IS NULL OR build_row.first_readable_commit_seq >= 0 AND build_row.covered_through_commit_seq IS NOT NULL AND build_row.first_readable_commit_seq <= build_row.covered_through_commit_seq)
          AND build_row.lifecycle IN ('declared','building','backfilling','validating','enabled','retiring')
          AND (build_row.backfill_cursor_row_id IS NULL OR octet_length(build_row.backfill_cursor_row_id) = 16)
          AND (build_row.lifecycle NOT IN ('declared','building') OR build_row.backfill_cursor_row_id IS NULL)
          AND build_row.attempt_fence > 0
          AND isfinite(build_row.created_at)
          AND isfinite(build_row.updated_at)
          AND abs(floor(extract(epoch FROM build_row.created_at)*1000)) <= 8640000000000000
          AND abs(floor(extract(epoch FROM build_row.updated_at)*1000)) <= 8640000000000000
          AND floor(extract(epoch FROM build_row.updated_at)*1000) >= floor(extract(epoch FROM build_row.created_at)*1000)) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        SELECT m.* INTO index_maintenance FROM %1$I.fx_system_index_maintenance_obligation m
          WHERE m.scope_id = build_row.scope_id AND m.index_definition_id = build_row.index_definition_id
            AND m.authority_kind = build_row.maintenance_authority_kind AND m.activation_sequence = build_row.maintenance_activation_sequence;
        IF (build_row.maintenance_activation_sequence IS NULL) IS DISTINCT FROM (index_maintenance.scope_id IS NULL) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF index_maintenance.scope_id IS NOT NULL AND (index_maintenance.activation_sequence > 0
          AND index_maintenance.authority_kind = build_row.maintenance_authority_kind
          AND index_maintenance.authority_kind IN ('application','binding')
          AND (index_maintenance.authority_kind = 'application' AND index_maintenance.candidate_sha256 IS NULL
            OR index_maintenance.authority_kind = 'binding' AND octet_length(index_maintenance.candidate_sha256) = 32)
          AND index_maintenance.storage_generation = 'flarexdb_v1'
          AND index_maintenance.storage_generation_fence > 0
          AND length(index_maintenance.epoch) > 0
          AND index_maintenance.opened_commit_seq >= 0
          AND index_maintenance.table_id > 0
          AND octet_length(index_maintenance.physical_spec_sha256) = 32
          AND length(index_maintenance.deployment_id) > 0
          AND length(index_maintenance.schema_version_id) > 0
          AND octet_length(index_maintenance.activation_sha256) = 32
          AND octet_length(index_maintenance.head_sha256) = 32
          AND index_maintenance.index_definition_id > 0
          AND index_maintenance.attempt_fence > 0
          AND index_maintenance.first_readable_commit_seq >= 0
          AND index_maintenance.first_readable_commit_seq <= index_maintenance.opened_commit_seq
          AND octet_length(index_maintenance.schema_manifest_sha256) = 32
          AND build_row.lifecycle = 'enabled'
          AND index_maintenance.activation_sequence = build_row.maintenance_activation_sequence
          AND index_maintenance.scope_id = build_row.scope_id
          AND index_maintenance.index_definition_id = build_row.index_definition_id
          AND index_maintenance.storage_generation = build_row.storage_generation
          AND index_maintenance.storage_generation_fence = build_row.storage_generation_fence
          AND index_maintenance.epoch = build_row.epoch
          AND index_maintenance.attempt_fence = build_row.attempt_fence
          AND index_maintenance.first_readable_commit_seq = build_row.first_readable_commit_seq
          AND index_maintenance.opened_commit_seq = build_row.covered_through_commit_seq) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF build_row.start_commit_seq > serving_commit_seq OR build_row.covered_through_commit_seq > serving_commit_seq
          OR build_row.storage_generation IS DISTINCT FROM authority_row.storage_generation
          OR build_row.storage_generation_fence IS DISTINCT FROM authority_row.storage_generation_fence
          OR build_row.epoch IS DISTINCT FROM authority_row.epoch THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF build_row.lifecycle <> 'enabled' OR build_row.first_readable_commit_seq IS NULL
          OR build_row.first_readable_commit_seq > p_snapshot_commit_seq OR build_row.covered_through_commit_seq IS NULL THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF index_maintenance.scope_id IS NOT NULL AND (index_maintenance.table_id IS DISTINCT FROM p_table_id
          OR index_maintenance.physical_spec_sha256 IS DISTINCT FROM (p_read_basis).index_physical_spec_sha256) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF (index_maintenance.scope_id IS NULL OR index_maintenance.authority_kind='binding') AND NOT binding_captured THEN
          SELECT selected_binding.activation_sequence,selected_binding.head_sha256,selected_binding.activation_sha256,
            selected_binding.candidate_sha256,selected_binding.deployment_id,selected_binding.schema_version_id,selected_binding.schema_manifest_sha256
          INTO binding_selection.activation_sequence,binding_selection.head_sha256,binding_selection.activation_sha256,
            binding_selection.candidate_sha256,binding_selection.deployment_id,binding_selection.schema_version_id,binding_selection.schema_manifest_sha256
          FROM (WITH selected AS MATERIALIZED (SELECT bh.*, ba.sha256 AS selected_activation_sha256,
      ba.canonical_bytes AS activation_bytes, ba.request_id AS selected_request_id, bc.canonical_bytes AS candidate_bytes,
      bc.sha256 AS selected_candidate_sha256 FROM %1$I.fx_system_data_binding_head bh
    JOIN %1$I.fx_system_data_binding_activation ba ON ba.scope_id=bh.scope_id
      AND ba.storage_generation=bh.storage_generation AND ba.sequence=bh.sequence
      AND ba.sha256=bh.activation_sha256 AND ba.candidate_sha256=bh.candidate_sha256
    JOIN %1$I.fx_system_data_binding_candidate bc ON bc.scope_id=bh.scope_id
      AND bc.storage_generation=bh.storage_generation AND bc.sha256=bh.candidate_sha256
    WHERE bh.scope_id=p_scope_id AND bh.storage_generation=p_generation
      AND octet_length(bh.canonical_bytes)=bh.canonical_byte_length AND bh.canonical_byte_length BETWEEN 1 AND 1048576
      AND octet_length(ba.canonical_bytes)=ba.canonical_byte_length AND ba.canonical_byte_length BETWEEN 1 AND 1048576
      AND octet_length(bc.canonical_bytes)=bc.canonical_byte_length AND bc.canonical_byte_length BETWEEN 1 AND 1048576
      AND pg_catalog.sha256(bh.canonical_bytes)=decode(bh.sha256,'hex')
      AND pg_catalog.sha256(ba.canonical_bytes)=decode(ba.sha256,'hex')
      AND pg_catalog.sha256(bc.canonical_bytes)=decode(bc.sha256,'hex')),
    frames AS MATERIALIZED (SELECT selected.*,
      pg_catalog.convert_from(canonical_bytes,'UTF8')::jsonb AS head_frame,
      pg_catalog.convert_from(activation_bytes,'UTF8')::jsonb AS activation_frame,
      pg_catalog.convert_from(candidate_bytes,'UTF8')::jsonb AS candidate_frame FROM selected)
    SELECT candidate_frame->'application'->>'deploymentId' AS deployment_id,
      candidate_frame->'logicalSchema'->>'schemaVersionId' AS schema_version_id,
      decode(candidate_frame->'logicalSchema'->>'manifestSha256','hex') AS schema_manifest_sha256,
      sequence AS activation_sequence,decode(sha256,'hex') AS head_sha256,
      decode(selected_activation_sha256,'hex') AS activation_sha256,
      decode(selected_candidate_sha256,'hex') AS candidate_sha256 FROM frames
    WHERE head_frame->>'format'='flarex.data-binding-head' AND head_frame->>'version'='2'
      AND head_frame->>'scopeId'=scope_id AND head_frame->>'storageGeneration'=storage_generation
      AND head_frame->>'sequence'=sequence::text AND head_frame->>'candidateSha256'=candidate_sha256
      AND head_frame->>'activationSha256'=selected_activation_sha256
      AND activation_frame->>'format'='flarex.data-binding-activation' AND activation_frame->>'version' IN ('2','3')
      AND activation_frame->>'sequence'=sequence::text AND activation_frame->'request'->>'scopeId'=scope_id
      AND activation_frame->'request'->>'format'='flarex.data-binding-activation-request'
      AND activation_frame->'request'->>'version'='1' AND activation_frame->'request'->>'requestId'=selected_request_id
      AND activation_frame->'request'->>'storageGeneration'=storage_generation
      AND activation_frame->'request'->>'candidateSha256'=candidate_sha256
      AND candidate_frame->>'format'='flarex.data-binding-set' AND candidate_frame->'logicalSchema' IS NOT NULL
      AND candidate_frame->'logicalSchema' <> 'null'::jsonb) selected_binding;
          binding_captured:=true;
        END IF;
        IF index_maintenance.scope_id IS NULL AND EXISTS(SELECT 1 FROM %1$I.fx_system_index_maintenance_obligation required
          WHERE required.scope_id=p_scope_id AND required.authority_kind='binding'
            AND required.activation_sequence=binding_selection.activation_sequence AND required.index_definition_id=p_index_definition_id
            AND (binding_selection.activation_sequence=required.activation_sequence
    AND binding_selection.head_sha256=required.head_sha256 AND binding_selection.activation_sha256=required.activation_sha256
    AND binding_selection.candidate_sha256=required.candidate_sha256 AND binding_selection.deployment_id=required.deployment_id
    AND binding_selection.schema_version_id=required.schema_version_id AND binding_selection.schema_manifest_sha256=required.schema_manifest_sha256) IS TRUE)
          OR index_maintenance.authority_kind='binding' AND (binding_selection.activation_sequence=index_maintenance.activation_sequence
    AND binding_selection.head_sha256=index_maintenance.head_sha256 AND binding_selection.activation_sha256=index_maintenance.activation_sha256
    AND binding_selection.candidate_sha256=index_maintenance.candidate_sha256 AND binding_selection.deployment_id=index_maintenance.deployment_id
    AND binding_selection.schema_version_id=index_maintenance.schema_version_id AND binding_selection.schema_manifest_sha256=index_maintenance.schema_manifest_sha256) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        index_ready := build_row.covered_through_commit_seq >= p_snapshot_commit_seq
          OR index_maintenance.scope_id IS NOT NULL AND (
            index_maintenance.authority_kind='binding' AND binding_selection.activation_sequence=index_maintenance.activation_sequence
    AND binding_selection.head_sha256=index_maintenance.head_sha256 AND binding_selection.activation_sha256=index_maintenance.activation_sha256
    AND binding_selection.candidate_sha256=index_maintenance.candidate_sha256 AND binding_selection.deployment_id=index_maintenance.deployment_id
    AND binding_selection.schema_version_id=index_maintenance.schema_version_id AND binding_selection.schema_manifest_sha256=index_maintenance.schema_manifest_sha256
            OR index_maintenance.authority_kind='application' AND index_maintenance.deployment_id = (p_read_basis).deployment_id
            AND index_maintenance.schema_version_id = (p_read_basis).schema_version_id
            AND index_maintenance.activation_sequence = (p_read_basis).activation_sequence
            AND index_maintenance.head_sha256 = (p_read_basis).head_sha256
            AND index_maintenance.activation_sha256 = (p_read_basis).activation_sha256
            AND index_maintenance.schema_manifest_sha256 = (p_read_basis).manifest_sha256)
          OR table_frontier IS NULL OR table_frontier <= build_row.covered_through_commit_seq;
        IF index_ready IS TRUE THEN reason := 'accepted'; body_eligible := true; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF build_row.covered_through_commit_seq < retained_floor OR historical_change THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
      END IF;
      IF p_unique_definition_id IS NOT NULL AND (p_read_basis).accept_readiness THEN
        IF unique_row.scope_id IS NULL THEN reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible); END IF;
        IF (unique_row.scope_id = p_scope_id
          AND unique_row.unique_constraint_definition_id = p_unique_definition_id
          AND unique_row.unique_constraint_definition_id > 0
          AND unique_row.start_commit_seq >= 0
          AND (unique_row.covered_through_commit_seq IS NULL OR unique_row.covered_through_commit_seq >= unique_row.start_commit_seq)
          AND unique_row.attempt_fence > 0
          AND unique_row.storage_generation = 'flarexdb_v1'
          AND unique_row.storage_generation_fence > 0
          AND length(unique_row.epoch) > 0
          AND unique_row.lifecycle IN ('declared','building','backfilling','validating','enabled')
          AND (unique_row.cursor_row_id IS NULL OR octet_length(unique_row.cursor_row_id) = 16)
          AND (unique_row.lifecycle NOT IN ('declared','building','enabled') OR unique_row.cursor_row_id IS NULL)
          AND (unique_row.lifecycle NOT IN ('declared','building') OR unique_row.covered_through_commit_seq IS NULL)
          AND (unique_row.lifecycle <> 'enabled' OR unique_row.covered_through_commit_seq IS NOT NULL)
          AND isfinite(unique_row.created_at)
          AND isfinite(unique_row.updated_at)
          AND abs(floor(extract(epoch FROM unique_row.created_at)*1000)) <= 8640000000000000
          AND abs(floor(extract(epoch FROM unique_row.updated_at)*1000)) <= 8640000000000000
          AND floor(extract(epoch FROM unique_row.updated_at)*1000) >= floor(extract(epoch FROM unique_row.created_at)*1000)
          AND (unique_row.maintenance_authority_kind IS NULL) = (unique_row.maintenance_activation_sequence IS NULL)
          AND (unique_row.maintenance_authority_kind IS NULL OR unique_row.maintenance_authority_kind IN ('application','binding'))
          AND unique_row.start_commit_seq <= serving_commit_seq
          AND (unique_row.covered_through_commit_seq IS NULL OR unique_row.covered_through_commit_seq <= serving_commit_seq)) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        SELECT m.* INTO unique_maintenance FROM %1$I.fx_system_unique_maintenance_obligation m
          WHERE m.scope_id = unique_row.scope_id AND m.unique_constraint_definition_id = unique_row.unique_constraint_definition_id
            AND m.authority_kind = unique_row.maintenance_authority_kind AND m.activation_sequence = unique_row.maintenance_activation_sequence;
        IF (unique_row.maintenance_activation_sequence IS NULL) IS DISTINCT FROM (unique_maintenance.scope_id IS NULL) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_maintenance.scope_id IS NOT NULL AND (unique_maintenance.authority_kind = unique_row.maintenance_authority_kind
          AND unique_maintenance.authority_kind IN ('application','binding')
          AND (unique_maintenance.authority_kind='application' AND unique_maintenance.candidate_sha256 IS NULL AND unique_maintenance.schema_manifest_sha256 IS NULL
            OR unique_maintenance.authority_kind='binding' AND octet_length(unique_maintenance.candidate_sha256)=32 AND octet_length(unique_maintenance.schema_manifest_sha256)=32)
          AND unique_maintenance.activation_sequence > 0
          AND unique_maintenance.storage_generation = 'flarexdb_v1'
          AND unique_maintenance.storage_generation_fence > 0
          AND length(unique_maintenance.epoch) > 0
          AND unique_maintenance.opened_commit_seq >= 0
          AND unique_maintenance.table_id > 0
          AND octet_length(unique_maintenance.physical_spec_sha256) = 32
          AND length(unique_maintenance.deployment_id) > 0
          AND length(unique_maintenance.schema_version_id) > 0
          AND octet_length(unique_maintenance.activation_sha256) = 32
          AND octet_length(unique_maintenance.head_sha256) = 32
          AND unique_maintenance.unique_constraint_definition_id > 0
          AND unique_maintenance.attempt_fence > 0
          AND unique_maintenance.start_commit_seq >= 0
          AND unique_maintenance.start_commit_seq <= unique_maintenance.opened_commit_seq
          AND unique_row.lifecycle = 'enabled'
          AND unique_maintenance.activation_sequence = unique_row.maintenance_activation_sequence
          AND unique_maintenance.scope_id = unique_row.scope_id
          AND unique_maintenance.unique_constraint_definition_id = unique_row.unique_constraint_definition_id
          AND unique_maintenance.storage_generation = unique_row.storage_generation
          AND unique_maintenance.storage_generation_fence = unique_row.storage_generation_fence
          AND unique_maintenance.epoch = unique_row.epoch
          AND unique_maintenance.attempt_fence = unique_row.attempt_fence
          AND unique_maintenance.start_commit_seq = unique_row.start_commit_seq
          AND unique_maintenance.opened_commit_seq = unique_row.covered_through_commit_seq) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_row.storage_generation IS DISTINCT FROM authority_row.storage_generation
          OR unique_row.storage_generation_fence IS DISTINCT FROM authority_row.storage_generation_fence
          OR unique_row.epoch IS DISTINCT FROM authority_row.epoch OR unique_row.lifecycle <> 'enabled'
          OR unique_row.start_commit_seq > p_snapshot_commit_seq OR unique_row.covered_through_commit_seq IS NULL THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF unique_maintenance.scope_id IS NOT NULL AND (unique_maintenance.table_id IS DISTINCT FROM p_table_id
          OR unique_maintenance.physical_spec_sha256 IS DISTINCT FROM (p_read_basis).unique_physical_spec_sha256) THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        IF (unique_maintenance.scope_id IS NULL OR unique_maintenance.authority_kind='binding') AND NOT binding_captured THEN
          SELECT selected_binding.activation_sequence,selected_binding.head_sha256,selected_binding.activation_sha256,
            selected_binding.candidate_sha256,selected_binding.deployment_id,selected_binding.schema_version_id,selected_binding.schema_manifest_sha256
          INTO binding_selection.activation_sequence,binding_selection.head_sha256,binding_selection.activation_sha256,
            binding_selection.candidate_sha256,binding_selection.deployment_id,binding_selection.schema_version_id,binding_selection.schema_manifest_sha256
          FROM (WITH selected AS MATERIALIZED (SELECT bh.*, ba.sha256 AS selected_activation_sha256,
      ba.canonical_bytes AS activation_bytes, ba.request_id AS selected_request_id, bc.canonical_bytes AS candidate_bytes,
      bc.sha256 AS selected_candidate_sha256 FROM %1$I.fx_system_data_binding_head bh
    JOIN %1$I.fx_system_data_binding_activation ba ON ba.scope_id=bh.scope_id
      AND ba.storage_generation=bh.storage_generation AND ba.sequence=bh.sequence
      AND ba.sha256=bh.activation_sha256 AND ba.candidate_sha256=bh.candidate_sha256
    JOIN %1$I.fx_system_data_binding_candidate bc ON bc.scope_id=bh.scope_id
      AND bc.storage_generation=bh.storage_generation AND bc.sha256=bh.candidate_sha256
    WHERE bh.scope_id=p_scope_id AND bh.storage_generation=p_generation
      AND octet_length(bh.canonical_bytes)=bh.canonical_byte_length AND bh.canonical_byte_length BETWEEN 1 AND 1048576
      AND octet_length(ba.canonical_bytes)=ba.canonical_byte_length AND ba.canonical_byte_length BETWEEN 1 AND 1048576
      AND octet_length(bc.canonical_bytes)=bc.canonical_byte_length AND bc.canonical_byte_length BETWEEN 1 AND 1048576
      AND pg_catalog.sha256(bh.canonical_bytes)=decode(bh.sha256,'hex')
      AND pg_catalog.sha256(ba.canonical_bytes)=decode(ba.sha256,'hex')
      AND pg_catalog.sha256(bc.canonical_bytes)=decode(bc.sha256,'hex')),
    frames AS MATERIALIZED (SELECT selected.*,
      pg_catalog.convert_from(canonical_bytes,'UTF8')::jsonb AS head_frame,
      pg_catalog.convert_from(activation_bytes,'UTF8')::jsonb AS activation_frame,
      pg_catalog.convert_from(candidate_bytes,'UTF8')::jsonb AS candidate_frame FROM selected)
    SELECT candidate_frame->'application'->>'deploymentId' AS deployment_id,
      candidate_frame->'logicalSchema'->>'schemaVersionId' AS schema_version_id,
      decode(candidate_frame->'logicalSchema'->>'manifestSha256','hex') AS schema_manifest_sha256,
      sequence AS activation_sequence,decode(sha256,'hex') AS head_sha256,
      decode(selected_activation_sha256,'hex') AS activation_sha256,
      decode(selected_candidate_sha256,'hex') AS candidate_sha256 FROM frames
    WHERE head_frame->>'format'='flarex.data-binding-head' AND head_frame->>'version'='2'
      AND head_frame->>'scopeId'=scope_id AND head_frame->>'storageGeneration'=storage_generation
      AND head_frame->>'sequence'=sequence::text AND head_frame->>'candidateSha256'=candidate_sha256
      AND head_frame->>'activationSha256'=selected_activation_sha256
      AND activation_frame->>'format'='flarex.data-binding-activation' AND activation_frame->>'version' IN ('2','3')
      AND activation_frame->>'sequence'=sequence::text AND activation_frame->'request'->>'scopeId'=scope_id
      AND activation_frame->'request'->>'format'='flarex.data-binding-activation-request'
      AND activation_frame->'request'->>'version'='1' AND activation_frame->'request'->>'requestId'=selected_request_id
      AND activation_frame->'request'->>'storageGeneration'=storage_generation
      AND activation_frame->'request'->>'candidateSha256'=candidate_sha256
      AND candidate_frame->>'format'='flarex.data-binding-set' AND candidate_frame->'logicalSchema' IS NOT NULL
      AND candidate_frame->'logicalSchema' <> 'null'::jsonb) selected_binding;
          binding_captured:=true;
        END IF;
        IF unique_maintenance.scope_id IS NULL AND EXISTS(SELECT 1 FROM %1$I.fx_system_unique_maintenance_obligation required
          WHERE required.scope_id=p_scope_id AND required.authority_kind='binding'
            AND required.activation_sequence=binding_selection.activation_sequence AND required.unique_constraint_definition_id=p_unique_definition_id
            AND (binding_selection.activation_sequence=required.activation_sequence
    AND binding_selection.head_sha256=required.head_sha256 AND binding_selection.activation_sha256=required.activation_sha256
    AND binding_selection.candidate_sha256=required.candidate_sha256 AND binding_selection.deployment_id=required.deployment_id
    AND binding_selection.schema_version_id=required.schema_version_id AND binding_selection.schema_manifest_sha256=required.schema_manifest_sha256) IS TRUE)
          OR unique_maintenance.authority_kind='binding' AND (binding_selection.activation_sequence=unique_maintenance.activation_sequence
    AND binding_selection.head_sha256=unique_maintenance.head_sha256 AND binding_selection.activation_sha256=unique_maintenance.activation_sha256
    AND binding_selection.candidate_sha256=unique_maintenance.candidate_sha256 AND binding_selection.deployment_id=unique_maintenance.deployment_id
    AND binding_selection.schema_version_id=unique_maintenance.schema_version_id AND binding_selection.schema_manifest_sha256=unique_maintenance.schema_manifest_sha256) IS NOT TRUE THEN
          reason := 'storedCorruption'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
        unique_ready := unique_row.covered_through_commit_seq >= p_snapshot_commit_seq
          OR unique_maintenance.scope_id IS NOT NULL AND (
            unique_maintenance.authority_kind='binding' AND binding_selection.activation_sequence=unique_maintenance.activation_sequence
    AND binding_selection.head_sha256=unique_maintenance.head_sha256 AND binding_selection.activation_sha256=unique_maintenance.activation_sha256
    AND binding_selection.candidate_sha256=unique_maintenance.candidate_sha256 AND binding_selection.deployment_id=unique_maintenance.deployment_id
    AND binding_selection.schema_version_id=unique_maintenance.schema_version_id AND binding_selection.schema_manifest_sha256=unique_maintenance.schema_manifest_sha256
            OR unique_maintenance.authority_kind='application' AND unique_maintenance.deployment_id = (p_read_basis).deployment_id
            AND unique_maintenance.schema_version_id = (p_read_basis).schema_version_id
            AND unique_maintenance.activation_sequence = (p_read_basis).activation_sequence
            AND unique_maintenance.head_sha256 = (p_read_basis).head_sha256
            AND unique_maintenance.activation_sha256 = (p_read_basis).activation_sha256)
          OR table_frontier IS NULL OR table_frontier <= unique_row.covered_through_commit_seq;
        IF unique_ready IS NOT TRUE AND (unique_row.covered_through_commit_seq < retained_floor OR historical_change) THEN
          reason := 'notReady'; body_eligible := false; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
        END IF;
      END IF;
      reason := 'accepted'; body_eligible := true; RETURN ROW(reason, database_now_epoch_milliseconds, serving_commit_seq, retained_floor, session_row, body_eligible);
    END;
    $body$$ddl$,target_schema);
  EXECUTE format($ddl$
CREATE OR REPLACE FUNCTION %1$I.fx_accept_app_publication("p_scope" text, "p_scope_uuid" uuid, "p_generation" text, "p_fence" bigint, "p_epoch" text, "p_last" bigint, "p_snapshot" bigint, "p_oldest" bigint, "p_deadline" timestamptz, "p_capture_snapshot" boolean, "p_original_build_locks" boolean, "p_intrinsic" integer[], "p_developer" integer[], "p_developer_access" text[], "p_point_tables" integer[], "p_point_ids" bytea[], "p_point_kinds" text[], "p_point_sequences" bigint[], "p_point_snapshots" bigint[], "p_changed" boolean[], "p_need_original" boolean[], "p_original_sequences" bigint[], "p_original_scopes" uuid[], "p_original_epochs" uuid[], "p_original_previous" bigint[], "p_original_schemas" text[], "p_original_lengths" integer[], "p_original_digests" bytea[], "p_original_times" double precision[], "p_range_indexes" integer[], "p_range_tables" integer[], "p_range_specs" bytea[], "p_range_lower" bytea[], "p_range_upper_kinds" text[], "p_range_upper" bytea[], "p_range_upper_ids" bytea[], "p_relation_indexes" integer[], "p_relation_ids" bytea[], "p_relation_versions" bigint[], "p_indexes" integer[], "p_access" text[], "p_tables" integer[], "p_codecs" integer[], "p_specs" bytea[], "p_ids" bytea[], "p_previous" bytea[], "p_previous_sha" bytea[], "p_final" bytea[], "p_final_sha" bytea[], "p_row_previous" bigint[], "p_maximum" integer, "p_unique_owners" %1$I.fx_app_unique_owner[], "p_unique_previous" bytea[], "p_unique_row_previous" bigint[], "p_target_tables" integer[], "p_target_ids" bytea[], "p_candidate" boolean, "p_stop" text)
RETURNS TABLE("kind" text, "ordinal" integer, "pointer_sequence" bigint, "latest_sequence" bigint, "latest_tombstone" boolean, "latest_creation_time" double precision, "transition_reason" text, "pair_ordinal" integer, "key_ordinal" integer, "transition_kind" text, "prior_commit_seq" bigint, "prior_is_tombstone" boolean, "emitted_count" integer, "accepted_unique_owners" integer, "validation_definition" integer, "validation_attempt" bigint, "validation_epoch" text, "validation_fence" bigint, "database_now" timestamptz, "candidate_head" %1$I.fx_system_app_schema_candidate_validation, "application_head" %1$I.fx_system_application_active_head, "application_activation" %1$I.fx_system_application_activation, "legacy_schema" %1$I.fx_system_application_revision_schema_v1, "relation_schema" %1$I.fx_system_application_revision_schema)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $publication_acceptance$
DECLARE i integer := 1; j integer; phase text := 'intrinsicBuild'; refusal text; selected_id integer; actual_sequence bigint;
  b %1$I."fx_system_index_build_state"; m %1$I."fx_system_index_maintenance_obligation"; latest %1$I."fx_app_row_rev"; pointer_seq bigint; captured record; transition record; coverage record;
  intrinsic %1$I."fx_system_index_build_state"[] := ARRAY[]::%1$I."fx_system_index_build_state"[]; developer %1$I."fx_system_index_build_state"[] := ARRAY[]::%1$I."fx_system_index_build_state"[];
  intrinsic_maintenance %1$I."fx_system_index_maintenance_obligation"[] := ARRAY[]::%1$I."fx_system_index_maintenance_obligation"[];
  developer_maintenance %1$I."fx_system_index_maintenance_obligation"[] := ARRAY[]::%1$I."fx_system_index_maintenance_obligation"[];
  heads %1$I."fx_app_row_rev"[] := ARRAY[]::%1$I."fx_app_row_rev"[]; pointers bigint[] := ARRAY[]::bigint[]; original_lengths integer[] := ARRAY[]::integer[];
  attempts bigint[] := ARRAY[]::bigint[]; epochs text[] := ARRAY[]::text[]; fences bigint[] := ARRAY[]::bigint[];
  range_row %1$I."fx_app_index_entry_rev"; version bigint; target %1$I."fx_app_row_rev"; original %1$I."fx_app_row_rev"; first_point_conflict integer;
BEGIN
  IF p_scope IS NULL OR length(p_scope) = 0 OR p_generation IS DISTINCT FROM 'flarexdb_v1' OR p_fence IS NULL OR p_fence <= 0 OR
    p_epoch IS NULL OR length(p_epoch) = 0 OR p_last IS NULL OR p_last < 0 OR p_scope_uuid IS NULL THEN
    refusal := 'invalidAuthority'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
  END IF;
  IF cardinality(p_intrinsic) <> (SELECT count(DISTINCT value) FROM unnest(p_intrinsic) value) THEN
    refusal := 'intrinsicIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
  END IF;
  IF cardinality(p_intrinsic) > 0 THEN FOR j IN 0..(cardinality(p_intrinsic)-1)/32 LOOP
    IF NOT p_original_build_locks THEN PERFORM 1 FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope
      AND x."index_definition_id" = ANY(p_intrinsic[j*32+1:least((j+1)*32,cardinality(p_intrinsic))])
      ORDER BY array_position(p_intrinsic, x."index_definition_id") FOR SHARE; END IF;
    FOR i IN j*32+1..least((j+1)*32,cardinality(p_intrinsic)) LOOP
      selected_id := p_intrinsic[i];
      SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope AND x."index_definition_id" = selected_id;
      SELECT x.* INTO m FROM %1$I."fx_system_index_maintenance_obligation" x WHERE x."scope_id" = p_scope
        AND x."index_definition_id" = selected_id AND x."authority_kind" = b."maintenance_authority_kind" AND x."activation_sequence" = b."maintenance_activation_sequence";
      IF (
  ((b."maintenance_authority_kind" IS NULL) <> (b."maintenance_activation_sequence" IS NULL)) OR
  (b."maintenance_authority_kind" IS NOT NULL AND b."maintenance_authority_kind" NOT IN ('application','binding')) OR
  b."scope_id" IS DISTINCT FROM p_scope OR
  b."index_definition_id" IS DISTINCT FROM selected_id OR
  b."storage_generation" IS DISTINCT FROM p_generation OR
  b."storage_generation_fence" IS DISTINCT FROM p_fence OR
  b."epoch" IS DISTINCT FROM p_epoch OR
  b."start_commit_seq" IS NULL OR b."start_commit_seq" < 0 OR
  b."start_commit_seq" > p_last OR
  (b."covered_through_commit_seq" IS NOT NULL AND
    (b."covered_through_commit_seq" < 0 OR b."covered_through_commit_seq" > p_last)) OR
  (b."first_readable_commit_seq" IS NOT NULL AND
    (b."first_readable_commit_seq" < 0 OR b."covered_through_commit_seq" IS NULL OR
      b."first_readable_commit_seq" > b."covered_through_commit_seq")) OR
  b."lifecycle" IS NULL OR
  b."lifecycle" NOT IN ('declared','building','backfilling','validating','enabled') OR
  b."cursor_codec_version" IS DISTINCT FROM 1 OR
  (b."backfill_cursor_row_id" IS NOT NULL AND
    (octet_length(b."backfill_cursor_row_id") <> 16 OR b."lifecycle" IN ('declared','building'))) OR
  b."attempt_fence" IS NULL OR b."attempt_fence" <= 0 OR
  b."created_at" IS NULL OR b."updated_at" IS NULL OR
  NOT isfinite(b."created_at") OR NOT isfinite(b."updated_at") OR
  abs(extract(epoch FROM b."created_at") * 1000) > 8640000000000000 OR
  abs(extract(epoch FROM b."updated_at") * 1000) > 8640000000000000 OR
  date_trunc('milliseconds', b."updated_at") < date_trunc('milliseconds', b."created_at") OR
  ((b."maintenance_activation_sequence" IS NULL) <> (m."activation_sequence" IS NULL))) OR (m."activation_sequence" IS NOT NULL AND (
  b."lifecycle" IS DISTINCT FROM 'enabled' OR
  m."activation_sequence" <= 0 OR
  m."authority_kind" IS DISTINCT FROM b."maintenance_authority_kind" OR
  m."authority_kind" NOT IN ('application','binding') OR
  (m."authority_kind"='application' AND m."candidate_sha256" IS NOT NULL) OR
  (m."authority_kind"='binding' AND octet_length(m."candidate_sha256") IS DISTINCT FROM 32) OR
  m."scope_id" IS DISTINCT FROM b."scope_id" OR
  m."index_definition_id" IS DISTINCT FROM b."index_definition_id" OR
  m."storage_generation" IS DISTINCT FROM b."storage_generation" OR
  m."storage_generation_fence" IS DISTINCT FROM b."storage_generation_fence" OR
  m."epoch" IS DISTINCT FROM b."epoch" OR
  m."attempt_fence" IS DISTINCT FROM b."attempt_fence" OR
  m."first_readable_commit_seq" IS NULL OR m."first_readable_commit_seq" < 0 OR
  m."opened_commit_seq" IS NULL OR m."opened_commit_seq" < m."first_readable_commit_seq" OR
  m."first_readable_commit_seq" IS DISTINCT FROM b."first_readable_commit_seq" OR
  m."opened_commit_seq" IS DISTINCT FROM b."covered_through_commit_seq" OR
  m."table_id" IS NULL OR m."table_id" < 1 OR
  m."deployment_id" IS NULL OR length(m."deployment_id") = 0 OR
  m."schema_version_id" IS NULL OR length(m."schema_version_id") = 0 OR
  octet_length(m."physical_spec_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."schema_manifest_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."activation_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."head_sha256") IS DISTINCT FROM 32)) THEN refusal := 'intrinsicIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
      intrinsic[i] := b; intrinsic_maintenance[i] := m;
    END LOOP;
  END LOOP; END IF;
  phase := 'developerBuild'; i := 1;
  IF NOT p_original_build_locks THEN PERFORM 1 FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope AND x."index_definition_id" = ANY(p_developer)
    ORDER BY x."index_definition_id" FOR SHARE; END IF;
  IF cardinality(p_developer) <> (SELECT count(DISTINCT value) FROM unnest(p_developer) value) THEN
    refusal := 'developerIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
  END IF;
  IF cardinality(p_developer) > 0 THEN FOR i IN 1..cardinality(p_developer) LOOP
    selected_id := p_developer[i];
    SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id" = p_scope AND x."index_definition_id" = selected_id;
    SELECT x.* INTO m FROM %1$I."fx_system_index_maintenance_obligation" x WHERE x."scope_id" = p_scope
      AND x."index_definition_id" = selected_id AND x."authority_kind" = b."maintenance_authority_kind" AND x."activation_sequence" = b."maintenance_activation_sequence";
    IF p_developer_access[i] IS DISTINCT FROM 'developer' OR (
  ((b."maintenance_authority_kind" IS NULL) <> (b."maintenance_activation_sequence" IS NULL)) OR
  (b."maintenance_authority_kind" IS NOT NULL AND b."maintenance_authority_kind" NOT IN ('application','binding')) OR
  b."scope_id" IS DISTINCT FROM p_scope OR
  b."index_definition_id" IS DISTINCT FROM selected_id OR
  b."storage_generation" IS DISTINCT FROM p_generation OR
  b."storage_generation_fence" IS DISTINCT FROM p_fence OR
  b."epoch" IS DISTINCT FROM p_epoch OR
  b."start_commit_seq" IS NULL OR b."start_commit_seq" < 0 OR
  b."start_commit_seq" > p_last OR
  (b."covered_through_commit_seq" IS NOT NULL AND
    (b."covered_through_commit_seq" < 0 OR b."covered_through_commit_seq" > p_last)) OR
  (b."first_readable_commit_seq" IS NOT NULL AND
    (b."first_readable_commit_seq" < 0 OR b."covered_through_commit_seq" IS NULL OR
      b."first_readable_commit_seq" > b."covered_through_commit_seq")) OR
  b."lifecycle" IS NULL OR
  b."lifecycle" NOT IN ('declared','building','backfilling','validating','enabled') OR
  b."cursor_codec_version" IS DISTINCT FROM 1 OR
  (b."backfill_cursor_row_id" IS NOT NULL AND
    (octet_length(b."backfill_cursor_row_id") <> 16 OR b."lifecycle" IN ('declared','building'))) OR
  b."attempt_fence" IS NULL OR b."attempt_fence" <= 0 OR
  b."created_at" IS NULL OR b."updated_at" IS NULL OR
  NOT isfinite(b."created_at") OR NOT isfinite(b."updated_at") OR
  abs(extract(epoch FROM b."created_at") * 1000) > 8640000000000000 OR
  abs(extract(epoch FROM b."updated_at") * 1000) > 8640000000000000 OR
  date_trunc('milliseconds', b."updated_at") < date_trunc('milliseconds', b."created_at") OR
  ((b."maintenance_activation_sequence" IS NULL) <> (m."activation_sequence" IS NULL))) OR (m."activation_sequence" IS NOT NULL AND (
  b."lifecycle" IS DISTINCT FROM 'enabled' OR
  m."activation_sequence" <= 0 OR
  m."authority_kind" IS DISTINCT FROM b."maintenance_authority_kind" OR
  m."authority_kind" NOT IN ('application','binding') OR
  (m."authority_kind"='application' AND m."candidate_sha256" IS NOT NULL) OR
  (m."authority_kind"='binding' AND octet_length(m."candidate_sha256") IS DISTINCT FROM 32) OR
  m."scope_id" IS DISTINCT FROM b."scope_id" OR
  m."index_definition_id" IS DISTINCT FROM b."index_definition_id" OR
  m."storage_generation" IS DISTINCT FROM b."storage_generation" OR
  m."storage_generation_fence" IS DISTINCT FROM b."storage_generation_fence" OR
  m."epoch" IS DISTINCT FROM b."epoch" OR
  m."attempt_fence" IS DISTINCT FROM b."attempt_fence" OR
  m."first_readable_commit_seq" IS NULL OR m."first_readable_commit_seq" < 0 OR
  m."opened_commit_seq" IS NULL OR m."opened_commit_seq" < m."first_readable_commit_seq" OR
  m."first_readable_commit_seq" IS DISTINCT FROM b."first_readable_commit_seq" OR
  m."opened_commit_seq" IS DISTINCT FROM b."covered_through_commit_seq" OR
  m."table_id" IS NULL OR m."table_id" < 1 OR
  m."deployment_id" IS NULL OR length(m."deployment_id") = 0 OR
  m."schema_version_id" IS NULL OR length(m."schema_version_id") = 0 OR
  octet_length(m."physical_spec_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."schema_manifest_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."activation_sha256") IS DISTINCT FROM 32 OR
  octet_length(m."head_sha256") IS DISTINCT FROM 32)) THEN refusal := 'developerIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    developer[i] := b; developer_maintenance[i] := m;
  END LOOP; END IF;
  phase := 'point'; actual_sequence := NULL;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    SELECT c."commit_seq" AS pointer, row(r."scope_uuid", r."table_id", r."row_id", r."commit_seq", r."prev_commit_seq", r."write_epoch_uuid", r."schema_version_id", r."creation_time", r."value_codec_version", r."is_tombstone", NULL::bytea, r."value_sha256")::%1$I."fx_app_row_rev" AS revision, octet_length(r.value_bytes) AS byte_length INTO captured
      FROM (VALUES (1)) request(dummy) LEFT JOIN %1$I."fx_app_row_current" c ON c."scope_uuid" = p_scope_uuid
        AND c."table_id" = p_point_tables[i] AND c."row_id" = p_point_ids[i]
      LEFT JOIN LATERAL (SELECT x.* FROM %1$I."fx_app_row_rev" x WHERE x."scope_uuid" = p_scope_uuid
        AND x."table_id" = p_point_tables[i] AND x."row_id" = p_point_ids[i]
        ORDER BY x."commit_seq" DESC LIMIT 1) r ON true;
    pointer_seq := captured.pointer; latest := captured.revision;
    original_lengths[i] := captured.byte_length;
    heads[i] := latest; pointers[i] := pointer_seq;
    IF pointer_seq IS DISTINCT FROM latest."commit_seq" OR
      (latest."commit_seq" IS NOT NULL AND (latest."commit_seq" <= 0 OR latest."commit_seq" > p_last OR
        latest."is_tombstone" IS NULL OR latest."creation_time" IS NULL OR
        latest."creation_time" <= 0 OR latest."creation_time" > 9007199254740991)) THEN
      refusal := 'rowHeadInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
    END IF;
  END LOOP; END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_point_snapshots[i] IS NULL OR p_point_snapshots[i] < 0 OR p_point_snapshots[i] > p_last OR
      p_point_kinds[i] IS NULL OR p_point_kinds[i] NOT IN ('present','tombstone','noVisibleRevision','generatedInsertion','noVisibleRevisionInsertion') OR
      (p_point_kinds[i] IN ('present','tombstone') AND (p_point_sequences[i] IS NULL OR p_point_sequences[i] <= 0 OR p_point_sequences[i] > p_point_snapshots[i])) OR
      (p_point_kinds[i] IN ('noVisibleRevision','generatedInsertion','noVisibleRevisionInsertion') AND p_point_sequences[i] IS NOT NULL) THEN
      refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
    END IF;
    IF p_point_kinds[i] = 'generatedInsertion' THEN CONTINUE; END IF;
    IF latest."commit_seq" > p_point_snapshots[i] THEN
      IF actual_sequence IS NULL THEN actual_sequence := latest."commit_seq"; first_point_conflict := i; END IF;
    ELSIF (p_point_kinds[i] = 'present' AND (latest."is_tombstone" IS DISTINCT FROM false OR latest."commit_seq" IS DISTINCT FROM p_point_sequences[i])) OR
      (p_point_kinds[i] = 'tombstone' AND (latest."is_tombstone" IS DISTINCT FROM true OR latest."commit_seq" IS DISTINCT FROM p_point_sequences[i])) OR
      (p_point_kinds[i] IN ('noVisibleRevision','noVisibleRevisionInsertion') AND latest."commit_seq" IS NOT NULL) THEN
      refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
    END IF;
  END LOOP; END IF;
  IF actual_sequence IS NOT NULL THEN i := first_point_conflict; refusal := 'pointConflict'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_point_kinds[i] IN ('generatedInsertion','noVisibleRevisionInsertion') AND latest."commit_seq" IS NOT NULL THEN
      refusal := 'generatedInsertionConflict'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text;
    END IF;
  END LOOP; END IF;
  phase := 'range'; actual_sequence := NULL;
  IF cardinality(p_range_indexes) > 0 AND (p_snapshot < p_oldest OR p_last > p_snapshot + 128) THEN i := 1; refusal := 'rangeWindowExceeded'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
  IF cardinality(p_range_indexes) > 0 AND p_last > p_snapshot THEN FOR i IN 1..cardinality(p_range_indexes) LOOP
    SELECT x.* INTO range_row FROM %1$I."fx_app_index_entry_rev" x WHERE x."scope_uuid" = p_scope_uuid
      AND x."index_definition_id" = p_range_indexes[i] AND x."commit_seq" > p_snapshot AND x."commit_seq" <= p_last
      AND (p_range_lower[i] IS NULL OR x."encoded_key" >= p_range_lower[i])
      AND (p_range_upper_kinds[i] = 'unbounded' OR (p_range_upper_kinds[i] = 'key' AND x."encoded_key" < p_range_upper[i]) OR
        (p_range_upper_kinds[i] = 'position' AND (x."encoded_key" < p_range_upper[i] OR
          (x."encoded_key" = p_range_upper[i] AND x."row_id" <= p_range_upper_ids[i]))))
      ORDER BY x."commit_seq", x."encoded_key", x."row_id" LIMIT 1;
    IF FOUND THEN
      IF range_row."table_id" IS DISTINCT FROM p_range_tables[i] OR range_row."key_codec_version" IS DISTINCT FROM 1 OR
        range_row."physical_spec_sha256" IS DISTINCT FROM p_range_specs[i] OR octet_length(range_row."row_id") IS DISTINCT FROM 16 OR
        octet_length(range_row."encoded_key") NOT BETWEEN 1 AND 2048 THEN refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
      RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('phase', phase, 'reason', 'rangeConflict', 'ordinal', i-1,
        'actualSequence', range_row."commit_seq"::text, 'encodedKey', encode(range_row."encoded_key", 'hex'),
        'rowId', encode(range_row."row_id", 'hex'))::text;
    END IF;
  END LOOP; END IF;
  phase := 'relation';
  IF cardinality(p_relation_ids) > 0 THEN FOR i IN 1..cardinality(p_relation_ids) LOOP
    SELECT x."last_changed_commit_seq" INTO version FROM %1$I."fx_app_edge_adjacency_version" x WHERE x."scope_uuid" = p_scope_uuid
      AND x."edge_definition_id" = p_relation_indexes[i] AND x."direction" = 'incoming'
      AND x."endpoint_row_id" = p_relation_ids[i];
    IF FOUND AND (version IS NULL OR version <= 0) THEN refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    version := coalesce(version,0);
    IF version < p_relation_versions[i] OR version > p_last OR (version <> p_relation_versions[i] AND version <= p_snapshot) THEN refusal := 'occEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    IF version <> p_relation_versions[i] THEN actual_sequence := version; refusal := 'relationConflict'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
  END LOOP; END IF;
  phase := 'deadline'; i := 1; actual_sequence := NULL;
  database_now := to_timestamp(trunc(extract(epoch from clock_timestamp()) * 1000) / 1000);
  IF p_deadline <= database_now THEN kind := 'expired'; RETURN NEXT; RETURN; END IF;
  IF p_capture_snapshot THEN
    SELECT * INTO coverage FROM %1$I.fx_begin_app_materialization(p_scope, p_deadline, true);
    IF coverage.reason = 'expired' THEN kind := 'expired'; RETURN NEXT; RETURN; END IF;
    application_head := coverage.application_head; application_activation := coverage.application_activation;
    legacy_schema := coverage.legacy_schema; relation_schema := coverage.relation_schema;
  END IF;
  phase := 'original';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_point_ids) > 0 THEN FOR i IN 1..cardinality(p_point_ids) LOOP
    latest := heads[i];
    IF p_changed[i] AND p_need_original[i] AND p_point_kinds[i] = 'present' AND p_original_sequences[i] IS NULL THEN refusal := 'priorDocumentInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    IF p_changed[i] AND p_need_original[i] AND latest."commit_seq" IS NOT NULL AND NOT latest."is_tombstone" THEN
      IF latest."commit_seq" IS DISTINCT FROM p_original_sequences[i] OR
        latest."creation_time" IS DISTINCT FROM p_original_times[i] OR
        latest."scope_uuid" IS DISTINCT FROM p_original_scopes[i] OR
        latest."write_epoch_uuid" IS DISTINCT FROM p_original_epochs[i] OR
        latest."prev_commit_seq" IS DISTINCT FROM p_original_previous[i] OR
        latest."schema_version_id" IS DISTINCT FROM p_original_schemas[i] OR
        latest."value_codec_version" IS DISTINCT FROM 1 OR
        original_lengths[i] IS DISTINCT FROM p_original_lengths[i] OR
        latest."value_sha256" IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
      SELECT x.* INTO original FROM %1$I."fx_app_row_rev" x WHERE x."scope_uuid" = p_scope_uuid
        AND x."table_id" = p_point_tables[i] AND x."row_id" = p_point_ids[i]
        AND x."commit_seq" = latest."commit_seq"
        AND octet_length(x."value_bytes") = p_original_lengths[i];
      IF NOT FOUND OR octet_length(original."value_bytes") IS DISTINCT FROM p_original_lengths[i] OR
        original."value_codec_version" IS DISTINCT FROM 1 OR
        original."value_sha256" IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
      IF pg_catalog.sha256(original."value_bytes") IS DISTINCT FROM p_original_digests[i] THEN refusal := 'priorDocumentInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    END IF;
  END LOOP; END IF;
  phase := 'developerTransition';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_indexes) > 0 THEN FOR i IN 1..cardinality(p_indexes) LOOP
    SELECT x.* INTO b FROM unnest(developer) x WHERE x."index_definition_id" = p_indexes[i];
    IF NOT FOUND THEN refusal := 'developerIndexBuildInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    attempts[i] := b."attempt_fence"; epochs[i] := b."epoch"; fences[i] := b."storage_generation_fence";
  END LOOP; END IF;
  FOR transition IN SELECT * FROM %1$I.fx_accept_app_index_transitions(p_scope, p_scope_uuid, p_indexes, p_access, p_tables, p_codecs,
    p_specs, p_ids, p_previous, p_previous_sha, p_final, p_final_sha, p_row_previous, attempts, epochs, fences, p_maximum) LOOP
    kind := 'transition'; transition_reason := transition.reason; pair_ordinal := transition.pair_ordinal; key_ordinal := transition.key_ordinal;
    transition_kind := transition.transition_kind; prior_commit_seq := transition.prior_commit_seq; prior_is_tombstone := transition.prior_is_tombstone;
    emitted_count := transition.emitted_count; RETURN NEXT;
  END LOOP;
  transition_reason := NULL; pair_ordinal := NULL; key_ordinal := NULL; transition_kind := NULL; prior_commit_seq := NULL; prior_is_tombstone := NULL; emitted_count := NULL;
  phase := 'uniqueOwner';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  SELECT owners INTO accepted_unique_owners FROM %1$I.fx_accept_app_unique_owners(p_unique_owners, p_unique_previous, p_unique_row_previous);
  IF p_stop = 'afterUniqueOwner' THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  phase := 'relationTarget';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_target_ids) > 0 THEN FOR i IN 1..cardinality(p_target_ids) LOOP
    SELECT c."commit_seq" AS pointer, row(r."scope_uuid", r."table_id", r."row_id", r."commit_seq", r."prev_commit_seq", r."write_epoch_uuid", r."schema_version_id", r."creation_time", r."value_codec_version", r."is_tombstone", NULL::bytea, r."value_sha256")::%1$I."fx_app_row_rev" AS revision INTO captured
      FROM (VALUES (1)) request(dummy) LEFT JOIN %1$I."fx_app_row_current" c ON c."scope_uuid" = p_scope_uuid
        AND c."table_id" = p_target_tables[i] AND c."row_id" = p_target_ids[i]
      LEFT JOIN %1$I."fx_app_row_rev" r ON r."scope_uuid" = p_scope_uuid AND r."table_id" = p_target_tables[i]
        AND r."row_id" = p_target_ids[i] AND r."commit_seq" = c."commit_seq";
    pointer_seq := captured.pointer; target := captured.revision;
    IF pointer_seq IS NULL AND target."commit_seq" IS NULL AND target."is_tombstone" IS NULL THEN refusal := 'relationTargetMissing'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    IF pointer_seq IS NULL OR target."commit_seq" IS NULL OR pointer_seq <> target."commit_seq" OR
      target."commit_seq" > p_last OR target."is_tombstone" IS NULL THEN refusal := 'relationTargetEvidenceInvalid'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
    IF target."is_tombstone" THEN refusal := 'relationTargetMissing'; RAISE EXCEPTION 'fx_accept_app_publication' USING ERRCODE = 'FX001', DETAIL =
  jsonb_build_object('phase', phase, 'reason', refusal, 'ordinal', i - 1, 'actualSequence', actual_sequence::text)::text; END IF;
  END LOOP; END IF;
  phase := 'candidate';
  IF p_stop = phase THEN kind := 'stopped'; RETURN NEXT; RETURN; END IF;
  IF p_candidate THEN SELECT x.* INTO candidate_head FROM %1$I."fx_system_app_schema_candidate_validation" x
    WHERE x."scope_id" = p_scope FOR UPDATE; END IF;
  IF cardinality(heads) > 0 THEN FOR i IN 1..cardinality(heads) LOOP
    kind := 'head'; ordinal := i-1; latest := heads[i]; pointer_sequence := pointers[i]; latest_sequence := latest."commit_seq";
    latest_tombstone := latest."is_tombstone"; latest_creation_time := latest."creation_time"; RETURN NEXT;
  END LOOP; END IF;
  ordinal := NULL; pointer_sequence := NULL; latest_sequence := NULL; latest_tombstone := NULL; latest_creation_time := NULL;
  IF cardinality(developer)>0 THEN FOR i IN 1..cardinality(developer) LOOP
    b:=developer[i];
    IF b."lifecycle"='validating' THEN
      kind:='developerValidation'; ordinal:=i-1;
      validation_definition:=b."index_definition_id"; validation_attempt:=b."attempt_fence";
      validation_epoch:=b."epoch"; validation_fence:=b."storage_generation_fence";
      RETURN NEXT;
    END IF;
  END LOOP; END IF;
  ordinal:=NULL; validation_definition:=NULL; validation_attempt:=NULL; validation_epoch:=NULL; validation_fence:=NULL;
  kind := 'accepted'; RETURN NEXT;
END;
$publication_acceptance$;$ddl$,target_schema);
  EXECUTE format($ddl$
CREATE OR REPLACE FUNCTION %1$I.fx_apply_app_publication("p_scope" text, "p_generation" text, "p_fence" bigint, "p_epoch" text, "p_last" bigint, "p_deployment" text, "p_schema" text, "p_mixed" boolean, "p_source_bound" boolean, "p_active" boolean, "p_active_deployment" text, "p_active_schema" text, "p_active_manifest" bytea, "p_active_sequence" bigint, "p_active_activation" bytea, "p_active_head" bytea, "p_build_ids" integer[], "p_build_tables" integer[], "p_build_specs" bytea[], "p_build_active" boolean[], "p_build_schemas" text[], "p_unique_ids" integer[], "p_unique_tables" integer[], "p_unique_specs" bytea[], "p_unique_active" boolean[], "p_unique_schemas" text[], "p_unique_deployments" text[], "p_defer" boolean, "p_intrinsic_indexes" integer[], "p_intrinsic_access" text[], "p_intrinsic_tables" integer[], "p_intrinsic_codecs" integer[], "p_intrinsic_specs" bytea[], "p_intrinsic_ids" bytea[], "p_intrinsic_previous" bytea[], "p_intrinsic_previous_sha" bytea[], "p_intrinsic_final" bytea[], "p_intrinsic_final_sha" bytea[], "p_intrinsic_row_previous" bigint[], "p_stop" text, "p_rows" %1$I.fx_app_row_write[], "p_row_pages" integer[], "p_indexes" %1$I.fx_app_index_write[], "p_index_prior" bigint[], "p_index_historical" boolean[], "p_unique_owners" %1$I.fx_app_unique_owner[], "p_unique_previous" %1$I.fx_app_unique_write[], "p_unique_next" %1$I.fx_app_unique_write[], "p_validation" %1$I.fx_app_index_coverage[], "p_index_coverage" %1$I.fx_app_index_coverage[], "p_unique_coverage" %1$I.fx_app_unique_coverage[], "p_seq" bigint, "p_search_scope" uuid, "p_search_tables" integer[], "p_search_indexes" integer[], "p_search_sources" text[], "p_search_modes" boolean[], "p_search_row_counts" integer[], "p_search_ids" bytea[], "p_search_text_counts" integer[], "p_search_text" %1$I.fx_app_search_write[], "p_search_json_counts" integer[], "p_search_json" %1$I.fx_app_json_write[])
RETURNS TABLE("kind" text, "coverage_ordinal" integer, "coverage_definition" integer, "coverage_attempt" bigint, "coverage_epoch" text, "coverage_fence" bigint, "reason" text, "row_count" integer, "index_count" integer, "unique_count" integer, "validation_count" integer, "coverage_count" integer, "search_count" integer, "search_build_count" integer, "intrinsic_count" integer, "intrinsic_live_count" integer, "intrinsic_tombstone_count" integer, "intrinsic_key_bytes" integer, "index_coverage_count" integer, "unique_coverage_count" integer)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $publication_application$
DECLARE i integer:=1; k integer; row_ordinal integer; phase text:='uniqueCoverage'; refusal text; frontier bigint; t record; proof record;
  binding_selection record; binding_selected boolean:=false;
  inner_message text; inner_detail text; intrinsic_transitions jsonb:='[]'::jsonb;
  u %1$I."fx_system_unique_constraint_build"; um %1$I."fx_system_unique_maintenance_obligation"; b %1$I."fx_system_index_build_state"; m %1$I."fx_system_index_maintenance_obligation";
  indices %1$I.fx_app_index_write[]:=ARRAY[]::%1$I.fx_app_index_write[];
  priors bigint[]:=ARRAY[]::bigint[]; historical boolean[]:=ARRAY[]::boolean[];
  validations %1$I.fx_app_index_coverage[]:=ARRAY[]::%1$I.fx_app_index_coverage[];
  index_coverage %1$I.fx_app_index_coverage[]:=ARRAY[]::%1$I.fx_app_index_coverage[];
  unique_coverage %1$I.fx_app_unique_coverage[]:=ARRAY[]::%1$I.fx_app_unique_coverage[];
  attempts bigint[]:=ARRAY[]::bigint[]; epochs text[]:=ARRAY[]::text[]; fences bigint[]:=ARRAY[]::bigint[];
BEGIN
  SELECT * INTO binding_selection FROM (WITH selected AS MATERIALIZED (SELECT bh.*, ba.sha256 AS selected_activation_sha256,
      ba.canonical_bytes AS activation_bytes, ba.request_id AS selected_request_id, bc.canonical_bytes AS candidate_bytes,
      bc.sha256 AS selected_candidate_sha256 FROM %1$I.fx_system_data_binding_head bh
    JOIN %1$I.fx_system_data_binding_activation ba ON ba.scope_id=bh.scope_id
      AND ba.storage_generation=bh.storage_generation AND ba.sequence=bh.sequence
      AND ba.sha256=bh.activation_sha256 AND ba.candidate_sha256=bh.candidate_sha256
    JOIN %1$I.fx_system_data_binding_candidate bc ON bc.scope_id=bh.scope_id
      AND bc.storage_generation=bh.storage_generation AND bc.sha256=bh.candidate_sha256
    WHERE bh.scope_id=p_scope AND bh.storage_generation=p_generation
      AND octet_length(bh.canonical_bytes)=bh.canonical_byte_length AND bh.canonical_byte_length BETWEEN 1 AND 1048576
      AND octet_length(ba.canonical_bytes)=ba.canonical_byte_length AND ba.canonical_byte_length BETWEEN 1 AND 1048576
      AND octet_length(bc.canonical_bytes)=bc.canonical_byte_length AND bc.canonical_byte_length BETWEEN 1 AND 1048576
      AND pg_catalog.sha256(bh.canonical_bytes)=decode(bh.sha256,'hex')
      AND pg_catalog.sha256(ba.canonical_bytes)=decode(ba.sha256,'hex')
      AND pg_catalog.sha256(bc.canonical_bytes)=decode(bc.sha256,'hex')),
    frames AS MATERIALIZED (SELECT selected.*,
      pg_catalog.convert_from(canonical_bytes,'UTF8')::jsonb AS head_frame,
      pg_catalog.convert_from(activation_bytes,'UTF8')::jsonb AS activation_frame,
      pg_catalog.convert_from(candidate_bytes,'UTF8')::jsonb AS candidate_frame FROM selected)
    SELECT candidate_frame->'application'->>'deploymentId' AS deployment_id,
      candidate_frame->'logicalSchema'->>'schemaVersionId' AS schema_version_id,
      decode(candidate_frame->'logicalSchema'->>'manifestSha256','hex') AS schema_manifest_sha256,
      sequence AS activation_sequence,decode(sha256,'hex') AS head_sha256,
      decode(selected_activation_sha256,'hex') AS activation_sha256,
      decode(selected_candidate_sha256,'hex') AS candidate_sha256 FROM frames
    WHERE head_frame->>'format'='flarex.data-binding-head' AND head_frame->>'version'='2'
      AND head_frame->>'scopeId'=scope_id AND head_frame->>'storageGeneration'=storage_generation
      AND head_frame->>'sequence'=sequence::text AND head_frame->>'candidateSha256'=candidate_sha256
      AND head_frame->>'activationSha256'=selected_activation_sha256
      AND activation_frame->>'format'='flarex.data-binding-activation' AND activation_frame->>'version' IN ('2','3')
      AND activation_frame->>'sequence'=sequence::text AND activation_frame->'request'->>'scopeId'=scope_id
      AND activation_frame->'request'->>'format'='flarex.data-binding-activation-request'
      AND activation_frame->'request'->>'version'='1' AND activation_frame->'request'->>'requestId'=selected_request_id
      AND activation_frame->'request'->>'storageGeneration'=storage_generation
      AND activation_frame->'request'->>'candidateSha256'=candidate_sha256
      AND candidate_frame->>'format'='flarex.data-binding-set' AND candidate_frame->'logicalSchema' IS NOT NULL
      AND candidate_frame->'logicalSchema' <> 'null'::jsonb) selected_binding;
  binding_selected:=FOUND;
  -- Every bound-table write retains the complete installed maintenance set,
  -- including unchanged keys. Transition action IDs are not a closure witness.
  IF binding_selected THEN
    IF EXISTS (SELECT 1 FROM %1$I."fx_system_index_maintenance_obligation" required_index
      LEFT JOIN %1$I."fx_system_index_build_state" current_build ON current_build.scope_id=required_index.scope_id
        AND current_build.index_definition_id=required_index.index_definition_id
      WHERE required_index.scope_id=p_scope AND required_index.authority_kind='binding'
        AND required_index.activation_sequence=binding_selection.activation_sequence
        AND required_index.table_id IN (SELECT written.table_id FROM unnest(p_rows) written)
        AND (binding_selection.activation_sequence=required_index.activation_sequence
    AND binding_selection.head_sha256=required_index.head_sha256 AND binding_selection.activation_sha256=required_index.activation_sha256
    AND binding_selection.candidate_sha256=required_index.candidate_sha256 AND binding_selection.deployment_id=required_index.deployment_id
    AND binding_selection.schema_version_id=required_index.schema_version_id AND binding_selection.schema_manifest_sha256=required_index.schema_manifest_sha256) IS TRUE
        AND (NOT required_index.index_definition_id=ANY(p_build_ids)
          OR current_build.maintenance_authority_kind IS DISTINCT FROM 'binding'
          OR current_build.maintenance_activation_sequence IS DISTINCT FROM required_index.activation_sequence)) THEN
      phase:='indexCoverage'; refusal:='indexCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;
    END IF;
    IF EXISTS (SELECT 1 FROM %1$I."fx_system_unique_maintenance_obligation" required_unique
      LEFT JOIN %1$I."fx_system_unique_constraint_build" current_build ON current_build.scope_id=required_unique.scope_id
        AND current_build.unique_constraint_definition_id=required_unique.unique_constraint_definition_id
      WHERE required_unique.scope_id=p_scope AND required_unique.authority_kind='binding'
        AND required_unique.activation_sequence=binding_selection.activation_sequence
        AND required_unique.table_id IN (SELECT written.table_id FROM unnest(p_rows) written)
        AND (binding_selection.activation_sequence=required_unique.activation_sequence
    AND binding_selection.head_sha256=required_unique.head_sha256 AND binding_selection.activation_sha256=required_unique.activation_sha256
    AND binding_selection.candidate_sha256=required_unique.candidate_sha256 AND binding_selection.deployment_id=required_unique.deployment_id
    AND binding_selection.schema_version_id=required_unique.schema_version_id AND binding_selection.schema_manifest_sha256=required_unique.schema_manifest_sha256) IS TRUE
        AND (NOT required_unique.unique_constraint_definition_id=ANY(p_unique_ids)
          OR current_build.maintenance_authority_kind IS DISTINCT FROM 'binding'
          OR current_build.maintenance_activation_sequence IS DISTINCT FROM required_unique.activation_sequence)) THEN
      phase:='uniqueCoverage'; refusal:='uniqueCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;
    END IF;
  END IF;
  IF cardinality(p_unique_ids)>0 THEN
    IF p_source_bound THEN
      PERFORM 1 FROM %1$I."fx_system_unique_constraint_build" x WHERE x."scope_id"=p_scope AND x."unique_constraint_definition_id"=ANY(p_unique_ids)
        ORDER BY x."unique_constraint_definition_id" FOR NO KEY UPDATE;
    ELSIF NOT p_active THEN
      PERFORM 1 FROM %1$I."fx_system_unique_constraint_build" x WHERE x."scope_id"=p_scope AND x."unique_constraint_definition_id"=ANY(p_unique_ids)
        ORDER BY x."unique_constraint_definition_id" FOR UPDATE;
    ELSE
      PERFORM 1 FROM %1$I."fx_system_unique_constraint_build" x WHERE x."scope_id"=p_scope AND x."unique_constraint_definition_id"=ANY(p_unique_ids)
        ORDER BY x."unique_constraint_definition_id" FOR SHARE;
    END IF;
    FOR i IN 1..cardinality(p_unique_ids) LOOP
      SELECT x.* INTO u FROM %1$I."fx_system_unique_constraint_build" x WHERE x."scope_id"=p_scope AND x."unique_constraint_definition_id"=p_unique_ids[i];
      SELECT x.* INTO um FROM %1$I."fx_system_unique_maintenance_obligation" x WHERE x."scope_id"=p_scope
        AND x."unique_constraint_definition_id"=p_unique_ids[i] AND x."authority_kind"=u."maintenance_authority_kind" AND x."activation_sequence"=u."maintenance_activation_sequence";
      IF u."scope_id" IS DISTINCT FROM p_scope OR u."unique_constraint_definition_id" IS DISTINCT FROM p_unique_ids[i] OR
        u."storage_generation" IS DISTINCT FROM p_generation OR u."storage_generation_fence" IS DISTINCT FROM p_fence OR
        u."epoch" IS DISTINCT FROM p_epoch OR u."lifecycle" IS DISTINCT FROM 'enabled' OR
        u."cursor_row_id" IS NOT NULL OR u."start_commit_seq" IS NULL OR u."start_commit_seq"<0 OR
        u."covered_through_commit_seq" IS NULL OR u."covered_through_commit_seq"<u."start_commit_seq" OR
        u."covered_through_commit_seq">p_last OR u."start_commit_seq">p_last OR
        u."attempt_fence" IS NULL OR u."attempt_fence"<=0 OR
        u."created_at" IS NULL OR u."updated_at" IS NULL OR
        NOT isfinite(u."created_at") OR NOT isfinite(u."updated_at") OR
        abs(extract(epoch FROM u."created_at")*1000)>8640000000000000 OR abs(extract(epoch FROM u."updated_at")*1000)>8640000000000000 OR
        date_trunc('milliseconds',u."updated_at")<date_trunc('milliseconds',u."created_at") OR
        ((u."maintenance_authority_kind" IS NULL)<>(u."maintenance_activation_sequence" IS NULL)) OR
        (u."maintenance_authority_kind" IS NOT NULL AND u."maintenance_authority_kind" NOT IN ('application','binding')) OR
        ((u."maintenance_activation_sequence" IS NULL)<>(um."activation_sequence" IS NULL)) THEN
        refusal:='uniqueBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;
      END IF;
      IF (p_unique_active[i] AND p_active AND um."activation_sequence" IS NULL) OR
        (p_mixed AND p_unique_active[i] AND NOT p_active) OR
        (binding_selected AND binding_selection.schema_version_id=p_unique_schemas[i] AND NOT p_unique_active[i] AND um."activation_sequence" IS NULL) THEN refusal:='uniqueCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
      IF um."activation_sequence" IS NOT NULL THEN
        IF um."authority_kind" IS DISTINCT FROM u."maintenance_authority_kind" OR
          um."authority_kind" NOT IN ('application','binding') OR
          (um."authority_kind"='application' AND (um."candidate_sha256" IS NOT NULL OR um."schema_manifest_sha256" IS NOT NULL)) OR
          (um."authority_kind"='binding' AND (octet_length(um."candidate_sha256") IS DISTINCT FROM 32 OR octet_length(um."schema_manifest_sha256") IS DISTINCT FROM 32)) OR
          um."activation_sequence"<=0 OR um."scope_id" IS DISTINCT FROM p_scope OR
          um."unique_constraint_definition_id" IS DISTINCT FROM p_unique_ids[i] OR
          um."storage_generation" IS DISTINCT FROM p_generation OR um."storage_generation_fence" IS DISTINCT FROM p_fence OR
          um."epoch" IS DISTINCT FROM p_epoch OR um."attempt_fence" IS DISTINCT FROM u."attempt_fence" OR
          um."start_commit_seq" IS DISTINCT FROM u."start_commit_seq" OR
          um."opened_commit_seq" IS DISTINCT FROM u."covered_through_commit_seq" OR
          um."table_id" IS DISTINCT FROM p_unique_tables[i] OR um."physical_spec_sha256" IS DISTINCT FROM p_unique_specs[i] OR
          um."deployment_id" IS DISTINCT FROM p_unique_deployments[i] OR
          (um."authority_kind"='binding' AND um."schema_version_id" IS DISTINCT FROM p_unique_schemas[i]) OR
          (um."authority_kind"='binding' AND (binding_selection.activation_sequence=um.activation_sequence
    AND binding_selection.head_sha256=um.head_sha256 AND binding_selection.activation_sha256=um.activation_sha256
    AND binding_selection.candidate_sha256=um.candidate_sha256 AND binding_selection.deployment_id=um.deployment_id
    AND binding_selection.schema_version_id=um.schema_version_id AND binding_selection.schema_manifest_sha256=um.schema_manifest_sha256) IS NOT TRUE) OR
          (um."authority_kind"='application' AND (
          NOT p_active OR um."deployment_id" IS DISTINCT FROM p_active_deployment OR
          um."schema_version_id" IS DISTINCT FROM p_active_schema OR
          um."activation_sequence" IS DISTINCT FROM p_active_sequence OR
          um."activation_sha256" IS DISTINCT FROM p_active_activation OR um."head_sha256" IS DISTINCT FROM p_active_head)) THEN
          refusal:='uniqueBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;
        END IF;
      ELSIF u."covered_through_commit_seq"<p_last THEN
        SELECT x."commit_seq" INTO frontier FROM %1$I."fx_app_row_current" x WHERE x."scope_uuid"=p_search_scope AND x."table_id"=p_unique_tables[i]
          ORDER BY x."commit_seq" DESC LIMIT 1;
        IF FOUND AND (frontier IS NULL OR frontier<=0) THEN refusal:='uniqueBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        IF frontier>u."covered_through_commit_seq" THEN refusal:='uniqueCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        IF p_defer AND NOT p_unique_active[i] THEN
          PERFORM * FROM %1$I.fx_advance_app_coverage(ARRAY[]::%1$I.fx_app_index_coverage[],ARRAY[row(
  u."scope_id", u."unique_constraint_definition_id",
  u."attempt_fence", u."epoch", u."storage_generation_fence")::%1$I.fx_app_unique_coverage],p_last,NULL,false,
            ARRAY[]::%1$I.fx_app_index_coverage[],ARRAY[]::%1$I.fx_app_unique_coverage[],ARRAY[]::text[],ARRAY[]::text[]);
        END IF;
      END IF;
      IF um."activation_sequence" IS NULL THEN unique_coverage:=array_append(unique_coverage,row(
  u."scope_id", u."unique_constraint_definition_id",
  u."attempt_fence", u."epoch", u."storage_generation_fence")::%1$I.fx_app_unique_coverage); END IF;
    END LOOP;
  END IF;
  phase:='indexCoverage';
  IF cardinality(p_build_ids)>0 THEN FOR i IN 1..cardinality(p_build_ids) LOOP
    SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id"=p_scope AND x."index_definition_id"=p_build_ids[i];
    SELECT x.* INTO m FROM %1$I."fx_system_index_maintenance_obligation" x WHERE x."scope_id"=p_scope AND x."index_definition_id"=p_build_ids[i]
      AND x."authority_kind"=b."maintenance_authority_kind" AND x."activation_sequence"=b."maintenance_activation_sequence";
    IF (p_build_active[i] AND p_active AND (b."lifecycle" IS DISTINCT FROM 'enabled' OR m."activation_sequence" IS NULL)) OR
      (NOT p_build_active[i] AND b."lifecycle" IS DISTINCT FROM 'enabled') OR
      (p_mixed AND p_build_active[i] AND NOT p_active) OR
      (binding_selected AND binding_selection.schema_version_id=p_build_schemas[i] AND NOT p_build_active[i] AND m."activation_sequence" IS NULL) THEN refusal:='indexCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
    IF m."activation_sequence" IS NOT NULL THEN
      IF (m."authority_kind"='binding' AND m."schema_version_id" IS DISTINCT FROM p_build_schemas[i]) OR
        m."deployment_id" IS DISTINCT FROM p_deployment OR m."physical_spec_sha256" IS DISTINCT FROM p_build_specs[i] THEN
        refusal:='indexBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text;
      END IF;
    END IF;
    IF b."lifecycle"='enabled' THEN
      IF b."covered_through_commit_seq" IS NULL OR b."first_readable_commit_seq" IS NULL OR b."first_readable_commit_seq">p_last THEN
        refusal:='indexCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
      IF m."activation_sequence" IS NOT NULL THEN
        IF m."table_id" IS DISTINCT FROM p_build_tables[i] OR
          (m."authority_kind"='binding' AND (binding_selection.activation_sequence=m.activation_sequence
    AND binding_selection.head_sha256=m.head_sha256 AND binding_selection.activation_sha256=m.activation_sha256
    AND binding_selection.candidate_sha256=m.candidate_sha256 AND binding_selection.deployment_id=m.deployment_id
    AND binding_selection.schema_version_id=m.schema_version_id AND binding_selection.schema_manifest_sha256=m.schema_manifest_sha256) IS NOT TRUE) OR
          (m."authority_kind"='application' AND (NOT p_active OR
          m."deployment_id" IS DISTINCT FROM p_active_deployment OR m."schema_version_id" IS DISTINCT FROM p_active_schema OR
          m."schema_manifest_sha256" IS DISTINCT FROM p_active_manifest OR m."activation_sequence" IS DISTINCT FROM p_active_sequence OR
          m."activation_sha256" IS DISTINCT FROM p_active_activation OR m."head_sha256" IS DISTINCT FROM p_active_head)) THEN
          refusal:='indexBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
      ELSIF b."covered_through_commit_seq"<p_last THEN
        SELECT x."commit_seq" INTO frontier FROM %1$I."fx_app_row_current" x WHERE x."scope_uuid"=p_search_scope AND x."table_id"=p_build_tables[i]
          ORDER BY x."commit_seq" DESC LIMIT 1;
        IF FOUND AND (frontier IS NULL OR frontier<=0) THEN refusal:='indexBuildInvalid'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        IF frontier>b."covered_through_commit_seq" THEN refusal:='indexCoverageMissing'; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        IF p_defer AND NOT p_build_active[i] THEN
          PERFORM * FROM %1$I.fx_advance_app_coverage(ARRAY[row(
  b."scope_id", b."index_definition_id",
  b."attempt_fence", b."epoch", b."storage_generation_fence")::%1$I.fx_app_index_coverage],ARRAY[]::%1$I.fx_app_unique_coverage[],p_last,b."covered_through_commit_seq",true,
            ARRAY[]::%1$I.fx_app_index_coverage[],ARRAY[]::%1$I.fx_app_unique_coverage[],ARRAY[]::text[],ARRAY[]::text[]);
        END IF;
      END IF;
      IF m."activation_sequence" IS NULL THEN index_coverage:=array_append(index_coverage,row(
  b."scope_id", b."index_definition_id",
  b."attempt_fence", b."epoch", b."storage_generation_fence")::%1$I.fx_app_index_coverage); END IF;
    ELSIF b."lifecycle"='validating' AND p_build_ids[i]=ANY(p_intrinsic_indexes) THEN
      validations:=array_append(validations,row(
  b."scope_id", b."index_definition_id",
  b."attempt_fence", b."epoch", b."storage_generation_fence")::%1$I.fx_app_index_coverage);
    END IF;
  END LOOP; END IF;
  phase:='intrinsic';
  IF p_stop=phase THEN kind:='terminal'; reason:='stopped'; RETURN NEXT; RETURN; END IF;
  IF cardinality(p_intrinsic_indexes)>0 THEN FOR i IN 1..cardinality(p_intrinsic_indexes) LOOP
    SELECT x.* INTO b FROM %1$I."fx_system_index_build_state" x WHERE x."scope_id"=p_scope AND x."index_definition_id"=p_intrinsic_indexes[i];
    attempts[i]:=b."attempt_fence"; epochs[i]:=b."epoch"; fences[i]:=b."storage_generation_fence";
  END LOOP; END IF;
  intrinsic_count:=0; intrinsic_live_count:=0; intrinsic_tombstone_count:=0; intrinsic_key_bytes:=0;
  FOR t IN SELECT * FROM %1$I.fx_accept_app_index_transitions(p_scope,p_search_scope,p_intrinsic_indexes,p_intrinsic_access,p_intrinsic_tables,
    p_intrinsic_codecs,p_intrinsic_specs,p_intrinsic_ids,p_intrinsic_previous,p_intrinsic_previous_sha,p_intrinsic_final,p_intrinsic_final_sha,
    p_intrinsic_row_previous,attempts,epochs,fences,cardinality(p_intrinsic_indexes)) LOOP
    IF t.reason='transition' THEN
      k:=t.pair_ordinal+1;
      SELECT x.ordinality::integer INTO row_ordinal FROM unnest(p_rows) WITH ORDINALITY x WHERE x."table_id"=p_intrinsic_tables[k]
        AND x."row_id"=p_intrinsic_ids[k];
      IF p_stop IS DISTINCT FROM 'row' THEN
        IF row_ordinal IS NULL THEN refusal:='intrinsicTransitionInvalid'; i:=k; RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',
  DETAIL=jsonb_build_object('phase',phase,'reason',refusal,'ordinal',i-1)::text; END IF;
        indices:=array_append(indices,row(p_search_scope, p_intrinsic_indexes[k], p_intrinsic_tables[k], p_intrinsic_codecs[k], p_intrinsic_specs[k], CASE WHEN t.key_ordinal=0 THEN p_intrinsic_previous[k] ELSE p_intrinsic_final[k] END, CASE WHEN t.key_ordinal=0 THEN p_intrinsic_previous_sha[k] ELSE p_intrinsic_final_sha[k] END, p_intrinsic_ids[k], p_seq, t.transition_kind='tombstone')::%1$I.fx_app_index_write); priors:=array_append(priors,t.prior_commit_seq); historical:=array_append(historical,false);
      END IF;
      intrinsic_count:=intrinsic_count+1;
      IF t.transition_kind='live' THEN intrinsic_live_count:=intrinsic_live_count+1;
      ELSE intrinsic_tombstone_count:=intrinsic_tombstone_count+1; END IF;
      intrinsic_key_bytes:=intrinsic_key_bytes+octet_length(CASE WHEN t.key_ordinal=0 THEN p_intrinsic_previous[k] ELSE p_intrinsic_final[k] END);
      intrinsic_transitions:=intrinsic_transitions||jsonb_build_array(jsonb_build_object('pairOrdinal',t.pair_ordinal,'keyOrdinal',t.key_ordinal,'kind',t.transition_kind));
    END IF;
  END LOOP;
  IF p_stop='row' THEN kind:='terminal'; reason:='stopped'; RETURN NEXT; RETURN; END IF;
  BEGIN
    SELECT * INTO proof FROM %1$I.fx_apply_app_materialization(p_rows,p_row_pages,
    CASE WHEN p_stop='index' THEN ARRAY[]::%1$I.fx_app_index_write[] ELSE indices||p_indexes END,
    CASE WHEN p_stop='index' THEN ARRAY[]::bigint[] ELSE priors||p_index_prior END,
    CASE WHEN p_stop='index' THEN ARRAY[]::boolean[] ELSE historical||p_index_historical END,
    p_unique_owners,p_unique_previous,p_unique_next,CASE WHEN p_stop='index' THEN ARRAY[]::%1$I.fx_app_index_coverage[] ELSE validations END,
    CASE WHEN p_defer OR p_stop IN ('index','unique') THEN ARRAY[]::%1$I.fx_app_index_coverage[] ELSE index_coverage END,
    CASE WHEN p_defer OR p_stop IN ('index','unique') THEN ARRAY[]::%1$I.fx_app_unique_coverage[] ELSE unique_coverage END,
    p_seq,p_search_scope,p_search_tables,p_search_indexes,p_search_sources,p_search_modes,p_search_row_counts,p_search_ids,
    p_search_text_counts,p_search_text,p_search_json_counts,p_search_json);
  EXCEPTION WHEN SQLSTATE 'FX001' THEN
    GET STACKED DIAGNOSTICS inner_message=MESSAGE_TEXT,inner_detail=PG_EXCEPTION_DETAIL;
    IF inner_message='fx_apply_app_materialization' THEN
      RAISE EXCEPTION 'fx_apply_app_publication' USING ERRCODE='FX001',DETAIL=jsonb_build_object('phase','materialization',
        'detail',inner_detail,'intrinsicTransitions',intrinsic_transitions)::text;
    END IF;
    RAISE;
  END;
  reason:=CASE WHEN p_stop IS NULL THEN 'accepted' ELSE 'stopped' END;
  row_count:=proof.row_count; index_count:=proof.index_count; unique_count:=proof.unique_count; validation_count:=proof.validation_count;
  coverage_count:=proof.coverage_count; search_count:=proof.search_count; search_build_count:=proof.search_build_count;
  index_coverage_count:=CASE WHEN p_defer OR p_stop IN ('index','unique') THEN 0 ELSE cardinality(index_coverage) END;
  unique_coverage_count:=CASE WHEN p_defer OR p_stop IN ('index','unique') THEN 0 ELSE cardinality(unique_coverage) END;
  IF p_defer THEN
    IF cardinality(index_coverage)>0 THEN FOR i IN 1..cardinality(index_coverage) LOOP
      kind:='indexCoverage'; coverage_ordinal:=i-1; coverage_definition:=(index_coverage[i])."index_definition_id";
      coverage_attempt:=(index_coverage[i])."attempt_fence"; coverage_epoch:=(index_coverage[i])."epoch";
      coverage_fence:=(index_coverage[i])."storage_generation_fence"; RETURN NEXT;
    END LOOP; END IF;
    IF cardinality(unique_coverage)>0 THEN FOR i IN 1..cardinality(unique_coverage) LOOP
      kind:='uniqueCoverage'; coverage_ordinal:=i-1; coverage_definition:=(unique_coverage[i])."unique_constraint_definition_id";
      coverage_attempt:=(unique_coverage[i])."attempt_fence"; coverage_epoch:=(unique_coverage[i])."epoch";
      coverage_fence:=(unique_coverage[i])."storage_generation_fence"; RETURN NEXT;
    END LOOP; END IF;
  END IF;
  kind:='terminal'; coverage_ordinal:=NULL; coverage_definition:=NULL; coverage_attempt:=NULL; coverage_epoch:=NULL; coverage_fence:=NULL;
  RETURN NEXT;
END;
$publication_application$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_app_publication(text,uuid,text,bigint,text,bigint,bigint,bigint,timestamptz,boolean,boolean,integer[],integer[],text[],integer[],bytea[],text[],bigint[],bigint[],boolean[],boolean[],bigint[],uuid[],uuid[],bigint[],text[],integer[],bytea[],double precision[],integer[],integer[],bytea[],bytea[],text[],bytea[],bytea[],integer[],bytea[],bigint[],integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],integer,%1$I.fx_app_unique_owner[],bytea[],bigint[],integer[],bytea[],boolean,text) FROM PUBLIC',target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_apply_app_publication(text,text,bigint,text,bigint,text,text,boolean,boolean,boolean,text,text,bytea,bigint,bytea,bytea,integer[],integer[],bytea[],boolean[],text[],integer[],integer[],bytea[],boolean[],text[],text[],boolean,integer[],text[],integer[],integer[],bytea[],bytea[],bytea[],bytea[],bytea[],bytea[],bigint[],text,%1$I.fx_app_row_write[],integer[],%1$I.fx_app_index_write[],bigint[],boolean[],%1$I.fx_app_unique_owner[],%1$I.fx_app_unique_write[],%1$I.fx_app_unique_write[],%1$I.fx_app_index_coverage[],%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],bigint,uuid,integer[],integer[],text[],boolean[],integer[],bytea[],integer[],%1$I.fx_app_search_write[],integer[],%1$I.fx_app_json_write[]) FROM PUBLIC',target_schema);
END; $maintenance_acceptance$;

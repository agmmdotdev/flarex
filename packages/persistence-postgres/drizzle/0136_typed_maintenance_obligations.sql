-- Finalize the authenticated, bounded predecessor conversion before retiring legacy bytes.
-- Populated evidence without its exact opening obligation refuses completion and remains retained.
DO $stage$
DECLARE target_schema text := current_schema(); relation_name text;
BEGIN
  EXECUTE format($ddl$CREATE TABLE IF NOT EXISTS %1$I."fx_system_index_maintenance_obligation" ("scope_id" text NOT NULL,
"index_definition_id" integer NOT NULL,
"activation_sequence" bigint NOT NULL,
"storage_generation" text NOT NULL,
"storage_generation_fence" bigint NOT NULL,
"epoch" text NOT NULL,
"attempt_fence" bigint NOT NULL,
"first_readable_commit_seq" bigint NOT NULL,
"opened_commit_seq" bigint NOT NULL,
"table_id" integer NOT NULL,
"physical_spec_sha256" bytea NOT NULL,
"deployment_id" text NOT NULL,
"schema_version_id" text NOT NULL,
"schema_manifest_sha256" bytea NOT NULL,
"activation_sha256" bytea NOT NULL,
"head_sha256" bytea NOT NULL,
CONSTRAINT "fx_index_maintenance_obligation_pk" PRIMARY KEY ("scope_id","index_definition_id","activation_sequence"),
CONSTRAINT "fx_index_maintenance_opening_unique" UNIQUE ("scope_id","index_definition_id","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","opened_commit_seq","first_readable_commit_seq"),
CONSTRAINT "fx_index_maintenance_identity_check" CHECK ("index_definition_id" > 0 and "table_id" > 0 and "activation_sequence" > 0),
CONSTRAINT "fx_index_maintenance_authority_check" CHECK ("storage_generation" = 'flarexdb_v1' and "storage_generation_fence" > 0 and "attempt_fence" > 0),
CONSTRAINT "fx_index_maintenance_frontier_check" CHECK ("first_readable_commit_seq" >= 0 and "opened_commit_seq" >= "first_readable_commit_seq"),
CONSTRAINT "fx_index_maintenance_text_check" CHECK (length("scope_id") > 0 and length("epoch") > 0 and length("deployment_id") > 0 and length("schema_version_id") > 0),
CONSTRAINT "fx_index_maintenance_digest_check" CHECK (octet_length("physical_spec_sha256") = 32 and octet_length("schema_manifest_sha256") = 32 and octet_length("activation_sha256") = 32 and octet_length("head_sha256") = 32));
REVOKE ALL ON TABLE %1$I."fx_system_index_maintenance_obligation" FROM PUBLIC;
CREATE TABLE IF NOT EXISTS %1$I."fx_system_unique_maintenance_obligation" ("scope_id" text NOT NULL,
"unique_constraint_definition_id" integer NOT NULL,
"activation_sequence" bigint NOT NULL,
"storage_generation" text NOT NULL,
"storage_generation_fence" bigint NOT NULL,
"epoch" text NOT NULL,
"attempt_fence" bigint NOT NULL,
"start_commit_seq" bigint NOT NULL,
"opened_commit_seq" bigint NOT NULL,
"table_id" integer NOT NULL,
"physical_spec_sha256" bytea NOT NULL,
"deployment_id" text NOT NULL,
"schema_version_id" text NOT NULL,
"activation_sha256" bytea NOT NULL,
"head_sha256" bytea NOT NULL,
CONSTRAINT "fx_unique_maintenance_obligation_pk" PRIMARY KEY ("scope_id","unique_constraint_definition_id","activation_sequence"),
CONSTRAINT "fx_unique_maintenance_opening_unique" UNIQUE ("scope_id","unique_constraint_definition_id","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","opened_commit_seq","start_commit_seq"),
CONSTRAINT "fx_unique_maintenance_identity_check" CHECK ("unique_constraint_definition_id" > 0 and "table_id" > 0 and "activation_sequence" > 0),
CONSTRAINT "fx_unique_maintenance_authority_check" CHECK ("storage_generation" = 'flarexdb_v1' and "storage_generation_fence" > 0 and "attempt_fence" > 0),
CONSTRAINT "fx_unique_maintenance_frontier_check" CHECK ("start_commit_seq" >= 0 and "opened_commit_seq" >= "start_commit_seq"),
CONSTRAINT "fx_unique_maintenance_text_check" CHECK (length("scope_id") > 0 and length("epoch") > 0 and length("deployment_id") > 0 and length("schema_version_id") > 0),
CONSTRAINT "fx_unique_maintenance_digest_check" CHECK (octet_length("physical_spec_sha256") = 32 and octet_length("activation_sha256") = 32 and octet_length("head_sha256") = 32));
REVOKE ALL ON TABLE %1$I."fx_system_unique_maintenance_obligation" FROM PUBLIC;$ddl$,target_schema);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = format('%I.%I',target_schema,'fx_system_index_build_state')::pg_catalog.regclass AND conname = 'fx_index_build_maintenance_opening_fk') THEN
    EXECUTE format('ALTER TABLE %1$I."fx_system_index_build_state" ADD CONSTRAINT "fx_index_build_maintenance_opening_fk" FOREIGN KEY ("scope_id","index_definition_id","maintenance_activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","covered_through_commit_seq","first_readable_commit_seq") REFERENCES %1$I."fx_system_index_maintenance_obligation" ("scope_id","index_definition_id","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","opened_commit_seq","first_readable_commit_seq") ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID',target_schema);
  END IF;
IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = format('%I.%I',target_schema,'fx_system_unique_constraint_build')::pg_catalog.regclass AND conname = 'fx_unique_build_maintenance_opening_fk') THEN
    EXECUTE format('ALTER TABLE %1$I."fx_system_unique_constraint_build" ADD CONSTRAINT "fx_unique_build_maintenance_opening_fk" FOREIGN KEY ("scope_id","unique_constraint_definition_id","maintenance_activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","covered_through_commit_seq","start_commit_seq") REFERENCES %1$I."fx_system_unique_maintenance_obligation" ("scope_id","unique_constraint_definition_id","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","opened_commit_seq","start_commit_seq") ON UPDATE RESTRICT ON DELETE RESTRICT NOT VALID',target_schema);
  END IF;
  EXECUTE format($ddl$CREATE OR REPLACE FUNCTION %1$I.fx_guard_maintenance_obligation() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$BEGIN
  RAISE EXCEPTION 'Maintenance opening obligations are immutable' USING ERRCODE = '55000';
END;$body$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_guard_maintenance_obligation() FROM PUBLIC',target_schema);
EXECUTE format($ddl$CREATE OR REPLACE FUNCTION %1$I.fx_guard_maintained_build_delete() RETURNS trigger
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$BEGIN
  IF OLD."maintenance_activation_sequence" IS NOT NULL THEN
    RAISE EXCEPTION 'Maintained builds cannot be deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;$body$;$ddl$,target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_guard_maintained_build_delete() FROM PUBLIC',target_schema);
  FOREACH relation_name IN ARRAY ARRAY['fx_system_index_maintenance_obligation','fx_system_unique_maintenance_obligation'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = format('%I.%I',target_schema,relation_name)::pg_catalog.regclass AND tgname = 'fx_00_installation_admission') THEN
      EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.fx_require_active_installation()',target_schema,relation_name,target_schema);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = format('%I.%I',target_schema,relation_name)::pg_catalog.regclass AND tgname = 'fx_maintenance_immutable') THEN
      EXECUTE format('CREATE TRIGGER fx_maintenance_immutable BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.fx_guard_maintenance_obligation()',target_schema,relation_name,target_schema);
    END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['fx_system_index_build_state','fx_system_unique_constraint_build'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = format('%I.%I',target_schema,relation_name)::pg_catalog.regclass AND tgname = 'fx_maintenance_delete') THEN
      EXECUTE format('CREATE TRIGGER fx_maintenance_delete BEFORE DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION %I.fx_guard_maintained_build_delete()',target_schema,relation_name,target_schema);
    END IF;
  END LOOP;
END;
$stage$;
--> statement-breakpoint
ALTER TABLE fx_system_installation_runtime DROP CONSTRAINT fx_system_installation_runtime_access_profile_check;
--> statement-breakpoint
ALTER TABLE fx_system_installation_runtime ADD CONSTRAINT fx_system_installation_runtime_access_profile_check
  CHECK (access_profile IN ('dataRuntime','controlRead','activationWriter'));
--> statement-breakpoint
DO $final$
DECLARE target_schema text := current_schema(); relation_name text; incomplete boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = format('%I.%I',target_schema,'fx_system_index_build_state')::pg_catalog.regclass AND attname = 'maintenance_bytes' AND NOT attisdropped) THEN
    EXECUTE format($query$SELECT EXISTS (SELECT 1 FROM %1$I."fx_system_index_build_state" b LEFT JOIN %1$I."fx_system_index_maintenance_obligation" o ON b."scope_id" = o."scope_id" AND b."index_definition_id" = o."index_definition_id" AND b."maintenance_activation_sequence" = o."activation_sequence" AND b."storage_generation" = o."storage_generation" AND b."storage_generation_fence" = o."storage_generation_fence" AND b."epoch" = o."epoch" AND b."attempt_fence" = o."attempt_fence" AND b."covered_through_commit_seq" = o."opened_commit_seq" AND b."first_readable_commit_seq" = o."first_readable_commit_seq"
      WHERE (b.maintenance_activation_sequence IS NULL AND (b.maintenance_bytes IS NOT NULL OR b.maintenance_sha256 IS NOT NULL))
      OR (b.maintenance_activation_sequence IS NOT NULL AND (o.activation_sequence IS NULL OR b.maintenance_bytes IS NULL OR b.maintenance_sha256 IS NULL
        OR pg_catalog.sha256(b.maintenance_bytes) IS DISTINCT FROM b.maintenance_sha256
        OR pg_catalog.convert_from(b.maintenance_bytes,'UTF8')::jsonb IS DISTINCT FROM pg_catalog.jsonb_build_object('format','flarex.index-maintenance','version',1,'scopeId',o."scope_id",'storageGeneration',o."storage_generation",'storageGenerationFence',o."storage_generation_fence"::text,'epoch',o."epoch",'tableId',o."table_id",'physicalSpecSha256Hex',pg_catalog.encode(o."physical_spec_sha256",'hex'),'deploymentId',o."deployment_id",'schemaVersionId',o."schema_version_id",'attemptFence',o."attempt_fence"::text,'openedCommitSeq',o."opened_commit_seq"::text,'activationSequence',o."activation_sequence"::text,'headSha256',pg_catalog.encode(o."head_sha256",'hex'),'indexDefinitionId',o."index_definition_id",'firstReadableCommitSeq',o."first_readable_commit_seq"::text,'schemaManifestSha256',pg_catalog.encode(o."schema_manifest_sha256",'hex')))))$query$,target_schema) INTO incomplete;
    IF incomplete THEN RAISE EXCEPTION 'Typed maintenance conversion is incomplete' USING ERRCODE = '55000'; END IF;
  END IF;
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_build_state" VALIDATE CONSTRAINT "fx_index_build_maintenance_opening_fk"',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_build_state" DROP CONSTRAINT IF EXISTS "fx_system_index_build_maintenance_check"',target_schema);
  EXECUTE format($ddl$ALTER TABLE %1$I."fx_system_index_build_state" ADD CONSTRAINT "fx_system_index_build_maintenance_check" CHECK (
      "maintenance_activation_sequence" is null
      or ("maintenance_activation_sequence" is not null and "maintenance_activation_sequence" > 0
        and "lifecycle" = 'enabled' and "first_readable_commit_seq" is not null and "covered_through_commit_seq" is not null));$ddl$,target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_index_build_state" DROP COLUMN IF EXISTS maintenance_bytes, DROP COLUMN IF EXISTS maintenance_sha256',target_schema);
IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = format('%I.%I',target_schema,'fx_system_unique_constraint_build')::pg_catalog.regclass AND attname = 'maintenance_bytes' AND NOT attisdropped) THEN
    EXECUTE format($query$SELECT EXISTS (SELECT 1 FROM %1$I."fx_system_unique_constraint_build" b LEFT JOIN %1$I."fx_system_unique_maintenance_obligation" o ON b."scope_id" = o."scope_id" AND b."unique_constraint_definition_id" = o."unique_constraint_definition_id" AND b."maintenance_activation_sequence" = o."activation_sequence" AND b."storage_generation" = o."storage_generation" AND b."storage_generation_fence" = o."storage_generation_fence" AND b."epoch" = o."epoch" AND b."attempt_fence" = o."attempt_fence" AND b."covered_through_commit_seq" = o."opened_commit_seq" AND b."start_commit_seq" = o."start_commit_seq"
      WHERE (b.maintenance_activation_sequence IS NULL AND (b.maintenance_bytes IS NOT NULL OR b.maintenance_sha256 IS NOT NULL))
      OR (b.maintenance_activation_sequence IS NOT NULL AND (o.activation_sequence IS NULL OR b.maintenance_bytes IS NULL OR b.maintenance_sha256 IS NULL
        OR pg_catalog.sha256(b.maintenance_bytes) IS DISTINCT FROM b.maintenance_sha256
        OR pg_catalog.convert_from(b.maintenance_bytes,'UTF8')::jsonb IS DISTINCT FROM pg_catalog.jsonb_build_object('format','flarex.unique-maintenance','version',1,'scopeId',o."scope_id",'storageGeneration',o."storage_generation",'storageGenerationFence',o."storage_generation_fence"::text,'epoch',o."epoch",'tableId',o."table_id",'physicalSpecSha256Hex',pg_catalog.encode(o."physical_spec_sha256",'hex'),'deploymentId',o."deployment_id",'schemaVersionId',o."schema_version_id",'attemptFence',o."attempt_fence"::text,'openedCommitSeq',o."opened_commit_seq"::text,'activationSequence',o."activation_sequence"::text,'headSha256',pg_catalog.encode(o."head_sha256",'hex'),'uniqueConstraintDefinitionId',o."unique_constraint_definition_id",'startCommitSeq',o."start_commit_seq"::text))))$query$,target_schema) INTO incomplete;
    IF incomplete THEN RAISE EXCEPTION 'Typed maintenance conversion is incomplete' USING ERRCODE = '55000'; END IF;
  END IF;
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_constraint_build" VALIDATE CONSTRAINT "fx_unique_build_maintenance_opening_fk"',target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_constraint_build" DROP CONSTRAINT IF EXISTS "fx_system_unique_build_maintenance_check"',target_schema);
  EXECUTE format($ddl$ALTER TABLE %1$I."fx_system_unique_constraint_build" ADD CONSTRAINT "fx_system_unique_build_maintenance_check" CHECK (
      "maintenance_activation_sequence" is null
      or ("maintenance_activation_sequence" is not null and "maintenance_activation_sequence" > 0
        and "lifecycle" = 'enabled' and "covered_through_commit_seq" is not null));$ddl$,target_schema);
  EXECUTE format('ALTER TABLE %1$I."fx_system_unique_constraint_build" DROP COLUMN IF EXISTS maintenance_bytes, DROP COLUMN IF EXISTS maintenance_sha256',target_schema);
END;
$final$;

--> statement-breakpoint

DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_replace_active_index_maintenance(
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
  
  FOR build IN SELECT * FROM %1$I."fx_system_index_build_state" WHERE "scope_id" = p_scope AND "maintenance_activation_sequence" IS NOT NULL
    ORDER BY "index_definition_id" FOR UPDATE LOOP 
    IF build."lifecycle" <> 'enabled' OR build."storage_generation" IS DISTINCT FROM live_authority."storage_generation" OR
      build."storage_generation_fence" IS DISTINCT FROM live_authority."storage_generation_fence" OR
      build."epoch" IS DISTINCT FROM live_authority."epoch" OR
      build."first_readable_commit_seq" IS NULL OR build."covered_through_commit_seq" IS NULL OR
      build."first_readable_commit_seq" > build."covered_through_commit_seq" OR build."covered_through_commit_seq" > live_clock."last_commit_seq"
      THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','unavailable')::text; END IF; 
    IF build."maintenance_activation_sequence" IS NOT NULL THEN
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members)
        WHERE (value->>'definitionId')::integer = build."index_definition_id";
      IF NOT FOUND OR NOT had_head THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      SELECT * INTO opening FROM %1$I."fx_system_index_maintenance_obligation" WHERE "scope_id" = p_scope
        AND "index_definition_id" = build."index_definition_id"
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
    
    IF build."lifecycle" <> 'enabled' OR build."storage_generation" IS DISTINCT FROM live_authority."storage_generation" OR
      build."storage_generation_fence" IS DISTINCT FROM live_authority."storage_generation_fence" OR
      build."epoch" IS DISTINCT FROM live_authority."epoch" OR
      build."first_readable_commit_seq" IS NULL OR build."covered_through_commit_seq" IS NULL OR
      build."first_readable_commit_seq" > build."covered_through_commit_seq" OR build."covered_through_commit_seq" > live_clock."last_commit_seq"
      THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','unavailable')::text; END IF; 
    IF build."maintenance_activation_sequence" IS NOT NULL THEN
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members)
        WHERE (value->>'definitionId')::integer = build."index_definition_id";
      IF NOT FOUND OR NOT had_head THEN RAISE EXCEPTION 'fx_replace_active_index_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','index','reason','storedState')::text; END IF;
      SELECT * INTO opening FROM %1$I."fx_system_index_maintenance_obligation" WHERE "scope_id" = p_scope
        AND "index_definition_id" = build."index_definition_id"
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
      IF build."maintenance_activation_sequence" IS NOT NULL THEN
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
    ("maintenance_activation_sequence" IS NOT NULL OR "index_definition_id" IN
      (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY "index_definition_id" FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer = build."index_definition_id";
    IF incoming_member IS NOT NULL THEN
      INSERT INTO %1$I."fx_system_index_maintenance_obligation" ("scope_id","index_definition_id","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","first_readable_commit_seq","opened_commit_seq","table_id","physical_spec_sha256","deployment_id","schema_version_id","schema_manifest_sha256","activation_sha256","head_sha256") VALUES (
        p_scope, build."index_definition_id", p_incoming_sequence, build."storage_generation",
        build."storage_generation_fence", build."epoch", build."attempt_fence",
        build."first_readable_commit_seq", live_clock."last_commit_seq", (incoming_member->>'tableId')::integer,
        decode(incoming_member->>'physicalSpecSha256','hex'), p_incoming_deployment, p_incoming_schema,
        p_incoming_manifest, p_incoming_activation, p_next_head);
      UPDATE %1$I."fx_system_index_build_state" SET "covered_through_commit_seq" = live_clock."last_commit_seq",
        "maintenance_activation_sequence" = p_incoming_sequence, "updated_at" = clock_timestamp()
        WHERE "scope_id" = p_scope AND "index_definition_id" = build."index_definition_id";
      opened_total := opened_total + 1;
    ELSE
      UPDATE %1$I."fx_system_index_build_state" SET "covered_through_commit_seq" = live_clock."last_commit_seq",
        "maintenance_activation_sequence" = NULL, "updated_at" = clock_timestamp()
        WHERE "scope_id" = p_scope AND "index_definition_id" = build."index_definition_id";
      closed_total := closed_total + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT closed_total, opened_total;
END
$index_maintenance_publisher$;
$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_replace_active_index_maintenance(text,bigint,bytea,bigint,bytea,bytea,text,text,bytea,jsonb,text,text,bytea,jsonb) FROM PUBLIC', target_schema);
END $$;

--> statement-breakpoint

DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
CREATE FUNCTION %1$I.fx_replace_active_unique_maintenance(
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
    ("maintenance_activation_sequence" IS NOT NULL OR "unique_constraint_definition_id" IN
      (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY "unique_constraint_definition_id" FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer = build."unique_constraint_definition_id";
    
    IF build."lifecycle" <> 'enabled' OR build."storage_generation" IS DISTINCT FROM live_authority."storage_generation" OR
      build."storage_generation_fence" IS DISTINCT FROM live_authority."storage_generation_fence" OR
      build."epoch" IS DISTINCT FROM live_authority."epoch" OR
      build."start_commit_seq" IS NULL OR build."covered_through_commit_seq" IS NULL OR
      build."start_commit_seq" > build."covered_through_commit_seq" OR build."covered_through_commit_seq" > live_clock."last_commit_seq"
      THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','unavailable')::text; END IF; 
    IF build."maintenance_activation_sequence" IS NOT NULL THEN
      SELECT value INTO outgoing_member FROM jsonb_array_elements(p_outgoing_members)
        WHERE (value->>'definitionId')::integer = build."unique_constraint_definition_id";
      IF NOT FOUND OR NOT had_head THEN RAISE EXCEPTION 'fx_replace_active_unique_maintenance' USING ERRCODE = 'FX001', DETAIL = jsonb_build_object('domain','unique','reason','storedState')::text; END IF;
      SELECT * INTO opening FROM %1$I."fx_system_unique_maintenance_obligation" WHERE "scope_id" = p_scope
        AND "unique_constraint_definition_id" = build."unique_constraint_definition_id"
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
      IF build."maintenance_activation_sequence" IS NOT NULL THEN
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
    ("maintenance_activation_sequence" IS NOT NULL OR "unique_constraint_definition_id" IN
      (SELECT (value->>'definitionId')::integer FROM jsonb_array_elements(p_incoming_members)))
    ORDER BY "unique_constraint_definition_id" FOR UPDATE LOOP
    SELECT value INTO incoming_member FROM jsonb_array_elements(p_incoming_members) WHERE (value->>'definitionId')::integer = build."unique_constraint_definition_id";
    IF incoming_member IS NOT NULL THEN
      INSERT INTO %1$I."fx_system_unique_maintenance_obligation" ("scope_id","unique_constraint_definition_id","activation_sequence","storage_generation","storage_generation_fence","epoch","attempt_fence","start_commit_seq","opened_commit_seq","table_id","physical_spec_sha256","deployment_id","schema_version_id","activation_sha256","head_sha256") VALUES (
        p_scope, build."unique_constraint_definition_id", p_incoming_sequence, build."storage_generation",
        build."storage_generation_fence", build."epoch", build."attempt_fence",
        build."start_commit_seq", live_clock."last_commit_seq", (incoming_member->>'tableId')::integer,
        decode(incoming_member->>'physicalSpecSha256','hex'), p_incoming_deployment, p_incoming_schema,
         p_incoming_activation, p_next_head);
      UPDATE %1$I."fx_system_unique_constraint_build" SET "covered_through_commit_seq" = live_clock."last_commit_seq",
        "maintenance_activation_sequence" = p_incoming_sequence, "updated_at" = clock_timestamp()
        WHERE "scope_id" = p_scope AND "unique_constraint_definition_id" = build."unique_constraint_definition_id";
      opened_total := opened_total + 1;
    ELSE
      UPDATE %1$I."fx_system_unique_constraint_build" SET "covered_through_commit_seq" = live_clock."last_commit_seq",
        "maintenance_activation_sequence" = NULL, "updated_at" = clock_timestamp()
        WHERE "scope_id" = p_scope AND "unique_constraint_definition_id" = build."unique_constraint_definition_id";
      closed_total := closed_total + 1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT closed_total, opened_total;
END
$unique_maintenance_publisher$;
$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_replace_active_unique_maintenance(text,bigint,bytea,bigint,bytea,bytea,text,text,jsonb,text,text,jsonb) FROM PUBLIC', target_schema);
END $$;

--> statement-breakpoint

DO $$ DECLARE target_schema text := current_schema(); BEGIN
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
      AND b."maintenance_activation_sequence" IS NULL
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
      AND b."maintenance_activation_sequence" IS NULL;
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
$coverage$;
$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_advance_app_coverage(%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],bigint,bigint,boolean,%1$I.fx_app_index_coverage[],%1$I.fx_app_unique_coverage[],text[],text[]) FROM PUBLIC', target_schema);
END $$;

--> statement-breakpoint

DO $$ DECLARE target_schema text := current_schema(); BEGIN
  EXECUTE format($ddl$
    CREATE OR REPLACE FUNCTION %1$I.fx_accept_finite_storage_capture(p_scope_id text,
      p_expected %1$I.fx_finite_capture_expected, p_anchor_bytes bytea, p_anchor_sha256 bytea,
      p_snapshot_epoch_uuid uuid, p_snapshot_commit_seq bigint, p_metadata_watermark bigint,
      p_claim_owner uuid, p_claim_fence bigint, p_generation text, p_generation_fence bigint, p_epoch text,
      p_index_definition_id integer, p_table_id integer, p_unique_definition_id integer)
    RETURNS TABLE(reason text, database_now_epoch_milliseconds text, serving_commit_seq bigint,
      authority_row %1$I.fx_system_scope_execution_authority, session_row %1$I.fx_system_tx_session,
      build_row %1$I.fx_system_index_build_state, unique_row %1$I.fx_system_unique_constraint_build,
      table_frontier bigint, historical_change boolean, body_eligible boolean)
    LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $body$
    DECLARE s %1$I.fx_system_tx_session; clock_row %1$I.fx_system_scope_clock; current_time_ms bigint;
      effective_statement_timeout interval;
    BEGIN
      -- Startup arms the statement before execution. Re-check the actual pooled
      -- session setting before authority, attempt or build locks and body access.
      effective_statement_timeout := current_setting('statement_timeout')::interval;
      IF effective_statement_timeout <= interval '0 milliseconds'
        OR effective_statement_timeout > interval '30000 milliseconds' THEN
        reason := 'resourceFailure'; body_eligible := false; RETURN NEXT; RETURN;
      END IF;
      reason := 'invalidAuthority';
      IF p_scope_id IS NULL THEN RETURN NEXT; RETURN; END IF;
      SELECT a.* INTO authority_row FROM %1$I.fx_system_scope_execution_authority a WHERE a.scope_id = p_scope_id FOR SHARE;
      IF authority_row.scope_id IS NULL THEN RETURN NEXT; RETURN; END IF;
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
        reason := 'storedCorruption'; RETURN NEXT; RETURN;
      END IF;
      IF p_generation <> 'flarexdb_v1' OR authority_row.storage_generation <> 'flarexdb_v1' THEN
        reason := 'unsupportedStorageGeneration'; RETURN NEXT; RETURN;
      END IF;
      IF authority_row.storage_generation_fence IS DISTINCT FROM p_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN NEXT; RETURN;
      END IF;
      IF authority_row.epoch IS DISTINCT FROM p_epoch THEN reason := 'scopeEpochChanged'; RETURN NEXT; RETURN; END IF;
      -- Identity lookup precedes fence interpretation, including corrupt replaced rows.
      SELECT a.* INTO s FROM %1$I.fx_system_tx_session a
        WHERE a.scope_uuid = (substring(p_scope_id FROM 7))::uuid AND a.session_id = (p_expected).session_id FOR SHARE;
      IF s.session_id IS NULL THEN reason := 'attemptMissing'; RETURN NEXT; RETURN; END IF;
      IF NOT isfinite(s.authorization_grant_expires_at) OR NOT isfinite(s.hard_expires_at)
        OR NOT isfinite(s.created_at) OR NOT isfinite(s.updated_at)
        OR s.finite_lease_expires_at IS NULL OR NOT isfinite(s.finite_lease_expires_at)
        OR s.finite_claimed_at IS NULL OR NOT isfinite(s.finite_claimed_at)
        OR s.finite_claim_expires_at IS NULL OR NOT isfinite(s.finite_claim_expires_at) THEN
        reason := 'storedCorruption'; RETURN NEXT; RETURN;
      END IF;
      IF s.finite_attempt_bytes IS NULL OR octet_length(s.finite_attempt_bytes) NOT BETWEEN 1 AND 131072
        OR s.finite_attempt_sha256 IS NULL OR octet_length(s.finite_attempt_sha256) <> 32
        OR s.finite_snapshot_epoch_uuid IS NULL OR s.finite_snapshot_commit_seq IS NULL
        OR s.finite_snapshot_commit_seq < 0 OR s.attempt_fence < 1
        OR s.finite_claim_owner IS NULL OR s.finite_claim_fence IS NULL OR s.finite_claim_fence < 1
        OR s.finite_claim_expires_at <= s.finite_claimed_at OR s.finite_claim_expires_at > s.finite_lease_expires_at
        OR s.finite_lease_expires_at > s.hard_expires_at THEN
        reason := 'storedCorruption'; RETURN NEXT; RETURN;
      END IF;
      IF s.attempt_fence <> (p_expected).attempt_fence THEN
        -- The owning canonical decoder checks this fresh frontier before the
        -- replacement verdict. No business body is selected for this header.
        session_row := s; reason := 'attemptReplaced'; RETURN NEXT; RETURN;
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
        reason := 'storedCorruption'; RETURN NEXT; RETURN;
      END IF;
      IF s.finite_claim_owner <> p_claim_owner OR s.finite_claim_fence <> p_claim_fence THEN
        reason := 'ownershipChanged'; RETURN NEXT; RETURN;
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
      IF s.lifecycle <> 'running' THEN reason := 'lifecycleChanged'; RETURN NEXT; RETURN; END IF;
      IF current_time_ms >= floor(extract(epoch FROM s.finite_lease_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.finite_claim_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.authorization_grant_expires_at)*1000)
        OR current_time_ms >= floor(extract(epoch FROM s.hard_expires_at)*1000) THEN
        reason := 'expired'; RETURN NEXT; RETURN;
      END IF;
      IF s.storage_generation <> authority_row.storage_generation OR s.storage_generation_fence <> authority_row.storage_generation_fence THEN
        reason := 'storageGenerationFenceChanged'; RETURN NEXT; RETURN;
      END IF;
      IF p_epoch <> authority_row.epoch OR p_snapshot_epoch_uuid <> authority_row.epoch_uuid THEN
        reason := 'scopeEpochChanged'; RETURN NEXT; RETURN;
      END IF;
      IF s.authorization_revocation_epoch <> authority_row.authorization_revocation_epoch THEN
        reason := 'authorizationRevocationEpochChanged'; RETURN NEXT; RETURN;
      END IF;
      IF p_snapshot_commit_seq < authority_row.oldest_available_commit_seq THEN reason := 'expired'; RETURN NEXT; RETURN; END IF;
      -- Native cheap guards govern transfer eligibility. Canonical build
      -- evidence retains the original decoder's corruption/refusal ordering.
      body_eligible := serving_commit_seq >= p_snapshot_commit_seq;
      IF p_index_definition_id IS NOT NULL THEN
        body_eligible := body_eligible AND build_row.scope_id = p_scope_id
          AND build_row.storage_generation = authority_row.storage_generation
          AND build_row.storage_generation_fence = authority_row.storage_generation_fence
          AND build_row.epoch = authority_row.epoch AND build_row.lifecycle = 'enabled'
          AND build_row.first_readable_commit_seq <= p_snapshot_commit_seq
          AND build_row.covered_through_commit_seq IS NOT NULL
          AND build_row.covered_through_commit_seq <= serving_commit_seq
          AND (build_row.covered_through_commit_seq >= p_snapshot_commit_seq OR build_row.maintenance_activation_sequence IS NOT NULL
            OR table_frontier IS NULL OR table_frontier <= build_row.covered_through_commit_seq
            OR build_row.covered_through_commit_seq >= authority_row.oldest_available_commit_seq AND NOT historical_change);
      END IF;
      IF p_unique_definition_id IS NOT NULL THEN
        body_eligible := body_eligible AND unique_row.scope_id = p_scope_id
          AND unique_row.storage_generation = authority_row.storage_generation
          AND unique_row.storage_generation_fence = authority_row.storage_generation_fence
          AND unique_row.epoch = authority_row.epoch AND unique_row.lifecycle = 'enabled'
          AND unique_row.start_commit_seq <= p_snapshot_commit_seq
          AND unique_row.covered_through_commit_seq IS NOT NULL
          AND unique_row.covered_through_commit_seq <= serving_commit_seq
          AND (unique_row.covered_through_commit_seq >= p_snapshot_commit_seq OR unique_row.maintenance_activation_sequence IS NOT NULL
            OR table_frontier IS NULL OR table_frontier <= unique_row.covered_through_commit_seq
            OR unique_row.covered_through_commit_seq >= authority_row.oldest_available_commit_seq AND NOT historical_change);
      END IF;
      session_row := s; reason := 'accepted'; RETURN NEXT;
    END;
    $body$
$ddl$, target_schema);
  EXECUTE format('REVOKE ALL ON FUNCTION %1$I.fx_accept_finite_storage_capture(text,%1$I.fx_finite_capture_expected,bytea,bytea,uuid,bigint,bigint,uuid,bigint,text,bigint,text,integer,integer,integer) FROM PUBLIC', target_schema);
END $$;

-- Protect immutable readiness definitions and historical receipts.
-- Applied by the existing installation maintenance owner; no durable data reset.
DO $$
DECLARE
  installation_schema text := current_schema();
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'fx_control_table',
    'fx_control_index',
    'fx_control_index_definition',
    'fx_control_schema_version_index_binding',
    'fx_control_relation',
    'fx_control_edge_definition',
    'fx_control_schema_relation_binding',
    'fx_control_bound_application_schema',
    'fx_control_application_manifest_schema_binding',
    'fx_control_unique_constraint',
    'fx_control_unique_constraint_definition',
    'fx_control_schema_version_unique_constraint_binding',
    'fx_control_schema_unique_constraint_set',
    'fx_control_application_schema_authority_v1',
    'fx_system_app_schema_candidate_validation',
    'fx_system_edge_definition_readiness',
    'fx_system_application_relation_semantic_readiness'
  ] LOOP
    EXECUTE format('CREATE TRIGGER fx_prepared_metadata_invalidate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.%2$I FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_invalidate_prepared_metadata()', installation_schema, relation_name);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Existing preparations cannot cross an installed upgrade. A fresh unverified
-- installation cannot issue preparations and has no maintenance admission yet.
-- Do not execute guarded metadata DML before its original outer initialization.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fx_system_installation"
    WHERE "singleton_id" = 1 AND "state" <> 'unverified') THEN
    UPDATE "fx_system_prepared_metadata_epoch"
      SET "generation" = "generation" + 1 WHERE "singleton_id" = 1;
  END IF;
END;
$$;

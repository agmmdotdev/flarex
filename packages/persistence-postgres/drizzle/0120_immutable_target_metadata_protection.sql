-- Extend the existing full-attestation protected target contract. Installation
-- runs under quiescent privileged ownership; canonical and journal data remain.
DO $$
DECLARE
  metadata_schema text := current_schema();
  covered_table text;
BEGIN
  FOREACH covered_table IN ARRAY ARRAY[
    'fx_system_application_publication',
    'fx_system_application_function',
    'fx_system_application_task_catalog',
    'fx_system_application_task_definition',
    'fx_system_application_revision_schema',
    'fx_system_application_readiness',
    'fx_system_application_readiness_relation',
    'fx_system_application_readiness_function',
    'fx_system_application_activation',
    'fx_system_application_write_ownership',
    'fx_system_data_binding_candidate',
    'fx_system_data_binding_physical_lane',
    'fx_system_data_binding_activation'
  ] LOOP
    EXECUTE format('CREATE TRIGGER fx_prepared_metadata_invalidate BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION %I.fx_invalidate_prepared_metadata()',
      metadata_schema, covered_table, metadata_schema);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Old process-local preparations cannot cross the protection installation.
UPDATE "fx_system_prepared_metadata_epoch" SET "generation" = "generation" + 1
WHERE "singleton_id" = 1;

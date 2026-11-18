-- Add trusted workflow Task bindings without changing retained definition generations.
CREATE TABLE "fx_system_trusted_workflow_task_binding" (
  "scope_id" text NOT NULL,
  "binding_sha256" bytea NOT NULL,
  "codec_version" integer NOT NULL,
  "byte_length" integer NOT NULL,
  "canonical_bytes" bytea NOT NULL,
  CONSTRAINT "fx_trusted_workflow_task_binding_pk" PRIMARY KEY ("scope_id", "binding_sha256"),
  CONSTRAINT "fx_trusted_workflow_task_binding_values" CHECK ("fx_system_trusted_workflow_task_binding"."codec_version" = 1 and octet_length("fx_system_trusted_workflow_task_binding"."binding_sha256") = 32
    and "fx_system_trusted_workflow_task_binding"."byte_length" between 1 and 65536 and octet_length("fx_system_trusted_workflow_task_binding"."canonical_bytes") = "fx_system_trusted_workflow_task_binding"."byte_length"),
  CONSTRAINT "fx_trusted_workflow_task_binding_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock" ("scope_id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "trusted_workflow_binding_sha256" bytea;
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD CONSTRAINT "fx_task_run_trusted_workflow_binding_fk" FOREIGN KEY ("scope_id", "trusted_workflow_binding_sha256") REFERENCES "fx_system_trusted_workflow_task_binding" ("scope_id", "binding_sha256") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" DROP CONSTRAINT "fx_task_run_v1_identity_check";
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD CONSTRAINT "fx_task_run_v1_identity_check" CHECK ("fx_system_durable_task_run_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and (("fx_system_durable_task_run_v1"."definition_generation" = 'legacy_definition_v1'
              and "fx_system_durable_task_run_v1"."task_definition_revision_id" is not null
              and "fx_system_durable_task_run_v1"."task_definition_revision_id" ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              and "fx_system_durable_task_run_v1"."application_revision_id" is null
              and "fx_system_durable_task_run_v1"."application_task_runtime_target_sha256" is null
              and "fx_system_durable_task_run_v1"."execution_principal_generation" = 'not_applicable'
              and "fx_system_durable_task_run_v1"."execution_principal_kind" is null
              and "fx_system_durable_task_run_v1"."execution_principal_codec" is null
              and "fx_system_durable_task_run_v1"."execution_principal_store" is null
              and "fx_system_durable_task_run_v1"."execution_principal_value_codec" is null
              and "fx_system_durable_task_run_v1"."execution_principal_object_key" is null
              and "fx_system_durable_task_run_v1"."execution_principal_byte_length" is null
              and "fx_system_durable_task_run_v1"."execution_principal_sha256" is null
              and "fx_system_durable_task_run_v1"."execution_principal_retention" is null)
          or ("fx_system_durable_task_run_v1"."definition_generation" = 'application_v1'
              and "fx_system_durable_task_run_v1"."task_definition_revision_id" is null
              and "fx_system_durable_task_run_v1"."application_revision_id" is not null
              and btrim("fx_system_durable_task_run_v1"."application_revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
              and octet_length(convert_to("fx_system_durable_task_run_v1"."application_revision_id", 'UTF8')) <= 2048
              and "fx_system_durable_task_run_v1"."application_task_runtime_target_sha256" is not null
              and octet_length("fx_system_durable_task_run_v1"."application_task_runtime_target_sha256") = 32
              and (("fx_system_durable_task_run_v1"."execution_principal_generation" = 'legacy_absent'
                    and "fx_system_durable_task_run_v1"."execution_principal_kind" is null
                    and "fx_system_durable_task_run_v1"."execution_principal_codec" is null
                    and "fx_system_durable_task_run_v1"."execution_principal_store" is null
                    and "fx_system_durable_task_run_v1"."execution_principal_value_codec" is null
                    and "fx_system_durable_task_run_v1"."execution_principal_object_key" is null
                    and "fx_system_durable_task_run_v1"."execution_principal_byte_length" is null
                    and "fx_system_durable_task_run_v1"."execution_principal_sha256" is null
                    and "fx_system_durable_task_run_v1"."execution_principal_retention" is null)
                or ("fx_system_durable_task_run_v1"."execution_principal_generation" = 'present_v1'
                    and "fx_system_durable_task_run_v1"."execution_principal_kind" is not null
                    and "fx_system_durable_task_run_v1"."execution_principal_codec" is not null
                    and "fx_system_durable_task_run_v1"."execution_principal_store" is not null
                    and "fx_system_durable_task_run_v1"."execution_principal_value_codec" is not null
                    and "fx_system_durable_task_run_v1"."execution_principal_object_key" is not null
                    and "fx_system_durable_task_run_v1"."execution_principal_byte_length" is not null
                    and "fx_system_durable_task_run_v1"."execution_principal_sha256" is not null
                    and "fx_system_durable_task_run_v1"."execution_principal_retention" is not null
                    and "fx_system_durable_task_run_v1"."execution_principal_kind" = 'authenticated_user'
                    and "fx_system_durable_task_run_v1"."execution_principal_codec" = 'flarex.task-execution-principal-reference.v1'
                    and "fx_system_durable_task_run_v1"."execution_principal_store" = 'flarex.task-execution-principal-object-store.v1'
                    and "fx_system_durable_task_run_v1"."execution_principal_value_codec" = 'flarex-value/v1'
                    and "fx_system_durable_task_run_v1"."execution_principal_object_key" ~ '^durable-task-principal/v1/sha256/[0-9a-f]{64}$'
                    and "fx_system_durable_task_run_v1"."execution_principal_byte_length" between 1 and 262144
                    and octet_length("fx_system_durable_task_run_v1"."execution_principal_sha256") = 32
                    and right("fx_system_durable_task_run_v1"."execution_principal_object_key", 64) =
                      encode("fx_system_durable_task_run_v1"."execution_principal_sha256", 'hex')
                    and "fx_system_durable_task_run_v1"."execution_principal_retention" = 'run_lifetime')))
          or ("fx_system_durable_task_run_v1"."definition_generation" = 'trusted_workflow'
            and "fx_system_durable_task_run_v1"."task_definition_revision_id" is null and "fx_system_durable_task_run_v1"."application_revision_id" is null
            and "fx_system_durable_task_run_v1"."application_task_runtime_target_sha256" is null
            and "fx_system_durable_task_run_v1"."execution_principal_generation" = 'present_v1'
            and "fx_system_durable_task_run_v1"."execution_principal_kind" is not null
            and "fx_system_durable_task_run_v1"."execution_principal_codec" is not null
            and "fx_system_durable_task_run_v1"."execution_principal_store" is not null
            and "fx_system_durable_task_run_v1"."execution_principal_value_codec" is not null
            and "fx_system_durable_task_run_v1"."execution_principal_object_key" is not null
            and "fx_system_durable_task_run_v1"."execution_principal_byte_length" is not null
            and "fx_system_durable_task_run_v1"."execution_principal_sha256" is not null
            and "fx_system_durable_task_run_v1"."execution_principal_retention" is not null
            and "fx_system_durable_task_run_v1"."execution_principal_kind" = 'authenticated_user'
            and "fx_system_durable_task_run_v1"."execution_principal_codec" = 'flarex.task-execution-principal-reference.v1'
            and "fx_system_durable_task_run_v1"."execution_principal_store" = 'flarex.task-execution-principal-object-store.v1'
            and "fx_system_durable_task_run_v1"."execution_principal_value_codec" = 'flarex-value/v1'
            and "fx_system_durable_task_run_v1"."execution_principal_object_key" ~ '^durable-task-principal/v1/sha256/[0-9a-f]{64}$'
            and "fx_system_durable_task_run_v1"."execution_principal_byte_length" between 1 and 262144
            and octet_length("fx_system_durable_task_run_v1"."execution_principal_sha256") = 32
            and right("fx_system_durable_task_run_v1"."execution_principal_object_key",64) = encode("fx_system_durable_task_run_v1"."execution_principal_sha256",'hex')
            and "fx_system_durable_task_run_v1"."execution_principal_retention" = 'run_lifetime'))
        and "fx_system_durable_task_run_v1"."created_at_ms" between 0 and 9007199254740991);
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD CONSTRAINT "fx_task_run_trusted_workflow_binding_check" CHECK ((("fx_system_durable_task_run_v1"."definition_generation" = 'trusted_workflow'
      and "fx_system_durable_task_run_v1"."trusted_workflow_binding_sha256" is not null and octet_length("fx_system_durable_task_run_v1"."trusted_workflow_binding_sha256") = 32)
      or ("fx_system_durable_task_run_v1"."definition_generation" <> 'trusted_workflow' and "fx_system_durable_task_run_v1"."trusted_workflow_binding_sha256" is null)));
--> statement-breakpoint
DO $trusted_workflow_installation$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_trusted_workflow_task_binding FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_require_active_installation()', target_schema);
END;
$trusted_workflow_installation$;

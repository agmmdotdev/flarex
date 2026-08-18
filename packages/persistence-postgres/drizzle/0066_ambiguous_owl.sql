ALTER TABLE "fx_system_durable_task_run_v1" DROP CONSTRAINT "fx_task_run_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_generation" text;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_kind" text;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_codec" text;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_store" text;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_value_codec" text;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_object_key" text;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_byte_length" bigint;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "execution_principal_retention" text;--> statement-breakpoint
UPDATE "fx_system_durable_task_run_v1"
SET "execution_principal_generation" = CASE
  WHEN "definition_generation" = 'application_v1' THEN 'legacy_absent'
  ELSE 'not_applicable'
END;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ALTER COLUMN "execution_principal_generation" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD CONSTRAINT "fx_task_run_v1_identity_check" CHECK ("fx_system_durable_task_run_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and (("fx_system_durable_task_run_v1"."definition_generation" = 'legacy_definition_v1'
              and "fx_system_durable_task_run_v1"."task_definition_revision_id" is not null
              and "fx_system_durable_task_run_v1"."task_definition_revision_id" ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
                    and "fx_system_durable_task_run_v1"."execution_principal_retention" = 'run_lifetime'))))
        and "fx_system_durable_task_run_v1"."created_at_ms" between 0 and 9007199254740991);

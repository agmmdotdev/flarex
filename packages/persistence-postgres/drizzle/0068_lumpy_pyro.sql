ALTER TABLE "fx_system_durable_task_run_v1" DROP CONSTRAINT "fx_task_run_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "application_revision_id" text;--> statement-breakpoint
UPDATE "fx_system_durable_task_run_v1"
SET "application_revision_id" =
  convert_from("creation_authority_bytes", 'UTF8')::jsonb
    #>> '{authority,runtimeTarget,revisionId}'
WHERE "definition_generation" = 'application_v1';--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD CONSTRAINT "fx_task_run_v1_application_revision_fk" FOREIGN KEY ("scope_id","application_revision_id") REFERENCES "fx_system_application_revision_schema_v1"("scope_id","revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fx_action_invocation_v1_application_retirement_pin_idx" ON "fx_system_application_action_invocation_v1" USING btree ("scope_id","request_key") WHERE "fx_system_application_action_invocation_v1"."execution_authority_generation" = 'application_v1'
        and "fx_system_application_action_invocation_v1"."lifecycle" in ('admitted', 'executing');--> statement-breakpoint
CREATE INDEX "fx_task_run_v1_application_retirement_pin_idx" ON "fx_system_durable_task_run_v1" USING btree ("scope_id","run_id") WHERE "fx_system_durable_task_run_v1"."definition_generation" = 'application_v1'
        and ("fx_system_durable_task_run_v1"."aggregate_json" #>> '{aggregate,phase}')
          is distinct from 'terminal';--> statement-breakpoint
CREATE INDEX "fx_system_tx_session_application_retirement_pin_idx" ON "fx_system_tx_session" USING btree ("scope_uuid","session_id") WHERE "fx_system_tx_session"."execution_authority_generation" = 'application_v1'
        and "fx_system_tx_session"."lifecycle" in ('created', 'running', 'finishing', 'committing', 'retrying');--> statement-breakpoint
CREATE INDEX "fx_system_snapshot_lease_retirement_pin_idx" ON "fx_system_snapshot_lease" USING btree ("scope_uuid","lease_expires_at","session_id");--> statement-breakpoint
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
                    and "fx_system_durable_task_run_v1"."execution_principal_retention" = 'run_lifetime'))))
        and "fx_system_durable_task_run_v1"."created_at_ms" between 0 and 9007199254740991);

-- Add bounded trusted continuation checkpoints and separately journaled callbacks. Existing Task/effect rows and committed history are retained.
CREATE TABLE "fx_system_trusted_workflow_checkpoint" (
  "scope_id" text NOT NULL,
  "run_id" text NOT NULL,
  "binding_sha256" bytea NOT NULL,
  "revision" bigint NOT NULL,
  "codec" text NOT NULL,
  "byte_length" integer NOT NULL,
  "sha256" bytea NOT NULL,
  "bytes" bytea NOT NULL,
  CONSTRAINT "fx_workflow_checkpoint_pk" PRIMARY KEY ("scope_id", "run_id"),
  CONSTRAINT "fx_workflow_checkpoint_values_check" CHECK ("fx_system_trusted_workflow_checkpoint"."revision" > 0
    and "fx_system_trusted_workflow_checkpoint"."codec" ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
    and "fx_system_trusted_workflow_checkpoint"."byte_length" between 1 and 1048576
    and octet_length("fx_system_trusted_workflow_checkpoint"."bytes") = "fx_system_trusted_workflow_checkpoint"."byte_length"
    and octet_length("fx_system_trusted_workflow_checkpoint"."sha256") = 32 and octet_length("fx_system_trusted_workflow_checkpoint"."binding_sha256") = 32),
  CONSTRAINT "fx_workflow_checkpoint_run_fk" FOREIGN KEY ("scope_id", "run_id") REFERENCES "fx_system_durable_task_run_v1" ("scope_id", "run_id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "fx_workflow_checkpoint_binding_fk" FOREIGN KEY ("scope_id", "binding_sha256") REFERENCES "fx_system_trusted_workflow_task_binding" ("scope_id", "binding_sha256") ON DELETE restrict ON UPDATE restrict
);
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" DROP CONSTRAINT "fx_task_run_v1_projection_shape_check";
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD CONSTRAINT "fx_task_run_v1_projection_shape_check" CHECK ((
        ("fx_system_durable_task_run_v1"."phase" = 'ready'
          and "fx_system_durable_task_run_v1"."due_kind" = 'start_attempt'
          and "fx_system_durable_task_run_v1"."due_at_ms" is not null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is null
          and "fx_system_durable_task_run_v1"."current_lease_version" is null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" is null)
        or ("fx_system_durable_task_run_v1"."phase" = 'retry_waiting'
          and "fx_system_durable_task_run_v1"."due_kind" = 'start_attempt'
          and "fx_system_durable_task_run_v1"."due_at_ms" is not null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is null
          and "fx_system_durable_task_run_v1"."execution_fence_basis" is not null
          and "fx_system_durable_task_run_v1"."current_lease_version" is null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" is null)
        or ("fx_system_durable_task_run_v1"."definition_generation" = 'trusted_workflow'
          and "fx_system_durable_task_run_v1"."phase" in ('continuation_waiting', 'continuation_ready')
          and (("fx_system_durable_task_run_v1"."phase" = 'continuation_waiting' and "fx_system_durable_task_run_v1"."due_kind" = 'handle_continuation_timeout')
            or ("fx_system_durable_task_run_v1"."phase" = 'continuation_ready' and "fx_system_durable_task_run_v1"."due_kind" = 'start_attempt'))
          and "fx_system_durable_task_run_v1"."due_at_ms" is not null
          and "fx_system_durable_task_run_v1"."execution_fence_basis" is not null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is null
          and "fx_system_durable_task_run_v1"."current_lease_version" is null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" is null)
        or ("fx_system_durable_task_run_v1"."phase" in ('attempt_granted', 'executing')
          and "fx_system_durable_task_run_v1"."due_kind" = 'handle_lease_expiry'
          and "fx_system_durable_task_run_v1"."due_at_ms" is not null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is not null
          and "fx_system_durable_task_run_v1"."execution_fence_basis" is not null
          and "fx_system_durable_task_run_v1"."current_lease_version" is not null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" = "fx_system_durable_task_run_v1"."due_at_ms")
        or ("fx_system_durable_task_run_v1"."phase" = 'terminal'
          and "fx_system_durable_task_run_v1"."due_kind" is null
          and "fx_system_durable_task_run_v1"."due_at_ms" is null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is null
          and "fx_system_durable_task_run_v1"."execution_fence_basis" is null
          and "fx_system_durable_task_run_v1"."current_lease_version" is null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" is null)
      ));
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_id" text;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_revision" text;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_binding_sha256" bytea;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_input_json" jsonb;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_input_sha256" bytea;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_policy_json" jsonb;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_policy_sha256" bytea;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_outcome_json" jsonb;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "trusted_callback_outcome_sha256" bytea;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" DROP CONSTRAINT "fx_external_effect_attempt_v1_identity_check";
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_attempt_v1_identity_check" CHECK ("fx_system_external_effect_attempt_v1"."subject_kind" in ('direct_action', 'durable_task_attempt')
        and octet_length("fx_system_external_effect_attempt_v1"."subject_identity_sha256") = 32
        and "fx_system_external_effect_attempt_v1"."subject_fence" >= 1
        and "fx_system_external_effect_attempt_v1"."effect_ordinal" >= 1
        and "fx_system_external_effect_attempt_v1"."effect_kind" in ('outbound_http', 'child_mutation', 'child_commerce', 'trusted_callback')
        and btrim("fx_system_external_effect_attempt_v1"."stable_effect_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_external_effect_attempt_v1"."stable_effect_key", 'UTF8')) <= 2048
        and octet_length("fx_system_external_effect_attempt_v1"."request_identity_sha256") = 32);
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" DROP CONSTRAINT "fx_external_effect_attempt_v1_request_check";
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_attempt_v1_request_check" CHECK ((
        ("fx_system_external_effect_attempt_v1"."effect_kind" = 'outbound_http'
          and "fx_system_external_effect_attempt_v1"."request_store_identity" =
            'flarex.r2/execution-evidence-body/v1'
          and "fx_system_external_effect_attempt_v1"."request_codec_identity" =
            'flarex.codec/canonical-http-request/v1'
          and btrim("fx_system_external_effect_attempt_v1"."request_object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."request_object_key", 'UTF8')) <= 2048
          and "fx_system_external_effect_attempt_v1"."request_byte_length" >= 1
          and octet_length("fx_system_external_effect_attempt_v1"."request_sha256") = 32
          and "fx_system_external_effect_attempt_v1"."child_mutation_request_key" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_function_path" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_arguments_sha256" is null)
        or ("fx_system_external_effect_attempt_v1"."effect_kind" = 'child_mutation'
          and "fx_system_external_effect_attempt_v1"."request_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_object_key" is null
          and "fx_system_external_effect_attempt_v1"."request_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."request_sha256" is null
          and btrim("fx_system_external_effect_attempt_v1"."child_mutation_request_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."child_mutation_request_key", 'UTF8')) <= 2048
          and btrim("fx_system_external_effect_attempt_v1"."child_mutation_function_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."child_mutation_function_path", 'UTF8')) <= 2048
          and octet_length("fx_system_external_effect_attempt_v1"."child_mutation_arguments_sha256") = 32)
        or ("fx_system_external_effect_attempt_v1"."effect_kind" = 'child_commerce'
          and "fx_system_external_effect_attempt_v1"."subject_kind" = 'durable_task_attempt'
          and "fx_system_external_effect_attempt_v1"."effect_ordinal" between 1 and 16
          and "fx_system_external_effect_attempt_v1"."request_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_object_key" is null
          and "fx_system_external_effect_attempt_v1"."request_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."request_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_request_key" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_function_path" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_arguments_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_commerce_request_key" is not null
          and "fx_system_external_effect_attempt_v1"."child_commerce_request_key" = "fx_system_external_effect_attempt_v1"."stable_effect_key"
          and "fx_system_external_effect_attempt_v1"."child_commerce_command_name" is not null
          and "fx_system_external_effect_attempt_v1"."child_commerce_command_name" ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
          and "fx_system_external_effect_attempt_v1"."child_commerce_arguments_sha256" is not null
          and octet_length("fx_system_external_effect_attempt_v1"."child_commerce_arguments_sha256") = 32
          and "fx_system_external_effect_attempt_v1"."child_commerce_policy_sha256" is not null
          and octet_length("fx_system_external_effect_attempt_v1"."child_commerce_policy_sha256") = 32)
        or ("fx_system_external_effect_attempt_v1"."effect_kind" = 'trusted_callback'
          and "fx_system_external_effect_attempt_v1"."subject_kind" = 'durable_task_attempt'
          and "fx_system_external_effect_attempt_v1"."effect_ordinal" between 1 and 16
          and "fx_system_external_effect_attempt_v1"."request_store_identity" is null and "fx_system_external_effect_attempt_v1"."request_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_object_key" is null and "fx_system_external_effect_attempt_v1"."request_byte_length" is null and "fx_system_external_effect_attempt_v1"."request_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_request_key" is null and "fx_system_external_effect_attempt_v1"."child_mutation_function_path" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_arguments_sha256" is null)
      ));
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" DROP CONSTRAINT "fx_external_effect_attempt_v1_outcome_check";
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_attempt_v1_outcome_check" CHECK ((
        ("fx_system_external_effect_attempt_v1"."state" <> 'confirmed'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_object_key" is null
          and "fx_system_external_effect_attempt_v1"."response_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."response_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256" is null)
        or ("fx_system_external_effect_attempt_v1"."state" = 'confirmed'
          and "fx_system_external_effect_attempt_v1"."effect_kind" = 'outbound_http'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" =
            'flarex.r2/execution-evidence-body/v1'
          and "fx_system_external_effect_attempt_v1"."response_codec_identity" =
            'flarex.codec/canonical-http-response/v1'
          and btrim("fx_system_external_effect_attempt_v1"."response_object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."response_object_key", 'UTF8')) <= 2048
          and "fx_system_external_effect_attempt_v1"."response_byte_length" >= 1
          and octet_length("fx_system_external_effect_attempt_v1"."response_sha256") = 32
          and "fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256" is null)
        or ("fx_system_external_effect_attempt_v1"."state" = 'confirmed'
          and "fx_system_external_effect_attempt_v1"."effect_kind" = 'child_mutation'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_object_key" is null
          and "fx_system_external_effect_attempt_v1"."response_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."response_sha256" is null
          and octet_length("fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256") = 32)
        or ("fx_system_external_effect_attempt_v1"."state" = 'confirmed'
          and "fx_system_external_effect_attempt_v1"."effect_kind" = 'child_commerce'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_object_key" is null
          and "fx_system_external_effect_attempt_v1"."response_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."response_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_commerce_outcome_sha256" is not null
          and octet_length("fx_system_external_effect_attempt_v1"."child_commerce_outcome_sha256") = 32)
        or ("fx_system_external_effect_attempt_v1"."state" = 'confirmed' and "fx_system_external_effect_attempt_v1"."effect_kind" = 'trusted_callback'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" is null and "fx_system_external_effect_attempt_v1"."response_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_object_key" is null and "fx_system_external_effect_attempt_v1"."response_byte_length" is null and "fx_system_external_effect_attempt_v1"."response_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256" is null)
      ));
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_callback_columns_check" CHECK (
      ("fx_system_external_effect_attempt_v1"."effect_kind" <> 'trusted_callback'
        and "fx_system_external_effect_attempt_v1"."trusted_callback_id" is null and "fx_system_external_effect_attempt_v1"."trusted_callback_revision" is null
        and "fx_system_external_effect_attempt_v1"."trusted_callback_binding_sha256" is null and "fx_system_external_effect_attempt_v1"."trusted_callback_input_json" is null
        and "fx_system_external_effect_attempt_v1"."trusted_callback_input_sha256" is null and "fx_system_external_effect_attempt_v1"."trusted_callback_policy_json" is null
        and "fx_system_external_effect_attempt_v1"."trusted_callback_policy_sha256" is null and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json" is null
        and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_sha256" is null)
      or ("fx_system_external_effect_attempt_v1"."effect_kind" = 'trusted_callback'
        and "fx_system_external_effect_attempt_v1"."trusted_callback_id" is not null and "fx_system_external_effect_attempt_v1"."trusted_callback_id" ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
        and "fx_system_external_effect_attempt_v1"."trusted_callback_revision" is not null and "fx_system_external_effect_attempt_v1"."trusted_callback_revision" ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'
        and "fx_system_external_effect_attempt_v1"."trusted_callback_binding_sha256" is not null and octet_length("fx_system_external_effect_attempt_v1"."trusted_callback_binding_sha256") = 32
        and "fx_system_external_effect_attempt_v1"."trusted_callback_input_json" is not null
        and octet_length(convert_to("fx_system_external_effect_attempt_v1"."trusted_callback_input_json"::text, 'UTF8')) <= 262144
        and "fx_system_external_effect_attempt_v1"."trusted_callback_input_sha256" is not null and octet_length("fx_system_external_effect_attempt_v1"."trusted_callback_input_sha256") = 32
        and "fx_system_external_effect_attempt_v1"."trusted_callback_policy_json" is not null and jsonb_typeof("fx_system_external_effect_attempt_v1"."trusted_callback_policy_json") = 'object'
        and octet_length(convert_to("fx_system_external_effect_attempt_v1"."trusted_callback_policy_json"::text, 'UTF8')) <= 16384
        and "fx_system_external_effect_attempt_v1"."trusted_callback_policy_sha256" is not null and octet_length("fx_system_external_effect_attempt_v1"."trusted_callback_policy_sha256") = 32
        and (("fx_system_external_effect_attempt_v1"."state" = 'confirmed'
          and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json" is not null and jsonb_typeof("fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json") = 'object'
          and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json" ? 'kind'
          and jsonb_typeof("fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json"->'kind') = 'string'
          and (("fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json"->>'kind' = 'returned'
              and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json" ? 'value'
              and ("fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json" - 'kind' - 'value') = '{}'::jsonb)
            or ("fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json"->>'kind' = 'failed'
              and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json" ? 'error'
              and ("fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json" - 'kind' - 'error') = '{}'::jsonb))
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json"::text, 'UTF8')) <= 262144
          and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_sha256" is not null and octet_length("fx_system_external_effect_attempt_v1"."trusted_callback_outcome_sha256") = 32)
          or ("fx_system_external_effect_attempt_v1"."state" <> 'confirmed' and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_json" is null and "fx_system_external_effect_attempt_v1"."trusted_callback_outcome_sha256" is null))));
--> statement-breakpoint
CREATE UNIQUE INDEX "fx_external_effect_callback_key_idx" ON "fx_system_external_effect_attempt_v1" ("scope_uuid", "stable_effect_key") WHERE "effect_kind" = 'trusted_callback';
--> statement-breakpoint
DO $workflow_continuation_installation$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_trusted_workflow_checkpoint FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_require_active_installation()', target_schema);
END;
$workflow_continuation_installation$;

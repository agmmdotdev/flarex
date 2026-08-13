ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" DROP CONSTRAINT "fx_task_compute_dispatch_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" DROP CONSTRAINT "fx_task_run_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" ALTER COLUMN "task_definition_revision_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ALTER COLUMN "task_definition_revision_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" ADD COLUMN "definition_generation" text;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" ADD COLUMN "application_task_runtime_target_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "definition_generation" text;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD COLUMN "application_task_runtime_target_sha256" "bytea";--> statement-breakpoint
UPDATE "fx_system_durable_task_compute_dispatch_v1"
SET "definition_generation" = 'legacy_definition_v1';--> statement-breakpoint
UPDATE "fx_system_durable_task_run_v1"
SET "definition_generation" = 'legacy_definition_v1';--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" ALTER COLUMN "definition_generation" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ALTER COLUMN "definition_generation" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" ADD CONSTRAINT "fx_task_compute_dispatch_v1_identity_check" CHECK ("fx_system_durable_task_compute_dispatch_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_compute_dispatch_v1"."requested_effect_sequence" >= 1
        and "fx_system_durable_task_compute_dispatch_v1"."accepted_run_version" >= 1
        and (("fx_system_durable_task_compute_dispatch_v1"."definition_generation" = 'legacy_definition_v1'
              and "fx_system_durable_task_compute_dispatch_v1"."task_definition_revision_id" is not null
              and "fx_system_durable_task_compute_dispatch_v1"."task_definition_revision_id" ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              and "fx_system_durable_task_compute_dispatch_v1"."application_task_runtime_target_sha256" is null)
          or ("fx_system_durable_task_compute_dispatch_v1"."definition_generation" = 'application_v1'
              and "fx_system_durable_task_compute_dispatch_v1"."task_definition_revision_id" is null
              and "fx_system_durable_task_compute_dispatch_v1"."application_task_runtime_target_sha256" is not null
              and octet_length("fx_system_durable_task_compute_dispatch_v1"."application_task_runtime_target_sha256") = 32))
        and "fx_system_durable_task_compute_dispatch_v1"."attempt_id" ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_compute_dispatch_v1"."attempt_number" between 1 and 250
        and "fx_system_durable_task_compute_dispatch_v1"."execution_fence" >= 1
        and "fx_system_durable_task_compute_dispatch_v1"."lease_version" >= 1
        and "fx_system_durable_task_compute_dispatch_v1"."compute_profile_codec_version" = 1
        and "fx_system_durable_task_compute_dispatch_v1"."compute_profile_byte_length" between 2 and 510
        and "fx_system_durable_task_compute_dispatch_v1"."compute_profile_byte_length" % 2 = 0
        and octet_length("fx_system_durable_task_compute_dispatch_v1"."compute_profile_bytes") = "fx_system_durable_task_compute_dispatch_v1"."compute_profile_byte_length"
        and "fx_system_durable_task_compute_dispatch_v1"."maximum_duration_ms" between 1 and 9007199254740991
        and (("fx_system_durable_task_compute_dispatch_v1"."cancellation_kind" = 'not_requested'
              and "fx_system_durable_task_compute_dispatch_v1"."cancellation_generation" = 0)
          or ("fx_system_durable_task_compute_dispatch_v1"."cancellation_kind" = 'requested'
              and "fx_system_durable_task_compute_dispatch_v1"."cancellation_generation" >= 1)));--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD CONSTRAINT "fx_task_run_v1_identity_check" CHECK ("fx_system_durable_task_run_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and (("fx_system_durable_task_run_v1"."definition_generation" = 'legacy_definition_v1'
              and "fx_system_durable_task_run_v1"."task_definition_revision_id" is not null
              and "fx_system_durable_task_run_v1"."task_definition_revision_id" ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              and "fx_system_durable_task_run_v1"."application_task_runtime_target_sha256" is null)
          or ("fx_system_durable_task_run_v1"."definition_generation" = 'application_v1'
              and "fx_system_durable_task_run_v1"."task_definition_revision_id" is null
              and "fx_system_durable_task_run_v1"."application_task_runtime_target_sha256" is not null
              and octet_length("fx_system_durable_task_run_v1"."application_task_runtime_target_sha256") = 32))
        and "fx_system_durable_task_run_v1"."created_at_ms" between 0 and 9007199254740991);

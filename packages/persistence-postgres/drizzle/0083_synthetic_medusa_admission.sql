ALTER TABLE "fx_system_framework_migration_plan_admission" DROP CONSTRAINT "fx_framework_migration_admission_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_admission" ADD CONSTRAINT "fx_framework_migration_admission_identity_check" CHECK ("fx_system_framework_migration_plan_admission"."admission_storage_id" between 1 and 9223372036854775807
        and octet_length("fx_system_framework_migration_plan_admission"."migration_plan_sha256") = 32
        and octet_length("fx_system_framework_migration_plan_admission"."admission_sha256") = 32
        and (
          ("fx_system_framework_migration_plan_admission"."previous_plan_storage_id" is null
            and "fx_system_framework_migration_plan_admission"."previous_plan_sha256" is null)
          or
          ("fx_system_framework_migration_plan_admission"."previous_plan_storage_id" is not null
            and "fx_system_framework_migration_plan_admission"."previous_plan_sha256" is not null
            and octet_length("fx_system_framework_migration_plan_admission"."previous_plan_sha256") = 32)
        )
        and (("fx_system_framework_migration_plan_admission"."frame_version" = 1 and "fx_system_framework_migration_plan_admission"."admission_profile" in ('synthetic-system-fresh', 'synthetic-medusa-fresh'))
          or ("fx_system_framework_migration_plan_admission"."frame_version" = 2 and "fx_system_framework_migration_plan_admission"."admission_profile" = 'synthetic-system-additive'
            and "fx_system_framework_migration_plan_admission"."previous_plan_storage_id" is not null))
        and "fx_system_framework_migration_plan_admission"."assignment_count" between 0 and 131328);
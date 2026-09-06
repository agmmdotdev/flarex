ALTER TABLE "fx_system_framework_migration_collision_domain" DROP CONSTRAINT "fx_framework_migration_collision_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_admission" DROP CONSTRAINT "fx_framework_migration_admission_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_domain" ADD CONSTRAINT "fx_framework_migration_collision_identity_check" CHECK ("fx_system_framework_migration_collision_domain"."collision_storage_id" between 1 and 9223372036854775807
        and "fx_system_framework_migration_collision_domain"."owner" in ('medusa', 'system', 'payload')
        and
    octet_length(convert_to("fx_system_framework_migration_collision_domain"."lineage_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_collision_domain"."lineage_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

        and "fx_system_framework_migration_collision_domain"."physical_namespace_profile" = 'relational-postgres-scope-isolated-stable-names');--> statement-breakpoint
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
        and (("fx_system_framework_migration_plan_admission"."frame_version" = 1 and "fx_system_framework_migration_plan_admission"."admission_profile" in ('synthetic-system-fresh', 'synthetic-medusa-fresh', 'payload-preferences-fresh'))
          or ("fx_system_framework_migration_plan_admission"."frame_version" = 2 and "fx_system_framework_migration_plan_admission"."admission_profile" = 'synthetic-system-additive'
            and "fx_system_framework_migration_plan_admission"."previous_plan_storage_id" is not null))
        and "fx_system_framework_migration_plan_admission"."assignment_count" between 0 and 131328);
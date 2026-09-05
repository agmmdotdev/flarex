
ALTER TABLE "fx_system_framework_schema_installation" ADD CONSTRAINT "fx_framework_installation_base_context_unique" UNIQUE("installation_storage_id","collision_storage_id","plan_storage_id","installed_structure_sha256");--> statement-breakpointCREATE TABLE "fx_system_framework_migration_plan_base" (
	"plan_storage_id" bigint NOT NULL,
	"collision_storage_id" bigint NOT NULL,
	"base_plan_storage_id" bigint NOT NULL,
	"installation_storage_id" bigint NOT NULL,
	"installation_sha256" "bytea" NOT NULL,
	"installation_receipt_sha256" "bytea" NOT NULL,
	"readiness_storage_id" bigint NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"physical_layout_sha256" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_base_pk" PRIMARY KEY("plan_storage_id"),
	CONSTRAINT "fx_framework_migration_base_identity_check" CHECK ("fx_system_framework_migration_plan_base"."plan_storage_id" <> "fx_system_framework_migration_plan_base"."base_plan_storage_id"
    and octet_length("fx_system_framework_migration_plan_base"."installation_sha256") = 32
    and octet_length("fx_system_framework_migration_plan_base"."installation_receipt_sha256") = 32
    and octet_length("fx_system_framework_migration_plan_base"."readiness_sha256") = 32
    and octet_length("fx_system_framework_migration_plan_base"."physical_layout_sha256") = 32)
);
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_admission" DROP CONSTRAINT "fx_framework_migration_admission_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_admission" DROP CONSTRAINT "fx_framework_migration_admission_frame_check";--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_step" DROP CONSTRAINT "fx_framework_migration_plan_step_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan" DROP CONSTRAINT "fx_framework_migration_plan_frame_check";--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_base" ADD CONSTRAINT "fx_framework_migration_base_candidate_fk" FOREIGN KEY ("plan_storage_id","collision_storage_id") REFERENCES "fx_system_framework_migration_plan"("plan_storage_id","collision_storage_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_base" ADD CONSTRAINT "fx_framework_migration_base_installation_fk" FOREIGN KEY ("installation_storage_id","installation_sha256","installation_receipt_sha256") REFERENCES "fx_system_framework_schema_installation"("installation_storage_id","installation_sha256","installation_receipt_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_base" ADD CONSTRAINT "fx_framework_migration_base_context_fk" FOREIGN KEY ("installation_storage_id","collision_storage_id","base_plan_storage_id","physical_layout_sha256") REFERENCES "fx_system_framework_schema_installation"("installation_storage_id","collision_storage_id","plan_storage_id","installed_structure_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_base" ADD CONSTRAINT "fx_framework_migration_base_readiness_fk" FOREIGN KEY ("readiness_storage_id","installation_storage_id","readiness_sha256") REFERENCES "fx_system_framework_schema_readiness"("readiness_storage_id","installation_storage_id","readiness_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
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
        and (("fx_system_framework_migration_plan_admission"."frame_version" = 1 and "fx_system_framework_migration_plan_admission"."admission_profile" = 'synthetic-system-fresh')
          or ("fx_system_framework_migration_plan_admission"."frame_version" = 2 and "fx_system_framework_migration_plan_admission"."admission_profile" = 'synthetic-system-additive'
            and "fx_system_framework_migration_plan_admission"."previous_plan_storage_id" is not null))
        and "fx_system_framework_migration_plan_admission"."assignment_count" between 0 and 131328);--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_admission" ADD CONSTRAINT "fx_framework_migration_admission_frame_check" CHECK ("fx_system_framework_migration_plan_admission"."frame_format" = 'flarex.framework-migration-plan-admission'
        and "fx_system_framework_migration_plan_admission"."frame_version" in (1, 2)
        and
    "fx_system_framework_migration_plan_admission"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_migration_plan_admission"."canonical_bytes") = "fx_system_framework_migration_plan_admission"."canonical_byte_length"
  );--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_step" ADD CONSTRAINT "fx_framework_migration_plan_step_identity_check" CHECK ("fx_system_framework_migration_plan_step"."step_ordinal" between 0 and 65999
        and "fx_system_framework_migration_plan_step"."step_id" ~ '^step_[0-9a-f]{32}$'
        and octet_length("fx_system_framework_migration_plan_step"."step_sha256") = 32
        and octet_length("fx_system_framework_migration_plan_step"."precondition_sha256") = 32
        and octet_length("fx_system_framework_migration_plan_step"."postcondition_sha256") = 32
        and "fx_system_framework_migration_plan_step"."phase" in ('expansion', 'validation')
        and "fx_system_framework_migration_plan_step"."operation_format" in (
          'flarex.relational-create-table',
          'flarex.relational-create-index',
          'flarex.relational-add-foreign-key',
          'flarex.relational-validate-structure', 'flarex.relational-verify-base-structure'
        )
        and "fx_system_framework_migration_plan_step"."operation_version" = 1
        and "fx_system_framework_migration_plan_step"."dependency_count" between 0 and 65999);--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan" ADD CONSTRAINT "fx_framework_migration_plan_frame_check" CHECK ("fx_system_framework_migration_plan"."frame_format" = 'flarex.framework-migration-plan'
        and "fx_system_framework_migration_plan"."frame_version" in (1, 2)
        and
    "fx_system_framework_migration_plan"."canonical_byte_length" between 1 and 8388608
    and octet_length("fx_system_framework_migration_plan"."canonical_bytes") = "fx_system_framework_migration_plan"."canonical_byte_length"
  );
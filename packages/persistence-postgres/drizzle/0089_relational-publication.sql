CREATE TABLE "fx_system_commit_relational_change" (
	"scope_uuid" uuid NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"change_ordinal" integer NOT NULL,
	"codec_version" integer NOT NULL,
	"installation_sha256" text NOT NULL,
	"artifact_sha256" text NOT NULL,
	"table_id" text NOT NULL,
	"key_bytes" "bytea" NOT NULL,
	"operation" text NOT NULL,
	CONSTRAINT "fx_system_commit_relational_change_scope_uuid_commit_seq_change_ordinal_pk" PRIMARY KEY("scope_uuid","commit_seq","change_ordinal"),
	CONSTRAINT "fx_commit_relational_values_check" CHECK ("fx_system_commit_relational_change"."codec_version" = 1 and "fx_system_commit_relational_change"."change_ordinal" between 0 and 15999
    and "fx_system_commit_relational_change"."installation_sha256" ~ '^[0-9a-f]{64}$' and "fx_system_commit_relational_change"."artifact_sha256" ~ '^[0-9a-f]{64}$'
    and octet_length("fx_system_commit_relational_change"."table_id") between 1 and 1024 and octet_length("fx_system_commit_relational_change"."key_bytes") between 1 and 4096
    and "fx_system_commit_relational_change"."operation" in ('insert', 'update', 'delete'))
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_initialization" (
	"scope_uuid" uuid NOT NULL,
	"installation_sha256" text NOT NULL,
	"artifact_sha256" text NOT NULL,
	"step_id" text NOT NULL,
	"contract_sha256" text NOT NULL,
	"dataset_sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"commit_seq" bigint NOT NULL,
	CONSTRAINT "fx_system_framework_initialization_scope_uuid_installation_sha256_step_id_pk" PRIMARY KEY("scope_uuid","installation_sha256","step_id"),
	CONSTRAINT "fx_framework_initialization_values_check" CHECK ("fx_system_framework_initialization"."installation_sha256" ~ '^[0-9a-f]{64}$' and "fx_system_framework_initialization"."artifact_sha256" ~ '^[0-9a-f]{64}$'
    and "fx_system_framework_initialization"."dataset_sha256" ~ '^[0-9a-f]{64}$' and "fx_system_framework_initialization"."contract_sha256" ~ '^[0-9a-f]{64}$'
    and octet_length("fx_system_framework_initialization"."step_id") between 1 and 1024 and "fx_system_framework_initialization"."row_count" >= 0 and "fx_system_framework_initialization"."commit_seq" > 0)
);
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_admission" DROP CONSTRAINT "fx_framework_migration_admission_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD COLUMN "relational_change_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_commit_relational_change" ADD CONSTRAINT "fx_commit_relational_header_fk" FOREIGN KEY ("scope_uuid","epoch_uuid","commit_seq") REFERENCES "fx_system_commit"("scope_uuid","epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_initialization" ADD CONSTRAINT "fx_framework_initialization_scope_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD CONSTRAINT "fx_system_commit_relational_change_count_check" CHECK ("fx_system_commit"."relational_change_count" between 0 and 16000);--> statement-breakpoint
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
        and (("fx_system_framework_migration_plan_admission"."frame_version" = 1 and "fx_system_framework_migration_plan_admission"."admission_profile" in ('synthetic-system-fresh', 'synthetic-medusa-fresh', 'payload-preferences-fresh', 'registered-commerce-fresh'))
          or ("fx_system_framework_migration_plan_admission"."frame_version" = 2 and "fx_system_framework_migration_plan_admission"."admission_profile" = 'synthetic-system-additive'
            and "fx_system_framework_migration_plan_admission"."previous_plan_storage_id" is not null))
        and "fx_system_framework_migration_plan_admission"."assignment_count" between 0 and 131328);
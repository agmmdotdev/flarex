-- Development replacement: preserve claims and Application data; new physical workspaces
-- start unserved and must drain/populate/validate before granting unique readiness.
CREATE TABLE "fx_system_unique_constraint_build" (
	"scope_id" text NOT NULL,
	"unique_constraint_definition_id" integer NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"start_commit_seq" bigint NOT NULL,
	"lifecycle" text NOT NULL,
	"covered_through_commit_seq" bigint,
	"cursor_row_id" "bytea",
	"attempt_fence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_unique_build_pk" PRIMARY KEY("scope_id","unique_constraint_definition_id"),
	CONSTRAINT "fx_system_unique_build_scope_check" CHECK (btrim("fx_system_unique_constraint_build"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_unique_build_identity_check" CHECK ("fx_system_unique_constraint_build"."unique_constraint_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_system_unique_build_clock_check" CHECK ("fx_system_unique_constraint_build"."storage_generation" = 'flarexdb_v1'
        and "fx_system_unique_constraint_build"."storage_generation_fence" >= 1
        and btrim("fx_system_unique_constraint_build"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_unique_constraint_build"."start_commit_seq" >= 0),
	CONSTRAINT "fx_system_unique_build_lifecycle_check" CHECK ("fx_system_unique_constraint_build"."lifecycle" in ('declared', 'building', 'backfilling', 'validating', 'enabled')),
	CONSTRAINT "fx_system_unique_build_cursor_check" CHECK (("fx_system_unique_constraint_build"."cursor_row_id" is null or octet_length("fx_system_unique_constraint_build"."cursor_row_id") = 16)
        and ("fx_system_unique_constraint_build"."lifecycle" not in ('declared', 'building', 'enabled')
          or "fx_system_unique_constraint_build"."cursor_row_id" is null)),
	CONSTRAINT "fx_system_unique_build_coverage_check" CHECK (("fx_system_unique_constraint_build"."covered_through_commit_seq" is null or "fx_system_unique_constraint_build"."covered_through_commit_seq" >= "fx_system_unique_constraint_build"."start_commit_seq")
        and ("fx_system_unique_constraint_build"."lifecycle" not in ('declared', 'building') or "fx_system_unique_constraint_build"."covered_through_commit_seq" is null)
        and ("fx_system_unique_constraint_build"."lifecycle" <> 'enabled' or "fx_system_unique_constraint_build"."covered_through_commit_seq" is not null)),
	CONSTRAINT "fx_system_unique_build_attempt_check" CHECK ("fx_system_unique_constraint_build"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_unique_build_time_check" CHECK (isfinite("fx_system_unique_constraint_build"."created_at") and isfinite("fx_system_unique_constraint_build"."updated_at")
        and "fx_system_unique_constraint_build"."updated_at" >= "fx_system_unique_constraint_build"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fx_system_unique_constraint_set_build" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "fx_system_unique_constraint_set_build";--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" DROP CONSTRAINT "fx_app_unique_key_schema_version_id_check";--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" DROP CONSTRAINT "fx_app_unique_key_commit_seq_check";--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" DROP CONSTRAINT "fx_app_unique_key_scope_clock_fk";
--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" DROP CONSTRAINT "fx_app_unique_key_row_revision_fk";
--> statement-breakpoint
ALTER TABLE "fx_system_unique_constraint_build" ADD CONSTRAINT "fx_system_unique_build_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" ADD CONSTRAINT "fx_app_unique_key_row_identity_fk" FOREIGN KEY ("scope_uuid","table_id","row_id") REFERENCES "fx_app_row_current"("scope_uuid","table_id","row_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" DROP COLUMN "schema_version_id";--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" DROP COLUMN "write_epoch_uuid";--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" DROP COLUMN "commit_seq";
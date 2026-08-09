CREATE TABLE "fx_control_schema_unique_constraint_set" (
	"deployment_id" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"set_codec_version" integer NOT NULL,
	"definition_count" integer NOT NULL,
	"definition_set_sha256" "bytea" NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_schema_unique_set_pk" PRIMARY KEY("deployment_id","schema_version_id"),
	CONSTRAINT "fx_control_schema_unique_set_deployment_check" CHECK (btrim("fx_control_schema_unique_constraint_set"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_schema_unique_set_schema_check" CHECK (btrim("fx_control_schema_unique_constraint_set"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_schema_unique_set_codec_check" CHECK ("fx_control_schema_unique_constraint_set"."set_codec_version" = 1),
	CONSTRAINT "fx_control_schema_unique_set_count_check" CHECK ("fx_control_schema_unique_constraint_set"."definition_count" between 0 and 256),
	CONSTRAINT "fx_control_schema_unique_set_digest_check" CHECK (octet_length("fx_control_schema_unique_constraint_set"."definition_set_sha256") = 32),
	CONSTRAINT "fx_control_schema_unique_set_closed_at_check" CHECK (isfinite("fx_control_schema_unique_constraint_set"."closed_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_unique_constraint_set_build" (
	"scope_id" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"set_codec_version" integer NOT NULL,
	"definition_count" integer NOT NULL,
	"definition_set_sha256" "bytea" NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"start_commit_seq" bigint NOT NULL,
	"lifecycle" text NOT NULL,
	"cursor_codec_version" integer NOT NULL,
	"cursor_definition_id" integer,
	"cursor_row_id" "bytea",
	"attempt_fence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_unique_set_build_pk" PRIMARY KEY("scope_id","schema_version_id"),
	CONSTRAINT "fx_system_unique_set_build_scope_check" CHECK (btrim("fx_system_unique_constraint_set_build"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_unique_set_build_schema_check" CHECK (btrim("fx_system_unique_constraint_set_build"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_unique_set_build_identity_check" CHECK ("fx_system_unique_constraint_set_build"."set_codec_version" = 1
        and "fx_system_unique_constraint_set_build"."definition_count" between 0 and 256
        and octet_length("fx_system_unique_constraint_set_build"."definition_set_sha256") = 32),
	CONSTRAINT "fx_system_unique_set_build_clock_check" CHECK ("fx_system_unique_constraint_set_build"."storage_generation" = 'flarexdb_v1'
        and "fx_system_unique_constraint_set_build"."storage_generation_fence" >= 1
        and btrim("fx_system_unique_constraint_set_build"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_unique_constraint_set_build"."start_commit_seq" >= 0),
	CONSTRAINT "fx_system_unique_set_build_lifecycle_check" CHECK ("fx_system_unique_constraint_set_build"."lifecycle" in ('declared', 'building', 'backfilling', 'validating', 'enabled')),
	CONSTRAINT "fx_system_unique_set_build_cursor_check" CHECK ("fx_system_unique_constraint_set_build"."cursor_codec_version" = 1
        and ("fx_system_unique_constraint_set_build"."cursor_definition_id" is null or "fx_system_unique_constraint_set_build"."cursor_definition_id" between 1 and 2147483647)
        and ("fx_system_unique_constraint_set_build"."cursor_row_id" is null or octet_length("fx_system_unique_constraint_set_build"."cursor_row_id") = 16)
        and ("fx_system_unique_constraint_set_build"."cursor_definition_id" is not null or "fx_system_unique_constraint_set_build"."cursor_row_id" is null)
        and ("fx_system_unique_constraint_set_build"."lifecycle" not in ('declared', 'building', 'enabled')
          or ("fx_system_unique_constraint_set_build"."cursor_definition_id" is null and "fx_system_unique_constraint_set_build"."cursor_row_id" is null))),
	CONSTRAINT "fx_system_unique_set_build_attempt_check" CHECK ("fx_system_unique_constraint_set_build"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_unique_set_build_time_check" CHECK (isfinite("fx_system_unique_constraint_set_build"."created_at") and isfinite("fx_system_unique_constraint_set_build"."updated_at")
        and "fx_system_unique_constraint_set_build"."updated_at" >= "fx_system_unique_constraint_set_build"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fx_control_schema_unique_constraint_set" ADD CONSTRAINT "fx_control_schema_unique_set_schema_fk" FOREIGN KEY ("deployment_id","schema_version_id") REFERENCES "public"."fx_control_schema_version"("deployment_id","schema_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_unique_constraint_set_build" ADD CONSTRAINT "fx_system_unique_set_build_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;
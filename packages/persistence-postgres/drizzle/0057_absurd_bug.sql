CREATE TABLE "fx_system_app_schema_candidate_validation" (
	"scope_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_manifest_sha256" "bytea" NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"frontier_commit_seq" bigint NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"frame_codec_version" integer NOT NULL,
	"frame_kind" text NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_app_schema_candidate_validation_pk" PRIMARY KEY("scope_id"),
	CONSTRAINT "fx_system_app_schema_candidate_validation_identity_check" CHECK (btrim("fx_system_app_schema_candidate_validation"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_app_schema_candidate_validation"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_app_schema_candidate_validation"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_app_schema_candidate_validation"."schema_manifest_sha256") = 32),
	CONSTRAINT "fx_system_app_schema_candidate_validation_clock_check" CHECK ("fx_system_app_schema_candidate_validation"."storage_generation" = 'flarexdb_v1'
        and "fx_system_app_schema_candidate_validation"."storage_generation_fence" >= 1
        and btrim("fx_system_app_schema_candidate_validation"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_app_schema_candidate_validation"."frontier_commit_seq" >= 0
        and "fx_system_app_schema_candidate_validation"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_app_schema_candidate_validation_frame_check" CHECK ("fx_system_app_schema_candidate_validation"."frame_codec_version" = 1
        and "fx_system_app_schema_candidate_validation"."frame_kind" in (
          'app_schema_candidate_validation_progress',
          'app_schema_candidate_validation_failure_evidence',
          'app_schema_candidate_validation_receipt'
        )
        and "fx_system_app_schema_candidate_validation"."frame_byte_length" between 1 and 131072
        and octet_length("fx_system_app_schema_candidate_validation"."frame_bytes") = "fx_system_app_schema_candidate_validation"."frame_byte_length"
        and octet_length("fx_system_app_schema_candidate_validation"."frame_sha256") = 32),
	CONSTRAINT "fx_system_app_schema_candidate_validation_time_check" CHECK (isfinite("fx_system_app_schema_candidate_validation"."created_at") and isfinite("fx_system_app_schema_candidate_validation"."updated_at")
        and "fx_system_app_schema_candidate_validation"."updated_at" >= "fx_system_app_schema_candidate_validation"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fx_system_app_schema_candidate_validation" ADD CONSTRAINT "fx_system_app_schema_candidate_validation_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
CREATE UNIQUE INDEX "fx_app_row_rev_first_identity_unique" ON "fx_app_row_rev" USING btree ("scope_uuid","table_id","row_id") WHERE "fx_app_row_rev"."prev_commit_seq" is null;

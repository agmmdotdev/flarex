CREATE TABLE "fx_control_application_schema_authority_v1" (
	"deployment_id" text NOT NULL,
	"application_schema_sha256" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"status" text NOT NULL,
	"schema_manifest_sha256" "bytea",
	"binding_sha256" "bytea",
	"binding_bytes" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "fx_control_application_schema_authority_v1_deployment_id_application_schema_sha256_pk" PRIMARY KEY("deployment_id","application_schema_sha256"),
	CONSTRAINT "fx_application_schema_authority_v1_version_id_unique" UNIQUE("deployment_id","schema_version_id"),
	CONSTRAINT "fx_application_schema_authority_v1_version_unique" UNIQUE("deployment_id","schema_version"),
	CONSTRAINT "fx_application_schema_authority_v1_binding_unique" UNIQUE("deployment_id","application_schema_sha256","schema_version_id","schema_version"),
	CONSTRAINT "fx_application_schema_authority_v1_identity_check" CHECK (btrim("fx_control_application_schema_authority_v1"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_control_application_schema_authority_v1"."application_schema_sha256") = 32
        and btrim("fx_control_application_schema_authority_v1"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_control_application_schema_authority_v1"."schema_version" between 1 and 2147483647),
	CONSTRAINT "fx_application_schema_authority_v1_state_check" CHECK ((
          "fx_control_application_schema_authority_v1"."status" = 'reserved'
          and "fx_control_application_schema_authority_v1"."schema_manifest_sha256" is null
          and "fx_control_application_schema_authority_v1"."binding_sha256" is null
          and "fx_control_application_schema_authority_v1"."binding_bytes" is null
          and "fx_control_application_schema_authority_v1"."published_at" is null
        ) or (
          "fx_control_application_schema_authority_v1"."status" = 'published'
          and octet_length("fx_control_application_schema_authority_v1"."schema_manifest_sha256") = 32
          and octet_length("fx_control_application_schema_authority_v1"."binding_sha256") = 32
          and octet_length("fx_control_application_schema_authority_v1"."binding_bytes") between 1 and 1048576
          and "fx_control_application_schema_authority_v1"."published_at" is not null
        )),
	CONSTRAINT "fx_application_schema_authority_v1_time_check" CHECK (isfinite("fx_control_application_schema_authority_v1"."created_at")
        and ("fx_control_application_schema_authority_v1"."published_at" is null or (
          isfinite("fx_control_application_schema_authority_v1"."published_at") and "fx_control_application_schema_authority_v1"."published_at" >= "fx_control_application_schema_authority_v1"."created_at"
        )))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_readiness_function_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"function_path" text NOT NULL,
	"runtime_target_sha256" "bytea" NOT NULL,
	"cold_receipt_sha256" "bytea" NOT NULL,
	"cold_receipt_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_application_readiness_function_v1_scope_id_revision_id_function_path_pk" PRIMARY KEY("scope_id","revision_id","function_path"),
	CONSTRAINT "fx_application_readiness_function_v1_receipt_unique" UNIQUE("scope_id","revision_id","readiness_sha256","cold_receipt_sha256"),
	CONSTRAINT "fx_application_readiness_function_v1_identity_check" CHECK (btrim("fx_system_application_readiness_function_v1"."function_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_readiness_function_v1"."readiness_sha256") = 32
        and octet_length("fx_system_application_readiness_function_v1"."runtime_target_sha256") = 32
        and octet_length("fx_system_application_readiness_function_v1"."cold_receipt_sha256") = 32
        and octet_length("fx_system_application_readiness_function_v1"."cold_receipt_bytes") between 1 and 16384)
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_readiness_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"source_artifact_root_sha256" "bytea" NOT NULL,
	"manifest_sha256" "bytea" NOT NULL,
	"publication_sha256" "bytea" NOT NULL,
	"application_schema_sha256" "bytea" NOT NULL,
	"function_catalog_sha256" "bytea" NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_manifest_sha256" "bytea" NOT NULL,
	"schema_binding_sha256" "bytea" NOT NULL,
	"task_catalog_binding_sha256" "bytea" NOT NULL,
	"runtime_host_identity" text NOT NULL,
	"compatibility_date" text NOT NULL,
	"cold_receipt_set_sha256" "bytea" NOT NULL,
	"candidate_validation_receipt_sha256" "bytea" NOT NULL,
	"unique_constraint_status" text NOT NULL,
	"unique_constraint_eligibility_sha256" "bytea" NOT NULL,
	"physical_readiness_sha256" "bytea" NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"readiness_bytes" "bytea" NOT NULL,
	"ready_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_readiness_v1_scope_id_revision_id_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_readiness_v1_receipt_unique" UNIQUE("scope_id","readiness_sha256"),
	CONSTRAINT "fx_application_readiness_v1_child_unique" UNIQUE("scope_id","revision_id","readiness_sha256"),
	CONSTRAINT "fx_application_readiness_v1_identity_check" CHECK (btrim("fx_system_application_readiness_v1"."revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_readiness_v1"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_readiness_v1"."candidate_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_readiness_v1"."analysis_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_readiness_v1"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."manifest_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."publication_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."application_schema_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."function_catalog_sha256") = 32
        and "fx_system_application_readiness_v1"."storage_generation" = 'flarexdb_v1'
        and "fx_system_application_readiness_v1"."storage_generation_fence" >= 1
        and btrim("fx_system_application_readiness_v1"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_readiness_v1"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_readiness_v1"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."schema_binding_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."task_catalog_binding_sha256") = 32
        and btrim("fx_system_application_readiness_v1"."runtime_host_identity", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_readiness_v1"."compatibility_date" ~ '^\d{4}-\d{2}-\d{2}$'
        and octet_length("fx_system_application_readiness_v1"."cold_receipt_set_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."candidate_validation_receipt_sha256") = 32
        and "fx_system_application_readiness_v1"."unique_constraint_status" in ('not_required', 'eligible')
        and octet_length("fx_system_application_readiness_v1"."unique_constraint_eligibility_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."physical_readiness_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."readiness_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."readiness_bytes") between 1 and 16777216),
	CONSTRAINT "fx_application_readiness_v1_time_check" CHECK (isfinite("fx_system_application_readiness_v1"."ready_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_revision_schema_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"application_schema_sha256" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"schema_manifest_sha256" "bytea" NOT NULL,
	"schema_binding_sha256" "bytea" NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_revision_schema_v1_scope_id_revision_id_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_revision_schema_v1_binding_unique" UNIQUE("scope_id","revision_id","application_schema_sha256","schema_version_id","schema_manifest_sha256","schema_binding_sha256"),
	CONSTRAINT "fx_application_revision_schema_v1_identity_check" CHECK (btrim("fx_system_application_revision_schema_v1"."revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_revision_schema_v1"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_revision_schema_v1"."application_schema_sha256") = 32
        and btrim("fx_system_application_revision_schema_v1"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_revision_schema_v1"."schema_version" between 1 and 2147483647
        and octet_length("fx_system_application_revision_schema_v1"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_revision_schema_v1"."schema_binding_sha256") = 32),
	CONSTRAINT "fx_application_revision_schema_v1_time_check" CHECK (isfinite("fx_system_application_revision_schema_v1"."bound_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_control_application_schema_authority_v1" ADD CONSTRAINT "fx_application_schema_authority_v1_deployment_fk" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("deployment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_function_v1" ADD CONSTRAINT "fx_application_readiness_function_v1_readiness_fk" FOREIGN KEY ("scope_id","revision_id","readiness_sha256") REFERENCES "fx_system_application_readiness_v1"("scope_id","revision_id","readiness_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_function_v1" ADD CONSTRAINT "fx_application_readiness_function_v1_function_fk" FOREIGN KEY ("scope_id","revision_id","function_path") REFERENCES "fx_system_application_function_v1"("scope_id","revision_id","function_path") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD CONSTRAINT "fx_application_readiness_v1_publication_fk" FOREIGN KEY ("scope_id","revision_id") REFERENCES "fx_system_application_publication_v1"("scope_id","revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD CONSTRAINT "fx_application_readiness_v1_schema_fk" FOREIGN KEY ("scope_id","revision_id","application_schema_sha256","schema_version_id","schema_manifest_sha256","schema_binding_sha256") REFERENCES "fx_system_application_revision_schema_v1"("scope_id","revision_id","application_schema_sha256","schema_version_id","schema_manifest_sha256","schema_binding_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD CONSTRAINT "fx_application_readiness_v1_task_fk" FOREIGN KEY ("scope_id","revision_id","task_catalog_binding_sha256") REFERENCES "fx_system_application_task_catalog_v1"("scope_id","revision_id","task_catalog_binding_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_revision_schema_v1" ADD CONSTRAINT "fx_application_revision_schema_v1_revision_fk" FOREIGN KEY ("scope_id","revision_id") REFERENCES "fx_system_application_revision_v2"("scope_id","revision_id") ON DELETE restrict ON UPDATE no action;

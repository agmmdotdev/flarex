CREATE TABLE "fx_system_application_analysis_v1" (
	"scope_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"source_artifact_root_sha256" "bytea" NOT NULL,
	"analyzer_identity" text NOT NULL,
	"analyzer_policy_identity" text NOT NULL,
	"status" text NOT NULL,
	"manifest_sha256" "bytea",
	"manifest_bytes" "bytea",
	"receipt_sha256" "bytea",
	"receipt_bytes" "bytea",
	"failure_code" text,
	"failure_detail" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_analysis_v1_scope_id_analysis_id_pk" PRIMARY KEY("scope_id","analysis_id"),
	CONSTRAINT "fx_application_analysis_v1_candidate_unique" UNIQUE("scope_id","candidate_id"),
	CONSTRAINT "fx_application_analysis_v1_terminal_unique" UNIQUE("scope_id","candidate_id","analysis_id","status","source_artifact_root_sha256","manifest_sha256"),
	CONSTRAINT "fx_application_analysis_v1_identity_check" CHECK (length("fx_system_application_analysis_v1"."analysis_id") between 1 and 256
        and length("fx_system_application_analysis_v1"."candidate_id") between 1 and 256
        and length("fx_system_application_analysis_v1"."analyzer_identity") between 1 and 256
        and length("fx_system_application_analysis_v1"."analyzer_policy_identity") between 1 and 256
        and octet_length("fx_system_application_analysis_v1"."source_artifact_root_sha256") = 32),
	CONSTRAINT "fx_application_analysis_v1_state_check" CHECK ((
          "fx_system_application_analysis_v1"."status" = 'pending'
          and "fx_system_application_analysis_v1"."manifest_sha256" is null
          and "fx_system_application_analysis_v1"."manifest_bytes" is null
          and "fx_system_application_analysis_v1"."receipt_sha256" is null
          and "fx_system_application_analysis_v1"."receipt_bytes" is null
          and "fx_system_application_analysis_v1"."failure_code" is null
          and "fx_system_application_analysis_v1"."failure_detail" is null
          and "fx_system_application_analysis_v1"."completed_at" is null
        ) or (
          "fx_system_application_analysis_v1"."status" = 'analyzed'
          and octet_length("fx_system_application_analysis_v1"."manifest_sha256") = 32
          and octet_length("fx_system_application_analysis_v1"."manifest_bytes") between 1 and 1048576
          and octet_length("fx_system_application_analysis_v1"."receipt_sha256") = 32
          and octet_length("fx_system_application_analysis_v1"."receipt_bytes") between 1 and 65536
          and "fx_system_application_analysis_v1"."failure_code" is null
          and "fx_system_application_analysis_v1"."failure_detail" is null
          and "fx_system_application_analysis_v1"."completed_at" is not null
        ) or (
          "fx_system_application_analysis_v1"."status" = 'rejected'
          and "fx_system_application_analysis_v1"."manifest_sha256" is null
          and "fx_system_application_analysis_v1"."manifest_bytes" is null
          and octet_length("fx_system_application_analysis_v1"."receipt_sha256") = 32
          and octet_length("fx_system_application_analysis_v1"."receipt_bytes") between 1 and 65536
          and "fx_system_application_analysis_v1"."failure_code" in (
            'invalid_source_artifact',
            'module_import_failed',
            'forbidden_import_effect',
            'invalid_registration',
            'invalid_schema',
            'limit_exceeded',
            'timeout',
            'nondeterministic_registration'
          )
          and "fx_system_application_analysis_v1"."failure_detail" is not null
          and octet_length(convert_to("fx_system_application_analysis_v1"."failure_detail", 'UTF8')) <= 8192
          and "fx_system_application_analysis_v1"."completed_at" is not null
        )),
	CONSTRAINT "fx_application_analysis_v1_time_check" CHECK (isfinite("fx_system_application_analysis_v1"."created_at")
        and isfinite("fx_system_application_analysis_v1"."updated_at")
        and "fx_system_application_analysis_v1"."updated_at" >= "fx_system_application_analysis_v1"."created_at"
        and ("fx_system_application_analysis_v1"."completed_at" is null or (
          isfinite("fx_system_application_analysis_v1"."completed_at") and "fx_system_application_analysis_v1"."completed_at" >= "fx_system_application_analysis_v1"."created_at"
        )))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_candidate_v1" (
	"scope_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"request_key" text NOT NULL,
	"source_artifact_root_sha256" "bytea" NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_candidate_v1_scope_id_candidate_id_pk" PRIMARY KEY("scope_id","candidate_id"),
	CONSTRAINT "fx_application_candidate_v1_request_unique" UNIQUE("scope_id","request_key"),
	CONSTRAINT "fx_application_candidate_v1_source_unique" UNIQUE("scope_id","candidate_id","source_artifact_root_sha256"),
	CONSTRAINT "fx_application_candidate_v1_identity_check" CHECK (length("fx_system_application_candidate_v1"."candidate_id") between 1 and 256
        and length("fx_system_application_candidate_v1"."request_key") between 1 and 256
        and octet_length("fx_system_application_candidate_v1"."source_artifact_root_sha256") = 32),
	CONSTRAINT "fx_application_candidate_v1_clock_check" CHECK ("fx_system_application_candidate_v1"."storage_generation" = 'flarexdb_v1'
        and "fx_system_application_candidate_v1"."storage_generation_fence" >= 1
        and btrim("fx_system_application_candidate_v1"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_application_candidate_v1_created_check" CHECK (isfinite("fx_system_application_candidate_v1"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_revision_v2" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"analysis_status" text NOT NULL,
	"source_artifact_root_sha256" "bytea" NOT NULL,
	"manifest_sha256" "bytea" NOT NULL,
	"status" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_revision_v2_scope_id_revision_id_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_revision_v2_revision_id_unique" UNIQUE("revision_id"),
	CONSTRAINT "fx_application_revision_v2_candidate_unique" UNIQUE("scope_id","candidate_id"),
	CONSTRAINT "fx_application_revision_v2_analysis_unique" UNIQUE("scope_id","analysis_id"),
	CONSTRAINT "fx_application_revision_v2_identity_check" CHECK (length("fx_system_application_revision_v2"."revision_id") between 1 and 256
        and length("fx_system_application_revision_v2"."candidate_id") between 1 and 256
        and length("fx_system_application_revision_v2"."analysis_id") between 1 and 256
        and octet_length("fx_system_application_revision_v2"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_revision_v2"."manifest_sha256") = 32),
	CONSTRAINT "fx_application_revision_v2_state_check" CHECK ("fx_system_application_revision_v2"."analysis_status" = 'analyzed' and "fx_system_application_revision_v2"."status" = 'inactive'),
	CONSTRAINT "fx_application_revision_v2_registered_check" CHECK (isfinite("fx_system_application_revision_v2"."registered_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_analysis_v1" ADD CONSTRAINT "fx_application_analysis_v1_candidate_fk" FOREIGN KEY ("scope_id","candidate_id","source_artifact_root_sha256") REFERENCES "fx_system_application_candidate_v1"("scope_id","candidate_id","source_artifact_root_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_candidate_v1" ADD CONSTRAINT "fx_application_candidate_v1_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_revision_v2" ADD CONSTRAINT "fx_application_revision_v2_analysis_fk" FOREIGN KEY ("scope_id","candidate_id","analysis_id","analysis_status","source_artifact_root_sha256","manifest_sha256") REFERENCES "fx_system_application_analysis_v1"("scope_id","candidate_id","analysis_id","status","source_artifact_root_sha256","manifest_sha256") ON DELETE restrict ON UPDATE no action;

CREATE TABLE "fx_system_application_function_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"function_catalog_sha256" "bytea" NOT NULL,
	"function_path" text NOT NULL,
	"module_name" text NOT NULL,
	"export_name" text NOT NULL,
	"function_kind" text NOT NULL,
	"visibility" text NOT NULL,
	"entry_sha256" "bytea" NOT NULL,
	"entry_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_application_function_v1_scope_id_revision_id_function_path_pk" PRIMARY KEY("scope_id","revision_id","function_path"),
	CONSTRAINT "fx_application_function_v1_entry_unique" UNIQUE("scope_id","revision_id","function_catalog_sha256","entry_sha256"),
	CONSTRAINT "fx_application_function_v1_identity_check" CHECK (length("fx_system_application_function_v1"."function_path") between 1 and 4096
        and length("fx_system_application_function_v1"."module_name") between 1 and 4096
        and length("fx_system_application_function_v1"."export_name") between 1 and 4096
        and (
          ("fx_system_application_function_v1"."export_name" = 'default' and "fx_system_application_function_v1"."function_path" = "fx_system_application_function_v1"."module_name")
          or ("fx_system_application_function_v1"."export_name" <> 'default' and "fx_system_application_function_v1"."function_path" = "fx_system_application_function_v1"."module_name" || ':' || "fx_system_application_function_v1"."export_name")
        )
        and "fx_system_application_function_v1"."function_kind" in ('query', 'mutation', 'workflowMutation', 'action')
        and "fx_system_application_function_v1"."visibility" in ('public', 'internal')
        and octet_length("fx_system_application_function_v1"."function_catalog_sha256") = 32
        and octet_length("fx_system_application_function_v1"."entry_sha256") = 32
        and octet_length("fx_system_application_function_v1"."entry_bytes") between 1 and 65536)
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_publication_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"revision_status" text NOT NULL,
	"source_artifact_root_sha256" "bytea" NOT NULL,
	"manifest_sha256" "bytea" NOT NULL,
	"schema_sha256" "bytea" NOT NULL,
	"schema_bytes" "bytea" NOT NULL,
	"function_catalog_sha256" "bytea" NOT NULL,
	"function_catalog_bytes" "bytea" NOT NULL,
	"publication_sha256" "bytea" NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_publication_v1_scope_id_revision_id_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_publication_v1_identity_unique" UNIQUE("scope_id","publication_sha256"),
	CONSTRAINT "fx_application_publication_v1_catalog_unique" UNIQUE("scope_id","revision_id","function_catalog_sha256"),
	CONSTRAINT "fx_application_publication_v1_identity_check" CHECK (length("fx_system_application_publication_v1"."revision_id") between 1 and 256
        and length("fx_system_application_publication_v1"."candidate_id") between 1 and 256
        and length("fx_system_application_publication_v1"."analysis_id") between 1 and 256
        and "fx_system_application_publication_v1"."revision_status" = 'inactive'
        and octet_length("fx_system_application_publication_v1"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_publication_v1"."manifest_sha256") = 32
        and octet_length("fx_system_application_publication_v1"."schema_sha256") = 32
        and octet_length("fx_system_application_publication_v1"."schema_bytes") between 1 and 1048576
        and octet_length("fx_system_application_publication_v1"."function_catalog_sha256") = 32
        and octet_length("fx_system_application_publication_v1"."function_catalog_bytes") between 1 and 1048576
        and octet_length("fx_system_application_publication_v1"."publication_sha256") = 32),
	CONSTRAINT "fx_application_publication_v1_published_check" CHECK (isfinite("fx_system_application_publication_v1"."published_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_function_v1" ADD CONSTRAINT "fx_application_function_v1_publication_fk" FOREIGN KEY ("scope_id","revision_id","function_catalog_sha256") REFERENCES "public"."fx_system_application_publication_v1"("scope_id","revision_id","function_catalog_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_revision_v2" ADD CONSTRAINT "fx_application_revision_v2_publication_unique" UNIQUE("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","manifest_sha256","status");--> statement-breakpoint
ALTER TABLE "fx_system_application_publication_v1" ADD CONSTRAINT "fx_application_publication_v1_revision_fk" FOREIGN KEY ("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","manifest_sha256","revision_status") REFERENCES "public"."fx_system_application_revision_v2"("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","manifest_sha256","status") ON DELETE restrict ON UPDATE no action;

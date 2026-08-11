CREATE TABLE "fx_system_application_task_catalog_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"source_artifact_root_sha256" "bytea" NOT NULL,
	"publication_sha256" "bytea" NOT NULL,
	"task_catalog_sha256" "bytea" NOT NULL,
	"task_catalog_binding_sha256" "bytea" NOT NULL,
	"task_count" integer NOT NULL,
	"runtime_host_identity" text NOT NULL,
	"compatibility_date" text NOT NULL,
	"binding_bytes" "bytea" NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_task_catalog_v1_scope_id_revision_id_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_task_catalog_v1_binding_unique" UNIQUE("scope_id","task_catalog_binding_sha256"),
	CONSTRAINT "fx_application_task_catalog_v1_child_fk_unique" UNIQUE("scope_id","revision_id","task_catalog_binding_sha256"),
	CONSTRAINT "fx_application_task_catalog_v1_identity_check" CHECK (length("fx_system_application_task_catalog_v1"."revision_id") between 1 and 256
        and length("fx_system_application_task_catalog_v1"."candidate_id") between 1 and 256
        and length("fx_system_application_task_catalog_v1"."analysis_id") between 1 and 256
        and length("fx_system_application_task_catalog_v1"."runtime_host_identity") between 1 and 256
        and "fx_system_application_task_catalog_v1"."compatibility_date" ~ '^\d{4}-\d{2}-\d{2}$'
        and octet_length("fx_system_application_task_catalog_v1"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_task_catalog_v1"."publication_sha256") = 32
        and octet_length("fx_system_application_task_catalog_v1"."task_catalog_sha256") = 32
        and octet_length("fx_system_application_task_catalog_v1"."task_catalog_binding_sha256") = 32
        and "fx_system_application_task_catalog_v1"."task_count" between 0 and 4096
        and octet_length("fx_system_application_task_catalog_v1"."binding_bytes") between 1 and 16777216),
	CONSTRAINT "fx_application_task_catalog_v1_registered_check" CHECK (isfinite("fx_system_application_task_catalog_v1"."registered_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_task_definition_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"task_catalog_binding_sha256" "bytea" NOT NULL,
	"task_definition_binding_sha256" "bytea" NOT NULL,
	"task_id" text NOT NULL,
	"canonical_task_manifest_sha256" "bytea" NOT NULL,
	"logical_module_path" text NOT NULL,
	"source_module_path" text NOT NULL,
	"export_name" text NOT NULL,
	"manifest_bytes" "bytea" NOT NULL,
	"binding_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_application_task_definition_v1_scope_id_revision_id_task_id_pk" PRIMARY KEY("scope_id","revision_id","task_id"),
	CONSTRAINT "fx_application_task_definition_v1_binding_unique" UNIQUE("scope_id","task_definition_binding_sha256"),
	CONSTRAINT "fx_application_task_definition_v1_identity_check" CHECK (octet_length(convert_to("fx_system_application_task_definition_v1"."task_id", 'UTF8')) between 1 and 255
        and octet_length(convert_to("fx_system_application_task_definition_v1"."logical_module_path", 'UTF8')) between 1 and 1024
        and octet_length(convert_to("fx_system_application_task_definition_v1"."source_module_path", 'UTF8')) between 1 and 1024
        and octet_length(convert_to("fx_system_application_task_definition_v1"."export_name", 'UTF8')) between 1 and 1024
        and octet_length("fx_system_application_task_definition_v1"."task_catalog_binding_sha256") = 32
        and octet_length("fx_system_application_task_definition_v1"."task_definition_binding_sha256") = 32
        and octet_length("fx_system_application_task_definition_v1"."canonical_task_manifest_sha256") = 32
        and octet_length("fx_system_application_task_definition_v1"."manifest_bytes") between 1 and 16777216
        and octet_length("fx_system_application_task_definition_v1"."binding_bytes") between 1 and 16777216)
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_publication_v1" ADD CONSTRAINT "fx_application_publication_v1_task_authority_unique" UNIQUE("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","publication_sha256");--> statement-breakpoint
ALTER TABLE "fx_system_application_task_catalog_v1" ADD CONSTRAINT "fx_application_task_catalog_v1_publication_fk" FOREIGN KEY ("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","publication_sha256") REFERENCES "fx_system_application_publication_v1"("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","publication_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_task_definition_v1" ADD CONSTRAINT "fx_application_task_definition_v1_catalog_fk" FOREIGN KEY ("scope_id","revision_id","task_catalog_binding_sha256") REFERENCES "fx_system_application_task_catalog_v1"("scope_id","revision_id","task_catalog_binding_sha256") ON DELETE restrict ON UPDATE no action;

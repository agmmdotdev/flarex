CREATE TABLE "fx_system_application_function" (
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
	CONSTRAINT "fx_application_function_pk" PRIMARY KEY("scope_id","revision_id","function_path"),
	CONSTRAINT "fx_application_function_entry_unique" UNIQUE("scope_id","revision_id","function_catalog_sha256","entry_sha256"),
	CONSTRAINT "fx_application_function_identity_check" CHECK (length("fx_system_application_function"."function_path") between 1 and 4096
        and length("fx_system_application_function"."module_name") between 1 and 4096
        and length("fx_system_application_function"."export_name") between 1 and 4096
        and "fx_system_application_function"."function_kind" in ('query', 'mutation', 'workflowMutation', 'action')
        and "fx_system_application_function"."visibility" in ('public', 'internal')
        and octet_length("fx_system_application_function"."function_catalog_sha256") = 32
        and octet_length("fx_system_application_function"."entry_sha256") = 32
        and octet_length("fx_system_application_function"."entry_bytes") between 1 and 65536)
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_publication" (
	"scope_id" text NOT NULL,
	"deployment_id" text NOT NULL,
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
	"schema_version_id" text NOT NULL,
	"schema_manifest_sha256" "bytea" NOT NULL,
	"manifest_schema_binding_sha256" "bytea" NOT NULL,
	"bound_publication_sha256" "bytea" NOT NULL,
	"publication_sha256" "bytea" NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_application_publication_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_publication_digest_unique" UNIQUE("scope_id","publication_sha256"),
	CONSTRAINT "fx_application_publication_catalog_unique" UNIQUE("scope_id","revision_id","function_catalog_sha256"),
	CONSTRAINT "fx_application_publication_task_unique" UNIQUE("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","publication_sha256"),
	CONSTRAINT "fx_application_publication_schema_unique" UNIQUE("scope_id","revision_id","manifest_sha256","schema_sha256","schema_version_id","schema_manifest_sha256","manifest_schema_binding_sha256","bound_publication_sha256","publication_sha256"),
	CONSTRAINT "fx_application_publication_identity_check" CHECK (length("fx_system_application_publication"."deployment_id") between 1 and 1024
        and length("fx_system_application_publication"."revision_id") between 1 and 256
        and length("fx_system_application_publication"."candidate_id") between 1 and 256
        and length("fx_system_application_publication"."analysis_id") between 1 and 256
        and "fx_system_application_publication"."revision_status" = 'inactive'
        and octet_length("fx_system_application_publication"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_publication"."manifest_sha256") = 32
        and octet_length("fx_system_application_publication"."schema_sha256") = 32
        and octet_length("fx_system_application_publication"."schema_bytes") between 1 and 1048576
        and octet_length("fx_system_application_publication"."function_catalog_sha256") = 32
        and octet_length("fx_system_application_publication"."function_catalog_bytes") between 1 and 1048576
        and length("fx_system_application_publication"."schema_version_id") between 1 and 1024
        and octet_length("fx_system_application_publication"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_publication"."manifest_schema_binding_sha256") = 32
        and octet_length("fx_system_application_publication"."bound_publication_sha256") = 32
        and octet_length("fx_system_application_publication"."publication_sha256") = 32),
	CONSTRAINT "fx_application_publication_time_check" CHECK (isfinite("fx_system_application_publication"."published_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_readiness" (
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
	"manifest_schema_binding_sha256" "bytea" NOT NULL,
	"bound_publication_sha256" "bytea" NOT NULL,
	"task_catalog_binding_sha256" "bytea" NOT NULL,
	"runtime_host_identity" text NOT NULL,
	"compatibility_date" text NOT NULL,
	"cold_receipt_set_sha256" "bytea" NOT NULL,
	"candidate_validation_receipt_sha256" "bytea" NOT NULL,
	"unique_constraint_status" text NOT NULL,
	"unique_constraint_eligibility_sha256" "bytea" NOT NULL,
	"physical_readiness_sha256" "bytea" NOT NULL,
	"relation_set_codec_version" integer NOT NULL,
	"relation_frontier_commit_seq" bigint NOT NULL,
	"relation_count" integer NOT NULL,
	"relation_set_readiness_sha256" "bytea" NOT NULL,
	"relation_set_readiness_bytes" "bytea" NOT NULL,
	"readiness_codec_version" integer NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"readiness_bytes" "bytea" NOT NULL,
	"ready_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_application_readiness_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_readiness_digest_unique" UNIQUE("scope_id","readiness_sha256"),
	CONSTRAINT "fx_application_readiness_child_unique" UNIQUE("scope_id","revision_id","readiness_sha256"),
	CONSTRAINT "fx_application_readiness_relation_unique" UNIQUE("scope_id","revision_id","readiness_sha256","relation_set_readiness_sha256","relation_count"),
	CONSTRAINT "fx_application_readiness_identity_check" CHECK (length("fx_system_application_readiness"."revision_id") between 1 and 256
        and length("fx_system_application_readiness"."deployment_id") between 1 and 1024
        and length("fx_system_application_readiness"."candidate_id") between 1 and 256
        and length("fx_system_application_readiness"."analysis_id") between 1 and 256
        and octet_length("fx_system_application_readiness"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_readiness"."manifest_sha256") = 32
        and octet_length("fx_system_application_readiness"."publication_sha256") = 32
        and octet_length("fx_system_application_readiness"."application_schema_sha256") = 32
        and octet_length("fx_system_application_readiness"."function_catalog_sha256") = 32
        and "fx_system_application_readiness"."storage_generation" = 'flarexdb_v1'
        and "fx_system_application_readiness"."storage_generation_fence" >= 1
        and length("fx_system_application_readiness"."epoch") between 1 and 1024
        and length("fx_system_application_readiness"."schema_version_id") between 1 and 1024
        and octet_length("fx_system_application_readiness"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_readiness"."manifest_schema_binding_sha256") = 32
        and octet_length("fx_system_application_readiness"."bound_publication_sha256") = 32
        and octet_length("fx_system_application_readiness"."task_catalog_binding_sha256") = 32
        and length("fx_system_application_readiness"."runtime_host_identity") between 1 and 1024
        and "fx_system_application_readiness"."compatibility_date" ~ '^\d{4}-\d{2}-\d{2}$'
        and octet_length("fx_system_application_readiness"."cold_receipt_set_sha256") = 32
        and octet_length("fx_system_application_readiness"."candidate_validation_receipt_sha256") = 32
        and "fx_system_application_readiness"."unique_constraint_status" in ('not_required', 'eligible')
        and octet_length("fx_system_application_readiness"."unique_constraint_eligibility_sha256") = 32
        and octet_length("fx_system_application_readiness"."physical_readiness_sha256") = 32
        and "fx_system_application_readiness"."relation_set_codec_version" = 1
        and "fx_system_application_readiness"."relation_frontier_commit_seq" >= 0
        and "fx_system_application_readiness"."relation_count" between 1 and 1024
        and octet_length("fx_system_application_readiness"."relation_set_readiness_sha256") = 32
        and octet_length("fx_system_application_readiness"."relation_set_readiness_bytes") between 1 and 1048576
        and "fx_system_application_readiness"."readiness_codec_version" = 2
        and octet_length("fx_system_application_readiness"."readiness_sha256") = 32
        and octet_length("fx_system_application_readiness"."readiness_bytes") between 1 and 16777216),
	CONSTRAINT "fx_application_readiness_time_check" CHECK (isfinite("fx_system_application_readiness"."ready_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_readiness_function" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"function_path" text NOT NULL,
	"runtime_target_sha256" "bytea" NOT NULL,
	"cold_receipt_sha256" "bytea" NOT NULL,
	"cold_receipt_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_application_readiness_function_pk" PRIMARY KEY("scope_id","revision_id","function_path"),
	CONSTRAINT "fx_application_readiness_function_receipt_unique" UNIQUE("scope_id","revision_id","readiness_sha256","cold_receipt_sha256"),
	CONSTRAINT "fx_application_readiness_function_identity_check" CHECK (length("fx_system_application_readiness_function"."function_path") between 1 and 4096
        and octet_length("fx_system_application_readiness_function"."readiness_sha256") = 32
        and octet_length("fx_system_application_readiness_function"."runtime_target_sha256") = 32
        and octet_length("fx_system_application_readiness_function"."cold_receipt_sha256") = 32
        and octet_length("fx_system_application_readiness_function"."cold_receipt_bytes") between 1 and 16384)
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_readiness_relation" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"relation_set_readiness_sha256" "bytea" NOT NULL,
	"relation_count" integer NOT NULL,
	"schema_version_id" text NOT NULL,
	"relation_ordinal" integer NOT NULL,
	"relation_id" integer NOT NULL,
	"source_table_id" integer NOT NULL,
	"target_table_id" integer NOT NULL,
	"semantic_definition_sha256" "bytea" NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"physical_definition_sha256" "bytea" NOT NULL,
	"readiness_kind" text NOT NULL,
	"physical_attempt_fence" bigint,
	"semantic_attempt_fence" bigint,
	"relation_readiness_sha256" "bytea" NOT NULL,
	CONSTRAINT "fx_application_readiness_relation_pk" PRIMARY KEY("scope_id","revision_id","relation_ordinal"),
	CONSTRAINT "fx_application_readiness_relation_digest_unique" UNIQUE("scope_id","revision_id","relation_readiness_sha256"),
	CONSTRAINT "fx_application_readiness_relation_identity_check" CHECK (length("fx_system_application_readiness_relation"."revision_id") between 1 and 256
        and length("fx_system_application_readiness_relation"."schema_version_id") between 1 and 1024
        and "fx_system_application_readiness_relation"."relation_count" between 1 and 1024
        and "fx_system_application_readiness_relation"."relation_ordinal" between 1 and "fx_system_application_readiness_relation"."relation_count"
        and "fx_system_application_readiness_relation"."relation_id" between 1 and 2147483647
        and "fx_system_application_readiness_relation"."source_table_id" between 1 and 2147483647
        and "fx_system_application_readiness_relation"."target_table_id" between 1 and 2147483647
        and "fx_system_application_readiness_relation"."edge_definition_id" between 1 and 2147483647
        and octet_length("fx_system_application_readiness_relation"."readiness_sha256") = 32
        and octet_length("fx_system_application_readiness_relation"."relation_set_readiness_sha256") = 32
        and octet_length("fx_system_application_readiness_relation"."semantic_definition_sha256") = 32
        and octet_length("fx_system_application_readiness_relation"."physical_definition_sha256") = 32
        and octet_length("fx_system_application_readiness_relation"."relation_readiness_sha256") = 32),
	CONSTRAINT "fx_application_readiness_relation_kind_check" CHECK ((
        ("fx_system_application_readiness_relation"."readiness_kind" = 'physical'
          and "fx_system_application_readiness_relation"."physical_attempt_fence" is not null
          and "fx_system_application_readiness_relation"."physical_attempt_fence" >= 1
          and "fx_system_application_readiness_relation"."semantic_attempt_fence" is null)
        or ("fx_system_application_readiness_relation"."readiness_kind" = 'semantic'
          and "fx_system_application_readiness_relation"."physical_attempt_fence" is null
          and "fx_system_application_readiness_relation"."semantic_attempt_fence" is not null
          and "fx_system_application_readiness_relation"."semantic_attempt_fence" >= 1)
      ))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_revision_schema" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"manifest_sha256" "bytea" NOT NULL,
	"publication_sha256" "bytea" NOT NULL,
	"application_schema_sha256" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"schema_manifest_sha256" "bytea" NOT NULL,
	"manifest_schema_binding_sha256" "bytea" NOT NULL,
	"bound_publication_sha256" "bytea" NOT NULL,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_application_revision_schema_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_revision_schema_binding_unique" UNIQUE("scope_id","revision_id","manifest_sha256","publication_sha256","application_schema_sha256","schema_version_id","schema_manifest_sha256","manifest_schema_binding_sha256","bound_publication_sha256"),
	CONSTRAINT "fx_application_revision_schema_identity_check" CHECK (length("fx_system_application_revision_schema"."revision_id") between 1 and 256
        and length("fx_system_application_revision_schema"."deployment_id") between 1 and 1024
        and octet_length("fx_system_application_revision_schema"."manifest_sha256") = 32
        and octet_length("fx_system_application_revision_schema"."publication_sha256") = 32
        and octet_length("fx_system_application_revision_schema"."application_schema_sha256") = 32
        and length("fx_system_application_revision_schema"."schema_version_id") between 1 and 1024
        and "fx_system_application_revision_schema"."schema_version" between 1 and 2147483647
        and octet_length("fx_system_application_revision_schema"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_revision_schema"."manifest_schema_binding_sha256") = 32
        and octet_length("fx_system_application_revision_schema"."bound_publication_sha256") = 32),
	CONSTRAINT "fx_application_revision_schema_time_check" CHECK (isfinite("fx_system_application_revision_schema"."bound_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_task_catalog" (
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
	CONSTRAINT "fx_application_task_catalog_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_task_catalog_binding_unique" UNIQUE("scope_id","task_catalog_binding_sha256"),
	CONSTRAINT "fx_application_task_catalog_child_unique" UNIQUE("scope_id","revision_id","task_catalog_binding_sha256"),
	CONSTRAINT "fx_application_task_catalog_identity_check" CHECK (length("fx_system_application_task_catalog"."revision_id") between 1 and 256
        and length("fx_system_application_task_catalog"."candidate_id") between 1 and 256
        and length("fx_system_application_task_catalog"."analysis_id") between 1 and 256
        and length("fx_system_application_task_catalog"."runtime_host_identity") between 1 and 1024
        and "fx_system_application_task_catalog"."compatibility_date" ~ '^\d{4}-\d{2}-\d{2}$'
        and octet_length("fx_system_application_task_catalog"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_task_catalog"."publication_sha256") = 32
        and octet_length("fx_system_application_task_catalog"."task_catalog_sha256") = 32
        and octet_length("fx_system_application_task_catalog"."task_catalog_binding_sha256") = 32
        and "fx_system_application_task_catalog"."task_count" between 0 and 4096
        and octet_length("fx_system_application_task_catalog"."binding_bytes") between 1 and 16777216),
	CONSTRAINT "fx_application_task_catalog_time_check" CHECK (isfinite("fx_system_application_task_catalog"."registered_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_task_definition" (
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
	CONSTRAINT "fx_application_task_definition_pk" PRIMARY KEY("scope_id","revision_id","task_id"),
	CONSTRAINT "fx_application_task_definition_binding_unique" UNIQUE("scope_id","task_definition_binding_sha256"),
	CONSTRAINT "fx_application_task_definition_identity_check" CHECK (octet_length(convert_to("fx_system_application_task_definition"."task_id", 'UTF8')) between 1 and 255
        and octet_length(convert_to("fx_system_application_task_definition"."logical_module_path", 'UTF8')) between 1 and 1024
        and octet_length(convert_to("fx_system_application_task_definition"."source_module_path", 'UTF8')) between 1 and 1024
        and octet_length(convert_to("fx_system_application_task_definition"."export_name", 'UTF8')) between 1 and 1024
        and octet_length("fx_system_application_task_definition"."task_catalog_binding_sha256") = 32
        and octet_length("fx_system_application_task_definition"."task_definition_binding_sha256") = 32
        and octet_length("fx_system_application_task_definition"."canonical_task_manifest_sha256") = 32
        and octet_length("fx_system_application_task_definition"."manifest_bytes") between 1 and 16777216
        and octet_length("fx_system_application_task_definition"."binding_bytes") between 1 and 16777216)
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_function" ADD CONSTRAINT "fx_application_function_publication_fk" FOREIGN KEY ("scope_id","revision_id","function_catalog_sha256") REFERENCES "fx_system_application_publication"("scope_id","revision_id","function_catalog_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_publication" ADD CONSTRAINT "fx_application_publication_revision_fk" FOREIGN KEY ("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","manifest_sha256","revision_status") REFERENCES "fx_system_application_revision_v2"("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","manifest_sha256","status") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness" ADD CONSTRAINT "fx_application_readiness_publication_fk" FOREIGN KEY ("scope_id","revision_id","manifest_sha256","application_schema_sha256","schema_version_id","schema_manifest_sha256","manifest_schema_binding_sha256","bound_publication_sha256","publication_sha256") REFERENCES "fx_system_application_publication"("scope_id","revision_id","manifest_sha256","schema_sha256","schema_version_id","schema_manifest_sha256","manifest_schema_binding_sha256","bound_publication_sha256","publication_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness" ADD CONSTRAINT "fx_application_readiness_schema_fk" FOREIGN KEY ("scope_id","revision_id","manifest_sha256","publication_sha256","application_schema_sha256","schema_version_id","schema_manifest_sha256","manifest_schema_binding_sha256","bound_publication_sha256") REFERENCES "fx_system_application_revision_schema"("scope_id","revision_id","manifest_sha256","publication_sha256","application_schema_sha256","schema_version_id","schema_manifest_sha256","manifest_schema_binding_sha256","bound_publication_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness" ADD CONSTRAINT "fx_application_readiness_task_fk" FOREIGN KEY ("scope_id","revision_id","task_catalog_binding_sha256") REFERENCES "fx_system_application_task_catalog"("scope_id","revision_id","task_catalog_binding_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_function" ADD CONSTRAINT "fx_application_readiness_function_readiness_fk" FOREIGN KEY ("scope_id","revision_id","readiness_sha256") REFERENCES "fx_system_application_readiness"("scope_id","revision_id","readiness_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_function" ADD CONSTRAINT "fx_application_readiness_function_function_fk" FOREIGN KEY ("scope_id","revision_id","function_path") REFERENCES "fx_system_application_function"("scope_id","revision_id","function_path") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_relation" ADD CONSTRAINT "fx_application_readiness_relation_root_fk" FOREIGN KEY ("scope_id","revision_id","readiness_sha256","relation_set_readiness_sha256","relation_count") REFERENCES "fx_system_application_readiness"("scope_id","revision_id","readiness_sha256","relation_set_readiness_sha256","relation_count") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_edge_definition_readiness" ADD CONSTRAINT "fx_system_edge_definition_readiness_receipt_unique" UNIQUE("scope_id","edge_definition_id","attempt_fence","readiness_sha256");--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_relation" ADD CONSTRAINT "fx_application_readiness_relation_physical_fk" FOREIGN KEY ("scope_id","edge_definition_id","physical_attempt_fence","relation_readiness_sha256") REFERENCES "fx_system_edge_definition_readiness"("scope_id","edge_definition_id","attempt_fence","readiness_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_relation" ADD CONSTRAINT "fx_application_readiness_relation_semantic_fk" FOREIGN KEY ("scope_id","schema_version_id","relation_ordinal","semantic_attempt_fence","relation_readiness_sha256") REFERENCES "fx_system_application_relation_semantic_readiness"("scope_id","schema_version_id","relation_ordinal","attempt_fence","readiness_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_revision_schema" ADD CONSTRAINT "fx_application_revision_schema_publication_fk" FOREIGN KEY ("scope_id","revision_id","manifest_sha256","application_schema_sha256","schema_version_id","schema_manifest_sha256","manifest_schema_binding_sha256","bound_publication_sha256","publication_sha256") REFERENCES "fx_system_application_publication"("scope_id","revision_id","manifest_sha256","schema_sha256","schema_version_id","schema_manifest_sha256","manifest_schema_binding_sha256","bound_publication_sha256","publication_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_task_catalog" ADD CONSTRAINT "fx_application_task_catalog_publication_fk" FOREIGN KEY ("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","publication_sha256") REFERENCES "fx_system_application_publication"("scope_id","revision_id","candidate_id","analysis_id","source_artifact_root_sha256","publication_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_task_definition" ADD CONSTRAINT "fx_application_task_definition_catalog_fk" FOREIGN KEY ("scope_id","revision_id","task_catalog_binding_sha256") REFERENCES "fx_system_application_task_catalog"("scope_id","revision_id","task_catalog_binding_sha256") ON DELETE restrict ON UPDATE no action;

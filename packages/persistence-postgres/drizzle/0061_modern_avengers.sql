CREATE TABLE "fx_system_application_task_runtime_object_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"receipt_sha256" "bytea" NOT NULL,
	"role" text NOT NULL,
	"ordinal" bigint NOT NULL,
	"store_identity" text NOT NULL,
	"codec_identity" text NOT NULL,
	"object_key" text NOT NULL,
	"byte_length" bigint NOT NULL,
	"sha256" "bytea" NOT NULL,
	CONSTRAINT "fx_system_application_task_runtime_object_v1_scope_id_revision_id_role_ordinal_pk" PRIMARY KEY("scope_id","revision_id","role","ordinal"),
	CONSTRAINT "fx_application_task_runtime_obj_v1_key_unique" UNIQUE("scope_id","revision_id","object_key"),
	CONSTRAINT "fx_application_task_runtime_obj_v1_shape_check" CHECK ("fx_system_application_task_runtime_object_v1"."role" in (
          'runtime_projection_module', 'task_runtime_projection',
          'task_runtime_entry', 'task_runtime_group_manifest',
          'task_runtime_materialization_spec'
        )
        and "fx_system_application_task_runtime_object_v1"."ordinal" between 0 and 8190
        and "fx_system_application_task_runtime_object_v1"."store_identity" = 'flarex.r2/standard-application-task-runtime/v1'
        and "fx_system_application_task_runtime_object_v1"."byte_length" between 1 and 134217728
        and octet_length("fx_system_application_task_runtime_object_v1"."sha256") = 32
        and octet_length(convert_to("fx_system_application_task_runtime_object_v1"."codec_identity", 'UTF8')) between 1 and 256
        and octet_length(convert_to("fx_system_application_task_runtime_object_v1"."object_key", 'UTF8')) between 1 and 512
        and "fx_system_application_task_runtime_object_v1"."object_key" = 'standard-application-task-runtime/v1/' || "fx_system_application_task_runtime_object_v1"."role" || '/' || encode("fx_system_application_task_runtime_object_v1"."sha256", 'hex')
        and (
          ("fx_system_application_task_runtime_object_v1"."role" = 'runtime_projection_module' and "fx_system_application_task_runtime_object_v1"."codec_identity" = 'flarex.standard-application/task-runtime-projection-module/v1')
          or ("fx_system_application_task_runtime_object_v1"."role" = 'task_runtime_projection' and "fx_system_application_task_runtime_object_v1"."codec_identity" = 'flarex.standard-application/task-runtime-projection/v1')
          or ("fx_system_application_task_runtime_object_v1"."role" = 'task_runtime_entry' and "fx_system_application_task_runtime_object_v1"."codec_identity" = 'flarex.standard-application/task-runtime-entry/v1')
          or ("fx_system_application_task_runtime_object_v1"."role" = 'task_runtime_group_manifest' and "fx_system_application_task_runtime_object_v1"."codec_identity" = 'flarex.standard-application/task-runtime-group-manifest/v1')
          or ("fx_system_application_task_runtime_object_v1"."role" = 'task_runtime_materialization_spec' and "fx_system_application_task_runtime_object_v1"."codec_identity" = 'flarex.standard-application/task-runtime-materialization-spec/v1')
        ))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_task_runtime_publication_v1" (
	"scope_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"analysis_id" text NOT NULL,
	"application_publication_sha256" "bytea" NOT NULL,
	"source_artifact_root_sha256" "bytea" NOT NULL,
	"task_catalog_sha256" "bytea" NOT NULL,
	"application_task_catalog_binding_sha256" "bytea" NOT NULL,
	"application_revision_task_binding_sha256" "bytea" NOT NULL,
	"task_entry_root_sha256" "bytea" NOT NULL,
	"task_runtime_projection_sha256" "bytea",
	"task_runtime_group_manifest_sha256" "bytea",
	"task_runtime_materialization_spec_sha256" "bytea",
	"object_count" integer NOT NULL,
	"receipt_sha256" "bytea" NOT NULL,
	"receipt_bytes" "bytea" NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_task_runtime_publication_v1_scope_id_revision_id_pk" PRIMARY KEY("scope_id","revision_id"),
	CONSTRAINT "fx_application_task_runtime_pub_v1_receipt_unique" UNIQUE("scope_id","receipt_sha256"),
	CONSTRAINT "fx_application_task_runtime_pub_v1_child_unique" UNIQUE("scope_id","revision_id","receipt_sha256"),
	CONSTRAINT "fx_application_task_runtime_pub_v1_identity_check" CHECK (octet_length(convert_to("fx_system_application_task_runtime_publication_v1"."revision_id", 'UTF8')) between 1 and 256
        and octet_length(convert_to("fx_system_application_task_runtime_publication_v1"."candidate_id", 'UTF8')) between 1 and 256
        and octet_length(convert_to("fx_system_application_task_runtime_publication_v1"."analysis_id", 'UTF8')) between 1 and 256
        and octet_length("fx_system_application_task_runtime_publication_v1"."application_publication_sha256") = 32
        and octet_length("fx_system_application_task_runtime_publication_v1"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_task_runtime_publication_v1"."task_catalog_sha256") = 32
        and octet_length("fx_system_application_task_runtime_publication_v1"."application_task_catalog_binding_sha256") = 32
        and octet_length("fx_system_application_task_runtime_publication_v1"."application_revision_task_binding_sha256") = 32
        and octet_length("fx_system_application_task_runtime_publication_v1"."task_entry_root_sha256") = 32
        and octet_length("fx_system_application_task_runtime_publication_v1"."receipt_sha256") = 32
        and octet_length("fx_system_application_task_runtime_publication_v1"."receipt_bytes") between 1 and 8388608),
	CONSTRAINT "fx_application_task_runtime_pub_v1_shape_check" CHECK ((
          "fx_system_application_task_runtime_publication_v1"."object_count" = 0
          and "fx_system_application_task_runtime_publication_v1"."task_runtime_projection_sha256" is null
          and "fx_system_application_task_runtime_publication_v1"."task_runtime_group_manifest_sha256" is null
          and "fx_system_application_task_runtime_publication_v1"."task_runtime_materialization_spec_sha256" is null
        ) or (
          "fx_system_application_task_runtime_publication_v1"."object_count" between 1 and 8191
          and octet_length("fx_system_application_task_runtime_publication_v1"."task_runtime_projection_sha256") = 32
          and octet_length("fx_system_application_task_runtime_publication_v1"."task_runtime_group_manifest_sha256") = 32
          and octet_length("fx_system_application_task_runtime_publication_v1"."task_runtime_materialization_spec_sha256") = 32
        )),
	CONSTRAINT "fx_application_task_runtime_pub_v1_time_check" CHECK (isfinite("fx_system_application_task_runtime_publication_v1"."published_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_task_catalog_v1" ADD CONSTRAINT "fx_application_task_catalog_v1_runtime_fk_unique" UNIQUE("scope_id","revision_id","candidate_id","analysis_id","publication_sha256","source_artifact_root_sha256","task_catalog_sha256","task_catalog_binding_sha256");--> statement-breakpoint
ALTER TABLE "fx_system_application_task_runtime_object_v1" ADD CONSTRAINT "fx_application_task_runtime_obj_v1_publication_fk" FOREIGN KEY ("scope_id","revision_id","receipt_sha256") REFERENCES "fx_system_application_task_runtime_publication_v1"("scope_id","revision_id","receipt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_task_runtime_publication_v1" ADD CONSTRAINT "fx_application_task_runtime_pub_v1_catalog_fk" FOREIGN KEY ("scope_id","revision_id","candidate_id","analysis_id","application_publication_sha256","source_artifact_root_sha256","task_catalog_sha256","application_task_catalog_binding_sha256") REFERENCES "fx_system_application_task_catalog_v1"("scope_id","revision_id","candidate_id","analysis_id","publication_sha256","source_artifact_root_sha256","task_catalog_sha256","task_catalog_binding_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_application_task_runtime_obj_v1_projection_unique" ON "fx_system_application_task_runtime_object_v1" USING btree ("scope_id","revision_id","role") WHERE "fx_system_application_task_runtime_object_v1"."role" = 'task_runtime_projection';--> statement-breakpoint
CREATE UNIQUE INDEX "fx_application_task_runtime_obj_v1_manifest_unique" ON "fx_system_application_task_runtime_object_v1" USING btree ("scope_id","revision_id","role") WHERE "fx_system_application_task_runtime_object_v1"."role" = 'task_runtime_group_manifest';--> statement-breakpoint
CREATE UNIQUE INDEX "fx_application_task_runtime_obj_v1_spec_unique" ON "fx_system_application_task_runtime_object_v1" USING btree ("scope_id","revision_id","role") WHERE "fx_system_application_task_runtime_object_v1"."role" = 'task_runtime_materialization_spec';

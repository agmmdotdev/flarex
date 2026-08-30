CREATE TABLE "fx_control_framework_schema_artifact" (
	"artifact_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_artifact_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"deployment_id" text NOT NULL,
	"owner" text COLLATE "C" NOT NULL,
	"lineage_id" text COLLATE "C" NOT NULL,
	"artifact_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_framework_artifact_storage_pk" PRIMARY KEY("artifact_storage_id"),
	CONSTRAINT "fx_framework_artifact_identity_unique" UNIQUE("deployment_id","owner","lineage_id","artifact_sha256"),
	CONSTRAINT "fx_framework_artifact_storage_identity_unique" UNIQUE("artifact_storage_id","deployment_id","owner","lineage_id"),
	CONSTRAINT "fx_framework_artifact_owner_check" CHECK ("fx_control_framework_schema_artifact"."owner" in ('payload', 'medusa', 'system')),
	CONSTRAINT "fx_framework_artifact_identity_check" CHECK ("fx_control_framework_schema_artifact"."artifact_storage_id" between 1 and 9223372036854775807
        and octet_length(convert_to("fx_control_framework_schema_artifact"."deployment_id", 'UTF8')) between 1 and 1024
        and btrim("fx_control_framework_schema_artifact"."deployment_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''
        and octet_length(convert_to("fx_control_framework_schema_artifact"."lineage_id", 'UTF8')) between 1 and 1024
        and btrim("fx_control_framework_schema_artifact"."lineage_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''
        and octet_length("fx_control_framework_schema_artifact"."artifact_sha256") = 32),
	CONSTRAINT "fx_framework_artifact_frame_check" CHECK ("fx_control_framework_schema_artifact"."frame_format" = 'flarex.framework-schema-artifact'
        and "fx_control_framework_schema_artifact"."frame_version" = 1
        and "fx_control_framework_schema_artifact"."canonical_byte_length" between 1 and 1048576
        and octet_length("fx_control_framework_schema_artifact"."canonical_bytes") = "fx_control_framework_schema_artifact"."canonical_byte_length"),
	CONSTRAINT "fx_framework_artifact_time_check" CHECK (isfinite("fx_control_framework_schema_artifact"."admitted_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_control_framework_schema_artifact_dependency" (
	"artifact_storage_id" bigint NOT NULL,
	"dependency_storage_id" bigint NOT NULL,
	"deployment_id" text NOT NULL,
	"owner" text COLLATE "C" NOT NULL,
	"artifact_lineage_id" text COLLATE "C" NOT NULL,
	"dependency_ordinal" integer NOT NULL,
	"dependency_lineage_id" text COLLATE "C" NOT NULL,
	CONSTRAINT "fx_framework_artifact_dependency_pk" PRIMARY KEY("artifact_storage_id","dependency_ordinal"),
	CONSTRAINT "fx_framework_artifact_dependency_target_unique" UNIQUE("artifact_storage_id","dependency_storage_id"),
	CONSTRAINT "fx_framework_artifact_dependency_identity_check" CHECK ("fx_control_framework_schema_artifact_dependency"."dependency_ordinal" between 0 and 255
        and "fx_control_framework_schema_artifact_dependency"."artifact_storage_id" <> "fx_control_framework_schema_artifact_dependency"."dependency_storage_id"
        and "fx_control_framework_schema_artifact_dependency"."artifact_lineage_id" <> "fx_control_framework_schema_artifact_dependency"."dependency_lineage_id")
);
--> statement-breakpoint
ALTER TABLE "fx_control_framework_schema_artifact_dependency" ADD CONSTRAINT "fx_framework_artifact_dependency_parent_fk" FOREIGN KEY ("artifact_storage_id","deployment_id","owner","artifact_lineage_id") REFERENCES "fx_control_framework_schema_artifact"("artifact_storage_id","deployment_id","owner","lineage_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_framework_schema_artifact_dependency" ADD CONSTRAINT "fx_framework_artifact_dependency_target_fk" FOREIGN KEY ("dependency_storage_id","deployment_id","owner","dependency_lineage_id") REFERENCES "fx_control_framework_schema_artifact"("artifact_storage_id","deployment_id","owner","lineage_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_framework_schema_artifact" ADD CONSTRAINT "fx_framework_artifact_deployment_fk" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("deployment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fx_framework_artifact_dependency_reverse_idx" ON "fx_control_framework_schema_artifact_dependency" USING btree ("dependency_storage_id","artifact_storage_id");

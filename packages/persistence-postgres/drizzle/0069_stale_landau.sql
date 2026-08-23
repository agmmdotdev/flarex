CREATE TABLE "fx_control_application_manifest_schema_binding" (
	"deployment_id" text NOT NULL,
	"application_manifest_sha256" "bytea" NOT NULL,
	"application_manifest_bytes" "bytea" NOT NULL,
	"application_schema_sha256" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"bound_publication_sha256" "bytea" NOT NULL,
	"binding_sha256" "bytea" NOT NULL,
	"binding_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_application_manifest_schema_binding_pk" PRIMARY KEY("deployment_id","application_manifest_sha256"),
	CONSTRAINT "fx_control_application_manifest_schema_binding_identity_unique" UNIQUE("deployment_id","application_manifest_sha256","application_schema_sha256","schema_version_id","bound_publication_sha256","binding_sha256"),
	CONSTRAINT "fx_control_application_manifest_schema_binding_identity_check" CHECK (btrim("fx_control_application_manifest_schema_binding"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_control_application_manifest_schema_binding"."application_manifest_sha256") = 32
        and octet_length("fx_control_application_manifest_schema_binding"."application_manifest_bytes") between 1 and 1048576
        and octet_length("fx_control_application_manifest_schema_binding"."application_schema_sha256") = 32
        and btrim("fx_control_application_manifest_schema_binding"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_control_application_manifest_schema_binding"."schema_version" between 1 and 2147483647
        and octet_length("fx_control_application_manifest_schema_binding"."bound_publication_sha256") = 32
        and octet_length("fx_control_application_manifest_schema_binding"."binding_sha256") = 32
        and octet_length("fx_control_application_manifest_schema_binding"."binding_bytes") between 1 and 16777216),
	CONSTRAINT "fx_control_application_manifest_schema_binding_time_check" CHECK (isfinite("fx_control_application_manifest_schema_binding"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_control_bound_application_schema" (
	"deployment_id" text NOT NULL,
	"application_schema_sha256" "bytea" NOT NULL,
	"application_schema_frame_bytes" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"schema_manifest_sha256" "bytea" NOT NULL,
	"binding_codec_version" integer NOT NULL,
	"binding_json" jsonb NOT NULL,
	"binding_bytes" "bytea" NOT NULL,
	"bound_publication_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_bound_application_schema_pk" PRIMARY KEY("deployment_id","application_schema_sha256"),
	CONSTRAINT "fx_control_bound_application_schema_version_id_unique" UNIQUE("deployment_id","schema_version_id"),
	CONSTRAINT "fx_control_bound_application_schema_version_unique" UNIQUE("deployment_id","schema_version"),
	CONSTRAINT "fx_control_bound_application_schema_identity_unique" UNIQUE("deployment_id","application_schema_sha256","schema_version_id","schema_version","bound_publication_sha256"),
	CONSTRAINT "fx_control_bound_application_schema_identity_check" CHECK (btrim("fx_control_bound_application_schema"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_control_bound_application_schema"."application_schema_sha256") = 32
        and octet_length("fx_control_bound_application_schema"."application_schema_frame_bytes") between 1 and 1048576
        and btrim("fx_control_bound_application_schema"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_control_bound_application_schema"."schema_version" between 1 and 2147483647
        and octet_length("fx_control_bound_application_schema"."schema_manifest_sha256") = 32
        and "fx_control_bound_application_schema"."binding_codec_version" = 2
        and octet_length("fx_control_bound_application_schema"."binding_bytes") between 1 and 16777216
        and octet_length("fx_control_bound_application_schema"."bound_publication_sha256") = 32),
	CONSTRAINT "fx_control_bound_application_schema_json_check" CHECK ((
          jsonb_typeof("fx_control_bound_application_schema"."binding_json") = 'object'
          and "fx_control_bound_application_schema"."binding_json" ->> 'format'
            = 'flarex.application-schema-binding'
          and "fx_control_bound_application_schema"."binding_json" -> 'version' = '2'::jsonb
        ) is true),
	CONSTRAINT "fx_control_bound_application_schema_time_check" CHECK (isfinite("fx_control_bound_application_schema"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_control_edge_definition" (
	"deployment_id" text NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"relation_id" integer NOT NULL,
	"created_by_schema_version_id" text NOT NULL,
	"physical_definition_codec_version" integer NOT NULL,
	"physical_definition_json" jsonb NOT NULL,
	"physical_definition_bytes" "bytea" NOT NULL,
	"physical_definition_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_edge_definition_pk" PRIMARY KEY("deployment_id","edge_definition_id"),
	CONSTRAINT "fx_control_edge_definition_relation_unique" UNIQUE("deployment_id","edge_definition_id","relation_id"),
	CONSTRAINT "fx_control_edge_definition_identity_check" CHECK (btrim("fx_control_edge_definition"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_control_edge_definition"."edge_definition_id" between 1 and 2147483647
        and "fx_control_edge_definition"."relation_id" between 1 and 2147483647
        and btrim("fx_control_edge_definition"."created_by_schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_control_edge_definition"."physical_definition_codec_version" = 1),
	CONSTRAINT "fx_control_edge_definition_json_check" CHECK ((
          jsonb_typeof("fx_control_edge_definition"."physical_definition_json") = 'object'
          and "fx_control_edge_definition"."physical_definition_json" ->> 'format'
            = 'flarex.physical-edge-definition'
          and "fx_control_edge_definition"."physical_definition_json" -> 'version' = '1'::jsonb
        ) is true),
	CONSTRAINT "fx_control_edge_definition_bytes_check" CHECK (octet_length("fx_control_edge_definition"."physical_definition_bytes") between 1 and 16384
        and octet_length("fx_control_edge_definition"."physical_definition_sha256") = 32),
	CONSTRAINT "fx_control_edge_definition_time_check" CHECK (isfinite("fx_control_edge_definition"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_control_relation" (
	"deployment_id" text NOT NULL,
	"relation_id" integer NOT NULL,
	"created_by_schema_version_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_relation_pk" PRIMARY KEY("deployment_id","relation_id"),
	CONSTRAINT "fx_control_relation_identity_check" CHECK (btrim("fx_control_relation"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_control_relation"."relation_id" between 1 and 2147483647
        and btrim("fx_control_relation"."created_by_schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_relation_time_check" CHECK (isfinite("fx_control_relation"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_control_schema_relation_binding" (
	"deployment_id" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"relation_ordinal" integer NOT NULL,
	"relation_id" integer NOT NULL,
	"source_table_id" integer NOT NULL,
	"target_table_id" integer NOT NULL,
	"semantic_definition_sha256" "bytea" NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"evolution_kind" text NOT NULL,
	"origin_schema_version_id" text,
	"origin_relation_ordinal" integer,
	"physical_evolution" text NOT NULL,
	"required_for_activation" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_schema_relation_binding_pk" PRIMARY KEY("deployment_id","schema_version_id","relation_ordinal"),
	CONSTRAINT "fx_control_schema_relation_binding_relation_unique" UNIQUE("deployment_id","schema_version_id","relation_id"),
	CONSTRAINT "fx_control_schema_relation_binding_identity_check" CHECK (btrim("fx_control_schema_relation_binding"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_control_schema_relation_binding"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_control_schema_relation_binding"."relation_ordinal" between 1 and 1024
        and "fx_control_schema_relation_binding"."relation_id" between 1 and 2147483647
        and "fx_control_schema_relation_binding"."source_table_id" between 1 and 2147483647
        and "fx_control_schema_relation_binding"."target_table_id" between 1 and 2147483647
        and octet_length("fx_control_schema_relation_binding"."semantic_definition_sha256") = 32
        and "fx_control_schema_relation_binding"."edge_definition_id" between 1 and 2147483647
        and "fx_control_schema_relation_binding"."required_for_activation" is true),
	CONSTRAINT "fx_control_schema_relation_binding_evolution_check" CHECK (((
          "fx_control_schema_relation_binding"."evolution_kind" = 'new'
          and "fx_control_schema_relation_binding"."origin_schema_version_id" is null
          and "fx_control_schema_relation_binding"."origin_relation_ordinal" is null
          and "fx_control_schema_relation_binding"."physical_evolution" = 'new'
        ) or (
          "fx_control_schema_relation_binding"."evolution_kind" = 'preserve'
          and "fx_control_schema_relation_binding"."origin_schema_version_id" is not null
          and btrim("fx_control_schema_relation_binding"."origin_schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and "fx_control_schema_relation_binding"."origin_schema_version_id" <> "fx_control_schema_relation_binding"."schema_version_id"
          and "fx_control_schema_relation_binding"."origin_relation_ordinal" is not null
          and "fx_control_schema_relation_binding"."origin_relation_ordinal" between 1 and 1024
          and "fx_control_schema_relation_binding"."physical_evolution" in ('reuse', 'replace')
        )) is true),
	CONSTRAINT "fx_control_schema_relation_binding_time_check" CHECK (isfinite("fx_control_schema_relation_binding"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_control_schema_version" ADD CONSTRAINT "fx_control_schema_version_artifact_identity_unique" UNIQUE("deployment_id","schema_version_id","version","manifest_sha256");--> statement-breakpoint
ALTER TABLE "fx_control_application_manifest_schema_binding" ADD CONSTRAINT "fx_control_application_manifest_schema_binding_schema_fk" FOREIGN KEY ("deployment_id","application_schema_sha256","schema_version_id","schema_version","bound_publication_sha256") REFERENCES "public"."fx_control_bound_application_schema"("deployment_id","application_schema_sha256","schema_version_id","schema_version","bound_publication_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_bound_application_schema" ADD CONSTRAINT "fx_control_bound_application_schema_artifact_fk" FOREIGN KEY ("deployment_id","schema_version_id","schema_version","schema_manifest_sha256") REFERENCES "public"."fx_control_schema_version"("deployment_id","schema_version_id","version","manifest_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_edge_definition" ADD CONSTRAINT "fx_control_edge_definition_relation_fk" FOREIGN KEY ("deployment_id","relation_id") REFERENCES "public"."fx_control_relation"("deployment_id","relation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_edge_definition" ADD CONSTRAINT "fx_control_edge_definition_schema_fk" FOREIGN KEY ("deployment_id","created_by_schema_version_id") REFERENCES "public"."fx_control_schema_version"("deployment_id","schema_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_relation" ADD CONSTRAINT "fx_control_relation_schema_fk" FOREIGN KEY ("deployment_id","created_by_schema_version_id") REFERENCES "public"."fx_control_schema_version"("deployment_id","schema_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_relation_binding" ADD CONSTRAINT "fx_control_schema_relation_binding_schema_fk" FOREIGN KEY ("deployment_id","schema_version_id") REFERENCES "public"."fx_control_schema_version"("deployment_id","schema_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_relation_binding" ADD CONSTRAINT "fx_control_schema_relation_binding_relation_fk" FOREIGN KEY ("deployment_id","relation_id") REFERENCES "public"."fx_control_relation"("deployment_id","relation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_relation_binding" ADD CONSTRAINT "fx_control_schema_relation_binding_edge_fk" FOREIGN KEY ("deployment_id","edge_definition_id","relation_id") REFERENCES "public"."fx_control_edge_definition"("deployment_id","edge_definition_id","relation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_relation_binding" ADD CONSTRAINT "fx_control_schema_relation_binding_source_table_fk" FOREIGN KEY ("deployment_id","source_table_id") REFERENCES "public"."fx_control_table"("deployment_id","table_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_relation_binding" ADD CONSTRAINT "fx_control_schema_relation_binding_target_table_fk" FOREIGN KEY ("deployment_id","target_table_id") REFERENCES "public"."fx_control_table"("deployment_id","table_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_relation_binding" ADD CONSTRAINT "fx_control_schema_relation_binding_origin_fk" FOREIGN KEY ("deployment_id","origin_schema_version_id","origin_relation_ordinal") REFERENCES "public"."fx_control_schema_relation_binding"("deployment_id","schema_version_id","relation_ordinal") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fx_control_schema_relation_binding_definition_idx" ON "fx_control_schema_relation_binding" USING btree ("deployment_id","edge_definition_id","schema_version_id");

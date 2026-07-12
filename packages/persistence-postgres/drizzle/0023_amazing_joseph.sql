CREATE TABLE "fx_control_index_definition" (
	"deployment_id" text NOT NULL,
	"index_definition_id" integer NOT NULL,
	"access_kind" text NOT NULL,
	"access_identity_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"logical_index_id" integer,
	"physical_spec_codec_version" integer NOT NULL,
	"physical_spec_json" jsonb NOT NULL,
	"physical_spec_bytes" "bytea" NOT NULL,
	"physical_spec_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_index_definition_pk" PRIMARY KEY("deployment_id","index_definition_id"),
	CONSTRAINT "fx_control_index_definition_owner_spec_unique" UNIQUE("deployment_id","access_kind","access_identity_id","physical_spec_sha256"),
	CONSTRAINT "fx_control_index_definition_binding_owner_unique" UNIQUE("deployment_id","index_definition_id","logical_index_id"),
	CONSTRAINT "fx_control_index_definition_deployment_non_empty_check" CHECK (btrim("fx_control_index_definition"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_index_definition_id_positive_check" CHECK ("fx_control_index_definition"."index_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_index_definition_access_identity_positive_check" CHECK ("fx_control_index_definition"."access_identity_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_index_definition_table_id_positive_check" CHECK ("fx_control_index_definition"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_index_definition_logical_id_positive_check" CHECK ("fx_control_index_definition"."logical_index_id" is null or "fx_control_index_definition"."logical_index_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_index_definition_owner_check" CHECK (
        (
          "fx_control_index_definition"."access_kind" = 'developer'
          and "fx_control_index_definition"."logical_index_id" is not null
          and "fx_control_index_definition"."access_identity_id" = "fx_control_index_definition"."logical_index_id"
        )
        or
        (
          "fx_control_index_definition"."access_kind" = 'by_creation_time'
          and "fx_control_index_definition"."logical_index_id" is null
          and "fx_control_index_definition"."access_identity_id" = "fx_control_index_definition"."table_id"
        )
      ),
	CONSTRAINT "fx_control_index_definition_spec_codec_check" CHECK ("fx_control_index_definition"."physical_spec_codec_version" = 1),
	CONSTRAINT "fx_control_index_definition_spec_json_check" CHECK (
        (
          jsonb_typeof("fx_control_index_definition"."physical_spec_json") = 'object'
          and octet_length("fx_control_index_definition"."physical_spec_json"::text) between 1 and 131072
          and ("fx_control_index_definition"."physical_spec_json" - 'accessPath' - 'collation'
            - 'keyCodecVersion' - 'kind' - 'maxEncodedKeyBytes'
            - 'orderedFields' - 'specVersion' - 'tieBreaker') = '{}'::jsonb
          and "fx_control_index_definition"."physical_spec_json" ->> 'kind' = 'appOrdered'
          and "fx_control_index_definition"."physical_spec_json" -> 'specVersion' = '1'::jsonb
          and "fx_control_index_definition"."physical_spec_json" ->> 'accessPath' = "fx_control_index_definition"."access_kind"
          and "fx_control_index_definition"."physical_spec_json" -> 'keyCodecVersion' = '1'::jsonb
          and "fx_control_index_definition"."physical_spec_json" ->> 'collation' = 'binaryUtf8'
          and "fx_control_index_definition"."physical_spec_json" -> 'maxEncodedKeyBytes' = '2048'::jsonb
          and jsonb_typeof("fx_control_index_definition"."physical_spec_json" -> 'orderedFields') = 'array'
          and "fx_control_index_definition"."physical_spec_json" -> 'tieBreaker'
            = '{"byteLength":16,"kind":"separateRowIdentity"}'::jsonb
        ) is true
      ),
	CONSTRAINT "fx_control_index_definition_spec_bytes_length_check" CHECK (octet_length("fx_control_index_definition"."physical_spec_bytes") between 1 and 131072),
	CONSTRAINT "fx_control_index_definition_spec_sha256_length_check" CHECK (octet_length("fx_control_index_definition"."physical_spec_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "fx_control_schema_version_index_binding" (
	"deployment_id" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"logical_index_id" integer NOT NULL,
	"index_definition_id" integer NOT NULL,
	"required_for_activation" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_schema_index_binding_pk" PRIMARY KEY("deployment_id","schema_version_id","logical_index_id"),
	CONSTRAINT "fx_control_schema_index_binding_deployment_non_empty_check" CHECK (btrim("fx_control_schema_version_index_binding"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_schema_index_binding_schema_non_empty_check" CHECK (btrim("fx_control_schema_version_index_binding"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_schema_index_binding_logical_id_positive_check" CHECK ("fx_control_schema_version_index_binding"."logical_index_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_schema_index_binding_definition_id_positive_check" CHECK ("fx_control_schema_version_index_binding"."index_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_schema_index_binding_required_check" CHECK ("fx_control_schema_version_index_binding"."required_for_activation" is true)
);
--> statement-breakpoint
ALTER TABLE "fx_control_index" ADD CONSTRAINT "fx_control_index_deployment_logical_table_unique" UNIQUE("deployment_id","logical_index_id","table_id");--> statement-breakpoint
ALTER TABLE "fx_control_index_definition" ADD CONSTRAINT "fx_control_index_definition_table_fk" FOREIGN KEY ("deployment_id","table_id") REFERENCES "fx_control_table"("deployment_id","table_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_index_definition" ADD CONSTRAINT "fx_control_index_definition_logical_fk" FOREIGN KEY ("deployment_id","logical_index_id","table_id") REFERENCES "fx_control_index"("deployment_id","logical_index_id","table_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_version_index_binding" ADD CONSTRAINT "fx_control_schema_index_binding_schema_fk" FOREIGN KEY ("deployment_id","schema_version_id") REFERENCES "fx_control_schema_version"("deployment_id","schema_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_version_index_binding" ADD CONSTRAINT "fx_control_schema_index_binding_definition_fk" FOREIGN KEY ("deployment_id","index_definition_id","logical_index_id") REFERENCES "fx_control_index_definition"("deployment_id","index_definition_id","logical_index_id") ON DELETE restrict ON UPDATE no action;

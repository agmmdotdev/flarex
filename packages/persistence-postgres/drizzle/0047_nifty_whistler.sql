CREATE TABLE "fx_control_schema_version_unique_constraint_binding" (
	"deployment_id" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"logical_unique_constraint_id" integer NOT NULL,
	"unique_constraint_definition_id" integer NOT NULL,
	"required_for_activation" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_schema_unique_constraint_binding_pk" PRIMARY KEY("deployment_id","schema_version_id","logical_unique_constraint_id"),
	CONSTRAINT "fx_control_schema_unique_constraint_binding_deployment_non_empty_check" CHECK (btrim("fx_control_schema_version_unique_constraint_binding"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_schema_unique_constraint_binding_schema_non_empty_check" CHECK (btrim("fx_control_schema_version_unique_constraint_binding"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_schema_unique_constraint_binding_logical_id_positive_check" CHECK ("fx_control_schema_version_unique_constraint_binding"."logical_unique_constraint_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_schema_unique_constraint_binding_definition_id_positive_check" CHECK ("fx_control_schema_version_unique_constraint_binding"."unique_constraint_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_schema_unique_constraint_binding_required_check" CHECK ("fx_control_schema_version_unique_constraint_binding"."required_for_activation" is true)
);
--> statement-breakpoint
CREATE TABLE "fx_control_unique_constraint_definition" (
	"deployment_id" text NOT NULL,
	"unique_constraint_definition_id" integer NOT NULL,
	"logical_unique_constraint_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"physical_spec_codec_version" integer NOT NULL,
	"physical_spec_json" jsonb NOT NULL,
	"physical_spec_bytes" "bytea" NOT NULL,
	"physical_spec_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_unique_constraint_definition_pk" PRIMARY KEY("deployment_id","unique_constraint_definition_id"),
	CONSTRAINT "fx_control_unique_constraint_definition_owner_spec_unique" UNIQUE("deployment_id","logical_unique_constraint_id","physical_spec_sha256"),
	CONSTRAINT "fx_control_unique_constraint_definition_binding_owner_unique" UNIQUE("deployment_id","unique_constraint_definition_id","logical_unique_constraint_id"),
	CONSTRAINT "fx_control_unique_constraint_definition_deployment_non_empty_check" CHECK (btrim("fx_control_unique_constraint_definition"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_unique_constraint_definition_id_positive_check" CHECK ("fx_control_unique_constraint_definition"."unique_constraint_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_unique_constraint_definition_logical_id_positive_check" CHECK ("fx_control_unique_constraint_definition"."logical_unique_constraint_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_unique_constraint_definition_table_id_positive_check" CHECK ("fx_control_unique_constraint_definition"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_unique_constraint_definition_spec_codec_check" CHECK ("fx_control_unique_constraint_definition"."physical_spec_codec_version" = 1),
	CONSTRAINT "fx_control_unique_constraint_definition_spec_json_check" CHECK (
        (
          jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json") = 'object'
          and octet_length("fx_control_unique_constraint_definition"."physical_spec_json"::text) between 1 and 131072
          and ("fx_control_unique_constraint_definition"."physical_spec_json" - 'keyCodecIdentity'
            - 'keyCodecVersion' - 'kind' - 'localePolicy'
            - 'orderedFields' - 'sparse' - 'specVersion') = '{}'::jsonb
          and "fx_control_unique_constraint_definition"."physical_spec_json" ->> 'kind' = 'appUniqueConstraint'
          and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'specVersion' = '1'::jsonb
          and "fx_control_unique_constraint_definition"."physical_spec_json" ->> 'keyCodecIdentity'
            = 'flarex.unique-key/ordered-index-components/v1'
          and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'keyCodecVersion' = '1'::jsonb
          and "fx_control_unique_constraint_definition"."physical_spec_json" -> 'localePolicy'
            = '{"kind":"none"}'::jsonb
          and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'orderedFields') = 'array'
          and jsonb_array_length("fx_control_unique_constraint_definition"."physical_spec_json" -> 'orderedFields')
            between 1 and 15
          and jsonb_typeof("fx_control_unique_constraint_definition"."physical_spec_json" -> 'sparse') = 'boolean'
        ) is true
      ),
	CONSTRAINT "fx_control_unique_constraint_definition_spec_bytes_length_check" CHECK (octet_length("fx_control_unique_constraint_definition"."physical_spec_bytes") between 1 and 131072),
	CONSTRAINT "fx_control_unique_constraint_definition_spec_sha256_length_check" CHECK (octet_length("fx_control_unique_constraint_definition"."physical_spec_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "fx_control_unique_constraint" (
	"deployment_id" text NOT NULL,
	"logical_unique_constraint_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"descriptor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_unique_constraint_pk" PRIMARY KEY("deployment_id","logical_unique_constraint_id"),
	CONSTRAINT "fx_control_unique_constraint_table_descriptor_unique" UNIQUE("deployment_id","table_id","descriptor"),
	CONSTRAINT "fx_control_unique_constraint_logical_table_unique" UNIQUE("deployment_id","logical_unique_constraint_id","table_id"),
	CONSTRAINT "fx_control_unique_constraint_deployment_non_empty_check" CHECK (btrim("fx_control_unique_constraint"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_unique_constraint_id_positive_check" CHECK ("fx_control_unique_constraint"."logical_unique_constraint_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_unique_constraint_table_id_positive_check" CHECK ("fx_control_unique_constraint"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_unique_constraint_descriptor_non_empty_check" CHECK (btrim("fx_control_unique_constraint"."descriptor", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> '')
);
--> statement-breakpoint
ALTER TABLE "fx_control_schema_version_unique_constraint_binding" ADD CONSTRAINT "fx_control_schema_unique_constraint_binding_schema_fk" FOREIGN KEY ("deployment_id","schema_version_id") REFERENCES "public"."fx_control_schema_version"("deployment_id","schema_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_schema_version_unique_constraint_binding" ADD CONSTRAINT "fx_control_schema_unique_constraint_binding_definition_fk" FOREIGN KEY ("deployment_id","unique_constraint_definition_id","logical_unique_constraint_id") REFERENCES "public"."fx_control_unique_constraint_definition"("deployment_id","unique_constraint_definition_id","logical_unique_constraint_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_unique_constraint_definition" ADD CONSTRAINT "fx_control_unique_constraint_definition_logical_fk" FOREIGN KEY ("deployment_id","logical_unique_constraint_id","table_id") REFERENCES "public"."fx_control_unique_constraint"("deployment_id","logical_unique_constraint_id","table_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_control_unique_constraint" ADD CONSTRAINT "fx_control_unique_constraint_table_fk" FOREIGN KEY ("deployment_id","table_id") REFERENCES "public"."fx_control_table"("deployment_id","table_id") ON DELETE restrict ON UPDATE no action;
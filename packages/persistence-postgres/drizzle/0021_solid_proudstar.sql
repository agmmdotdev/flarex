CREATE TABLE "fx_control_schema_version" (
	"deployment_id" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"version" integer NOT NULL,
	"manifest_codec_version" integer NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"manifest_bytes" bytea NOT NULL,
	"manifest_sha256" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_schema_version_deployment_id_schema_version_id_pk" PRIMARY KEY("deployment_id","schema_version_id"),
	CONSTRAINT "fx_control_schema_version_deployment_version_unique" UNIQUE("deployment_id","version"),
	CONSTRAINT "fx_control_schema_version_deployment_id_non_empty_check" CHECK (btrim("fx_control_schema_version"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_schema_version_id_non_empty_check" CHECK (btrim("fx_control_schema_version"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_schema_version_version_positive_check" CHECK ("fx_control_schema_version"."version" between 1 and 2147483647),
	CONSTRAINT "fx_control_schema_version_manifest_codec_check" CHECK ("fx_control_schema_version"."manifest_codec_version" = 1),
	CONSTRAINT "fx_control_schema_version_manifest_object_check" CHECK (jsonb_typeof("fx_control_schema_version"."manifest_json") = 'object'),
	CONSTRAINT "fx_control_schema_version_manifest_bytes_non_empty_check" CHECK (octet_length("fx_control_schema_version"."manifest_bytes") > 0),
	CONSTRAINT "fx_control_schema_version_manifest_sha256_length_check" CHECK (octet_length("fx_control_schema_version"."manifest_sha256") = 32)
);
--> statement-breakpoint
ALTER TABLE "fx_control_schema_version" ADD CONSTRAINT "fx_control_schema_version_deployment_id_deployments_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("deployment_id") ON DELETE restrict ON UPDATE no action;

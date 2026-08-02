CREATE TABLE "fx_app_unique_key" (
	"scope_uuid" uuid NOT NULL,
	"constraint_id" integer NOT NULL,
	"locale_key" text NOT NULL,
	"canonical_key_sha256" "bytea" NOT NULL,
	"key_codec_version" integer NOT NULL,
	"encoded_key" "bytea" NOT NULL,
	"table_id" integer NOT NULL,
	"row_id" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"write_epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	CONSTRAINT "fx_app_unique_key_pk" PRIMARY KEY("scope_uuid","constraint_id","locale_key","canonical_key_sha256"),
	CONSTRAINT "fx_app_unique_key_owner_unique" UNIQUE("scope_uuid","constraint_id","locale_key","table_id","row_id"),
	CONSTRAINT "fx_app_unique_key_constraint_id_check" CHECK ("fx_app_unique_key"."constraint_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_unique_key_locale_key_check" CHECK ("fx_app_unique_key"."locale_key" = '' or (octet_length("fx_app_unique_key"."locale_key") between 1 and 63 and "fx_app_unique_key"."locale_key" ~ '^[a-z0-9]{1,8}(-[a-z0-9]{1,8})*$')),
	CONSTRAINT "fx_app_unique_key_digest_length_check" CHECK (octet_length("fx_app_unique_key"."canonical_key_sha256") = 32),
	CONSTRAINT "fx_app_unique_key_codec_version_check" CHECK ("fx_app_unique_key"."key_codec_version" = 1),
	CONSTRAINT "fx_app_unique_key_encoded_key_length_check" CHECK (octet_length("fx_app_unique_key"."encoded_key") between 1 and 2048),
	CONSTRAINT "fx_app_unique_key_table_id_check" CHECK ("fx_app_unique_key"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_unique_key_row_id_length_check" CHECK (octet_length("fx_app_unique_key"."row_id") = 16),
	CONSTRAINT "fx_app_unique_key_schema_version_id_check" CHECK (btrim("fx_app_unique_key"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_app_unique_key_commit_seq_check" CHECK ("fx_app_unique_key"."commit_seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" ADD CONSTRAINT "fx_app_unique_key_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_app_unique_key" ADD CONSTRAINT "fx_app_unique_key_row_revision_fk" FOREIGN KEY ("scope_uuid","table_id","row_id","write_epoch_uuid","commit_seq") REFERENCES "fx_app_row_rev"("scope_uuid","table_id","row_id","write_epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;

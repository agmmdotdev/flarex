CREATE TABLE "fx_app_edge_adjacency_version" (
	"scope_uuid" uuid NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"direction" text NOT NULL,
	"endpoint_row_id" "bytea" NOT NULL,
	"last_changed_commit_seq" bigint NOT NULL,
	CONSTRAINT "fx_app_edge_adjacency_version_pk" PRIMARY KEY("scope_uuid","edge_definition_id","direction","endpoint_row_id"),
	CONSTRAINT "fx_app_edge_adjacency_version_definition_id_check" CHECK ("fx_app_edge_adjacency_version"."edge_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_edge_adjacency_version_direction_check" CHECK ("fx_app_edge_adjacency_version"."direction" in ('incoming', 'outgoing')),
	CONSTRAINT "fx_app_edge_adjacency_version_endpoint_row_id_check" CHECK (octet_length("fx_app_edge_adjacency_version"."endpoint_row_id") = 16),
	CONSTRAINT "fx_app_edge_adjacency_version_commit_seq_check" CHECK ("fx_app_edge_adjacency_version"."last_changed_commit_seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fx_app_edge_current" (
	"scope_uuid" uuid NOT NULL,
	"relation_id" integer NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"source_table_id" integer NOT NULL,
	"source_row_id" "bytea" NOT NULL,
	"target_table_id" integer NOT NULL,
	"target_row_id" "bytea" NOT NULL,
	"duplicate_ordinal" integer NOT NULL,
	"occurrence_codec_version" integer NOT NULL,
	"occurrence_bytes" "bytea" NOT NULL,
	"occurrence_sha256" "bytea" NOT NULL,
	"locale" text,
	"position" integer,
	"schema_version_id" text NOT NULL,
	"write_epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	CONSTRAINT "fx_app_edge_current_pk" PRIMARY KEY("scope_uuid","edge_definition_id","source_row_id","target_row_id","duplicate_ordinal"),
	CONSTRAINT "fx_app_edge_current_catalog_ids_check" CHECK ("fx_app_edge_current"."relation_id" between 1 and 2147483647
        and "fx_app_edge_current"."edge_definition_id" between 1 and 2147483647
        and "fx_app_edge_current"."source_table_id" between 1 and 2147483647
        and "fx_app_edge_current"."target_table_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_edge_current_row_ids_check" CHECK (octet_length("fx_app_edge_current"."source_row_id") = 16
        and octet_length("fx_app_edge_current"."target_row_id") = 16),
	CONSTRAINT "fx_app_edge_current_occurrence_check" CHECK ("fx_app_edge_current"."duplicate_ordinal" = 0
        and "fx_app_edge_current"."occurrence_codec_version" = 1
        and octet_length("fx_app_edge_current"."occurrence_bytes") between 1 and 8192
        and octet_length("fx_app_edge_current"."occurrence_sha256") = 32),
	CONSTRAINT "fx_app_edge_current_locale_check" CHECK ("fx_app_edge_current"."locale" is null),
	CONSTRAINT "fx_app_edge_current_position_check" CHECK ("fx_app_edge_current"."position" is null or "fx_app_edge_current"."position" between 0 and 1023),
	CONSTRAINT "fx_app_edge_current_schema_version_id_check" CHECK (btrim("fx_app_edge_current"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_app_edge_current_commit_seq_check" CHECK ("fx_app_edge_current"."commit_seq" >= 1)
);
--> statement-breakpoint
ALTER TABLE "fx_app_edge_adjacency_version" ADD CONSTRAINT "fx_app_edge_adjacency_version_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_app_edge_current" ADD CONSTRAINT "fx_app_edge_current_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_app_edge_current_occurrence_digest_unique" ON "fx_app_edge_current" USING btree ("scope_uuid","edge_definition_id","occurrence_sha256");--> statement-breakpoint
CREATE INDEX "fx_app_edge_current_incoming_idx" ON "fx_app_edge_current" USING btree ("scope_uuid","edge_definition_id","target_row_id","source_row_id","duplicate_ordinal") INCLUDE ("position", "commit_seq");

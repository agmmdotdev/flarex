CREATE TABLE "fx_app_index_entry_current" (
	"scope_uuid" uuid NOT NULL,
	"index_definition_id" integer NOT NULL,
	"encoded_key" "bytea" NOT NULL,
	"row_id" "bytea" NOT NULL,
	"commit_seq" bigint NOT NULL,
	CONSTRAINT "fx_app_index_entry_current_pk" PRIMARY KEY("scope_uuid","index_definition_id","encoded_key","row_id"),
	CONSTRAINT "fx_app_index_entry_current_definition_id_check" CHECK ("fx_app_index_entry_current"."index_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_index_entry_current_encoded_key_length_check" CHECK (octet_length("fx_app_index_entry_current"."encoded_key") between 1 and 2048),
	CONSTRAINT "fx_app_index_entry_current_row_id_length_check" CHECK (octet_length("fx_app_index_entry_current"."row_id") = 16),
	CONSTRAINT "fx_app_index_entry_current_commit_seq_check" CHECK ("fx_app_index_entry_current"."commit_seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fx_app_index_entry_rev" (
	"scope_uuid" uuid NOT NULL,
	"index_definition_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"key_codec_version" integer NOT NULL,
	"physical_spec_sha256" "bytea" NOT NULL,
	"encoded_key" "bytea" NOT NULL,
	"key_sha256" "bytea" NOT NULL,
	"row_id" "bytea" NOT NULL,
	"commit_seq" bigint NOT NULL,
	"prev_commit_seq" bigint,
	"write_epoch_uuid" uuid NOT NULL,
	"is_tombstone" boolean NOT NULL,
	CONSTRAINT "fx_app_index_entry_rev_pk" PRIMARY KEY("scope_uuid","index_definition_id","encoded_key","row_id","commit_seq"),
	CONSTRAINT "fx_app_index_entry_rev_definition_id_check" CHECK ("fx_app_index_entry_rev"."index_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_index_entry_rev_table_id_check" CHECK ("fx_app_index_entry_rev"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_index_entry_rev_key_codec_check" CHECK ("fx_app_index_entry_rev"."key_codec_version" = 1),
	CONSTRAINT "fx_app_index_entry_rev_spec_sha256_length_check" CHECK (octet_length("fx_app_index_entry_rev"."physical_spec_sha256") = 32),
	CONSTRAINT "fx_app_index_entry_rev_encoded_key_length_check" CHECK (octet_length("fx_app_index_entry_rev"."encoded_key") between 1 and 2048),
	CONSTRAINT "fx_app_index_entry_rev_key_sha256_length_check" CHECK (octet_length("fx_app_index_entry_rev"."key_sha256") = 32),
	CONSTRAINT "fx_app_index_entry_rev_row_id_length_check" CHECK (octet_length("fx_app_index_entry_rev"."row_id") = 16),
	CONSTRAINT "fx_app_index_entry_rev_commit_seq_check" CHECK ("fx_app_index_entry_rev"."commit_seq" >= 1),
	CONSTRAINT "fx_app_index_entry_rev_prev_commit_seq_check" CHECK ("fx_app_index_entry_rev"."prev_commit_seq" is null or ("fx_app_index_entry_rev"."prev_commit_seq" >= 1 and "fx_app_index_entry_rev"."prev_commit_seq" < "fx_app_index_entry_rev"."commit_seq"))
);
--> statement-breakpoint
ALTER TABLE "fx_app_index_entry_current" ADD CONSTRAINT "fx_app_index_entry_current_revision_fk" FOREIGN KEY ("scope_uuid","index_definition_id","encoded_key","row_id","commit_seq") REFERENCES "fx_app_index_entry_rev"("scope_uuid","index_definition_id","encoded_key","row_id","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_app_index_entry_rev" ADD CONSTRAINT "fx_app_index_entry_rev_row_revision_fk" FOREIGN KEY ("scope_uuid","table_id","row_id","write_epoch_uuid","commit_seq") REFERENCES "fx_app_row_rev"("scope_uuid","table_id","row_id","write_epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fx_app_index_entry_rev_range_idx" ON "fx_app_index_entry_rev" USING btree ("scope_uuid","index_definition_id","encoded_key","row_id","commit_seq" DESC NULLS LAST);

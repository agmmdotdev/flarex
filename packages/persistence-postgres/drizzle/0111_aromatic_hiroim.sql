CREATE TABLE "fx_app_search_entry_current" (
	"scope_uuid" uuid NOT NULL,
	"table_id" integer NOT NULL,
	"logical_index_id" integer NOT NULL,
	"source_sha256" text NOT NULL,
	"field_id" text NOT NULL,
	"row_id" "bytea" NOT NULL,
	"commit_seq" bigint NOT NULL,
	"folded_text" text NOT NULL,
	CONSTRAINT "fx_app_search_entry_current_pk" PRIMARY KEY("scope_uuid","table_id","logical_index_id","field_id","row_id"),
	CONSTRAINT "fx_app_search_entry_current_table_id_check" CHECK ("fx_app_search_entry_current"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_search_entry_current_index_id_check" CHECK ("fx_app_search_entry_current"."logical_index_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_search_entry_current_source_check" CHECK ("fx_app_search_entry_current"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "fx_app_search_entry_current_field_check" CHECK (length("fx_app_search_entry_current"."field_id") between 1 and 512),
	CONSTRAINT "fx_app_search_entry_current_row_id_check" CHECK (octet_length("fx_app_search_entry_current"."row_id") = 16),
	CONSTRAINT "fx_app_search_entry_current_commit_seq_check" CHECK ("fx_app_search_entry_current"."commit_seq" >= 1),
	CONSTRAINT "fx_app_search_entry_current_ascii_fold_check" CHECK ("fx_app_search_entry_current"."folded_text" = translate("fx_app_search_entry_current"."folded_text",
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))
);
--> statement-breakpoint
ALTER TABLE "fx_app_search_entry_current" ADD CONSTRAINT "fx_app_search_entry_current_revision_fk" FOREIGN KEY ("scope_uuid","table_id","row_id","commit_seq") REFERENCES "fx_app_row_rev"("scope_uuid","table_id","row_id","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fx_app_search_entry_current_row_idx" ON "fx_app_search_entry_current" USING btree ("scope_uuid","table_id","row_id");

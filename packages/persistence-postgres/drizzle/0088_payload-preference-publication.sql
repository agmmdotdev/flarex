CREATE TABLE "fx_system_commit_payload_preference_deletion" (
	"scope_uuid" uuid NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"change_ordinal" integer NOT NULL,
	"codec_version" integer NOT NULL,
	"storage_generation" text NOT NULL,
	"artifact_sha256" text NOT NULL,
	"preference_id" text NOT NULL,
	"content_table_id" integer NOT NULL,
	"content_row_id" "bytea" NOT NULL,
	CONSTRAINT "fx_system_commit_payload_preference_deletion_scope_uuid_commit_seq_change_ordinal_pk" PRIMARY KEY("scope_uuid","commit_seq","change_ordinal"),
	CONSTRAINT "fx_commit_preference_deletion_identity_unique" UNIQUE("scope_uuid","commit_seq","storage_generation","artifact_sha256","preference_id"),
	CONSTRAINT "fx_commit_preference_deletion_values_check" CHECK ("fx_system_commit_payload_preference_deletion"."codec_version" = 1 and "fx_system_commit_payload_preference_deletion"."change_ordinal" between 0 and 255
    and "fx_system_commit_payload_preference_deletion"."storage_generation" = 'flarexdb_v1' and "fx_system_commit_payload_preference_deletion"."artifact_sha256" ~ '^[0-9a-f]{64}$'
    and octet_length("fx_system_commit_payload_preference_deletion"."preference_id") between 1 and 2048 and "fx_system_commit_payload_preference_deletion"."content_table_id" > 0 and octet_length("fx_system_commit_payload_preference_deletion"."content_row_id") = 16)
);
--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD COLUMN "payload_preference_deletion_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_commit_payload_preference_deletion" ADD CONSTRAINT "fx_commit_preference_deletion_header_fk" FOREIGN KEY ("scope_uuid","epoch_uuid","commit_seq") REFERENCES "fx_system_commit"("scope_uuid","epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_commit_payload_preference_deletion" ADD CONSTRAINT "fx_commit_preference_deletion_content_fk" FOREIGN KEY ("scope_uuid","content_table_id","content_row_id","epoch_uuid","commit_seq") REFERENCES "fx_app_row_rev"("scope_uuid","table_id","row_id","write_epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD CONSTRAINT "fx_system_commit_preference_deletion_count_check" CHECK ("fx_system_commit"."payload_preference_deletion_count" between 0 and 256);

CREATE TABLE "fx_system_commit_app_row_change" (
	"scope_uuid" uuid NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"change_ordinal" integer NOT NULL,
	"table_id" integer NOT NULL,
	"row_id" "bytea" NOT NULL,
	CONSTRAINT "fx_system_commit_app_row_change_scope_uuid_commit_seq_change_ordinal_pk" PRIMARY KEY("scope_uuid","commit_seq","change_ordinal"),
	CONSTRAINT "fx_system_commit_app_row_change_row_unique" UNIQUE("scope_uuid","commit_seq","table_id","row_id"),
	CONSTRAINT "fx_system_commit_app_row_change_ordinal_check" CHECK ("fx_system_commit_app_row_change"."change_ordinal" between 0 and 15999),
	CONSTRAINT "fx_system_commit_app_row_change_table_id_check" CHECK ("fx_system_commit_app_row_change"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_system_commit_app_row_change_row_id_length_check" CHECK (octet_length("fx_system_commit_app_row_change"."row_id") = 16)
);
--> statement-breakpoint
CREATE TABLE "fx_system_commit" (
	"scope_uuid" uuid NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"change_count" integer NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_commit_scope_uuid_commit_seq_pk" PRIMARY KEY("scope_uuid","commit_seq"),
	CONSTRAINT "fx_system_commit_scope_epoch_seq_unique" UNIQUE("scope_uuid","epoch_uuid","commit_seq"),
	CONSTRAINT "fx_system_commit_seq_positive_check" CHECK ("fx_system_commit"."commit_seq" >= 1),
	CONSTRAINT "fx_system_commit_change_count_check" CHECK ("fx_system_commit"."change_count" between 0 and 16000),
	CONSTRAINT "fx_system_commit_committed_at_finite_check" CHECK (isfinite("fx_system_commit"."committed_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" ADD COLUMN "oldest_available_commit_seq" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_app_row_rev" ADD CONSTRAINT "fx_app_row_rev_change_provenance_unique" UNIQUE("scope_uuid","table_id","row_id","write_epoch_uuid","commit_seq");--> statement-breakpoint
ALTER TABLE "fx_system_commit_app_row_change" ADD CONSTRAINT "fx_system_commit_app_row_change_header_fk" FOREIGN KEY ("scope_uuid","epoch_uuid","commit_seq") REFERENCES "fx_system_commit"("scope_uuid","epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_commit_app_row_change" ADD CONSTRAINT "fx_system_commit_app_row_change_revision_fk" FOREIGN KEY ("scope_uuid","table_id","row_id","epoch_uuid","commit_seq") REFERENCES "fx_app_row_rev"("scope_uuid","table_id","row_id","write_epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD CONSTRAINT "fx_system_commit_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" ADD CONSTRAINT "fx_system_scope_clock_oldest_available_commit_seq_check" CHECK ("fx_system_scope_clock"."oldest_available_commit_seq" >= 0 and "fx_system_scope_clock"."oldest_available_commit_seq" <= "fx_system_scope_clock"."last_commit_seq");

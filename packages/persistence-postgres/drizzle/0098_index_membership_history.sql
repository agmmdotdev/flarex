ALTER TABLE "fx_app_index_entry_rev" DROP CONSTRAINT "fx_app_index_entry_rev_prev_commit_seq_check";--> statement-breakpoint
ALTER TABLE "fx_app_index_entry_rev" DROP CONSTRAINT "fx_app_index_entry_rev_row_revision_fk";
--> statement-breakpoint
ALTER TABLE "fx_app_index_entry_rev" ADD CONSTRAINT "fx_app_index_entry_rev_row_identity_fk" FOREIGN KEY ("scope_uuid","table_id","row_id") REFERENCES "fx_app_row_current"("scope_uuid","table_id","row_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_app_index_entry_rev" DROP COLUMN "prev_commit_seq";--> statement-breakpoint
ALTER TABLE "fx_app_index_entry_rev" DROP COLUMN "write_epoch_uuid";
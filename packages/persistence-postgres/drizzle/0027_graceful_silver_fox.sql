ALTER TABLE "fx_system_scope_clock" ADD COLUMN "authorization_revocation_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" ADD CONSTRAINT "fx_system_scope_clock_authorization_revocation_epoch_non_negative_check" CHECK ("fx_system_scope_clock"."authorization_revocation_epoch" >= 0);

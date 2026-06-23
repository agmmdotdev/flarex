DROP INDEX "live_query_deliveries_by_undelivered";--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "claim_owner" text;--> statement-breakpoint
CREATE INDEX "live_query_deliveries_by_undelivered" ON "live_query_deliveries" USING btree ("deployment_id","delivered_at","dead_lettered_at","claim_expires_at","created_at","delivery_id");
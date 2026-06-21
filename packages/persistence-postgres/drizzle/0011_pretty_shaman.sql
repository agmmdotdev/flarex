DROP INDEX "live_query_deliveries_by_undelivered";--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "last_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "last_error_stage" text;--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "live_query_deliveries" ADD COLUMN "dead_letter_reason" text;--> statement-breakpoint
CREATE INDEX "live_query_deliveries_by_undelivered" ON "live_query_deliveries" USING btree ("deployment_id","delivered_at","dead_lettered_at","created_at","delivery_id");
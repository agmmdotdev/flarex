CREATE TABLE "live_query_deliveries" (
	"deployment_id" text NOT NULL,
	"delivery_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"query_id" bigint NOT NULL,
	"payload_json" jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_query_deliveries_deployment_id_delivery_id_pk" PRIMARY KEY("deployment_id","delivery_id")
);
--> statement-breakpoint
CREATE INDEX "live_query_deliveries_by_undelivered" ON "live_query_deliveries" USING btree ("deployment_id","delivered_at","created_at","delivery_id");--> statement-breakpoint
CREATE INDEX "live_query_deliveries_by_connection" ON "live_query_deliveries" USING btree ("deployment_id","connection_id","query_id","created_at","delivery_id");
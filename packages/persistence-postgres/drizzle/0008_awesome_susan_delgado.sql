CREATE TABLE "live_query_subscriptions" (
	"deployment_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"query_id" bigint NOT NULL,
	"function_path" text NOT NULL,
	"args_json" jsonb NOT NULL,
	"begin_ts" bigint NOT NULL,
	"read_set_json" jsonb NOT NULL,
	"result_json" jsonb NOT NULL,
	"result_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_query_subscriptions_deployment_id_connection_id_query_id_pk" PRIMARY KEY("deployment_id","connection_id","query_id")
);
--> statement-breakpoint
CREATE INDEX "live_query_subscriptions_by_deployment_updated" ON "live_query_subscriptions" USING btree ("deployment_id","updated_at","connection_id","query_id");--> statement-breakpoint
CREATE INDEX "live_query_subscriptions_by_connection" ON "live_query_subscriptions" USING btree ("deployment_id","connection_id","query_id");
CREATE TABLE "live_query_connections" (
	"deployment_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_query_connections_deployment_id_connection_id_pk" PRIMARY KEY("deployment_id","connection_id")
);
--> statement-breakpoint
CREATE INDEX "live_query_connections_by_expiry" ON "live_query_connections" USING btree ("deployment_id","expires_at","connection_id");
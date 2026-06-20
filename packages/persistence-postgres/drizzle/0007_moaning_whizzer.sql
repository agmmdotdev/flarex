CREATE TABLE "document_freshness_versions" (
	"deployment_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version" bigint NOT NULL,
	"outbox_ts" bigint NOT NULL,
	"outbox_sequence" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_freshness_versions_deployment_id_document_id_pk" PRIMARY KEY("deployment_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "freshness_processed_events" (
	"deployment_id" text NOT NULL,
	"ts" bigint NOT NULL,
	"sequence" bigint NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "freshness_processed_events_deployment_id_ts_sequence_pk" PRIMARY KEY("deployment_id","ts","sequence")
);
--> statement-breakpoint
CREATE TABLE "table_freshness_versions" (
	"deployment_id" text NOT NULL,
	"table_id" bigint NOT NULL,
	"version" bigint NOT NULL,
	"outbox_ts" bigint NOT NULL,
	"outbox_sequence" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "table_freshness_versions_deployment_id_table_id_pk" PRIMARY KEY("deployment_id","table_id")
);

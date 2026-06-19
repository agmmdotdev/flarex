CREATE TABLE "commits" (
	"deployment_id" text NOT NULL,
	"ts" bigint NOT NULL,
	"source" text NOT NULL,
	"write_summary" jsonb NOT NULL,
	"committed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commits_deployment_id_ts_pk" PRIMARY KEY("deployment_id","ts")
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"deployment_id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"active_package_id" text,
	"active_schema_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"deployment_id" text NOT NULL,
	"id" bytea NOT NULL,
	"ts" bigint NOT NULL,
	"table_id" bytea NOT NULL,
	"json_value" bytea NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"prev_ts" bigint,
	CONSTRAINT "documents_deployment_id_ts_table_id_id_pk" PRIMARY KEY("deployment_id","ts","table_id","id")
);
--> statement-breakpoint
CREATE TABLE "indexes" (
	"deployment_id" text NOT NULL,
	"index_id" bytea NOT NULL,
	"ts" bigint NOT NULL,
	"key_prefix" bytea NOT NULL,
	"key_suffix" bytea,
	"key_sha256" bytea NOT NULL,
	"deleted" boolean,
	"table_id" bytea,
	"document_id" bytea,
	CONSTRAINT "indexes_deployment_id_index_id_key_sha256_ts_pk" PRIMARY KEY("deployment_id","index_id","key_sha256","ts")
);
--> statement-breakpoint
CREATE TABLE "leases" (
	"deployment_id" text PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"deployment_id" text NOT NULL,
	"ts" bigint NOT NULL,
	"sequence" bigint NOT NULL,
	"event" jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "outbox_deployment_id_ts_sequence_pk" PRIMARY KEY("deployment_id","ts","sequence")
);
--> statement-breakpoint
CREATE TABLE "persistence_globals" (
	"deployment_id" text NOT NULL,
	"key" text NOT NULL,
	"json_value" bytea NOT NULL,
	CONSTRAINT "persistence_globals_deployment_id_key_pk" PRIMARY KEY("deployment_id","key")
);
--> statement-breakpoint
CREATE TABLE "read_only" (
	"deployment_id" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE INDEX "documents_by_table_and_id" ON "documents" USING btree ("deployment_id","table_id","id","ts");--> statement-breakpoint
CREATE INDEX "documents_by_table_ts_and_id" ON "documents" USING btree ("deployment_id","table_id","ts","id");--> statement-breakpoint
CREATE INDEX "indexes_by_index_id_key_prefix_key_sha256" ON "indexes" USING btree ("deployment_id","index_id","key_prefix","key_sha256");

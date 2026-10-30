CREATE SCHEMA "flarex_core";

--> statement-breakpoint
CREATE TABLE "flarex_core"."documents" (
	"instance_name" text NOT NULL,
	"id" "bytea" NOT NULL,
	"ts" bigint NOT NULL,
	"table_id" "bytea" NOT NULL,
	"json_value" "bytea" NOT NULL,
	"deleted" boolean DEFAULT false,
	"prev_ts" bigint,
	CONSTRAINT "documents_instance_name_ts_table_id_id_pk" PRIMARY KEY("instance_name","ts","table_id","id")
);

--> statement-breakpoint
CREATE TABLE "flarex_core"."indexes" (
	"instance_name" text NOT NULL,
	"index_id" "bytea" NOT NULL,
	"ts" bigint NOT NULL,
	"key_prefix" "bytea" NOT NULL,
	"key_suffix" "bytea",
	"key_sha256" "bytea" NOT NULL,
	"deleted" boolean,
	"table_id" "bytea",
	"document_id" "bytea",
	CONSTRAINT "indexes_instance_name_index_id_key_sha256_ts_pk" PRIMARY KEY("instance_name","index_id","key_sha256","ts")
);

--> statement-breakpoint
CREATE TABLE "flarex_core"."leases" (
	"instance_name" text PRIMARY KEY NOT NULL,
	"ts" bigint NOT NULL
);

--> statement-breakpoint
CREATE TABLE "flarex_core"."read_only" (
	"instance_name" text PRIMARY KEY NOT NULL
);

--> statement-breakpoint
CREATE TABLE "flarex_core"."persistence_globals" (
	"instance_name" text NOT NULL,
	"key" text NOT NULL,
	"json_value" "bytea" NOT NULL,
	CONSTRAINT "persistence_globals_instance_name_key_pk" PRIMARY KEY("instance_name","key")
);

--> statement-breakpoint
CREATE INDEX "documents_by_table_and_id" ON "flarex_core"."documents" USING btree ("instance_name","table_id","id","ts");
--> statement-breakpoint
CREATE INDEX "documents_by_table_ts_and_id" ON "flarex_core"."documents" USING btree ("instance_name","table_id","ts","id");
--> statement-breakpoint
CREATE INDEX "indexes_by_index_id_key_prefix_key_sha256" ON "flarex_core"."indexes" USING btree ("instance_name","index_id","key_prefix","key_sha256");

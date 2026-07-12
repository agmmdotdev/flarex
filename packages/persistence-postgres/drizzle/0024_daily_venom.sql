CREATE TABLE "fx_system_index_build_state" (
	"scope_id" text NOT NULL,
	"index_definition_id" integer NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"start_commit_seq" bigint NOT NULL,
	"lifecycle" text NOT NULL,
	"cursor_codec_version" integer NOT NULL,
	"backfill_cursor_row_id" "bytea",
	"attempt_fence" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_index_build_state_scope_id_index_definition_id_pk" PRIMARY KEY("scope_id","index_definition_id"),
	CONSTRAINT "fx_system_index_build_scope_non_empty" CHECK (btrim("fx_system_index_build_state"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_index_build_definition_id_positive" CHECK ("fx_system_index_build_state"."index_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_system_index_build_generation_check" CHECK ("fx_system_index_build_state"."storage_generation" = 'flarexdb_v1'),
	CONSTRAINT "fx_system_index_build_generation_fence_positive" CHECK ("fx_system_index_build_state"."storage_generation_fence" >= 1),
	CONSTRAINT "fx_system_index_build_epoch_non_empty" CHECK (btrim("fx_system_index_build_state"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_index_build_start_seq_non_negative" CHECK ("fx_system_index_build_state"."start_commit_seq" >= 0),
	CONSTRAINT "fx_system_index_build_lifecycle_check" CHECK ("fx_system_index_build_state"."lifecycle" in ('declared', 'building', 'backfilling', 'validating', 'enabled', 'retiring')),
	CONSTRAINT "fx_system_index_build_cursor_codec_check" CHECK ("fx_system_index_build_state"."cursor_codec_version" = 1),
	CONSTRAINT "fx_system_index_build_cursor_length_check" CHECK ("fx_system_index_build_state"."backfill_cursor_row_id" is null or octet_length("fx_system_index_build_state"."backfill_cursor_row_id") = 16),
	CONSTRAINT "fx_system_index_build_pre_backfill_cursor_check" CHECK ("fx_system_index_build_state"."lifecycle" not in ('declared', 'building') or "fx_system_index_build_state"."backfill_cursor_row_id" is null),
	CONSTRAINT "fx_system_index_build_attempt_fence_positive" CHECK ("fx_system_index_build_state"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_index_build_timestamp_order_check" CHECK ("fx_system_index_build_state"."updated_at" >= "fx_system_index_build_state"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fx_system_index_build_state" ADD CONSTRAINT "fx_system_index_build_scope_clock_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;

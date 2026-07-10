CREATE TABLE "fx_system_scope_clock" (
	"scope_id" text PRIMARY KEY NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint DEFAULT 1 NOT NULL,
	"last_commit_seq" bigint DEFAULT 0 NOT NULL,
	"last_outbox_seq" bigint DEFAULT 0 NOT NULL,
	"epoch" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_scope_clock_scope_id_non_empty_check" CHECK (btrim("fx_system_scope_clock"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_scope_clock_storage_generation_check" CHECK ("fx_system_scope_clock"."storage_generation" in ('legacy_v1', 'flarexdb_v1')),
	CONSTRAINT "fx_system_scope_clock_storage_generation_fence_positive_check" CHECK ("fx_system_scope_clock"."storage_generation_fence" >= 1),
	CONSTRAINT "fx_system_scope_clock_last_commit_seq_non_negative_check" CHECK ("fx_system_scope_clock"."last_commit_seq" >= 0),
	CONSTRAINT "fx_system_scope_clock_last_outbox_seq_non_negative_check" CHECK ("fx_system_scope_clock"."last_outbox_seq" >= 0),
	CONSTRAINT "fx_system_scope_clock_epoch_non_empty_check" CHECK (btrim("fx_system_scope_clock"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> '')
);

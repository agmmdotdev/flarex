CREATE TABLE "fx_app_row_current" (
	"scope_uuid" uuid NOT NULL,
	"table_id" integer NOT NULL,
	"row_id" "bytea" NOT NULL,
	"commit_seq" bigint NOT NULL,
	CONSTRAINT "fx_app_row_current_scope_uuid_table_id_row_id_pk" PRIMARY KEY("scope_uuid","table_id","row_id"),
	CONSTRAINT "fx_app_row_current_table_id_positive_check" CHECK ("fx_app_row_current"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_row_current_row_id_length_check" CHECK (octet_length("fx_app_row_current"."row_id") = 16),
	CONSTRAINT "fx_app_row_current_commit_seq_positive_check" CHECK ("fx_app_row_current"."commit_seq" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fx_app_row_rev" (
	"scope_uuid" uuid NOT NULL,
	"table_id" integer NOT NULL,
	"row_id" "bytea" NOT NULL,
	"commit_seq" bigint NOT NULL,
	"prev_commit_seq" bigint,
	"write_epoch_uuid" uuid NOT NULL,
	"schema_version_id" text NOT NULL,
	"creation_time" double precision NOT NULL,
	"value_codec_version" integer NOT NULL,
	"is_tombstone" boolean NOT NULL,
	"value_json" jsonb,
	"value_bytes" "bytea",
	"value_sha256" "bytea",
	CONSTRAINT "fx_app_row_rev_scope_uuid_table_id_row_id_commit_seq_pk" PRIMARY KEY("scope_uuid","table_id","row_id","commit_seq"),
	CONSTRAINT "fx_app_row_rev_table_id_positive_check" CHECK ("fx_app_row_rev"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_row_rev_row_id_length_check" CHECK (octet_length("fx_app_row_rev"."row_id") = 16),
	CONSTRAINT "fx_app_row_rev_commit_seq_positive_check" CHECK ("fx_app_row_rev"."commit_seq" >= 1),
	CONSTRAINT "fx_app_row_rev_prev_commit_seq_check" CHECK ("fx_app_row_rev"."prev_commit_seq" is null or ("fx_app_row_rev"."prev_commit_seq" >= 1 and "fx_app_row_rev"."prev_commit_seq" < "fx_app_row_rev"."commit_seq")),
	CONSTRAINT "fx_app_row_rev_schema_version_id_non_empty_check" CHECK (btrim("fx_app_row_rev"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_app_row_rev_creation_time_check" CHECK ("fx_app_row_rev"."creation_time" > 0 and "fx_app_row_rev"."creation_time" < 9007199254740992),
	CONSTRAINT "fx_app_row_rev_value_codec_version_check" CHECK ("fx_app_row_rev"."value_codec_version" = 1),
	CONSTRAINT "fx_app_row_rev_value_state_check" CHECK (
        (
          "fx_app_row_rev"."is_tombstone"
          and "fx_app_row_rev"."value_json" is null
          and "fx_app_row_rev"."value_bytes" is null
          and "fx_app_row_rev"."value_sha256" is null
        )
        or
        (
          not "fx_app_row_rev"."is_tombstone"
          and "fx_app_row_rev"."value_json" is not null
          and jsonb_typeof("fx_app_row_rev"."value_json") = 'object'
          and "fx_app_row_rev"."value_bytes" is not null
          and octet_length("fx_app_row_rev"."value_bytes") > 0
          and "fx_app_row_rev"."value_sha256" is not null
          and octet_length("fx_app_row_rev"."value_sha256") = 32
        )
      )
);
--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" ADD COLUMN "scope_uuid" uuid GENERATED ALWAYS AS (
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      ) STORED;--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" ADD COLUMN "epoch_uuid" uuid GENERATED ALWAYS AS (
        case
          when "epoch" ~ '^epoch_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("epoch" from 7)::uuid
          else null
        end
      ) STORED;--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" ADD CONSTRAINT "fx_system_scope_clock_scope_uuid_unique" UNIQUE("scope_uuid");--> statement-breakpoint
ALTER TABLE "fx_app_row_current" ADD CONSTRAINT "fx_app_row_current_revision_fk" FOREIGN KEY ("scope_uuid","table_id","row_id","commit_seq") REFERENCES "fx_app_row_rev"("scope_uuid","table_id","row_id","commit_seq") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_app_row_rev" ADD CONSTRAINT "fx_app_row_rev_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE no action;

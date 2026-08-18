CREATE TABLE "fx_system_retained_history_scheduler" (
	"scheduler_key" text PRIMARY KEY NOT NULL,
	"scheduler_state" text NOT NULL,
	"run_fence" bigint NOT NULL,
	"checkpoint_sequence" bigint NOT NULL,
	"run_owner" uuid,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"continuation_codec_version" integer,
	"continuation_bytes" "bytea",
	"continuation_sha256" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_retained_history_scheduler_key_check" CHECK ("fx_system_retained_history_scheduler"."scheduler_key" = 'retained_history_maintenance_v1'),
	CONSTRAINT "fx_system_retained_history_scheduler_state_check" CHECK ("fx_system_retained_history_scheduler"."scheduler_state" in ('idle', 'claimed')),
	CONSTRAINT "fx_system_retained_history_scheduler_fence_check" CHECK ("fx_system_retained_history_scheduler"."run_fence" >= 0),
	CONSTRAINT "fx_system_retained_history_scheduler_checkpoint_sequence_check" CHECK ("fx_system_retained_history_scheduler"."checkpoint_sequence" >= 0),
	CONSTRAINT "fx_system_retained_history_scheduler_claim_check" CHECK (
        (
          "fx_system_retained_history_scheduler"."scheduler_state" = 'idle'
          and "fx_system_retained_history_scheduler"."run_owner" is null
          and "fx_system_retained_history_scheduler"."claimed_at" is null
          and "fx_system_retained_history_scheduler"."claim_expires_at" is null
        )
        or
        (
          "fx_system_retained_history_scheduler"."scheduler_state" = 'claimed'
          and "fx_system_retained_history_scheduler"."run_owner" is not null
          and "fx_system_retained_history_scheduler"."claimed_at" is not null
          and isfinite("fx_system_retained_history_scheduler"."claimed_at")
          and "fx_system_retained_history_scheduler"."claim_expires_at" is not null
          and isfinite("fx_system_retained_history_scheduler"."claim_expires_at")
          and "fx_system_retained_history_scheduler"."claim_expires_at" > "fx_system_retained_history_scheduler"."claimed_at"
        )
      ),
	CONSTRAINT "fx_system_retained_history_scheduler_continuation_check" CHECK (
        (
          "fx_system_retained_history_scheduler"."continuation_codec_version" is null
          and "fx_system_retained_history_scheduler"."continuation_bytes" is null
          and "fx_system_retained_history_scheduler"."continuation_sha256" is null
        )
        or
        (
          "fx_system_retained_history_scheduler"."continuation_codec_version" = 1
          and "fx_system_retained_history_scheduler"."continuation_bytes" is not null
          and octet_length("fx_system_retained_history_scheduler"."continuation_bytes") between 1 and 65536
          and "fx_system_retained_history_scheduler"."continuation_sha256" is not null
          and octet_length("fx_system_retained_history_scheduler"."continuation_sha256") = 32
        )
      ),
	CONSTRAINT "fx_system_retained_history_scheduler_timestamp_check" CHECK (
        isfinite("fx_system_retained_history_scheduler"."next_run_at")
        and isfinite("fx_system_retained_history_scheduler"."created_at")
        and isfinite("fx_system_retained_history_scheduler"."updated_at")
        and "fx_system_retained_history_scheduler"."updated_at" >= "fx_system_retained_history_scheduler"."created_at"
	)
);
--> statement-breakpoint
INSERT INTO "fx_system_retained_history_scheduler" (
	"scheduler_key",
	"scheduler_state",
	"run_fence",
	"checkpoint_sequence"
) VALUES (
	'retained_history_maintenance_v1',
	'idle',
	0,
	0
);

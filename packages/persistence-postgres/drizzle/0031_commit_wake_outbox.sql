CREATE TABLE "fx_system_outbox" (
	"scope_uuid" uuid NOT NULL,
	"outbox_seq" bigint NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"event_kind" text NOT NULL,
	"delivery_state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"attempt_count" bigint DEFAULT 0 NOT NULL,
	"claim_fence" bigint DEFAULT 0 NOT NULL,
	"claim_owner" uuid,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"last_failure_code" text,
	"last_failure_summary" text,
	"last_failed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"dead_lettered_at" timestamp with time zone,
	CONSTRAINT "fx_system_outbox_scope_uuid_outbox_seq_pk" PRIMARY KEY("scope_uuid","outbox_seq"),
	CONSTRAINT "fx_system_outbox_commit_event_unique" UNIQUE("scope_uuid","event_kind","commit_seq"),
	CONSTRAINT "fx_system_outbox_outbox_seq_check" CHECK ("fx_system_outbox"."outbox_seq" >= 1),
	CONSTRAINT "fx_system_outbox_commit_seq_check" CHECK ("fx_system_outbox"."commit_seq" >= 1),
	CONSTRAINT "fx_system_outbox_event_kind_check" CHECK ("fx_system_outbox"."event_kind" = 'deployment_sync_commit_wake_v1'),
	CONSTRAINT "fx_system_outbox_delivery_state_check" CHECK ("fx_system_outbox"."delivery_state" in ('pending', 'claimed', 'delivered', 'dead_lettered')),
	CONSTRAINT "fx_system_outbox_attempt_fence_check" CHECK (
        "fx_system_outbox"."attempt_count" >= 0
        and "fx_system_outbox"."claim_fence" >= 0
        and "fx_system_outbox"."attempt_count" = "fx_system_outbox"."claim_fence"
      ),
	CONSTRAINT "fx_system_outbox_failure_evidence_check" CHECK (
        (
          (
            "fx_system_outbox"."last_failure_code" is null
            and "fx_system_outbox"."last_failure_summary" is null
            and "fx_system_outbox"."last_failed_at" is null
          )
          or
          (
            "fx_system_outbox"."last_failure_code" in (
              'transient_delivery',
              'claim_lease_expired',
              'terminal_delivery',
              'attempts_exhausted'
            )
            and "fx_system_outbox"."last_failed_at" is not null
            and isfinite("fx_system_outbox"."last_failed_at")
            and "fx_system_outbox"."last_failed_at" >= "fx_system_outbox"."created_at"
            and (
              "fx_system_outbox"."last_failure_summary" is null
              or (
                btrim("fx_system_outbox"."last_failure_summary", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
                and octet_length("fx_system_outbox"."last_failure_summary") <= 1024
              )
            )
          )
        ) is true
      ),
	CONSTRAINT "fx_system_outbox_state_shape_check" CHECK (
        (
          (
            "fx_system_outbox"."delivery_state" = 'pending'
            and "fx_system_outbox"."next_attempt_at" is not null
            and isfinite("fx_system_outbox"."next_attempt_at")
            and "fx_system_outbox"."next_attempt_at" >= "fx_system_outbox"."created_at"
            and "fx_system_outbox"."claim_owner" is null
            and "fx_system_outbox"."claimed_at" is null
            and "fx_system_outbox"."claim_expires_at" is null
            and "fx_system_outbox"."delivered_at" is null
            and "fx_system_outbox"."dead_lettered_at" is null
            and (
              (
                "fx_system_outbox"."attempt_count" = 0
                and "fx_system_outbox"."next_attempt_at" = "fx_system_outbox"."created_at"
                and "fx_system_outbox"."last_failure_code" is null
                and "fx_system_outbox"."last_failure_summary" is null
                and "fx_system_outbox"."last_failed_at" is null
              )
              or
              (
                "fx_system_outbox"."attempt_count" >= 1
                and "fx_system_outbox"."last_failure_code" is not null
                and "fx_system_outbox"."last_failed_at" is not null
                and "fx_system_outbox"."next_attempt_at" >= "fx_system_outbox"."last_failed_at"
              )
            )
          )
          or
          (
            "fx_system_outbox"."delivery_state" = 'claimed'
            and "fx_system_outbox"."attempt_count" >= 1
            and "fx_system_outbox"."next_attempt_at" is null
            and "fx_system_outbox"."claim_owner" is not null
            and "fx_system_outbox"."claimed_at" is not null
            and isfinite("fx_system_outbox"."claimed_at")
            and "fx_system_outbox"."claimed_at" >= "fx_system_outbox"."created_at"
            and "fx_system_outbox"."claim_expires_at" is not null
            and isfinite("fx_system_outbox"."claim_expires_at")
            and "fx_system_outbox"."claim_expires_at" > "fx_system_outbox"."claimed_at"
            and "fx_system_outbox"."delivered_at" is null
            and "fx_system_outbox"."dead_lettered_at" is null
            and (
              (
                "fx_system_outbox"."attempt_count" = 1
                and "fx_system_outbox"."last_failure_code" is null
                and "fx_system_outbox"."last_failure_summary" is null
                and "fx_system_outbox"."last_failed_at" is null
              )
              or
              (
                "fx_system_outbox"."attempt_count" > 1
                and "fx_system_outbox"."last_failure_code" is not null
                and "fx_system_outbox"."last_failed_at" is not null
              )
            )
          )
          or
          (
            "fx_system_outbox"."delivery_state" = 'delivered'
            and "fx_system_outbox"."attempt_count" >= 1
            and "fx_system_outbox"."next_attempt_at" is null
            and "fx_system_outbox"."claim_owner" is null
            and "fx_system_outbox"."claimed_at" is null
            and "fx_system_outbox"."claim_expires_at" is null
            and "fx_system_outbox"."delivered_at" is not null
            and isfinite("fx_system_outbox"."delivered_at")
            and "fx_system_outbox"."delivered_at" >= "fx_system_outbox"."created_at"
            and "fx_system_outbox"."dead_lettered_at" is null
            and (
              (
                "fx_system_outbox"."attempt_count" = 1
                and "fx_system_outbox"."last_failure_code" is null
                and "fx_system_outbox"."last_failure_summary" is null
                and "fx_system_outbox"."last_failed_at" is null
              )
              or
              (
                "fx_system_outbox"."attempt_count" > 1
                and "fx_system_outbox"."last_failure_code" is not null
                and "fx_system_outbox"."last_failed_at" is not null
              )
            )
          )
          or
          (
            "fx_system_outbox"."delivery_state" = 'dead_lettered'
            and "fx_system_outbox"."attempt_count" >= 1
            and "fx_system_outbox"."next_attempt_at" is null
            and "fx_system_outbox"."claim_owner" is null
            and "fx_system_outbox"."claimed_at" is null
            and "fx_system_outbox"."claim_expires_at" is null
            and "fx_system_outbox"."last_failure_code" in (
              'terminal_delivery',
              'attempts_exhausted'
            )
            and "fx_system_outbox"."last_failed_at" is not null
            and "fx_system_outbox"."delivered_at" is null
            and "fx_system_outbox"."dead_lettered_at" is not null
            and isfinite("fx_system_outbox"."dead_lettered_at")
            and "fx_system_outbox"."dead_lettered_at" >= "fx_system_outbox"."created_at"
            and "fx_system_outbox"."dead_lettered_at" = "fx_system_outbox"."last_failed_at"
          )
        ) is true
      ),
	CONSTRAINT "fx_system_outbox_created_at_check" CHECK (isfinite("fx_system_outbox"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_outbox" ADD CONSTRAINT "fx_system_outbox_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fx_system_outbox_claimable_idx" ON "fx_system_outbox" USING btree ("scope_uuid",(
          case
            when "delivery_state" = 'pending' then "next_attempt_at"
            when "delivery_state" = 'claimed' then "claim_expires_at"
            else null
          end
        ),"outbox_seq") WHERE "fx_system_outbox"."delivery_state" in ('pending', 'claimed');--> statement-breakpoint
CREATE INDEX "fx_system_outbox_commit_token_idx" ON "fx_system_outbox" USING btree ("scope_uuid","commit_seq","epoch_uuid","outbox_seq");

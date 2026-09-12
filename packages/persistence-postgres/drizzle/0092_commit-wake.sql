-- The migrator owns the transaction; preserve the clock-before-wake lock order.
LOCK TABLE "fx_system_scope_clock", "fx_system_outbox" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "fx_system_outbox" RENAME TO "fx_system_commit_wake";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_commit_event_unique";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_outbox_seq_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_commit_seq_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_event_kind_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_delivery_state_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_attempt_fence_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_failure_evidence_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_state_shape_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_created_at_check";--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" DROP CONSTRAINT "fx_system_scope_clock_last_outbox_seq_non_negative_check";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_scope_clock_fk";
--> statement-breakpoint
DROP INDEX "fx_system_outbox_claimable_idx";--> statement-breakpoint
DROP INDEX "fx_system_outbox_commit_token_idx";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP CONSTRAINT "fx_system_outbox_scope_uuid_outbox_seq_pk";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" ADD CONSTRAINT "fx_system_commit_wake_scope_uuid_commit_seq_pk" PRIMARY KEY("scope_uuid","commit_seq");--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" ADD CONSTRAINT "fx_system_commit_wake_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fx_system_commit_wake_claimable_idx" ON "fx_system_commit_wake" USING btree ("scope_uuid",(
          case
            when "delivery_state" = 'pending' then "next_attempt_at"
            when "delivery_state" = 'claimed' then "claim_expires_at"
            else null
          end
        ),"commit_seq") WHERE "fx_system_commit_wake"."delivery_state" in ('pending', 'claimed');--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP COLUMN "outbox_seq";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP COLUMN "event_kind";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" DROP COLUMN "attempt_count";--> statement-breakpoint
ALTER TABLE "fx_system_scope_clock" DROP COLUMN "last_outbox_seq";--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" ADD CONSTRAINT "fx_system_commit_wake_commit_seq_check" CHECK ("fx_system_commit_wake"."commit_seq" >= 1);--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" ADD CONSTRAINT "fx_system_commit_wake_delivery_state_check" CHECK ("fx_system_commit_wake"."delivery_state" in ('pending', 'claimed', 'delivered', 'dead_lettered'));--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" ADD CONSTRAINT "fx_system_commit_wake_claim_fence_check" CHECK ("fx_system_commit_wake"."claim_fence" >= 0);--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" ADD CONSTRAINT "fx_system_commit_wake_failure_evidence_check" CHECK (
        (
          (
            "fx_system_commit_wake"."last_failure_code" is null
            and "fx_system_commit_wake"."last_failure_summary" is null
            and "fx_system_commit_wake"."last_failed_at" is null
          )
          or
          (
            "fx_system_commit_wake"."last_failure_code" in (
              'transient_delivery',
              'claim_lease_expired',
              'terminal_delivery',
              'attempts_exhausted'
            )
            and "fx_system_commit_wake"."last_failed_at" is not null
            and isfinite("fx_system_commit_wake"."last_failed_at")
            and "fx_system_commit_wake"."last_failed_at" >= "fx_system_commit_wake"."created_at"
            and (
              "fx_system_commit_wake"."last_failure_summary" is null
              or (
                btrim("fx_system_commit_wake"."last_failure_summary", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
                and octet_length("fx_system_commit_wake"."last_failure_summary") <= 1024
              )
            )
          )
        ) is true
      );--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" ADD CONSTRAINT "fx_system_commit_wake_state_shape_check" CHECK (
        (
          (
            "fx_system_commit_wake"."delivery_state" = 'pending'
            and "fx_system_commit_wake"."next_attempt_at" is not null
            and isfinite("fx_system_commit_wake"."next_attempt_at")
            and "fx_system_commit_wake"."next_attempt_at" >= "fx_system_commit_wake"."created_at"
            and "fx_system_commit_wake"."claim_owner" is null
            and "fx_system_commit_wake"."claimed_at" is null
            and "fx_system_commit_wake"."claim_expires_at" is null
            and "fx_system_commit_wake"."delivered_at" is null
            and "fx_system_commit_wake"."dead_lettered_at" is null
            and (
              (
                "fx_system_commit_wake"."claim_fence" = 0
                and "fx_system_commit_wake"."next_attempt_at" = "fx_system_commit_wake"."created_at"
                and "fx_system_commit_wake"."last_failure_code" is null
                and "fx_system_commit_wake"."last_failure_summary" is null
                and "fx_system_commit_wake"."last_failed_at" is null
              )
              or
              (
                "fx_system_commit_wake"."claim_fence" >= 1
                and "fx_system_commit_wake"."last_failure_code" is not null
                and "fx_system_commit_wake"."last_failed_at" is not null
                and "fx_system_commit_wake"."next_attempt_at" >= "fx_system_commit_wake"."last_failed_at"
              )
            )
          )
          or
          (
            "fx_system_commit_wake"."delivery_state" = 'claimed'
            and "fx_system_commit_wake"."claim_fence" >= 1
            and "fx_system_commit_wake"."next_attempt_at" is null
            and "fx_system_commit_wake"."claim_owner" is not null
            and "fx_system_commit_wake"."claimed_at" is not null
            and isfinite("fx_system_commit_wake"."claimed_at")
            and "fx_system_commit_wake"."claimed_at" >= "fx_system_commit_wake"."created_at"
            and "fx_system_commit_wake"."claim_expires_at" is not null
            and isfinite("fx_system_commit_wake"."claim_expires_at")
            and "fx_system_commit_wake"."claim_expires_at" > "fx_system_commit_wake"."claimed_at"
            and "fx_system_commit_wake"."delivered_at" is null
            and "fx_system_commit_wake"."dead_lettered_at" is null
            and (
              (
                "fx_system_commit_wake"."claim_fence" = 1
                and "fx_system_commit_wake"."last_failure_code" is null
                and "fx_system_commit_wake"."last_failure_summary" is null
                and "fx_system_commit_wake"."last_failed_at" is null
              )
              or
              (
                "fx_system_commit_wake"."claim_fence" > 1
                and "fx_system_commit_wake"."last_failure_code" is not null
                and "fx_system_commit_wake"."last_failed_at" is not null
              )
            )
          )
          or
          (
            "fx_system_commit_wake"."delivery_state" = 'delivered'
            and "fx_system_commit_wake"."claim_fence" >= 1
            and "fx_system_commit_wake"."next_attempt_at" is null
            and "fx_system_commit_wake"."claim_owner" is null
            and "fx_system_commit_wake"."claimed_at" is null
            and "fx_system_commit_wake"."claim_expires_at" is null
            and "fx_system_commit_wake"."delivered_at" is not null
            and isfinite("fx_system_commit_wake"."delivered_at")
            and "fx_system_commit_wake"."delivered_at" >= "fx_system_commit_wake"."created_at"
            and "fx_system_commit_wake"."dead_lettered_at" is null
            and (
              (
                "fx_system_commit_wake"."claim_fence" = 1
                and "fx_system_commit_wake"."last_failure_code" is null
                and "fx_system_commit_wake"."last_failure_summary" is null
                and "fx_system_commit_wake"."last_failed_at" is null
              )
              or
              (
                "fx_system_commit_wake"."claim_fence" > 1
                and "fx_system_commit_wake"."last_failure_code" is not null
                and "fx_system_commit_wake"."last_failed_at" is not null
              )
            )
          )
          or
          (
            "fx_system_commit_wake"."delivery_state" = 'dead_lettered'
            and "fx_system_commit_wake"."claim_fence" >= 1
            and "fx_system_commit_wake"."next_attempt_at" is null
            and "fx_system_commit_wake"."claim_owner" is null
            and "fx_system_commit_wake"."claimed_at" is null
            and "fx_system_commit_wake"."claim_expires_at" is null
            and "fx_system_commit_wake"."last_failure_code" in (
              'terminal_delivery',
              'attempts_exhausted'
            )
            and "fx_system_commit_wake"."last_failed_at" is not null
            and "fx_system_commit_wake"."delivered_at" is null
            and "fx_system_commit_wake"."dead_lettered_at" is not null
            and isfinite("fx_system_commit_wake"."dead_lettered_at")
            and "fx_system_commit_wake"."dead_lettered_at" >= "fx_system_commit_wake"."created_at"
            and "fx_system_commit_wake"."dead_lettered_at" = "fx_system_commit_wake"."last_failed_at"
          )
        ) is true
      );--> statement-breakpoint
ALTER TABLE "fx_system_commit_wake" ADD CONSTRAINT "fx_system_commit_wake_created_at_check" CHECK (isfinite("fx_system_commit_wake"."created_at"));

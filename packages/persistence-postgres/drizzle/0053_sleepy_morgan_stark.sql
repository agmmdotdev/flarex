CREATE TABLE "fx_system_durable_task_compute_pending_v1" (
	"scope_id" text NOT NULL,
	"run_id" text NOT NULL,
	"requested_effect_sequence" bigint NOT NULL,
	"kind" text NOT NULL,
	"eligible_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_task_compute_pending_v1_pk" PRIMARY KEY("scope_id","run_id","requested_effect_sequence"),
	CONSTRAINT "fx_task_compute_pending_v1_identity_check" CHECK ("fx_system_durable_task_compute_pending_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_compute_pending_v1"."requested_effect_sequence" >= 1
        and "fx_system_durable_task_compute_pending_v1"."kind" in (
          'dispatch_attempt',
          'request_execution_cancellation'
        )),
	CONSTRAINT "fx_task_compute_pending_v1_eligible_at_check" CHECK (isfinite("fx_system_durable_task_compute_pending_v1"."eligible_at")
        and "fx_system_durable_task_compute_pending_v1"."eligible_at" = date_trunc('milliseconds', "fx_system_durable_task_compute_pending_v1"."eligible_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_pending_v1" ADD CONSTRAINT "fx_task_compute_pending_v1_effect_fk" FOREIGN KEY ("scope_id","run_id","requested_effect_sequence") REFERENCES "fx_system_durable_task_requested_effect_v1"("scope_id","run_id","sequence") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP INDEX "fx_task_compute_dispatch_v1_due_idx";--> statement-breakpoint
CREATE INDEX "fx_task_compute_dispatch_v1_due_idx" ON "fx_system_durable_task_compute_dispatch_v1" USING btree ("scope_id","delivery_state","next_attempt_at","run_id","requested_effect_sequence") WHERE "fx_system_durable_task_compute_dispatch_v1"."claim_owner" is null;--> statement-breakpoint
DROP INDEX "fx_task_compute_cancel_v1_due_idx";--> statement-breakpoint
CREATE INDEX "fx_task_compute_cancel_v1_due_idx" ON "fx_system_durable_task_compute_cancellation_v1" USING btree ("scope_id","delivery_state","next_attempt_at","run_id","requested_effect_sequence") WHERE "fx_system_durable_task_compute_cancellation_v1"."claim_owner" is null;--> statement-breakpoint
INSERT INTO "fx_system_durable_task_compute_pending_v1" (
	"scope_id",
	"run_id",
	"requested_effect_sequence",
	"kind",
	"eligible_at"
)
SELECT
	effect."scope_id",
	effect."run_id",
	effect."sequence",
	effect."kind",
	date_trunc('milliseconds', statement_timestamp())
FROM "fx_system_durable_task_requested_effect_v1" AS effect
WHERE
	(
		effect."kind" = 'dispatch_attempt'
		AND NOT EXISTS (
			SELECT 1
			FROM "fx_system_durable_task_compute_dispatch_v1" AS checkpoint
			WHERE checkpoint."scope_id" = effect."scope_id"
				AND checkpoint."run_id" = effect."run_id"
				AND checkpoint."requested_effect_sequence" = effect."sequence"
		)
	)
	OR (
		effect."kind" = 'request_execution_cancellation'
		AND NOT EXISTS (
			SELECT 1
			FROM "fx_system_durable_task_compute_cancellation_v1" AS checkpoint
			WHERE checkpoint."scope_id" = effect."scope_id"
				AND checkpoint."run_id" = effect."run_id"
				AND checkpoint."requested_effect_sequence" = effect."sequence"
		)
	);--> statement-breakpoint
CREATE INDEX "fx_task_compute_pending_v1_discovery_idx" ON "fx_system_durable_task_compute_pending_v1" USING btree ("scope_id","kind","eligible_at","run_id","requested_effect_sequence");

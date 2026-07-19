CREATE TABLE "fx_system_tx_execution_claim" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"claim_fence" bigint NOT NULL,
	"claim_owner" uuid NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"claim_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_tx_execution_claim_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence"),
	CONSTRAINT "fx_system_tx_execution_claim_attempt_fence_check" CHECK ("fx_system_tx_execution_claim"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_tx_execution_claim_fence_check" CHECK ("fx_system_tx_execution_claim"."claim_fence" >= 1),
	CONSTRAINT "fx_system_tx_execution_claim_owner_check" CHECK ("fx_system_tx_execution_claim"."claim_owner"::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "fx_system_tx_execution_claim_time_check" CHECK (
        isfinite("fx_system_tx_execution_claim"."claimed_at")
        and isfinite("fx_system_tx_execution_claim"."claim_expires_at")
        and "fx_system_tx_execution_claim"."claim_expires_at" > "fx_system_tx_execution_claim"."claimed_at"
      )
);
--> statement-breakpoint
ALTER TABLE "fx_system_tx_execution_claim" ADD CONSTRAINT "fx_system_tx_execution_claim_journal_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_journal"("scope_uuid","session_id","attempt_fence") ON DELETE cascade ON UPDATE restrict;

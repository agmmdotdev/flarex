-- Complete writer-owned maintenance projections; historical digest-only rows
-- remain unavailable until the existing managed activation/backfill owner runs.
-- Preserve every outcome and require the old finite recovery profile to drain.
-- Acquire installation exclusion before any application-table/clock lock.
-- Bootstrap is unverified; an active installation must enter the managed drain.
DO $$ DECLARE gate fx_system_installation; BEGIN
  SELECT * INTO STRICT gate FROM fx_system_installation WHERE singleton_id = 1;
  IF NOT pg_try_advisory_xact_lock(2147483002, (gate.namespace_oid - 2147483648)::integer) THEN
    RAISE EXCEPTION 'whole mutation migration requires installation quiescence' USING ERRCODE = '55P03';
  END IF;
  IF gate.state <> 'unverified' AND NOT (gate.state = 'draining' AND gate.maintenance_pid = pg_backend_pid()
    AND gate.maintenance_backend_start = (SELECT backend_start FROM pg_catalog.pg_stat_activity WHERE pid = pg_backend_pid())) THEN
    RAISE EXCEPTION 'whole mutation migration requires its managed maintenance owner' USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
LOCK TABLE "fx_system_scope_clock" IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM fx_system_tx_session s JOIN fx_system_tx_journal j
    ON j.scope_uuid = s.scope_uuid AND j.session_id = s.session_id
    WHERE s.lifecycle NOT IN ('committed', 'aborted', 'expired') AND j.execution_profile = 'finiteRoot') THEN
    RAISE EXCEPTION 'whole mutation cutover requires terminal or authenticated recovery drain of existing finite roots' USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
-- The four-row finite accepting reader has no remaining runtime consumer.
-- Its scope-only observation owner remains in use by scope authority admission.
DROP FUNCTION "fx_lock_finite_running_attempt"(text,uuid,bigint,text,bigint,text);
--> statement-breakpoint
ALTER TABLE "fx_system_metadata_contract_observation" ADD COLUMN "semantic_bytes" bytea,
  ADD CONSTRAINT "fx_metadata_contract_semantic_bytes_check" CHECK (semantic_bytes IS NULL OR
    (present AND octet_length(semantic_bytes) BETWEEN 1 AND 4194304));
--> statement-breakpoint
-- The existing exact request/session authority becomes the one finite anchor.
-- Durable operation profiles retain their actual lease/journal/claim children.
ALTER TABLE "fx_system_tx_session" ADD COLUMN "execution_profile" text NOT NULL DEFAULT 'durableOperations',
  ADD COLUMN "finite_attempt_bytes" bytea, ADD COLUMN "finite_attempt_sha256" bytea,
  ADD COLUMN "finite_snapshot_epoch_uuid" uuid, ADD COLUMN "finite_snapshot_commit_seq" bigint,
  ADD COLUMN "finite_metadata_watermark" bigint, ADD COLUMN "finite_lease_expires_at" timestamptz,
  ADD COLUMN "finite_claim_owner" uuid, ADD COLUMN "finite_claim_fence" bigint,
  ADD COLUMN "finite_claimed_at" timestamptz, ADD COLUMN "finite_claim_expires_at" timestamptz,
  ADD CONSTRAINT "fx_system_tx_session_execution_profile_check" CHECK (execution_profile IN ('durableOperations', 'finiteRoot')),
  ADD CONSTRAINT "fx_system_tx_session_finite_anchor_check" CHECK (
    (execution_profile = 'durableOperations' AND finite_attempt_bytes IS NULL AND finite_attempt_sha256 IS NULL
      AND finite_snapshot_epoch_uuid IS NULL AND finite_snapshot_commit_seq IS NULL AND finite_metadata_watermark IS NULL
      AND finite_lease_expires_at IS NULL AND finite_claim_owner IS NULL AND finite_claim_fence IS NULL
      AND finite_claimed_at IS NULL AND finite_claim_expires_at IS NULL)
    OR (execution_profile = 'finiteRoot' AND finite_attempt_bytes IS NOT NULL
      AND octet_length(finite_attempt_bytes) BETWEEN 1 AND 131072
      AND finite_attempt_sha256 IS NOT NULL AND octet_length(finite_attempt_sha256) = 32));
--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD CONSTRAINT "fx_system_tx_session_finite_ownership_check" CHECK (
  execution_profile <> 'finiteRoot' OR (finite_snapshot_epoch_uuid IS NOT NULL AND finite_snapshot_commit_seq IS NOT NULL AND finite_snapshot_commit_seq >= 0
    AND (finite_metadata_watermark IS NULL OR finite_metadata_watermark >= 0)
    AND finite_lease_expires_at IS NOT NULL AND finite_claim_owner IS NOT NULL AND finite_claim_fence IS NOT NULL AND finite_claim_fence >= 1
    AND finite_claimed_at IS NOT NULL AND finite_claim_expires_at IS NOT NULL AND finite_claim_expires_at > finite_claimed_at
    AND isfinite(finite_claimed_at) AND isfinite(finite_claim_expires_at) AND isfinite(finite_lease_expires_at)
    AND finite_claim_expires_at <= finite_lease_expires_at AND finite_lease_expires_at <= hard_expires_at));
--> statement-breakpoint
CREATE UNIQUE INDEX "fx_system_finite_attempt_request_identity_unique" ON "fx_system_tx_session" (scope_uuid, request_key)
  WHERE execution_profile = 'finiteRoot';
--> statement-breakpoint
CREATE INDEX "fx_system_finite_attempt_claim_discovery_idx" ON "fx_system_tx_session"
  (scope_uuid, finite_claim_expires_at, session_id, attempt_fence)
  WHERE execution_profile = 'finiteRoot' AND lifecycle IN ('running', 'retrying');

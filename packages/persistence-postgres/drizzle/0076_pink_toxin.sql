LOCK TABLE "fx_system_tx_journal_relation_incoming" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "fx_system_tx_journal_relation_incoming"
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'cannot add active relation selection authority to populated private relation journal evidence';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_relation_incoming" DROP CONSTRAINT "fx_system_tx_journal_relation_incoming_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_relation_incoming" ADD COLUMN "activation_sequence" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_relation_incoming" ADD COLUMN "active_head_sha256" "bytea" NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_relation_incoming" ADD CONSTRAINT "fx_system_tx_journal_relation_incoming_identity_check" CHECK (
        "fx_system_tx_journal_relation_incoming"."attempt_fence" >= 1
        and "fx_system_tx_journal_relation_incoming"."edge_definition_id" between 1 and 2147483647
        and octet_length("fx_system_tx_journal_relation_incoming"."target_row_id") = 16
        and "fx_system_tx_journal_relation_incoming"."observed_adjacency_version" >= 0
        and "fx_system_tx_journal_relation_incoming"."activation_sequence" between 1 and 9223372036854775807
        and octet_length("fx_system_tx_journal_relation_incoming"."active_head_sha256") = 32
      );

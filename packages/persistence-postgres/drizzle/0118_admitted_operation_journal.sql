-- The replacement changes journal, syscall receipt and write-event bytes.
-- Existing sessions/outcomes need an explicit offline data disposition before
-- activation. This private proof is installed only on a fresh isolated schema.
LOCK TABLE "fx_system_tx_session", "fx_system_tx_journal",
  "fx_system_tx_journal_receipt", "fx_system_tx_journal_write_event"
  IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "fx_system_tx_session")
    OR EXISTS (SELECT 1 FROM "fx_system_tx_journal")
    OR EXISTS (SELECT 1 FROM "fx_system_tx_journal_receipt")
    OR EXISTS (SELECT 1 FROM "fx_system_tx_journal_write_event") THEN
    RAISE EXCEPTION 'session journal replacement requires fresh isolated data; old session and outcome disposition is required';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_request_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_outcome_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" DROP CONSTRAINT "fx_system_tx_journal_event_payload_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_format_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_request_check" CHECK (
        "fx_system_tx_journal_receipt"."request_codec_version" = 2
        and octet_length("fx_system_tx_journal_receipt"."request_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_receipt"."request_sha256") = 32
        and ("fx_system_tx_journal_receipt"."participant_binding_sha256" is null or octet_length("fx_system_tx_journal_receipt"."participant_binding_sha256") = 32)
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_outcome_check" CHECK (
        (("fx_system_tx_journal_receipt"."operation_kind" = 'admittedLogicalOperation' and "fx_system_tx_journal_receipt"."outcome_kind" in ('admittedLogicalInvoking', 'admittedLogicalResult', 'admittedLogicalError', 'error'))
          or ("fx_system_tx_journal_receipt"."operation_kind" <> 'admittedLogicalOperation' and "fx_system_tx_journal_receipt"."outcome_kind" in
            ('missing', 'present', 'inserted', 'unit', 'indexRangePage', 'relationIncomingPage', 'relationConflict', 'error')))
        and "fx_system_tx_journal_receipt"."outcome_codec_version" = 2
        and octet_length("fx_system_tx_journal_receipt"."outcome_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_receipt"."outcome_sha256") = 32
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" ADD CONSTRAINT "fx_system_tx_journal_event_payload_check" CHECK (
        "fx_system_tx_journal_write_event"."write_kind" in ('insert', 'patch', 'replace', 'delete', 'logicalDocument')
        and "fx_system_tx_journal_write_event"."event_codec_version" = 2
        and octet_length("fx_system_tx_journal_write_event"."event_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_write_event"."event_sha256") = 32
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_format_check" CHECK ("fx_system_tx_journal"."journal_format" = 'flarex.session-journal');

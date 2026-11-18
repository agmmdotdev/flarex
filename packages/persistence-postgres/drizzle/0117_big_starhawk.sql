-- Existing journal roots carry V1 sealed/recovery evidence. Activation waits for
-- the owner's normal attempt completion, abort and retention cleanup lifecycle;
-- committed outcome rows outside this temporary journal are preserved.
LOCK TABLE "fx_system_tx_journal" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "fx_system_tx_journal") THEN
    RAISE EXCEPTION 'mixed attempt journal migration requires an empty legacy journal';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "journal_format" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_format_check" CHECK ("journal_format" = 'flarex.session-journal-v2');--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" RENAME TO "fx_system_tx_journal_receipt";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_fence_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_sequence_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_operation_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_request_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_outcome_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_timestamp_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" DROP CONSTRAINT "fx_system_tx_journal_event_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" DROP CONSTRAINT "fx_system_tx_journal_event_payload_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_root_fk";
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD COLUMN "participant_binding_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" ADD COLUMN "effect_ordinal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_root_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_journal"("scope_uuid","session_id","attempt_fence") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_pk";
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence","last_syscall_sequence");--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" DROP CONSTRAINT "fx_system_tx_journal_event_pk";
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" ADD CONSTRAINT "fx_system_tx_journal_event_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence","syscall_sequence","effect_ordinal");--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_fence_check" CHECK ("fx_system_tx_journal_receipt"."attempt_fence" >= 1);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_sequence_check" CHECK ("fx_system_tx_journal_receipt"."last_syscall_sequence" >= 1);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_operation_check" CHECK (("fx_system_tx_journal_receipt"."operation_kind" in ('get', 'insert', 'patch', 'replace', 'delete', 'indexRange', 'relationIncoming')
        and "fx_system_tx_journal_receipt"."participant_binding_sha256" is null)
        or ("fx_system_tx_journal_receipt"."operation_kind" = 'admittedLogicalOperation'
        and "fx_system_tx_journal_receipt"."participant_binding_sha256" is not null));--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_request_check" CHECK (
        "fx_system_tx_journal_receipt"."request_codec_version" = 1
        and octet_length("fx_system_tx_journal_receipt"."request_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_receipt"."request_sha256") = 32
        and ("fx_system_tx_journal_receipt"."participant_binding_sha256" is null or octet_length("fx_system_tx_journal_receipt"."participant_binding_sha256") = 32)
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_timestamp_check" CHECK (
        isfinite("fx_system_tx_journal_receipt"."created_at")
        and isfinite("fx_system_tx_journal_receipt"."updated_at")
        and "fx_system_tx_journal_receipt"."updated_at" >= "fx_system_tx_journal_receipt"."created_at"
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" ADD CONSTRAINT "fx_system_tx_journal_event_identity_check" CHECK ("fx_system_tx_journal_write_event"."attempt_fence" >= 1 and "fx_system_tx_journal_write_event"."syscall_sequence" >= 1 and "fx_system_tx_journal_write_event"."effect_ordinal" between 0 and 65535);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" ADD CONSTRAINT "fx_system_tx_journal_event_payload_check" CHECK (
        "fx_system_tx_journal_write_event"."write_kind" in ('insert', 'patch', 'replace', 'delete', 'logicalDocument')
        and "fx_system_tx_journal_write_event"."event_codec_version" = 1
        and octet_length("fx_system_tx_journal_write_event"."event_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_write_event"."event_sha256") = 32
      );
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_state_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_sequence_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_failure_dimension_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_state_evidence_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "receipt_evidence_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "participant_work_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "participant_work_calls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_receipt_bytes_check" CHECK (
  "fx_system_tx_journal"."receipt_evidence_bytes" >= 0
  and (
    "fx_system_tx_journal"."receipt_evidence_bytes" <= 67108864
    or (
      "fx_system_tx_journal"."state" = 'failed'
      and "fx_system_tx_journal"."failure_dimension" is not null
      and "fx_system_tx_journal"."receipt_evidence_bytes" <= 134218752
    )
  )
);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_participant_work_bytes_check" CHECK (
  "fx_system_tx_journal"."participant_work_bytes" >= 0
  and (
    "fx_system_tx_journal"."participant_work_bytes" <= 67108864
    or ("fx_system_tx_journal"."state" = 'operation_failed'
      and "fx_system_tx_journal"."participant_work_bytes" <= 83886080)
  )
);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_participant_work_calls_check" CHECK (
  "fx_system_tx_journal"."participant_work_calls" >= 0
  and (
    "fx_system_tx_journal"."participant_work_calls" <= 65536
    or ("fx_system_tx_journal"."state" = 'operation_failed'
      and "fx_system_tx_journal"."participant_work_calls" <= 69633)
  )
);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_sequence_check" CHECK ("fx_system_tx_journal"."last_syscall_sequence" between 0 and 4096);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_failure_dimension_check" CHECK (
        "fx_system_tx_journal"."failure_dimension" is null
        or (
          "fx_system_tx_journal"."failure_dimension" is not null
          and "fx_system_tx_journal"."failure_dimension" in (
            'readDocuments',
            'readSemanticBytes',
            'pointReadDependencies',
            'indexedQuerySyscalls',
            'indexRangeReadDependencies',
            'indexRangeDependencyEvidenceBytes',
            'relationReadSyscalls',
            'relationReadDependencies',
            'relationBaseOccurrences',
            'writeOperations',
            'writeSemanticBytes',
            'materialWriteEventEvidenceBytes'
            ,'operationCalls'
            ,'receiptEvidenceBytes'
          )
        )
      );--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_outcome_check" CHECK (
        (("fx_system_tx_journal_receipt"."operation_kind" = 'admittedLogicalOperation' and "fx_system_tx_journal_receipt"."outcome_kind" in ('admittedLogicalInvoking', 'admittedLogicalResult', 'admittedLogicalError', 'error'))
          or ("fx_system_tx_journal_receipt"."operation_kind" <> 'admittedLogicalOperation' and "fx_system_tx_journal_receipt"."outcome_kind" in
            ('missing', 'present', 'inserted', 'unit', 'indexRangePage', 'relationIncomingPage', 'relationConflict', 'error')))
        and "fx_system_tx_journal_receipt"."outcome_codec_version" = 1
        and octet_length("fx_system_tx_journal_receipt"."outcome_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_receipt"."outcome_sha256") = 32
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_state_check" CHECK ("fx_system_tx_journal"."state" in ('open', 'sealed', 'failed', 'operation_invoking', 'operation_failed', 'relation_conflicted'));--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_state_evidence_check" CHECK (
        (
          "fx_system_tx_journal"."state" = 'open'
          and "fx_system_tx_journal"."failure_dimension" is null
          and "fx_system_tx_journal"."sealed_journal_bytes" is null
          and "fx_system_tx_journal"."sealed_journal_sha256" is null
          and "fx_system_tx_journal"."sealed_result_value_codec_version" is null
          and "fx_system_tx_journal"."sealed_result_semantic_bytes" is null
          and "fx_system_tx_journal"."sealed_result_bytes" is null
          and "fx_system_tx_journal"."sealed_result_sha256" is null
          and "fx_system_tx_journal"."sealed_at" is null
        )
        or (
          "fx_system_tx_journal"."state" = 'operation_invoking'
          and "fx_system_tx_journal"."failure_dimension" is null
          and "fx_system_tx_journal"."sealed_journal_bytes" is null
          and "fx_system_tx_journal"."sealed_journal_sha256" is null
          and "fx_system_tx_journal"."sealed_result_value_codec_version" is null
          and "fx_system_tx_journal"."sealed_result_semantic_bytes" is null
          and "fx_system_tx_journal"."sealed_result_bytes" is null
          and "fx_system_tx_journal"."sealed_result_sha256" is null
          and "fx_system_tx_journal"."sealed_at" is null
        )
        or (
          "fx_system_tx_journal"."state" = 'operation_failed'
          and "fx_system_tx_journal"."failure_dimension" is null
          and "fx_system_tx_journal"."sealed_journal_bytes" is null
          and "fx_system_tx_journal"."sealed_journal_sha256" is null
          and "fx_system_tx_journal"."sealed_result_value_codec_version" is null
          and "fx_system_tx_journal"."sealed_result_semantic_bytes" is null
          and "fx_system_tx_journal"."sealed_result_bytes" is null
          and "fx_system_tx_journal"."sealed_result_sha256" is null
          and "fx_system_tx_journal"."sealed_at" is null
        )
        or (
          "fx_system_tx_journal"."state" = 'failed'
          and "fx_system_tx_journal"."failure_dimension" is not null
          and "fx_system_tx_journal"."sealed_journal_bytes" is null
          and "fx_system_tx_journal"."sealed_journal_sha256" is null
          and "fx_system_tx_journal"."sealed_result_value_codec_version" is null
          and "fx_system_tx_journal"."sealed_result_semantic_bytes" is null
          and "fx_system_tx_journal"."sealed_result_bytes" is null
          and "fx_system_tx_journal"."sealed_result_sha256" is null
          and "fx_system_tx_journal"."sealed_at" is null
        )
        or (
          "fx_system_tx_journal"."state" = 'relation_conflicted'
          and "fx_system_tx_journal"."failure_dimension" is null
          and "fx_system_tx_journal"."sealed_journal_bytes" is null
          and "fx_system_tx_journal"."sealed_journal_sha256" is null
          and "fx_system_tx_journal"."sealed_result_value_codec_version" is null
          and "fx_system_tx_journal"."sealed_result_semantic_bytes" is null
          and "fx_system_tx_journal"."sealed_result_bytes" is null
          and "fx_system_tx_journal"."sealed_result_sha256" is null
          and "fx_system_tx_journal"."sealed_at" is null
        )
        or (
          "fx_system_tx_journal"."state" = 'sealed'
          and "fx_system_tx_journal"."failure_dimension" is null
          and "fx_system_tx_journal"."sealed_journal_bytes" is not null
          and octet_length("fx_system_tx_journal"."sealed_journal_bytes") between 1 and 67108864
          and "fx_system_tx_journal"."sealed_journal_sha256" is not null
          and octet_length("fx_system_tx_journal"."sealed_journal_sha256") = 32
          and "fx_system_tx_journal"."sealed_result_value_codec_version" is not null
          and "fx_system_tx_journal"."sealed_result_value_codec_version" = 1
          and "fx_system_tx_journal"."sealed_result_semantic_bytes" is not null
          and "fx_system_tx_journal"."sealed_result_semantic_bytes" between 0 and 16777216
          and "fx_system_tx_journal"."sealed_result_bytes" is not null
          and octet_length("fx_system_tx_journal"."sealed_result_bytes") between 1 and 67108864
          and "fx_system_tx_journal"."sealed_result_sha256" is not null
          and octet_length("fx_system_tx_journal"."sealed_result_sha256") = 32
          and "fx_system_tx_journal"."sealed_at" is not null
          and isfinite("fx_system_tx_journal"."sealed_at")
        )
      );

CREATE TABLE "fx_system_tx_journal_relation_incoming" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"target_row_id" "bytea" NOT NULL,
	"observed_adjacency_version" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_tx_journal_relation_incoming_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence","edge_definition_id","target_row_id"),
	CONSTRAINT "fx_system_tx_journal_relation_incoming_identity_check" CHECK (
        "fx_system_tx_journal_relation_incoming"."attempt_fence" >= 1
        and "fx_system_tx_journal_relation_incoming"."edge_definition_id" between 1 and 2147483647
        and octet_length("fx_system_tx_journal_relation_incoming"."target_row_id") = 16
        and "fx_system_tx_journal_relation_incoming"."observed_adjacency_version" >= 0
      ),
	CONSTRAINT "fx_system_tx_journal_relation_incoming_timestamp_check" CHECK (
        isfinite("fx_system_tx_journal_relation_incoming"."created_at")
        and isfinite("fx_system_tx_journal_relation_incoming"."updated_at")
        and "fx_system_tx_journal_relation_incoming"."updated_at" >= "fx_system_tx_journal_relation_incoming"."created_at"
      )
);
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_operation_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_outcome_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_state_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_failure_dimension_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_state_evidence_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "relation_read_syscalls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "relation_dependency_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "relation_base_occurrences" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_relation_incoming" ADD CONSTRAINT "fx_system_tx_journal_relation_incoming_root_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_journal"("scope_uuid","session_id","attempt_fence") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_operation_check" CHECK ("fx_system_tx_journal_latest_receipt"."operation_kind" in ('get', 'insert', 'patch', 'replace', 'delete', 'indexRange', 'relationIncoming'));--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_outcome_check" CHECK (
        "fx_system_tx_journal_latest_receipt"."outcome_kind" in ('missing', 'present', 'inserted', 'unit', 'indexRangePage', 'relationIncomingPage', 'relationConflict', 'error')
        and "fx_system_tx_journal_latest_receipt"."outcome_codec_version" = 1
        and octet_length("fx_system_tx_journal_latest_receipt"."outcome_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_latest_receipt"."outcome_sha256") = 32
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_relation_read_count_check" CHECK ("fx_system_tx_journal"."relation_read_syscalls" between 0 and 128);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_relation_dependency_count_check" CHECK ("fx_system_tx_journal"."relation_dependency_count" between 0 and 128);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_relation_base_occurrence_count_check" CHECK ("fx_system_tx_journal"."relation_base_occurrences" between 0 and 4096);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_state_check" CHECK ("fx_system_tx_journal"."state" in ('open', 'sealed', 'failed', 'relation_conflicted'));--> statement-breakpoint
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
          )
        )
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_state_evidence_check" CHECK (
        (
          "fx_system_tx_journal"."state" = 'open'
          and "fx_system_tx_journal"."failure_dimension" is null
          and "fx_system_tx_journal"."sealed_final_syscall_sequence" is null
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
          and "fx_system_tx_journal"."sealed_final_syscall_sequence" is null
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
          and "fx_system_tx_journal"."sealed_final_syscall_sequence" is null
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
          and "fx_system_tx_journal"."sealed_final_syscall_sequence" is not null
          and "fx_system_tx_journal"."sealed_final_syscall_sequence" = "fx_system_tx_journal"."last_syscall_sequence"
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

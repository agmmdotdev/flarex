CREATE TABLE "fx_system_tx_journal_index_range" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"ordinal" integer NOT NULL,
	"table_id" integer NOT NULL,
	"index_definition_id" integer NOT NULL,
	"key_codec_version" integer NOT NULL,
	"physical_spec_sha256" "bytea" NOT NULL,
	"direction" text NOT NULL,
	"lower_kind" text NOT NULL,
	"lower_encoded_key" "bytea",
	"upper_kind" text NOT NULL,
	"upper_encoded_key" "bytea",
	"upper_row_id" "bytea",
	"evidence_bytes" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_tx_journal_index_range_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence","ordinal"),
	CONSTRAINT "fx_system_tx_journal_index_range_identity_check" CHECK (
        "fx_system_tx_journal_index_range"."attempt_fence" >= 1
        and "fx_system_tx_journal_index_range"."ordinal" between 0 and 31
        and "fx_system_tx_journal_index_range"."table_id" between 1 and 2147483647
        and "fx_system_tx_journal_index_range"."index_definition_id" between 1 and 2147483647
        and "fx_system_tx_journal_index_range"."key_codec_version" = 1
        and octet_length("fx_system_tx_journal_index_range"."physical_spec_sha256") = 32
        and "fx_system_tx_journal_index_range"."direction" = 'asc'
        and "fx_system_tx_journal_index_range"."evidence_bytes" between 1 and 262144
      ),
	CONSTRAINT "fx_system_tx_journal_index_range_lower_check" CHECK (
        (
          "fx_system_tx_journal_index_range"."lower_kind" = 'unbounded'
          and "fx_system_tx_journal_index_range"."lower_encoded_key" is null
        )
        or (
          "fx_system_tx_journal_index_range"."lower_kind" = 'key_inclusive'
          and "fx_system_tx_journal_index_range"."lower_encoded_key" is not null
          and octet_length("fx_system_tx_journal_index_range"."lower_encoded_key") between 0 and 2049
        )
      ),
	CONSTRAINT "fx_system_tx_journal_index_range_upper_check" CHECK (
        (
          "fx_system_tx_journal_index_range"."upper_kind" = 'unbounded'
          and "fx_system_tx_journal_index_range"."upper_encoded_key" is null
          and "fx_system_tx_journal_index_range"."upper_row_id" is null
        )
        or (
          "fx_system_tx_journal_index_range"."upper_kind" = 'key_exclusive'
          and "fx_system_tx_journal_index_range"."upper_encoded_key" is not null
          and octet_length("fx_system_tx_journal_index_range"."upper_encoded_key") between 0 and 2049
          and "fx_system_tx_journal_index_range"."upper_row_id" is null
        )
        or (
          "fx_system_tx_journal_index_range"."upper_kind" = 'position_inclusive'
          and "fx_system_tx_journal_index_range"."upper_encoded_key" is not null
          and octet_length("fx_system_tx_journal_index_range"."upper_encoded_key") between 0 and 2048
          and "fx_system_tx_journal_index_range"."upper_row_id" is not null
          and octet_length("fx_system_tx_journal_index_range"."upper_row_id") = 16
        )
      ),
	CONSTRAINT "fx_system_tx_journal_index_range_timestamp_check" CHECK (
        isfinite("fx_system_tx_journal_index_range"."created_at")
        and isfinite("fx_system_tx_journal_index_range"."updated_at")
        and "fx_system_tx_journal_index_range"."updated_at" >= "fx_system_tx_journal_index_range"."created_at"
      )
);
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_operation_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" DROP CONSTRAINT "fx_system_tx_journal_receipt_outcome_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_failure_dimension_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "indexed_query_syscalls" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "index_range_dependency_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD COLUMN "index_range_dependency_evidence_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_index_range" ADD CONSTRAINT "fx_system_tx_journal_index_range_root_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_journal"("scope_uuid","session_id","attempt_fence") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_operation_check" CHECK ("fx_system_tx_journal_latest_receipt"."operation_kind" in ('get', 'insert', 'patch', 'replace', 'delete', 'indexRange'));--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_outcome_check" CHECK (
        "fx_system_tx_journal_latest_receipt"."outcome_kind" in ('missing', 'present', 'inserted', 'unit', 'indexRangePage', 'error')
        and "fx_system_tx_journal_latest_receipt"."outcome_codec_version" = 1
        and octet_length("fx_system_tx_journal_latest_receipt"."outcome_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_latest_receipt"."outcome_sha256") = 32
      );--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_indexed_query_count_check" CHECK ("fx_system_tx_journal"."indexed_query_syscalls" between 0 and 32);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_index_range_count_check" CHECK ("fx_system_tx_journal"."index_range_dependency_count" between 0 and 32);--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_index_range_evidence_bytes_check" CHECK ("fx_system_tx_journal"."index_range_dependency_evidence_bytes" between 0 and 262144);--> statement-breakpoint
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
            'writeOperations',
            'writeSemanticBytes',
            'materialWriteEventEvidenceBytes'
          )
        )
      );

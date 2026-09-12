LOCK TABLE "fx_system_tx_journal", "fx_system_tx_journal_write_event" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" DROP CONSTRAINT "fx_system_tx_journal_event_payload_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP CONSTRAINT "fx_system_tx_journal_state_evidence_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" DROP COLUMN "event_json";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" DROP COLUMN "sealed_final_syscall_sequence";--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" ADD CONSTRAINT "fx_system_tx_journal_event_payload_check" CHECK (
        "fx_system_tx_journal_write_event"."write_kind" in ('insert', 'patch', 'replace', 'delete')
        and "fx_system_tx_journal_write_event"."event_codec_version" = 1
        and octet_length("fx_system_tx_journal_write_event"."event_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_write_event"."event_sha256") = 32
      );--> statement-breakpoint
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

CREATE TABLE "fx_system_tx_journal_latest_receipt" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"last_syscall_sequence" bigint NOT NULL,
	"operation_kind" text NOT NULL,
	"request_codec_version" integer NOT NULL,
	"request_bytes" "bytea" NOT NULL,
	"request_sha256" "bytea" NOT NULL,
	"outcome_kind" text NOT NULL,
	"outcome_codec_version" integer NOT NULL,
	"outcome_bytes" "bytea" NOT NULL,
	"outcome_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_tx_journal_receipt_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence"),
	CONSTRAINT "fx_system_tx_journal_receipt_fence_check" CHECK ("fx_system_tx_journal_latest_receipt"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_tx_journal_receipt_sequence_check" CHECK ("fx_system_tx_journal_latest_receipt"."last_syscall_sequence" >= 1),
	CONSTRAINT "fx_system_tx_journal_receipt_operation_check" CHECK ("fx_system_tx_journal_latest_receipt"."operation_kind" in ('get', 'insert', 'patch', 'replace', 'delete')),
	CONSTRAINT "fx_system_tx_journal_receipt_request_check" CHECK (
        "fx_system_tx_journal_latest_receipt"."request_codec_version" = 1
        and octet_length("fx_system_tx_journal_latest_receipt"."request_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_latest_receipt"."request_sha256") = 32
      ),
	CONSTRAINT "fx_system_tx_journal_receipt_outcome_check" CHECK (
        "fx_system_tx_journal_latest_receipt"."outcome_kind" in ('missing', 'present', 'inserted', 'unit', 'error')
        and "fx_system_tx_journal_latest_receipt"."outcome_codec_version" = 1
        and octet_length("fx_system_tx_journal_latest_receipt"."outcome_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_latest_receipt"."outcome_sha256") = 32
      ),
	CONSTRAINT "fx_system_tx_journal_receipt_timestamp_check" CHECK (
        isfinite("fx_system_tx_journal_latest_receipt"."created_at")
        and isfinite("fx_system_tx_journal_latest_receipt"."updated_at")
        and "fx_system_tx_journal_latest_receipt"."updated_at" >= "fx_system_tx_journal_latest_receipt"."created_at"
      )
);
--> statement-breakpoint
CREATE TABLE "fx_system_tx_journal_point" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"table_id" integer NOT NULL,
	"row_id" "bytea" NOT NULL,
	"dependency_kind" text NOT NULL,
	"dependency_revision_commit_seq" bigint,
	"overlay_kind" text NOT NULL,
	"overlay_creation_time" double precision,
	"overlay_value_codec_version" integer,
	"overlay_value_json" jsonb,
	"overlay_value_bytes" "bytea",
	"overlay_value_sha256" "bytea",
	"overlay_semantic_bytes" integer,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_tx_journal_point_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence","table_id","row_id"),
	CONSTRAINT "fx_system_tx_journal_point_identity_check" CHECK (
        "fx_system_tx_journal_point"."attempt_fence" >= 1
        and "fx_system_tx_journal_point"."table_id" between 1 and 2147483647
        and octet_length("fx_system_tx_journal_point"."row_id") = 16
      ),
	CONSTRAINT "fx_system_tx_journal_point_dependency_check" CHECK (
        (
          "fx_system_tx_journal_point"."dependency_kind" = 'present'
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" is not null
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" >= 1
        )
        or (
          "fx_system_tx_journal_point"."dependency_kind" = 'missing_no_visible_revision'
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" is null
        )
        or (
          "fx_system_tx_journal_point"."dependency_kind" = 'missing_tombstone'
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" is not null
          and "fx_system_tx_journal_point"."dependency_revision_commit_seq" >= 1
        )
      ),
	CONSTRAINT "fx_system_tx_journal_point_overlay_check" CHECK (
        (
          "fx_system_tx_journal_point"."overlay_kind" in ('none', 'deleted')
          and "fx_system_tx_journal_point"."overlay_creation_time" is null
          and "fx_system_tx_journal_point"."overlay_value_codec_version" is null
          and "fx_system_tx_journal_point"."overlay_value_json" is null
          and "fx_system_tx_journal_point"."overlay_value_bytes" is null
          and "fx_system_tx_journal_point"."overlay_value_sha256" is null
          and "fx_system_tx_journal_point"."overlay_semantic_bytes" is null
        )
        or (
          "fx_system_tx_journal_point"."overlay_kind" = 'live'
          and "fx_system_tx_journal_point"."overlay_creation_time" is not null
          and "fx_system_tx_journal_point"."overlay_creation_time" > 0
          and "fx_system_tx_journal_point"."overlay_creation_time" < 9007199254740992
          and "fx_system_tx_journal_point"."overlay_value_codec_version" is not null
          and "fx_system_tx_journal_point"."overlay_value_codec_version" = 1
          and "fx_system_tx_journal_point"."overlay_value_json" is not null
          and jsonb_typeof("fx_system_tx_journal_point"."overlay_value_json") = 'object'
          and "fx_system_tx_journal_point"."overlay_value_bytes" is not null
          and octet_length("fx_system_tx_journal_point"."overlay_value_bytes") > 0
          and "fx_system_tx_journal_point"."overlay_value_sha256" is not null
          and octet_length("fx_system_tx_journal_point"."overlay_value_sha256") = 32
          and "fx_system_tx_journal_point"."overlay_semantic_bytes" is not null
          and "fx_system_tx_journal_point"."overlay_semantic_bytes" between 1 and 1048576
        )
      ),
	CONSTRAINT "fx_system_tx_journal_point_timestamp_check" CHECK (
        isfinite("fx_system_tx_journal_point"."created_at")
        and isfinite("fx_system_tx_journal_point"."updated_at")
        and "fx_system_tx_journal_point"."updated_at" >= "fx_system_tx_journal_point"."created_at"
      )
);
--> statement-breakpoint
CREATE TABLE "fx_system_tx_journal_write_event" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"syscall_sequence" bigint NOT NULL,
	"write_kind" text NOT NULL,
	"event_codec_version" integer NOT NULL,
	"event_json" jsonb NOT NULL,
	"event_bytes" "bytea" NOT NULL,
	"event_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_tx_journal_event_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence","syscall_sequence"),
	CONSTRAINT "fx_system_tx_journal_event_identity_check" CHECK ("fx_system_tx_journal_write_event"."attempt_fence" >= 1 and "fx_system_tx_journal_write_event"."syscall_sequence" >= 1),
	CONSTRAINT "fx_system_tx_journal_event_payload_check" CHECK (
        "fx_system_tx_journal_write_event"."write_kind" in ('insert', 'patch', 'replace', 'delete')
        and "fx_system_tx_journal_write_event"."event_codec_version" = 1
        and jsonb_typeof("fx_system_tx_journal_write_event"."event_json") = 'object'
        and octet_length("fx_system_tx_journal_write_event"."event_bytes") between 1 and 67108864
        and octet_length("fx_system_tx_journal_write_event"."event_sha256") = 32
      ),
	CONSTRAINT "fx_system_tx_journal_event_timestamp_check" CHECK (isfinite("fx_system_tx_journal_write_event"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_tx_journal" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"state" text NOT NULL,
	"last_syscall_sequence" bigint DEFAULT 0 NOT NULL,
	"creation_time_seed" double precision NOT NULL,
	"next_creation_time" double precision NOT NULL,
	"read_documents" integer DEFAULT 0 NOT NULL,
	"read_semantic_bytes" integer DEFAULT 0 NOT NULL,
	"point_dependency_count" integer DEFAULT 0 NOT NULL,
	"write_operations" integer DEFAULT 0 NOT NULL,
	"write_semantic_bytes" integer DEFAULT 0 NOT NULL,
	"material_write_event_evidence_bytes" integer DEFAULT 0 NOT NULL,
	"failure_dimension" text,
	"sealed_final_syscall_sequence" bigint,
	"sealed_journal_bytes" "bytea",
	"sealed_journal_sha256" "bytea",
	"sealed_result_value_codec_version" integer,
	"sealed_result_semantic_bytes" integer,
	"sealed_result_bytes" "bytea",
	"sealed_result_sha256" "bytea",
	"sealed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_tx_journal_pk" PRIMARY KEY("scope_uuid","session_id","attempt_fence"),
	CONSTRAINT "fx_system_tx_journal_attempt_fence_check" CHECK ("fx_system_tx_journal"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_tx_journal_state_check" CHECK ("fx_system_tx_journal"."state" in ('open', 'sealed', 'failed')),
	CONSTRAINT "fx_system_tx_journal_sequence_check" CHECK ("fx_system_tx_journal"."last_syscall_sequence" >= 0),
	CONSTRAINT "fx_system_tx_journal_creation_time_check" CHECK (
        "fx_system_tx_journal"."creation_time_seed" > 0
        and "fx_system_tx_journal"."creation_time_seed" < 9007199254740992
        and "fx_system_tx_journal"."next_creation_time" >= "fx_system_tx_journal"."creation_time_seed"
        and "fx_system_tx_journal"."next_creation_time" < 9007199254740992
      ),
	CONSTRAINT "fx_system_tx_journal_read_documents_check" CHECK ("fx_system_tx_journal"."read_documents" between 0 and 32000),
	CONSTRAINT "fx_system_tx_journal_read_bytes_check" CHECK ("fx_system_tx_journal"."read_semantic_bytes" between 0 and 16777216),
	CONSTRAINT "fx_system_tx_journal_point_count_check" CHECK ("fx_system_tx_journal"."point_dependency_count" between 0 and 4096),
	CONSTRAINT "fx_system_tx_journal_write_count_check" CHECK ("fx_system_tx_journal"."write_operations" between 0 and 16000),
	CONSTRAINT "fx_system_tx_journal_write_bytes_check" CHECK ("fx_system_tx_journal"."write_semantic_bytes" between 0 and 16777216),
	CONSTRAINT "fx_system_tx_journal_material_write_event_evidence_bytes_check" CHECK ("fx_system_tx_journal"."material_write_event_evidence_bytes" between 0 and 67108864),
	CONSTRAINT "fx_system_tx_journal_failure_dimension_check" CHECK (
        "fx_system_tx_journal"."failure_dimension" is null
        or (
          "fx_system_tx_journal"."failure_dimension" is not null
          and "fx_system_tx_journal"."failure_dimension" in (
            'readDocuments',
            'readSemanticBytes',
            'pointReadDependencies',
            'writeOperations',
            'writeSemanticBytes',
            'materialWriteEventEvidenceBytes'
          )
        )
      ),
	CONSTRAINT "fx_system_tx_journal_state_evidence_check" CHECK (
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
      ),
	CONSTRAINT "fx_system_tx_journal_timestamp_check" CHECK (
        isfinite("fx_system_tx_journal"."created_at")
        and isfinite("fx_system_tx_journal"."updated_at")
        and "fx_system_tx_journal"."updated_at" >= "fx_system_tx_journal"."created_at"
        and (
          "fx_system_tx_journal"."sealed_at" is null
          or (
            "fx_system_tx_journal"."sealed_at" is not null
            and "fx_system_tx_journal"."sealed_at" >= "fx_system_tx_journal"."created_at"
          )
        )
      )
);
--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_latest_receipt" ADD CONSTRAINT "fx_system_tx_journal_receipt_root_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_journal"("scope_uuid","session_id","attempt_fence") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_point" ADD CONSTRAINT "fx_system_tx_journal_point_root_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_journal"("scope_uuid","session_id","attempt_fence") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal_write_event" ADD CONSTRAINT "fx_system_tx_journal_event_root_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_journal"("scope_uuid","session_id","attempt_fence") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_tx_journal" ADD CONSTRAINT "fx_system_tx_journal_attempt_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_session"("scope_uuid","session_id","attempt_fence") ON DELETE restrict ON UPDATE restrict;

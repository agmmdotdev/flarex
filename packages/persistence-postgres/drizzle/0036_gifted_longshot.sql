CREATE TABLE "fx_system_declarative_v2_verifier_attempt_v2" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"lifecycle" text NOT NULL,
	"writer_owner_id" uuid,
	"writer_fence" bigint DEFAULT 0 NOT NULL,
	"lease_updated_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"settled_sequence" bigint DEFAULT 0 NOT NULL,
	"last_receipt_sha256" "bytea",
	"pending_kind" text,
	"pending_sequence" bigint,
	"pending_reservation_sha256" "bytea",
	"pending_reserved_by_fence" bigint,
	"pending_started_at" timestamp with time zone,
	"identity_codec_version" integer NOT NULL,
	"identity_byte_length" bigint NOT NULL,
	"identity_sha256" "bytea" NOT NULL,
	"identity_bytes" "bytea" NOT NULL,
	"ceilings_codec_version" integer NOT NULL,
	"ceilings_byte_length" bigint NOT NULL,
	"ceilings_sha256" "bytea" NOT NULL,
	"ceilings_bytes" "bytea" NOT NULL,
	"usage_codec_version" integer NOT NULL,
	"usage_byte_length" bigint NOT NULL,
	"usage_sha256" "bytea" NOT NULL,
	"usage_bytes" "bytea" NOT NULL,
	"progress_codec_version" integer NOT NULL,
	"progress_byte_length" bigint NOT NULL,
	"progress_sha256" "bytea" NOT NULL,
	"progress_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_verifier_attempt_v2_scope_id_attempt_sha256_pk" PRIMARY KEY("scope_id","attempt_sha256"),
	CONSTRAINT "fx_dv2_attempt_v2_digest_check" CHECK (octet_length("fx_system_declarative_v2_verifier_attempt_v2"."attempt_sha256") = 32
        and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."candidate_sha256") = 32
        and "fx_system_declarative_v2_verifier_attempt_v2"."attempt_sha256" = "fx_system_declarative_v2_verifier_attempt_v2"."identity_sha256"),
	CONSTRAINT "fx_dv2_attempt_v2_lifecycle_check" CHECK ("fx_system_declarative_v2_verifier_attempt_v2"."lifecycle" in (
        'open', 'parsing', 'parse_complete', 'linking', 'link_complete',
        'registering', 'ready', 'rejected', 'abandoned'
      )),
	CONSTRAINT "fx_dv2_attempt_v2_fence_check" CHECK ("fx_system_declarative_v2_verifier_attempt_v2"."writer_fence" >= 0),
	CONSTRAINT "fx_dv2_attempt_v2_lease_check" CHECK ((
        (
          "fx_system_declarative_v2_verifier_attempt_v2"."writer_owner_id" is null
          and "fx_system_declarative_v2_verifier_attempt_v2"."lease_updated_at" is null
          and "fx_system_declarative_v2_verifier_attempt_v2"."lease_expires_at" is null
        )
        or
        (
          "fx_system_declarative_v2_verifier_attempt_v2"."writer_owner_id" is not null
          and "fx_system_declarative_v2_verifier_attempt_v2"."writer_fence" >= 1
          and "fx_system_declarative_v2_verifier_attempt_v2"."lease_updated_at" is not null
          and isfinite("fx_system_declarative_v2_verifier_attempt_v2"."lease_updated_at")
          and "fx_system_declarative_v2_verifier_attempt_v2"."lease_expires_at" is not null
          and isfinite("fx_system_declarative_v2_verifier_attempt_v2"."lease_expires_at")
          and "fx_system_declarative_v2_verifier_attempt_v2"."lease_expires_at" > "fx_system_declarative_v2_verifier_attempt_v2"."lease_updated_at"
          and "fx_system_declarative_v2_verifier_attempt_v2"."lifecycle" not in ('ready', 'rejected', 'abandoned')
        )
      ) is true),
	CONSTRAINT "fx_dv2_attempt_v2_settled_check" CHECK ((
        "fx_system_declarative_v2_verifier_attempt_v2"."settled_sequence" >= 0
        and (
          ("fx_system_declarative_v2_verifier_attempt_v2"."settled_sequence" = 0 and "fx_system_declarative_v2_verifier_attempt_v2"."last_receipt_sha256" is null)
          or
          (
            "fx_system_declarative_v2_verifier_attempt_v2"."settled_sequence" >= 1
            and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."last_receipt_sha256") = 32
          )
        )
      ) is true),
	CONSTRAINT "fx_dv2_attempt_v2_pending_check" CHECK ((
        (
          "fx_system_declarative_v2_verifier_attempt_v2"."pending_kind" is null
          and "fx_system_declarative_v2_verifier_attempt_v2"."pending_sequence" is null
          and "fx_system_declarative_v2_verifier_attempt_v2"."pending_reservation_sha256" is null
          and "fx_system_declarative_v2_verifier_attempt_v2"."pending_reserved_by_fence" is null
          and "fx_system_declarative_v2_verifier_attempt_v2"."pending_started_at" is null
        )
        or
        (
          "fx_system_declarative_v2_verifier_attempt_v2"."pending_kind" in (
            'source_page', 'parse_module', 'link_page', 'registration_page'
          )
          and "fx_system_declarative_v2_verifier_attempt_v2"."pending_sequence" = "fx_system_declarative_v2_verifier_attempt_v2"."settled_sequence" + 1
          and "fx_system_declarative_v2_verifier_attempt_v2"."settled_sequence" < 9223372036854775807
          and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."pending_reservation_sha256") = 32
          and "fx_system_declarative_v2_verifier_attempt_v2"."pending_reserved_by_fence" >= 1
          and "fx_system_declarative_v2_verifier_attempt_v2"."pending_reserved_by_fence" = "fx_system_declarative_v2_verifier_attempt_v2"."writer_fence"
          and "fx_system_declarative_v2_verifier_attempt_v2"."pending_started_at" is not null
          and isfinite("fx_system_declarative_v2_verifier_attempt_v2"."pending_started_at")
          and "fx_system_declarative_v2_verifier_attempt_v2"."lifecycle" not in ('ready', 'rejected', 'abandoned')
        )
      ) is true),
	CONSTRAINT "fx_dv2_attempt_v2_identity_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_attempt_v2"."identity_codec_version" = 2
    and "fx_system_declarative_v2_verifier_attempt_v2"."identity_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."identity_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."identity_bytes") = "fx_system_declarative_v2_verifier_attempt_v2"."identity_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_attempt_v2_ceilings_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_attempt_v2"."ceilings_codec_version" = 2
    and "fx_system_declarative_v2_verifier_attempt_v2"."ceilings_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."ceilings_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."ceilings_bytes") = "fx_system_declarative_v2_verifier_attempt_v2"."ceilings_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_attempt_v2_usage_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_attempt_v2"."usage_codec_version" = 2
    and "fx_system_declarative_v2_verifier_attempt_v2"."usage_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."usage_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."usage_bytes") = "fx_system_declarative_v2_verifier_attempt_v2"."usage_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_attempt_v2_progress_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_attempt_v2"."progress_codec_version" = 2
    and "fx_system_declarative_v2_verifier_attempt_v2"."progress_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."progress_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt_v2"."progress_bytes") = "fx_system_declarative_v2_verifier_attempt_v2"."progress_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_attempt_v2_timestamps_check" CHECK (isfinite("fx_system_declarative_v2_verifier_attempt_v2"."created_at")
        and isfinite("fx_system_declarative_v2_verifier_attempt_v2"."updated_at")
        and "fx_system_declarative_v2_verifier_attempt_v2"."updated_at" >= "fx_system_declarative_v2_verifier_attempt_v2"."created_at")
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_verifier_command_v2" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"sequence" bigint NOT NULL,
	"command_kind" text NOT NULL,
	"reservation_sha256" "bytea" NOT NULL,
	"reservation_codec_version" integer NOT NULL,
	"reservation_byte_length" bigint NOT NULL,
	"reservation_frame_sha256" "bytea" NOT NULL,
	"reservation_bytes" "bytea" NOT NULL,
	"command_budget_codec_version" integer NOT NULL,
	"command_budget_byte_length" bigint NOT NULL,
	"command_budget_sha256" "bytea" NOT NULL,
	"command_budget_bytes" "bytea" NOT NULL,
	"reserved_by_fence" bigint NOT NULL,
	"reserved_at" timestamp with time zone NOT NULL,
	"page_count" bigint DEFAULT 0 NOT NULL,
	"last_page_sha256" "bytea",
	"output_manifest_codec_version" integer,
	"output_manifest_byte_length" bigint,
	"output_manifest_sha256" "bytea",
	"output_manifest_bytes" "bytea",
	"command_usage_codec_version" integer,
	"command_usage_byte_length" bigint,
	"command_usage_sha256" "bytea",
	"command_usage_bytes" "bytea",
	"resulting_usage_codec_version" integer,
	"resulting_usage_byte_length" bigint,
	"resulting_usage_sha256" "bytea",
	"resulting_usage_bytes" "bytea",
	"next_progress_codec_version" integer,
	"next_progress_byte_length" bigint,
	"next_progress_sha256" "bytea",
	"next_progress_bytes" "bytea",
	"receipt_codec_version" integer,
	"receipt_byte_length" bigint,
	"receipt_sha256" "bytea",
	"receipt_bytes" "bytea",
	"settled_at" timestamp with time zone,
	CONSTRAINT "fx_system_declarative_v2_verifier_command_v2_scope_id_attempt_sha256_sequence_pk" PRIMARY KEY("scope_id","attempt_sha256","sequence"),
	CONSTRAINT "fx_dv2_command_v2_reservation_unique" UNIQUE("scope_id","attempt_sha256","sequence","reservation_sha256","command_kind"),
	CONSTRAINT "fx_dv2_command_v2_identity_check" CHECK ("fx_system_declarative_v2_verifier_command_v2"."sequence" >= 1
        and "fx_system_declarative_v2_verifier_command_v2"."command_kind" in (
          'source_page', 'parse_module', 'link_page', 'registration_page'
        )
        and octet_length("fx_system_declarative_v2_verifier_command_v2"."attempt_sha256") = 32
        and octet_length("fx_system_declarative_v2_verifier_command_v2"."reservation_sha256") = 32
        and "fx_system_declarative_v2_verifier_command_v2"."reservation_sha256" = "fx_system_declarative_v2_verifier_command_v2"."reservation_frame_sha256"),
	CONSTRAINT "fx_dv2_command_v2_reservation_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_command_v2"."reservation_codec_version" = 2
    and "fx_system_declarative_v2_verifier_command_v2"."reservation_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."reservation_frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."reservation_bytes") = "fx_system_declarative_v2_verifier_command_v2"."reservation_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_command_v2_budget_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_command_v2"."command_budget_codec_version" = 2
    and "fx_system_declarative_v2_verifier_command_v2"."command_budget_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."command_budget_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."command_budget_bytes") = "fx_system_declarative_v2_verifier_command_v2"."command_budget_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_command_v2_reservation_check" CHECK ("fx_system_declarative_v2_verifier_command_v2"."reserved_by_fence" >= 1
        and isfinite("fx_system_declarative_v2_verifier_command_v2"."reserved_at")),
	CONSTRAINT "fx_dv2_command_v2_page_tail_check" CHECK ((
        "fx_system_declarative_v2_verifier_command_v2"."page_count" >= 0
        and (
          ("fx_system_declarative_v2_verifier_command_v2"."page_count" = 0 and "fx_system_declarative_v2_verifier_command_v2"."last_page_sha256" is null)
          or
          (
            "fx_system_declarative_v2_verifier_command_v2"."page_count" >= 1
            and "fx_system_declarative_v2_verifier_command_v2"."command_kind" in ('parse_module', 'link_page')
            and octet_length("fx_system_declarative_v2_verifier_command_v2"."last_page_sha256") = 32
          )
        )
      ) is true),
	CONSTRAINT "fx_dv2_command_v2_settlement_check" CHECK ((
        (
          (
    "fx_system_declarative_v2_verifier_command_v2"."output_manifest_codec_version" is null
    and "fx_system_declarative_v2_verifier_command_v2"."output_manifest_byte_length" is null
    and "fx_system_declarative_v2_verifier_command_v2"."output_manifest_sha256" is null
    and "fx_system_declarative_v2_verifier_command_v2"."output_manifest_bytes" is null
  )
          and (
    "fx_system_declarative_v2_verifier_command_v2"."command_usage_codec_version" is null
    and "fx_system_declarative_v2_verifier_command_v2"."command_usage_byte_length" is null
    and "fx_system_declarative_v2_verifier_command_v2"."command_usage_sha256" is null
    and "fx_system_declarative_v2_verifier_command_v2"."command_usage_bytes" is null
  )
          and (
    "fx_system_declarative_v2_verifier_command_v2"."resulting_usage_codec_version" is null
    and "fx_system_declarative_v2_verifier_command_v2"."resulting_usage_byte_length" is null
    and "fx_system_declarative_v2_verifier_command_v2"."resulting_usage_sha256" is null
    and "fx_system_declarative_v2_verifier_command_v2"."resulting_usage_bytes" is null
  )
          and (
    "fx_system_declarative_v2_verifier_command_v2"."next_progress_codec_version" is null
    and "fx_system_declarative_v2_verifier_command_v2"."next_progress_byte_length" is null
    and "fx_system_declarative_v2_verifier_command_v2"."next_progress_sha256" is null
    and "fx_system_declarative_v2_verifier_command_v2"."next_progress_bytes" is null
  )
          and (
    "fx_system_declarative_v2_verifier_command_v2"."receipt_codec_version" is null
    and "fx_system_declarative_v2_verifier_command_v2"."receipt_byte_length" is null
    and "fx_system_declarative_v2_verifier_command_v2"."receipt_sha256" is null
    and "fx_system_declarative_v2_verifier_command_v2"."receipt_bytes" is null
  )
          and "fx_system_declarative_v2_verifier_command_v2"."settled_at" is null
        )
        or
        (
          (
    "fx_system_declarative_v2_verifier_command_v2"."output_manifest_codec_version" = 2
    and "fx_system_declarative_v2_verifier_command_v2"."output_manifest_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."output_manifest_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."output_manifest_bytes") = "fx_system_declarative_v2_verifier_command_v2"."output_manifest_byte_length"
  ) is true
          and (
    "fx_system_declarative_v2_verifier_command_v2"."command_usage_codec_version" = 2
    and "fx_system_declarative_v2_verifier_command_v2"."command_usage_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."command_usage_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."command_usage_bytes") = "fx_system_declarative_v2_verifier_command_v2"."command_usage_byte_length"
  ) is true
          and (
    "fx_system_declarative_v2_verifier_command_v2"."resulting_usage_codec_version" = 2
    and "fx_system_declarative_v2_verifier_command_v2"."resulting_usage_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."resulting_usage_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."resulting_usage_bytes") = "fx_system_declarative_v2_verifier_command_v2"."resulting_usage_byte_length"
  ) is true
          and (
    "fx_system_declarative_v2_verifier_command_v2"."next_progress_codec_version" = 2
    and "fx_system_declarative_v2_verifier_command_v2"."next_progress_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."next_progress_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."next_progress_bytes") = "fx_system_declarative_v2_verifier_command_v2"."next_progress_byte_length"
  ) is true
          and (
    "fx_system_declarative_v2_verifier_command_v2"."receipt_codec_version" = 2
    and "fx_system_declarative_v2_verifier_command_v2"."receipt_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."receipt_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_v2"."receipt_bytes") = "fx_system_declarative_v2_verifier_command_v2"."receipt_byte_length"
  ) is true
          and "fx_system_declarative_v2_verifier_command_v2"."settled_at" is not null
          and isfinite("fx_system_declarative_v2_verifier_command_v2"."settled_at")
          and "fx_system_declarative_v2_verifier_command_v2"."settled_at" >= "fx_system_declarative_v2_verifier_command_v2"."reserved_at"
          and (
            "fx_system_declarative_v2_verifier_command_v2"."command_kind" not in ('parse_module', 'link_page')
            or "fx_system_declarative_v2_verifier_command_v2"."page_count" >= 1
          )
        )
      ) is true)
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_verifier_evidence_page_v2" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"sequence" bigint NOT NULL,
	"command_kind" text NOT NULL,
	"reservation_sha256" "bytea" NOT NULL,
	"page_ordinal" bigint NOT NULL,
	"page_sha256" "bytea" NOT NULL,
	"first_evidence_ordinal" bigint NOT NULL,
	"evidence_count" bigint NOT NULL,
	"first_diagnostic_ordinal" bigint NOT NULL,
	"diagnostic_count" bigint NOT NULL,
	"predecessor_page_sha256" "bytea",
	"cumulative_diagnostics_root_sha256" "bytea" NOT NULL,
	"manifest_codec_version" integer NOT NULL,
	"manifest_byte_length" bigint NOT NULL,
	"manifest_sha256" "bytea" NOT NULL,
	"manifest_bytes" "bytea" NOT NULL,
	"payload_codec_version" integer NOT NULL,
	"payload_byte_length" bigint NOT NULL,
	"payload_sha256" "bytea" NOT NULL,
	"payload_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_verifier_evidence_page_v2_scope_id_attempt_sha256_sequence_page_ordinal_pk" PRIMARY KEY("scope_id","attempt_sha256","sequence","page_ordinal"),
	CONSTRAINT "fx_dv2_page_v2_identity_check" CHECK ("fx_system_declarative_v2_verifier_evidence_page_v2"."sequence" >= 1
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."command_kind" in ('parse_module', 'link_page')
        and octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."attempt_sha256") = 32
        and octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."reservation_sha256") = 32
        and octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."page_sha256") = 32
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."page_sha256" = "fx_system_declarative_v2_verifier_evidence_page_v2"."manifest_sha256"),
	CONSTRAINT "fx_dv2_page_v2_range_check" CHECK ("fx_system_declarative_v2_verifier_evidence_page_v2"."page_ordinal" >= 0
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."first_evidence_ordinal" >= 0
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."evidence_count" >= 1
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."first_diagnostic_ordinal" >= 0
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."diagnostic_count" >= 0
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."diagnostic_count" <= "fx_system_declarative_v2_verifier_evidence_page_v2"."evidence_count"
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."first_evidence_ordinal" <=
          9223372036854775807 - "fx_system_declarative_v2_verifier_evidence_page_v2"."evidence_count"
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."first_diagnostic_ordinal" <=
          9223372036854775807 - "fx_system_declarative_v2_verifier_evidence_page_v2"."diagnostic_count"),
	CONSTRAINT "fx_dv2_page_v2_predecessor_check" CHECK (((
        (
          "fx_system_declarative_v2_verifier_evidence_page_v2"."page_ordinal" = 0
          and "fx_system_declarative_v2_verifier_evidence_page_v2"."first_evidence_ordinal" = 0
          and "fx_system_declarative_v2_verifier_evidence_page_v2"."first_diagnostic_ordinal" = 0
          and "fx_system_declarative_v2_verifier_evidence_page_v2"."predecessor_page_sha256" is null
        )
        or
        (
          "fx_system_declarative_v2_verifier_evidence_page_v2"."page_ordinal" >= 1
          and octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."predecessor_page_sha256") = 32
        )
      )) is true),
	CONSTRAINT "fx_dv2_page_v2_roots_check" CHECK (octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."cumulative_diagnostics_root_sha256") = 32
        and octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."payload_sha256") = 32),
	CONSTRAINT "fx_dv2_page_v2_manifest_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_evidence_page_v2"."manifest_codec_version" = 2
    and "fx_system_declarative_v2_verifier_evidence_page_v2"."manifest_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."manifest_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."manifest_bytes") = "fx_system_declarative_v2_verifier_evidence_page_v2"."manifest_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_page_v2_payload_check" CHECK ("fx_system_declarative_v2_verifier_evidence_page_v2"."payload_codec_version" = 1
        and "fx_system_declarative_v2_verifier_evidence_page_v2"."payload_byte_length" >= 1
        and octet_length("fx_system_declarative_v2_verifier_evidence_page_v2"."payload_bytes") = "fx_system_declarative_v2_verifier_evidence_page_v2"."payload_byte_length"),
	CONSTRAINT "fx_dv2_page_v2_created_check" CHECK (isfinite("fx_system_declarative_v2_verifier_evidence_page_v2"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verifier_attempt_v2" ADD CONSTRAINT "fx_dv2_attempt_v2_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "public"."fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verifier_command_v2" ADD CONSTRAINT "fx_dv2_command_v2_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "public"."fx_system_declarative_v2_verifier_attempt_v2"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verifier_evidence_page_v2" ADD CONSTRAINT "fx_dv2_page_v2_command_fk" FOREIGN KEY ("scope_id","attempt_sha256","sequence","reservation_sha256","command_kind") REFERENCES "public"."fx_system_declarative_v2_verifier_command_v2"("scope_id","attempt_sha256","sequence","reservation_sha256","command_kind") ON DELETE restrict ON UPDATE no action;
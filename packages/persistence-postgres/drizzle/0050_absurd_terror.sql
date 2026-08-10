CREATE TABLE "fx_system_durable_task_compute_cancellation_v1" (
	"scope_id" text NOT NULL,
	"run_id" text NOT NULL,
	"requested_effect_sequence" bigint NOT NULL,
	"accepted_run_version" bigint NOT NULL,
	"dispatch_requested_effect_sequence" bigint NOT NULL,
	"attempt_id" text NOT NULL,
	"execution_fence" bigint NOT NULL,
	"cancellation_generation" bigint NOT NULL,
	"request_codec_version" integer,
	"request_byte_length" bigint,
	"request_sha256" "bytea",
	"request_bytes" "bytea",
	"delivery_state" text NOT NULL,
	"claim_owner" uuid,
	"claim_fence" bigint NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"delivery_attempt_count" bigint NOT NULL,
	"delivery_started_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"reason_code" text,
	"receipt_codec_version" integer,
	"receipt_byte_length" bigint,
	"receipt_sha256" "bytea",
	"receipt_bytes" "bytea",
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_task_compute_cancel_v1_pk" PRIMARY KEY("scope_id","run_id","requested_effect_sequence"),
	CONSTRAINT "fx_task_compute_cancel_v1_generation_unique" UNIQUE("scope_id","run_id","attempt_id","execution_fence","cancellation_generation"),
	CONSTRAINT "fx_task_compute_cancel_v1_identity_check" CHECK ("fx_system_durable_task_compute_cancellation_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_compute_cancellation_v1"."requested_effect_sequence" >= 1
        and "fx_system_durable_task_compute_cancellation_v1"."accepted_run_version" >= 1
        and "fx_system_durable_task_compute_cancellation_v1"."dispatch_requested_effect_sequence" >= 1
        and "fx_system_durable_task_compute_cancellation_v1"."dispatch_requested_effect_sequence" <
          "fx_system_durable_task_compute_cancellation_v1"."requested_effect_sequence"
        and "fx_system_durable_task_compute_cancellation_v1"."attempt_id" ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_compute_cancellation_v1"."execution_fence" >= 1
        and "fx_system_durable_task_compute_cancellation_v1"."cancellation_generation" >= 1),
	CONSTRAINT "fx_task_compute_cancel_v1_request_check" CHECK ((
        ("fx_system_durable_task_compute_cancellation_v1"."request_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."request_byte_length" is null
          and "fx_system_durable_task_compute_cancellation_v1"."request_sha256" is null
          and "fx_system_durable_task_compute_cancellation_v1"."request_bytes" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."request_codec_version" = 1
          and "fx_system_durable_task_compute_cancellation_v1"."request_byte_length" between 1 and 16384
          and octet_length("fx_system_durable_task_compute_cancellation_v1"."request_bytes") = "fx_system_durable_task_compute_cancellation_v1"."request_byte_length"
          and octet_length("fx_system_durable_task_compute_cancellation_v1"."request_sha256") = 32)
      ) is true),
	CONSTRAINT "fx_task_compute_cancel_v1_claim_check" CHECK (("fx_system_durable_task_compute_cancellation_v1"."claim_fence" >= 0 and (
        ("fx_system_durable_task_compute_cancellation_v1"."claim_owner" is null
          and "fx_system_durable_task_compute_cancellation_v1"."claimed_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."claim_expires_at" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."claim_owner" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."claim_fence" >= 1
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_state" in ('prepared', 'delivering', 'retry_wait')
          and "fx_system_durable_task_compute_cancellation_v1"."claimed_at" is not null
          and isfinite("fx_system_durable_task_compute_cancellation_v1"."claimed_at")
          and "fx_system_durable_task_compute_cancellation_v1"."claim_expires_at" is not null
          and isfinite("fx_system_durable_task_compute_cancellation_v1"."claim_expires_at")
          and "fx_system_durable_task_compute_cancellation_v1"."claim_expires_at" > "fx_system_durable_task_compute_cancellation_v1"."claimed_at")
      )) is true),
	CONSTRAINT "fx_task_compute_cancel_v1_receipt_check" CHECK ((
        ("fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_byte_length" is null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_sha256" is null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_bytes" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" = 1
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_byte_length" between 1 and 16384
          and octet_length("fx_system_durable_task_compute_cancellation_v1"."receipt_bytes") = "fx_system_durable_task_compute_cancellation_v1"."receipt_byte_length"
          and octet_length("fx_system_durable_task_compute_cancellation_v1"."receipt_sha256") = 32)
      ) is true),
	CONSTRAINT "fx_task_compute_cancel_v1_state_check" CHECK ((
        ("fx_system_durable_task_compute_cancellation_v1"."delivery_state" = 'waiting_dispatch'
          and "fx_system_durable_task_compute_cancellation_v1"."request_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" = 0
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."reason_code" is null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."settled_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."claim_owner" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."delivery_state" = 'prepared'
          and "fx_system_durable_task_compute_cancellation_v1"."request_codec_version" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" = 0
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."reason_code" is null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."settled_at" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."delivery_state" = 'delivering'
          and "fx_system_durable_task_compute_cancellation_v1"."request_codec_version" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" >= 1
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."reason_code" is null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."settled_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."claim_owner" is not null)
        or ("fx_system_durable_task_compute_cancellation_v1"."delivery_state" = 'delivered'
          and "fx_system_durable_task_compute_cancellation_v1"."request_codec_version" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" >= 1
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."reason_code" is null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."settled_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."claim_owner" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."delivery_state" = 'retry_wait'
          and "fx_system_durable_task_compute_cancellation_v1"."request_codec_version" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" >= 1
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" > "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at"
          and "fx_system_durable_task_compute_cancellation_v1"."reason_code" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."settled_at" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."delivery_state" = 'rejected'
          and "fx_system_durable_task_compute_cancellation_v1"."request_codec_version" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" >= 1
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."reason_code" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."settled_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."claim_owner" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."delivery_state" = 'obsolete'
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" = 0
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."reason_code" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."settled_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."claim_owner" is null)
        or ("fx_system_durable_task_compute_cancellation_v1"."delivery_state" = 'quarantined'
          and "fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" >= 0
          and (("fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" = 0
              and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is null)
            or ("fx_system_durable_task_compute_cancellation_v1"."delivery_attempt_count" >= 1
              and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is not null
              and "fx_system_durable_task_compute_cancellation_v1"."request_codec_version" is not null))
          and "fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_cancellation_v1"."reason_code" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."receipt_codec_version" is null
          and "fx_system_durable_task_compute_cancellation_v1"."settled_at" is not null
          and "fx_system_durable_task_compute_cancellation_v1"."claim_owner" is null)
      ) is true),
	CONSTRAINT "fx_task_compute_cancel_v1_reason_check" CHECK (("fx_system_durable_task_compute_cancellation_v1"."reason_code" is null or (
        "fx_system_durable_task_compute_cancellation_v1"."reason_code" ~ '^[a-z][a-z0-9_]*$'
        and octet_length(convert_to("fx_system_durable_task_compute_cancellation_v1"."reason_code", 'UTF8')) between 1 and 64
      )) is true),
	CONSTRAINT "fx_task_compute_cancel_v1_time_check" CHECK ((isfinite("fx_system_durable_task_compute_cancellation_v1"."created_at")
        and isfinite("fx_system_durable_task_compute_cancellation_v1"."updated_at")
        and "fx_system_durable_task_compute_cancellation_v1"."updated_at" >= "fx_system_durable_task_compute_cancellation_v1"."created_at"
        and ("fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is null
          or (isfinite("fx_system_durable_task_compute_cancellation_v1"."delivery_started_at")
            and "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" >= "fx_system_durable_task_compute_cancellation_v1"."created_at"))
        and ("fx_system_durable_task_compute_cancellation_v1"."next_attempt_at" is null
          or isfinite("fx_system_durable_task_compute_cancellation_v1"."next_attempt_at"))
        and ("fx_system_durable_task_compute_cancellation_v1"."settled_at" is null
          or (isfinite("fx_system_durable_task_compute_cancellation_v1"."settled_at")
            and "fx_system_durable_task_compute_cancellation_v1"."settled_at" >= "fx_system_durable_task_compute_cancellation_v1"."created_at"
            and ("fx_system_durable_task_compute_cancellation_v1"."delivery_started_at" is null
              or "fx_system_durable_task_compute_cancellation_v1"."settled_at" >= "fx_system_durable_task_compute_cancellation_v1"."delivery_started_at")))) is true)
);
--> statement-breakpoint
CREATE TABLE "fx_system_durable_task_compute_dispatch_v1" (
	"scope_id" text NOT NULL,
	"run_id" text NOT NULL,
	"requested_effect_sequence" bigint NOT NULL,
	"accepted_run_version" bigint NOT NULL,
	"task_definition_revision_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"execution_fence" bigint NOT NULL,
	"lease_version" bigint NOT NULL,
	"compute_profile_codec_version" integer NOT NULL,
	"compute_profile_byte_length" integer NOT NULL,
	"compute_profile_bytes" "bytea" NOT NULL,
	"cancellation_kind" text NOT NULL,
	"cancellation_generation" bigint NOT NULL,
	"maximum_duration_ms" bigint NOT NULL,
	"request_codec_version" integer NOT NULL,
	"request_byte_length" bigint NOT NULL,
	"request_sha256" "bytea" NOT NULL,
	"request_bytes" "bytea" NOT NULL,
	"delivery_state" text NOT NULL,
	"claim_owner" uuid,
	"claim_fence" bigint NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_expires_at" timestamp with time zone,
	"delivery_attempt_count" bigint NOT NULL,
	"delivery_started_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"reason_code" text,
	"acceptance_codec_version" integer,
	"acceptance_byte_length" bigint,
	"acceptance_sha256" "bytea",
	"acceptance_bytes" "bytea",
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_task_compute_dispatch_v1_pk" PRIMARY KEY("scope_id","run_id","requested_effect_sequence"),
	CONSTRAINT "fx_task_compute_dispatch_v1_attempt_unique" UNIQUE("scope_id","run_id","attempt_id","execution_fence"),
	CONSTRAINT "fx_task_compute_dispatch_v1_identity_check" CHECK ("fx_system_durable_task_compute_dispatch_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_compute_dispatch_v1"."requested_effect_sequence" >= 1
        and "fx_system_durable_task_compute_dispatch_v1"."accepted_run_version" >= 1
        and "fx_system_durable_task_compute_dispatch_v1"."task_definition_revision_id" ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_compute_dispatch_v1"."attempt_id" ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_compute_dispatch_v1"."attempt_number" between 1 and 250
        and "fx_system_durable_task_compute_dispatch_v1"."execution_fence" >= 1
        and "fx_system_durable_task_compute_dispatch_v1"."lease_version" >= 1
        and "fx_system_durable_task_compute_dispatch_v1"."compute_profile_codec_version" = 1
        and "fx_system_durable_task_compute_dispatch_v1"."compute_profile_byte_length" between 2 and 510
        and "fx_system_durable_task_compute_dispatch_v1"."compute_profile_byte_length" % 2 = 0
        and octet_length("fx_system_durable_task_compute_dispatch_v1"."compute_profile_bytes") = "fx_system_durable_task_compute_dispatch_v1"."compute_profile_byte_length"
        and "fx_system_durable_task_compute_dispatch_v1"."maximum_duration_ms" between 1 and 9007199254740991
        and (("fx_system_durable_task_compute_dispatch_v1"."cancellation_kind" = 'not_requested'
              and "fx_system_durable_task_compute_dispatch_v1"."cancellation_generation" = 0)
          or ("fx_system_durable_task_compute_dispatch_v1"."cancellation_kind" = 'requested'
              and "fx_system_durable_task_compute_dispatch_v1"."cancellation_generation" >= 1))),
	CONSTRAINT "fx_task_compute_dispatch_v1_request_check" CHECK ("fx_system_durable_task_compute_dispatch_v1"."request_codec_version" = 1
        and "fx_system_durable_task_compute_dispatch_v1"."request_byte_length" between 1 and 16384
        and octet_length("fx_system_durable_task_compute_dispatch_v1"."request_bytes") = "fx_system_durable_task_compute_dispatch_v1"."request_byte_length"
        and octet_length("fx_system_durable_task_compute_dispatch_v1"."request_sha256") = 32),
	CONSTRAINT "fx_task_compute_dispatch_v1_claim_check" CHECK (("fx_system_durable_task_compute_dispatch_v1"."claim_fence" >= 0 and (
        ("fx_system_durable_task_compute_dispatch_v1"."claim_owner" is null
          and "fx_system_durable_task_compute_dispatch_v1"."claimed_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."claim_expires_at" is null)
        or ("fx_system_durable_task_compute_dispatch_v1"."claim_owner" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."claim_fence" >= 1
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_state" in ('prepared', 'delivering', 'retry_wait')
          and "fx_system_durable_task_compute_dispatch_v1"."claimed_at" is not null
          and isfinite("fx_system_durable_task_compute_dispatch_v1"."claimed_at")
          and "fx_system_durable_task_compute_dispatch_v1"."claim_expires_at" is not null
          and isfinite("fx_system_durable_task_compute_dispatch_v1"."claim_expires_at")
          and "fx_system_durable_task_compute_dispatch_v1"."claim_expires_at" > "fx_system_durable_task_compute_dispatch_v1"."claimed_at")
      )) is true),
	CONSTRAINT "fx_task_compute_dispatch_v1_acceptance_check" CHECK ((
        ("fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" is null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_byte_length" is null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_sha256" is null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_bytes" is null)
        or ("fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" = 1
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_byte_length" between 1 and 16384
          and octet_length("fx_system_durable_task_compute_dispatch_v1"."acceptance_bytes") =
            "fx_system_durable_task_compute_dispatch_v1"."acceptance_byte_length"
          and octet_length("fx_system_durable_task_compute_dispatch_v1"."acceptance_sha256") = 32)
      ) is true),
	CONSTRAINT "fx_task_compute_dispatch_v1_state_check" CHECK ((
        ("fx_system_durable_task_compute_dispatch_v1"."delivery_state" = 'prepared'
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" = 0
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."reason_code" is null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" is null
          and "fx_system_durable_task_compute_dispatch_v1"."settled_at" is null)
        or ("fx_system_durable_task_compute_dispatch_v1"."delivery_state" = 'delivering'
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" >= 1
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."reason_code" is null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" is null
          and "fx_system_durable_task_compute_dispatch_v1"."settled_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."claim_owner" is not null)
        or ("fx_system_durable_task_compute_dispatch_v1"."delivery_state" = 'accepted'
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" >= 1
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."reason_code" is null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."settled_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."claim_owner" is null)
        or ("fx_system_durable_task_compute_dispatch_v1"."delivery_state" = 'retry_wait'
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" >= 1
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" > "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at"
          and "fx_system_durable_task_compute_dispatch_v1"."reason_code" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" is null
          and "fx_system_durable_task_compute_dispatch_v1"."settled_at" is null)
        or ("fx_system_durable_task_compute_dispatch_v1"."delivery_state" = 'rejected'
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" >= 1
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."reason_code" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" is null
          and "fx_system_durable_task_compute_dispatch_v1"."settled_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."claim_owner" is null)
        or ("fx_system_durable_task_compute_dispatch_v1"."delivery_state" = 'quarantined'
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" >= 0
          and (("fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" = 0
              and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is null)
            or ("fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" >= 1
              and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is not null))
          and "fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."reason_code" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" is null
          and "fx_system_durable_task_compute_dispatch_v1"."settled_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."claim_owner" is null)
        or ("fx_system_durable_task_compute_dispatch_v1"."delivery_state" = 'obsolete'
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_attempt_count" = 0
          and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" is null
          and "fx_system_durable_task_compute_dispatch_v1"."reason_code" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."acceptance_codec_version" is null
          and "fx_system_durable_task_compute_dispatch_v1"."settled_at" is not null
          and "fx_system_durable_task_compute_dispatch_v1"."claim_owner" is null)
      ) is true),
	CONSTRAINT "fx_task_compute_dispatch_v1_reason_check" CHECK (("fx_system_durable_task_compute_dispatch_v1"."reason_code" is null or (
        "fx_system_durable_task_compute_dispatch_v1"."reason_code" ~ '^[a-z][a-z0-9_]*$'
        and octet_length(convert_to("fx_system_durable_task_compute_dispatch_v1"."reason_code", 'UTF8')) between 1 and 64
      )) is true),
	CONSTRAINT "fx_task_compute_dispatch_v1_time_check" CHECK ((isfinite("fx_system_durable_task_compute_dispatch_v1"."created_at")
        and isfinite("fx_system_durable_task_compute_dispatch_v1"."updated_at")
        and "fx_system_durable_task_compute_dispatch_v1"."updated_at" >= "fx_system_durable_task_compute_dispatch_v1"."created_at"
        and ("fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is null
          or (isfinite("fx_system_durable_task_compute_dispatch_v1"."delivery_started_at")
            and "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" >= "fx_system_durable_task_compute_dispatch_v1"."created_at"))
        and ("fx_system_durable_task_compute_dispatch_v1"."next_attempt_at" is null
          or isfinite("fx_system_durable_task_compute_dispatch_v1"."next_attempt_at"))
        and ("fx_system_durable_task_compute_dispatch_v1"."settled_at" is null
          or (isfinite("fx_system_durable_task_compute_dispatch_v1"."settled_at")
            and "fx_system_durable_task_compute_dispatch_v1"."settled_at" >= "fx_system_durable_task_compute_dispatch_v1"."created_at"
            and ("fx_system_durable_task_compute_dispatch_v1"."delivery_started_at" is null
              or "fx_system_durable_task_compute_dispatch_v1"."settled_at" >= "fx_system_durable_task_compute_dispatch_v1"."delivery_started_at")))) is true)
);
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_cancellation_v1" ADD CONSTRAINT "fx_task_compute_cancel_v1_run_fk" FOREIGN KEY ("scope_id","run_id") REFERENCES "fx_system_durable_task_run_v1"("scope_id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_cancellation_v1" ADD CONSTRAINT "fx_task_compute_cancel_v1_effect_fk" FOREIGN KEY ("scope_id","run_id","requested_effect_sequence") REFERENCES "fx_system_durable_task_requested_effect_v1"("scope_id","run_id","sequence") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_cancellation_v1" ADD CONSTRAINT "fx_task_compute_cancel_v1_dispatch_fk" FOREIGN KEY ("scope_id","run_id","dispatch_requested_effect_sequence") REFERENCES "fx_system_durable_task_compute_dispatch_v1"("scope_id","run_id","requested_effect_sequence") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" ADD CONSTRAINT "fx_task_compute_dispatch_v1_run_fk" FOREIGN KEY ("scope_id","run_id") REFERENCES "fx_system_durable_task_run_v1"("scope_id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" ADD CONSTRAINT "fx_task_compute_dispatch_v1_effect_fk" FOREIGN KEY ("scope_id","run_id","requested_effect_sequence") REFERENCES "fx_system_durable_task_requested_effect_v1"("scope_id","run_id","sequence") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_compute_dispatch_v1" ADD CONSTRAINT "fx_task_compute_dispatch_v1_definition_fk" FOREIGN KEY ("scope_id","task_definition_revision_id") REFERENCES "fx_system_durable_task_definition_revision_v1"("scope_id","task_definition_revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fx_task_compute_cancel_v1_due_idx" ON "fx_system_durable_task_compute_cancellation_v1" USING btree ("scope_id","delivery_state","next_attempt_at","run_id","requested_effect_sequence");--> statement-breakpoint
CREATE INDEX "fx_task_compute_cancel_v1_claim_idx" ON "fx_system_durable_task_compute_cancellation_v1" USING btree ("scope_id","claim_expires_at","run_id","requested_effect_sequence") WHERE "fx_system_durable_task_compute_cancellation_v1"."claim_owner" is not null;--> statement-breakpoint
CREATE INDEX "fx_task_compute_dispatch_v1_due_idx" ON "fx_system_durable_task_compute_dispatch_v1" USING btree ("scope_id","delivery_state","next_attempt_at","run_id","requested_effect_sequence");--> statement-breakpoint
CREATE INDEX "fx_task_compute_dispatch_v1_claim_idx" ON "fx_system_durable_task_compute_dispatch_v1" USING btree ("scope_id","claim_expires_at","run_id","requested_effect_sequence") WHERE "fx_system_durable_task_compute_dispatch_v1"."claim_owner" is not null;

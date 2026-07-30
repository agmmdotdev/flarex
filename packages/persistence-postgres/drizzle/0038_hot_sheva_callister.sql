CREATE TABLE "fx_system_declarative_v2_verifier_command_authority_v1" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"sequence" bigint NOT NULL,
	"command_kind" text NOT NULL,
	"reservation_sha256" "bytea" NOT NULL,
	"reserved_by_fence" bigint NOT NULL,
	"reserved_at" timestamp with time zone NOT NULL,
	"future_registration_intent_codec_version" integer,
	"future_registration_intent_byte_length" bigint,
	"future_registration_intent_sha256" "bytea",
	"future_registration_intent_bytes" "bytea",
	"terminal_proof_codec_version" integer,
	"terminal_proof_byte_length" bigint,
	"terminal_proof_sha256" "bytea",
	"terminal_proof_bytes" "bytea",
	"settled_at" timestamp with time zone,
	CONSTRAINT "fx_system_declarative_v2_verifier_command_authority_v1_scope_id_attempt_sha256_sequence_pk" PRIMARY KEY("scope_id","attempt_sha256","sequence"),
	CONSTRAINT "fx_dv2_command_authority_v1_identity_unique" UNIQUE("scope_id","attempt_sha256","sequence","reservation_sha256","command_kind"),
	CONSTRAINT "fx_dv2_command_authority_v1_identity_check" CHECK ("fx_system_declarative_v2_verifier_command_authority_v1"."sequence" >= 1
        and "fx_system_declarative_v2_verifier_command_authority_v1"."command_kind" in (
          'source_page', 'parse_module', 'link_page', 'registration_page'
        )
        and octet_length("fx_system_declarative_v2_verifier_command_authority_v1"."attempt_sha256") = 32
        and octet_length("fx_system_declarative_v2_verifier_command_authority_v1"."reservation_sha256") = 32
        and "fx_system_declarative_v2_verifier_command_authority_v1"."reserved_by_fence" >= 1
        and isfinite("fx_system_declarative_v2_verifier_command_authority_v1"."reserved_at")),
	CONSTRAINT "fx_dv2_command_authority_v1_intent_check" CHECK ((
        (
          "fx_system_declarative_v2_verifier_command_authority_v1"."command_kind" in ('source_page', 'parse_module')
          and (
    "fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_codec_version" is null
    and "fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_byte_length" is null
    and "fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_sha256" is null
    and "fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_bytes" is null
  )
        )
        or
        (
          "fx_system_declarative_v2_verifier_command_authority_v1"."command_kind" in ('link_page', 'registration_page')
          and (
    "fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_codec_version" = 1
    and "fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_bytes") = "fx_system_declarative_v2_verifier_command_authority_v1"."future_registration_intent_byte_length"
  ) is true
        )
      ) is true),
	CONSTRAINT "fx_dv2_command_authority_v1_terminal_check" CHECK ((
        (
          (
    "fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_codec_version" is null
    and "fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_byte_length" is null
    and "fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_sha256" is null
    and "fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_bytes" is null
  )
          and "fx_system_declarative_v2_verifier_command_authority_v1"."settled_at" is null
        )
        or
        (
          (
    "fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_codec_version" = 1
    and "fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_bytes") = "fx_system_declarative_v2_verifier_command_authority_v1"."terminal_proof_byte_length"
  ) is true
          and "fx_system_declarative_v2_verifier_command_authority_v1"."settled_at" is not null
          and isfinite("fx_system_declarative_v2_verifier_command_authority_v1"."settled_at")
          and "fx_system_declarative_v2_verifier_command_authority_v1"."settled_at" >= "fx_system_declarative_v2_verifier_command_authority_v1"."reserved_at"
        )
      ) is true)
);
--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verifier_command_authority_v1" ADD CONSTRAINT "fx_dv2_command_authority_v1_command_fk" FOREIGN KEY ("scope_id","attempt_sha256","sequence","reservation_sha256","command_kind") REFERENCES "fx_system_declarative_v2_verifier_command_v2"("scope_id","attempt_sha256","sequence","reservation_sha256","command_kind") ON DELETE restrict ON UPDATE no action;

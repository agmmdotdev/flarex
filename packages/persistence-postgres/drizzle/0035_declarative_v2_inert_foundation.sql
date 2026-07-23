-- Private inert Declarative V2 physical evidence. This migration enrolls no
-- activation-head row and changes no production authority.
CREATE TABLE "fx_system_declarative_v2_activation_head" (
	"scope_id" text PRIMARY KEY NOT NULL,
	"revision_counter" bigint DEFAULT 0 NOT NULL,
	"current_revision" bigint,
	"candidate_sha256" "bytea",
	"verdict_sha256" "bytea",
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_dv2_head_state_check" CHECK (
        (
        "fx_system_declarative_v2_activation_head"."revision_counter" >= 0
        and (
          (
            "fx_system_declarative_v2_activation_head"."current_revision" is null
            and "fx_system_declarative_v2_activation_head"."candidate_sha256" is null
            and "fx_system_declarative_v2_activation_head"."verdict_sha256" is null
          )
          or
          (
            "fx_system_declarative_v2_activation_head"."current_revision" >= 1
            and "fx_system_declarative_v2_activation_head"."revision_counter" >= "fx_system_declarative_v2_activation_head"."current_revision"
            and octet_length("fx_system_declarative_v2_activation_head"."candidate_sha256") = 32
            and octet_length("fx_system_declarative_v2_activation_head"."verdict_sha256") = 32
          )
        )
        ) is true
      ),
	CONSTRAINT "fx_dv2_head_frame_check" CHECK ((
    "fx_system_declarative_v2_activation_head"."frame_codec_version" = 1
    and "fx_system_declarative_v2_activation_head"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_activation_head"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_activation_head"."frame_bytes") = "fx_system_declarative_v2_activation_head"."frame_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_head_timestamps_check" CHECK (isfinite("fx_system_declarative_v2_activation_head"."created_at")
        and isfinite("fx_system_declarative_v2_activation_head"."updated_at")
        and "fx_system_declarative_v2_activation_head"."updated_at" >= "fx_system_declarative_v2_activation_head"."created_at")
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_activation_revision" (
	"scope_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"previous_revision" bigint,
	"action" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"verdict_sha256" "bytea" NOT NULL,
	"activation_request_sha256" "bytea" NOT NULL,
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_activation_revision_scope_id_revision_pk" PRIMARY KEY("scope_id","revision"),
	CONSTRAINT "fx_dv2_activation_request_unique" UNIQUE("scope_id","activation_request_sha256"),
	CONSTRAINT "fx_dv2_revision_sequence_check" CHECK (
        ((
          "fx_system_declarative_v2_activation_revision"."revision" = 1
          and "fx_system_declarative_v2_activation_revision"."previous_revision" is null
        )
        or
        (
          "fx_system_declarative_v2_activation_revision"."revision" >= 2
          and "fx_system_declarative_v2_activation_revision"."previous_revision" = "fx_system_declarative_v2_activation_revision"."revision" - 1
        )) is true
      ),
	CONSTRAINT "fx_dv2_revision_action_check" CHECK ("fx_system_declarative_v2_activation_revision"."action" in ('activate', 'rollback')),
	CONSTRAINT "fx_dv2_revision_digest_check" CHECK (octet_length("fx_system_declarative_v2_activation_revision"."candidate_sha256") = 32
        and octet_length("fx_system_declarative_v2_activation_revision"."verdict_sha256") = 32
        and octet_length("fx_system_declarative_v2_activation_revision"."activation_request_sha256") = 32),
	CONSTRAINT "fx_dv2_revision_frame_check" CHECK ((
    "fx_system_declarative_v2_activation_revision"."frame_codec_version" = 1
    and "fx_system_declarative_v2_activation_revision"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_activation_revision"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_activation_revision"."frame_bytes") = "fx_system_declarative_v2_activation_revision"."frame_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_revision_time_check" CHECK (isfinite("fx_system_declarative_v2_activation_revision"."activated_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_candidate_projection" (
	"scope_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"projection_kind" text NOT NULL,
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_candidate_projection_scope_id_candidate_sha256_projection_kind_pk" PRIMARY KEY("scope_id","candidate_sha256","projection_kind"),
	CONSTRAINT "fx_dv2_projection_kind_check" CHECK ("fx_system_declarative_v2_candidate_projection"."projection_kind" in (
        'deployment_analysis',
        'deployment_codegen_analysis'
      )),
	CONSTRAINT "fx_dv2_projection_frame_check" CHECK ((
    "fx_system_declarative_v2_candidate_projection"."frame_codec_version" = 1
    and "fx_system_declarative_v2_candidate_projection"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_candidate_projection"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_candidate_projection"."frame_bytes") = "fx_system_declarative_v2_candidate_projection"."frame_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_projection_created_check" CHECK (isfinite("fx_system_declarative_v2_candidate_projection"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_candidate" (
	"scope_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_candidate_scope_id_candidate_sha256_pk" PRIMARY KEY("scope_id","candidate_sha256"),
	CONSTRAINT "fx_dv2_candidate_scope_check" CHECK (btrim("fx_system_declarative_v2_candidate"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_dv2_candidate_digest_check" CHECK (octet_length("fx_system_declarative_v2_candidate"."candidate_sha256") = 32
        and octet_length("fx_system_declarative_v2_candidate"."frame_sha256") = 32
        and "fx_system_declarative_v2_candidate"."candidate_sha256" = "fx_system_declarative_v2_candidate"."frame_sha256"),
	CONSTRAINT "fx_dv2_candidate_clock_check" CHECK ("fx_system_declarative_v2_candidate"."storage_generation" = 'flarexdb_v1'
        and "fx_system_declarative_v2_candidate"."storage_generation_fence" >= 1
        and btrim("fx_system_declarative_v2_candidate"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_dv2_candidate_frame_check" CHECK ((
    "fx_system_declarative_v2_candidate"."frame_codec_version" = 1
    and "fx_system_declarative_v2_candidate"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_candidate"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_candidate"."frame_bytes") = "fx_system_declarative_v2_candidate"."frame_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_candidate_created_check" CHECK (isfinite("fx_system_declarative_v2_candidate"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_diagnostic" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"diagnostic_ordinal" bigint NOT NULL,
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_diagnostic_scope_id_attempt_sha256_diagnostic_ordinal_pk" PRIMARY KEY("scope_id","attempt_sha256","diagnostic_ordinal"),
	CONSTRAINT "fx_dv2_diagnostic_check" CHECK ("fx_system_declarative_v2_diagnostic"."diagnostic_ordinal" >= 0
        and (
    "fx_system_declarative_v2_diagnostic"."frame_codec_version" = 1
    and "fx_system_declarative_v2_diagnostic"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_diagnostic"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_diagnostic"."frame_bytes") = "fx_system_declarative_v2_diagnostic"."frame_byte_length"
  ) is true)
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_frontier_entry" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"frontier_sequence" bigint NOT NULL,
	"module_ordinal" bigint NOT NULL,
	"state" text NOT NULL,
	"row_version" bigint NOT NULL,
	"row_codec_version" integer NOT NULL,
	"row_byte_length" bigint NOT NULL,
	"row_sha256" "bytea" NOT NULL,
	"row_bytes" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_frontier_entry_scope_id_attempt_sha256_frontier_sequence_pk" PRIMARY KEY("scope_id","attempt_sha256","frontier_sequence"),
	CONSTRAINT "fx_dv2_frontier_module_unique" UNIQUE("scope_id","attempt_sha256","module_ordinal"),
	CONSTRAINT "fx_dv2_frontier_state_check" CHECK ("fx_system_declarative_v2_frontier_entry"."frontier_sequence" >= 0
        and "fx_system_declarative_v2_frontier_entry"."module_ordinal" >= 0
        and "fx_system_declarative_v2_frontier_entry"."row_version" >= 0
        and "fx_system_declarative_v2_frontier_entry"."state" in ('queued', 'consumed')),
	CONSTRAINT "fx_dv2_frontier_frame_check" CHECK ((
    "fx_system_declarative_v2_frontier_entry"."row_codec_version" = 1
    and "fx_system_declarative_v2_frontier_entry"."row_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_frontier_entry"."row_sha256") = 32
    and octet_length("fx_system_declarative_v2_frontier_entry"."row_bytes") = "fx_system_declarative_v2_frontier_entry"."row_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_frontier_updated_check" CHECK (isfinite("fx_system_declarative_v2_frontier_entry"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_import_edge" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"module_ordinal" bigint NOT NULL,
	"edge_ordinal" bigint NOT NULL,
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_import_edge_scope_id_attempt_sha256_module_ordinal_edge_ordinal_pk" PRIMARY KEY("scope_id","attempt_sha256","module_ordinal","edge_ordinal"),
	CONSTRAINT "fx_dv2_edge_check" CHECK ("fx_system_declarative_v2_import_edge"."module_ordinal" >= 0
        and "fx_system_declarative_v2_import_edge"."edge_ordinal" >= 0
        and (
    "fx_system_declarative_v2_import_edge"."frame_codec_version" = 1
    and "fx_system_declarative_v2_import_edge"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_import_edge"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_import_edge"."frame_bytes") = "fx_system_declarative_v2_import_edge"."frame_byte_length"
  ) is true)
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_link_node" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"module_ordinal" bigint NOT NULL,
	"remaining_indegree" bigint NOT NULL,
	"next_edge_ordinal" bigint NOT NULL,
	"state" text NOT NULL,
	"row_version" bigint NOT NULL,
	"row_codec_version" integer NOT NULL,
	"row_byte_length" bigint NOT NULL,
	"row_sha256" "bytea" NOT NULL,
	"row_bytes" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_link_node_scope_id_attempt_sha256_module_ordinal_pk" PRIMARY KEY("scope_id","attempt_sha256","module_ordinal"),
	CONSTRAINT "fx_dv2_link_state_check" CHECK ("fx_system_declarative_v2_link_node"."module_ordinal" >= 0
        and "fx_system_declarative_v2_link_node"."remaining_indegree" >= 0
        and "fx_system_declarative_v2_link_node"."next_edge_ordinal" >= 0
        and "fx_system_declarative_v2_link_node"."row_version" >= 0
        and "fx_system_declarative_v2_link_node"."state" in ('pending', 'linked', 'rejected')),
	CONSTRAINT "fx_dv2_link_frame_check" CHECK ((
    "fx_system_declarative_v2_link_node"."row_codec_version" = 1
    and "fx_system_declarative_v2_link_node"."row_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_link_node"."row_sha256") = 32
    and octet_length("fx_system_declarative_v2_link_node"."row_bytes") = "fx_system_declarative_v2_link_node"."row_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_link_updated_check" CHECK (isfinite("fx_system_declarative_v2_link_node"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_module_summary" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"module_ordinal" bigint NOT NULL,
	"module_path_sha256" "bytea" NOT NULL,
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_module_summary_scope_id_attempt_sha256_module_ordinal_pk" PRIMARY KEY("scope_id","attempt_sha256","module_ordinal"),
	CONSTRAINT "fx_dv2_module_path_unique" UNIQUE("scope_id","attempt_sha256","module_path_sha256"),
	CONSTRAINT "fx_dv2_module_check" CHECK ("fx_system_declarative_v2_module_summary"."module_ordinal" >= 0
        and octet_length("fx_system_declarative_v2_module_summary"."module_path_sha256") = 32
        and (
    "fx_system_declarative_v2_module_summary"."frame_codec_version" = 1
    and "fx_system_declarative_v2_module_summary"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_module_summary"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_module_summary"."frame_bytes") = "fx_system_declarative_v2_module_summary"."frame_byte_length"
  ) is true)
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_page_manifest" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"phase" text NOT NULL,
	"page_ordinal" bigint NOT NULL,
	"first_item_ordinal" bigint NOT NULL,
	"item_count" bigint NOT NULL,
	"previous_page_sha256" "bytea",
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_page_manifest_scope_id_attempt_sha256_phase_page_ordinal_pk" PRIMARY KEY("scope_id","attempt_sha256","phase","page_ordinal"),
	CONSTRAINT "fx_dv2_page_phase_check" CHECK ("fx_system_declarative_v2_page_manifest"."phase" in ('source', 'parse', 'link', 'registration', 'verdict')),
	CONSTRAINT "fx_dv2_page_range_check" CHECK ("fx_system_declarative_v2_page_manifest"."page_ordinal" >= 0
        and "fx_system_declarative_v2_page_manifest"."first_item_ordinal" >= 0
        and "fx_system_declarative_v2_page_manifest"."item_count" >= 1
        and ((
          ("fx_system_declarative_v2_page_manifest"."page_ordinal" = 0 and "fx_system_declarative_v2_page_manifest"."previous_page_sha256" is null)
          or (
            "fx_system_declarative_v2_page_manifest"."page_ordinal" >= 1
            and octet_length("fx_system_declarative_v2_page_manifest"."previous_page_sha256") = 32
          )
        )) is true),
	CONSTRAINT "fx_dv2_page_frame_check" CHECK ((
    "fx_system_declarative_v2_page_manifest"."frame_codec_version" = 1
    and "fx_system_declarative_v2_page_manifest"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_page_manifest"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_page_manifest"."frame_bytes") = "fx_system_declarative_v2_page_manifest"."frame_byte_length"
  ) is true)
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_registration" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"registration_ordinal" bigint NOT NULL,
	"handler_identity_sha256" "bytea" NOT NULL,
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_registration_scope_id_attempt_sha256_registration_ordinal_pk" PRIMARY KEY("scope_id","attempt_sha256","registration_ordinal"),
	CONSTRAINT "fx_dv2_registration_handler_unique" UNIQUE("scope_id","attempt_sha256","handler_identity_sha256"),
	CONSTRAINT "fx_dv2_registration_check" CHECK ("fx_system_declarative_v2_registration"."registration_ordinal" >= 0
        and octet_length("fx_system_declarative_v2_registration"."handler_identity_sha256") = 32
        and (
    "fx_system_declarative_v2_registration"."frame_codec_version" = 1
    and "fx_system_declarative_v2_registration"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_registration"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_registration"."frame_bytes") = "fx_system_declarative_v2_registration"."frame_byte_length"
  ) is true)
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_verdict" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"verdict_sha256" "bytea" NOT NULL,
	"verdict" text NOT NULL,
	"failure_code" text,
	"frame_codec_version" integer NOT NULL,
	"frame_byte_length" bigint NOT NULL,
	"frame_sha256" "bytea" NOT NULL,
	"frame_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_verdict_scope_id_attempt_sha256_pk" PRIMARY KEY("scope_id","attempt_sha256"),
	CONSTRAINT "fx_dv2_verdict_digest_unique" UNIQUE("scope_id","verdict_sha256"),
	CONSTRAINT "fx_dv2_verdict_state_check" CHECK (
        ((
          "fx_system_declarative_v2_verdict"."verdict" = 'ready'
          and "fx_system_declarative_v2_verdict"."failure_code" is null
        )
        or
        (
          "fx_system_declarative_v2_verdict"."verdict" = 'rejected'
          and btrim("fx_system_declarative_v2_verdict"."failure_code", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        )) is true
      ),
	CONSTRAINT "fx_dv2_verdict_frame_check" CHECK (octet_length("fx_system_declarative_v2_verdict"."verdict_sha256") = 32
        and "fx_system_declarative_v2_verdict"."verdict_sha256" = "fx_system_declarative_v2_verdict"."frame_sha256"
        and (
    "fx_system_declarative_v2_verdict"."frame_codec_version" = 1
    and "fx_system_declarative_v2_verdict"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verdict"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_verdict"."frame_bytes") = "fx_system_declarative_v2_verdict"."frame_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_verdict_created_check" CHECK (isfinite("fx_system_declarative_v2_verdict"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_verifier_attempt" (
	"scope_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"lifecycle" text NOT NULL,
	"writer_owner_id" uuid,
	"writer_fence" bigint DEFAULT 0 NOT NULL,
	"lease_updated_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"settled_sequence" bigint DEFAULT 0 NOT NULL,
	"last_command_sha256" "bytea",
	"last_receipt_codec_version" integer,
	"last_receipt_byte_length" bigint,
	"last_receipt_sha256" "bytea",
	"last_receipt_bytes" "bytea",
	"pending_kind" text,
	"pending_sequence" bigint,
	"pending_command_sha256" "bytea",
	"pending_reserved_by_fence" bigint,
	"pending_started_at" timestamp with time zone,
	"pending_budget_codec_version" integer,
	"pending_budget_byte_length" bigint,
	"pending_budget_sha256" "bytea",
	"pending_budget_bytes" "bytea",
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
	CONSTRAINT "fx_system_declarative_v2_verifier_attempt_scope_id_attempt_sha256_pk" PRIMARY KEY("scope_id","attempt_sha256"),
	CONSTRAINT "fx_dv2_attempt_digest_check" CHECK (octet_length("fx_system_declarative_v2_verifier_attempt"."attempt_sha256") = 32
        and octet_length("fx_system_declarative_v2_verifier_attempt"."candidate_sha256") = 32
        and "fx_system_declarative_v2_verifier_attempt"."attempt_sha256" = "fx_system_declarative_v2_verifier_attempt"."identity_sha256"),
	CONSTRAINT "fx_dv2_attempt_lifecycle_check" CHECK ("fx_system_declarative_v2_verifier_attempt"."lifecycle" in (
        'open', 'parsing', 'parse_complete', 'linking', 'link_complete',
        'registering', 'ready', 'rejected', 'abandoned'
      )),
	CONSTRAINT "fx_dv2_attempt_fence_check" CHECK ("fx_system_declarative_v2_verifier_attempt"."writer_fence" >= 0),
	CONSTRAINT "fx_dv2_attempt_lease_check" CHECK (
        ((
          "fx_system_declarative_v2_verifier_attempt"."writer_owner_id" is null
          and "fx_system_declarative_v2_verifier_attempt"."lease_updated_at" is null
          and "fx_system_declarative_v2_verifier_attempt"."lease_expires_at" is null
        )
        or
        (
          "fx_system_declarative_v2_verifier_attempt"."writer_owner_id" is not null
          and "fx_system_declarative_v2_verifier_attempt"."writer_fence" >= 1
          and "fx_system_declarative_v2_verifier_attempt"."lease_updated_at" is not null
          and isfinite("fx_system_declarative_v2_verifier_attempt"."lease_updated_at")
          and "fx_system_declarative_v2_verifier_attempt"."lease_expires_at" is not null
          and isfinite("fx_system_declarative_v2_verifier_attempt"."lease_expires_at")
          and "fx_system_declarative_v2_verifier_attempt"."lease_expires_at" > "fx_system_declarative_v2_verifier_attempt"."lease_updated_at"
          and "fx_system_declarative_v2_verifier_attempt"."lifecycle" not in ('ready', 'rejected', 'abandoned')
        )) is true
      ),
	CONSTRAINT "fx_dv2_attempt_settled_check" CHECK (
        (
        "fx_system_declarative_v2_verifier_attempt"."settled_sequence" >= 0
        and (
          (
            "fx_system_declarative_v2_verifier_attempt"."settled_sequence" = 0
            and "fx_system_declarative_v2_verifier_attempt"."last_command_sha256" is null
            and (
    "fx_system_declarative_v2_verifier_attempt"."last_receipt_codec_version" is null
    and "fx_system_declarative_v2_verifier_attempt"."last_receipt_byte_length" is null
    and "fx_system_declarative_v2_verifier_attempt"."last_receipt_sha256" is null
    and "fx_system_declarative_v2_verifier_attempt"."last_receipt_bytes" is null
  )
          )
          or
          (
            "fx_system_declarative_v2_verifier_attempt"."settled_sequence" >= 1
            and "fx_system_declarative_v2_verifier_attempt"."last_command_sha256" is not null
            and octet_length("fx_system_declarative_v2_verifier_attempt"."last_command_sha256") = 32
            and (
    "fx_system_declarative_v2_verifier_attempt"."last_receipt_codec_version" = 1
    and "fx_system_declarative_v2_verifier_attempt"."last_receipt_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt"."last_receipt_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt"."last_receipt_bytes") = "fx_system_declarative_v2_verifier_attempt"."last_receipt_byte_length"
  ) is true
          )
        )
        ) is true
      ),
	CONSTRAINT "fx_dv2_attempt_pending_check" CHECK (
        ((
          "fx_system_declarative_v2_verifier_attempt"."pending_kind" is null
          and "fx_system_declarative_v2_verifier_attempt"."pending_sequence" is null
          and "fx_system_declarative_v2_verifier_attempt"."pending_command_sha256" is null
          and "fx_system_declarative_v2_verifier_attempt"."pending_reserved_by_fence" is null
          and "fx_system_declarative_v2_verifier_attempt"."pending_started_at" is null
          and (
    "fx_system_declarative_v2_verifier_attempt"."pending_budget_codec_version" is null
    and "fx_system_declarative_v2_verifier_attempt"."pending_budget_byte_length" is null
    and "fx_system_declarative_v2_verifier_attempt"."pending_budget_sha256" is null
    and "fx_system_declarative_v2_verifier_attempt"."pending_budget_bytes" is null
  )
        )
        or
        (
          "fx_system_declarative_v2_verifier_attempt"."pending_kind" in (
            'source_page', 'parse_module', 'link_page',
            'registration_page', 'finalize'
          )
          and "fx_system_declarative_v2_verifier_attempt"."pending_sequence" = "fx_system_declarative_v2_verifier_attempt"."settled_sequence" + 1
          and "fx_system_declarative_v2_verifier_attempt"."settled_sequence" < 9223372036854775807
          and "fx_system_declarative_v2_verifier_attempt"."pending_command_sha256" is not null
          and octet_length("fx_system_declarative_v2_verifier_attempt"."pending_command_sha256") = 32
          and "fx_system_declarative_v2_verifier_attempt"."pending_reserved_by_fence" is not null
          and "fx_system_declarative_v2_verifier_attempt"."pending_reserved_by_fence" >= 1
          and "fx_system_declarative_v2_verifier_attempt"."pending_started_at" is not null
          and isfinite("fx_system_declarative_v2_verifier_attempt"."pending_started_at")
          and (
    "fx_system_declarative_v2_verifier_attempt"."pending_budget_codec_version" = 1
    and "fx_system_declarative_v2_verifier_attempt"."pending_budget_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt"."pending_budget_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt"."pending_budget_bytes") = "fx_system_declarative_v2_verifier_attempt"."pending_budget_byte_length"
  ) is true
        )) is true
      ),
	CONSTRAINT "fx_dv2_attempt_identity_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_attempt"."identity_codec_version" = 1
    and "fx_system_declarative_v2_verifier_attempt"."identity_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt"."identity_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt"."identity_bytes") = "fx_system_declarative_v2_verifier_attempt"."identity_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_attempt_ceilings_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_attempt"."ceilings_codec_version" = 1
    and "fx_system_declarative_v2_verifier_attempt"."ceilings_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt"."ceilings_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt"."ceilings_bytes") = "fx_system_declarative_v2_verifier_attempt"."ceilings_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_attempt_usage_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_attempt"."usage_codec_version" = 1
    and "fx_system_declarative_v2_verifier_attempt"."usage_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt"."usage_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt"."usage_bytes") = "fx_system_declarative_v2_verifier_attempt"."usage_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_attempt_progress_frame_check" CHECK ((
    "fx_system_declarative_v2_verifier_attempt"."progress_codec_version" = 1
    and "fx_system_declarative_v2_verifier_attempt"."progress_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verifier_attempt"."progress_sha256") = 32
    and octet_length("fx_system_declarative_v2_verifier_attempt"."progress_bytes") = "fx_system_declarative_v2_verifier_attempt"."progress_byte_length"
  ) is true),
	CONSTRAINT "fx_dv2_attempt_timestamps_check" CHECK (isfinite("fx_system_declarative_v2_verifier_attempt"."created_at")
        and isfinite("fx_system_declarative_v2_verifier_attempt"."updated_at")
        and "fx_system_declarative_v2_verifier_attempt"."updated_at" >= "fx_system_declarative_v2_verifier_attempt"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_activation_head" ADD CONSTRAINT "fx_dv2_head_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_activation_head" ADD CONSTRAINT "fx_dv2_head_revision_fk" FOREIGN KEY ("scope_id","current_revision") REFERENCES "fx_system_declarative_v2_activation_revision"("scope_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_activation_head" ADD CONSTRAINT "fx_dv2_head_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_activation_head" ADD CONSTRAINT "fx_dv2_head_verdict_fk" FOREIGN KEY ("scope_id","verdict_sha256") REFERENCES "fx_system_declarative_v2_verdict"("scope_id","verdict_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_activation_revision" ADD CONSTRAINT "fx_dv2_revision_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_activation_revision" ADD CONSTRAINT "fx_dv2_revision_previous_fk" FOREIGN KEY ("scope_id","previous_revision") REFERENCES "fx_system_declarative_v2_activation_revision"("scope_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_activation_revision" ADD CONSTRAINT "fx_dv2_revision_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_activation_revision" ADD CONSTRAINT "fx_dv2_revision_verdict_fk" FOREIGN KEY ("scope_id","verdict_sha256") REFERENCES "fx_system_declarative_v2_verdict"("scope_id","verdict_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_candidate_projection" ADD CONSTRAINT "fx_dv2_projection_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_candidate" ADD CONSTRAINT "fx_dv2_candidate_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_diagnostic" ADD CONSTRAINT "fx_dv2_diagnostic_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_frontier_entry" ADD CONSTRAINT "fx_dv2_frontier_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_import_edge" ADD CONSTRAINT "fx_dv2_edge_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_link_node" ADD CONSTRAINT "fx_dv2_link_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_module_summary" ADD CONSTRAINT "fx_dv2_module_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_page_manifest" ADD CONSTRAINT "fx_dv2_page_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_registration" ADD CONSTRAINT "fx_dv2_registration_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" ADD CONSTRAINT "fx_dv2_verdict_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" ADD CONSTRAINT "fx_dv2_verdict_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verifier_attempt" ADD CONSTRAINT "fx_dv2_attempt_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;

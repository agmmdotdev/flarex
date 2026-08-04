CREATE TABLE "fx_system_application_action_invocation_v1" (
	"scope_id" text NOT NULL,
	"scope_uuid" uuid GENERATED ALWAYS AS (
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      ) STORED,
	"scope_epoch" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"request_key" text NOT NULL,
	"invocation_id" uuid NOT NULL,
	"request_identity_sha256" "bytea" NOT NULL,
	"action_binding_sha256" "bytea" NOT NULL,
	"application_revision_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"action_function_path" text NOT NULL,
	"execution_identity_sha256" "bytea" NOT NULL,
	"compatibility_date" text NOT NULL,
	"host_policy_sha256" "bytea" NOT NULL,
	"argument_store_identity" text NOT NULL,
	"argument_codec_identity" text NOT NULL,
	"argument_object_key" text NOT NULL,
	"argument_byte_length" bigint NOT NULL,
	"argument_sha256" "bytea" NOT NULL,
	"lifecycle" text NOT NULL,
	"execution_generation" bigint DEFAULT 0 NOT NULL,
	"invocation_time" timestamp with time zone,
	"execution_deadline" timestamp with time zone,
	"random_seed_sha256" "bytea",
	"last_effect_ordinal" bigint DEFAULT 0 NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"result_store_identity" text,
	"result_codec_identity" text,
	"result_object_key" text,
	"result_byte_length" bigint,
	"result_sha256" "bytea",
	"terminal_code" text,
	"admitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "fx_system_application_action_invocation_v1_scope_uuid_request_key_pk" PRIMARY KEY("scope_uuid","request_key"),
	CONSTRAINT "fx_action_invocation_v1_scope_invocation_unique" UNIQUE("scope_uuid","invocation_id"),
	CONSTRAINT "fx_action_invocation_v1_identity_check" CHECK (btrim("fx_system_application_action_invocation_v1"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_action_invocation_v1"."request_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_application_action_invocation_v1"."request_key", 'UTF8')) <= 2048
        and btrim("fx_system_application_action_invocation_v1"."application_revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_application_action_invocation_v1"."application_revision_id", 'UTF8')) <= 2048
        and btrim("fx_system_application_action_invocation_v1"."action_function_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_application_action_invocation_v1"."action_function_path", 'UTF8')) <= 2048
        and btrim("fx_system_application_action_invocation_v1"."compatibility_date", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_application_action_invocation_v1"."compatibility_date", 'UTF8')) <= 2048
        and octet_length("fx_system_application_action_invocation_v1"."request_identity_sha256") = 32
        and octet_length("fx_system_application_action_invocation_v1"."action_binding_sha256") = 32
        and octet_length("fx_system_application_action_invocation_v1"."candidate_sha256") = 32
        and octet_length("fx_system_application_action_invocation_v1"."execution_identity_sha256") = 32
        and octet_length("fx_system_application_action_invocation_v1"."host_policy_sha256") = 32
        and "fx_system_application_action_invocation_v1"."storage_generation_fence" >= 1),
	CONSTRAINT "fx_action_invocation_v1_argument_reference_check" CHECK ("fx_system_application_action_invocation_v1"."argument_store_identity" =
          'flarex.r2/execution-evidence-body/v1'
        and "fx_system_application_action_invocation_v1"."argument_codec_identity" =
          'flarex.codec/canonical-flarex-value/v1'
        and btrim("fx_system_application_action_invocation_v1"."argument_object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_application_action_invocation_v1"."argument_object_key", 'UTF8')) <= 2048
        and "fx_system_application_action_invocation_v1"."argument_byte_length" >= 1
        and octet_length("fx_system_application_action_invocation_v1"."argument_sha256") = 32),
	CONSTRAINT "fx_action_invocation_v1_execution_check" CHECK ((
        ("fx_system_application_action_invocation_v1"."lifecycle" = 'admitted'
          and "fx_system_application_action_invocation_v1"."invocation_time" is null
          and "fx_system_application_action_invocation_v1"."execution_deadline" is null
          and "fx_system_application_action_invocation_v1"."random_seed_sha256" is null)
        or ("fx_system_application_action_invocation_v1"."lifecycle" <> 'admitted'
          and ("fx_system_application_action_invocation_v1"."execution_generation" >= 1 or
            ("fx_system_application_action_invocation_v1"."lifecycle" = 'cancelled' and
              "fx_system_application_action_invocation_v1"."execution_generation" = 0))
          and (("fx_system_application_action_invocation_v1"."execution_generation" = 0
              and "fx_system_application_action_invocation_v1"."invocation_time" is null
              and "fx_system_application_action_invocation_v1"."execution_deadline" is null
              and "fx_system_application_action_invocation_v1"."random_seed_sha256" is null)
            or ("fx_system_application_action_invocation_v1"."execution_generation" >= 1
              and "fx_system_application_action_invocation_v1"."invocation_time" is not null
              and "fx_system_application_action_invocation_v1"."execution_deadline" is not null
              and "fx_system_application_action_invocation_v1"."execution_deadline" > "fx_system_application_action_invocation_v1"."invocation_time"
              and octet_length("fx_system_application_action_invocation_v1"."random_seed_sha256") = 32)))
      ) and "fx_system_application_action_invocation_v1"."execution_generation" >= 0
        and "fx_system_application_action_invocation_v1"."last_effect_ordinal" >= 0),
	CONSTRAINT "fx_action_invocation_v1_terminal_check" CHECK ((
        ("fx_system_application_action_invocation_v1"."lifecycle" in ('admitted', 'executing')
          and "fx_system_application_action_invocation_v1"."terminal_at" is null
          and "fx_system_application_action_invocation_v1"."terminal_code" is null
          and "fx_system_application_action_invocation_v1"."result_store_identity" is null
          and "fx_system_application_action_invocation_v1"."result_codec_identity" is null
          and "fx_system_application_action_invocation_v1"."result_object_key" is null
          and "fx_system_application_action_invocation_v1"."result_byte_length" is null
          and "fx_system_application_action_invocation_v1"."result_sha256" is null)
        or ("fx_system_application_action_invocation_v1"."lifecycle" = 'completed'
          and "fx_system_application_action_invocation_v1"."terminal_at" is not null
          and "fx_system_application_action_invocation_v1"."terminal_code" is null
          and "fx_system_application_action_invocation_v1"."result_store_identity" =
            'flarex.r2/execution-evidence-body/v1'
          and "fx_system_application_action_invocation_v1"."result_codec_identity" =
            'flarex.codec/canonical-flarex-value/v1'
          and btrim("fx_system_application_action_invocation_v1"."result_object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_application_action_invocation_v1"."result_object_key", 'UTF8')) <= 2048
          and "fx_system_application_action_invocation_v1"."result_byte_length" >= 1
          and octet_length("fx_system_application_action_invocation_v1"."result_sha256") = 32)
        or ("fx_system_application_action_invocation_v1"."lifecycle" in ('failed', 'uncertain', 'cancelled')
          and "fx_system_application_action_invocation_v1"."terminal_at" is not null
          and btrim("fx_system_application_action_invocation_v1"."terminal_code", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_application_action_invocation_v1"."terminal_code", 'UTF8')) <= 2048
          and "fx_system_application_action_invocation_v1"."result_store_identity" is null
          and "fx_system_application_action_invocation_v1"."result_codec_identity" is null
          and "fx_system_application_action_invocation_v1"."result_object_key" is null
          and "fx_system_application_action_invocation_v1"."result_byte_length" is null
          and "fx_system_application_action_invocation_v1"."result_sha256" is null)
      )),
	CONSTRAINT "fx_action_invocation_v1_timestamp_check" CHECK (isfinite("fx_system_application_action_invocation_v1"."admitted_at")
        and isfinite("fx_system_application_action_invocation_v1"."updated_at")
        and "fx_system_application_action_invocation_v1"."updated_at" >= "fx_system_application_action_invocation_v1"."admitted_at"
        and ("fx_system_application_action_invocation_v1"."terminal_at" is null or
          (isfinite("fx_system_application_action_invocation_v1"."terminal_at") and
            "fx_system_application_action_invocation_v1"."terminal_at" >= "fx_system_application_action_invocation_v1"."admitted_at"))
        and ("fx_system_application_action_invocation_v1"."cancellation_requested_at" is null or
          isfinite("fx_system_application_action_invocation_v1"."cancellation_requested_at")))
);
--> statement-breakpoint
CREATE TABLE "fx_system_external_effect_attempt_v1" (
	"scope_id" text NOT NULL,
	"scope_uuid" uuid GENERATED ALWAYS AS (
        case
          when "scope_id" ~ '^scope_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then substring("scope_id" from 7)::uuid
          else null
        end
      ) STORED,
	"subject_kind" text NOT NULL,
	"subject_identity_sha256" "bytea" NOT NULL,
	"subject_fence" bigint NOT NULL,
	"effect_ordinal" bigint NOT NULL,
	"effect_kind" text NOT NULL,
	"stable_effect_key" text NOT NULL,
	"request_identity_sha256" "bytea" NOT NULL,
	"request_store_identity" text,
	"request_codec_identity" text,
	"request_object_key" text,
	"request_byte_length" bigint,
	"request_sha256" "bytea",
	"child_mutation_request_key" text,
	"child_mutation_function_path" text,
	"child_mutation_arguments_sha256" "bytea",
	"state" text NOT NULL,
	"prepared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_declared_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"response_store_identity" text,
	"response_codec_identity" text,
	"response_object_key" text,
	"response_byte_length" bigint,
	"response_sha256" "bytea",
	"child_mutation_outcome_sha256" "bytea",
	"terminal_code" text,
	CONSTRAINT "fx_system_external_effect_attempt_v1_scope_uuid_subject_kind_subject_identity_sha256_subject_fence_effect_ordinal_pk" PRIMARY KEY("scope_uuid","subject_kind","subject_identity_sha256","subject_fence","effect_ordinal"),
	CONSTRAINT "fx_external_effect_attempt_v1_identity_check" CHECK ("fx_system_external_effect_attempt_v1"."subject_kind" in ('direct_action', 'durable_task_attempt')
        and octet_length("fx_system_external_effect_attempt_v1"."subject_identity_sha256") = 32
        and "fx_system_external_effect_attempt_v1"."subject_fence" >= 1
        and "fx_system_external_effect_attempt_v1"."effect_ordinal" >= 1
        and "fx_system_external_effect_attempt_v1"."effect_kind" in ('outbound_http', 'child_mutation')
        and btrim("fx_system_external_effect_attempt_v1"."stable_effect_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_external_effect_attempt_v1"."stable_effect_key", 'UTF8')) <= 2048
        and octet_length("fx_system_external_effect_attempt_v1"."request_identity_sha256") = 32),
	CONSTRAINT "fx_external_effect_attempt_v1_request_check" CHECK ((
        ("fx_system_external_effect_attempt_v1"."effect_kind" = 'outbound_http'
          and "fx_system_external_effect_attempt_v1"."request_store_identity" =
            'flarex.r2/execution-evidence-body/v1'
          and "fx_system_external_effect_attempt_v1"."request_codec_identity" =
            'flarex.codec/canonical-http-request/v1'
          and btrim("fx_system_external_effect_attempt_v1"."request_object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."request_object_key", 'UTF8')) <= 2048
          and "fx_system_external_effect_attempt_v1"."request_byte_length" >= 1
          and octet_length("fx_system_external_effect_attempt_v1"."request_sha256") = 32
          and "fx_system_external_effect_attempt_v1"."child_mutation_request_key" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_function_path" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_arguments_sha256" is null)
        or ("fx_system_external_effect_attempt_v1"."effect_kind" = 'child_mutation'
          and "fx_system_external_effect_attempt_v1"."request_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_object_key" is null
          and "fx_system_external_effect_attempt_v1"."request_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."request_sha256" is null
          and btrim("fx_system_external_effect_attempt_v1"."child_mutation_request_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."child_mutation_request_key", 'UTF8')) <= 2048
          and btrim("fx_system_external_effect_attempt_v1"."child_mutation_function_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."child_mutation_function_path", 'UTF8')) <= 2048
          and octet_length("fx_system_external_effect_attempt_v1"."child_mutation_arguments_sha256") = 32)
      )),
	CONSTRAINT "fx_external_effect_attempt_v1_state_check" CHECK ((
        ("fx_system_external_effect_attempt_v1"."state" = 'prepared'
          and "fx_system_external_effect_attempt_v1"."dispatch_declared_at" is null
          and "fx_system_external_effect_attempt_v1"."settled_at" is null
          and "fx_system_external_effect_attempt_v1"."terminal_code" is null)
        or ("fx_system_external_effect_attempt_v1"."state" = 'failed_before_dispatch'
          and "fx_system_external_effect_attempt_v1"."dispatch_declared_at" is null
          and "fx_system_external_effect_attempt_v1"."settled_at" is not null
          and btrim("fx_system_external_effect_attempt_v1"."terminal_code", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> '')
        or ("fx_system_external_effect_attempt_v1"."state" = 'dispatching'
          and "fx_system_external_effect_attempt_v1"."dispatch_declared_at" is not null
          and "fx_system_external_effect_attempt_v1"."settled_at" is null
          and "fx_system_external_effect_attempt_v1"."terminal_code" is null)
        or ("fx_system_external_effect_attempt_v1"."state" = 'uncertain'
          and "fx_system_external_effect_attempt_v1"."dispatch_declared_at" is not null
          and "fx_system_external_effect_attempt_v1"."settled_at" is not null
          and btrim("fx_system_external_effect_attempt_v1"."terminal_code", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> '')
        or ("fx_system_external_effect_attempt_v1"."state" = 'confirmed'
          and "fx_system_external_effect_attempt_v1"."dispatch_declared_at" is not null
          and "fx_system_external_effect_attempt_v1"."settled_at" is not null
          and "fx_system_external_effect_attempt_v1"."terminal_code" is null)
      )),
	CONSTRAINT "fx_external_effect_attempt_v1_outcome_check" CHECK ((
        ("fx_system_external_effect_attempt_v1"."state" <> 'confirmed'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_object_key" is null
          and "fx_system_external_effect_attempt_v1"."response_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."response_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256" is null)
        or ("fx_system_external_effect_attempt_v1"."state" = 'confirmed'
          and "fx_system_external_effect_attempt_v1"."effect_kind" = 'outbound_http'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" =
            'flarex.r2/execution-evidence-body/v1'
          and "fx_system_external_effect_attempt_v1"."response_codec_identity" =
            'flarex.codec/canonical-http-response/v1'
          and btrim("fx_system_external_effect_attempt_v1"."response_object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_external_effect_attempt_v1"."response_object_key", 'UTF8')) <= 2048
          and "fx_system_external_effect_attempt_v1"."response_byte_length" >= 1
          and octet_length("fx_system_external_effect_attempt_v1"."response_sha256") = 32
          and "fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256" is null)
        or ("fx_system_external_effect_attempt_v1"."state" = 'confirmed'
          and "fx_system_external_effect_attempt_v1"."effect_kind" = 'child_mutation'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_object_key" is null
          and "fx_system_external_effect_attempt_v1"."response_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."response_sha256" is null
          and octet_length("fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256") = 32)
      )),
	CONSTRAINT "fx_external_effect_attempt_v1_timestamp_check" CHECK (isfinite("fx_system_external_effect_attempt_v1"."prepared_at")
        and ("fx_system_external_effect_attempt_v1"."dispatch_declared_at" is null or
          (isfinite("fx_system_external_effect_attempt_v1"."dispatch_declared_at") and
            "fx_system_external_effect_attempt_v1"."dispatch_declared_at" >= "fx_system_external_effect_attempt_v1"."prepared_at"))
        and ("fx_system_external_effect_attempt_v1"."settled_at" is null or
          (isfinite("fx_system_external_effect_attempt_v1"."settled_at") and
            "fx_system_external_effect_attempt_v1"."settled_at" >= "fx_system_external_effect_attempt_v1"."prepared_at")))
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ADD CONSTRAINT "fx_action_invocation_v1_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ADD CONSTRAINT "fx_action_invocation_v1_revision_fk" FOREIGN KEY ("scope_id","candidate_sha256","application_revision_id") REFERENCES "fx_system_application_revision_v1"("scope_id","candidate_sha256","revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_attempt_v1_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;

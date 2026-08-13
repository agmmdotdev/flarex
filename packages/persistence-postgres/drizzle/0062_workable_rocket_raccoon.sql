ALTER TABLE "fx_system_application_action_invocation_v1" DROP CONSTRAINT "fx_action_invocation_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ALTER COLUMN "action_binding_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ALTER COLUMN "application_revision_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ALTER COLUMN "candidate_sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ADD COLUMN "execution_authority_generation" text DEFAULT 'legacy_candidate_bound_v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ADD COLUMN "application_execution_authority_json" jsonb;--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ADD COLUMN "application_execution_authority_canonical_bytes" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ADD COLUMN "application_execution_authority_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ADD CONSTRAINT "fx_action_invocation_v1_execution_authority_check" CHECK ((
        ("fx_system_application_action_invocation_v1"."execution_authority_generation" = 'legacy_candidate_bound_v1'
          and "fx_system_application_action_invocation_v1"."application_revision_id" is not null
          and btrim("fx_system_application_action_invocation_v1"."application_revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and octet_length(convert_to("fx_system_application_action_invocation_v1"."application_revision_id", 'UTF8')) <= 2048
          and "fx_system_application_action_invocation_v1"."candidate_sha256" is not null
          and octet_length("fx_system_application_action_invocation_v1"."candidate_sha256") = 32
          and "fx_system_application_action_invocation_v1"."action_binding_sha256" is not null
          and octet_length("fx_system_application_action_invocation_v1"."action_binding_sha256") = 32
          and "fx_system_application_action_invocation_v1"."application_execution_authority_json" is null
          and "fx_system_application_action_invocation_v1"."application_execution_authority_canonical_bytes" is null
          and "fx_system_application_action_invocation_v1"."application_execution_authority_sha256" is null)
        or
        ("fx_system_application_action_invocation_v1"."execution_authority_generation" = 'application_v1'
          and "fx_system_application_action_invocation_v1"."application_revision_id" is null
          and "fx_system_application_action_invocation_v1"."candidate_sha256" is null
          and "fx_system_application_action_invocation_v1"."action_binding_sha256" is null
          and "fx_system_application_action_invocation_v1"."application_execution_authority_json" is not null
          and jsonb_typeof("fx_system_application_action_invocation_v1"."application_execution_authority_json") = 'object'
          and "fx_system_application_action_invocation_v1"."application_execution_authority_canonical_bytes" is not null
          and octet_length("fx_system_application_action_invocation_v1"."application_execution_authority_canonical_bytes") between 1 and 131072
          and "fx_system_application_action_invocation_v1"."application_execution_authority_sha256" is not null
          and octet_length("fx_system_application_action_invocation_v1"."application_execution_authority_sha256") = 32)
      ));--> statement-breakpoint
ALTER TABLE "fx_system_application_action_invocation_v1" ADD CONSTRAINT "fx_action_invocation_v1_identity_check" CHECK (btrim("fx_system_application_action_invocation_v1"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_action_invocation_v1"."request_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_application_action_invocation_v1"."request_key", 'UTF8')) <= 2048
        and btrim("fx_system_application_action_invocation_v1"."action_function_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_application_action_invocation_v1"."action_function_path", 'UTF8')) <= 2048
        and btrim("fx_system_application_action_invocation_v1"."compatibility_date", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_application_action_invocation_v1"."compatibility_date", 'UTF8')) <= 2048
        and octet_length("fx_system_application_action_invocation_v1"."request_identity_sha256") = 32
        and octet_length("fx_system_application_action_invocation_v1"."execution_identity_sha256") = 32
        and octet_length("fx_system_application_action_invocation_v1"."host_policy_sha256") = 32
        and "fx_system_application_action_invocation_v1"."storage_generation_fence" >= 1);
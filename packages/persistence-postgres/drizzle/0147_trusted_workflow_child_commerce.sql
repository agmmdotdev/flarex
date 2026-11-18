-- Add a separate commerce effect kind and delivery-only eligibility groups. Existing effect rows and committed history are retained.
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "child_commerce_request_key" text;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "child_commerce_command_name" text;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "child_commerce_arguments_sha256" bytea;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "child_commerce_policy_sha256" bytea;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD COLUMN "child_commerce_outcome_sha256" bytea;
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" DROP CONSTRAINT "fx_external_effect_attempt_v1_identity_check";
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_attempt_v1_identity_check" CHECK ("fx_system_external_effect_attempt_v1"."subject_kind" in ('direct_action', 'durable_task_attempt')
        and octet_length("fx_system_external_effect_attempt_v1"."subject_identity_sha256") = 32
        and "fx_system_external_effect_attempt_v1"."subject_fence" >= 1
        and "fx_system_external_effect_attempt_v1"."effect_ordinal" >= 1
        and "fx_system_external_effect_attempt_v1"."effect_kind" in ('outbound_http', 'child_mutation', 'child_commerce')
        and btrim("fx_system_external_effect_attempt_v1"."stable_effect_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_external_effect_attempt_v1"."stable_effect_key", 'UTF8')) <= 2048
        and octet_length("fx_system_external_effect_attempt_v1"."request_identity_sha256") = 32);
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" DROP CONSTRAINT "fx_external_effect_attempt_v1_request_check";
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_attempt_v1_request_check" CHECK ((
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
        or ("fx_system_external_effect_attempt_v1"."effect_kind" = 'child_commerce'
          and "fx_system_external_effect_attempt_v1"."subject_kind" = 'durable_task_attempt'
          and "fx_system_external_effect_attempt_v1"."effect_ordinal" between 1 and 16
          and "fx_system_external_effect_attempt_v1"."request_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."request_object_key" is null
          and "fx_system_external_effect_attempt_v1"."request_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."request_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_request_key" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_function_path" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_arguments_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_commerce_request_key" is not null
          and "fx_system_external_effect_attempt_v1"."child_commerce_request_key" = "fx_system_external_effect_attempt_v1"."stable_effect_key"
          and "fx_system_external_effect_attempt_v1"."child_commerce_command_name" is not null
          and "fx_system_external_effect_attempt_v1"."child_commerce_command_name" ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
          and "fx_system_external_effect_attempt_v1"."child_commerce_arguments_sha256" is not null
          and octet_length("fx_system_external_effect_attempt_v1"."child_commerce_arguments_sha256") = 32
          and "fx_system_external_effect_attempt_v1"."child_commerce_policy_sha256" is not null
          and octet_length("fx_system_external_effect_attempt_v1"."child_commerce_policy_sha256") = 32)
      ));
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" DROP CONSTRAINT "fx_external_effect_attempt_v1_outcome_check";
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_attempt_v1_outcome_check" CHECK ((
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
        or ("fx_system_external_effect_attempt_v1"."state" = 'confirmed'
          and "fx_system_external_effect_attempt_v1"."effect_kind" = 'child_commerce'
          and "fx_system_external_effect_attempt_v1"."response_store_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_codec_identity" is null
          and "fx_system_external_effect_attempt_v1"."response_object_key" is null
          and "fx_system_external_effect_attempt_v1"."response_byte_length" is null
          and "fx_system_external_effect_attempt_v1"."response_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_mutation_outcome_sha256" is null
          and "fx_system_external_effect_attempt_v1"."child_commerce_outcome_sha256" is not null
          and octet_length("fx_system_external_effect_attempt_v1"."child_commerce_outcome_sha256") = 32)
      ));
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_commerce_columns_check" CHECK (
      "fx_system_external_effect_attempt_v1"."effect_kind" = 'child_commerce' or (
        "fx_system_external_effect_attempt_v1"."child_commerce_request_key" is null and "fx_system_external_effect_attempt_v1"."child_commerce_command_name" is null
        and "fx_system_external_effect_attempt_v1"."child_commerce_arguments_sha256" is null and "fx_system_external_effect_attempt_v1"."child_commerce_policy_sha256" is null
        and "fx_system_external_effect_attempt_v1"."child_commerce_outcome_sha256" is null));
--> statement-breakpoint
ALTER TABLE "fx_system_external_effect_attempt_v1" ADD CONSTRAINT "fx_external_effect_commerce_state_check" CHECK (
      "fx_system_external_effect_attempt_v1"."effect_kind" <> 'child_commerce' or (
        ("fx_system_external_effect_attempt_v1"."state" = 'confirmed' and "fx_system_external_effect_attempt_v1"."child_commerce_outcome_sha256" is not null)
        or ("fx_system_external_effect_attempt_v1"."state" <> 'confirmed' and "fx_system_external_effect_attempt_v1"."child_commerce_outcome_sha256" is null)));
--> statement-breakpoint
CREATE UNIQUE INDEX "fx_external_effect_commerce_key_idx" ON "fx_system_external_effect_attempt_v1" ("scope_uuid", "stable_effect_key") WHERE "effect_kind" = 'child_commerce';
--> statement-breakpoint
CREATE TABLE "fx_system_commit_event_eligibility_group" (
  "scope_uuid" uuid NOT NULL,
  "epoch_uuid" uuid NOT NULL,
  "group_id" text NOT NULL,
  "owner_identity" text NOT NULL,
  "policy_revision" text NOT NULL,
  "maximum_commits" integer NOT NULL,
  "member_count" integer NOT NULL DEFAULT 0,
  "state" text NOT NULL,
  "decided_at" timestamp with time zone,
  CONSTRAINT "fx_event_eligibility_group_pk" PRIMARY KEY ("scope_uuid", "epoch_uuid", "group_id"),
  CONSTRAINT "fx_event_eligibility_values_check" CHECK ("fx_system_commit_event_eligibility_group"."group_id" ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$'
    and "fx_system_commit_event_eligibility_group"."owner_identity" ~ '^[0-9a-f]{64}$' and "fx_system_commit_event_eligibility_group"."policy_revision" ~ '^[0-9a-f]{64}$'
    and "fx_system_commit_event_eligibility_group"."maximum_commits" between 1 and 16 and "fx_system_commit_event_eligibility_group"."member_count" between 0 and "fx_system_commit_event_eligibility_group"."maximum_commits"
    and (("fx_system_commit_event_eligibility_group"."state" = 'held' and "fx_system_commit_event_eligibility_group"."decided_at" is null)
      or ("fx_system_commit_event_eligibility_group"."state" in ('released', 'cleared') and "fx_system_commit_event_eligibility_group"."decided_at" is not null and isfinite("fx_system_commit_event_eligibility_group"."decided_at")))),
  CONSTRAINT "fx_event_eligibility_scope_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock" ("scope_uuid") ON DELETE restrict ON UPDATE restrict
);
--> statement-breakpoint
CREATE TABLE "fx_system_commit_event_eligibility_member" (
  "scope_uuid" uuid NOT NULL,
  "epoch_uuid" uuid NOT NULL,
  "commit_seq" bigint NOT NULL,
  "group_id" text NOT NULL,
  CONSTRAINT "fx_event_eligibility_member_pk" PRIMARY KEY ("scope_uuid", "epoch_uuid", "commit_seq", "group_id"),
  CONSTRAINT "fx_event_eligibility_member_group_fk" FOREIGN KEY ("scope_uuid", "epoch_uuid", "group_id") REFERENCES "fx_system_commit_event_eligibility_group" ("scope_uuid", "epoch_uuid", "group_id") ON DELETE restrict ON UPDATE restrict,
  CONSTRAINT "fx_event_eligibility_member_commit_fk" FOREIGN KEY ("scope_uuid", "epoch_uuid", "commit_seq") REFERENCES "fx_system_commit" ("scope_uuid", "epoch_uuid", "commit_seq") ON DELETE restrict ON UPDATE restrict
);
--> statement-breakpoint
CREATE INDEX "fx_event_eligibility_group_members_idx" ON "fx_system_commit_event_eligibility_member" ("scope_uuid", "epoch_uuid", "group_id", "commit_seq");
--> statement-breakpoint
DO $workflow_child_installation$
DECLARE target_schema text := current_schema();
BEGIN
  EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_commit_event_eligibility_group FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_require_active_installation()', target_schema);
  EXECUTE format('CREATE TRIGGER fx_00_installation_admission BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %1$I.fx_system_commit_event_eligibility_member FOR EACH STATEMENT EXECUTE FUNCTION %1$I.fx_require_active_installation()', target_schema);
END;
$workflow_child_installation$;

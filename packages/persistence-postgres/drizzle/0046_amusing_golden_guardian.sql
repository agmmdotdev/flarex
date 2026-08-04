CREATE TABLE "fx_system_durable_task_attempt_identity_v1" (
	"scope_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"run_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"execution_fence" bigint NOT NULL,
	"accepted_run_version" bigint NOT NULL,
	CONSTRAINT "fx_task_attempt_identity_v1_pk" PRIMARY KEY("scope_id","attempt_id"),
	CONSTRAINT "fx_task_attempt_identity_v1_ordinal_unique" UNIQUE("scope_id","run_id","attempt_number"),
	CONSTRAINT "fx_task_attempt_identity_v1_fence_unique" UNIQUE("scope_id","run_id","execution_fence"),
	CONSTRAINT "fx_task_attempt_identity_v1_value_check" CHECK ("fx_system_durable_task_attempt_identity_v1"."attempt_id" ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_attempt_identity_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_attempt_identity_v1"."attempt_number" between 1 and 250
        and "fx_system_durable_task_attempt_identity_v1"."execution_fence" >= 1
        and "fx_system_durable_task_attempt_identity_v1"."accepted_run_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "fx_system_durable_task_definition_revision_v1" (
	"scope_id" text NOT NULL,
	"task_definition_revision_id" text NOT NULL,
	"task_id" text NOT NULL,
	"application_revision_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"binding_codec_version" integer NOT NULL,
	"binding_byte_length" bigint NOT NULL,
	"binding_sha256" "bytea" NOT NULL,
	"binding_bytes" "bytea" NOT NULL,
	"application_revision_task_binding_sha256" "bytea" NOT NULL,
	"canonical_task_manifest_sha256" "bytea" NOT NULL,
	"task_runtime_entry_sha256" "bytea" NOT NULL,
	"task_catalog_sha256" "bytea" NOT NULL,
	"task_entry_root_sha256" "bytea" NOT NULL,
	"task_runtime_projection_sha256" "bytea" NOT NULL,
	"task_runtime_group_manifest_sha256" "bytea" NOT NULL,
	"task_runtime_materialization_spec_sha256" "bytea" NOT NULL,
	"package_sha256" "bytea" NOT NULL,
	"artifact_sha256" "bytea" NOT NULL,
	"source_root_sha256" "bytea" NOT NULL,
	"semantic_root_sha256" "bytea" NOT NULL,
	CONSTRAINT "fx_task_definition_v1_pk" PRIMARY KEY("scope_id","task_definition_revision_id"),
	CONSTRAINT "fx_task_definition_v1_binding_unique" UNIQUE("scope_id","binding_sha256"),
	CONSTRAINT "fx_task_definition_v1_revision_task_unique" UNIQUE("scope_id","candidate_sha256","application_revision_id","task_id"),
	CONSTRAINT "fx_task_definition_v1_identity_check" CHECK ("fx_system_durable_task_definition_revision_v1"."task_definition_revision_id" ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and btrim("fx_system_durable_task_definition_revision_v1"."task_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_durable_task_definition_revision_v1"."task_id", 'UTF8')) between 1 and 255
        and btrim("fx_system_durable_task_definition_revision_v1"."application_revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length(convert_to("fx_system_durable_task_definition_revision_v1"."application_revision_id", 'UTF8')) <= 2048
        and octet_length("fx_system_durable_task_definition_revision_v1"."candidate_sha256") = 32),
	CONSTRAINT "fx_task_definition_v1_binding_check" CHECK ("fx_system_durable_task_definition_revision_v1"."binding_codec_version" = 1
        and "fx_system_durable_task_definition_revision_v1"."binding_byte_length" between 1 and 16777216
        and octet_length("fx_system_durable_task_definition_revision_v1"."binding_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."binding_bytes") = "fx_system_durable_task_definition_revision_v1"."binding_byte_length"),
	CONSTRAINT "fx_task_definition_v1_projection_check" CHECK (octet_length("fx_system_durable_task_definition_revision_v1"."application_revision_task_binding_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."canonical_task_manifest_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."task_runtime_entry_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."task_catalog_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."task_entry_root_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."task_runtime_projection_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."task_runtime_group_manifest_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."task_runtime_materialization_spec_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."package_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."artifact_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."source_root_sha256") = 32
        and octet_length("fx_system_durable_task_definition_revision_v1"."semantic_root_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "fx_system_durable_task_requested_effect_v1" (
	"scope_id" text NOT NULL,
	"run_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"accepted_run_version" bigint NOT NULL,
	"kind" text NOT NULL,
	"payload_codec_version" integer NOT NULL,
	"payload_byte_length" bigint NOT NULL,
	"payload_json" jsonb NOT NULL,
	"not_before_ms" bigint,
	CONSTRAINT "fx_task_requested_effect_v1_pk" PRIMARY KEY("scope_id","run_id","sequence"),
	CONSTRAINT "fx_task_requested_effect_v1_identity_check" CHECK ("fx_system_durable_task_requested_effect_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_requested_effect_v1"."sequence" >= 1
        and "fx_system_durable_task_requested_effect_v1"."accepted_run_version" >= 1),
	CONSTRAINT "fx_task_requested_effect_v1_payload_check" CHECK ("fx_system_durable_task_requested_effect_v1"."payload_codec_version" = 1
        and "fx_system_durable_task_requested_effect_v1"."payload_byte_length" between 1 and 65536
        and jsonb_typeof("fx_system_durable_task_requested_effect_v1"."payload_json") = 'object'),
	CONSTRAINT "fx_task_requested_effect_v1_schedule_check" CHECK ((
        ("fx_system_durable_task_requested_effect_v1"."kind" in ('continue_retry', 'wake_retry', 'wake_lease_expiry')
          and "fx_system_durable_task_requested_effect_v1"."not_before_ms" between 0 and 9007199254740991)
        or ("fx_system_durable_task_requested_effect_v1"."kind" in (
            'dispatch_attempt',
            'request_execution_cancellation',
            'release_queue_ownership',
            'publish_lifecycle_event',
            'notify_current_state',
            'cancel_obsolete_lease_wake'
          ) and "fx_system_durable_task_requested_effect_v1"."not_before_ms" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE "fx_system_durable_task_run_request_v1" (
	"scope_id" text NOT NULL,
	"request_key_codec_version" integer NOT NULL,
	"request_key_sha256" "bytea" NOT NULL,
	"request_codec_version" integer NOT NULL,
	"request_sha256" "bytea" NOT NULL,
	"run_id" text NOT NULL,
	"receipt_version" integer NOT NULL,
	CONSTRAINT "fx_task_run_request_v1_pk" PRIMARY KEY("scope_id","request_key_sha256"),
	CONSTRAINT "fx_task_run_request_v1_run_unique" UNIQUE("scope_id","run_id"),
	CONSTRAINT "fx_task_run_request_v1_identity_check" CHECK ("fx_system_durable_task_run_request_v1"."request_key_codec_version" = 1
        and "fx_system_durable_task_run_request_v1"."request_codec_version" = 1
        and "fx_system_durable_task_run_request_v1"."receipt_version" = 1
        and octet_length("fx_system_durable_task_run_request_v1"."request_key_sha256") = 32
        and octet_length("fx_system_durable_task_run_request_v1"."request_sha256") = 32
        and "fx_system_durable_task_run_request_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
--> statement-breakpoint
CREATE TABLE "fx_system_durable_task_run_v1" (
	"scope_id" text NOT NULL,
	"run_id" text NOT NULL,
	"task_definition_revision_id" text NOT NULL,
	"created_at_ms" bigint NOT NULL,
	"input_codec" text NOT NULL,
	"input_store" text NOT NULL,
	"input_value_codec" text NOT NULL,
	"input_object_key" text NOT NULL,
	"input_byte_length" bigint NOT NULL,
	"input_sha256" "bytea" NOT NULL,
	"input_retention" text NOT NULL,
	"creation_authority_codec_version" integer NOT NULL,
	"creation_authority_byte_length" bigint NOT NULL,
	"creation_authority_sha256" "bytea" NOT NULL,
	"creation_authority_bytes" "bytea" NOT NULL,
	"aggregate_codec_version" integer NOT NULL,
	"aggregate_byte_length" bigint NOT NULL,
	"aggregate_json" jsonb NOT NULL,
	"run_version" bigint NOT NULL,
	"phase" text NOT NULL,
	"due_kind" text,
	"due_at_ms" bigint,
	"current_attempt_id" text,
	"execution_fence_basis" bigint,
	"current_lease_version" bigint,
	"current_lease_expires_at_ms" bigint,
	"cancellation_generation" bigint NOT NULL,
	"requested_effect_sequence" bigint NOT NULL,
	CONSTRAINT "fx_task_run_v1_pk" PRIMARY KEY("scope_id","run_id"),
	CONSTRAINT "fx_task_run_v1_identity_check" CHECK ("fx_system_durable_task_run_v1"."run_id" ~ '^run_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_run_v1"."task_definition_revision_id" ~ '^taskdef_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and "fx_system_durable_task_run_v1"."created_at_ms" between 0 and 9007199254740991),
	CONSTRAINT "fx_task_run_v1_input_check" CHECK ("fx_system_durable_task_run_v1"."input_codec" = 'flarex.task-input-reference.v1'
        and "fx_system_durable_task_run_v1"."input_store" = 'flarex.task-input-object-store.v1'
        and "fx_system_durable_task_run_v1"."input_value_codec" = 'flarex-value/v1'
        and "fx_system_durable_task_run_v1"."input_retention" = 'run_lifetime'
        and "fx_system_durable_task_run_v1"."input_object_key" ~ '^durable-task-input/v1/sha256/[0-9a-f]{64}$'
        and "fx_system_durable_task_run_v1"."input_byte_length" between 1 and 33554432
        and octet_length("fx_system_durable_task_run_v1"."input_sha256") = 32
        and right("fx_system_durable_task_run_v1"."input_object_key", 64) = encode("fx_system_durable_task_run_v1"."input_sha256", 'hex')),
	CONSTRAINT "fx_task_run_v1_authority_check" CHECK ("fx_system_durable_task_run_v1"."creation_authority_codec_version" = 1
        and "fx_system_durable_task_run_v1"."creation_authority_byte_length" between 1 and 16777216
        and octet_length("fx_system_durable_task_run_v1"."creation_authority_sha256") = 32
        and octet_length("fx_system_durable_task_run_v1"."creation_authority_bytes") =
          "fx_system_durable_task_run_v1"."creation_authority_byte_length"),
	CONSTRAINT "fx_task_run_v1_aggregate_check" CHECK ("fx_system_durable_task_run_v1"."aggregate_codec_version" = 1
        and "fx_system_durable_task_run_v1"."aggregate_byte_length" between 1 and 1048576
        and jsonb_typeof("fx_system_durable_task_run_v1"."aggregate_json") = 'object'),
	CONSTRAINT "fx_task_run_v1_projection_counter_check" CHECK ("fx_system_durable_task_run_v1"."run_version" >= 1
        and "fx_system_durable_task_run_v1"."cancellation_generation" >= 0
        and "fx_system_durable_task_run_v1"."requested_effect_sequence" >= 0),
	CONSTRAINT "fx_task_run_v1_projection_shape_check" CHECK ((
        ("fx_system_durable_task_run_v1"."phase" = 'ready'
          and "fx_system_durable_task_run_v1"."due_kind" = 'start_attempt'
          and "fx_system_durable_task_run_v1"."due_at_ms" is not null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is null
          and "fx_system_durable_task_run_v1"."current_lease_version" is null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" is null)
        or ("fx_system_durable_task_run_v1"."phase" = 'retry_waiting'
          and "fx_system_durable_task_run_v1"."due_kind" = 'start_attempt'
          and "fx_system_durable_task_run_v1"."due_at_ms" is not null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is null
          and "fx_system_durable_task_run_v1"."execution_fence_basis" is not null
          and "fx_system_durable_task_run_v1"."current_lease_version" is null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" is null)
        or ("fx_system_durable_task_run_v1"."phase" in ('attempt_granted', 'executing')
          and "fx_system_durable_task_run_v1"."due_kind" = 'handle_lease_expiry'
          and "fx_system_durable_task_run_v1"."due_at_ms" is not null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is not null
          and "fx_system_durable_task_run_v1"."execution_fence_basis" is not null
          and "fx_system_durable_task_run_v1"."current_lease_version" is not null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" = "fx_system_durable_task_run_v1"."due_at_ms")
        or ("fx_system_durable_task_run_v1"."phase" = 'terminal'
          and "fx_system_durable_task_run_v1"."due_kind" is null
          and "fx_system_durable_task_run_v1"."due_at_ms" is null
          and "fx_system_durable_task_run_v1"."current_attempt_id" is null
          and "fx_system_durable_task_run_v1"."execution_fence_basis" is null
          and "fx_system_durable_task_run_v1"."current_lease_version" is null
          and "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" is null)
      )),
	CONSTRAINT "fx_task_run_v1_projection_value_check" CHECK (("fx_system_durable_task_run_v1"."due_at_ms" is null or
          "fx_system_durable_task_run_v1"."due_at_ms" between 0 and 9007199254740991)
        and ("fx_system_durable_task_run_v1"."current_attempt_id" is null or
          "fx_system_durable_task_run_v1"."current_attempt_id" ~ '^attempt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        and ("fx_system_durable_task_run_v1"."execution_fence_basis" is null or
          "fx_system_durable_task_run_v1"."execution_fence_basis" >= 1)
        and ("fx_system_durable_task_run_v1"."current_lease_version" is null or
          "fx_system_durable_task_run_v1"."current_lease_version" >= 1)
        and ("fx_system_durable_task_run_v1"."current_lease_expires_at_ms" is null or
          "fx_system_durable_task_run_v1"."current_lease_expires_at_ms" between 0 and 9007199254740991))
);
--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_attempt_identity_v1" ADD CONSTRAINT "fx_task_attempt_identity_v1_run_fk" FOREIGN KEY ("scope_id","run_id") REFERENCES "fx_system_durable_task_run_v1"("scope_id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_definition_revision_v1" ADD CONSTRAINT "fx_task_definition_v1_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_definition_revision_v1" ADD CONSTRAINT "fx_task_definition_v1_application_revision_fk" FOREIGN KEY ("scope_id","candidate_sha256","application_revision_id") REFERENCES "fx_system_application_revision_v1"("scope_id","candidate_sha256","revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_requested_effect_v1" ADD CONSTRAINT "fx_task_requested_effect_v1_run_fk" FOREIGN KEY ("scope_id","run_id") REFERENCES "fx_system_durable_task_run_v1"("scope_id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_request_v1" ADD CONSTRAINT "fx_task_run_request_v1_run_fk" FOREIGN KEY ("scope_id","run_id") REFERENCES "fx_system_durable_task_run_v1"("scope_id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_durable_task_run_v1" ADD CONSTRAINT "fx_task_run_v1_definition_fk" FOREIGN KEY ("scope_id","task_definition_revision_id") REFERENCES "fx_system_durable_task_definition_revision_v1"("scope_id","task_definition_revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fx_task_requested_effect_v1_kind_idx" ON "fx_system_durable_task_requested_effect_v1" USING btree ("scope_id","kind","run_id","sequence");--> statement-breakpoint
CREATE INDEX "fx_task_run_v1_due_discovery_idx" ON "fx_system_durable_task_run_v1" USING btree ("scope_id","due_kind","due_at_ms","run_id") WHERE "fx_system_durable_task_run_v1"."due_kind" is not null;

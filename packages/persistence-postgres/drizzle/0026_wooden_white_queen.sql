CREATE TABLE "fx_system_snapshot_lease" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"snapshot_epoch_uuid" uuid NOT NULL,
	"snapshot_commit_seq" bigint NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_snapshot_lease_scope_uuid_session_id_pk" PRIMARY KEY("scope_uuid","session_id"),
	CONSTRAINT "fx_system_snapshot_lease_attempt_fence_check" CHECK ("fx_system_snapshot_lease"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_snapshot_lease_commit_seq_check" CHECK ("fx_system_snapshot_lease"."snapshot_commit_seq" >= 0),
	CONSTRAINT "fx_system_snapshot_lease_expiry_check" CHECK (isfinite("fx_system_snapshot_lease"."lease_expires_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_tx_session" (
	"scope_uuid" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"package_id" text NOT NULL,
	"artifact_runtime" text NOT NULL,
	"artifact_id" text NOT NULL,
	"source_package_hash" text NOT NULL,
	"execution_module" text NOT NULL,
	"function_path" text NOT NULL,
	"function_kind" text NOT NULL,
	"schema_version_id" text NOT NULL,
	"policy_version" text NOT NULL,
	"identity_access_policy_sha256" "bytea" NOT NULL,
	"validated_args_json" jsonb NOT NULL,
	"validated_args_value_codec_version" integer NOT NULL,
	"validated_args_canonical_bytes" "bytea" NOT NULL,
	"validated_args_sha256" "bytea" NOT NULL,
	"authorization_grant_id" text NOT NULL,
	"authorization_grant_json" jsonb NOT NULL,
	"authorization_grant_value_codec_version" integer NOT NULL,
	"authorization_grant_canonical_bytes" "bytea" NOT NULL,
	"authorization_grant_sha256" "bytea" NOT NULL,
	"authorization_revocation_epoch" bigint NOT NULL,
	"authorization_grant_expires_at" timestamp with time zone NOT NULL,
	"request_key" text NOT NULL,
	"request_sha256" "bytea" NOT NULL,
	"lifecycle" text NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"protocol_version" integer NOT NULL,
	"hard_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_tx_session_scope_uuid_session_id_pk" PRIMARY KEY("scope_uuid","session_id"),
	CONSTRAINT "fx_system_tx_session_current_attempt_unique" UNIQUE("scope_uuid","session_id","attempt_fence"),
	CONSTRAINT "fx_system_tx_session_generation_check" CHECK ("fx_system_tx_session"."storage_generation" = 'flarexdb_v1'),
	CONSTRAINT "fx_system_tx_session_generation_fence_check" CHECK ("fx_system_tx_session"."storage_generation_fence" >= 1),
	CONSTRAINT "fx_system_tx_session_package_id_check" CHECK (btrim("fx_system_tx_session"."package_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_tx_session_artifact_runtime_check" CHECK ("fx_system_tx_session"."artifact_runtime" = 'dynamic-worker'),
	CONSTRAINT "fx_system_tx_session_artifact_id_check" CHECK ("fx_system_tx_session"."artifact_id" ~ '^artifact_[0-9a-f]{32}$'),
	CONSTRAINT "fx_system_tx_session_source_hash_check" CHECK ("fx_system_tx_session"."source_package_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "fx_system_tx_session_artifact_source_pair_check" CHECK ("fx_system_tx_session"."artifact_id" = 'artifact_' || left("fx_system_tx_session"."source_package_hash", 32)),
	CONSTRAINT "fx_system_tx_session_execution_module_check" CHECK (btrim("fx_system_tx_session"."execution_module", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_tx_session_function_path_check" CHECK (btrim("fx_system_tx_session"."function_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_tx_session_function_kind_check" CHECK ("fx_system_tx_session"."function_kind" = 'mutation'),
	CONSTRAINT "fx_system_tx_session_schema_version_check" CHECK (btrim("fx_system_tx_session"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_tx_session_policy_version_check" CHECK (btrim("fx_system_tx_session"."policy_version", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_tx_session_identity_hash_check" CHECK (octet_length("fx_system_tx_session"."identity_access_policy_sha256") = 32),
	CONSTRAINT "fx_system_tx_session_args_evidence_check" CHECK (
        jsonb_typeof("fx_system_tx_session"."validated_args_json") = 'object'
        and "fx_system_tx_session"."validated_args_value_codec_version" = 1
        and octet_length("fx_system_tx_session"."validated_args_canonical_bytes") > 0
        and octet_length("fx_system_tx_session"."validated_args_sha256") = 32
      ),
	CONSTRAINT "fx_system_tx_session_grant_id_check" CHECK (btrim("fx_system_tx_session"."authorization_grant_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_tx_session_grant_evidence_check" CHECK (
        jsonb_typeof("fx_system_tx_session"."authorization_grant_json") = 'object'
        and "fx_system_tx_session"."authorization_grant_value_codec_version" = 1
        and octet_length("fx_system_tx_session"."authorization_grant_canonical_bytes") > 0
        and octet_length("fx_system_tx_session"."authorization_grant_sha256") = 32
      ),
	CONSTRAINT "fx_system_tx_session_revocation_epoch_check" CHECK ("fx_system_tx_session"."authorization_revocation_epoch" >= 0),
	CONSTRAINT "fx_system_tx_session_request_key_check" CHECK (
        btrim("fx_system_tx_session"."request_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_tx_session"."request_key") <= 1024
      ),
	CONSTRAINT "fx_system_tx_session_request_hash_check" CHECK (octet_length("fx_system_tx_session"."request_sha256") = 32),
	CONSTRAINT "fx_system_tx_session_lifecycle_check" CHECK ("fx_system_tx_session"."lifecycle" in ('created', 'running', 'finishing', 'committing', 'retrying', 'committed', 'aborted', 'expired')),
	CONSTRAINT "fx_system_tx_session_attempt_fence_check" CHECK ("fx_system_tx_session"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_tx_session_protocol_version_check" CHECK ("fx_system_tx_session"."protocol_version" = 1),
	CONSTRAINT "fx_system_tx_session_expiry_check" CHECK (
        isfinite("fx_system_tx_session"."authorization_grant_expires_at")
        and isfinite("fx_system_tx_session"."hard_expires_at")
        and "fx_system_tx_session"."authorization_grant_expires_at" > "fx_system_tx_session"."created_at"
        and "fx_system_tx_session"."hard_expires_at" > "fx_system_tx_session"."created_at"
        and "fx_system_tx_session"."hard_expires_at" <= "fx_system_tx_session"."authorization_grant_expires_at"
      ),
	CONSTRAINT "fx_system_tx_session_timestamp_order_check" CHECK (
        isfinite("fx_system_tx_session"."created_at")
        and isfinite("fx_system_tx_session"."updated_at")
        and "fx_system_tx_session"."updated_at" >= "fx_system_tx_session"."created_at"
      )
);
--> statement-breakpoint
ALTER TABLE "fx_system_snapshot_lease" ADD CONSTRAINT "fx_system_snapshot_lease_current_attempt_fk" FOREIGN KEY ("scope_uuid","session_id","attempt_fence") REFERENCES "fx_system_tx_session"("scope_uuid","session_id","attempt_fence") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD CONSTRAINT "fx_system_tx_session_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fx_system_snapshot_lease_floor_idx" ON "fx_system_snapshot_lease" USING btree ("scope_uuid","snapshot_epoch_uuid","snapshot_commit_seq","lease_expires_at");--> statement-breakpoint
CREATE INDEX "fx_system_snapshot_lease_expiry_idx" ON "fx_system_snapshot_lease" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "fx_system_tx_session_request_lookup_idx" ON "fx_system_tx_session" USING btree ("scope_uuid","request_key");--> statement-breakpoint
CREATE INDEX "fx_system_tx_session_expiry_idx" ON "fx_system_tx_session" USING btree ("hard_expires_at");

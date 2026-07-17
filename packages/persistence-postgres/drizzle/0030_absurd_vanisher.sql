CREATE TABLE "fx_system_idempotency" (
	"scope_uuid" uuid NOT NULL,
	"request_key" text NOT NULL,
	"identity_access_policy_sha256" "bytea" NOT NULL,
	"function_path" text NOT NULL,
	"request_sha256" "bytea" NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"result_state" text NOT NULL,
	"result_value_codec_version" integer,
	"result_semantic_bytes" integer,
	"result_bytes" "bytea",
	"result_sha256" "bytea",
	"result_expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_idempotency_scope_uuid_request_key_pk" PRIMARY KEY("scope_uuid","request_key"),
	CONSTRAINT "fx_system_idempotency_request_key_check" CHECK (
        btrim("fx_system_idempotency"."request_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_idempotency"."request_key") <= 1024
      ),
	CONSTRAINT "fx_system_idempotency_identity_hash_check" CHECK (octet_length("fx_system_idempotency"."identity_access_policy_sha256") = 32),
	CONSTRAINT "fx_system_idempotency_function_path_check" CHECK (btrim("fx_system_idempotency"."function_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_idempotency_request_hash_check" CHECK (octet_length("fx_system_idempotency"."request_sha256") = 32),
	CONSTRAINT "fx_system_idempotency_commit_seq_check" CHECK ("fx_system_idempotency"."commit_seq" >= 1),
	CONSTRAINT "fx_system_idempotency_result_state_check" CHECK ("fx_system_idempotency"."result_state" in ('available', 'expired')),
	CONSTRAINT "fx_system_idempotency_result_evidence_check" CHECK (
        (
          "fx_system_idempotency"."result_state" = 'available'
          and "fx_system_idempotency"."result_value_codec_version" is not null
          and "fx_system_idempotency"."result_value_codec_version" = 1
          and "fx_system_idempotency"."result_semantic_bytes" is not null
          and "fx_system_idempotency"."result_semantic_bytes" between 0 and 16777216
          and "fx_system_idempotency"."result_bytes" is not null
          and octet_length("fx_system_idempotency"."result_bytes") between 1 and 67108864
          and "fx_system_idempotency"."result_sha256" is not null
          and octet_length("fx_system_idempotency"."result_sha256") = 32
          and "fx_system_idempotency"."result_expired_at" is null
        )
        or
        (
          "fx_system_idempotency"."result_state" = 'expired'
          and "fx_system_idempotency"."result_value_codec_version" is null
          and "fx_system_idempotency"."result_semantic_bytes" is null
          and "fx_system_idempotency"."result_bytes" is null
          and "fx_system_idempotency"."result_sha256" is null
          and "fx_system_idempotency"."result_expired_at" is not null
          and isfinite("fx_system_idempotency"."result_expired_at")
          and "fx_system_idempotency"."result_expired_at" >= "fx_system_idempotency"."created_at"
        )
      ),
	CONSTRAINT "fx_system_idempotency_created_at_check" CHECK (isfinite("fx_system_idempotency"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_idempotency" ADD CONSTRAINT "fx_system_idempotency_scope_clock_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fx_system_idempotency_commit_token_idx" ON "fx_system_idempotency" USING btree ("scope_uuid","commit_seq","epoch_uuid");

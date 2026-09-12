ALTER TABLE "fx_system_idempotency" DROP CONSTRAINT "fx_system_idempotency_result_evidence_check";--> statement-breakpoint
ALTER TABLE "fx_system_idempotency" ADD COLUMN "result_encoding" text DEFAULT 'application-value' NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_idempotency" ADD CONSTRAINT "fx_system_idempotency_result_encoding_check" CHECK ("fx_system_idempotency"."result_encoding" in ('application-value', 'json'));--> statement-breakpoint
ALTER TABLE "fx_system_idempotency" ADD CONSTRAINT "fx_system_idempotency_result_evidence_check" CHECK (
        (
          "fx_system_idempotency"."result_state" = 'available'
          and (
            ("fx_system_idempotency"."result_encoding" = 'application-value' and "fx_system_idempotency"."result_value_codec_version" is not null and "fx_system_idempotency"."result_value_codec_version" = 1)
            or ("fx_system_idempotency"."result_encoding" = 'json' and "fx_system_idempotency"."result_value_codec_version" is null
              and "fx_system_idempotency"."result_semantic_bytes" = octet_length("fx_system_idempotency"."result_bytes"))
          )
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
      );
LOCK TABLE "fx_system_tx_session" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_execution_authority_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_args_evidence_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_grant_evidence_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "validated_args_json" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "validated_args_canonical_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "authorization_grant_json" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "authorization_grant_canonical_bytes" DROP NOT NULL;--> statement-breakpoint
UPDATE "fx_system_tx_session" SET
  "validated_args_json" = NULL,
  "validated_args_canonical_bytes" = NULL,
  "authorization_grant_json" = NULL,
  "authorization_grant_canonical_bytes" = NULL,
  "application_execution_authority_json" = NULL,
  "application_execution_authority_canonical_bytes" = NULL
WHERE "lifecycle" IN ('committed', 'aborted', 'expired');--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD CONSTRAINT "fx_system_tx_session_execution_authority_check" CHECK ((
        ("fx_system_tx_session"."execution_authority_generation" = 'legacy_dynamic_worker_v1'
          and "fx_system_tx_session"."package_id" is not null
          and btrim("fx_system_tx_session"."package_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and "fx_system_tx_session"."artifact_runtime" is not null
          and "fx_system_tx_session"."artifact_runtime" = 'dynamic-worker'
          and "fx_system_tx_session"."artifact_id" is not null
          and "fx_system_tx_session"."artifact_id" ~ '^artifact_[0-9a-f]{32}$'
          and "fx_system_tx_session"."source_package_hash" is not null
          and "fx_system_tx_session"."source_package_hash" ~ '^[0-9a-f]{64}$'
          and "fx_system_tx_session"."artifact_id" = 'artifact_' || left("fx_system_tx_session"."source_package_hash", 32)
          and "fx_system_tx_session"."execution_module" is not null
          and btrim("fx_system_tx_session"."execution_module", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
          and "fx_system_tx_session"."application_execution_authority_json" is null
          and "fx_system_tx_session"."application_execution_authority_canonical_bytes" is null
          and "fx_system_tx_session"."application_execution_authority_sha256" is null)
        or
        ("fx_system_tx_session"."execution_authority_generation" = 'application_v1'
          and "fx_system_tx_session"."package_id" is null
          and "fx_system_tx_session"."artifact_runtime" is null
          and "fx_system_tx_session"."artifact_id" is null
          and "fx_system_tx_session"."source_package_hash" is null
          and "fx_system_tx_session"."execution_module" is null
          and (
            ("fx_system_tx_session"."lifecycle" in ('committed', 'aborted', 'expired')
              and "fx_system_tx_session"."application_execution_authority_json" is null
              and "fx_system_tx_session"."application_execution_authority_canonical_bytes" is null)
            or ("fx_system_tx_session"."lifecycle" not in ('committed', 'aborted', 'expired')
              and "fx_system_tx_session"."application_execution_authority_json" is not null
              and jsonb_typeof("fx_system_tx_session"."application_execution_authority_json") = 'object'
              and "fx_system_tx_session"."application_execution_authority_canonical_bytes" is not null
              and octet_length("fx_system_tx_session"."application_execution_authority_canonical_bytes") between 1 and 131072)
          )
          and "fx_system_tx_session"."application_execution_authority_sha256" is not null
          and octet_length("fx_system_tx_session"."application_execution_authority_sha256") = 32)
      ) is true);--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD CONSTRAINT "fx_system_tx_session_args_evidence_check" CHECK ((
        "fx_system_tx_session"."validated_args_value_codec_version" = 1
        and octet_length("fx_system_tx_session"."validated_args_sha256") = 32
        and (
          ("fx_system_tx_session"."lifecycle" in ('committed', 'aborted', 'expired')
            and "fx_system_tx_session"."validated_args_json" is null
            and "fx_system_tx_session"."validated_args_canonical_bytes" is null)
          or ("fx_system_tx_session"."lifecycle" not in ('committed', 'aborted', 'expired')
            and "fx_system_tx_session"."validated_args_json" is not null
            and jsonb_typeof("fx_system_tx_session"."validated_args_json") = 'object'
            and "fx_system_tx_session"."validated_args_canonical_bytes" is not null
            and octet_length("fx_system_tx_session"."validated_args_canonical_bytes") > 0)
        )
      ) is true);--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD CONSTRAINT "fx_system_tx_session_grant_evidence_check" CHECK ((
        "fx_system_tx_session"."authorization_grant_value_codec_version" = 1
        and octet_length("fx_system_tx_session"."authorization_grant_sha256") = 32
        and (
          ("fx_system_tx_session"."lifecycle" in ('committed', 'aborted', 'expired')
            and "fx_system_tx_session"."authorization_grant_json" is null
            and "fx_system_tx_session"."authorization_grant_canonical_bytes" is null)
          or ("fx_system_tx_session"."lifecycle" not in ('committed', 'aborted', 'expired')
            and "fx_system_tx_session"."authorization_grant_json" is not null
            and jsonb_typeof("fx_system_tx_session"."authorization_grant_json") = 'object'
            and "fx_system_tx_session"."authorization_grant_canonical_bytes" is not null
            and octet_length("fx_system_tx_session"."authorization_grant_canonical_bytes") > 0)
        )
      ) is true);

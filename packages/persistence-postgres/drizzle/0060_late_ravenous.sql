ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_package_id_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_artifact_runtime_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_artifact_id_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_source_hash_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_artifact_source_pair_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" DROP CONSTRAINT "fx_system_tx_session_execution_module_check";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "package_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "artifact_runtime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "artifact_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "source_package_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ALTER COLUMN "execution_module" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD COLUMN "execution_authority_generation" text DEFAULT 'legacy_dynamic_worker_v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD COLUMN "application_execution_authority_json" jsonb;--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD COLUMN "application_execution_authority_canonical_bytes" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD COLUMN "application_execution_authority_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_tx_session" ADD CONSTRAINT "fx_system_tx_session_execution_authority_check" CHECK (
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
          and "fx_system_tx_session"."application_execution_authority_json" is not null
          and jsonb_typeof("fx_system_tx_session"."application_execution_authority_json") = 'object'
          and "fx_system_tx_session"."application_execution_authority_canonical_bytes" is not null
          and octet_length("fx_system_tx_session"."application_execution_authority_canonical_bytes") between 1 and 131072
          and "fx_system_tx_session"."application_execution_authority_sha256" is not null
          and octet_length("fx_system_tx_session"."application_execution_authority_sha256") = 32)
      );

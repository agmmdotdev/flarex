ALTER TABLE "fx_system_application_readiness_v1" DROP CONSTRAINT "fx_application_readiness_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD COLUMN "readiness_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD COLUMN "task_runtime_kind" text;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD COLUMN "task_runtime_receipt_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD COLUMN "task_runtime_readiness_basis_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD COLUMN "task_runtime_readiness_basis_bytes" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD CONSTRAINT "fx_application_readiness_v1_task_runtime_fk" FOREIGN KEY ("scope_id","revision_id","task_runtime_receipt_sha256") REFERENCES "public"."fx_system_application_task_runtime_publication_v1"("scope_id","revision_id","receipt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness_v1" ADD CONSTRAINT "fx_application_readiness_v1_identity_check" CHECK (btrim("fx_system_application_readiness_v1"."revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_readiness_v1"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_readiness_v1"."candidate_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_readiness_v1"."analysis_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_readiness_v1"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."manifest_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."publication_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."application_schema_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."function_catalog_sha256") = 32
        and "fx_system_application_readiness_v1"."storage_generation" = 'flarexdb_v1'
        and "fx_system_application_readiness_v1"."storage_generation_fence" >= 1
        and btrim("fx_system_application_readiness_v1"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_readiness_v1"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_readiness_v1"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."schema_binding_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."task_catalog_binding_sha256") = 32
        and btrim("fx_system_application_readiness_v1"."runtime_host_identity", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_readiness_v1"."compatibility_date" ~ '^\d{4}-\d{2}-\d{2}$'
        and octet_length("fx_system_application_readiness_v1"."cold_receipt_set_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."candidate_validation_receipt_sha256") = 32
        and "fx_system_application_readiness_v1"."unique_constraint_status" in ('not_required', 'eligible')
        and octet_length("fx_system_application_readiness_v1"."unique_constraint_eligibility_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."physical_readiness_sha256") = 32
        and (
          ("fx_system_application_readiness_v1"."readiness_version" = 1
            and "fx_system_application_readiness_v1"."task_runtime_kind" is null
            and "fx_system_application_readiness_v1"."task_runtime_receipt_sha256" is null
            and "fx_system_application_readiness_v1"."task_runtime_readiness_basis_sha256" is null
            and "fx_system_application_readiness_v1"."task_runtime_readiness_basis_bytes" is null)
          or
          ("fx_system_application_readiness_v1"."readiness_version" = 2
            and "fx_system_application_readiness_v1"."task_runtime_kind" is not null
            and "fx_system_application_readiness_v1"."task_runtime_kind" in ('empty', 'populated')
            and "fx_system_application_readiness_v1"."task_runtime_receipt_sha256" is not null
            and octet_length("fx_system_application_readiness_v1"."task_runtime_receipt_sha256") = 32
            and "fx_system_application_readiness_v1"."task_runtime_readiness_basis_sha256" is not null
            and octet_length("fx_system_application_readiness_v1"."task_runtime_readiness_basis_sha256") = 32
            and "fx_system_application_readiness_v1"."task_runtime_readiness_basis_bytes" is not null
            and octet_length("fx_system_application_readiness_v1"."task_runtime_readiness_basis_bytes")
              between 1 and 1048576
          )
        )
        and octet_length("fx_system_application_readiness_v1"."readiness_sha256") = 32
        and octet_length("fx_system_application_readiness_v1"."readiness_bytes") between 1 and 16777216);
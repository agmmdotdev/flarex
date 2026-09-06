ALTER TABLE "fx_system_application_readiness" DROP CONSTRAINT "fx_application_readiness_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_readiness" ADD CONSTRAINT "fx_application_readiness_identity_check" CHECK (length("fx_system_application_readiness"."revision_id") between 1 and 256
        and length("fx_system_application_readiness"."deployment_id") between 1 and 1024
        and length("fx_system_application_readiness"."candidate_id") between 1 and 256
        and length("fx_system_application_readiness"."analysis_id") between 1 and 256
        and octet_length("fx_system_application_readiness"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_readiness"."manifest_sha256") = 32
        and octet_length("fx_system_application_readiness"."publication_sha256") = 32
        and octet_length("fx_system_application_readiness"."application_schema_sha256") = 32
        and octet_length("fx_system_application_readiness"."function_catalog_sha256") = 32
        and "fx_system_application_readiness"."storage_generation" = 'flarexdb_v1'
        and "fx_system_application_readiness"."storage_generation_fence" >= 1
        and length("fx_system_application_readiness"."epoch") between 1 and 1024
        and length("fx_system_application_readiness"."schema_version_id") between 1 and 1024
        and octet_length("fx_system_application_readiness"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_readiness"."manifest_schema_binding_sha256") = 32
        and octet_length("fx_system_application_readiness"."bound_publication_sha256") = 32
        and octet_length("fx_system_application_readiness"."task_catalog_binding_sha256") = 32
        and length("fx_system_application_readiness"."runtime_host_identity") between 1 and 1024
        and "fx_system_application_readiness"."compatibility_date" ~ '^\d{4}-\d{2}-\d{2}$'
        and octet_length("fx_system_application_readiness"."cold_receipt_set_sha256") = 32
        and octet_length("fx_system_application_readiness"."candidate_validation_receipt_sha256") = 32
        and "fx_system_application_readiness"."unique_constraint_status" in ('not_required', 'eligible')
        and octet_length("fx_system_application_readiness"."unique_constraint_eligibility_sha256") = 32
        and octet_length("fx_system_application_readiness"."physical_readiness_sha256") = 32
        and "fx_system_application_readiness"."relation_set_codec_version" = 1
        and "fx_system_application_readiness"."relation_frontier_commit_seq" >= 0
        and ("fx_system_application_readiness"."relation_count" between 1 and 1024
          or ("fx_system_application_readiness"."readiness_codec_version" = 3 and "fx_system_application_readiness"."relation_count" = 0))
        and octet_length("fx_system_application_readiness"."relation_set_readiness_sha256") = 32
        and octet_length("fx_system_application_readiness"."relation_set_readiness_bytes") between 1 and 1048576
        and "fx_system_application_readiness"."readiness_codec_version" in (2, 3)
        and octet_length("fx_system_application_readiness"."readiness_sha256") = 32
        and octet_length("fx_system_application_readiness"."readiness_bytes") between 1 and 16777216);
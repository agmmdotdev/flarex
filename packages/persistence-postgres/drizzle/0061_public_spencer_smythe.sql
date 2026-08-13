ALTER TABLE "fx_system_application_task_catalog_v1" DROP CONSTRAINT "fx_application_task_catalog_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_task_catalog_v1" ADD CONSTRAINT "fx_application_task_catalog_v1_identity_check" CHECK (length("fx_system_application_task_catalog_v1"."revision_id") between 1 and 256
        and length("fx_system_application_task_catalog_v1"."candidate_id") between 1 and 256
        and length("fx_system_application_task_catalog_v1"."analysis_id") between 1 and 256
        and length("fx_system_application_task_catalog_v1"."runtime_host_identity") between 1 and 1024
        and "fx_system_application_task_catalog_v1"."compatibility_date" ~ '^\d{4}-\d{2}-\d{2}$'
        and octet_length("fx_system_application_task_catalog_v1"."source_artifact_root_sha256") = 32
        and octet_length("fx_system_application_task_catalog_v1"."publication_sha256") = 32
        and octet_length("fx_system_application_task_catalog_v1"."task_catalog_sha256") = 32
        and octet_length("fx_system_application_task_catalog_v1"."task_catalog_binding_sha256") = 32
        and "fx_system_application_task_catalog_v1"."task_count" between 0 and 4096
        and octet_length("fx_system_application_task_catalog_v1"."binding_bytes") between 1 and 16777216);
CREATE TABLE "fx_system_application_revision_request_v1" (
	"scope_id" text NOT NULL,
	"request_key" text NOT NULL,
	"registration_input_sha256" "bytea" NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"revision_id" text NOT NULL,
	"registered_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_system_application_revision_request_v1_scope_id_request_key_pk" PRIMARY KEY("scope_id","request_key"),
	CONSTRAINT "fx_application_revision_request_v1_key_check" CHECK (btrim("fx_system_application_revision_request_v1"."request_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_revision_request_v1"."request_key") <= 1024),
	CONSTRAINT "fx_application_revision_request_v1_identity_check" CHECK (btrim("fx_system_application_revision_request_v1"."revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_revision_request_v1"."registration_input_sha256") = 32
        and octet_length("fx_system_application_revision_request_v1"."candidate_sha256") = 32),
	CONSTRAINT "fx_application_revision_request_v1_registered_at_check" CHECK (isfinite("fx_system_application_revision_request_v1"."registered_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_revision_v1" (
	"scope_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"revision_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"attempt_sha256" "bytea" NOT NULL,
	"registration_input_sha256" "bytea" NOT NULL,
	"semantic_attempt_identity_sha256" "bytea" NOT NULL,
	"source_codec_identity" text NOT NULL,
	"package_sha256" "bytea" NOT NULL,
	"artifact_runtime_identity" text NOT NULL,
	"artifact_sha256" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"manifest_codec_version" integer NOT NULL,
	"manifest_byte_length" bigint NOT NULL,
	"schema_artifact_sha256" "bytea" NOT NULL,
	"schema_binding_sha256" "bytea" NOT NULL,
	"function_metadata_codec_version" integer NOT NULL,
	"function_metadata_byte_length" bigint NOT NULL,
	"function_metadata_sha256" "bytea" NOT NULL,
	"function_metadata_bytes" "bytea" NOT NULL,
	"validator_root_sha256" "bytea" NOT NULL,
	"declared_handler_set_sha256" "bytea" NOT NULL,
	"registration_root_sha256" "bytea" NOT NULL,
	"registration_frame_count" bigint NOT NULL,
	"registration_frames_byte_length" bigint NOT NULL,
	"registration_frames_bytes" "bytea" NOT NULL,
	"output_manifest_sha256" "bytea" NOT NULL,
	"output_manifest_bytes" "bytea" NOT NULL,
	"next_progress_sha256" "bytea" NOT NULL,
	"next_progress_bytes" "bytea" NOT NULL,
	"receipt_sha256" "bytea" NOT NULL,
	"receipt_bytes" "bytea" NOT NULL,
	"status" text NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_revision_v1_scope_id_candidate_sha256_pk" PRIMARY KEY("scope_id","candidate_sha256"),
	CONSTRAINT "fx_application_revision_v1_revision_id_unique" UNIQUE("revision_id"),
	CONSTRAINT "fx_application_revision_v1_receipt_target_unique" UNIQUE("scope_id","candidate_sha256","revision_id"),
	CONSTRAINT "fx_application_revision_v1_identity_check" CHECK (btrim("fx_system_application_revision_v1"."revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_revision_v1"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_revision_v1"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_revision_v1"."source_codec_identity" =
          'flarex.source-artifact-v2/codec-v1'
        and "fx_system_application_revision_v1"."artifact_runtime_identity" = 'dynamic-worker'
        and octet_length("fx_system_application_revision_v1"."candidate_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."attempt_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."registration_input_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."semantic_attempt_identity_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."package_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."artifact_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."schema_artifact_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."schema_binding_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."function_metadata_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."validator_root_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."declared_handler_set_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."registration_root_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."output_manifest_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."next_progress_sha256") = 32
        and octet_length("fx_system_application_revision_v1"."receipt_sha256") = 32),
	CONSTRAINT "fx_application_revision_v1_evidence_check" CHECK ("fx_system_application_revision_v1"."schema_version" between 1 and 2147483647
        and "fx_system_application_revision_v1"."manifest_codec_version" >= 1
        and "fx_system_application_revision_v1"."manifest_byte_length" >= 1
        and "fx_system_application_revision_v1"."function_metadata_codec_version" >= 1
        and "fx_system_application_revision_v1"."function_metadata_byte_length" >= 1
        and octet_length("fx_system_application_revision_v1"."function_metadata_bytes") =
          "fx_system_application_revision_v1"."function_metadata_byte_length"
        and "fx_system_application_revision_v1"."registration_frame_count" >= 0
        and "fx_system_application_revision_v1"."registration_frames_byte_length" >= 0
        and octet_length("fx_system_application_revision_v1"."registration_frames_bytes") =
          "fx_system_application_revision_v1"."registration_frames_byte_length"
        and octet_length("fx_system_application_revision_v1"."output_manifest_bytes") >= 1
        and octet_length("fx_system_application_revision_v1"."next_progress_bytes") >= 1
        and octet_length("fx_system_application_revision_v1"."receipt_bytes") >= 1),
	CONSTRAINT "fx_application_revision_v1_inactive_check" CHECK ("fx_system_application_revision_v1"."status" = 'inactive'),
	CONSTRAINT "fx_application_revision_v1_registered_at_check" CHECK (isfinite("fx_system_application_revision_v1"."registered_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_revision_request_v1" ADD CONSTRAINT "fx_application_revision_request_v1_revision_fk" FOREIGN KEY ("scope_id","candidate_sha256","revision_id") REFERENCES "public"."fx_system_application_revision_v1"("scope_id","candidate_sha256","revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_revision_v1" ADD CONSTRAINT "fx_application_revision_v1_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "public"."fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_revision_v1" ADD CONSTRAINT "fx_application_revision_v1_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "public"."fx_system_declarative_v2_verifier_attempt_v2"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_revision_v1" ADD CONSTRAINT "fx_application_revision_v1_schema_fk" FOREIGN KEY ("deployment_id","schema_version_id") REFERENCES "public"."fx_control_schema_version"("deployment_id","schema_version_id") ON DELETE restrict ON UPDATE no action;
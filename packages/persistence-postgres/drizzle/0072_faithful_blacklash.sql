CREATE TABLE "fx_system_application_relation_semantic_readiness" (
	"scope_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"application_schema_sha256" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"schema_manifest_sha256" "bytea" NOT NULL,
	"bound_publication_sha256" "bytea" NOT NULL,
	"relation_ordinal" integer NOT NULL,
	"relation_id" integer NOT NULL,
	"source_table_id" integer NOT NULL,
	"target_table_id" integer NOT NULL,
	"semantic_definition_sha256" "bytea" NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"physical_definition_sha256" "bytea" NOT NULL,
	"origin_schema_version_id" text NOT NULL,
	"origin_relation_ordinal" integer NOT NULL,
	"origin_readiness_kind" text NOT NULL,
	"origin_semantic_attempt_fence" bigint,
	"origin_semantic_readiness_sha256" "bytea",
	"physical_origin_schema_version_id" text NOT NULL,
	"physical_origin_relation_ordinal" integer NOT NULL,
	"physical_attempt_fence" bigint NOT NULL,
	"physical_readiness_sha256" "bytea" NOT NULL,
	"physical_frontier_commit_seq" bigint NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"frontier_commit_seq" bigint NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"receipt_codec_version" integer NOT NULL,
	"receipt_bytes" "bytea" NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"source_count" bigint NOT NULL,
	"edge_count" bigint NOT NULL,
	"version_count" bigint NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_app_relation_semantic_readiness_pk" PRIMARY KEY("scope_id","schema_version_id","relation_ordinal","attempt_fence"),
	CONSTRAINT "fx_app_relation_semantic_readiness_origin_unique" UNIQUE("scope_id","schema_version_id","relation_ordinal","attempt_fence","readiness_sha256"),
	CONSTRAINT "fx_app_relation_semantic_readiness_identity_check" CHECK (btrim("fx_system_application_relation_semantic_readiness"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_relation_semantic_readiness"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_relation_semantic_readiness"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_relation_semantic_readiness"."schema_version" between 1 and 2147483647
        and "fx_system_application_relation_semantic_readiness"."relation_ordinal" between 1 and 1024
        and "fx_system_application_relation_semantic_readiness"."relation_id" between 1 and 2147483647
        and "fx_system_application_relation_semantic_readiness"."source_table_id" between 1 and 2147483647
        and "fx_system_application_relation_semantic_readiness"."target_table_id" between 1 and 2147483647
        and "fx_system_application_relation_semantic_readiness"."edge_definition_id" between 1 and 2147483647
        and "fx_system_application_relation_semantic_readiness"."attempt_fence" >= 1),
	CONSTRAINT "fx_app_relation_semantic_readiness_digest_check" CHECK (octet_length("fx_system_application_relation_semantic_readiness"."application_schema_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_readiness"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_readiness"."bound_publication_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_readiness"."semantic_definition_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_readiness"."physical_definition_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_readiness"."physical_readiness_sha256") = 32
        and ("fx_system_application_relation_semantic_readiness"."origin_semantic_readiness_sha256" is null
          or octet_length("fx_system_application_relation_semantic_readiness"."origin_semantic_readiness_sha256") = 32)
        and octet_length("fx_system_application_relation_semantic_readiness"."readiness_sha256") = 32),
	CONSTRAINT "fx_app_relation_semantic_readiness_lineage_check" CHECK (btrim("fx_system_application_relation_semantic_readiness"."origin_schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_relation_semantic_readiness"."origin_relation_ordinal" between 1 and 1024
        and "fx_system_application_relation_semantic_readiness"."origin_schema_version_id" <> "fx_system_application_relation_semantic_readiness"."schema_version_id"
        and btrim("fx_system_application_relation_semantic_readiness"."physical_origin_schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_relation_semantic_readiness"."physical_origin_schema_version_id" <> "fx_system_application_relation_semantic_readiness"."schema_version_id"
        and "fx_system_application_relation_semantic_readiness"."physical_origin_relation_ordinal" between 1 and 1024
        and "fx_system_application_relation_semantic_readiness"."physical_attempt_fence" >= 1
        and (
          ("fx_system_application_relation_semantic_readiness"."origin_readiness_kind" = 'physical'
            and "fx_system_application_relation_semantic_readiness"."origin_semantic_attempt_fence" is null
            and "fx_system_application_relation_semantic_readiness"."origin_semantic_readiness_sha256" is null)
          or ("fx_system_application_relation_semantic_readiness"."origin_readiness_kind" = 'semantic'
            and "fx_system_application_relation_semantic_readiness"."origin_semantic_attempt_fence" is not null
            and "fx_system_application_relation_semantic_readiness"."origin_semantic_attempt_fence" >= 1
            and "fx_system_application_relation_semantic_readiness"."origin_semantic_readiness_sha256" is not null)
        )),
	CONSTRAINT "fx_app_relation_semantic_readiness_authority_check" CHECK ("fx_system_application_relation_semantic_readiness"."storage_generation" = 'flarexdb_v1'
        and "fx_system_application_relation_semantic_readiness"."storage_generation_fence" >= 1
        and btrim("fx_system_application_relation_semantic_readiness"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_relation_semantic_readiness"."physical_frontier_commit_seq" >= 0
        and "fx_system_application_relation_semantic_readiness"."frontier_commit_seq" >= "fx_system_application_relation_semantic_readiness"."physical_frontier_commit_seq"),
	CONSTRAINT "fx_app_relation_semantic_readiness_receipt_check" CHECK ("fx_system_application_relation_semantic_readiness"."receipt_codec_version" = 1
        and octet_length("fx_system_application_relation_semantic_readiness"."receipt_bytes") between 1 and 16384),
	CONSTRAINT "fx_app_relation_semantic_readiness_count_check" CHECK ("fx_system_application_relation_semantic_readiness"."source_count" >= 0
        and "fx_system_application_relation_semantic_readiness"."edge_count" >= 0
        and "fx_system_application_relation_semantic_readiness"."version_count" >= 0),
	CONSTRAINT "fx_app_relation_semantic_readiness_time_check" CHECK (isfinite("fx_system_application_relation_semantic_readiness"."settled_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_relation_semantic_validation" (
	"scope_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"application_schema_sha256" "bytea" NOT NULL,
	"schema_version_id" text NOT NULL,
	"schema_version" integer NOT NULL,
	"schema_manifest_sha256" "bytea" NOT NULL,
	"bound_publication_sha256" "bytea" NOT NULL,
	"relation_ordinal" integer NOT NULL,
	"relation_id" integer NOT NULL,
	"source_table_id" integer NOT NULL,
	"target_table_id" integer NOT NULL,
	"semantic_definition_sha256" "bytea" NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"physical_definition_sha256" "bytea" NOT NULL,
	"origin_schema_version_id" text NOT NULL,
	"origin_relation_ordinal" integer NOT NULL,
	"origin_readiness_kind" text NOT NULL,
	"origin_semantic_attempt_fence" bigint,
	"origin_semantic_readiness_sha256" "bytea",
	"physical_origin_schema_version_id" text NOT NULL,
	"physical_origin_relation_ordinal" integer NOT NULL,
	"physical_attempt_fence" bigint NOT NULL,
	"physical_readiness_sha256" "bytea" NOT NULL,
	"physical_frontier_commit_seq" bigint NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"frontier_commit_seq" bigint NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"lifecycle" text NOT NULL,
	"cursor_codec_version" integer NOT NULL,
	"source_cursor_row_id" "bytea",
	"edge_cursor_source_row_id" "bytea",
	"edge_cursor_target_row_id" "bytea",
	"version_cursor_direction" text,
	"version_cursor_endpoint_row_id" "bytea",
	"validated_source_count" bigint NOT NULL,
	"validated_edge_count" bigint NOT NULL,
	"validated_version_count" bigint NOT NULL,
	"readiness_sha256" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_app_relation_semantic_validation_pk" PRIMARY KEY("scope_id","schema_version_id","relation_ordinal"),
	CONSTRAINT "fx_app_relation_semantic_validation_identity_check" CHECK (btrim("fx_system_application_relation_semantic_validation"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_relation_semantic_validation"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_application_relation_semantic_validation"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_relation_semantic_validation"."schema_version" between 1 and 2147483647
        and "fx_system_application_relation_semantic_validation"."relation_ordinal" between 1 and 1024
        and "fx_system_application_relation_semantic_validation"."relation_id" between 1 and 2147483647
        and "fx_system_application_relation_semantic_validation"."source_table_id" between 1 and 2147483647
        and "fx_system_application_relation_semantic_validation"."target_table_id" between 1 and 2147483647
        and "fx_system_application_relation_semantic_validation"."edge_definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_app_relation_semantic_validation_digest_check" CHECK (octet_length("fx_system_application_relation_semantic_validation"."application_schema_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_validation"."schema_manifest_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_validation"."bound_publication_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_validation"."semantic_definition_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_validation"."physical_definition_sha256") = 32
        and octet_length("fx_system_application_relation_semantic_validation"."physical_readiness_sha256") = 32
        and ("fx_system_application_relation_semantic_validation"."origin_semantic_readiness_sha256" is null
          or octet_length("fx_system_application_relation_semantic_validation"."origin_semantic_readiness_sha256") = 32)
        and ("fx_system_application_relation_semantic_validation"."readiness_sha256" is null
          or octet_length("fx_system_application_relation_semantic_validation"."readiness_sha256") = 32)),
	CONSTRAINT "fx_app_relation_semantic_validation_lineage_check" CHECK (btrim("fx_system_application_relation_semantic_validation"."origin_schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_relation_semantic_validation"."origin_relation_ordinal" between 1 and 1024
        and "fx_system_application_relation_semantic_validation"."origin_schema_version_id" <> "fx_system_application_relation_semantic_validation"."schema_version_id"
        and btrim("fx_system_application_relation_semantic_validation"."physical_origin_schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_relation_semantic_validation"."physical_origin_schema_version_id" <> "fx_system_application_relation_semantic_validation"."schema_version_id"
        and "fx_system_application_relation_semantic_validation"."physical_origin_relation_ordinal" between 1 and 1024
        and "fx_system_application_relation_semantic_validation"."physical_attempt_fence" >= 1
        and (
          ("fx_system_application_relation_semantic_validation"."origin_readiness_kind" = 'physical'
            and "fx_system_application_relation_semantic_validation"."origin_semantic_attempt_fence" is null
            and "fx_system_application_relation_semantic_validation"."origin_semantic_readiness_sha256" is null)
          or ("fx_system_application_relation_semantic_validation"."origin_readiness_kind" = 'semantic'
            and "fx_system_application_relation_semantic_validation"."origin_semantic_attempt_fence" is not null
            and "fx_system_application_relation_semantic_validation"."origin_semantic_attempt_fence" >= 1
            and "fx_system_application_relation_semantic_validation"."origin_semantic_readiness_sha256" is not null)
        )),
	CONSTRAINT "fx_app_relation_semantic_validation_authority_check" CHECK ("fx_system_application_relation_semantic_validation"."storage_generation" = 'flarexdb_v1'
        and "fx_system_application_relation_semantic_validation"."storage_generation_fence" >= 1
        and btrim("fx_system_application_relation_semantic_validation"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_application_relation_semantic_validation"."physical_frontier_commit_seq" >= 0
        and "fx_system_application_relation_semantic_validation"."frontier_commit_seq" >= "fx_system_application_relation_semantic_validation"."physical_frontier_commit_seq"
        and "fx_system_application_relation_semantic_validation"."attempt_fence" >= 1),
	CONSTRAINT "fx_app_relation_semantic_validation_cursor_check" CHECK ("fx_system_application_relation_semantic_validation"."cursor_codec_version" = 1
        and ("fx_system_application_relation_semantic_validation"."source_cursor_row_id" is null
          or octet_length("fx_system_application_relation_semantic_validation"."source_cursor_row_id") = 16)
        and ("fx_system_application_relation_semantic_validation"."edge_cursor_source_row_id" is null
          or octet_length("fx_system_application_relation_semantic_validation"."edge_cursor_source_row_id") = 16)
        and ("fx_system_application_relation_semantic_validation"."edge_cursor_target_row_id" is null
          or octet_length("fx_system_application_relation_semantic_validation"."edge_cursor_target_row_id") = 16)
        and ("fx_system_application_relation_semantic_validation"."edge_cursor_source_row_id" is null)
          = ("fx_system_application_relation_semantic_validation"."edge_cursor_target_row_id" is null)
        and ("fx_system_application_relation_semantic_validation"."version_cursor_direction" is null
          or "fx_system_application_relation_semantic_validation"."version_cursor_direction" in ('incoming', 'outgoing'))
        and ("fx_system_application_relation_semantic_validation"."version_cursor_endpoint_row_id" is null
          or octet_length("fx_system_application_relation_semantic_validation"."version_cursor_endpoint_row_id") = 16)
        and ("fx_system_application_relation_semantic_validation"."version_cursor_direction" is null)
          = ("fx_system_application_relation_semantic_validation"."version_cursor_endpoint_row_id" is null)
        and (
          ("fx_system_application_relation_semantic_validation"."lifecycle" = 'validating_sources'
            and "fx_system_application_relation_semantic_validation"."edge_cursor_source_row_id" is null
            and "fx_system_application_relation_semantic_validation"."version_cursor_direction" is null)
          or ("fx_system_application_relation_semantic_validation"."lifecycle" = 'validating_edges'
            and "fx_system_application_relation_semantic_validation"."source_cursor_row_id" is null
            and "fx_system_application_relation_semantic_validation"."version_cursor_direction" is null)
          or ("fx_system_application_relation_semantic_validation"."lifecycle" = 'validating_versions'
            and "fx_system_application_relation_semantic_validation"."source_cursor_row_id" is null
            and "fx_system_application_relation_semantic_validation"."edge_cursor_source_row_id" is null)
          or ("fx_system_application_relation_semantic_validation"."lifecycle" = 'ready'
            and "fx_system_application_relation_semantic_validation"."source_cursor_row_id" is null
            and "fx_system_application_relation_semantic_validation"."edge_cursor_source_row_id" is null
            and "fx_system_application_relation_semantic_validation"."version_cursor_direction" is null)
        )),
	CONSTRAINT "fx_app_relation_semantic_validation_count_check" CHECK ("fx_system_application_relation_semantic_validation"."validated_source_count" >= 0
        and "fx_system_application_relation_semantic_validation"."validated_edge_count" >= 0
        and "fx_system_application_relation_semantic_validation"."validated_version_count" >= 0
        and ("fx_system_application_relation_semantic_validation"."lifecycle" <> 'validating_sources'
          or ("fx_system_application_relation_semantic_validation"."validated_edge_count" = 0
            and "fx_system_application_relation_semantic_validation"."validated_version_count" = 0))
        and ("fx_system_application_relation_semantic_validation"."lifecycle" <> 'validating_edges'
          or "fx_system_application_relation_semantic_validation"."validated_version_count" = 0)
        and (
          ("fx_system_application_relation_semantic_validation"."lifecycle" = 'ready'
            and "fx_system_application_relation_semantic_validation"."readiness_sha256" is not null)
          or ("fx_system_application_relation_semantic_validation"."lifecycle" <> 'ready'
            and "fx_system_application_relation_semantic_validation"."readiness_sha256" is null)
        )),
	CONSTRAINT "fx_app_relation_semantic_validation_time_check" CHECK (isfinite("fx_system_application_relation_semantic_validation"."created_at") and isfinite("fx_system_application_relation_semantic_validation"."updated_at")
        and "fx_system_application_relation_semantic_validation"."updated_at" >= "fx_system_application_relation_semantic_validation"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_relation_semantic_readiness" ADD CONSTRAINT "fx_app_relation_semantic_readiness_head_fk" FOREIGN KEY ("scope_id","schema_version_id","relation_ordinal") REFERENCES "fx_system_application_relation_semantic_validation"("scope_id","schema_version_id","relation_ordinal") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_relation_semantic_readiness" ADD CONSTRAINT "fx_app_relation_semantic_readiness_physical_fk" FOREIGN KEY ("scope_id","edge_definition_id","physical_attempt_fence") REFERENCES "fx_system_edge_definition_readiness"("scope_id","edge_definition_id","attempt_fence") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_relation_semantic_readiness" ADD CONSTRAINT "fx_app_relation_semantic_readiness_origin_fk" FOREIGN KEY ("scope_id","origin_schema_version_id","origin_relation_ordinal","origin_semantic_attempt_fence","origin_semantic_readiness_sha256") REFERENCES "fx_system_application_relation_semantic_readiness"("scope_id","schema_version_id","relation_ordinal","attempt_fence","readiness_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_relation_semantic_validation" ADD CONSTRAINT "fx_app_relation_semantic_validation_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_relation_semantic_validation" ADD CONSTRAINT "fx_app_relation_semantic_validation_physical_fk" FOREIGN KEY ("scope_id","edge_definition_id","physical_attempt_fence") REFERENCES "fx_system_edge_definition_readiness"("scope_id","edge_definition_id","attempt_fence") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_app_relation_semantic_readiness_digest_unique" ON "fx_system_application_relation_semantic_readiness" USING btree ("scope_id","readiness_sha256");

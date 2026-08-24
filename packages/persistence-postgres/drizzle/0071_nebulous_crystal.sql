CREATE TABLE "fx_system_edge_definition_build" (
	"scope_id" text NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"deployment_id" text NOT NULL,
	"relation_id" integer NOT NULL,
	"source_table_id" integer NOT NULL,
	"target_table_id" integer NOT NULL,
	"semantic_definition_sha256" "bytea" NOT NULL,
	"physical_definition_sha256" "bytea" NOT NULL,
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
	"processed_source_count" bigint NOT NULL,
	"validated_source_count" bigint NOT NULL,
	"validated_edge_count" bigint NOT NULL,
	"validated_version_count" bigint NOT NULL,
	"readiness_sha256" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_edge_definition_build_pk" PRIMARY KEY("scope_id","edge_definition_id"),
	CONSTRAINT "fx_system_edge_definition_build_identity_check" CHECK (btrim("fx_system_edge_definition_build"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_edge_definition_build"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_edge_definition_build"."edge_definition_id" between 1 and 2147483647
        and "fx_system_edge_definition_build"."relation_id" between 1 and 2147483647
        and "fx_system_edge_definition_build"."source_table_id" between 1 and 2147483647
        and "fx_system_edge_definition_build"."target_table_id" between 1 and 2147483647),
	CONSTRAINT "fx_system_edge_definition_build_digest_check" CHECK (octet_length("fx_system_edge_definition_build"."semantic_definition_sha256") = 32
        and octet_length("fx_system_edge_definition_build"."physical_definition_sha256") = 32),
	CONSTRAINT "fx_system_edge_definition_build_authority_check" CHECK ("fx_system_edge_definition_build"."storage_generation" = 'flarexdb_v1'
        and "fx_system_edge_definition_build"."storage_generation_fence" >= 1
        and btrim("fx_system_edge_definition_build"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_edge_definition_build"."frontier_commit_seq" >= 0
        and "fx_system_edge_definition_build"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_edge_definition_build_lifecycle_check" CHECK ("fx_system_edge_definition_build"."lifecycle" in ('cleaning', 'backfilling', 'validating_sources', 'validating_edges', 'validating_versions', 'enabled')),
	CONSTRAINT "fx_system_edge_definition_build_cursor_check" CHECK ("fx_system_edge_definition_build"."cursor_codec_version" = 1
        and ("fx_system_edge_definition_build"."source_cursor_row_id" is null or octet_length("fx_system_edge_definition_build"."source_cursor_row_id") = 16)
        and ("fx_system_edge_definition_build"."edge_cursor_source_row_id" is null or octet_length("fx_system_edge_definition_build"."edge_cursor_source_row_id") = 16)
        and ("fx_system_edge_definition_build"."edge_cursor_target_row_id" is null or octet_length("fx_system_edge_definition_build"."edge_cursor_target_row_id") = 16)
        and ("fx_system_edge_definition_build"."edge_cursor_source_row_id" is null) = ("fx_system_edge_definition_build"."edge_cursor_target_row_id" is null)
        and ("fx_system_edge_definition_build"."version_cursor_direction" is null or "fx_system_edge_definition_build"."version_cursor_direction" in ('incoming', 'outgoing'))
        and ("fx_system_edge_definition_build"."version_cursor_endpoint_row_id" is null or octet_length("fx_system_edge_definition_build"."version_cursor_endpoint_row_id") = 16)
        and ("fx_system_edge_definition_build"."version_cursor_direction" is null) = ("fx_system_edge_definition_build"."version_cursor_endpoint_row_id" is null)
        and (
          ("fx_system_edge_definition_build"."lifecycle" in ('backfilling', 'validating_sources')
            and "fx_system_edge_definition_build"."edge_cursor_source_row_id" is null
            and "fx_system_edge_definition_build"."version_cursor_direction" is null)
          or ("fx_system_edge_definition_build"."lifecycle" = 'validating_edges'
            and "fx_system_edge_definition_build"."source_cursor_row_id" is null
            and "fx_system_edge_definition_build"."version_cursor_direction" is null)
          or ("fx_system_edge_definition_build"."lifecycle" = 'validating_versions'
            and "fx_system_edge_definition_build"."source_cursor_row_id" is null
            and "fx_system_edge_definition_build"."edge_cursor_source_row_id" is null)
          or ("fx_system_edge_definition_build"."lifecycle" in ('cleaning', 'enabled')
            and "fx_system_edge_definition_build"."source_cursor_row_id" is null
            and "fx_system_edge_definition_build"."edge_cursor_source_row_id" is null
            and "fx_system_edge_definition_build"."version_cursor_direction" is null)
        )),
	CONSTRAINT "fx_system_edge_definition_build_count_check" CHECK ("fx_system_edge_definition_build"."processed_source_count" >= 0
        and "fx_system_edge_definition_build"."validated_source_count" >= 0
        and "fx_system_edge_definition_build"."validated_edge_count" >= 0
        and "fx_system_edge_definition_build"."validated_version_count" >= 0
        and (
          ("fx_system_edge_definition_build"."lifecycle" = 'cleaning'
            and "fx_system_edge_definition_build"."processed_source_count" = 0
            and "fx_system_edge_definition_build"."validated_source_count" = 0
            and "fx_system_edge_definition_build"."validated_edge_count" = 0
            and "fx_system_edge_definition_build"."validated_version_count" = 0)
          or ("fx_system_edge_definition_build"."lifecycle" = 'backfilling'
            and "fx_system_edge_definition_build"."validated_source_count" = 0
            and "fx_system_edge_definition_build"."validated_edge_count" = 0
            and "fx_system_edge_definition_build"."validated_version_count" = 0)
          or ("fx_system_edge_definition_build"."lifecycle" = 'validating_sources'
            and "fx_system_edge_definition_build"."validated_source_count" <= "fx_system_edge_definition_build"."processed_source_count"
            and "fx_system_edge_definition_build"."validated_edge_count" = 0
            and "fx_system_edge_definition_build"."validated_version_count" = 0)
          or ("fx_system_edge_definition_build"."lifecycle" = 'validating_edges'
            and "fx_system_edge_definition_build"."validated_source_count" = "fx_system_edge_definition_build"."processed_source_count"
            and "fx_system_edge_definition_build"."validated_version_count" = 0)
          or ("fx_system_edge_definition_build"."lifecycle" in ('validating_versions', 'enabled')
            and "fx_system_edge_definition_build"."validated_source_count" = "fx_system_edge_definition_build"."processed_source_count")
        )
        and (
          ("fx_system_edge_definition_build"."lifecycle" = 'enabled'
            and "fx_system_edge_definition_build"."readiness_sha256" is not null
            and octet_length("fx_system_edge_definition_build"."readiness_sha256") = 32)
          or ("fx_system_edge_definition_build"."lifecycle" <> 'enabled' and "fx_system_edge_definition_build"."readiness_sha256" is null)
        )),
	CONSTRAINT "fx_system_edge_definition_build_time_check" CHECK (isfinite("fx_system_edge_definition_build"."created_at") and isfinite("fx_system_edge_definition_build"."updated_at")
        and "fx_system_edge_definition_build"."updated_at" >= "fx_system_edge_definition_build"."created_at")
);
--> statement-breakpoint
CREATE TABLE "fx_system_edge_definition_readiness" (
	"scope_id" text NOT NULL,
	"edge_definition_id" integer NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"deployment_id" text NOT NULL,
	"relation_id" integer NOT NULL,
	"source_table_id" integer NOT NULL,
	"target_table_id" integer NOT NULL,
	"semantic_definition_sha256" "bytea" NOT NULL,
	"physical_definition_sha256" "bytea" NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"frontier_commit_seq" bigint NOT NULL,
	"receipt_codec_version" integer NOT NULL,
	"receipt_bytes" "bytea" NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"source_count" bigint NOT NULL,
	"edge_count" bigint NOT NULL,
	"version_count" bigint NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_edge_definition_readiness_pk" PRIMARY KEY("scope_id","edge_definition_id","attempt_fence"),
	CONSTRAINT "fx_system_edge_definition_readiness_identity_check" CHECK (btrim("fx_system_edge_definition_readiness"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_edge_definition_readiness"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_edge_definition_readiness"."edge_definition_id" between 1 and 2147483647
        and "fx_system_edge_definition_readiness"."relation_id" between 1 and 2147483647
        and "fx_system_edge_definition_readiness"."source_table_id" between 1 and 2147483647
        and "fx_system_edge_definition_readiness"."target_table_id" between 1 and 2147483647
        and "fx_system_edge_definition_readiness"."attempt_fence" >= 1),
	CONSTRAINT "fx_system_edge_definition_readiness_digest_check" CHECK (octet_length("fx_system_edge_definition_readiness"."semantic_definition_sha256") = 32
        and octet_length("fx_system_edge_definition_readiness"."physical_definition_sha256") = 32
        and octet_length("fx_system_edge_definition_readiness"."readiness_sha256") = 32),
	CONSTRAINT "fx_system_edge_definition_readiness_authority_check" CHECK ("fx_system_edge_definition_readiness"."storage_generation" = 'flarexdb_v1'
        and "fx_system_edge_definition_readiness"."storage_generation_fence" >= 1
        and btrim("fx_system_edge_definition_readiness"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_edge_definition_readiness"."frontier_commit_seq" >= 0),
	CONSTRAINT "fx_system_edge_definition_readiness_receipt_check" CHECK ("fx_system_edge_definition_readiness"."receipt_codec_version" = 1
        and octet_length("fx_system_edge_definition_readiness"."receipt_bytes") between 1 and 16384),
	CONSTRAINT "fx_system_edge_definition_readiness_count_check" CHECK ("fx_system_edge_definition_readiness"."source_count" >= 0
        and "fx_system_edge_definition_readiness"."edge_count" >= 0
        and "fx_system_edge_definition_readiness"."version_count" >= 0),
	CONSTRAINT "fx_system_edge_definition_readiness_time_check" CHECK (isfinite("fx_system_edge_definition_readiness"."settled_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_edge_definition_build" ADD CONSTRAINT "fx_system_edge_definition_build_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_edge_definition_readiness" ADD CONSTRAINT "fx_system_edge_definition_readiness_build_fk" FOREIGN KEY ("scope_id","edge_definition_id") REFERENCES "fx_system_edge_definition_build"("scope_id","edge_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_system_edge_definition_readiness_digest_unique" ON "fx_system_edge_definition_readiness" USING btree ("scope_id","readiness_sha256");

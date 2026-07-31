CREATE TABLE "fx_system_declarative_v2_function_group_entry" (
	"scope_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"function_ordinal" bigint NOT NULL,
	"function_path" text NOT NULL,
	"execution_module" text NOT NULL,
	"export_name" text NOT NULL,
	"handler_kind" text NOT NULL,
	"visibility" text NOT NULL,
	"execution_group" text NOT NULL,
	"projection_sha256" "bytea" NOT NULL,
	"object_store_identity" text NOT NULL,
	"object_codec_identity" text NOT NULL,
	"object_key" text NOT NULL,
	"object_byte_length" bigint NOT NULL,
	"object_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_function_group_entry_scope_id_candidate_sha256_function_ordinal_pk" PRIMARY KEY("scope_id","candidate_sha256","function_ordinal"),
	CONSTRAINT "fx_dv2_function_group_entry_ordinal_check" CHECK ("fx_system_declarative_v2_function_group_entry"."function_ordinal" >= 0),
	CONSTRAINT "fx_dv2_function_group_entry_authority_check" CHECK (btrim("fx_system_declarative_v2_function_group_entry"."function_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_declarative_v2_function_group_entry"."execution_module", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and btrim("fx_system_declarative_v2_function_group_entry"."export_name", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_function_group_entry"."handler_kind" in ('query', 'mutation', 'workflowMutation', 'action')
        and "fx_system_declarative_v2_function_group_entry"."visibility" in ('public', 'internal')
        and "fx_system_declarative_v2_function_group_entry"."execution_group" in ('transaction', 'edge_action')
        and octet_length("fx_system_declarative_v2_function_group_entry"."projection_sha256") = 32
        and "fx_system_declarative_v2_function_group_entry"."object_store_identity" = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and "fx_system_declarative_v2_function_group_entry"."object_codec_identity" = 'flarex.declarative-v2/function-group-manifest/v1'
        and btrim("fx_system_declarative_v2_function_group_entry"."object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_function_group_entry"."object_byte_length" >= 1
        and octet_length("fx_system_declarative_v2_function_group_entry"."object_sha256") = 32),
	CONSTRAINT "fx_dv2_function_group_entry_created_check" CHECK (isfinite("fx_system_declarative_v2_function_group_entry"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_function_group_manifest" (
	"scope_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"projection_set_object_store_identity" text NOT NULL,
	"projection_set_object_codec_identity" text NOT NULL,
	"projection_set_object_key" text NOT NULL,
	"projection_set_object_byte_length" bigint NOT NULL,
	"projection_set_sha256" "bytea" NOT NULL,
	"manifest_object_store_identity" text NOT NULL,
	"manifest_object_codec_identity" text NOT NULL,
	"manifest_object_key" text NOT NULL,
	"manifest_object_byte_length" bigint NOT NULL,
	"manifest_sha256" "bytea" NOT NULL,
	"function_count" bigint NOT NULL,
	"function_root_sha256" "bytea" NOT NULL,
	"validator_root_sha256" "bytea" NOT NULL,
	"declared_handler_set_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_function_group_manifest_scope_id_candidate_sha256_pk" PRIMARY KEY("scope_id","candidate_sha256"),
	CONSTRAINT "fx_dv2_function_group_manifest_projection_set_check" CHECK ("fx_system_declarative_v2_function_group_manifest"."projection_set_object_store_identity" = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and "fx_system_declarative_v2_function_group_manifest"."projection_set_object_codec_identity" = 'flarex.declarative-v2/runtime-projection/v1'
        and btrim("fx_system_declarative_v2_function_group_manifest"."projection_set_object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_function_group_manifest"."projection_set_object_byte_length" >= 1
        and octet_length("fx_system_declarative_v2_function_group_manifest"."projection_set_sha256") = 32
        and "fx_system_declarative_v2_function_group_manifest"."manifest_object_store_identity" = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and "fx_system_declarative_v2_function_group_manifest"."manifest_object_codec_identity" = 'flarex.declarative-v2/function-group-manifest/v1'
        and btrim("fx_system_declarative_v2_function_group_manifest"."manifest_object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_function_group_manifest"."manifest_object_byte_length" >= 1
        and octet_length("fx_system_declarative_v2_function_group_manifest"."manifest_sha256") = 32),
	CONSTRAINT "fx_dv2_function_group_manifest_authority_check" CHECK ("fx_system_declarative_v2_function_group_manifest"."function_count" >= 0
        and octet_length("fx_system_declarative_v2_function_group_manifest"."function_root_sha256") = 32
        and octet_length("fx_system_declarative_v2_function_group_manifest"."validator_root_sha256") = 32
        and octet_length("fx_system_declarative_v2_function_group_manifest"."declared_handler_set_sha256") = 32),
	CONSTRAINT "fx_dv2_function_group_manifest_created_check" CHECK (isfinite("fx_system_declarative_v2_function_group_manifest"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_runtime_projection_module" (
	"scope_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"execution_group" text NOT NULL,
	"module_ordinal" bigint NOT NULL,
	"module_path" text NOT NULL,
	"roles" bigint NOT NULL,
	"source_byte_length" bigint NOT NULL,
	"source_sha256" "bytea" NOT NULL,
	"object_store_identity" text NOT NULL,
	"object_codec_identity" text NOT NULL,
	"object_key" text NOT NULL,
	"object_byte_length" bigint NOT NULL,
	"object_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_runtime_projection_module_scope_id_candidate_sha256_execution_group_module_ordinal_pk" PRIMARY KEY("scope_id","candidate_sha256","execution_group","module_ordinal"),
	CONSTRAINT "fx_dv2_runtime_module_ordinal_check" CHECK ("fx_system_declarative_v2_runtime_projection_module"."module_ordinal" >= 0),
	CONSTRAINT "fx_dv2_runtime_module_authority_check" CHECK (btrim("fx_system_declarative_v2_runtime_projection_module"."module_path", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_runtime_projection_module"."roles" >= 0
        and "fx_system_declarative_v2_runtime_projection_module"."source_byte_length" >= 1
        and octet_length("fx_system_declarative_v2_runtime_projection_module"."source_sha256") = 32
        and "fx_system_declarative_v2_runtime_projection_module"."object_store_identity" = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and "fx_system_declarative_v2_runtime_projection_module"."object_codec_identity" = 'flarex.declarative-v2/runtime-projection/v1'
        and btrim("fx_system_declarative_v2_runtime_projection_module"."object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_runtime_projection_module"."object_byte_length" >= 1
        and octet_length("fx_system_declarative_v2_runtime_projection_module"."object_sha256") = 32),
	CONSTRAINT "fx_dv2_runtime_module_created_check" CHECK (isfinite("fx_system_declarative_v2_runtime_projection_module"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_declarative_v2_runtime_projection" (
	"scope_id" text NOT NULL,
	"candidate_sha256" "bytea" NOT NULL,
	"execution_group" text NOT NULL,
	"execution_module" text NOT NULL,
	"module_count" bigint NOT NULL,
	"raw_byte_length" bigint NOT NULL,
	"module_root_sha256" "bytea" NOT NULL,
	"object_store_identity" text NOT NULL,
	"object_codec_identity" text NOT NULL,
	"object_key" text NOT NULL,
	"object_byte_length" bigint NOT NULL,
	"object_sha256" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_declarative_v2_runtime_projection_scope_id_candidate_sha256_execution_group_pk" PRIMARY KEY("scope_id","candidate_sha256","execution_group"),
	CONSTRAINT "fx_dv2_runtime_projection_group_check" CHECK ("fx_system_declarative_v2_runtime_projection"."execution_group" in ('transaction', 'edge_action')),
	CONSTRAINT "fx_dv2_runtime_projection_authority_check" CHECK (btrim("fx_system_declarative_v2_runtime_projection"."execution_module", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_runtime_projection"."module_count" >= 1
        and "fx_system_declarative_v2_runtime_projection"."raw_byte_length" >= 1
        and octet_length("fx_system_declarative_v2_runtime_projection"."module_root_sha256") = 32
        and "fx_system_declarative_v2_runtime_projection"."object_store_identity" = 'flarex.r2/declarative-v2-runtime-artifact/v1'
        and "fx_system_declarative_v2_runtime_projection"."object_codec_identity" = 'flarex.declarative-v2/runtime-projection/v1'
        and btrim("fx_system_declarative_v2_runtime_projection"."object_key", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_runtime_projection"."object_byte_length" >= 1
        and octet_length("fx_system_declarative_v2_runtime_projection"."object_sha256") = 32),
	CONSTRAINT "fx_dv2_runtime_projection_created_check" CHECK (isfinite("fx_system_declarative_v2_runtime_projection"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_function_group_entry" ADD CONSTRAINT "fx_dv2_function_group_entry_manifest_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "fx_system_declarative_v2_function_group_manifest"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_function_group_manifest" ADD CONSTRAINT "fx_dv2_function_group_manifest_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_runtime_projection_module" ADD CONSTRAINT "fx_dv2_runtime_module_projection_fk" FOREIGN KEY ("scope_id","candidate_sha256","execution_group") REFERENCES "fx_system_declarative_v2_runtime_projection"("scope_id","candidate_sha256","execution_group") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_runtime_projection" ADD CONSTRAINT "fx_dv2_runtime_projection_candidate_fk" FOREIGN KEY ("scope_id","candidate_sha256") REFERENCES "fx_system_declarative_v2_candidate"("scope_id","candidate_sha256") ON DELETE restrict ON UPDATE no action;

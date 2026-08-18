CREATE TABLE "fx_system_physical_definition_lifecycle" (
	"scope_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"definition_kind" text NOT NULL,
	"definition_id" integer NOT NULL,
	"lifecycle" text NOT NULL,
	"transition_fence" bigint NOT NULL,
	"physical_spec_sha256" "bytea" NOT NULL,
	"request_codec_version" integer NOT NULL,
	"request_sha256" "bytea" NOT NULL,
	"storage_generation" text NOT NULL,
	"storage_generation_fence" bigint NOT NULL,
	"epoch" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_physical_definition_lifecycle_pk" PRIMARY KEY("scope_id","definition_kind","definition_id"),
	CONSTRAINT "fx_system_physical_definition_lifecycle_scope_check" CHECK (btrim("fx_system_physical_definition_lifecycle"."scope_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_physical_definition_lifecycle_deployment_check" CHECK (btrim("fx_system_physical_definition_lifecycle"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_physical_definition_lifecycle_kind_check" CHECK ("fx_system_physical_definition_lifecycle"."definition_kind" in ('index', 'unique_constraint')),
	CONSTRAINT "fx_system_physical_definition_lifecycle_definition_check" CHECK ("fx_system_physical_definition_lifecycle"."definition_id" between 1 and 2147483647),
	CONSTRAINT "fx_system_physical_definition_lifecycle_state_check" CHECK ("fx_system_physical_definition_lifecycle"."lifecycle" in ('active', 'draining', 'retired', 'reactivating')),
	CONSTRAINT "fx_system_physical_definition_lifecycle_fence_check" CHECK ("fx_system_physical_definition_lifecycle"."transition_fence" >= 1),
	CONSTRAINT "fx_system_physical_definition_lifecycle_digest_check" CHECK (octet_length("fx_system_physical_definition_lifecycle"."physical_spec_sha256") = 32
        and "fx_system_physical_definition_lifecycle"."request_codec_version" = 1
        and octet_length("fx_system_physical_definition_lifecycle"."request_sha256") = 32),
	CONSTRAINT "fx_system_physical_definition_lifecycle_authority_check" CHECK ("fx_system_physical_definition_lifecycle"."storage_generation" = 'flarexdb_v1'
        and "fx_system_physical_definition_lifecycle"."storage_generation_fence" >= 1
        and btrim("fx_system_physical_definition_lifecycle"."epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_system_physical_definition_lifecycle_time_check" CHECK (isfinite("fx_system_physical_definition_lifecycle"."created_at") and isfinite("fx_system_physical_definition_lifecycle"."updated_at")
        and "fx_system_physical_definition_lifecycle"."updated_at" >= "fx_system_physical_definition_lifecycle"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fx_system_physical_definition_lifecycle" ADD CONSTRAINT "fx_system_physical_definition_lifecycle_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "fx_control_schema_index_binding_definition_lookup_idx" ON "fx_control_schema_version_index_binding" USING btree ("deployment_id","index_definition_id","schema_version_id");
--> statement-breakpoint
CREATE INDEX "fx_control_schema_unique_binding_definition_lookup_idx" ON "fx_control_schema_version_unique_constraint_binding" USING btree ("deployment_id","unique_constraint_definition_id","schema_version_id");

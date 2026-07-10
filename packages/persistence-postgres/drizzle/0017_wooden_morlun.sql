CREATE TABLE "fx_control_scope" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"active_schema_version_id" text,
	"isolation_kind" text NOT NULL,
	"physical_locator_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_scope_deployment_id_unique" UNIQUE("deployment_id"),
	CONSTRAINT "fx_control_scope_id_deployment_id_unique" UNIQUE("id","deployment_id"),
	CONSTRAINT "fx_control_scope_id_non_empty_check" CHECK (btrim("fx_control_scope"."id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_scope_active_schema_version_id_non_empty_check" CHECK ("fx_control_scope"."active_schema_version_id" is null or btrim("fx_control_scope"."active_schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_scope_isolation_kind_check" CHECK ("fx_control_scope"."isolation_kind" in ('shared_database', 'schema_per_scope', 'database_per_scope')),
	CONSTRAINT "fx_control_scope_physical_locator_check" CHECK (
        jsonb_typeof("fx_control_scope"."physical_locator_json") = 'object'
        and "fx_control_scope"."physical_locator_json" ? 'kind'
        and "fx_control_scope"."physical_locator_json" ? 'databaseKey'
        and "fx_control_scope"."physical_locator_json" ? 'schemaName'
        and ("fx_control_scope"."physical_locator_json" - 'kind' - 'databaseKey' - 'schemaName') = '{}'::jsonb
        and jsonb_typeof("fx_control_scope"."physical_locator_json" -> 'kind') = 'string'
        and "fx_control_scope"."physical_locator_json" ->> 'kind' = "fx_control_scope"."isolation_kind"
        and jsonb_typeof("fx_control_scope"."physical_locator_json" -> 'databaseKey') = 'string'
        and btrim("fx_control_scope"."physical_locator_json" ->> 'databaseKey', U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and jsonb_typeof("fx_control_scope"."physical_locator_json" -> 'schemaName') = 'string'
        and btrim("fx_control_scope"."physical_locator_json" ->> 'schemaName', U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
      )
);
--> statement-breakpoint
ALTER TABLE "fx_control_scope" ADD CONSTRAINT "fx_control_scope_deployment_id_deployments_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("deployment_id") ON DELETE restrict ON UPDATE no action;

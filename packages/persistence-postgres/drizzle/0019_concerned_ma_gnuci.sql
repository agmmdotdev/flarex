CREATE TABLE "fx_control_scope_provisioning" (
	"scope_id" text PRIMARY KEY NOT NULL,
	"protocol_version" text NOT NULL,
	"state" text NOT NULL,
	"physical_locator_json" jsonb NOT NULL,
	"initial_epoch" text NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	CONSTRAINT "fx_control_scope_provisioning_protocol_version_check" CHECK ("fx_control_scope_provisioning"."protocol_version" = 'split_scope_authority_v1'),
	CONSTRAINT "fx_control_scope_provisioning_state_check" CHECK ("fx_control_scope_provisioning"."state" in ('reserved', 'ready')),
	CONSTRAINT "fx_control_scope_provisioning_physical_locator_check" CHECK (
        jsonb_typeof("fx_control_scope_provisioning"."physical_locator_json") = 'object'
        and "fx_control_scope_provisioning"."physical_locator_json" ? 'kind'
        and "fx_control_scope_provisioning"."physical_locator_json" ? 'databaseKey'
        and "fx_control_scope_provisioning"."physical_locator_json" ? 'schemaName'
        and ("fx_control_scope_provisioning"."physical_locator_json" - 'kind' - 'databaseKey' - 'schemaName') = '{}'::jsonb
        and jsonb_typeof("fx_control_scope_provisioning"."physical_locator_json" -> 'kind') = 'string'
        and "fx_control_scope_provisioning"."physical_locator_json" ->> 'kind' in ('schema_per_scope', 'database_per_scope')
        and jsonb_typeof("fx_control_scope_provisioning"."physical_locator_json" -> 'databaseKey') = 'string'
        and btrim("fx_control_scope_provisioning"."physical_locator_json" ->> 'databaseKey', U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and jsonb_typeof("fx_control_scope_provisioning"."physical_locator_json" -> 'schemaName') = 'string'
        and btrim("fx_control_scope_provisioning"."physical_locator_json" ->> 'schemaName', U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
      ),
	CONSTRAINT "fx_control_scope_provisioning_initial_epoch_non_empty_check" CHECK (btrim("fx_control_scope_provisioning"."initial_epoch", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_scope_provisioning_state_ready_at_check" CHECK (
        ("fx_control_scope_provisioning"."state" = 'reserved' and "fx_control_scope_provisioning"."ready_at" is null)
        or ("fx_control_scope_provisioning"."state" = 'ready' and "fx_control_scope_provisioning"."ready_at" is not null)
      ),
	CONSTRAINT "fx_control_scope_provisioning_ready_at_order_check" CHECK ("fx_control_scope_provisioning"."ready_at" is null or "fx_control_scope_provisioning"."ready_at" >= "fx_control_scope_provisioning"."reserved_at")
);
--> statement-breakpoint
ALTER TABLE "fx_control_scope_provisioning" ADD CONSTRAINT "fx_control_scope_provisioning_scope_id_fx_control_scope_id_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_control_scope"("id") ON DELETE restrict ON UPDATE no action;

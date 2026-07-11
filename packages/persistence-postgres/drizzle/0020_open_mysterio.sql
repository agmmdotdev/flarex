CREATE TABLE "fx_control_table" (
	"deployment_id" text NOT NULL,
	"table_id" integer NOT NULL,
	"namespace" text NOT NULL,
	"logical_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_table_deployment_id_table_id_pk" PRIMARY KEY("deployment_id","table_id"),
	CONSTRAINT "fx_control_table_deployment_namespace_name_unique" UNIQUE("deployment_id","namespace","logical_name"),
	CONSTRAINT "fx_control_table_deployment_id_non_empty_check" CHECK (btrim("fx_control_table"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_table_table_id_positive_check" CHECK ("fx_control_table"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_table_namespace_check" CHECK ("fx_control_table"."namespace" in ('app', 'payload', 'medusa', 'system')),
	CONSTRAINT "fx_control_table_logical_name_non_empty_check" CHECK (btrim("fx_control_table"."logical_name", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> '')
);
--> statement-breakpoint
ALTER TABLE "fx_control_table" ADD CONSTRAINT "fx_control_table_deployment_id_deployments_deployment_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("deployment_id") ON DELETE restrict ON UPDATE no action;

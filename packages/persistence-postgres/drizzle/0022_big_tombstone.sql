CREATE TABLE "fx_control_index" (
	"deployment_id" text NOT NULL,
	"logical_index_id" integer NOT NULL,
	"table_id" integer NOT NULL,
	"descriptor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_control_index_deployment_id_logical_index_id_pk" PRIMARY KEY("deployment_id","logical_index_id"),
	CONSTRAINT "fx_control_index_deployment_table_descriptor_unique" UNIQUE("deployment_id","table_id","descriptor"),
	CONSTRAINT "fx_control_index_deployment_id_non_empty_check" CHECK (btrim("fx_control_index"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''),
	CONSTRAINT "fx_control_index_logical_index_id_positive_check" CHECK ("fx_control_index"."logical_index_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_index_table_id_positive_check" CHECK ("fx_control_index"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_control_index_descriptor_non_empty_check" CHECK (btrim("fx_control_index"."descriptor", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> '')
);
--> statement-breakpoint
ALTER TABLE "fx_control_index" ADD CONSTRAINT "fx_control_index_deployment_table_fk" FOREIGN KEY ("deployment_id","table_id") REFERENCES "fx_control_table"("deployment_id","table_id") ON DELETE restrict ON UPDATE no action;

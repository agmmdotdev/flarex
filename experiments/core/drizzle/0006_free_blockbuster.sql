ALTER TABLE "fx_core"."commands" DROP CONSTRAINT "commands_table_definitions_table_fk";
--> statement-breakpoint
ALTER TABLE "fx_core"."commands" ADD COLUMN "definitions" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_core"."commands" DROP COLUMN "table";--> statement-breakpoint
ALTER TABLE "fx_core"."commands" DROP COLUMN "version";
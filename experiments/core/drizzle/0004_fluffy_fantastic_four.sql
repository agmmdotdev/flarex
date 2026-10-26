ALTER TABLE "fx_core"."definitions" ADD COLUMN "tableId" integer;--> statement-breakpoint
ALTER TABLE "fx_core"."definitions" ADD CONSTRAINT "definitions_tableId_unique" UNIQUE("tableId");
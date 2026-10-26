DROP INDEX "fx_core"."index_selection";--> statement-breakpoint
ALTER TABLE "fx_core"."index_versions" ADD COLUMN "creationTime" double precision NOT NULL;--> statement-breakpoint
CREATE INDEX "index_selection" ON "fx_core"."index_versions" USING btree ("scope","table","index","key","creationTime","id","fromSeq");
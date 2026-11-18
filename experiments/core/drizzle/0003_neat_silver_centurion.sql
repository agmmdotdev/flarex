CREATE TABLE "fx_core"."index_versions" (
	"scope" text NOT NULL,
	"table" text NOT NULL,
	"index" text NOT NULL,
	"id" text NOT NULL,
	"key" double precision NOT NULL,
	"fromSeq" bigint NOT NULL,
	"untilSeq" bigint,
	CONSTRAINT "index_versions_scope_table_index_id_fromSeq_pk" PRIMARY KEY("scope","table","index","id","fromSeq")
);
--> statement-breakpoint
ALTER TABLE "fx_core"."event_intents" ALTER COLUMN "body" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_core"."history" ALTER COLUMN "body" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_core"."authorities" ADD COLUMN "retainedFrom" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_core"."commands" ADD COLUMN "profile" text DEFAULT 'framework' NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_core"."definitions" ADD COLUMN "indexes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_core"."index_versions" ADD CONSTRAINT "index_versions_scope_table_id_fromSeq_history_scope_table_id_commitSeq_fk" FOREIGN KEY ("scope","table","id","fromSeq") REFERENCES "fx_core"."history"("scope","table","id","commitSeq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_selection" ON "fx_core"."index_versions" USING btree ("scope","table","index","key","id","fromSeq");--> statement-breakpoint
CREATE INDEX "index_invalidations" ON "fx_core"."index_versions" USING btree ("scope","table","index","fromSeq","untilSeq");--> statement-breakpoint
CREATE INDEX "history_conflicts" ON "fx_core"."history" USING btree ("scope","table","commitSeq","id");
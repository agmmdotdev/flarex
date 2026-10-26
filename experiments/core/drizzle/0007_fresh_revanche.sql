CREATE TABLE "fx_core"."equality_versions" (
	"scope" text NOT NULL,
	"table" text NOT NULL,
	"index" text NOT NULL,
	"id" text NOT NULL,
	"hash" text NOT NULL,
	"key" text NOT NULL,
	"fromSeq" bigint NOT NULL,
	"untilSeq" bigint,
	CONSTRAINT "equality_versions_scope_table_index_id_fromSeq_pk" PRIMARY KEY("scope","table","index","id","fromSeq")
);
--> statement-breakpoint
ALTER TABLE "fx_core"."definitions" ADD COLUMN "equalities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_core"."equality_versions" ADD CONSTRAINT "equality_versions_scope_table_id_fromSeq_history_scope_table_id_commitSeq_fk" FOREIGN KEY ("scope","table","id","fromSeq") REFERENCES "fx_core"."history"("scope","table","id","commitSeq") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equality_selection" ON "fx_core"."equality_versions" USING btree ("scope","table","index","hash","id","fromSeq");--> statement-breakpoint
CREATE INDEX "equality_invalidations" ON "fx_core"."equality_versions" USING btree ("scope","table","index","hash","fromSeq","untilSeq");
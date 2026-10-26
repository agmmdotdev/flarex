ALTER TABLE "fx_core"."definitions" ADD COLUMN "readLock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_core"."grants" ADD COLUMN "readLock" boolean DEFAULT false NOT NULL;
CREATE TABLE "invoke_session_table_reads" (
	"deployment_id" text NOT NULL,
	"session_id" text NOT NULL,
	"table_id" bigint NOT NULL,
	"observed_ts" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoke_session_table_reads_deployment_id_session_id_table_id_pk" PRIMARY KEY("deployment_id","session_id","table_id")
);
--> statement-breakpoint
CREATE INDEX "invoke_session_table_reads_by_session" ON "invoke_session_table_reads" USING btree ("deployment_id","session_id");
CREATE TABLE "invoke_session_document_reads" (
	"deployment_id" text NOT NULL,
	"session_id" text NOT NULL,
	"table_id" bigint NOT NULL,
	"document_id" text NOT NULL,
	"observed_ts" bigint,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoke_session_document_reads_deployment_id_session_id_table_id_document_id_pk" PRIMARY KEY("deployment_id","session_id","table_id","document_id")
);
--> statement-breakpoint
CREATE INDEX "invoke_session_document_reads_by_session" ON "invoke_session_document_reads" USING btree ("deployment_id","session_id");
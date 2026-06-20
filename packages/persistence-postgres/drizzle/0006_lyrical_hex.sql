CREATE TABLE "invoke_session_index_reads" (
	"deployment_id" text NOT NULL,
	"session_id" text NOT NULL,
	"index_id" bigint NOT NULL,
	"lower_key" text NOT NULL,
	"upper_key" text NOT NULL,
	"observed_ts" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoke_session_index_reads_deployment_id_session_id_index_id_lower_key_upper_key_pk" PRIMARY KEY("deployment_id","session_id","index_id","lower_key","upper_key")
);
--> statement-breakpoint
CREATE INDEX "invoke_session_index_reads_by_session" ON "invoke_session_index_reads" USING btree ("deployment_id","session_id");
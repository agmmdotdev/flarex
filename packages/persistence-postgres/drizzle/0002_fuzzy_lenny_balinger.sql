CREATE TABLE "invoke_sessions" (
	"deployment_id" text NOT NULL,
	"session_id" text NOT NULL,
	"project_id" text NOT NULL,
	"package_id" text NOT NULL,
	"function_path" text NOT NULL,
	"function_kind" text NOT NULL,
	"partition_key" text NOT NULL,
	"scope_json" jsonb NOT NULL,
	"args_json" jsonb NOT NULL,
	"idempotency_key" text,
	"state" text DEFAULT 'active' NOT NULL,
	"begin_ts" bigint NOT NULL,
	"schema_version" bigint NOT NULL,
	"execution_module" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "invoke_sessions_deployment_id_session_id_pk" PRIMARY KEY("deployment_id","session_id")
);
--> statement-breakpoint
CREATE INDEX "invoke_sessions_by_deployment_state_created" ON "invoke_sessions" USING btree ("deployment_id","state","created_at");--> statement-breakpoint
CREATE INDEX "invoke_sessions_by_deployment_idempotency_key" ON "invoke_sessions" USING btree ("deployment_id","idempotency_key");

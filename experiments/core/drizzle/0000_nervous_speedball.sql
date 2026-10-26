CREATE SCHEMA "fx_core";
--> statement-breakpoint
CREATE TABLE "fx_core"."authorities" (
	"scope" text PRIMARY KEY NOT NULL,
	"fence" bigint DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_core"."clocks" (
	"scope" text PRIMARY KEY NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_core"."commands" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"request" text NOT NULL,
	"digest" text NOT NULL,
	"table" text NOT NULL,
	"version" text NOT NULL,
	"token" text NOT NULL,
	"fence" bigint NOT NULL,
	"snapshot" bigint NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"commitSeq" bigint,
	CONSTRAINT "command_request" UNIQUE("scope","request"),
	CONSTRAINT "command_status" CHECK ("fx_core"."commands"."status" in ('active','aborted','committed'))
);
--> statement-breakpoint
CREATE TABLE "fx_core"."definitions" (
	"table" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"fields" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_core"."documents" (
	"scope" text NOT NULL,
	"table" text NOT NULL,
	"id" text NOT NULL,
	"body" jsonb NOT NULL,
	"commitSeq" bigint NOT NULL,
	CONSTRAINT "documents_scope_table_id_pk" PRIMARY KEY("scope","table","id")
);
--> statement-breakpoint
CREATE TABLE "fx_core"."event_intents" (
	"command" text NOT NULL,
	"ordinal" integer NOT NULL,
	"table" text NOT NULL,
	"document" text NOT NULL,
	"event" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "event_intents_command_ordinal_pk" PRIMARY KEY("command","ordinal")
);
--> statement-breakpoint
CREATE TABLE "fx_core"."grants" (
	"scope" text NOT NULL,
	"principal" text NOT NULL,
	CONSTRAINT "grants_scope_principal_pk" PRIMARY KEY("scope","principal")
);
--> statement-breakpoint
CREATE TABLE "fx_core"."history" (
	"scope" text NOT NULL,
	"table" text NOT NULL,
	"id" text NOT NULL,
	"commitSeq" bigint NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "history_scope_table_id_commitSeq_pk" PRIMARY KEY("scope","table","id","commitSeq")
);
--> statement-breakpoint
CREATE TABLE "fx_core"."installation" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "installation_singleton" CHECK ("fx_core"."installation"."singleton")
);
--> statement-breakpoint
CREATE TABLE "fx_core"."unique_claims" (
	"scope" text NOT NULL,
	"table" text NOT NULL,
	"field" text NOT NULL,
	"key" text NOT NULL,
	"owner" text NOT NULL,
	"commitSeq" bigint NOT NULL,
	CONSTRAINT "unique_claim" PRIMARY KEY("scope","table","field","key")
);
--> statement-breakpoint
ALTER TABLE "fx_core"."clocks" ADD CONSTRAINT "clocks_scope_authorities_scope_fk" FOREIGN KEY ("scope") REFERENCES "fx_core"."authorities"("scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_core"."commands" ADD CONSTRAINT "commands_scope_authorities_scope_fk" FOREIGN KEY ("scope") REFERENCES "fx_core"."authorities"("scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_core"."commands" ADD CONSTRAINT "commands_table_definitions_table_fk" FOREIGN KEY ("table") REFERENCES "fx_core"."definitions"("table") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_core"."event_intents" ADD CONSTRAINT "event_intents_command_commands_id_fk" FOREIGN KEY ("command") REFERENCES "fx_core"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_core"."grants" ADD CONSTRAINT "grants_scope_authorities_scope_fk" FOREIGN KEY ("scope") REFERENCES "fx_core"."authorities"("scope") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_core"."unique_claims" ADD CONSTRAINT "unique_claims_scope_table_owner_documents_scope_table_id_fk" FOREIGN KEY ("scope","table","owner") REFERENCES "fx_core"."documents"("scope","table","id") ON DELETE no action ON UPDATE no action;
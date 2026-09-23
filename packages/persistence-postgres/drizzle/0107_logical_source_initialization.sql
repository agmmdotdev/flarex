CREATE TABLE "fx_system_logical_source_initialization" (
	"scope_uuid" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_sha256" text NOT NULL,
	"step_id" text NOT NULL,
	"contract_sha256" text NOT NULL,
	"dataset_sha256" text NOT NULL,
	"row_count" integer NOT NULL,
	"commit_seq" bigint NOT NULL,
	CONSTRAINT "fx_system_logical_source_initialization_scope_uuid_source_key_step_id_pk" PRIMARY KEY("scope_uuid","source_key","step_id"),
	CONSTRAINT "fx_logical_source_initialization_values_check" CHECK (octet_length("fx_system_logical_source_initialization"."source_key") between 1 and 128
    and octet_length("fx_system_logical_source_initialization"."step_id") between 1 and 1024
    and "fx_system_logical_source_initialization"."source_sha256" ~ '^[0-9a-f]{64}$'
    and "fx_system_logical_source_initialization"."contract_sha256" ~ '^[0-9a-f]{64}$'
    and "fx_system_logical_source_initialization"."dataset_sha256" ~ '^[0-9a-f]{64}$'
    and "fx_system_logical_source_initialization"."row_count" >= 0 and "fx_system_logical_source_initialization"."commit_seq" > 0)
);
--> statement-breakpoint
ALTER TABLE "fx_system_logical_source_initialization" ADD CONSTRAINT "fx_logical_source_initialization_scope_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;

CREATE TABLE "fx_system_search_build_state" (
	"scope_uuid" uuid NOT NULL,
	"table_id" integer NOT NULL,
	"logical_index_id" integer NOT NULL,
	"source_sha256" text NOT NULL,
	"lifecycle" text NOT NULL,
	"covered_through_commit_seq" bigint NOT NULL,
	CONSTRAINT "fx_system_search_build_state_pk" PRIMARY KEY("scope_uuid","table_id","logical_index_id"),
	CONSTRAINT "fx_system_search_build_state_table_check" CHECK ("fx_system_search_build_state"."table_id" between 1 and 2147483647),
	CONSTRAINT "fx_system_search_build_state_index_check" CHECK ("fx_system_search_build_state"."logical_index_id" between 1 and 2147483647),
	CONSTRAINT "fx_system_search_build_state_source_check" CHECK ("fx_system_search_build_state"."source_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "fx_system_search_build_state_lifecycle_check" CHECK ("fx_system_search_build_state"."lifecycle" in ('building', 'ready')),
	CONSTRAINT "fx_system_search_build_state_coverage_check" CHECK ("fx_system_search_build_state"."covered_through_commit_seq" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fx_system_search_build_state" ADD CONSTRAINT "fx_system_search_build_state_scope_fk" FOREIGN KEY ("scope_uuid") REFERENCES "fx_system_scope_clock"("scope_uuid") ON DELETE restrict ON UPDATE restrict;

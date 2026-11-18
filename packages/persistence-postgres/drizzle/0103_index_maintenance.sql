ALTER TABLE "fx_system_index_build_state" ADD COLUMN "maintenance_activation_sequence" bigint;--> statement-breakpoint
ALTER TABLE "fx_system_index_build_state" ADD COLUMN "maintenance_bytes" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_index_build_state" ADD COLUMN "maintenance_sha256" "bytea";--> statement-breakpoint
CREATE INDEX "fx_system_index_build_maintenance_idx" ON "fx_system_index_build_state" USING btree ("scope_id","maintenance_activation_sequence") WHERE "fx_system_index_build_state"."maintenance_activation_sequence" is not null;--> statement-breakpoint
ALTER TABLE "fx_system_index_build_state" ADD CONSTRAINT "fx_system_index_build_maintenance_check" CHECK (
      ("fx_system_index_build_state"."maintenance_activation_sequence" is null and "fx_system_index_build_state"."maintenance_bytes" is null and "fx_system_index_build_state"."maintenance_sha256" is null)
      or ("fx_system_index_build_state"."maintenance_activation_sequence" is not null and "fx_system_index_build_state"."maintenance_activation_sequence" > 0
        and "fx_system_index_build_state"."maintenance_bytes" is not null and octet_length("fx_system_index_build_state"."maintenance_bytes") between 1 and 16384
        and "fx_system_index_build_state"."maintenance_sha256" is not null and octet_length("fx_system_index_build_state"."maintenance_sha256") = 32
        and "fx_system_index_build_state"."lifecycle" = 'enabled' and "fx_system_index_build_state"."first_readable_commit_seq" is not null and "fx_system_index_build_state"."covered_through_commit_seq" is not null));
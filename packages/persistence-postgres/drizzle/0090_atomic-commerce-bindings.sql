ALTER TABLE "fx_system_data_binding_physical_lane" DROP CONSTRAINT "fx_data_binding_lane_pk";
--> statement-breakpoint
ALTER TABLE "fx_system_data_binding_physical_lane" ADD CONSTRAINT "fx_data_binding_lane_pk" PRIMARY KEY("scope_id","storage_generation","candidate_sha256","slot","installation_storage_id");
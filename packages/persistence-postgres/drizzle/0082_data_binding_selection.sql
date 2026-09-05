CREATE TABLE "fx_system_data_binding_activation" (
	"scope_id" text COLLATE "C" NOT NULL,
	"storage_generation" text COLLATE "C" NOT NULL,
	"sha256" text COLLATE "C" NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"sequence" bigint NOT NULL,
	"request_id" text COLLATE "C" NOT NULL,
	"candidate_sha256" text COLLATE "C" NOT NULL,
	CONSTRAINT "fx_data_binding_activation_pk" PRIMARY KEY("scope_id","storage_generation","sequence"),
	CONSTRAINT "fx_data_binding_activation_request" UNIQUE("scope_id","request_id"),
	CONSTRAINT "fx_data_binding_activation_reference" UNIQUE("scope_id","storage_generation","sequence","sha256","candidate_sha256"),
	CONSTRAINT "fx_data_binding_activation_digest" CHECK ("fx_system_data_binding_activation"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "fx_data_binding_activation_sequence" CHECK ("fx_system_data_binding_activation"."sequence" > 0),
	CONSTRAINT "fx_data_binding_activation_request_id" CHECK (octet_length("fx_system_data_binding_activation"."request_id") between 1 and 512),
	CONSTRAINT "fx_data_binding_activation_bytes" CHECK ("fx_system_data_binding_activation"."canonical_byte_length" between 1 and 1048576 and octet_length("fx_system_data_binding_activation"."canonical_bytes") = "fx_system_data_binding_activation"."canonical_byte_length")
);
--> statement-breakpoint
CREATE TABLE "fx_system_data_binding_candidate" (
	"scope_id" text COLLATE "C" NOT NULL,
	"storage_generation" text COLLATE "C" NOT NULL,
	"sha256" text COLLATE "C" NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	CONSTRAINT "fx_data_binding_candidate_pk" PRIMARY KEY("scope_id","storage_generation","sha256"),
	CONSTRAINT "fx_data_binding_candidate_digest" CHECK ("fx_system_data_binding_candidate"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "fx_data_binding_candidate_bytes" CHECK ("fx_system_data_binding_candidate"."canonical_byte_length" between 1 and 1048576 and octet_length("fx_system_data_binding_candidate"."canonical_bytes") = "fx_system_data_binding_candidate"."canonical_byte_length"),
	CONSTRAINT "fx_data_binding_candidate_generation" CHECK ("fx_system_data_binding_candidate"."storage_generation" = 'flarexdb_v1')
);
--> statement-breakpoint
CREATE TABLE "fx_system_data_binding_head" (
	"scope_id" text COLLATE "C" NOT NULL,
	"storage_generation" text COLLATE "C" NOT NULL,
	"sha256" text COLLATE "C" NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"sequence" bigint NOT NULL,
	"activation_sha256" text COLLATE "C" NOT NULL,
	"candidate_sha256" text COLLATE "C" NOT NULL,
	CONSTRAINT "fx_data_binding_head_pk" PRIMARY KEY("scope_id","storage_generation"),
	CONSTRAINT "fx_data_binding_head_digest" CHECK ("fx_system_data_binding_head"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "fx_data_binding_head_bytes" CHECK ("fx_system_data_binding_head"."canonical_byte_length" between 1 and 1048576 and octet_length("fx_system_data_binding_head"."canonical_bytes") = "fx_system_data_binding_head"."canonical_byte_length")
);
--> statement-breakpoint
CREATE TABLE "fx_system_data_binding_physical_lane" (
	"scope_id" text COLLATE "C" NOT NULL,
	"storage_generation" text COLLATE "C" NOT NULL,
	"candidate_sha256" text COLLATE "C" NOT NULL,
	"slot" text COLLATE "C" NOT NULL,
	"installation_storage_id" bigint NOT NULL,
	"installation_sha256" "bytea" NOT NULL,
	"installation_receipt_sha256" "bytea" NOT NULL,
	"readiness_storage_id" bigint NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"availability_history_storage_id" bigint NOT NULL,
	"availability_sequence" bigint NOT NULL,
	"availability_status" text COLLATE "C" NOT NULL,
	"availability_history_sha256" "bytea" NOT NULL,
	CONSTRAINT "fx_data_binding_lane_pk" PRIMARY KEY("scope_id","storage_generation","candidate_sha256","slot"),
	CONSTRAINT "fx_data_binding_lane_slot" CHECK ("fx_system_data_binding_physical_lane"."slot" in ('payloadLifecycle', 'commerce')),
	CONSTRAINT "fx_data_binding_lane_ready" CHECK ("fx_system_data_binding_physical_lane"."availability_status" = 'ready')
);
--> statement-breakpoint
ALTER TABLE "fx_system_data_binding_activation" ADD CONSTRAINT "fx_data_binding_activation_candidate_fk" FOREIGN KEY ("scope_id","storage_generation","candidate_sha256") REFERENCES "fx_system_data_binding_candidate"("scope_id","storage_generation","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_data_binding_candidate" ADD CONSTRAINT "fx_data_binding_candidate_scope_fk" FOREIGN KEY ("scope_id") REFERENCES "fx_system_scope_clock"("scope_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_data_binding_head" ADD CONSTRAINT "fx_data_binding_head_activation_fk" FOREIGN KEY ("scope_id","storage_generation","sequence","activation_sha256","candidate_sha256") REFERENCES "fx_system_data_binding_activation"("scope_id","storage_generation","sequence","sha256","candidate_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_data_binding_physical_lane" ADD CONSTRAINT "fx_data_binding_lane_candidate_fk" FOREIGN KEY ("scope_id","storage_generation","candidate_sha256") REFERENCES "fx_system_data_binding_candidate"("scope_id","storage_generation","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_data_binding_physical_lane" ADD CONSTRAINT "fx_data_binding_lane_installation_fk" FOREIGN KEY ("installation_storage_id","installation_sha256","installation_receipt_sha256") REFERENCES "fx_system_framework_schema_installation"("installation_storage_id","installation_sha256","installation_receipt_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_data_binding_physical_lane" ADD CONSTRAINT "fx_data_binding_lane_readiness_fk" FOREIGN KEY ("readiness_storage_id","installation_storage_id","readiness_sha256") REFERENCES "fx_system_framework_schema_readiness"("readiness_storage_id","installation_storage_id","readiness_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_data_binding_physical_lane" ADD CONSTRAINT "fx_data_binding_lane_availability_fk" FOREIGN KEY ("availability_history_storage_id","installation_storage_id","readiness_storage_id","availability_sequence","availability_status","availability_history_sha256") REFERENCES "fx_system_framework_schema_availability_history"("availability_history_storage_id","installation_storage_id","readiness_storage_id","availability_sequence","status","history_sha256") ON DELETE no action ON UPDATE no action;
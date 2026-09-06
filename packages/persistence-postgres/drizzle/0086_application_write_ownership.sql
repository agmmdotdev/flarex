CREATE TABLE "fx_system_application_write_ownership" (
	"scope_id" text NOT NULL,
	"activation_sequence" bigint NOT NULL,
	"claims_sha256" "bytea" NOT NULL,
	"claims_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_system_application_write_ownership_scope_id_activation_sequence_pk" PRIMARY KEY("scope_id","activation_sequence"),
	CONSTRAINT "fx_application_write_ownership_identity_unique" UNIQUE("scope_id","activation_sequence","claims_sha256"),
	CONSTRAINT "fx_application_write_ownership_evidence_check" CHECK ("fx_system_application_write_ownership"."activation_sequence" > 0
    and octet_length("fx_system_application_write_ownership"."claims_sha256") = 32 and octet_length("fx_system_application_write_ownership"."claims_bytes") between 1 and 1048576)
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" DROP CONSTRAINT "fx_application_activation_readiness_contract_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" DROP CONSTRAINT "fx_application_active_head_readiness_contract_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD COLUMN "write_policy_set_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD COLUMN "write_ownership_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD COLUMN "write_policy_set_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD COLUMN "write_ownership_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_write_ownership" ADD CONSTRAINT "fx_application_write_ownership_activation_fk" FOREIGN KEY ("scope_id","activation_sequence") REFERENCES "fx_system_application_activation"("scope_id","activation_sequence") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_readiness_contract_check" CHECK ((
        ("fx_system_application_activation"."readiness_contract_version" = 1
          and "fx_system_application_activation"."legacy_readiness_sha256" is not null
          and "fx_system_application_activation"."legacy_readiness_sha256" = "fx_system_application_activation"."readiness_sha256"
          and "fx_system_application_activation"."relation_readiness_sha256" is null
          and "fx_system_application_activation"."relation_set_readiness_sha256" is null
          and "fx_system_application_activation"."relation_count" is null)
        or ("fx_system_application_activation"."readiness_contract_version" in (2, 3)
          and "fx_system_application_activation"."legacy_readiness_sha256" is null
          and "fx_system_application_activation"."relation_readiness_sha256" is not null
          and "fx_system_application_activation"."relation_readiness_sha256" = "fx_system_application_activation"."readiness_sha256"
          and "fx_system_application_activation"."relation_set_readiness_sha256" is not null
          and octet_length("fx_system_application_activation"."relation_set_readiness_sha256") = 32
          and "fx_system_application_activation"."relation_count" is not null
          and ("fx_system_application_activation"."relation_count" between 1 and 1024
            or ("fx_system_application_activation"."readiness_contract_version" = 3 and "fx_system_application_activation"."relation_count" = 0)))
      ) and (
        ("fx_system_application_activation"."readiness_contract_version" in (1, 2) and "fx_system_application_activation"."write_policy_set_sha256" is null and "fx_system_application_activation"."write_ownership_sha256" is null)
        or ("fx_system_application_activation"."readiness_contract_version" = 3 and "fx_system_application_activation"."write_policy_set_sha256" is not null
          and "fx_system_application_activation"."write_ownership_sha256" is not null and octet_length("fx_system_application_activation"."write_policy_set_sha256") = 32
          and octet_length("fx_system_application_activation"."write_ownership_sha256") = 32)
      ));--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD CONSTRAINT "fx_application_active_head_readiness_contract_check" CHECK ((
        ("fx_system_application_active_head"."readiness_contract_version" = 1
          and "fx_system_application_active_head"."relation_set_readiness_sha256" is null
          and "fx_system_application_active_head"."relation_count" is null)
        or ("fx_system_application_active_head"."readiness_contract_version" in (2, 3)
          and "fx_system_application_active_head"."relation_set_readiness_sha256" is not null
          and octet_length("fx_system_application_active_head"."relation_set_readiness_sha256") = 32
          and "fx_system_application_active_head"."relation_count" is not null
          and ("fx_system_application_active_head"."relation_count" between 1 and 1024
            or ("fx_system_application_active_head"."readiness_contract_version" = 3 and "fx_system_application_active_head"."relation_count" = 0)))
      ) and (
        ("fx_system_application_active_head"."readiness_contract_version" in (1, 2) and "fx_system_application_active_head"."write_policy_set_sha256" is null and "fx_system_application_active_head"."write_ownership_sha256" is null)
        or ("fx_system_application_active_head"."readiness_contract_version" = 3 and "fx_system_application_active_head"."write_policy_set_sha256" is not null
          and "fx_system_application_active_head"."write_ownership_sha256" is not null and octet_length("fx_system_application_active_head"."write_policy_set_sha256") = 32
          and octet_length("fx_system_application_active_head"."write_ownership_sha256") = 32)
      ));

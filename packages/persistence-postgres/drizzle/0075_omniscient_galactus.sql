ALTER TABLE "fx_system_application_activation_v1" RENAME TO "fx_system_application_activation";--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head_v1" RENAME TO "fx_system_application_active_head";--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" DROP CONSTRAINT "fx_application_active_head_v1_activation_fk";
--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" DROP CONSTRAINT "fx_application_activation_v1_request_unique";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" DROP CONSTRAINT "fx_application_activation_v1_head_child_unique";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" DROP CONSTRAINT "fx_application_activation_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" DROP CONSTRAINT "fx_application_activation_v1_time_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" DROP CONSTRAINT "fx_application_active_head_v1_identity_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" DROP CONSTRAINT "fx_application_active_head_v1_time_check";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" DROP CONSTRAINT "fx_application_activation_v1_readiness_fk";
--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" DROP CONSTRAINT "fx_system_application_activation_v1_scope_id_activation_sequence_pk";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_pk" PRIMARY KEY("scope_id","activation_sequence");--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD COLUMN "readiness_contract_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD COLUMN "legacy_readiness_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD COLUMN "relation_readiness_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD COLUMN "relation_set_readiness_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD COLUMN "relation_count" integer;--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD COLUMN "readiness_contract_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD COLUMN "relation_set_readiness_sha256" "bytea";--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD COLUMN "relation_count" integer;--> statement-breakpoint
UPDATE "fx_system_application_activation"
SET "legacy_readiness_sha256" = "readiness_sha256"
WHERE "readiness_contract_version" = 1;--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_request_unique" UNIQUE("scope_id","activation_request_sha256");--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_head_child_unique" UNIQUE("scope_id","activation_sequence","revision_id","readiness_contract_version","readiness_sha256","activation_sha256");--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_legacy_readiness_fk" FOREIGN KEY ("scope_id","revision_id","legacy_readiness_sha256") REFERENCES "fx_system_application_readiness_v1"("scope_id","revision_id","readiness_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_relation_readiness_fk" FOREIGN KEY ("scope_id","revision_id","relation_readiness_sha256","relation_set_readiness_sha256","relation_count") REFERENCES "fx_system_application_readiness"("scope_id","revision_id","readiness_sha256","relation_set_readiness_sha256","relation_count") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD CONSTRAINT "fx_application_active_head_activation_fk" FOREIGN KEY ("scope_id","activation_sequence","revision_id","readiness_contract_version","readiness_sha256","activation_sha256") REFERENCES "fx_system_application_activation"("scope_id","activation_sequence","revision_id","readiness_contract_version","readiness_sha256","activation_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD CONSTRAINT "fx_application_active_head_relation_readiness_fk" FOREIGN KEY ("scope_id","revision_id","readiness_sha256","relation_set_readiness_sha256","relation_count") REFERENCES "fx_system_application_readiness"("scope_id","revision_id","readiness_sha256","relation_set_readiness_sha256","relation_count") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_identity_check" CHECK ("fx_system_application_activation"."activation_sequence" between 1 and 9223372036854775807
        and ("fx_system_application_activation"."previous_activation_sequence" is null or (
          "fx_system_application_activation"."previous_activation_sequence" between 1 and 9223372036854775806
          and "fx_system_application_activation"."previous_activation_sequence" < "fx_system_application_activation"."activation_sequence"
        ))
        and btrim("fx_system_application_activation"."revision_id", U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff') <> ''
        and octet_length("fx_system_application_activation"."readiness_sha256") = 32
        and octet_length("fx_system_application_activation"."activation_request_sha256") = 32
        and octet_length("fx_system_application_activation"."activation_sha256") = 32
        and octet_length("fx_system_application_activation"."activation_bytes") between 1 and 1048576);--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_readiness_contract_check" CHECK ((
        ("fx_system_application_activation"."readiness_contract_version" = 1
          and "fx_system_application_activation"."legacy_readiness_sha256" is not null
          and "fx_system_application_activation"."legacy_readiness_sha256" = "fx_system_application_activation"."readiness_sha256"
          and "fx_system_application_activation"."relation_readiness_sha256" is null
          and "fx_system_application_activation"."relation_set_readiness_sha256" is null
          and "fx_system_application_activation"."relation_count" is null)
        or ("fx_system_application_activation"."readiness_contract_version" = 2
          and "fx_system_application_activation"."legacy_readiness_sha256" is null
          and "fx_system_application_activation"."relation_readiness_sha256" is not null
          and "fx_system_application_activation"."relation_readiness_sha256" = "fx_system_application_activation"."readiness_sha256"
          and "fx_system_application_activation"."relation_set_readiness_sha256" is not null
          and octet_length("fx_system_application_activation"."relation_set_readiness_sha256") = 32
          and "fx_system_application_activation"."relation_count" is not null
          and "fx_system_application_activation"."relation_count" between 1 and 1024)
      ));--> statement-breakpoint
ALTER TABLE "fx_system_application_activation" ADD CONSTRAINT "fx_application_activation_time_check" CHECK (isfinite("fx_system_application_activation"."activated_at"));--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD CONSTRAINT "fx_application_active_head_identity_check" CHECK ("fx_system_application_active_head"."activation_sequence" between 1 and 9223372036854775807
        and btrim("fx_system_application_active_head"."revision_id", U&' \\0009\\000a\\000b\\000c\\000d\\00a0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200a\\2028\\2029\\202f\\205f\\3000\\feff') <> ''
        and octet_length("fx_system_application_active_head"."readiness_sha256") = 32
        and octet_length("fx_system_application_active_head"."activation_sha256") = 32
        and octet_length("fx_system_application_active_head"."head_sha256") = 32
        and octet_length("fx_system_application_active_head"."head_bytes") between 1 and 1048576);--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD CONSTRAINT "fx_application_active_head_readiness_contract_check" CHECK ((
        ("fx_system_application_active_head"."readiness_contract_version" = 1
          and "fx_system_application_active_head"."relation_set_readiness_sha256" is null
          and "fx_system_application_active_head"."relation_count" is null)
        or ("fx_system_application_active_head"."readiness_contract_version" = 2
          and "fx_system_application_active_head"."relation_set_readiness_sha256" is not null
          and octet_length("fx_system_application_active_head"."relation_set_readiness_sha256") = 32
          and "fx_system_application_active_head"."relation_count" is not null
          and "fx_system_application_active_head"."relation_count" between 1 and 1024)
      ));--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head" ADD CONSTRAINT "fx_application_active_head_time_check" CHECK (isfinite("fx_system_application_active_head"."created_at")
        and isfinite("fx_system_application_active_head"."updated_at")
        and "fx_system_application_active_head"."updated_at" >= "fx_system_application_active_head"."created_at");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "fx_system_declarative_v2_verdict" LIMIT 1) THEN
    RAISE EXCEPTION
      'migration 0043 cannot replace legacy declarative V2 verdict rows';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" DROP CONSTRAINT "fx_dv2_verdict_frame_check";--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" DROP CONSTRAINT "fx_dv2_verdict_state_check";--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" DROP CONSTRAINT "fx_dv2_verdict_attempt_fk";
--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" ADD COLUMN "revision_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" ADD CONSTRAINT "fx_dv2_verdict_revision_fk" FOREIGN KEY ("scope_id","candidate_sha256","revision_id") REFERENCES "fx_system_application_revision_v1"("scope_id","candidate_sha256","revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" ADD CONSTRAINT "fx_dv2_verdict_attempt_fk" FOREIGN KEY ("scope_id","attempt_sha256") REFERENCES "fx_system_declarative_v2_verifier_attempt_v2"("scope_id","attempt_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" ADD CONSTRAINT "fx_dv2_verdict_state_check" CHECK ("fx_system_declarative_v2_verdict"."verdict" = 'ready' and "fx_system_declarative_v2_verdict"."failure_code" is null);--> statement-breakpoint
ALTER TABLE "fx_system_declarative_v2_verdict" ADD CONSTRAINT "fx_dv2_verdict_frame_check" CHECK (octet_length("fx_system_declarative_v2_verdict"."verdict_sha256") = 32
        and "fx_system_declarative_v2_verdict"."verdict_sha256" = "fx_system_declarative_v2_verdict"."frame_sha256"
        and btrim("fx_system_declarative_v2_verdict"."revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_system_declarative_v2_verdict"."frame_byte_length" <= 16384
        and (
    "fx_system_declarative_v2_verdict"."frame_codec_version" = 1
    and "fx_system_declarative_v2_verdict"."frame_byte_length" >= 1
    and octet_length("fx_system_declarative_v2_verdict"."frame_sha256") = 32
    and octet_length("fx_system_declarative_v2_verdict"."frame_bytes") = "fx_system_declarative_v2_verdict"."frame_byte_length"
  ) is true);

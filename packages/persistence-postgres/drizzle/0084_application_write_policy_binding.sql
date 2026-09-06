ALTER TABLE "fx_control_bound_application_schema" DROP CONSTRAINT "fx_control_bound_application_schema_identity_check";--> statement-breakpoint
ALTER TABLE "fx_control_bound_application_schema" DROP CONSTRAINT "fx_control_bound_application_schema_json_check";--> statement-breakpoint
ALTER TABLE "fx_control_bound_application_schema" ADD CONSTRAINT "fx_control_bound_application_schema_identity_check" CHECK (btrim("fx_control_bound_application_schema"."deployment_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_control_bound_application_schema"."application_schema_sha256") = 32
        and octet_length("fx_control_bound_application_schema"."application_schema_frame_bytes") between 1 and 1048576
        and btrim("fx_control_bound_application_schema"."schema_version_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and "fx_control_bound_application_schema"."schema_version" between 1 and 2147483647
        and octet_length("fx_control_bound_application_schema"."schema_manifest_sha256") = 32
        and "fx_control_bound_application_schema"."binding_codec_version" in (2, 3)
        and octet_length("fx_control_bound_application_schema"."binding_bytes") between 1 and 16777216
        and octet_length("fx_control_bound_application_schema"."bound_publication_sha256") = 32);--> statement-breakpoint
ALTER TABLE "fx_control_bound_application_schema" ADD CONSTRAINT "fx_control_bound_application_schema_json_check" CHECK ((
          jsonb_typeof("fx_control_bound_application_schema"."binding_json") = 'object'
          and "fx_control_bound_application_schema"."binding_json" ->> 'format'
            = 'flarex.application-schema-binding'
          and "fx_control_bound_application_schema"."binding_json" -> 'version' = to_jsonb("fx_control_bound_application_schema"."binding_codec_version")
        ) is true);
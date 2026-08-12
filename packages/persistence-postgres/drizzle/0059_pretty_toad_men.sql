CREATE TABLE "fx_system_application_activation_v1" (
	"scope_id" text NOT NULL,
	"activation_sequence" bigint NOT NULL,
	"previous_activation_sequence" bigint,
	"revision_id" text NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"activation_request_sha256" "bytea" NOT NULL,
	"activation_sha256" "bytea" NOT NULL,
	"activation_bytes" "bytea" NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_system_application_activation_v1_scope_id_activation_sequence_pk" PRIMARY KEY("scope_id","activation_sequence"),
	CONSTRAINT "fx_application_activation_v1_request_unique" UNIQUE("scope_id","activation_request_sha256"),
	CONSTRAINT "fx_application_activation_v1_head_child_unique" UNIQUE("scope_id","activation_sequence","revision_id","readiness_sha256","activation_sha256"),
	CONSTRAINT "fx_application_activation_v1_identity_check" CHECK ("fx_system_application_activation_v1"."activation_sequence" between 1 and 9223372036854775807
        and ("fx_system_application_activation_v1"."previous_activation_sequence" is null or (
          "fx_system_application_activation_v1"."previous_activation_sequence" between 1 and 9223372036854775806
          and "fx_system_application_activation_v1"."previous_activation_sequence" < "fx_system_application_activation_v1"."activation_sequence"
        ))
        and btrim("fx_system_application_activation_v1"."revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_activation_v1"."readiness_sha256") = 32
        and octet_length("fx_system_application_activation_v1"."activation_request_sha256") = 32
        and octet_length("fx_system_application_activation_v1"."activation_sha256") = 32
        and octet_length("fx_system_application_activation_v1"."activation_bytes") between 1 and 1048576),
	CONSTRAINT "fx_application_activation_v1_time_check" CHECK (isfinite("fx_system_application_activation_v1"."activated_at"))
);
--> statement-breakpoint
CREATE TABLE "fx_system_application_active_head_v1" (
	"scope_id" text PRIMARY KEY NOT NULL,
	"activation_sequence" bigint NOT NULL,
	"revision_id" text NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"activation_sha256" "bytea" NOT NULL,
	"head_sha256" "bytea" NOT NULL,
	"head_bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_application_active_head_v1_identity_check" CHECK ("fx_system_application_active_head_v1"."activation_sequence" between 1 and 9223372036854775807
        and btrim("fx_system_application_active_head_v1"."revision_id", U&' \0009\000a\000b\000c\000d\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') <> ''
        and octet_length("fx_system_application_active_head_v1"."readiness_sha256") = 32
        and octet_length("fx_system_application_active_head_v1"."activation_sha256") = 32
        and octet_length("fx_system_application_active_head_v1"."head_sha256") = 32
        and octet_length("fx_system_application_active_head_v1"."head_bytes") between 1 and 1048576),
	CONSTRAINT "fx_application_active_head_v1_time_check" CHECK (isfinite("fx_system_application_active_head_v1"."created_at")
        and isfinite("fx_system_application_active_head_v1"."updated_at")
        and "fx_system_application_active_head_v1"."updated_at" >= "fx_system_application_active_head_v1"."created_at")
);
--> statement-breakpoint
ALTER TABLE "fx_system_application_activation_v1" ADD CONSTRAINT "fx_application_activation_v1_readiness_fk" FOREIGN KEY ("scope_id","revision_id","readiness_sha256") REFERENCES "fx_system_application_readiness_v1"("scope_id","revision_id","readiness_sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_system_application_active_head_v1" ADD CONSTRAINT "fx_application_active_head_v1_activation_fk" FOREIGN KEY ("scope_id","activation_sequence","revision_id","readiness_sha256","activation_sha256") REFERENCES "fx_system_application_activation_v1"("scope_id","activation_sequence","revision_id","readiness_sha256","activation_sha256") ON DELETE restrict ON UPDATE no action;

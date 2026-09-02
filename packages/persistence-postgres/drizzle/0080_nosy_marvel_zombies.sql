CREATE TABLE "fx_system_framework_migration_admission_assignment" (
	"admission_storage_id" bigint NOT NULL,
	"collision_storage_id" bigint NOT NULL,
	"assignment_ordinal" integer NOT NULL,
	"assignment_storage_id" bigint NOT NULL,
	"spelling" text COLLATE "C" NOT NULL,
	"assignment_sha256" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_admission_assignment_pk" PRIMARY KEY("admission_storage_id","assignment_ordinal"),
	CONSTRAINT "fx_framework_migration_admission_member_unique" UNIQUE("admission_storage_id","assignment_storage_id"),
	CONSTRAINT "fx_framework_migration_admission_assignment_identity_check" CHECK ("fx_system_framework_migration_admission_assignment"."assignment_ordinal" between 0 and 131327
        and octet_length("fx_system_framework_migration_admission_assignment"."assignment_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_attempt_start" (
	"attempt_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_migration_attempt_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collision_storage_id" bigint NOT NULL,
	"plan_storage_id" bigint NOT NULL,
	"migration_plan_sha256" "bytea" NOT NULL,
	"admission_storage_id" bigint NOT NULL,
	"admission_sha256" "bytea" NOT NULL,
	"attempt_id" text COLLATE "C" NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"lease_owner_id" text COLLATE "C" NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	"previous_attempt_storage_id" bigint,
	"previous_attempt_id" text COLLATE "C",
	"attempt_start_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_attempt_pk" PRIMARY KEY("attempt_storage_id"),
	CONSTRAINT "fx_framework_migration_attempt_id_unique" UNIQUE("collision_storage_id","attempt_id"),
	CONSTRAINT "fx_framework_migration_attempt_fence_unique" UNIQUE("collision_storage_id","attempt_fence"),
	CONSTRAINT "fx_framework_migration_attempt_reference_unique" UNIQUE("attempt_storage_id","collision_storage_id","plan_storage_id","attempt_id","attempt_fence"),
	CONSTRAINT "fx_framework_migration_attempt_admission_reference_unique" UNIQUE("attempt_storage_id","collision_storage_id","plan_storage_id","admission_storage_id","admission_sha256","attempt_id","attempt_fence"),
	CONSTRAINT "fx_framework_migration_attempt_previous_unique" UNIQUE("attempt_storage_id","collision_storage_id","attempt_id"),
	CONSTRAINT "fx_framework_migration_attempt_identity_check" CHECK ("fx_system_framework_migration_attempt_start"."attempt_storage_id" between 1 and 9223372036854775807
        and octet_length("fx_system_framework_migration_attempt_start"."migration_plan_sha256") = 32
        and octet_length("fx_system_framework_migration_attempt_start"."admission_sha256") = 32
        and
    octet_length(convert_to("fx_system_framework_migration_attempt_start"."attempt_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_attempt_start"."attempt_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

        and "fx_system_framework_migration_attempt_start"."attempt_fence" between 0 and 9223372036854775807
        and
    octet_length(convert_to("fx_system_framework_migration_attempt_start"."lease_owner_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_attempt_start"."lease_owner_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

        and isfinite("fx_system_framework_migration_attempt_start"."lease_expires_at")
        and (
          ("fx_system_framework_migration_attempt_start"."previous_attempt_storage_id" is null
            and "fx_system_framework_migration_attempt_start"."previous_attempt_id" is null)
          or
          ("fx_system_framework_migration_attempt_start"."previous_attempt_storage_id" is not null
            and "fx_system_framework_migration_attempt_start"."previous_attempt_id" is not null
            and "fx_system_framework_migration_attempt_start"."previous_attempt_storage_id" <> "fx_system_framework_migration_attempt_start"."attempt_storage_id")
        )
        and octet_length("fx_system_framework_migration_attempt_start"."attempt_start_sha256") = 32),
	CONSTRAINT "fx_framework_migration_attempt_frame_check" CHECK ("fx_system_framework_migration_attempt_start"."frame_format" = 'flarex.framework-migration-attempt-start'
        and "fx_system_framework_migration_attempt_start"."frame_version" = 1
        and
    "fx_system_framework_migration_attempt_start"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_migration_attempt_start"."canonical_bytes") = "fx_system_framework_migration_attempt_start"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_attempt_terminal" (
	"terminal_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_migration_terminal_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collision_storage_id" bigint NOT NULL,
	"plan_storage_id" bigint NOT NULL,
	"attempt_storage_id" bigint NOT NULL,
	"admission_storage_id" bigint NOT NULL,
	"admission_sha256" "bytea" NOT NULL,
	"attempt_id" text COLLATE "C" NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"outcome_kind" text COLLATE "C" NOT NULL,
	"required_step_set_sha256" "bytea",
	"failure_reason" text COLLATE "C",
	"evidence_sha256" "bytea",
	"last_receipt_storage_id" bigint,
	"last_step_receipt_sha256" "bytea",
	"attempt_terminal_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_terminal_pk" PRIMARY KEY("terminal_storage_id"),
	CONSTRAINT "fx_framework_migration_terminal_attempt_unique" UNIQUE("attempt_storage_id"),
	CONSTRAINT "fx_framework_migration_terminal_digest_unique" UNIQUE("attempt_terminal_sha256"),
	CONSTRAINT "fx_framework_migration_terminal_reference_unique" UNIQUE("terminal_storage_id","collision_storage_id","plan_storage_id","attempt_storage_id","outcome_kind","attempt_terminal_sha256"),
	CONSTRAINT "fx_framework_migration_terminal_installation_unique" UNIQUE("terminal_storage_id","collision_storage_id","plan_storage_id","admission_storage_id","admission_sha256","outcome_kind","attempt_terminal_sha256"),
	CONSTRAINT "fx_framework_migration_terminal_identity_check" CHECK ("fx_system_framework_migration_attempt_terminal"."terminal_storage_id" between 1 and 9223372036854775807
        and octet_length("fx_system_framework_migration_attempt_terminal"."admission_sha256") = 32
        and "fx_system_framework_migration_attempt_terminal"."attempt_fence" between 0 and 9223372036854775807
        and "fx_system_framework_migration_attempt_terminal"."outcome_kind" in ('succeeded', 'failed', 'decisionUncertain')
        and (
          ("fx_system_framework_migration_attempt_terminal"."outcome_kind" = 'succeeded'
            and "fx_system_framework_migration_attempt_terminal"."required_step_set_sha256" is not null
            and octet_length("fx_system_framework_migration_attempt_terminal"."required_step_set_sha256") = 32
            and "fx_system_framework_migration_attempt_terminal"."failure_reason" is null
            and "fx_system_framework_migration_attempt_terminal"."evidence_sha256" is null
            and "fx_system_framework_migration_attempt_terminal"."last_receipt_storage_id" is not null
            and "fx_system_framework_migration_attempt_terminal"."last_step_receipt_sha256" is not null)
          or
          ("fx_system_framework_migration_attempt_terminal"."outcome_kind" = 'failed'
            and "fx_system_framework_migration_attempt_terminal"."required_step_set_sha256" is null
            and "fx_system_framework_migration_attempt_terminal"."failure_reason" is not null
            and "fx_system_framework_migration_attempt_terminal"."failure_reason" in (
              'operationFailed', 'validationFailed', 'leaseLost', 'superseded'
            )
            and "fx_system_framework_migration_attempt_terminal"."evidence_sha256" is not null
            and octet_length("fx_system_framework_migration_attempt_terminal"."evidence_sha256") = 32)
          or
          ("fx_system_framework_migration_attempt_terminal"."outcome_kind" = 'decisionUncertain'
            and "fx_system_framework_migration_attempt_terminal"."required_step_set_sha256" is null
            and "fx_system_framework_migration_attempt_terminal"."failure_reason" is null
            and "fx_system_framework_migration_attempt_terminal"."evidence_sha256" is not null
            and octet_length("fx_system_framework_migration_attempt_terminal"."evidence_sha256") = 32)
        )
        and (
          ("fx_system_framework_migration_attempt_terminal"."last_receipt_storage_id" is null
            and "fx_system_framework_migration_attempt_terminal"."last_step_receipt_sha256" is null)
          or
          ("fx_system_framework_migration_attempt_terminal"."last_receipt_storage_id" is not null
            and "fx_system_framework_migration_attempt_terminal"."last_step_receipt_sha256" is not null
            and octet_length("fx_system_framework_migration_attempt_terminal"."last_step_receipt_sha256") = 32)
        )
        and octet_length("fx_system_framework_migration_attempt_terminal"."attempt_terminal_sha256") = 32),
	CONSTRAINT "fx_framework_migration_terminal_frame_check" CHECK ("fx_system_framework_migration_attempt_terminal"."frame_format" = 'flarex.framework-migration-attempt-terminal'
        and "fx_system_framework_migration_attempt_terminal"."frame_version" = 1
        and
    "fx_system_framework_migration_attempt_terminal"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_migration_attempt_terminal"."canonical_bytes") = "fx_system_framework_migration_attempt_terminal"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_collision_domain" (
	"collision_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_migration_collision_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"target_namespace_storage_id" bigint NOT NULL,
	"physical_database_identity" text COLLATE "C" NOT NULL,
	"schema_name" text COLLATE "C" NOT NULL,
	"owner" text COLLATE "C" NOT NULL,
	"lineage_id" text COLLATE "C" NOT NULL,
	"physical_namespace_profile" text COLLATE "C" NOT NULL,
	CONSTRAINT "fx_framework_migration_collision_pk" PRIMARY KEY("collision_storage_id"),
	CONSTRAINT "fx_framework_migration_collision_coordinate_unique" UNIQUE("target_namespace_storage_id","owner","lineage_id","physical_namespace_profile"),
	CONSTRAINT "fx_framework_migration_collision_physical_unique" UNIQUE("collision_storage_id","physical_database_identity","schema_name"),
	CONSTRAINT "fx_framework_migration_collision_identity_check" CHECK ("fx_system_framework_migration_collision_domain"."collision_storage_id" between 1 and 9223372036854775807
        and "fx_system_framework_migration_collision_domain"."owner" in ('medusa', 'system')
        and
    octet_length(convert_to("fx_system_framework_migration_collision_domain"."lineage_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_collision_domain"."lineage_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

        and "fx_system_framework_migration_collision_domain"."physical_namespace_profile" = 'relational-postgres-scope-isolated-stable-names')
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_collision_head" (
	"collision_storage_id" bigint NOT NULL,
	"current_plan_storage_id" bigint NOT NULL,
	"current_plan_sha256" "bytea" NOT NULL,
	"current_admission_storage_id" bigint NOT NULL,
	"current_admission_sha256" "bytea" NOT NULL,
	"head_revision" bigint NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"current_attempt_storage_id" bigint,
	"current_attempt_id" text COLLATE "C",
	"current_attempt_fence" bigint,
	"current_lease_owner_id" text COLLATE "C",
	"current_lease_expires_at" timestamp (3) with time zone,
	"last_event_storage_id" bigint,
	"last_event_sequence" bigint,
	"last_event_sha256" "bytea",
	"collision_head_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_collision_head_pk" PRIMARY KEY("collision_storage_id"),
	CONSTRAINT "fx_framework_migration_collision_head_identity_check" CHECK ("fx_system_framework_migration_collision_head"."head_revision" between 0 and 9223372036854775807
        and "fx_system_framework_migration_collision_head"."attempt_fence" between 0 and 9223372036854775807
        and octet_length("fx_system_framework_migration_collision_head"."current_plan_sha256") = 32
        and octet_length("fx_system_framework_migration_collision_head"."current_admission_sha256") = 32
        and (
          ("fx_system_framework_migration_collision_head"."current_attempt_storage_id" is null
            and "fx_system_framework_migration_collision_head"."current_attempt_id" is null
            and "fx_system_framework_migration_collision_head"."current_attempt_fence" is null
            and "fx_system_framework_migration_collision_head"."current_lease_owner_id" is null
            and "fx_system_framework_migration_collision_head"."current_lease_expires_at" is null)
          or
          ("fx_system_framework_migration_collision_head"."current_attempt_storage_id" is not null
            and "fx_system_framework_migration_collision_head"."current_attempt_id" is not null
            and
    octet_length(convert_to("fx_system_framework_migration_collision_head"."current_attempt_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_collision_head"."current_attempt_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

            and "fx_system_framework_migration_collision_head"."current_attempt_fence" is not null
            and "fx_system_framework_migration_collision_head"."current_attempt_fence" = "fx_system_framework_migration_collision_head"."attempt_fence"
            and "fx_system_framework_migration_collision_head"."current_lease_owner_id" is not null
            and
    octet_length(convert_to("fx_system_framework_migration_collision_head"."current_lease_owner_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_collision_head"."current_lease_owner_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

            and "fx_system_framework_migration_collision_head"."current_lease_expires_at" is not null
            and isfinite("fx_system_framework_migration_collision_head"."current_lease_expires_at"))
        )
        and (
          ("fx_system_framework_migration_collision_head"."last_event_storage_id" is null
            and "fx_system_framework_migration_collision_head"."last_event_sequence" is null
            and "fx_system_framework_migration_collision_head"."last_event_sha256" is null)
          or
          ("fx_system_framework_migration_collision_head"."last_event_storage_id" is not null
            and "fx_system_framework_migration_collision_head"."last_event_sequence" is not null
            and "fx_system_framework_migration_collision_head"."last_event_sequence" between 0 and 9223372036854775807
            and "fx_system_framework_migration_collision_head"."last_event_sha256" is not null
            and octet_length("fx_system_framework_migration_collision_head"."last_event_sha256") = 32)
        )
        and octet_length("fx_system_framework_migration_collision_head"."collision_head_sha256") = 32),
	CONSTRAINT "fx_framework_migration_collision_head_frame_check" CHECK ("fx_system_framework_migration_collision_head"."frame_format" = 'flarex.framework-migration-collision-head'
        and "fx_system_framework_migration_collision_head"."frame_version" = 1
        and
    "fx_system_framework_migration_collision_head"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_migration_collision_head"."canonical_bytes") = "fx_system_framework_migration_collision_head"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_event" (
	"event_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_migration_event_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collision_storage_id" bigint NOT NULL,
	"event_sequence" bigint NOT NULL,
	"event_sha256" "bytea" NOT NULL,
	"previous_event_storage_id" bigint,
	"previous_event_sequence" bigint,
	"previous_event_sha256" "bytea",
	"event_kind" text COLLATE "C" NOT NULL,
	"subject_sha256" "bytea",
	"lease_attempt_id" text COLLATE "C",
	"lease_attempt_fence" bigint,
	"lease_owner_id" text COLLATE "C",
	"lease_expires_at" timestamp (3) with time zone,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_event_pk" PRIMARY KEY("event_storage_id"),
	CONSTRAINT "fx_framework_migration_event_sequence_unique" UNIQUE("collision_storage_id","event_sequence"),
	CONSTRAINT "fx_framework_migration_event_digest_unique" UNIQUE("event_sha256"),
	CONSTRAINT "fx_framework_migration_event_reference_unique" UNIQUE("event_storage_id","collision_storage_id","event_sequence","event_sha256"),
	CONSTRAINT "fx_framework_migration_event_identity_check" CHECK ("fx_system_framework_migration_event"."event_storage_id" between 1 and 9223372036854775807
        and "fx_system_framework_migration_event"."event_sequence" between 0 and 9223372036854775807
        and octet_length("fx_system_framework_migration_event"."event_sha256") = 32
        and (
          ("fx_system_framework_migration_event"."previous_event_storage_id" is null
            and "fx_system_framework_migration_event"."previous_event_sequence" is null
            and "fx_system_framework_migration_event"."previous_event_sha256" is null)
          or
          ("fx_system_framework_migration_event"."previous_event_storage_id" is not null
            and "fx_system_framework_migration_event"."previous_event_sequence" is not null
            and "fx_system_framework_migration_event"."previous_event_sha256" is not null
            and "fx_system_framework_migration_event"."previous_event_sequence" < "fx_system_framework_migration_event"."event_sequence"
            and octet_length("fx_system_framework_migration_event"."previous_event_sha256") = 32)
        )
        and "fx_system_framework_migration_event"."event_kind" in (
          'planAdmitted', 'attemptStarted', 'leaseRenewed', 'stepCompleted',
          'attemptTerminated', 'installationPublished', 'readinessPublished'
        )
        and (
          ("fx_system_framework_migration_event"."event_kind" = 'leaseRenewed'
            and "fx_system_framework_migration_event"."subject_sha256" is null
            and "fx_system_framework_migration_event"."lease_attempt_id" is not null
            and
    octet_length(convert_to("fx_system_framework_migration_event"."lease_attempt_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_event"."lease_attempt_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

            and "fx_system_framework_migration_event"."lease_attempt_fence" is not null
            and "fx_system_framework_migration_event"."lease_attempt_fence" between 0 and 9223372036854775807
            and "fx_system_framework_migration_event"."lease_owner_id" is not null
            and
    octet_length(convert_to("fx_system_framework_migration_event"."lease_owner_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_event"."lease_owner_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

            and "fx_system_framework_migration_event"."lease_expires_at" is not null
            and isfinite("fx_system_framework_migration_event"."lease_expires_at"))
          or
          ("fx_system_framework_migration_event"."event_kind" <> 'leaseRenewed'
            and "fx_system_framework_migration_event"."subject_sha256" is not null
            and octet_length("fx_system_framework_migration_event"."subject_sha256") = 32
            and "fx_system_framework_migration_event"."lease_attempt_id" is null
            and "fx_system_framework_migration_event"."lease_attempt_fence" is null
            and "fx_system_framework_migration_event"."lease_owner_id" is null
            and "fx_system_framework_migration_event"."lease_expires_at" is null)
        )),
	CONSTRAINT "fx_framework_migration_event_frame_check" CHECK ("fx_system_framework_migration_event"."frame_format" = 'flarex.framework-migration-event'
        and "fx_system_framework_migration_event"."frame_version" = 1
        and
    "fx_system_framework_migration_event"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_migration_event"."canonical_bytes") = "fx_system_framework_migration_event"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_plan_admission" (
	"admission_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_migration_admission_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collision_storage_id" bigint NOT NULL,
	"plan_storage_id" bigint NOT NULL,
	"migration_plan_sha256" "bytea" NOT NULL,
	"previous_plan_storage_id" bigint,
	"previous_plan_sha256" "bytea",
	"admission_sha256" "bytea" NOT NULL,
	"admission_profile" text COLLATE "C" NOT NULL,
	"assignment_count" integer NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_admission_pk" PRIMARY KEY("admission_storage_id"),
	CONSTRAINT "fx_framework_migration_admission_digest_unique" UNIQUE("admission_sha256"),
	CONSTRAINT "fx_framework_migration_admission_reference_unique" UNIQUE("admission_storage_id","collision_storage_id","plan_storage_id","admission_sha256"),
	CONSTRAINT "fx_framework_migration_admission_context_unique" UNIQUE("admission_storage_id","collision_storage_id"),
	CONSTRAINT "fx_framework_migration_admission_identity_check" CHECK ("fx_system_framework_migration_plan_admission"."admission_storage_id" between 1 and 9223372036854775807
        and octet_length("fx_system_framework_migration_plan_admission"."migration_plan_sha256") = 32
        and octet_length("fx_system_framework_migration_plan_admission"."admission_sha256") = 32
        and (
          ("fx_system_framework_migration_plan_admission"."previous_plan_storage_id" is null
            and "fx_system_framework_migration_plan_admission"."previous_plan_sha256" is null)
          or
          ("fx_system_framework_migration_plan_admission"."previous_plan_storage_id" is not null
            and "fx_system_framework_migration_plan_admission"."previous_plan_sha256" is not null
            and octet_length("fx_system_framework_migration_plan_admission"."previous_plan_sha256") = 32)
        )
        and "fx_system_framework_migration_plan_admission"."admission_profile" = 'synthetic-system-fresh'
        and "fx_system_framework_migration_plan_admission"."assignment_count" between 0 and 131328),
	CONSTRAINT "fx_framework_migration_admission_frame_check" CHECK ("fx_system_framework_migration_plan_admission"."frame_format" = 'flarex.framework-migration-plan-admission'
        and "fx_system_framework_migration_plan_admission"."frame_version" = 1
        and
    "fx_system_framework_migration_plan_admission"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_migration_plan_admission"."canonical_bytes") = "fx_system_framework_migration_plan_admission"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_plan_step_dependency" (
	"plan_storage_id" bigint NOT NULL,
	"source_step_id" text COLLATE "C" NOT NULL,
	"dependency_ordinal" integer NOT NULL,
	"dependency_step_id" text COLLATE "C" NOT NULL,
	"dependency_step_sha256" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_step_dependency_pk" PRIMARY KEY("plan_storage_id","source_step_id","dependency_ordinal"),
	CONSTRAINT "fx_framework_migration_step_dependency_target_unique" UNIQUE("plan_storage_id","source_step_id","dependency_step_id"),
	CONSTRAINT "fx_framework_migration_step_dependency_identity_check" CHECK ("fx_system_framework_migration_plan_step_dependency"."dependency_ordinal" between 0 and 65999
        and "fx_system_framework_migration_plan_step_dependency"."source_step_id" <> "fx_system_framework_migration_plan_step_dependency"."dependency_step_id"
        and octet_length("fx_system_framework_migration_plan_step_dependency"."dependency_step_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_plan_step" (
	"plan_storage_id" bigint NOT NULL,
	"collision_storage_id" bigint NOT NULL,
	"step_ordinal" integer NOT NULL,
	"step_id" text COLLATE "C" NOT NULL,
	"step_sha256" "bytea" NOT NULL,
	"precondition_sha256" "bytea" NOT NULL,
	"postcondition_sha256" "bytea" NOT NULL,
	"phase" text COLLATE "C" NOT NULL,
	"operation_format" text COLLATE "C" NOT NULL,
	"operation_version" integer NOT NULL,
	"dependency_count" integer NOT NULL,
	CONSTRAINT "fx_framework_migration_plan_step_pk" PRIMARY KEY("plan_storage_id","step_ordinal"),
	CONSTRAINT "fx_framework_migration_plan_step_id_unique" UNIQUE("plan_storage_id","step_id"),
	CONSTRAINT "fx_framework_migration_plan_step_digest_unique" UNIQUE("plan_storage_id","step_sha256"),
	CONSTRAINT "fx_framework_migration_plan_step_reference_unique" UNIQUE("plan_storage_id","step_id","step_sha256"),
	CONSTRAINT "fx_framework_migration_plan_step_receipt_unique" UNIQUE("plan_storage_id","step_id","step_sha256","precondition_sha256","postcondition_sha256"),
	CONSTRAINT "fx_framework_migration_plan_step_identity_check" CHECK ("fx_system_framework_migration_plan_step"."step_ordinal" between 0 and 65999
        and "fx_system_framework_migration_plan_step"."step_id" ~ '^step_[0-9a-f]{32}$'
        and octet_length("fx_system_framework_migration_plan_step"."step_sha256") = 32
        and octet_length("fx_system_framework_migration_plan_step"."precondition_sha256") = 32
        and octet_length("fx_system_framework_migration_plan_step"."postcondition_sha256") = 32
        and "fx_system_framework_migration_plan_step"."phase" in ('expansion', 'validation')
        and "fx_system_framework_migration_plan_step"."operation_format" in (
          'flarex.relational-create-table',
          'flarex.relational-create-index',
          'flarex.relational-add-foreign-key',
          'flarex.relational-validate-structure'
        )
        and "fx_system_framework_migration_plan_step"."operation_version" = 1
        and "fx_system_framework_migration_plan_step"."dependency_count" between 0 and 65999)
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_plan" (
	"plan_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_migration_plan_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collision_storage_id" bigint NOT NULL,
	"artifact_sha256" "bytea" NOT NULL,
	"locator_kind" text COLLATE "C" NOT NULL,
	"locator_database_key" text COLLATE "C" NOT NULL,
	"locator_schema_name" text COLLATE "C" NOT NULL,
	"migration_plan_sha256" "bytea" NOT NULL,
	"required_step_set_sha256" "bytea" NOT NULL,
	"physical_layout_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_plan_pk" PRIMARY KEY("plan_storage_id"),
	CONSTRAINT "fx_framework_migration_plan_digest_unique" UNIQUE("migration_plan_sha256"),
	CONSTRAINT "fx_framework_migration_plan_context_unique" UNIQUE("plan_storage_id","collision_storage_id"),
	CONSTRAINT "fx_framework_migration_plan_reference_unique" UNIQUE("plan_storage_id","collision_storage_id","migration_plan_sha256"),
	CONSTRAINT "fx_framework_migration_plan_identity_check" CHECK ("fx_system_framework_migration_plan"."plan_storage_id" between 1 and 9223372036854775807
        and octet_length("fx_system_framework_migration_plan"."artifact_sha256") = 32
        and octet_length("fx_system_framework_migration_plan"."migration_plan_sha256") = 32
        and octet_length("fx_system_framework_migration_plan"."required_step_set_sha256") = 32
        and octet_length("fx_system_framework_migration_plan"."physical_layout_sha256") = 32
        and "fx_system_framework_migration_plan"."locator_kind" in (
          'shared_database', 'schema_per_scope', 'database_per_scope'
        )
        and
    octet_length(convert_to("fx_system_framework_migration_plan"."locator_database_key", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_migration_plan"."locator_database_key",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

        and
    octet_length(convert_to("fx_system_framework_migration_plan"."locator_schema_name", 'UTF8'))
      between 1 and 63
    and btrim("fx_system_framework_migration_plan"."locator_schema_name",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''
  ),
	CONSTRAINT "fx_framework_migration_plan_frame_check" CHECK ("fx_system_framework_migration_plan"."frame_format" = 'flarex.framework-migration-plan'
        and "fx_system_framework_migration_plan"."frame_version" = 1
        and
    "fx_system_framework_migration_plan"."canonical_byte_length" between 1 and 8388608
    and octet_length("fx_system_framework_migration_plan"."canonical_bytes") = "fx_system_framework_migration_plan"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_step_receipt_dependency" (
	"receipt_storage_id" bigint NOT NULL,
	"attempt_storage_id" bigint NOT NULL,
	"dependency_ordinal" integer NOT NULL,
	"dependency_receipt_storage_id" bigint NOT NULL,
	"dependency_step_id" text COLLATE "C" NOT NULL,
	"dependency_step_receipt_sha256" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_receipt_dependency_pk" PRIMARY KEY("receipt_storage_id","dependency_ordinal"),
	CONSTRAINT "fx_framework_migration_receipt_dependency_target_unique" UNIQUE("receipt_storage_id","dependency_receipt_storage_id"),
	CONSTRAINT "fx_framework_migration_receipt_dependency_identity_check" CHECK ("fx_system_framework_migration_step_receipt_dependency"."dependency_ordinal" between 0 and 65999
        and "fx_system_framework_migration_step_receipt_dependency"."receipt_storage_id" <> "fx_system_framework_migration_step_receipt_dependency"."dependency_receipt_storage_id"
        and "fx_system_framework_migration_step_receipt_dependency"."dependency_step_id" ~ '^step_[0-9a-f]{32}$'
        and octet_length("fx_system_framework_migration_step_receipt_dependency"."dependency_step_receipt_sha256") = 32)
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_migration_step_receipt" (
	"receipt_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_migration_receipt_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collision_storage_id" bigint NOT NULL,
	"plan_storage_id" bigint NOT NULL,
	"attempt_storage_id" bigint NOT NULL,
	"attempt_id" text COLLATE "C" NOT NULL,
	"attempt_fence" bigint NOT NULL,
	"step_id" text COLLATE "C" NOT NULL,
	"step_sha256" "bytea" NOT NULL,
	"precondition_sha256" "bytea" NOT NULL,
	"postcondition_sha256" "bytea" NOT NULL,
	"observed_postcondition_sha256" "bytea" NOT NULL,
	"dependency_count" integer NOT NULL,
	"step_receipt_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_migration_receipt_pk" PRIMARY KEY("receipt_storage_id"),
	CONSTRAINT "fx_framework_migration_receipt_attempt_step_unique" UNIQUE("attempt_storage_id","step_id"),
	CONSTRAINT "fx_framework_migration_receipt_digest_unique" UNIQUE("step_receipt_sha256"),
	CONSTRAINT "fx_framework_migration_receipt_source_unique" UNIQUE("receipt_storage_id","attempt_storage_id"),
	CONSTRAINT "fx_framework_migration_receipt_dependency_unique" UNIQUE("receipt_storage_id","attempt_storage_id","step_id","step_receipt_sha256"),
	CONSTRAINT "fx_framework_migration_receipt_terminal_unique" UNIQUE("receipt_storage_id","attempt_storage_id","step_receipt_sha256"),
	CONSTRAINT "fx_framework_migration_receipt_identity_check" CHECK ("fx_system_framework_migration_step_receipt"."receipt_storage_id" between 1 and 9223372036854775807
        and "fx_system_framework_migration_step_receipt"."attempt_fence" between 0 and 9223372036854775807
        and "fx_system_framework_migration_step_receipt"."step_id" ~ '^step_[0-9a-f]{32}$'
        and octet_length("fx_system_framework_migration_step_receipt"."step_sha256") = 32
        and octet_length("fx_system_framework_migration_step_receipt"."precondition_sha256") = 32
        and octet_length("fx_system_framework_migration_step_receipt"."postcondition_sha256") = 32
        and octet_length("fx_system_framework_migration_step_receipt"."observed_postcondition_sha256") = 32
        and "fx_system_framework_migration_step_receipt"."observed_postcondition_sha256" = "fx_system_framework_migration_step_receipt"."postcondition_sha256"
        and "fx_system_framework_migration_step_receipt"."dependency_count" between 0 and 65999
        and octet_length("fx_system_framework_migration_step_receipt"."step_receipt_sha256") = 32),
	CONSTRAINT "fx_framework_migration_receipt_frame_check" CHECK ("fx_system_framework_migration_step_receipt"."frame_format" = 'flarex.framework-migration-step-receipt'
        and "fx_system_framework_migration_step_receipt"."frame_version" = 1
        and
    "fx_system_framework_migration_step_receipt"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_migration_step_receipt"."canonical_bytes") = "fx_system_framework_migration_step_receipt"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_schema_availability_head" (
	"installation_storage_id" bigint NOT NULL,
	"readiness_storage_id" bigint NOT NULL,
	"availability_history_storage_id" bigint NOT NULL,
	"availability_sequence" bigint NOT NULL,
	"status" text COLLATE "C" NOT NULL,
	"history_sha256" "bytea" NOT NULL,
	"availability_head_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_availability_head_pk" PRIMARY KEY("installation_storage_id"),
	CONSTRAINT "fx_framework_availability_head_identity_check" CHECK ("fx_system_framework_schema_availability_head"."availability_sequence" between 1 and 9223372036854775807
        and "fx_system_framework_schema_availability_head"."status" in (
          'ready', 'withdrawn', 'superseded', 'quarantined'
        )
        and octet_length("fx_system_framework_schema_availability_head"."history_sha256") = 32
        and octet_length("fx_system_framework_schema_availability_head"."availability_head_sha256") = 32),
	CONSTRAINT "fx_framework_availability_head_frame_check" CHECK ("fx_system_framework_schema_availability_head"."frame_format" = 'flarex.framework-schema-availability-head'
        and "fx_system_framework_schema_availability_head"."frame_version" = 1
        and
    "fx_system_framework_schema_availability_head"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_schema_availability_head"."canonical_bytes") = "fx_system_framework_schema_availability_head"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_schema_availability_history" (
	"availability_history_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_availability_history_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_storage_id" bigint NOT NULL,
	"readiness_storage_id" bigint NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"availability_sequence" bigint NOT NULL,
	"status" text COLLATE "C" NOT NULL,
	"reason_sha256" "bytea",
	"history_sha256" "bytea" NOT NULL,
	"previous_history_storage_id" bigint,
	"previous_availability_sequence" bigint,
	"previous_history_sha256" "bytea",
	"previous_status" text COLLATE "C",
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_availability_history_pk" PRIMARY KEY("availability_history_storage_id"),
	CONSTRAINT "fx_framework_availability_history_sequence_unique" UNIQUE("installation_storage_id","availability_sequence"),
	CONSTRAINT "fx_framework_availability_history_digest_unique" UNIQUE("installation_storage_id","history_sha256"),
	CONSTRAINT "fx_framework_availability_history_reference_unique" UNIQUE("availability_history_storage_id","installation_storage_id","readiness_storage_id","availability_sequence","status","history_sha256"),
	CONSTRAINT "fx_framework_availability_history_identity_check" CHECK ("fx_system_framework_schema_availability_history"."availability_history_storage_id" between 1 and 9223372036854775807
        and "fx_system_framework_schema_availability_history"."availability_sequence" between 1 and 9223372036854775807
        and "fx_system_framework_schema_availability_history"."status" in (
          'ready', 'withdrawn', 'superseded', 'quarantined'
        )
        and octet_length("fx_system_framework_schema_availability_history"."readiness_sha256") = 32
        and octet_length("fx_system_framework_schema_availability_history"."history_sha256") = 32
        and (
          ("fx_system_framework_schema_availability_history"."availability_sequence" = 1
            and "fx_system_framework_schema_availability_history"."status" = 'ready'
            and "fx_system_framework_schema_availability_history"."reason_sha256" is null
            and "fx_system_framework_schema_availability_history"."previous_history_storage_id" is null
            and "fx_system_framework_schema_availability_history"."previous_availability_sequence" is null
            and "fx_system_framework_schema_availability_history"."previous_history_sha256" is null
            and "fx_system_framework_schema_availability_history"."previous_status" is null)
          or
          ("fx_system_framework_schema_availability_history"."availability_sequence" > 1
            and "fx_system_framework_schema_availability_history"."previous_history_storage_id" is not null
            and "fx_system_framework_schema_availability_history"."previous_availability_sequence" is not null
            and "fx_system_framework_schema_availability_history"."previous_availability_sequence" =
              "fx_system_framework_schema_availability_history"."availability_sequence" - 1
            and "fx_system_framework_schema_availability_history"."previous_history_sha256" is not null
            and octet_length("fx_system_framework_schema_availability_history"."previous_history_sha256") = 32
            and "fx_system_framework_schema_availability_history"."previous_status" is not null
            and "fx_system_framework_schema_availability_history"."previous_status" in (
              'ready', 'withdrawn', 'superseded', 'quarantined'
            )
            and "fx_system_framework_schema_availability_history"."previous_status" <> "fx_system_framework_schema_availability_history"."status"
            and (
              ("fx_system_framework_schema_availability_history"."status" = 'ready' and "fx_system_framework_schema_availability_history"."reason_sha256" is null)
              or
              ("fx_system_framework_schema_availability_history"."status" <> 'ready'
                and "fx_system_framework_schema_availability_history"."reason_sha256" is not null
                and octet_length("fx_system_framework_schema_availability_history"."reason_sha256") = 32)
            ))
        )),
	CONSTRAINT "fx_framework_availability_history_frame_check" CHECK ("fx_system_framework_schema_availability_history"."frame_format" = 'flarex.framework-schema-availability-history'
        and "fx_system_framework_schema_availability_history"."frame_version" = 1
        and
    "fx_system_framework_schema_availability_history"."canonical_byte_length" between 1 and 1048576
    and octet_length("fx_system_framework_schema_availability_history"."canonical_bytes") = "fx_system_framework_schema_availability_history"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_schema_installation" (
	"installation_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_installation_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collision_storage_id" bigint NOT NULL,
	"plan_storage_id" bigint NOT NULL,
	"migration_plan_sha256" "bytea" NOT NULL,
	"admission_storage_id" bigint NOT NULL,
	"admission_sha256" "bytea" NOT NULL,
	"terminal_storage_id" bigint NOT NULL,
	"terminal_outcome_kind" text COLLATE "C" NOT NULL,
	"terminal_sha256" "bytea" NOT NULL,
	"installation_sha256" "bytea" NOT NULL,
	"installation_receipt_sha256" "bytea" NOT NULL,
	"installed_structure_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_installation_pk" PRIMARY KEY("installation_storage_id"),
	CONSTRAINT "fx_framework_installation_identity_unique" UNIQUE("installation_sha256"),
	CONSTRAINT "fx_framework_installation_receipt_unique" UNIQUE("installation_receipt_sha256"),
	CONSTRAINT "fx_framework_installation_reference_unique" UNIQUE("installation_storage_id","installation_sha256","installation_receipt_sha256"),
	CONSTRAINT "fx_framework_installation_identity_check" CHECK ("fx_system_framework_schema_installation"."installation_storage_id" between 1 and 9223372036854775807
        and octet_length("fx_system_framework_schema_installation"."migration_plan_sha256") = 32
        and octet_length("fx_system_framework_schema_installation"."admission_sha256") = 32
        and "fx_system_framework_schema_installation"."terminal_outcome_kind" = 'succeeded'
        and octet_length("fx_system_framework_schema_installation"."terminal_sha256") = 32
        and octet_length("fx_system_framework_schema_installation"."installation_sha256") = 32
        and octet_length("fx_system_framework_schema_installation"."installation_receipt_sha256") = 32
        and octet_length("fx_system_framework_schema_installation"."installed_structure_sha256") = 32),
	CONSTRAINT "fx_framework_installation_frame_check" CHECK ("fx_system_framework_schema_installation"."frame_format" = 'flarex.framework-schema-installation'
        and "fx_system_framework_schema_installation"."frame_version" = 1
        and
    "fx_system_framework_schema_installation"."canonical_byte_length" between 1 and 4194304
    and octet_length("fx_system_framework_schema_installation"."canonical_bytes") = "fx_system_framework_schema_installation"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_schema_readiness" (
	"readiness_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_readiness_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"installation_storage_id" bigint NOT NULL,
	"installation_sha256" "bytea" NOT NULL,
	"installation_receipt_sha256" "bytea" NOT NULL,
	"readiness_sha256" "bytea" NOT NULL,
	"validation_sha256" "bytea" NOT NULL,
	"validated_structure_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_readiness_pk" PRIMARY KEY("readiness_storage_id"),
	CONSTRAINT "fx_framework_readiness_installation_unique" UNIQUE("installation_storage_id"),
	CONSTRAINT "fx_framework_readiness_digest_unique" UNIQUE("readiness_sha256"),
	CONSTRAINT "fx_framework_readiness_reference_unique" UNIQUE("readiness_storage_id","installation_storage_id","readiness_sha256"),
	CONSTRAINT "fx_framework_readiness_context_unique" UNIQUE("readiness_storage_id","installation_storage_id"),
	CONSTRAINT "fx_framework_readiness_identity_check" CHECK ("fx_system_framework_schema_readiness"."readiness_storage_id" between 1 and 9223372036854775807
        and octet_length("fx_system_framework_schema_readiness"."installation_sha256") = 32
        and octet_length("fx_system_framework_schema_readiness"."installation_receipt_sha256") = 32
        and octet_length("fx_system_framework_schema_readiness"."readiness_sha256") = 32
        and octet_length("fx_system_framework_schema_readiness"."validation_sha256") = 32
        and octet_length("fx_system_framework_schema_readiness"."validated_structure_sha256") = 32),
	CONSTRAINT "fx_framework_readiness_frame_check" CHECK ("fx_system_framework_schema_readiness"."frame_format" = 'flarex.framework-schema-readiness'
        and "fx_system_framework_schema_readiness"."frame_version" = 1
        and
    "fx_system_framework_schema_readiness"."canonical_byte_length" between 1 and 4194304
    and octet_length("fx_system_framework_schema_readiness"."canonical_bytes") = "fx_system_framework_schema_readiness"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_framework_schema_target_namespace" (
	"target_namespace_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_framework_target_namespace_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"deployment_id" text COLLATE "C" NOT NULL,
	"physical_database_identity" text COLLATE "C" NOT NULL,
	"schema_name" text COLLATE "C" NOT NULL,
	"target_namespace_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_framework_target_namespace_pk" PRIMARY KEY("target_namespace_storage_id"),
	CONSTRAINT "fx_framework_target_namespace_coordinate_unique" UNIQUE("deployment_id","physical_database_identity","schema_name"),
	CONSTRAINT "fx_framework_target_namespace_digest_unique" UNIQUE("target_namespace_sha256"),
	CONSTRAINT "fx_framework_target_namespace_physical_unique" UNIQUE("target_namespace_storage_id","physical_database_identity","schema_name"),
	CONSTRAINT "fx_framework_target_namespace_identity_check" CHECK ("fx_system_framework_schema_target_namespace"."target_namespace_storage_id" between 1 and 9223372036854775807
        and
    octet_length(convert_to("fx_system_framework_schema_target_namespace"."deployment_id", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_schema_target_namespace"."deployment_id",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

        and
    octet_length(convert_to("fx_system_framework_schema_target_namespace"."physical_database_identity", 'UTF8'))
      between 1 and 512
    and btrim("fx_system_framework_schema_target_namespace"."physical_database_identity",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

        and
    octet_length(convert_to("fx_system_framework_schema_target_namespace"."schema_name", 'UTF8'))
      between 1 and 63
    and btrim("fx_system_framework_schema_target_namespace"."schema_name",
  chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
  chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
  chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
  chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
  chr(8239) || chr(8287) || chr(12288) || chr(65279)
) <> ''

        and octet_length("fx_system_framework_schema_target_namespace"."target_namespace_sha256") = 32),
	CONSTRAINT "fx_framework_target_namespace_frame_check" CHECK ("fx_system_framework_schema_target_namespace"."frame_format" = 'flarex.framework-schema-target-namespace'
        and "fx_system_framework_schema_target_namespace"."frame_version" = 1
        and
    "fx_system_framework_schema_target_namespace"."canonical_byte_length" between 1 and 4096
    and octet_length("fx_system_framework_schema_target_namespace"."canonical_bytes") = "fx_system_framework_schema_target_namespace"."canonical_byte_length"
  )
);
--> statement-breakpoint
CREATE TABLE "fx_system_relational_physical_name_assignment" (
	"assignment_storage_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "fx_relational_name_assignment_storage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collision_storage_id" bigint NOT NULL,
	"physical_database_identity" text COLLATE "C" NOT NULL,
	"schema_name" text COLLATE "C" NOT NULL,
	"spelling" text COLLATE "C" NOT NULL,
	"name_sha256" "bytea" NOT NULL,
	"assignment_sha256" "bytea" NOT NULL,
	"frame_format" text COLLATE "C" NOT NULL,
	"frame_version" integer NOT NULL,
	"canonical_byte_length" integer NOT NULL,
	"canonical_bytes" "bytea" NOT NULL,
	CONSTRAINT "fx_relational_name_assignment_pk" PRIMARY KEY("assignment_storage_id"),
	CONSTRAINT "fx_relational_name_assignment_digest_unique" UNIQUE("assignment_sha256"),
	CONSTRAINT "fx_relational_name_assignment_spelling_unique" UNIQUE("physical_database_identity","schema_name","spelling"),
	CONSTRAINT "fx_relational_name_assignment_reference_unique" UNIQUE("assignment_storage_id","collision_storage_id","spelling","assignment_sha256"),
	CONSTRAINT "fx_relational_name_assignment_identity_check" CHECK ("fx_system_relational_physical_name_assignment"."assignment_storage_id" between 1 and 9223372036854775807
        and "fx_system_relational_physical_name_assignment"."spelling" ~ '^fxr[tcikfh]_[0-9a-v]{52}$'
        and octet_length(convert_to("fx_system_relational_physical_name_assignment"."spelling", 'UTF8')) = 57
        and octet_length("fx_system_relational_physical_name_assignment"."name_sha256") = 32
        and octet_length("fx_system_relational_physical_name_assignment"."assignment_sha256") = 32),
	CONSTRAINT "fx_relational_name_assignment_frame_check" CHECK ("fx_system_relational_physical_name_assignment"."frame_format" = 'flarex.relational-physical-name-assignment'
        and "fx_system_relational_physical_name_assignment"."frame_version" = 1
        and
    "fx_system_relational_physical_name_assignment"."canonical_byte_length" between 1 and 20480
    and octet_length("fx_system_relational_physical_name_assignment"."canonical_bytes") = "fx_system_relational_physical_name_assignment"."canonical_byte_length"
  )
);
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_admission_assignment" ADD CONSTRAINT "fx_framework_migration_admission_assignment_parent_fk" FOREIGN KEY ("admission_storage_id","collision_storage_id") REFERENCES "fx_system_framework_migration_plan_admission"("admission_storage_id","collision_storage_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_admission_assignment" ADD CONSTRAINT "fx_framework_migration_admission_assignment_value_fk" FOREIGN KEY ("assignment_storage_id","collision_storage_id","spelling","assignment_sha256") REFERENCES "fx_system_relational_physical_name_assignment"("assignment_storage_id","collision_storage_id","spelling","assignment_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_attempt_start" ADD CONSTRAINT "fx_framework_migration_attempt_plan_fk" FOREIGN KEY ("plan_storage_id","collision_storage_id","migration_plan_sha256") REFERENCES "fx_system_framework_migration_plan"("plan_storage_id","collision_storage_id","migration_plan_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_attempt_start" ADD CONSTRAINT "fx_framework_migration_attempt_admission_fk" FOREIGN KEY ("admission_storage_id","collision_storage_id","plan_storage_id","admission_sha256") REFERENCES "fx_system_framework_migration_plan_admission"("admission_storage_id","collision_storage_id","plan_storage_id","admission_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_attempt_start" ADD CONSTRAINT "fx_framework_migration_attempt_previous_fk" FOREIGN KEY ("previous_attempt_storage_id","collision_storage_id","previous_attempt_id") REFERENCES "fx_system_framework_migration_attempt_start"("attempt_storage_id","collision_storage_id","attempt_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_attempt_terminal" ADD CONSTRAINT "fx_framework_migration_terminal_attempt_fk" FOREIGN KEY ("attempt_storage_id","collision_storage_id","plan_storage_id","admission_storage_id","admission_sha256","attempt_id","attempt_fence") REFERENCES "fx_system_framework_migration_attempt_start"("attempt_storage_id","collision_storage_id","plan_storage_id","admission_storage_id","admission_sha256","attempt_id","attempt_fence") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_attempt_terminal" ADD CONSTRAINT "fx_framework_migration_terminal_last_receipt_fk" FOREIGN KEY ("last_receipt_storage_id","attempt_storage_id","last_step_receipt_sha256") REFERENCES "fx_system_framework_migration_step_receipt"("receipt_storage_id","attempt_storage_id","step_receipt_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_domain" ADD CONSTRAINT "fx_framework_migration_collision_target_fk" FOREIGN KEY ("target_namespace_storage_id","physical_database_identity","schema_name") REFERENCES "fx_system_framework_schema_target_namespace"("target_namespace_storage_id","physical_database_identity","schema_name") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ADD CONSTRAINT "fx_framework_migration_collision_head_plan_fk" FOREIGN KEY ("current_plan_storage_id","collision_storage_id","current_plan_sha256") REFERENCES "fx_system_framework_migration_plan"("plan_storage_id","collision_storage_id","migration_plan_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ADD CONSTRAINT "fx_framework_migration_collision_head_admission_fk" FOREIGN KEY ("current_admission_storage_id","collision_storage_id","current_plan_storage_id","current_admission_sha256") REFERENCES "fx_system_framework_migration_plan_admission"("admission_storage_id","collision_storage_id","plan_storage_id","admission_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ADD CONSTRAINT "fx_framework_migration_collision_head_attempt_fk" FOREIGN KEY ("current_attempt_storage_id","collision_storage_id","current_plan_storage_id","current_admission_storage_id","current_admission_sha256","current_attempt_id","current_attempt_fence") REFERENCES "fx_system_framework_migration_attempt_start"("attempt_storage_id","collision_storage_id","plan_storage_id","admission_storage_id","admission_sha256","attempt_id","attempt_fence") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ADD CONSTRAINT "fx_framework_migration_collision_head_event_fk" FOREIGN KEY ("last_event_storage_id","collision_storage_id","last_event_sequence","last_event_sha256") REFERENCES "fx_system_framework_migration_event"("event_storage_id","collision_storage_id","event_sequence","event_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_event" ADD CONSTRAINT "fx_framework_migration_event_collision_fk" FOREIGN KEY ("collision_storage_id") REFERENCES "fx_system_framework_migration_collision_domain"("collision_storage_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_event" ADD CONSTRAINT "fx_framework_migration_event_previous_fk" FOREIGN KEY ("previous_event_storage_id","collision_storage_id","previous_event_sequence","previous_event_sha256") REFERENCES "fx_system_framework_migration_event"("event_storage_id","collision_storage_id","event_sequence","event_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_admission" ADD CONSTRAINT "fx_framework_migration_admission_plan_fk" FOREIGN KEY ("plan_storage_id","collision_storage_id","migration_plan_sha256") REFERENCES "fx_system_framework_migration_plan"("plan_storage_id","collision_storage_id","migration_plan_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_admission" ADD CONSTRAINT "fx_framework_migration_admission_previous_plan_fk" FOREIGN KEY ("previous_plan_storage_id","collision_storage_id","previous_plan_sha256") REFERENCES "fx_system_framework_migration_plan"("plan_storage_id","collision_storage_id","migration_plan_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_step_dependency" ADD CONSTRAINT "fx_framework_migration_step_dependency_source_fk" FOREIGN KEY ("plan_storage_id","source_step_id") REFERENCES "fx_system_framework_migration_plan_step"("plan_storage_id","step_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_step_dependency" ADD CONSTRAINT "fx_framework_migration_step_dependency_target_fk" FOREIGN KEY ("plan_storage_id","dependency_step_id","dependency_step_sha256") REFERENCES "fx_system_framework_migration_plan_step"("plan_storage_id","step_id","step_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan_step" ADD CONSTRAINT "fx_framework_migration_plan_step_plan_fk" FOREIGN KEY ("plan_storage_id","collision_storage_id") REFERENCES "fx_system_framework_migration_plan"("plan_storage_id","collision_storage_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_plan" ADD CONSTRAINT "fx_framework_migration_plan_collision_fk" FOREIGN KEY ("collision_storage_id") REFERENCES "fx_system_framework_migration_collision_domain"("collision_storage_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" ADD CONSTRAINT "fx_framework_migration_receipt_dependency_source_fk" FOREIGN KEY ("receipt_storage_id","attempt_storage_id") REFERENCES "fx_system_framework_migration_step_receipt"("receipt_storage_id","attempt_storage_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" ADD CONSTRAINT "fx_framework_migration_receipt_dependency_target_fk" FOREIGN KEY ("dependency_receipt_storage_id","attempt_storage_id","dependency_step_id","dependency_step_receipt_sha256") REFERENCES "fx_system_framework_migration_step_receipt"("receipt_storage_id","attempt_storage_id","step_id","step_receipt_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" ADD CONSTRAINT "fx_framework_migration_receipt_attempt_fk" FOREIGN KEY ("attempt_storage_id","collision_storage_id","plan_storage_id","attempt_id","attempt_fence") REFERENCES "fx_system_framework_migration_attempt_start"("attempt_storage_id","collision_storage_id","plan_storage_id","attempt_id","attempt_fence") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" ADD CONSTRAINT "fx_framework_migration_receipt_plan_step_fk" FOREIGN KEY ("plan_storage_id","step_id","step_sha256","precondition_sha256","postcondition_sha256") REFERENCES "fx_system_framework_migration_plan_step"("plan_storage_id","step_id","step_sha256","precondition_sha256","postcondition_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_schema_availability_head" ADD CONSTRAINT "fx_framework_availability_head_readiness_fk" FOREIGN KEY ("readiness_storage_id","installation_storage_id") REFERENCES "fx_system_framework_schema_readiness"("readiness_storage_id","installation_storage_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_schema_availability_head" ADD CONSTRAINT "fx_framework_availability_head_history_fk" FOREIGN KEY ("availability_history_storage_id","installation_storage_id","readiness_storage_id","availability_sequence","status","history_sha256") REFERENCES "fx_system_framework_schema_availability_history"("availability_history_storage_id","installation_storage_id","readiness_storage_id","availability_sequence","status","history_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_schema_availability_history" ADD CONSTRAINT "fx_framework_availability_history_readiness_fk" FOREIGN KEY ("readiness_storage_id","installation_storage_id","readiness_sha256") REFERENCES "fx_system_framework_schema_readiness"("readiness_storage_id","installation_storage_id","readiness_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_schema_availability_history" ADD CONSTRAINT "fx_framework_availability_history_previous_fk" FOREIGN KEY ("previous_history_storage_id","installation_storage_id","readiness_storage_id","previous_availability_sequence","previous_status","previous_history_sha256") REFERENCES "fx_system_framework_schema_availability_history"("availability_history_storage_id","installation_storage_id","readiness_storage_id","availability_sequence","status","history_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_schema_installation" ADD CONSTRAINT "fx_framework_installation_plan_fk" FOREIGN KEY ("plan_storage_id","collision_storage_id","migration_plan_sha256") REFERENCES "fx_system_framework_migration_plan"("plan_storage_id","collision_storage_id","migration_plan_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_schema_installation" ADD CONSTRAINT "fx_framework_installation_admission_fk" FOREIGN KEY ("admission_storage_id","collision_storage_id","plan_storage_id","admission_sha256") REFERENCES "fx_system_framework_migration_plan_admission"("admission_storage_id","collision_storage_id","plan_storage_id","admission_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_schema_installation" ADD CONSTRAINT "fx_framework_installation_terminal_fk" FOREIGN KEY ("terminal_storage_id","collision_storage_id","plan_storage_id","admission_storage_id","admission_sha256","terminal_outcome_kind","terminal_sha256") REFERENCES "fx_system_framework_migration_attempt_terminal"("terminal_storage_id","collision_storage_id","plan_storage_id","admission_storage_id","admission_sha256","outcome_kind","attempt_terminal_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_schema_readiness" ADD CONSTRAINT "fx_framework_readiness_installation_fk" FOREIGN KEY ("installation_storage_id","installation_sha256","installation_receipt_sha256") REFERENCES "fx_system_framework_schema_installation"("installation_storage_id","installation_sha256","installation_receipt_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_relational_physical_name_assignment" ADD CONSTRAINT "fx_relational_name_assignment_collision_fk" FOREIGN KEY ("collision_storage_id","physical_database_identity","schema_name") REFERENCES "fx_system_framework_migration_collision_domain"("collision_storage_id","physical_database_identity","schema_name") ON DELETE restrict ON UPDATE restrict;
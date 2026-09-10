CREATE TABLE "fx_system_commit_event_delivery" (
	"scope_uuid" uuid NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"event_ordinal" integer NOT NULL,
	"subscriber_id" text NOT NULL,
	"handler_revision" text NOT NULL,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"fence" bigint DEFAULT 0 NOT NULL,
	"owner" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"failure_code" text,
	"settled_at" timestamp with time zone,
	CONSTRAINT "fx_system_commit_event_delivery_scope_uuid_epoch_uuid_commit_seq_event_ordinal_subscriber_id_pk" PRIMARY KEY("scope_uuid","epoch_uuid","commit_seq","event_ordinal","subscriber_id"),
	CONSTRAINT "fx_commit_event_delivery_values_check" CHECK ("fx_system_commit_event_delivery"."subscriber_id" ~ '^[a-zA-Z][a-zA-Z0-9._-]{0,127}$'
    and "fx_system_commit_event_delivery"."handler_revision" ~ '^[0-9a-f]{64}$' and "fx_system_commit_event_delivery"."attempts" between 0 and 5 and "fx_system_commit_event_delivery"."fence" >= 0
    and "fx_system_commit_event_delivery"."state" in ('pending', 'claimed', 'delivered', 'failed')
    and isfinite("fx_system_commit_event_delivery"."next_attempt_at") and ("fx_system_commit_event_delivery"."failure_code" is null or octet_length("fx_system_commit_event_delivery"."failure_code") between 1 and 128)
    and (("fx_system_commit_event_delivery"."state" = 'claimed' and "fx_system_commit_event_delivery"."owner" is not null and octet_length("fx_system_commit_event_delivery"."owner") between 1 and 128 and "fx_system_commit_event_delivery"."lease_expires_at" is not null and isfinite("fx_system_commit_event_delivery"."lease_expires_at") and "fx_system_commit_event_delivery"."attempts" > 0)
      or ("fx_system_commit_event_delivery"."state" <> 'claimed' and "fx_system_commit_event_delivery"."owner" is null and "fx_system_commit_event_delivery"."lease_expires_at" is null))
    and (("fx_system_commit_event_delivery"."state" in ('delivered', 'failed') and "fx_system_commit_event_delivery"."settled_at" is not null and isfinite("fx_system_commit_event_delivery"."settled_at"))
      or ("fx_system_commit_event_delivery"."state" in ('pending', 'claimed') and "fx_system_commit_event_delivery"."settled_at" is null)))
);
--> statement-breakpoint
CREATE TABLE "fx_system_commit_event" (
	"scope_uuid" uuid NOT NULL,
	"epoch_uuid" uuid NOT NULL,
	"commit_seq" bigint NOT NULL,
	"event_ordinal" integer NOT NULL,
	"envelope" jsonb NOT NULL,
	CONSTRAINT "fx_system_commit_event_scope_uuid_epoch_uuid_commit_seq_event_ordinal_pk" PRIMARY KEY("scope_uuid","epoch_uuid","commit_seq","event_ordinal"),
	CONSTRAINT "fx_commit_event_values_check" CHECK ("fx_system_commit_event"."event_ordinal" between 0 and 63 and jsonb_typeof("fx_system_commit_event"."envelope") = 'object' and octet_length("fx_system_commit_event"."envelope"::text) <= 131072)
);
--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD COLUMN "event_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD COLUMN "event_sha256" text;--> statement-breakpoint
ALTER TABLE "fx_system_commit_event_delivery" ADD CONSTRAINT "fx_commit_event_delivery_event_fk" FOREIGN KEY ("scope_uuid","epoch_uuid","commit_seq","event_ordinal") REFERENCES "fx_system_commit_event"("scope_uuid","epoch_uuid","commit_seq","event_ordinal") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_commit_event" ADD CONSTRAINT "fx_commit_event_header_fk" FOREIGN KEY ("scope_uuid","epoch_uuid","commit_seq") REFERENCES "fx_system_commit"("scope_uuid","epoch_uuid","commit_seq") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fx_commit_event_delivery_due_idx" ON "fx_system_commit_event_delivery" USING btree ("scope_uuid","epoch_uuid","state","next_attempt_at","commit_seq");--> statement-breakpoint
CREATE INDEX "fx_commit_event_directory_idx" ON "fx_system_commit" USING btree ("scope_uuid","epoch_uuid","commit_seq") WHERE "fx_system_commit"."event_count" > 0;--> statement-breakpoint
CREATE INDEX "fx_commit_event_free_history_idx" ON "fx_system_commit" USING btree ("scope_uuid","commit_seq") WHERE "fx_system_commit"."event_count" = 0;--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD CONSTRAINT "fx_system_commit_event_count_check" CHECK ("fx_system_commit"."event_count" between 0 and 64);--> statement-breakpoint
ALTER TABLE "fx_system_commit" ADD CONSTRAINT "fx_system_commit_event_digest_check" CHECK (("fx_system_commit"."event_count" = 0 and "fx_system_commit"."event_sha256" is null) or ("fx_system_commit"."event_count" > 0 and "fx_system_commit"."event_sha256" is not null and "fx_system_commit"."event_sha256" ~ '^[0-9a-f]{64}$'));
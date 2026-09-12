LOCK TABLE "fx_app_row_rev" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "fx_app_row_rev" DROP CONSTRAINT "fx_app_row_rev_value_state_check";--> statement-breakpoint
ALTER TABLE "fx_app_row_rev" DROP COLUMN "value_json";--> statement-breakpoint
ALTER TABLE "fx_app_row_rev" ADD CONSTRAINT "fx_app_row_rev_value_state_check" CHECK (
        (
          "fx_app_row_rev"."is_tombstone"
          and "fx_app_row_rev"."value_bytes" is null
          and "fx_app_row_rev"."value_sha256" is null
        )
        or
        (
          not "fx_app_row_rev"."is_tombstone"
          and "fx_app_row_rev"."value_bytes" is not null
          and octet_length("fx_app_row_rev"."value_bytes") > 0
          and "fx_app_row_rev"."value_sha256" is not null
          and octet_length("fx_app_row_rev"."value_sha256") = 32
        )
      );
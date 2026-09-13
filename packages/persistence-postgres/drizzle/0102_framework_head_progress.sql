ALTER TABLE "fx_system_framework_migration_collision_head" ADD COLUMN "completed_step_count" integer;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ADD COLUMN "last_receipt_storage_id" bigint;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ADD COLUMN "last_step_receipt_sha256" "bytea";--> statement-breakpoint
-- The selected event tail, not all receipts in the database, owns progress.
-- This migration runs inside the migrator's transaction. Refuse inconsistent
-- historical positions instead of choosing a receipt or resetting a count.
DO $$
DECLARE
  selected_head record;
  selected_event record;
  selected_receipt record;
  cursor_id bigint;
  previous_sequence bigint;
  next_ordinal integer;
  completed integer;
  tail_id bigint;
  tail_digest bytea;
BEGIN
  FOR selected_head IN SELECT * FROM fx_system_framework_migration_collision_head FOR UPDATE LOOP
    cursor_id := selected_head.last_event_storage_id;
    previous_sequence := NULL;
    next_ordinal := NULL;
    completed := 0;
    tail_id := NULL;
    tail_digest := NULL;
    WHILE cursor_id IS NOT NULL LOOP
      SELECT * INTO STRICT selected_event FROM fx_system_framework_migration_event WHERE event_storage_id = cursor_id;
      IF selected_event.collision_storage_id <> selected_head.collision_storage_id
        OR (previous_sequence IS NOT NULL AND selected_event.event_sequence >= previous_sequence) THEN
        RAISE EXCEPTION 'Invalid framework progress event chain';
      END IF;
      IF selected_event.event_kind = 'stepCompleted' THEN
        SELECT r.*, s.step_ordinal INTO STRICT selected_receipt
          FROM fx_system_framework_migration_step_receipt r
          JOIN fx_system_framework_migration_plan_step s ON s.plan_storage_id = r.plan_storage_id AND s.step_id = r.step_id
          WHERE r.step_receipt_sha256 = selected_event.subject_sha256;
        IF selected_receipt.plan_storage_id = selected_head.current_plan_storage_id THEN
          IF selected_receipt.attempt_fence > selected_head.attempt_fence THEN
            RAISE EXCEPTION 'Invalid framework progress producer';
          END IF;
          IF next_ordinal IS NULL THEN
            next_ordinal := selected_receipt.step_ordinal;
            tail_id := selected_receipt.receipt_storage_id;
            tail_digest := selected_receipt.step_receipt_sha256;
          END IF;
          IF selected_receipt.step_ordinal <> next_ordinal THEN
            RAISE EXCEPTION 'Non-contiguous framework progress';
          END IF;
          next_ordinal := next_ordinal - 1;
          completed := completed + 1;
        END IF;
      END IF;
      previous_sequence := selected_event.event_sequence;
      cursor_id := selected_event.previous_event_storage_id;
    END LOOP;
    IF next_ordinal IS NOT NULL AND next_ordinal <> -1 THEN
      RAISE EXCEPTION 'Missing framework progress prefix';
    END IF;
    UPDATE fx_system_framework_migration_collision_head SET completed_step_count = completed,
      last_receipt_storage_id = tail_id, last_step_receipt_sha256 = tail_digest
      WHERE collision_storage_id = selected_head.collision_storage_id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ALTER COLUMN "completed_step_count" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ADD CONSTRAINT "fx_framework_migration_collision_head_receipt_fk" FOREIGN KEY ("last_receipt_storage_id","current_plan_storage_id","last_step_receipt_sha256") REFERENCES "fx_system_framework_migration_step_receipt"("receipt_storage_id","plan_storage_id","step_receipt_sha256") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_collision_head" ADD CONSTRAINT "fx_framework_migration_collision_head_progress_check" CHECK (
      ("fx_system_framework_migration_collision_head"."completed_step_count" = 0 and "fx_system_framework_migration_collision_head"."last_receipt_storage_id" is null
        and "fx_system_framework_migration_collision_head"."last_step_receipt_sha256" is null)
      or ("fx_system_framework_migration_collision_head"."completed_step_count" > 0 and "fx_system_framework_migration_collision_head"."last_receipt_storage_id" is not null
        and "fx_system_framework_migration_collision_head"."last_step_receipt_sha256" is not null
        and octet_length("fx_system_framework_migration_collision_head"."last_step_receipt_sha256") = 32)
    );
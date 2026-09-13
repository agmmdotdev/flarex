-- Preserve each original completion; cloned development histories fail the plan-step unique constraint.
-- The migrator owns one transaction, including the narrowly scoped sidecar projection update.
ALTER TABLE "fx_system_framework_migration_attempt_terminal" DROP CONSTRAINT "fx_framework_migration_terminal_last_receipt_fk";
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" DROP CONSTRAINT "fx_framework_migration_receipt_dependency_source_fk";
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" DROP CONSTRAINT "fx_framework_migration_receipt_dependency_target_fk";
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" DROP CONSTRAINT "fx_framework_migration_receipt_attempt_step_unique";
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" DROP CONSTRAINT "fx_framework_migration_receipt_source_unique";
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" DROP CONSTRAINT "fx_framework_migration_receipt_dependency_unique";
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" DROP CONSTRAINT "fx_framework_migration_receipt_terminal_unique";
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" RENAME COLUMN "attempt_storage_id" TO "plan_storage_id";
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" DISABLE TRIGGER fx_framework_history_immutable;
--> statement-breakpoint
UPDATE "fx_system_framework_migration_step_receipt_dependency" AS dependency SET plan_storage_id = receipt.plan_storage_id FROM "fx_system_framework_migration_step_receipt" AS receipt WHERE receipt.receipt_storage_id = dependency.receipt_storage_id;
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" ENABLE TRIGGER fx_framework_history_immutable;
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" ADD CONSTRAINT "fx_framework_migration_receipt_plan_step_unique" UNIQUE("plan_storage_id","step_id");
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" ADD CONSTRAINT "fx_framework_migration_receipt_source_unique" UNIQUE("receipt_storage_id","plan_storage_id");
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" ADD CONSTRAINT "fx_framework_migration_receipt_dependency_unique" UNIQUE("receipt_storage_id","plan_storage_id","step_id","step_receipt_sha256");
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt" ADD CONSTRAINT "fx_framework_migration_receipt_terminal_unique" UNIQUE("receipt_storage_id","plan_storage_id","step_receipt_sha256");
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_attempt_terminal" ADD CONSTRAINT "fx_framework_migration_terminal_last_receipt_fk" FOREIGN KEY ("last_receipt_storage_id","plan_storage_id","last_step_receipt_sha256") REFERENCES "fx_system_framework_migration_step_receipt"("receipt_storage_id","plan_storage_id","step_receipt_sha256") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" ADD CONSTRAINT "fx_framework_migration_receipt_dependency_source_fk" FOREIGN KEY ("receipt_storage_id","plan_storage_id") REFERENCES "fx_system_framework_migration_step_receipt"("receipt_storage_id","plan_storage_id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "fx_system_framework_migration_step_receipt_dependency" ADD CONSTRAINT "fx_framework_migration_receipt_dependency_target_fk" FOREIGN KEY ("dependency_receipt_storage_id","plan_storage_id","dependency_step_id","dependency_step_receipt_sha256") REFERENCES "fx_system_framework_migration_step_receipt"("receipt_storage_id","plan_storage_id","step_id","step_receipt_sha256") ON DELETE restrict ON UPDATE restrict;

import { readFile } from "node:fs/promises";

/** Test-only historical input matching migration 0080. Call inside an owned
 * fixture transaction; this is not a down migration or runtime repair path. */
export async function restoreAttemptScopedReceiptFixture(
  query: (statement: string) => PromiseLike<unknown>,
): Promise<void> {
  const receipt = "fx_system_framework_migration_step_receipt";
  const dependency = "fx_system_framework_migration_step_receipt_dependency";
  const terminal = "fx_system_framework_migration_attempt_terminal";
  for (const statement of [
    `alter table ${terminal} drop constraint fx_framework_migration_terminal_last_receipt_fk`,
    `alter table ${dependency} drop constraint fx_framework_migration_receipt_dependency_source_fk`,
    `alter table ${dependency} drop constraint fx_framework_migration_receipt_dependency_target_fk`,
    `alter table ${receipt} drop constraint fx_framework_migration_receipt_plan_step_unique`,
    `alter table ${receipt} drop constraint fx_framework_migration_receipt_source_unique`,
    `alter table ${receipt} drop constraint fx_framework_migration_receipt_dependency_unique`,
    `alter table ${receipt} drop constraint fx_framework_migration_receipt_terminal_unique`,
    `alter table ${dependency} rename column plan_storage_id to attempt_storage_id`,
    `alter table ${dependency} disable trigger fx_framework_history_immutable`,
    `update ${dependency} d set attempt_storage_id = r.attempt_storage_id from ${receipt} r where r.receipt_storage_id = d.receipt_storage_id`,
    `alter table ${dependency} enable trigger fx_framework_history_immutable`,
    `alter table ${receipt} add constraint fx_framework_migration_receipt_attempt_step_unique unique(attempt_storage_id, step_id)`,
    `alter table ${receipt} add constraint fx_framework_migration_receipt_source_unique unique(receipt_storage_id, attempt_storage_id)`,
    `alter table ${receipt} add constraint fx_framework_migration_receipt_dependency_unique unique(receipt_storage_id, attempt_storage_id, step_id, step_receipt_sha256)`,
    `alter table ${receipt} add constraint fx_framework_migration_receipt_terminal_unique unique(receipt_storage_id, attempt_storage_id, step_receipt_sha256)`,
    `alter table ${terminal} add constraint fx_framework_migration_terminal_last_receipt_fk foreign key(last_receipt_storage_id, attempt_storage_id, last_step_receipt_sha256) references ${receipt}(receipt_storage_id, attempt_storage_id, step_receipt_sha256) on update restrict on delete restrict`,
    `alter table ${dependency} add constraint fx_framework_migration_receipt_dependency_source_fk foreign key(receipt_storage_id, attempt_storage_id) references ${receipt}(receipt_storage_id, attempt_storage_id) on update restrict on delete restrict`,
    `alter table ${dependency} add constraint fx_framework_migration_receipt_dependency_target_fk foreign key(dependency_receipt_storage_id, attempt_storage_id, dependency_step_id, dependency_step_receipt_sha256) references ${receipt}(receipt_storage_id, attempt_storage_id, step_id, step_receipt_sha256) on update restrict on delete restrict`,
  ]) await query(statement);
}

export async function planReceiptMigrationStatements(): Promise<readonly string[]> {
  return (await readFile(new URL("../drizzle/0101_framework_plan_receipts.sql", import.meta.url), "utf8"))
    .split("--> statement-breakpoint").filter(statement => statement.trim().length > 0);
}

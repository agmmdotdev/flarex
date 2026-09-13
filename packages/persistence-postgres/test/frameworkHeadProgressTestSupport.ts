import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { Schema } from "effect";
import { expect } from "vitest";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { fxSystemFrameworkMigrationCollisionHeads, fxSystemFrameworkMigrationPlanSteps,
  fxSystemFrameworkMigrationStepReceipts } from "../src/migrationCoordination/schema";
import { withAdministrativeFrameworkMetadataRepair } from "./frameworkMetadataRepairTestSupport";

const decodeColumnRows = Schema.decodeUnknownSync(Schema.Struct({ rows: Schema.Array(
  Schema.Struct({ column_name: Schema.String }),
) }));

export async function headProgressMigrationStatements(): Promise<readonly string[]> {
  return (await readFile(new URL("../drizzle/0102_framework_head_progress.sql", import.meta.url), "utf8"))
    .split("--> statement-breakpoint").filter(statement => statement.trim().length > 0);
}

/** Historical fixture schema only, used inside a test-owned transaction. */
export const removeHeadProgressFixtureColumns = sql.raw(`alter table fx_system_framework_migration_collision_head
  drop column completed_step_count, drop column last_receipt_storage_id, drop column last_step_receipt_sha256`);

export async function assertHeadProgressMigration(database: FlarexMetadataDatabase): Promise<void> {
  const before = await database.select().from(fxSystemFrameworkMigrationCollisionHeads);
  expect(before).toHaveLength(1);
  expect(before[0]?.completedStepCount).toBeGreaterThanOrEqual(2);
  const statements = await headProgressMigrationStatements();
  // A duplicate/out-of-order historical completion must fail the migration,
  // leaving the original projection and guard state after transaction rollback.
  await expect(database.transaction(async transaction => {
    await withAdministrativeFrameworkMetadataRepair(transaction, ["fx_system_framework_migration_event"], async () => {
      await transaction.execute(sql`update fx_system_framework_migration_event set subject_sha256 = (
        select subject_sha256 from fx_system_framework_migration_event where event_kind='stepCompleted' order by event_sequence limit 1
      ) where event_storage_id = (select event_storage_id from fx_system_framework_migration_event
        where event_kind='stepCompleted' order by event_sequence desc limit 1)`);
    });
    await transaction.execute(removeHeadProgressFixtureColumns);
    for (const statement of statements) await transaction.execute(sql.raw(statement));
  })).rejects.toMatchObject({ cause: { code: "P0001", message: "Non-contiguous framework progress" } });
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(before);

  await database.transaction(transaction => transaction.execute(removeHeadProgressFixtureColumns));
  const stop = new Error("Roll back populated head progress migration");
  await expect(database.transaction(async transaction => {
    for (const statement of statements) await transaction.execute(sql.raw(statement));
    throw stop;
  })).rejects.toBe(stop);
  await database.transaction(async transaction => {
    expect(decodeColumnRows(await transaction.execute(sql`select column_name from information_schema.columns
      where table_schema=current_schema() and table_name='fx_system_framework_migration_collision_head'
        and column_name='completed_step_count'`)).rows).toHaveLength(0);
    for (const statement of statements) await transaction.execute(sql.raw(statement));
  });
  // Includes canonical bytes/digest, head revision, producer tail and lease.
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(before);
}

export async function assertPersistedHeadProgress(database: FlarexMetadataDatabase, completed: number): Promise<void> {
  const rows = await database.select().from(fxSystemFrameworkMigrationCollisionHeads);
  expect(rows).toHaveLength(1);
  const head = rows[0];
  if (head === undefined) throw new Error("Missing collision head");
  expect(head.completedStepCount).toBe(completed);
  if (completed === 0) {
    expect(head.lastReceiptStorageId).toBeNull();
    expect(head.lastStepReceiptSha256).toBeNull();
  } else {
    const receipts = fxSystemFrameworkMigrationStepReceipts;
    const steps = fxSystemFrameworkMigrationPlanSteps;
    const result = await database.select({ receiptStorageId: receipts.receiptStorageId,
      sha256: receipts.stepReceiptSha256 }).from(receipts).innerJoin(steps,
      and(eq(steps.planStorageId, receipts.planStorageId), eq(steps.stepId, receipts.stepId)))
      .where(and(eq(receipts.planStorageId, head.currentPlanStorageId), eq(steps.stepOrdinal, completed - 1)));
    expect(result).toEqual([{ receiptStorageId: head.lastReceiptStorageId, sha256: head.lastStepReceiptSha256 }]);
  }
}

export async function assertHeadProgressCorruption(database: FlarexMetadataDatabase,
  readProgress: () => Promise<unknown>,
): Promise<void> {
  const head = (await database.select().from(fxSystemFrameworkMigrationCollisionHeads))[0];
  if (head === undefined || head.completedStepCount < 2) throw new Error("Expected partial progress fixture");
  for (const mutation of [
    sql`update fx_system_framework_migration_collision_head set completed_step_count=completed_step_count + 1`,
    sql`update fx_system_framework_migration_collision_head set completed_step_count=0,
      last_receipt_storage_id=null, last_step_receipt_sha256=null`,
    sql`update fx_system_framework_migration_collision_head h set
      last_receipt_storage_id=r.receipt_storage_id, last_step_receipt_sha256=r.step_receipt_sha256
      from fx_system_framework_migration_step_receipt r join fx_system_framework_migration_plan_step s
      on s.plan_storage_id=r.plan_storage_id and s.step_id=r.step_id
      where r.plan_storage_id=h.current_plan_storage_id and s.step_ordinal=0`,
  ]) {
    await database.execute(mutation);
    try {
      await expect(readProgress()).rejects.toMatchObject({ reason: "storedCorruption" });
    } finally {
      await database.update(fxSystemFrameworkMigrationCollisionHeads).set({
        completedStepCount: head.completedStepCount, lastReceiptStorageId: head.lastReceiptStorageId,
        lastStepReceiptSha256: head.lastStepReceiptSha256,
      }).where(eq(fxSystemFrameworkMigrationCollisionHeads.collisionStorageId, head.collisionStorageId));
    }
  }
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual([head]);
}

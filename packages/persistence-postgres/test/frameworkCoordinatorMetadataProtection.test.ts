import { planReceiptMigrationStatements, restoreAttemptScopedReceiptFixture } from "./frameworkPlanReceiptMigrationTestSupport";
import { corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect } from "../src/migrationCoordination/migrationAttemptTerminalRepository";
import { runEffect } from "./effectTestRuntime";
import { captureFrameworkMigrationAttemptStart, captureFrameworkMigrationStepReceipt } from "../src/migrationCoordination/canonical";
import { ensureFrameworkMigrationAttemptStartInTransactionEffect } from "../src/migrationCoordination/migrationAttemptRepository";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { sql, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  fxSystemFrameworkMigrationPlans,
  fxSystemFrameworkMigrationPlanSteps,
  fxSystemFrameworkMigrationStepReceipts,
} from "../src/migrationCoordination/schema";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import {
  createSuccessfulTerminalPlanValues,
  storeSuccessfulTerminalGraphInTransaction,
} from "./frameworkCoordinatorRepositoryTestSupport";
import {
  administrativelyRepairFrameworkMetadata,
  withAdministrativeFrameworkMetadataRepair,
} from "./frameworkMetadataRepairTestSupport";

describe("framework installation metadata protection", () => {
  it("refuses historical cloned completions and rolls the entire cutover back", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    await persistence.drizzle.transaction(transaction => restoreAttemptScopedReceiptFixture(statement => transaction.execute(sql.raw(statement))));
    await persistence.drizzle.transaction(async transaction => {
      const value = await runEffect(captureFrameworkMigrationAttemptStart({
        admission: graph.admission.admission, attemptId: "historical-successor", attemptFence: "2",
        leaseOwnerId: "worker-b", leaseExpiresAt: "2026-08-28T00:00:00.000Z",
        previousAttemptId: graph.attempt.attempt.frame.attemptId, startedAt: "2026-08-27T09:00:00.000Z",
      }));
      const successor = await runEffect(ensureFrameworkMigrationAttemptStartInTransactionEffect(
        transaction, graph.admission, graph.attempt, value,
      ));
      const step = successor.plan.plan.frame.steps[0];
      if (step === undefined) throw new Error("Missing historical plan step");
      const original = (await transaction.select().from(fxSystemFrameworkMigrationStepReceipts)
        .where(eq(fxSystemFrameworkMigrationStepReceipts.stepId, step.stepId)))[0];
      if (original === undefined) throw new Error("Missing historical receipt fixture");
      expect(step.dependencies).toHaveLength(0);
      const receipt = await runEffect(captureFrameworkMigrationStepReceipt({
        attempt: successor.attempt, step, dependencyReceipts: [],
        observedPostconditionSha256: step.postconditionSha256, completedAt: "2026-08-27T09:01:00.000Z",
      }));
      const bytes = Buffer.from(receipt.canonicalJson);
      // Historical fixture insertion: the old schema permitted a second completion
      // under another attempt. The current repository deliberately refuses this.
      const { receiptStorageId, ...originalColumns } = original;
      expect(receiptStorageId).toBe(graph.receipts[0]?.storageId);
      await transaction.insert(fxSystemFrameworkMigrationStepReceipts).values({
        ...originalColumns, attemptStorageId: successor.storageId,
        attemptId: successor.attempt.frame.attemptId, attemptFence: BigInt(successor.attempt.frame.attemptFence),
        stepReceiptSha256: Buffer.from(receipt.sha256, "hex"), canonicalBytes: bytes, canonicalByteLength: bytes.length,
      });
    });
    const before = await persistence.query("select receipt_storage_id::text, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id");
    const statements = await planReceiptMigrationStatements();
    await expect(persistence.drizzle.transaction(async transaction => {
      for (const statement of statements) await transaction.execute(sql.raw(statement));
    })).rejects.toMatchObject({ cause: { code: "23505", constraint: "fx_framework_migration_receipt_plan_step_unique" } });
    expect((await persistence.query("select receipt_storage_id::text, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id")).rows).toEqual(before.rows);
    expect((await persistence.query("select distinct attempt_storage_id::text as id from fx_system_framework_migration_step_receipt_dependency")).rows)
      .toEqual([{ id: graph.attempt.storageId.toString() }]);
    await expect(persistence.query("update fx_system_framework_migration_step_receipt_dependency set dependency_ordinal = dependency_ordinal"))
      .rejects.toMatchObject({ code: "55000" });
  }, 180_000);
  it("remaps populated receipt projections atomically without changing completion identity", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await persistence.query("alter sequence fx_framework_migration_attempt_storage_id_seq restart with 1000");
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    expect(graph.attempt.storageId).not.toBe(graph.plan.storageId);
    const before = await persistence.query("select receipt_storage_id::text, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id");
    await persistence.drizzle.transaction(transaction => restoreAttemptScopedReceiptFixture(statement => transaction.execute(sql.raw(statement))));
    const statements = await planReceiptMigrationStatements();
    const stop = new Error("Roll back receipt reference cutover");
    await expect(persistence.drizzle.transaction(async transaction => {
      for (const statement of statements) await transaction.execute(sql.raw(statement));
      throw stop;
    })).rejects.toBe(stop);
    expect((await persistence.query("select distinct attempt_storage_id::text as id from fx_system_framework_migration_step_receipt_dependency")).rows)
      .toEqual([{ id: graph.attempt.storageId.toString() }]);
    await persistence.drizzle.transaction(async transaction => {
      for (const statement of statements) await transaction.execute(sql.raw(statement));
    });
    expect((await persistence.query("select distinct plan_storage_id::text as id from fx_system_framework_migration_step_receipt_dependency")).rows)
      .toEqual([{ id: graph.plan.storageId.toString() }]);
    expect((await persistence.query("select receipt_storage_id::text, encode(canonical_bytes, 'hex') as bytes from fx_system_framework_migration_step_receipt order by receipt_storage_id")).rows).toEqual(before.rows);
    const restored = await persistence.drizzle.transaction(transaction => runEffect(
      corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect(transaction, graph.terminal, "readAttemptTerminal"),
    ));
    expect(restored.terminal).toEqual(graph.terminal.terminal);
    await expect(persistence.query("update fx_system_framework_migration_step_receipt_dependency set dependency_ordinal = dependency_ordinal"))
      .rejects.toMatchObject({ code: "55000" });
  }, 180_000);

  it("rolls back the guard migration atomically and preserves pre-existing application rows", async () => {
    const database = new PGlite();
    onTestFinished(() => database.close());
    const migrations = readMigrationFiles({
      migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)),
    });
    const index = migrations.findIndex((migration) =>
      migration.sql.some((statement) =>
        statement.includes(
          "CREATE FUNCTION fx_framework_stamp_creation_transaction",
        ),
      ),
    );
    const protection = migrations[index];
    if (protection === undefined)
      throw new Error("Missing metadata protection migration");
    await database.transaction(async (transaction) => {
      for (const migration of migrations.slice(0, index))
        for (const statement of migration.sql)
          await transaction.exec(statement);
    });
    await database.query(
      "insert into deployments(deployment_id, project_id) values ('retained', 'project')",
    );
    const rollback = new Error("Roll back metadata protection DDL");
    await expect(
      database.transaction(async (transaction) => {
        for (const statement of protection.sql)
          await transaction.exec(statement);
        expect(
          (
            await transaction.query(
              "select count(*)::int as count from pg_trigger where tgname like 'fx_framework_%'",
            )
          ).rows,
        ).toEqual([{ count: 42 }]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(
      (
        await database.query(
          "select count(*)::int as count from information_schema.columns where column_name='created_transaction_id'",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
    expect(
      (
        await database.query(
          "select to_regprocedure('fx_framework_stamp_creation_transaction()') as name",
        )
      ).rows,
    ).toEqual([{ name: null }]);
    await database.transaction(async (transaction) => {
      for (const statement of protection.sql) await transaction.exec(statement);
    });
    expect(
      (
        await database.query(
          "select project_id from deployments where deployment_id='retained'",
        )
      ).rows,
    ).toEqual([{ project_id: "project" }]);
  }, 180_000);

  it("creates complete graphs atomically and rejects historical mutation and late children", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction((transaction) =>
      storeSuccessfulTerminalGraphInTransaction(transaction, values),
    );
    const rows = await persistence.drizzle
      .select()
      .from(fxSystemFrameworkMigrationPlanSteps)
      .where(
        eq(
          fxSystemFrameworkMigrationPlanSteps.planStorageId,
          graph.plan.storageId,
        ),
      );
    expect(rows.length).toBeGreaterThan(1);
    const step = rows[0];
    if (step === undefined) throw new Error("Missing plan step");
    await expect(
      persistence.drizzle
        .update(fxSystemFrameworkMigrationPlans)
        .set({ createdTransactionId: 1n })
        .where(
          eq(
            fxSystemFrameworkMigrationPlans.planStorageId,
            graph.plan.storageId,
          ),
        ),
    ).rejects.toMatchObject({ cause: { code: "55000" } });
    await expect(
      persistence.query(
        "delete from fx_system_framework_migration_plan_step_dependency",
      ),
    ).rejects.toMatchObject({ code: "55000" });
    await expect(
      persistence.query(
        "truncate fx_system_framework_migration_plan_step cascade",
      ),
    ).rejects.toMatchObject({ code: "55000" });

    // An exact existing child replay inserts nothing and does not reopen its parent.
    await persistence.drizzle
      .insert(fxSystemFrameworkMigrationPlanSteps)
      .values(step)
      .onConflictDoNothing();
    const extra = {
      ...step,
      stepOrdinal: rows.length,
      stepId: `step_${"7".repeat(32)}`,
      stepSha256: new Uint8Array(32).fill(7),
    };
    await expect(
      persistence.drizzle
        .insert(fxSystemFrameworkMigrationPlanSteps)
        .values(extra),
    ).rejects.toMatchObject({ cause: { code: "55000" } });
    expect(
      await persistence.drizzle
        .select()
        .from(fxSystemFrameworkMigrationPlanSteps)
        .where(
          eq(
            fxSystemFrameworkMigrationPlanSteps.planStorageId,
            graph.plan.storageId,
          ),
        ),
    ).toEqual(rows);
  }, 180_000);

  it("preserves SQL failure provenance and restores guards through owner rollback", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    await persistence.drizzle.transaction((transaction) =>
      storeSuccessfulTerminalGraphInTransaction(transaction, values),
    );
    await expect(
      administrativelyRepairFrameworkMetadata(
        persistence.drizzle,
        ["fx_system_framework_migration_plan"],
        async (transaction) => transaction.execute(sql`select 1 / 0`),
      ),
    ).rejects.toMatchObject({
      name: "AggregateError",
      errors: [{ cause: { code: "22012" } }, { cause: { code: "25P02" } }],
    });
    await expect(
      persistence.query(
        "update fx_system_framework_migration_plan set created_transaction_id=1",
      ),
    ).rejects.toMatchObject({ code: "55000" });
  }, 180_000);

  it("overrides forged creation stamps and confines administrative corruption to an explicit transaction", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction((transaction) =>
      storeSuccessfulTerminalGraphInTransaction(transaction, values),
    );
    const [original] = await persistence.drizzle
      .select()
      .from(fxSystemFrameworkMigrationPlans);
    if (original === undefined) throw new Error("Missing plan");
    const { planStorageId: _planStorageId, ...copy } = original;
    await persistence.drizzle.transaction(async (transaction) => {
      const [inserted] = await transaction
        .insert(fxSystemFrameworkMigrationPlans)
        .values({
          ...copy,
          createdTransactionId: 1n,
          migrationPlanSha256: new Uint8Array(32).fill(9),
        })
        .returning();
      const clock = await transaction.execute<{ transaction_id: string }>(
        sql`select txid_current()::text as transaction_id`,
      );
      expect(inserted?.createdTransactionId.toString()).toBe(
        clock.rows[0]?.transaction_id,
      );
      expect(inserted?.createdTransactionId).not.toBe(1n);
    });
    await persistence.drizzle.transaction((transaction) =>
      withAdministrativeFrameworkMetadataRepair(
        transaction,
        ["fx_system_framework_migration_plan"],
        () =>
          transaction
            .update(fxSystemFrameworkMigrationPlans)
            .set({ createdTransactionId: 1n })
            .where(
              eq(
                fxSystemFrameworkMigrationPlans.planStorageId,
                graph.plan.storageId,
              ),
            )
            .execute(),
      ),
    );
    await expect(
      persistence.drizzle
        .update(fxSystemFrameworkMigrationPlans)
        .set({ createdTransactionId: 2n })
        .where(
          eq(
            fxSystemFrameworkMigrationPlans.planStorageId,
            graph.plan.storageId,
          ),
        ),
    ).rejects.toMatchObject({ cause: { code: "55000" } });
  }, 180_000);
});

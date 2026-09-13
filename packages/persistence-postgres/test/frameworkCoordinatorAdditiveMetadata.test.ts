import { administrativelyRepairFrameworkMetadata } from "./frameworkMetadataRepairTestSupport";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it, onTestFinished } from "vitest";
import { createAdditiveFixture } from "./frameworkCoordinatorAdditiveTestSupport";
import { expectFrameworkCoordinatorMetadataStorageCatalog } from "./frameworkCoordinatorMetadataStorageTestSupport";
import { runEffect } from "./effectTestRuntime";
import { runEffectFailure } from "./effectTestRuntime";
import { runAdditiveFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";

describe("additive metadata migration", () => {
  it("refuses corrupt canonical base-bearing plan bytes on cold reconstruction", async () => {
    const fixture = await createAdditiveFixture();
    await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
    await administrativelyRepairFrameworkMetadata(fixture.persistence.drizzle, ["fx_system_framework_migration_plan"], async repairTransaction => repairTransaction.execute(sql.raw("update fx_system_framework_migration_plan set canonical_bytes=canonical_bytes || decode('20','hex'), canonical_byte_length=canonical_byte_length+1 where frame_version=2")));
    expect(await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ reason: "storedCorruption" });
    expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(1);
  }, 180_000);
  it("upgrades the previous head atomically and restores its schema on rollback", async () => {
    const db = new PGlite();
    onTestFinished(() => db.close());
    const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    const additiveIndex = migrations.findIndex(migration => migration.sql.some(statement =>
      statement.includes('CREATE TABLE "fx_system_framework_migration_plan_base"')));
    const last = migrations[additiveIndex];
    if (last === undefined) throw new Error("Missing additive migration");
    expect(last.sql.join("\n")).toContain('CREATE TABLE "fx_system_framework_migration_plan_base"');
    await db.transaction(async tx => { for (const migration of migrations.slice(0, additiveIndex)) for (const statement of migration.sql) await tx.exec(statement); });
    await db.query("insert into deployments (deployment_id, project_id) values ('retained', 'retained-project')");
    const sentinel = new Error("Rollback additive metadata DDL");
    await expect(db.transaction(async tx => {
      for (const statement of last.sql) await tx.exec(statement);
      expect((await tx.query("select to_regclass('fx_system_framework_migration_plan_base') as name")).rows).toEqual([{ name: "fx_system_framework_migration_plan_base" }]);
      throw sentinel;
    })).rejects.toBe(sentinel);
    expect((await db.query("select to_regclass('fx_system_framework_migration_plan_base') as name")).rows).toEqual([{ name: null }]);
    await db.transaction(async tx => { for (const statement of last.sql) await tx.exec(statement); });
    expect((await db.query("select project_id from deployments where deployment_id='retained'")).rows).toEqual([{ project_id: "retained-project" }]);
    await db.transaction(async tx => { for (const migration of migrations.slice(additiveIndex + 1)) for (const statement of migration.sql) await tx.exec(statement); });
    await expectFrameworkCoordinatorMetadataStorageCatalog(db, "public");
  }, 120_000);

  it("enforces every normalized base tuple and non-null additive admission predecessor", async () => {
    const fixture = await createAdditiveFixture();
    await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
    for (const column of ["installation_sha256", "installation_receipt_sha256", "readiness_sha256", "physical_layout_sha256"]) {
      await expect(fixture.persistence.query(`update fx_system_framework_migration_plan_base set ${column}=decode(repeat('00',32),'hex')`))
        .rejects.toMatchObject({ code: "23503" });
    }
    for (const column of ["installation_storage_id", "readiness_storage_id", "collision_storage_id"]) {
      await expect(fixture.persistence.query(`update fx_system_framework_migration_plan_base set ${column}=999`)).rejects.toMatchObject({ code: "23503" });
    }
    await expect(fixture.persistence.query("update fx_system_framework_migration_plan_admission set previous_plan_storage_id=null, previous_plan_sha256=null where frame_version=2"))
      .rejects.toMatchObject({ code: "23514" });
    await expect(fixture.persistence.query("update fx_system_framework_migration_plan_base set base_plan_storage_id=plan_storage_id"))
      .rejects.toMatchObject({ code: "23514" });
  }, 180_000);
});

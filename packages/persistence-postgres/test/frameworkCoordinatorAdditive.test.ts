import { administrativelyRepairFrameworkMetadata } from "./frameworkMetadataRepairTestSupport";
import { verifyFrameworkMigrationEffect } from "../src/migrationCoordination/verify";
import { sql } from "drizzle-orm";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { prepareFrameworkSchemaArtifactAdmission } from "../src/frameworkSchema/artifact/repository";
import { executeNextFrameworkMigrationStepEffect, runAdditiveFrameworkMigrationCoordinatorEffect, finalizeFrameworkMigrationClaimEffect } from "../src/migrationCoordination/freshCoordinator";
import { captureRelationalSchemaArtifact } from "../src/relationalSchema/artifact";
import { syntheticSchemaInput } from "./frameworkMigrationValueFixtures";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { createAdditiveFixture } from "./frameworkCoordinatorAdditiveTestSupport";
import { changeBaseAvailability } from "./frameworkCoordinatorAdditiveAvailabilityTestSupport";
import { captureAdditiveRelationalMigrationPlan } from "../src/migrationCoordination/additivePlan";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { issueRelationalStructuralRunnerTokenEffect, executeRelationalStructuralStepEffect } from "../src/migrationCoordination/relationalStructuralRunner";
import { runFrameworkMigrationTargetTransactionEffect } from "../src/migrationCoordination/targetSession";

describe("private additive framework migration coordinator", () => {
  it("refuses an exact added table without its own receipt", async () => {
    const fixture = await createAdditiveFixture();
    const basePlan = fixture.base.readiness.installation.plan.plan;
    const physicalLayout = await runEffect(captureRelationalPhysicalLayout({ artifact: fixture.candidate.artifact,
      physicalLocator: basePlan.frame.physicalLocator, targetNamespace: basePlan.targetNamespace }));
    const plan = await runEffect(captureAdditiveRelationalMigrationPlan({ artifact: fixture.candidate.artifact, physicalLayout,
      baseInstallation: fixture.base.readiness.installation.installation, baseReadiness: fixture.base.readiness.readiness }));
    const pending = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 1 }));
    if (pending.kind !== "pending") throw new Error("Expected verified base");
    expect(await runEffect(verifyFrameworkMigrationEffect(fixture.input.target, plan, fixture.input)))
      .toMatchObject({ kind: "verified", completedStepCount: 1, complete: false });
    const token = await runEffect(issueRelationalStructuralRunnerTokenEffect(fixture.input.target, plan));
    const create = plan.frame.steps[1];
    if (create?.operation.codec.format !== "flarex.relational-create-table") throw new Error("Expected table creation");
    // Fixture-only DDL deliberately commits without coordinator receipt metadata.
    await runEffect(runFrameworkMigrationTargetTransactionEffect(fixture.input.target, { kind: "ordinary",
      lockTimeoutMilliseconds: 5_000, statementTimeoutMilliseconds: 30_000 },
    tx => executeRelationalStructuralStepEffect(token, tx, create)));
    expect(await runEffectFailure(verifyFrameworkMigrationEffect(fixture.input.target, plan, fixture.input)))
      .toMatchObject({ reason: "unreceiptedStructure" });
    expect(await runEffectFailure(executeNextFrameworkMigrationStepEffect(pending.claim))).toMatchObject({ reason: "unreceiptedStructure" });
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_step_receipt")).rows).toHaveLength(4);
    expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(1);
  }, 180_000);

  it("withholds successor readiness when added structure drifts before final validation", async () => {
    const fixture = await createAdditiveFixture();
    const pending = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 5 }));
    if (pending.kind !== "pending") throw new Error("Expected unvalidated successor");
    const table = (await fixture.persistence.query<{ name: string }>("select relname as name from pg_class where relnamespace='flarex_shared'::regnamespace and relkind='r' and relname like 'fxrt_%' order by oid desc limit 1")).rows[0];
    if (table === undefined) throw new Error("Missing added table");
    await fixture.persistence.query(`alter table "flarex_shared"."${table.name}" add column drift text`);
    expect(await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim))).toMatchObject({ kind: "not_ready", reason: "structureMismatch" });
    expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(1);
  }, 180_000);
  it("refuses all non-ready base statuses before admission and resumes when ready", async () => {
    const fixture = await createAdditiveFixture();
    for (const status of ["withdrawn", "quarantined", "superseded"] as const) {
      await fixture.persistence.drizzle.transaction(tx => runEffect(changeBaseAvailability(tx, fixture.base.readiness.installation, status)));
      expect(await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ reason: "planConflict" });
      expect((await fixture.persistence.query("select * from fx_system_framework_migration_plan")).rows).toHaveLength(1);
      await fixture.persistence.drizzle.transaction(tx => runEffect(changeBaseAvailability(tx, fixture.base.readiness.installation, "ready")));
    }
    expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ kind: "ready" });
  }, 240_000);

  it("rechecks base availability between committed steps and at finalization", async () => {
    const fixture = await createAdditiveFixture();
    const pending = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 2 }));
    if (pending.kind !== "pending") throw new Error("Expected prefix");
    const change = (status: "ready" | "withdrawn") => fixture.persistence.drizzle.transaction(tx => runEffect(changeBaseAvailability(tx, fixture.base.readiness.installation, status)));
    await change("withdrawn");
    expect(await runEffectFailure(executeNextFrameworkMigrationStepEffect(pending.claim))).toMatchObject({ reason: "planConflict" });
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_step_receipt")).rows).toHaveLength(5);
    await change("ready");
    for (let step = 2; step < 6; step++) await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim));
    await change("withdrawn");
    expect(await runEffectFailure(finalizeFrameworkMigrationClaimEffect(pending.claim))).toMatchObject({ reason: "planConflict" });
    expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(1);
    await change("ready");
    expect(await runEffect(finalizeFrameworkMigrationClaimEffect(pending.claim))).toMatchObject({ kind: "ready" });
  }, 240_000);

  it("rejects wrong base coordinates and digests without publishing candidate metadata", async () => {
    const fixture = await createAdditiveFixture();
    const base = fixture.input.baseInstallation;
    const references = [
      { ...base, readinessSha256: "00".repeat(32) },
      { ...base, installationReceiptSha256: "00".repeat(32) },
      { ...base, physicalLayoutSha256: "00".repeat(32) },
      { ...base, identity: { ...base.identity, artifact: { ...base.identity.artifact, owner: "application" } } },
      { ...base, identity: { ...base.identity, artifact: { ...base.identity.artifact, lineageId: "other" } } },
      { ...base, identity: { ...base.identity, targetNamespace: { ...base.identity.targetNamespace, schemaName: "elsewhere" } } },
    ];
    for (const baseInstallation of references) {
      // @ts-expect-error Exercise the runtime boundary with untrusted external references.
      await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, baseInstallation }));
    }
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_plan")).rows).toHaveLength(1);
  }, 180_000);

  it("refuses changed or deleted retained definitions, zero additions and indexes on retained tables", async () => {
    const fixture = await createAdditiveFixture();
    const schema = syntheticSchemaInput();
    const parent = schema.tables.find(t => t.tableId === "parent");
    if (parent === undefined) throw new Error("Missing parent");
    const variants = [
      [parent],
      [{ ...parent, tableId: "replacement" }],
      schema.tables.map(t => t.tableId === "parent" ? { ...t, columns: [...t.columns, { ...parent.columns[1], columnId: "extra" }] } : t),
      schema.tables.map(t => t.tableId === "parent" ? { ...t, indexes: [{ indexId: "new-index", kind: "btree", columns: ["slug"], predicate: null, origin: t.origin }] } : t),
      schema.tables.map(t => t.tableId === "child" ? { ...t, indexes: t.indexes.map(index => ({ ...index, predicate: { kind: "isNull", columnId: "parent_id" } })) } : t),
    ];
    for (const [index, tables] of variants.entries()) {
      const artifact = await runEffect(captureRelationalSchemaArtifact({ deploymentId: "deployment-a",
        provenance: { kind: "synthetic", fixtureId: `refused-additive-${index}` }, schema: { ...schema, tables } }));
      await runEffect(admitFrameworkSchemaArtifactEffect(fixture.input.artifactRepository, Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(artifact.artifact))));
      expect(await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, artifactIdentity: artifact.artifact.identity })))
        .toMatchObject({ reason: "invalidInput" });
    }
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_plan")).rows).toHaveLength(1);
  }, 180_000);
  it("preserves an installed base, adds a related table and exactly replays the successor", async () => {
    const fixture = await createAdditiveFixture();
    const parent = fixture.base.readiness.installation.plan.plan.frame.physicalLayout.tables[0];
    if (parent === undefined) throw new Error("Missing parent");
    const id = parent.columns.find(c => c.identity.columnId === "id")?.name;
    const slug = parent.columns.find(c => c.identity.columnId === "slug")?.name;
    if (id === undefined || slug === undefined) throw new Error("Missing parent columns");
    const scope = "10000000-0000-0000-0000-000000000001";
    const otherScope = "10000000-0000-0000-0000-000000000002";
    await fixture.persistence.query('insert into "flarex_shared".fx_system_scope_clock values ($1), ($2)', [scope, otherScope]);
    await fixture.persistence.query(`insert into "flarex_shared"."${parent.name}" (scope_uuid, "${id}", "${slug}") values ($1, 'parent', 'slug')`, [scope]);
    const beforeRows = await fixture.persistence.query(`select * from "flarex_shared"."${parent.name}"`);
    const before = await fixture.persistence.query("select oid::text from pg_class where relnamespace = 'flarex_shared'::regnamespace order by oid");
    const result = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input));
    expect(result).toMatchObject({ kind: "ready", replayed: false });
    if (result.kind !== "ready") throw new Error("Expected successor readiness");
    expect(await runEffect(verifyFrameworkMigrationEffect(fixture.input.target, result.readiness.installation.plan.plan, fixture.input)))
      .toMatchObject({ kind: "verified", completedStepCount: 6, complete: true });
    expect(result.readiness.installation.plan.plan.frame.version).toBe(2);
    expect(result.readiness.installation.plan.plan.frame.steps).toHaveLength(6);
    const after = await fixture.persistence.query("select oid::text from pg_class where relnamespace = 'flarex_shared'::regnamespace order by oid");
    expect(after.rows).toEqual(expect.arrayContaining(before.rows));
    expect((await fixture.persistence.query(`select * from "flarex_shared"."${parent.name}"`)).rows).toEqual(beforeRows.rows);
    const child = result.readiness.installation.plan.plan.frame.physicalLayout.tables.find(t => t.identity.tableId === "child");
    const childId = child?.columns.find(c => c.identity.columnId === "id")?.name;
    const parentId = child?.columns.find(c => c.identity.columnId === "parent_id")?.name;
    if (child === undefined || childId === undefined || parentId === undefined) throw new Error("Missing child");
    const insertChild = `insert into "flarex_shared"."${child.name}" (scope_uuid, "${childId}", "${parentId}") values ($1, 'child', 'parent')`;
    await expect(fixture.persistence.query(insertChild, [otherScope])).rejects.toMatchObject({ code: "23503" });
    await fixture.persistence.query(insertChild, [scope]);
    expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input)))
      .toMatchObject({ kind: "ready", replayed: true });
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_plan_base")).rows).toHaveLength(1);
    expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(2);
  }, 180_000);

  it("resumes every committed boundary using a reconstructed request", async () => {
    const fixture = await createAdditiveFixture();
    let result = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
    for (let completed = 1; completed <= 6; completed++) {
      if (result.kind !== "pending") throw new Error("Expected pending successor");
      expect(await runEffect(executeNextFrameworkMigrationStepEffect(result.claim)))
        .toMatchObject({ kind: "step", completedStepCount: completed });
      result = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
    }
    expect(result).toMatchObject({ kind: "ready" });
  }, 180_000);

  it("refuses missing normalized base evidence on cold replay", async () => {
    const fixture = await createAdditiveFixture();
    expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ kind: "ready" });
    await administrativelyRepairFrameworkMetadata(fixture.persistence.drizzle, ["fx_system_framework_migration_plan_base"], async repairTransaction => repairTransaction.execute(sql.raw("delete from fx_system_framework_migration_plan_base")));
    expect(await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input)))
      .toMatchObject({ reason: "storedCorruption" });
  }, 180_000);

  it("refuses retained catalog drift without admitting a successor", async () => {
    const fixture = await createAdditiveFixture();
    const table = fixture.base.readiness.installation.plan.plan.frame.physicalLayout.tables[0];
    if (table === undefined) throw new Error("Missing base table");
    await fixture.persistence.query(`alter table "flarex_shared"."${table.name}" add column drift text`);
    await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input));
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_plan")).rows).toHaveLength(1);
  }, 180_000);
});

import { eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FrameworkSchemaArtifact } from "../src/frameworkSchema/artifact/model";
import { captureFreshRelationalMigrationPlan } from "../src/migrationCoordination/canonical";
import { executeNextFrameworkMigrationStepEffect, runFreshFrameworkMigrationCoordinatorEffect,
  type RunFreshFrameworkMigrationCoordinatorInput } from "../src/migrationCoordination/freshCoordinator";
import { prepareFrameworkMigrationDefinition } from "../src/migrationCoordination/definition";
import { executeRelationalStructuralStepEffect } from "../src/migrationCoordination/relationalStructuralRunner";
import { fxSystemFrameworkMigrationCollisionHeads, fxSystemFrameworkMigrationStepReceipts } from "../src/migrationCoordination/schema";
import { frameworkMigrationTargetSnapshot, runFrameworkMigrationTargetTransactionEffect } from "../src/migrationCoordination/targetSession";
import { verifyFrameworkMigrationEffect } from "../src/migrationCoordination/verify";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { administrativelyRepairFrameworkMetadata } from "./frameworkMetadataRepairTestSupport";

async function verificationPlan(input: RunFreshFrameworkMigrationCoordinatorInput, artifact: FrameworkSchemaArtifact) {
  const target = frameworkMigrationTargetSnapshot(input.target);
  if (target === undefined) throw new Error("Missing verification target");
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({ artifact,
    physicalLocator: target.physicalLocator, targetNamespace: target.namespace }));
  return runEffect(captureFreshRelationalMigrationPlan({ artifact, physicalLayout }));
}

export async function assertExplicitFrameworkVerification(database: FlarexMetadataDatabase,
  input: RunFreshFrameworkMigrationCoordinatorInput, artifact: FrameworkSchemaArtifact) {
  const plan = await verificationPlan(input, artifact);
  const verify = () => runEffect(verifyFrameworkMigrationEffect(input.target, plan, input));
  expect(await verify()).toEqual({ kind: "absent" });
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toHaveLength(0);
  const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 }));
  if (pending.kind !== "pending") throw new Error("Expected initial claim");
  for (const completedStepCount of [0, 1, 2]) {
    if (completedStepCount > 0) await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim));
    const before = await database.select().from(fxSystemFrameworkMigrationCollisionHeads);
    expect(await verify()).toEqual({ kind: "verified", planSha256: plan.migrationPlanSha256,
      completedStepCount, requiredStepCount: plan.frame.steps.length, complete: false });
    expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(before);
  }
  expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input))).toMatchObject({ kind: "ready" });
  const settled = await database.select().from(fxSystemFrameworkMigrationCollisionHeads);
  expect(await verify()).toMatchObject({ kind: "verified", complete: true, completedStepCount: plan.frame.steps.length });
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(settled);

  const receipt = (await database.select().from(fxSystemFrameworkMigrationStepReceipts).orderBy(
    fxSystemFrameworkMigrationStepReceipts.receiptStorageId).limit(1))[0];
  if (receipt === undefined) throw new Error("Missing original receipt");
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_step_receipt"], transaction =>
    transaction.execute(sql`update fx_system_framework_migration_step_receipt set canonical_bytes=set_byte(canonical_bytes,0,32)
      where receipt_storage_id=${receipt.receiptStorageId}`));
  try {
    await expect(verify()).rejects.toMatchObject({ reason: "storedCorruption" });
  } finally {
    await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_step_receipt"], transaction =>
      transaction.update(fxSystemFrameworkMigrationStepReceipts).set({ canonicalBytes: receipt.canonicalBytes })
        .where(eq(fxSystemFrameworkMigrationStepReceipts.receiptStorageId, receipt.receiptStorageId)));
  }
  expect(await verify()).toMatchObject({ kind: "verified", complete: true });
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(settled);
}

export async function assertVerificationRefusesUnreceiptedDdl(input: RunFreshFrameworkMigrationCoordinatorInput,
  artifact: FrameworkSchemaArtifact) {
  const plan = await verificationPlan(input, artifact);
  expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 }))).toMatchObject({ kind: "pending" });
  const definition = await runEffect(prepareFrameworkMigrationDefinition(input.target, plan));
  const step = definition.steps[0]?.step;
  if (step === undefined) throw new Error("Missing first physical operation");
  // Deliberately commit a structural operation without its receipt/event/head;
  // the test fixture owns this disposable schema and tears it down afterward.
  await runEffect(runFrameworkMigrationTargetTransactionEffect(input.target, { kind: "ordinary", ...input },
    transaction => executeRelationalStructuralStepEffect(definition.runner, transaction, step)));
  expect(await runEffectFailure(verifyFrameworkMigrationEffect(input.target, plan, input)))
    .toMatchObject({ reason: "unreceiptedStructure" });
}

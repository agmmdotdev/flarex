import { eq, sql } from "drizzle-orm";
import { expect, vi } from "vitest";
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
import { installerFixture } from "./frameworkInstallerTestSupport";
import * as eventRepository from "../src/migrationCoordination/migrationEventRepository";
import * as receiptRepository from "../src/migrationCoordination/migrationStepReceiptRepository";
import { inspectFrameworkMigrationEffect } from "../src/migrationCoordination/inspect";
import { captureFrameworkSchemaTargetNamespace } from "../src/migrationCoordination/targetNamespace";

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
  const installer = installerFixture(input);
  expect(await runEffectFailure(inspectFrameworkMigrationEffect(input.target, { ...plan }, input)))
    .toMatchObject({ reason: "invalidAuthority" });
  const foreignNamespace = await runEffect(captureFrameworkSchemaTargetNamespace({
    deploymentId: plan.targetNamespace.frame.deploymentId, physicalDatabaseIdentity: "different-database",
    schemaName: plan.targetNamespace.frame.schemaName,
  }));
  const foreignLayout = await runEffect(captureRelationalPhysicalLayout({ artifact,
    physicalLocator: plan.frame.physicalLocator, targetNamespace: foreignNamespace }));
  const foreignPlan = await runEffect(captureFreshRelationalMigrationPlan({ artifact, physicalLayout: foreignLayout }));
  expect(await runEffectFailure(inspectFrameworkMigrationEffect(input.target, foreignPlan, input)))
    .toMatchObject({ reason: "targetMismatch" });
  const verify = async () => {
    const prefix = vi.spyOn(receiptRepository, "readFrameworkMigrationStepReceiptPrefixInTransactionEffect");
    try {
      const report = await runEffect(installer.verify(input));
      expect(prefix).not.toHaveBeenCalled();
      return report;
    } finally { prefix.mockRestore(); }
  };
  const inspect = async () => {
    const history = vi.spyOn(eventRepository, "restoreStoredFrameworkMigrationEventReferenceInTransactionEffect");
    try {
      const report = await runEffect(installer.inspect(input));
      expect(history).not.toHaveBeenCalled();
      return report;
    } finally { history.mockRestore(); }
  };
  expect(await inspect()).toEqual({ kind: "absent" });
  expect(await verify()).toEqual({ kind: "absent" });
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toHaveLength(0);
  const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...input, maximumStepsPerRun: 0 }));
  if (pending.kind !== "pending") throw new Error("Expected initial claim");
  for (const completedStepCount of [0, 1, 2]) {
    if (completedStepCount > 0) await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim));
    const before = await database.select().from(fxSystemFrameworkMigrationCollisionHeads);
    expect(await inspect()).toMatchObject({ kind: "observed", planSha256: plan.migrationPlanSha256,
      completedStepCount, requiredStepCount: plan.frame.steps.length, currentAttempt: { attemptId: input.attemptId } });
    expect(await verify()).toEqual({ kind: "verified", planSha256: plan.migrationPlanSha256,
      completedStepCount, requiredStepCount: plan.frame.steps.length, complete: false });
    expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(before);
    if (completedStepCount === 2) {
      const head = before[0];
      if (head === undefined) throw new Error("Expected active head");
      await database.update(fxSystemFrameworkMigrationCollisionHeads).set({ completedStepCount: plan.frame.steps.length + 1 })
        .where(eq(fxSystemFrameworkMigrationCollisionHeads.collisionStorageId, head.collisionStorageId));
      try { await expect(inspect()).rejects.toMatchObject({ reason: "storedCorruption" }); }
      finally {
        await database.update(fxSystemFrameworkMigrationCollisionHeads).set({ completedStepCount })
          .where(eq(fxSystemFrameworkMigrationCollisionHeads.collisionStorageId, head.collisionStorageId));
      }
    }
  }
  expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input))).toMatchObject({ kind: "ready" });
  const settled = await database.select().from(fxSystemFrameworkMigrationCollisionHeads);
  expect(await inspect()).toMatchObject({ kind: "observed", completedStepCount: plan.frame.steps.length, currentAttempt: null });
  expect(await verify()).toMatchObject({ kind: "verified", complete: true, completedStepCount: plan.frame.steps.length });
  expect(await database.select().from(fxSystemFrameworkMigrationCollisionHeads)).toEqual(settled);

  const receipt = (await database.select().from(fxSystemFrameworkMigrationStepReceipts).orderBy(
    fxSystemFrameworkMigrationStepReceipts.receiptStorageId).limit(1))[0];
  if (receipt === undefined) throw new Error("Missing original receipt");
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_step_receipt"], transaction =>
    transaction.execute(sql`update fx_system_framework_migration_step_receipt set canonical_bytes=set_byte(canonical_bytes,0,32)
      where receipt_storage_id=${receipt.receiptStorageId}`));
  try {
    // An observational snapshot grants no history or readiness guarantee.
    expect(await inspect()).toMatchObject({ kind: "observed", completedStepCount: plan.frame.steps.length });
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

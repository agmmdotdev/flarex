import { eq } from "drizzle-orm";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { collectInstallationEvidence, readInstallationEvidence } from "../src/frameworkSchema/installation/runtimeEvidence";
import { administrativelyRepairFrameworkMetadata } from "./frameworkMetadataRepairTestSupport";
import { Effect, Tracer } from "effect";
import { expect } from "vitest";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { prepareInstallationRuntime, acceptPreparedInstallation, type PreparedInstallationRuntime } from "../src/frameworkSchema/installation/runtime";
import { fxSystemFrameworkSchemaInstallations as installations } from "../src/frameworkSchema/installation/schema";
import { fxSystemFrameworkMigrationPlans as plans, fxSystemFrameworkMigrationPlanStepDependencies as dependencies,
  fxSystemRelationalPhysicalNameAssignments as names } from "../src/migrationCoordination/schema";
import { makeFrameworkSchemaTarget } from "../src/frameworkSchema/target";
import { captureFrameworkSchemaAvailabilityHistory, captureFrameworkSchemaAvailabilityHead } from "../src/frameworkSchema/installation/canonical";
import { appendFrameworkSchemaAvailabilityHistoryInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHistoryRepository";
import { compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHeadRepository";
import { createInstallationAcceptanceFixture } from "./frameworkInstallationAcceptanceTestSupport";
import { installationBindingReference } from "./frameworkDataBindingPhysicalTestSupport";
import { runEffect } from "./effectTestRuntime";

export async function createInstallationRuntimeFixture(database: FlarexMetadataDatabase) {
  const stored = await createInstallationAcceptanceFixture(database);
  const identity = stored.installation.installation.frame.identity;
  // This reader fixture does not execute migrations; preparation owns its database transaction.
  const makeTarget = () => runEffect(makeFrameworkSchemaTarget({ database,
    deploymentId: identity.targetNamespace.deploymentId,
    canonicalPhysicalDatabaseIdentity: identity.targetNamespace.physicalDatabaseIdentity, physicalLocator: identity.physicalLocator }));
  const target = await makeTarget();
  const reference = installationBindingReference(stored);
  const prepare = () => runEffect(prepareInstallationRuntime(database, target, reference));
  const prepared = await prepare();
  const accept = (token = prepared) => database.transaction(tx => runEffect(acceptPreparedInstallation(token, target, reference, tx)));
  return { stored, target, reference, prepare, prepared, accept, makeTarget };
}

export async function exerciseInstallationRuntime(database: FlarexMetadataDatabase) {
  const fixture = await createInstallationRuntimeFixture(database);
  const spans: string[] = [];
  const tracer = Tracer.make({ span(options) { spans.push(options.name); return new Tracer.NativeSpan(options); } });
  const accepted = await database.transaction(tx => runEffect(acceptPreparedInstallation(fixture.prepared, fixture.target, fixture.reference, tx)
    .pipe(Effect.provideService(Tracer.Tracer, tracer))));
  expect(accepted.readiness).toEqual(fixture.stored.readiness.readiness.frame);
  expect(Object.keys(accepted).sort()).toEqual(["admissionProfile", "physicalLayout", "physicalLayoutCanonicalJson", "planVersion", "readiness"]);
  expect(accepted.physicalLayout).toEqual(fixture.stored.installation.plan.plan.physicalLayout.frame);
  expect(accepted.planVersion).toBe(1);
  expect(Object.isFrozen(accepted.physicalLayout.tables)).toBe(true);
  expect(spans.filter(name => name === "InstallationRuntime.readEvidence")).toHaveLength(1);
  expect(spans).not.toContain("DataBindingEvidence.lockInstallation");
  expect(spans).not.toContain("FrameworkMigrationPlanRepository.loadSidecars");
  expect(await fixture.accept()).toBe(accepted);
  const independent = await fixture.prepare();
  expect(independent).not.toBe(fixture.prepared);
  expect(await fixture.accept(independent)).toEqual(accepted);
  const evidence = await database.transaction(tx => runEffect(Effect.gen(function* () {
    const coordinates = yield* collectInstallationEvidence(tx, fixture.stored);
    return yield* readInstallationEvidence(tx, coordinates);
  })));
  const missingReceipts = Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "receipts"));
  for (const rows of [[], [{}], [missingReceipts], [{ ...evidence, receipts: "invalid" }],
    [{ ...evidence, unexpected: "0".repeat(64) }], [evidence, evidence]]) {
    await expect(database.transaction(tx => runEffect(acceptPreparedInstallation(
      fixture.prepared, fixture.target, fixture.reference, evidenceResultTransaction(tx, rows),
    )))).rejects.toMatchObject({ reason: "storedCorruption" });
  }
  // Deliberately forged capability at the public boundary under test.
  await expect(fixture.accept(Object.freeze({}) as PreparedInstallationRuntime)).rejects.toMatchObject({ reason: "invalidAuthority" });
  await expect(database.transaction(tx => runEffect(acceptPreparedInstallation(fixture.prepared, fixture.target,
    { ...fixture.reference, availabilitySequence: "2" }, tx)))).rejects.toMatchObject({ reason: "invalidAuthority" });
  const otherTarget = await fixture.makeTarget();
  await expect(database.transaction(tx => runEffect(acceptPreparedInstallation(fixture.prepared, otherTarget,
    fixture.reference, tx)))).rejects.toMatchObject({ reason: "invalidAuthority" });

  const planId = fixture.stored.installation.plan.storageId;
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_plan"], tx =>
    tx.update(plans).set({ locatorDatabaseKey: "changed-after-preparation" }).where(eq(plans.planStorageId, planId)));
  await expect(fixture.accept()).rejects.toMatchObject({ reason: "storedCorruption" });
  await expect(fixture.prepare()).rejects.toMatchObject({ reason: "storedCorruption" });
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_plan"], tx =>
    tx.update(plans).set({ locatorDatabaseKey: fixture.reference.installation.physicalLocator.databaseKey }).where(eq(plans.planStorageId, planId)));
  expect(await fixture.accept()).toEqual(accepted);

  const bytes = new TextEncoder().encode(fixture.stored.installation.installation.canonicalJson);
  const changed = bytes.slice(); changed[0] = 32;
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_schema_installation"], tx =>
    tx.update(installations).set({ canonicalBytes: changed }).where(eq(installations.installationStorageId, fixture.stored.installation.storageId)));
  await expect(fixture.accept()).rejects.toMatchObject({ reason: "storedCorruption" });
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_schema_installation"], tx =>
    tx.update(installations).set({ canonicalBytes: bytes }).where(eq(installations.installationStorageId, fixture.stored.installation.storageId)));

  const assignment = (await database.select().from(names).where(eq(names.collisionStorageId, fixture.stored.installation.collision.storageId)).limit(1))[0];
  if (assignment === undefined) throw new Error("Missing physical name assignment fixture");
  const alteredName = Uint8Array.from(assignment.canonicalBytes); alteredName[0] = 32;
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_relational_physical_name_assignment"], tx =>
    tx.update(names).set({ canonicalBytes: alteredName }).where(eq(names.assignmentStorageId, assignment.assignmentStorageId)));
  await expect(fixture.accept()).rejects.toMatchObject({ reason: "storedCorruption" });
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_relational_physical_name_assignment"], tx =>
    tx.update(names).set({ canonicalBytes: assignment.canonicalBytes }).where(eq(names.assignmentStorageId, assignment.assignmentStorageId)));

  const sidecars = await database.select().from(dependencies).where(eq(dependencies.planStorageId, planId));
  expect(sidecars.length).toBeGreaterThan(0);
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_plan_step_dependency"], tx =>
    tx.delete(dependencies).where(eq(dependencies.planStorageId, planId)));
  await expect(fixture.accept()).rejects.toMatchObject({ reason: "storedCorruption" });
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_plan_step_dependency"], tx =>
    tx.insert(dependencies).values(sidecars));
  expect(await fixture.accept()).toEqual(accepted);
  const first = sidecars[0];
  if (first === undefined) throw new Error("Missing dependency fixture");
  const sameSource = sidecars.filter(row => row.sourceStepId === first.sourceStepId);
  const extra = sidecars.find(row => row.dependencyStepId !== first.sourceStepId &&
    !sameSource.some(existing => existing.dependencyStepId === row.dependencyStepId));
  if (extra === undefined) throw new Error("Missing extra-dependency fixture candidate");
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_plan_step_dependency"], tx =>
    tx.insert(dependencies).values({ ...extra, sourceStepId: first.sourceStepId,
      dependencyOrdinal: Math.max(...sameSource.map(row => row.dependencyOrdinal)) + 1 }));
  await expect(fixture.accept()).rejects.toMatchObject({ reason: "storedCorruption" });
  await administrativelyRepairFrameworkMetadata(database, ["fx_system_framework_migration_plan_step_dependency"], async tx => {
    await tx.delete(dependencies).where(eq(dependencies.planStorageId, planId));
    await tx.insert(dependencies).values(sidecars);
  });
  expect(await fixture.accept()).toEqual(accepted);

  await database.transaction(tx => runEffect(Effect.gen(function* () {
    const history = yield* captureFrameworkSchemaAvailabilityHistory({ readiness: fixture.stored.readiness.readiness,
      previous: fixture.stored.history.history, status: "withdrawn", reasonSha256: "f".repeat(64), recordedAt: new Date().toISOString() });
    const stored = yield* appendFrameworkSchemaAvailabilityHistoryInTransactionEffect(tx, fixture.stored.readiness, fixture.stored.history, history);
    const head = yield* captureFrameworkSchemaAvailabilityHead(stored.history);
    yield* compareAndSwapFrameworkSchemaAvailabilityHeadInTransactionEffect(tx, fixture.stored, stored, head);
  })));
  await expect(fixture.accept()).rejects.toMatchObject({ reason: "unavailableInstallation" });
  await expect(fixture.prepare()).rejects.toMatchObject({ reason: "unavailableInstallation" });
}

/** Fault injection at the foreign driver's result boundary. All other queries,
 * including the accepting head lock, use the real transaction. */
function evidenceResultTransaction(
  transaction: FlarexMetadataTransaction,
  rows: readonly unknown[],
): FlarexMetadataTransaction {
  return new Proxy(transaction, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (property !== "select" || typeof member !== "function") return member;
      return (selection: unknown) => {
        if (isNonArrayRecord(selection) && Object.hasOwn(selection, "receiptDependencies")) {
          return { from: () => Promise.resolve(rows) };
        }
        return Reflect.apply(member, target, [selection]);
      };
    },
  });
}

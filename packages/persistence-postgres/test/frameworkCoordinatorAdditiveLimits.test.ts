import { Brand, Effect, Encoding, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { createAdditiveFixture } from "./frameworkCoordinatorAdditiveTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { runAdditiveFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { readFrameworkMigrationCollisionHeadInTransactionEffect } from "../src/migrationCoordination/migrationCollisionHeadRepository";
import { restoredFrameworkMigrationCollisionHeadAuthority } from "../src/migrationCoordination/storedEventRestoration";
import { captureFrameworkMigrationEvent, captureFreshRelationalMigrationPlan } from "../src/migrationCoordination/canonical";
import { captureFrameworkSchemaTargetNamespace } from "../src/migrationCoordination/targetNamespace";
import { captureRelationalPhysicalLayout } from "../src/relationalSchema/physical/canonical";
import { ensureFrameworkSchemaTargetNamespaceInTransactionEffect, ensureFrameworkMigrationCollisionDomainInTransactionEffect } from "../src/migrationCoordination/targetCollisionRepository";
import type { CanonicalNonNegativeInt64 } from "../src/migrationCoordination/identity";
import { fxSystemFrameworkMigrationEvents } from "../src/migrationCoordination/schema";
import { restoreStoredFrameworkMigrationEventReferenceInTransactionEffect } from "../src/migrationCoordination/migrationEventRepository";
import { withFrameworkGraphReadPass } from "../src/migrationCoordination/graphReadPass";
import { withAdditiveMigrationGraphLimits } from "../src/migrationCoordination/additiveLimits";
import { changeBaseAvailability } from "./frameworkCoordinatorAdditiveAvailabilityTestSupport";
import { setTimeout as delay } from "node:timers/promises";

const int64 = Brand.nominal<CanonicalNonNegativeInt64>();
const bytes = (value: string) => Result.getOrThrow(Encoding.decodeHex(value));

describe("additive cold graph limits", () => {
  it("refuses a fresh base above seven steps before publishing successor metadata", async () => {
    const fixture = await createAdditiveFixture(3);
    expect(fixture.base.readiness.installation.plan.plan.frame.steps).toHaveLength(9);
    expect(await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ reason: "referenceRefusal" });
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_plan")).rows).toHaveLength(1);
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_plan_base")).rows).toHaveLength(0);
  }, 180_000);
  it("admits a second attempt but refuses a third without resetting the partial successor", async () => {
    const fixture = await createAdditiveFixture();
    const request = { ...fixture.input, maximumStepsPerRun: 1, leaseDurationMilliseconds: 10_000 };
    expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(request))).toMatchObject({ kind: "pending", completedStepCount: 1 });
    await delay(10_100);
    expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...request, maximumStepsPerRun: 0,
      attemptId: "second", leaseOwnerId: "second-worker" }))).toMatchObject({ kind: "pending", completedStepCount: 1 });
    await delay(10_100);
    expect(await runEffectFailure(runAdditiveFrameworkMigrationCoordinatorEffect({ ...request, attemptId: "third", leaseOwnerId: "third-worker" })))
      .toMatchObject({ reason: "invalidInput", message: "Additive attempt budget is exhausted" });
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_attempt_start")).rows).toHaveLength(3);
    expect((await fixture.persistence.query("select * from fx_system_framework_schema_installation")).rows).toHaveLength(1);
    expect((await fixture.persistence.query("select * from fx_system_framework_migration_step_receipt")).rows).toHaveLength(5);
  }, 180_000);
  it.each([false, true])("bounds event references before walking excess links (candidate admitted: %s)", async additive => {
    const fixture = await createAdditiveFixture();
    if (additive) await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
    const collision = fixture.base.readiness.installation.collision;
    await fixture.persistence.drizzle.transaction(async tx => {
      const targetValue = await runEffect(captureFrameworkSchemaTargetNamespace({ deploymentId: "deployment-a",
        physicalDatabaseIdentity: "pglite://additive", schemaName: "independent" }));
      const layout = await runEffect(captureRelationalPhysicalLayout({ artifact: fixture.candidate.artifact,
        physicalLocator: { kind: "shared_database", databaseKey: "primary", schemaName: "independent" }, targetNamespace: targetValue }));
      const otherPlan = await runEffect(captureFreshRelationalMigrationPlan({ artifact: fixture.candidate.artifact, physicalLayout: layout }));
      const otherTarget = await runEffect(ensureFrameworkSchemaTargetNamespaceInTransactionEffect(tx, targetValue));
      const otherCollision = await runEffect(ensureFrameworkMigrationCollisionDomainInTransactionEffect(tx, otherTarget, otherPlan));
      const head = Option.getOrThrow(await runEffect(readFrameworkMigrationCollisionHeadInTransactionEffect(tx, collision)));
      const last = restoredFrameworkMigrationCollisionHeadAuthority(head)?.lastEvent;
      if (last === undefined || last === null) throw new Error("Missing event");
      let previous = { storageId: last.storageId, event: last.event };
      // Deliberately construct long, valid immutable metadata to exercise the
      // cold reader independently of coordinator admission/publication guards.
      for (let sequence = Number(last.event.frame.sequence) + 1; sequence <= 129; sequence++) {
        const event = await runEffect(captureFrameworkMigrationEvent({
          format: "flarex.framework-migration-event", version: 1,
          collision: collision.coordinate, sequence: int64(String(sequence)),
          previousEvent: { sequence: previous.event.frame.sequence, eventSha256: previous.event.sha256 },
          recordedAt: previous.event.frame.recordedAt, kind: "planAdmitted", admissionSha256: head.admission.admission.sha256,
        }));
        const canonicalBytes = new TextEncoder().encode(event.canonicalJson);
        const rows = await tx.insert(fxSystemFrameworkMigrationEvents).values({
          collisionStorageId: collision.storageId, eventSequence: BigInt(sequence), eventSha256: bytes(event.sha256),
          previousEventStorageId: previous.storageId, previousEventSequence: BigInt(previous.event.frame.sequence),
          previousEventSha256: bytes(previous.event.sha256), eventKind: "planAdmitted", subjectSha256: bytes(head.admission.admission.sha256),
          frameFormat: event.frame.format, frameVersion: 1, canonicalByteLength: canonicalBytes.byteLength, canonicalBytes,
        }).returning({ storageId: fxSystemFrameworkMigrationEvents.eventStorageId });
        const row = rows[0];
        if (row === undefined) throw new Error("Missing inserted event");
        previous = { storageId: row.storageId, event };
        const read = restoreStoredFrameworkMigrationEventReferenceInTransactionEffect(tx, collision, row.storageId,
          event.frame.sequence, event.sha256, "readEvent");
        if (sequence === 128) expect((await runEffect(withAdditiveMigrationGraphLimits(read))).event.sha256).toBe(event.sha256);
        if (sequence === 129) {
          if (additive) {
            expect(await runEffectFailure(read)).toMatchObject({ reason: "referenceRefusal" });
            expect(await runEffectFailure(restoreStoredFrameworkMigrationEventReferenceInTransactionEffect(tx, otherCollision,
              row.storageId, event.frame.sequence, event.sha256, "readEvent"))).toMatchObject({ reason: "referenceRefusal" });
          }
          else await runEffect(withFrameworkGraphReadPass(Effect.gen(function* () {
            expect((yield* read).event.sha256).toBe(event.sha256);
            const failure = yield* Effect.result(withAdditiveMigrationGraphLimits(read));
            expect(Result.isFailure(failure) && failure.failure.reason).toBe("referenceRefusal");
          }), tx));
        }
      }
    });
  }, 240_000);

  it("accepts eight availability nodes and refuses a ninth before successor publication", async () => {
    const fixture = await createAdditiveFixture();
    for (const status of ["withdrawn", "quarantined", "ready", "withdrawn", "ready", "withdrawn", "ready"] as const) {
      await fixture.persistence.drizzle.transaction(tx => runEffect(changeBaseAvailability(tx, fixture.base.readiness.installation, status)));
    }
    const pending = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect({ ...fixture.input, maximumStepsPerRun: 0 }));
    expect(pending.kind).toBe("pending");
    await expect(fixture.persistence.drizzle.transaction(tx => runEffect(changeBaseAvailability(tx, fixture.base.readiness.installation, "withdrawn"))))
      .rejects.toMatchObject({ reason: "referenceRefusal" });
    expect((await fixture.persistence.query("select * from fx_system_framework_schema_availability_history")).rows).toHaveLength(8);
    expect(await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ kind: "ready" });
  }, 240_000);
});

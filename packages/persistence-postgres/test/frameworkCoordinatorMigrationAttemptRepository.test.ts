import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { eq } from "drizzle-orm";
import { Encoding, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationPlanAdmission,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  ensureFrameworkMigrationAttemptStartInTransactionEffect,
  readFrameworkMigrationAttemptStartInTransactionEffect,
} from "../src/migrationCoordination/migrationAttemptRepository";
import {
  ensureFrameworkMigrationPlanAdmissionInTransactionEffect,
} from "../src/migrationCoordination/migrationPlanAdmissionRepository";
import {
  ensureFreshRelationalMigrationPlanInTransactionEffect,
} from "../src/migrationCoordination/migrationPlanRepository";
import {
  ensureRelationalPhysicalNameAssignmentInTransactionEffect,
} from "../src/migrationCoordination/physicalNameAssignmentRepository";
import {
  fxSystemFrameworkMigrationAttemptStarts,
} from "../src/migrationCoordination/schema";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../src/migrationCoordination/targetCollisionRepository";
import type {
  RestoredFrameworkMigrationAttemptStart,
  RestoredFrameworkMigrationCollisionDomain,
  RestoredFrameworkMigrationPlanAdmission,
  RestoredFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/storedRestoration";
import { captureRelationalSchemaArtifact } from
  "../src/relationalSchema/artifact";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  FRAMEWORK_VALUE_LOCATOR,
  currencyArtifact,
  frameworkTargetNamespace,
  syntheticSchemaInput,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 30_000;
const STARTED_AT = "2026-08-27T08:30:00.000Z";
const LEASE_ONE = "2026-08-27T08:31:00.000Z";
const LEASE_TWO = "2026-08-27T08:32:00.000Z";
const LEASE_THREE = "2026-08-27T08:33:00.000Z";

describe("framework coordinator migration-attempt repository", () => {
  it("keeps transaction kernels source-private", async () => {
    expect(
      "ensureFrameworkMigrationAttemptStartInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkMigrationAttemptStartInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "resolveAuthenticatedFrameworkMigrationAttemptStartOccupantsEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "corroborateRestoredFrameworkMigrationAttemptStartInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "restoreStoredFrameworkMigrationAttemptStartReferenceInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/migrationAttemptRepository.ts",
    );
  });

  it("ensures, reads, and exactly replays a genesis attempt", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const admission = await ensureStoredAdmission(transaction, values);
        const attempt = await captureAttempt(
          admission,
          "attempt-a",
          "1",
          LEASE_ONE,
          null,
        );
        const missing = await runEffect(
          readFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            attempt,
          ),
        );
        expect(Option.isNone(missing)).toBe(true);

        const first = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            attempt,
          ),
        );
        const replayed = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            attempt,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            attempt,
          ),
        ));
        expect(replayed.storageId).toBe(first.storageId);
        expect(read).toEqual(first);
        return { admission, attempt, first };
      },
    );

    expect(stored.first.attempt).toEqual(stored.attempt);
    expect(stored.first.attempt).not.toBe(stored.attempt);
    const rows = await persistence.drizzle.select().from(
      fxSystemFrameworkMigrationAttemptStarts,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (row === undefined) throw new Error("Missing stored attempt row");
    expect(row).toMatchObject({
      attemptStorageId: stored.first.storageId,
      collisionStorageId: stored.admission.collision.storageId,
      planStorageId: stored.admission.plan.storageId,
      admissionStorageId: stored.admission.storageId,
      attemptId: "attempt-a",
      attemptFence: 1n,
      leaseOwnerId: "worker-a",
      previousAttemptStorageId: null,
      previousAttemptId: null,
      canonicalByteLength: new TextEncoder().encode(
        stored.attempt.canonicalJson,
      ).byteLength,
    });
    expect(row.leaseExpiresAt.toISOString()).toBe(LEASE_ONE);
    expect(Encoding.encodeHex(row.migrationPlanSha256)).toBe(
      stored.admission.plan.plan.migrationPlanSha256,
    );
    expect(Encoding.encodeHex(row.admissionSha256)).toBe(
      stored.admission.admission.sha256,
    );
    expect(Encoding.encodeHex(row.attemptStartSha256)).toBe(
      stored.attempt.sha256,
    );
    expect(row.canonicalBytes).toEqual(
      new TextEncoder().encode(stored.attempt.canonicalJson),
    );
  }, PGLITE_TEST_TIMEOUT);

  it("restores a three-attempt chain across collision-local admissions", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const previousValues = await freshPlanRepositoryValues();
    const currentValues = await nextFreshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const previousPlan = await ensureStoredPlan(
          transaction,
          previousValues,
        );
        const previousAdmission = await ensureStoredAdmissionForPlan(
          transaction,
          previousPlan,
          null,
        );
        const firstAttemptValue = await captureAttempt(
          previousAdmission,
          "attempt-a",
          "1",
          LEASE_ONE,
          null,
        );
        const firstAttempt = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            previousAdmission,
            null,
            firstAttemptValue,
          ),
        );

        await ensureAssignments(
          transaction,
          previousPlan.collision,
          currentValues,
        );
        const currentPlan = await runEffect(
          ensureFreshRelationalMigrationPlanInTransactionEffect(
            transaction,
            previousPlan.collision,
            currentValues.plan,
          ),
        );
        const currentAdmission = await ensureStoredAdmissionForPlan(
          transaction,
          currentPlan,
          previousPlan,
        );
        const secondAttemptValue = await captureAttempt(
          currentAdmission,
          "attempt-b",
          "2",
          LEASE_TWO,
          firstAttempt,
        );
        const secondAttempt = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            currentAdmission,
            firstAttempt,
            secondAttemptValue,
          ),
        );
        const thirdAttemptValue = await captureAttempt(
          currentAdmission,
          "attempt-c",
          "3",
          LEASE_THREE,
          secondAttempt,
        );
        const thirdAttempt = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            currentAdmission,
            secondAttempt,
            thirdAttemptValue,
          ),
        );
        return {
          currentAdmission,
          firstAttempt,
          secondAttempt,
          thirdAttempt,
          thirdAttemptValue,
        };
      },
    );

    const read = await persistence.drizzle.transaction(
      transaction => runEffect(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.currentAdmission,
          stored.secondAttempt,
          stored.thirdAttemptValue,
        ),
      ),
    );
    expect(Option.getOrThrow(read)).toEqual(stored.thirdAttempt);
    const crossAdmissionConflict = await captureAttempt(
      stored.currentAdmission,
      "attempt-a",
      "4",
      LEASE_THREE,
      null,
    );
    const conflictFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.currentAdmission,
          null,
          crossAdmissionConflict,
        ),
      ),
    );
    expect(conflictFailure).toMatchObject({
      operation: "readAttemptStart",
      reason: "immutableConflict",
    });
    expect(stored.firstAttempt.admission.storageId).not.toBe(
      stored.currentAdmission.storageId,
    );
    await expect(attemptCount(persistence)).resolves.toBe("3");
  }, PGLITE_TEST_TIMEOUT);

  it("classifies independent attempt-id and fence occupants as conflicts", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const admission = await ensureStoredAdmission(transaction, values);
        const firstValue = await captureAttempt(
          admission,
          "attempt-a",
          "1",
          LEASE_ONE,
          null,
        );
        await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            firstValue,
          ),
        );
        const secondValue = await captureAttempt(
          admission,
          "attempt-b",
          "2",
          LEASE_TWO,
          null,
        );
        await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            secondValue,
          ),
        );
        return { admission };
      },
    );
    const sameId = await captureAttempt(
      stored.admission,
      "attempt-a",
      "3",
      LEASE_THREE,
      null,
    );
    const sameFence = await captureAttempt(
      stored.admission,
      "attempt-c",
      "2",
      LEASE_THREE,
      null,
    );

    const sameIdFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          null,
          sameId,
        ),
      ),
    );
    expect(sameIdFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensureAttemptStart",
      reason: "immutableConflict",
    });
    const sameFenceFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          null,
          sameFence,
        ),
      ),
    );
    expect(sameFenceFailure).toMatchObject({
      operation: "readAttemptStart",
      reason: "immutableConflict",
    });
    await expect(attemptCount(persistence)).resolves.toBe("2");
  }, PGLITE_TEST_TIMEOUT);

  it("refuses forged, missing, wrong, and cross-collision references", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const foreignValues = await currencyPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const admission = await ensureStoredAdmission(transaction, values);
        const firstValue = await captureAttempt(
          admission,
          "attempt-a",
          "1",
          LEASE_ONE,
          null,
        );
        const first = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            firstValue,
          ),
        );
        const nextValue = await captureAttempt(
          admission,
          "attempt-b",
          "2",
          LEASE_TWO,
          first,
        );
        const siblingValue = await captureAttempt(
          admission,
          "attempt-sibling",
          "3",
          LEASE_THREE,
          null,
        );
        const sibling = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            siblingValue,
          ),
        );
        const foreignAdmission = await ensureStoredAdmission(
          transaction,
          foreignValues,
        );
        const foreignValue = await captureAttempt(
          foreignAdmission,
          "attempt-foreign",
          "1",
          LEASE_ONE,
          null,
        );
        const foreign = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            foreignAdmission,
            null,
            foreignValue,
          ),
        );
        return { admission, first, foreign, nextValue, sibling };
      },
    );

    const forgedFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          stored.first,
          Object.freeze({ ...stored.nextValue }),
        ),
      ),
    );
    expect(forgedFailure).toMatchObject({
      operation: "ensureAttemptStart",
      reason: "referenceRefusal",
    });
    const missingPreviousFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          null,
          stored.nextValue,
        ),
      ),
    );
    expect(missingPreviousFailure).toMatchObject({
      operation: "ensureAttemptStart",
      reason: "referenceRefusal",
    });
    const wrongPreviousFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          stored.sibling,
          stored.nextValue,
        ),
      ),
    );
    expect(wrongPreviousFailure).toMatchObject({
      operation: "ensureAttemptStart",
      reason: "referenceRefusal",
    });
    const crossCollisionValue = await captureAttempt(
      stored.admission,
      "attempt-cross",
      "4",
      LEASE_THREE,
      stored.foreign,
    );
    const crossCollisionFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          stored.foreign,
          crossCollisionValue,
        ),
      ),
    );
    expect(crossCollisionFailure).toMatchObject({
      operation: "ensureAttemptStart",
      reason: "referenceRefusal",
    });

    const missingPersistence = await createMigratedPGlitePersistence();
    const missingFailure = await missingPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          stored.first,
          stored.nextValue,
        ),
      ),
    );
    expect(missingFailure).toMatchObject({
      operation: "readAttemptStart",
      reason: "referenceRefusal",
    });
    await expect(attemptCount(persistence)).resolves.toBe("3");
  }, PGLITE_TEST_TIMEOUT);

  it("reports a changed lease projection and broken predecessor without healing", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const admission = await ensureStoredAdmission(transaction, values);
        const firstValue = await captureAttempt(
          admission,
          "attempt-a",
          "1",
          LEASE_ONE,
          null,
        );
        const first = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            firstValue,
          ),
        );
        const secondValue = await captureAttempt(
          admission,
          "attempt-b",
          "2",
          LEASE_TWO,
          first,
        );
        const second = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            first,
            secondValue,
          ),
        );
        return { admission, first, second, secondValue };
      },
    );
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptStarts,
    ).set({ leaseExpiresAt: new Date(Date.parse(LEASE_TWO) + 1) }).where(eq(
      fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
      stored.second.storageId,
    ));
    const leaseFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          stored.first,
          stored.secondValue,
        ),
      ),
    );
    expect(leaseFailure).toMatchObject({
      operation: "readAttemptStart",
      reason: "storedCorruption",
    });
    await expect(attemptCount(persistence)).resolves.toBe("2");

    const chainPersistence = await createMigratedPGlitePersistence();
    const chainValues = await freshPlanRepositoryValues();
    const chain = await chainPersistence.drizzle.transaction(
      async transaction => {
        const admission = await ensureStoredAdmission(transaction, chainValues);
        const firstValue = await captureAttempt(
          admission,
          "attempt-chain-a",
          "1",
          LEASE_ONE,
          null,
        );
        const first = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            firstValue,
          ),
        );
        const secondValue = await captureAttempt(
          admission,
          "attempt-chain-b",
          "2",
          LEASE_TWO,
          first,
        );
        const second = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            first,
            secondValue,
          ),
        );
        return { admission, first, second, secondValue };
      },
    );
    await chainPersistence.query(`
      alter table fx_system_framework_migration_attempt_start
        drop constraint fx_framework_migration_attempt_previous_fk
    `);
    await chainPersistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptStarts,
    ).set({ previousAttemptStorageId: 9_999n }).where(eq(
      fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
      chain.second.storageId,
    ));
    const chainFailure = await chainPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          chain.admission,
          chain.first,
          chain.secondValue,
        ),
      ),
    );
    expect(chainFailure).toMatchObject({
      operation: "readAttemptStart",
      reason: "storedCorruption",
    });
  }, 60_000);

  it("rejects corrupt and over-limit canonical attempt bytes", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const admission = await ensureStoredAdmission(transaction, values);
        const attempt = await captureAttempt(
          admission,
          "attempt-a",
          "1",
          LEASE_ONE,
          null,
        );
        const restored = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            attempt,
          ),
        );
        return { admission, attempt, restored };
      },
    );
    const changedBytes = new TextEncoder().encode(stored.attempt.canonicalJson);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptStarts,
    ).set({ canonicalBytes: changedBytes }).where(eq(
      fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
      stored.restored.storageId,
    ));
    const corruptFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          null,
          stored.attempt,
        ),
      ),
    );
    expect(corruptFailure).toMatchObject({
      operation: "readAttemptStart",
      reason: "storedCorruption",
    });

    await persistence.query(`
      alter table fx_system_framework_migration_attempt_start
        drop constraint fx_framework_migration_attempt_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptStarts,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
      stored.restored.storageId,
    ));
    const overLimitFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          null,
          stored.attempt,
        ),
      ),
    );
    expect(overLimitFailure).toMatchObject({
      operation: "readAttemptStart",
      reason: "storedCorruption",
    });
  }, 60_000);

  it("rejects a cyclic stored predecessor chain", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const admission = await ensureStoredAdmission(transaction, values);
        const firstValue = await captureAttempt(
          admission,
          "attempt-cycle-a",
          "1",
          LEASE_ONE,
          null,
        );
        const first = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            firstValue,
          ),
        );
        const secondValue = await captureAttempt(
          admission,
          "attempt-cycle-b",
          "2",
          LEASE_TWO,
          null,
        );
        const second = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            admission,
            null,
            secondValue,
          ),
        );
        const cyclicFirst = await captureAttemptWithPreviousId(
          admission,
          "attempt-cycle-a",
          "1",
          LEASE_ONE,
          "attempt-cycle-b",
        );
        const cyclicSecond = await captureAttemptWithPreviousId(
          admission,
          "attempt-cycle-b",
          "2",
          LEASE_TWO,
          "attempt-cycle-a",
        );
        return {
          admission,
          first,
          firstValue,
          second,
          cyclicFirst,
          cyclicSecond,
        };
      },
    );
    await persistence.query(`
      alter table fx_system_framework_migration_attempt_start
        drop constraint fx_framework_migration_attempt_previous_fk
    `);
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptStarts,
    ).set({
      previousAttemptStorageId: stored.second.storageId,
      previousAttemptId: stored.cyclicFirst.frame.previousAttemptId,
      attemptStartSha256: decodeSha256(stored.cyclicFirst.sha256),
      canonicalByteLength: canonicalBytes(stored.cyclicFirst).byteLength,
      canonicalBytes: canonicalBytes(stored.cyclicFirst),
    }).where(eq(
      fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
      stored.first.storageId,
    ));
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptStarts,
    ).set({
      previousAttemptStorageId: stored.first.storageId,
      previousAttemptId: stored.cyclicSecond.frame.previousAttemptId,
      attemptStartSha256: decodeSha256(stored.cyclicSecond.sha256),
      canonicalByteLength: canonicalBytes(stored.cyclicSecond).byteLength,
      canonicalBytes: canonicalBytes(stored.cyclicSecond),
    }).where(eq(
      fxSystemFrameworkMigrationAttemptStarts.attemptStorageId,
      stored.second.storageId,
    ));

    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          stored.admission,
          null,
          stored.firstValue,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "readAttemptStart",
      reason: "storedCorruption",
    });
    await expect(attemptCount(persistence)).resolves.toBe("2");
  }, 60_000);

  it("rejects extended-year leases, follows caller rollback, and projects driver failure", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const admission = await persistence.drizzle.transaction(
      transaction => ensureStoredAdmission(transaction, values),
    );
    const extendedLease = await captureAttempt(
      admission,
      "attempt-extended",
      "1",
      "+010000-01-01T00:00:00.000Z",
      null,
    );
    const extendedFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          admission,
          null,
          extendedLease,
        ),
      ),
    );
    expect(extendedFailure).toMatchObject({
      operation: "ensureAttemptStart",
      reason: "referenceRefusal",
    });
    await expect(attemptCount(persistence)).resolves.toBe("0");

    const attempt = await captureAttempt(
      admission,
      "attempt-rollback",
      "2",
      LEASE_TWO,
      null,
    );
    const deliberateRollback = new Error("deliberate attempt rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(
        ensureFrameworkMigrationAttemptStartInTransactionEffect(
          transaction,
          admission,
          null,
          attempt,
        ),
      );
      throw deliberateRollback;
    })).rejects.toBe(deliberateRollback);
    await expect(attemptCount(persistence)).resolves.toBe("0");

    const driverCause = new Error("attempt driver unavailable");
    const driverFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptStartInTransactionEffect(
          rejectingAttemptRootSelectTransaction(transaction, driverCause),
          admission,
          null,
          attempt,
        ),
      ),
    );
    expect(driverFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readAttemptStart",
      reason: "resourceFailure",
      cause: driverCause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function freshPlanRepositoryValues() {
  return planRepositoryValues(await syntheticSystemArtifact());
}

async function currencyPlanRepositoryValues() {
  return planRepositoryValues(await currencyArtifact());
}

async function nextFreshPlanRepositoryValues() {
  const artifact = await runEffect(captureRelationalSchemaArtifact({
    deploymentId: "deployment-a",
    provenance: {
      kind: "synthetic",
      fixtureId: "relational-system-next-attempt",
    },
    schema: syntheticSchemaInput(),
  }));
  return planRepositoryValues(artifact);
}

async function planRepositoryValues(
  artifact: Awaited<ReturnType<typeof syntheticSystemArtifact>>,
) {
  const target = await frameworkTargetNamespace();
  const physicalLayout = await runEffect(captureRelationalPhysicalLayout({
    artifact: artifact.artifact,
    physicalLocator: FRAMEWORK_VALUE_LOCATOR,
    targetNamespace: target,
  }));
  const plan = await runEffect(captureFreshRelationalMigrationPlan({
    artifact: artifact.artifact,
    physicalLayout,
  }));
  return { target, physicalLayout, plan };
}

async function ensureStoredPlan(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof freshPlanRepositoryValues>>,
): Promise<RestoredFreshRelationalMigrationPlan> {
  const target = await runEffect(
    ensureFrameworkSchemaTargetNamespaceInTransactionEffect(
      transaction,
      values.target,
    ),
  );
  const collision = await runEffect(
    ensureFrameworkMigrationCollisionDomainInTransactionEffect(
      transaction,
      target,
      values.plan,
    ),
  );
  await ensureAssignments(transaction, collision, values);
  return runEffect(ensureFreshRelationalMigrationPlanInTransactionEffect(
    transaction,
    collision,
    values.plan,
  ));
}

async function ensureAssignments(
  transaction: FlarexMetadataTransaction,
  collision: RestoredFrameworkMigrationCollisionDomain,
  values: Awaited<ReturnType<typeof freshPlanRepositoryValues>>,
): Promise<void> {
  for (const assignment of values.physicalLayout.nameAssignments) {
    await runEffect(
      ensureRelationalPhysicalNameAssignmentInTransactionEffect(
        transaction,
        collision,
        assignment,
      ),
    );
  }
}

async function ensureStoredAdmission(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof freshPlanRepositoryValues>>,
): Promise<RestoredFrameworkMigrationPlanAdmission> {
  const plan = await ensureStoredPlan(transaction, values);
  return ensureStoredAdmissionForPlan(transaction, plan, null);
}

async function ensureStoredAdmissionForPlan(
  transaction: FlarexMetadataTransaction,
  plan: RestoredFreshRelationalMigrationPlan,
  previousPlan: RestoredFreshRelationalMigrationPlan | null,
): Promise<RestoredFrameworkMigrationPlanAdmission> {
  const admission = await runEffect(captureFrameworkMigrationPlanAdmission({
    plan: plan.plan,
    nameAssignments: plan.plan.physicalLayout.nameAssignments,
    previousPlanSha256: previousPlan?.plan.migrationPlanSha256 ?? null,
    admittedAt: STARTED_AT,
  }));
  return runEffect(
    ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
      transaction,
      plan,
      previousPlan,
      admission,
    ),
  );
}

async function captureAttempt(
  admission: RestoredFrameworkMigrationPlanAdmission,
  attemptId: string,
  attemptFence: string,
  leaseExpiresAt: string,
  previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
) {
  return captureAttemptWithPreviousId(
    admission,
    attemptId,
    attemptFence,
    leaseExpiresAt,
    previousAttempt?.attempt.frame.attemptId ?? null,
  );
}

async function captureAttemptWithPreviousId(
  admission: RestoredFrameworkMigrationPlanAdmission,
  attemptId: string,
  attemptFence: string,
  leaseExpiresAt: string,
  previousAttemptId: string | null,
) {
  return runEffect(captureFrameworkMigrationAttemptStart({
    admission: admission.admission,
    attemptId,
    attemptFence,
    leaseOwnerId: "worker-a",
    leaseExpiresAt,
    previousAttemptId,
    startedAt: STARTED_AT,
  }));
}

function canonicalBytes(
  value: Awaited<ReturnType<typeof captureAttemptWithPreviousId>>,
): Uint8Array {
  return new TextEncoder().encode(value.canonicalJson);
}

function decodeSha256(value: string): Uint8Array {
  return Result.getOrThrow(Encoding.decodeHex(value));
}

async function attemptCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
      from fx_system_framework_migration_attempt_start
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing attempt count row");
  return row.count;
}

function rejectingAttemptRootSelectTransaction(
  transaction: FlarexMetadataTransaction,
  cause: unknown,
): FlarexMetadataTransaction {
  function rejectAtLimit(input: UnknownRecord): UnknownRecord {
    return new Proxy(input, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (typeof member !== "function") return member;
        if (property === "limit") return () => Promise.reject(cause);
        return (...args: unknown[]) => {
          const next = Reflect.apply(member, target, args);
          if (!isNonArrayRecord(next)) {
            throw new TypeError("Attempt read builder must remain an object");
          }
          return rejectAtLimit(next);
        };
      },
    });
  }

  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property !== "select") return Reflect.get(target, property, receiver);
      const select = Reflect.get(target, property, receiver);
      if (typeof select !== "function") return select;
      return (...args: unknown[]) => {
        const query = Reflect.apply(select, target, args);
        if (!isAttemptRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Attempt select must return a query object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isAttemptRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "attemptStorageId") &&
    Object.hasOwn(input, "leaseExpiresAt") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}

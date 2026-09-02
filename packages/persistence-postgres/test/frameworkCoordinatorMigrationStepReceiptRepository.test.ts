import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Encoding, Option } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationPlanAdmission,
  captureFrameworkMigrationStepReceipt,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  ensureFrameworkMigrationAttemptStartInTransactionEffect,
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
  ensureFrameworkMigrationStepReceiptInTransactionEffect,
  readFrameworkMigrationStepReceiptInTransactionEffect,
  resolveAuthenticatedFrameworkMigrationStepReceiptOccupantsEffect,
} from "../src/migrationCoordination/migrationStepReceiptRepository";
import type { FrameworkMigrationRepositoryError } from
  "../src/migrationCoordination/repositoryErrors";
import {
  fxSystemFrameworkMigrationStepReceiptDependencies,
  fxSystemFrameworkMigrationStepReceipts,
} from "../src/migrationCoordination/schema";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../src/migrationCoordination/targetCollisionRepository";
import type {
  RestoredFrameworkMigrationAttemptStart,
  RestoredFrameworkMigrationCollisionDomain,
  RestoredFrameworkMigrationPlanAdmission,
  RestoredFrameworkMigrationStepReceipt,
  RestoredFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/storedRestoration";
import { captureRelationalPhysicalLayout } from
  "../src/relationalSchema/physical/canonical";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  FRAMEWORK_VALUE_LOCATOR,
  completeFrameworkMigrationPlanSteps,
  frameworkTargetNamespace,
  syntheticSystemArtifact,
} from "./frameworkMigrationValueFixtures";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const PGLITE_TEST_TIMEOUT = 30_000;
const STARTED_AT = "2026-08-27T08:30:00.000Z";
const FIRST_COMPLETED_AT = "2026-08-27T08:31:00.000Z";
const SECOND_COMPLETED_AT = "2026-08-27T08:32:00.000Z";

type ReceiptValue = Awaited<
  ReturnType<typeof completeFrameworkMigrationPlanSteps>
>[number];

describe("framework coordinator migration-step receipt repository", () => {
  it("keeps transaction kernels source-private", async () => {
    expect(
      "ensureFrameworkMigrationStepReceiptInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkMigrationStepReceiptInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "resolveAuthenticatedFrameworkMigrationStepReceiptOccupantsEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "corroborateRestoredFrameworkMigrationStepReceiptInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(Object.values(packageJson.default.exports)).not.toContain(
      "./src/migrationCoordination/migrationStepReceiptRepository.ts",
    );
  });

  it("ensures, reads, and exactly replays the complete topological receipt graph", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const first = await persistence.drizzle.transaction(
      async transaction => {
        const attempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-a",
          "1",
          null,
        );
        const receiptValues = await completeFrameworkMigrationPlanSteps(
          attempt.plan.plan,
          attempt.attempt,
          FIRST_COMPLETED_AT,
        );
        const restoredByStepId = new Map<
          string,
          RestoredFrameworkMigrationStepReceipt
        >();
        const restored: RestoredFrameworkMigrationStepReceipt[] = [];

        for (const receipt of receiptValues) {
          const dependencies = dependenciesFor(
            receipt,
            restoredByStepId,
          );
          const missing = await runEffect(
            readFrameworkMigrationStepReceiptInTransactionEffect(
              transaction,
              attempt,
              dependencies,
              receipt,
            ),
          );
          expect(Option.isNone(missing)).toBe(true);
          const ensured = await runEffect(
            ensureFrameworkMigrationStepReceiptInTransactionEffect(
              transaction,
              attempt,
              dependencies,
              receipt,
            ),
          );
          const replayed = await runEffect(
            ensureFrameworkMigrationStepReceiptInTransactionEffect(
              transaction,
              attempt,
              dependencies,
              receipt,
            ),
          );
          const read = Option.getOrThrow(await runEffect(
            readFrameworkMigrationStepReceiptInTransactionEffect(
              transaction,
              attempt,
              dependencies,
              receipt,
            ),
          ));
          expect(replayed.storageId).toBe(ensured.storageId);
          expect(read).toEqual(ensured);
          restoredByStepId.set(receipt.frame.stepId, ensured);
          restored.push(ensured);
        }
        return { attempt, receiptValues, restored };
      },
    );

    const separateCallerReplay = await persistence.drizzle.transaction(
      transaction => ensureStoredReceiptGraph(
        transaction,
        first.attempt,
        first.receiptValues,
      ),
    );
    expect(separateCallerReplay.map(receipt => receipt.storageId)).toEqual(
      first.restored.map(receipt => receipt.storageId),
    );
    for (let index = 0; index < first.receiptValues.length; index += 1) {
      expect(first.restored[index]?.receipt).toEqual(first.receiptValues[index]);
      expect(first.restored[index]?.receipt).not.toBe(first.receiptValues[index]);
    }

    await expect(receiptAggregateCounts(persistence)).resolves.toEqual({
      receipts: String(first.receiptValues.length),
      dependencies: String(first.receiptValues.reduce(
        (count, receipt) => count + receipt.frame.dependencyReceipts.length,
        0,
      )),
    });
    await expect(storedReceiptRoots(persistence)).resolves.toEqual(
      expectedReceiptRoots(first.attempt, first.restored),
    );
    await expect(storedReceiptDependencies(persistence)).resolves.toEqual(
      expectedReceiptDependencies(first.restored),
    );
  }, PGLITE_TEST_TIMEOUT);

  it("keeps one plan's dependency graph isolated across later attempts", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const firstAttempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-a",
          "1",
          null,
        );
        const firstValues = await completeFrameworkMigrationPlanSteps(
          firstAttempt.plan.plan,
          firstAttempt.attempt,
          FIRST_COMPLETED_AT,
        );
        const firstReceipts = await ensureStoredReceiptGraph(
          transaction,
          firstAttempt,
          firstValues,
        );
        const secondAttemptValue = await captureAttempt(
          firstAttempt.admission,
          "attempt-b",
          "2",
          firstAttempt,
        );
        const secondAttempt = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            firstAttempt.admission,
            firstAttempt,
            secondAttemptValue,
          ),
        );
        const secondValues = await completeFrameworkMigrationPlanSteps(
          secondAttempt.plan.plan,
          secondAttempt.attempt,
          SECOND_COMPLETED_AT,
        );
        const secondReceipts = await ensureStoredReceiptGraph(
          transaction,
          secondAttempt,
          secondValues,
        );
        return {
          firstAttempt,
          firstReceipts,
          secondAttempt,
          secondReceipts,
        };
      },
    );

    const finalSecondReceipt = requiredLast(stored.secondReceipts);
    const sidecars = await persistence.drizzle.select().from(
      fxSystemFrameworkMigrationStepReceiptDependencies,
    ).where(eq(
      fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId,
      finalSecondReceipt.storageId,
    )).orderBy(
      asc(fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal),
    );
    const firstStorageIds = new Set(
      stored.firstReceipts.map(receipt => receipt.storageId),
    );
    const secondStorageIds = new Set(
      stored.secondReceipts.map(receipt => receipt.storageId),
    );
    expect(sidecars).toHaveLength(
      finalSecondReceipt.receipt.frame.dependencyReceipts.length,
    );
    expect(sidecars.every(row =>
      row.attemptStorageId === stored.secondAttempt.storageId &&
      secondStorageIds.has(row.dependencyReceiptStorageId) &&
      !firstStorageIds.has(row.dependencyReceiptStorageId)
    )).toBe(true);
    await expect(receiptAggregateCounts(persistence)).resolves.toEqual({
      receipts: String(stored.firstReceipts.length * 2),
      dependencies: String(
        expectedReceiptDependencies(stored.firstReceipts).length * 2,
      ),
    });
  }, PGLITE_TEST_TIMEOUT);

  it("resolves semantic occupants before lazily consulting the digest index", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedReceiptFixture(persistence);
    const expected = requiredLast(stored.receiptValues);
    const expectedRestored = requiredLast(stored.receipts);
    const expectedDependencies = dependenciesForArray(
      expected,
      stored.receipts,
    );
    const exactOccupant = Object.freeze({
      value: expectedRestored,
      dependencyReceipts: expectedDependencies,
    });
    const nonExactRestored = requiredFirst(stored.receipts);
    const nonExactOccupant = Object.freeze({
      value: nonExactRestored,
      dependencyReceipts: Object.freeze([]),
    });

    let exactDigestReads = 0;
    const exact = await runEffect(
      resolveAuthenticatedFrameworkMigrationStepReceiptOccupantsEffect(
        stored.attempt,
        expectedDependencies,
        expected,
        "readStepReceipt",
        {
          readByAttemptStep: () => Effect.succeed(Option.some(exactOccupant)),
          readByDigest: () => {
            exactDigestReads += 1;
            return Effect.succeed(Option.none());
          },
        },
      ),
    );
    expect(Option.getOrThrow(exact)).toEqual(expectedRestored);
    expect(exactDigestReads).toBe(0);

    let conflictingDigestReads = 0;
    const semanticFailure = await runEffectFailure(
      resolveAuthenticatedFrameworkMigrationStepReceiptOccupantsEffect(
        stored.attempt,
        expectedDependencies,
        expected,
        "readStepReceipt",
        {
          // This trusted lookup seam represents the same-attempt/step unique
          // occupant without requiring a physically realizable constraint
          // violation.
          readByAttemptStep: () =>
            Effect.succeed(Option.some(nonExactOccupant)),
          readByDigest: () => {
            conflictingDigestReads += 1;
            return Effect.succeed(Option.some(exactOccupant));
          },
        },
      ),
    );
    expect(semanticFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readStepReceipt",
      reason: "immutableConflict",
    });
    expect(conflictingDigestReads).toBe(0);

    let absentDigestReads = 0;
    const digestFailure = await runEffectFailure(
      resolveAuthenticatedFrameworkMigrationStepReceiptOccupantsEffect(
        stored.attempt,
        expectedDependencies,
        expected,
        "readStepReceipt",
        {
          readByAttemptStep: () => Effect.succeed(Option.none()),
          // This authenticated occupant stands in for an impossible SHA-256
          // collision returned by the global digest index.
          readByDigest: () => {
            absentDigestReads += 1;
            return Effect.succeed(Option.some(nonExactOccupant));
          },
        },
      ),
    );
    expect(digestFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readStepReceipt",
      reason: "immutableConflict",
    });
    expect(absentDigestReads).toBe(1);
  }, PGLITE_TEST_TIMEOUT);

  it("refuses forged, wrong, missing, and cross-attempt prerequisites", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const firstAttempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-a",
          "1",
          null,
        );
        const firstValues = await completeFrameworkMigrationPlanSteps(
          firstAttempt.plan.plan,
          firstAttempt.attempt,
          FIRST_COMPLETED_AT,
        );
        const firstReceipts = await ensureStoredReceiptGraph(
          transaction,
          firstAttempt,
          firstValues,
        );
        const secondAttemptValue = await captureAttempt(
          firstAttempt.admission,
          "attempt-b",
          "2",
          firstAttempt,
        );
        const secondAttempt = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            firstAttempt.admission,
            firstAttempt,
            secondAttemptValue,
          ),
        );
        const secondValues = await completeFrameworkMigrationPlanSteps(
          secondAttempt.plan.plan,
          secondAttempt.attempt,
          SECOND_COMPLETED_AT,
        );
        return {
          firstAttempt,
          firstReceipts,
          firstValues,
          secondAttempt,
          secondValues,
        };
      },
    );
    const firstFinalValue = requiredLast(stored.firstValues);
    const firstFinalDependencies = dependenciesForArray(
      firstFinalValue,
      stored.firstReceipts,
    );
    const secondFinalValue = requiredLast(stored.secondValues);

    await expectReferenceRefusal(persistence, "ensureStepReceipt", transaction =>
      ensureFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        Object.freeze({ ...stored.firstAttempt }),
        firstFinalDependencies,
        firstFinalValue,
      )
    );
    await expectReferenceRefusal(persistence, "ensureStepReceipt", transaction =>
      ensureFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        stored.firstAttempt,
        firstFinalDependencies,
        Object.freeze({ ...firstFinalValue }),
      )
    );
    await expectReferenceRefusal(persistence, "ensureStepReceipt", transaction =>
      ensureFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        stored.firstAttempt,
        firstFinalDependencies.slice(1),
        firstFinalValue,
      )
    );
    const firstDependency = requiredFirst(firstFinalDependencies);
    await expectReferenceRefusal(persistence, "ensureStepReceipt", transaction =>
      ensureFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        stored.firstAttempt,
        Object.freeze([
          Object.freeze({ ...firstDependency }),
          ...firstFinalDependencies.slice(1),
        ]),
        firstFinalValue,
      )
    );
    await expectReferenceRefusal(persistence, "readStepReceipt", transaction =>
      readFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        stored.firstAttempt,
        replaceFirstDependencyWithDuplicate(firstFinalDependencies),
        firstFinalValue,
      )
    );
    await expectReferenceRefusal(persistence, "ensureStepReceipt", transaction =>
      ensureFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        stored.secondAttempt,
        firstFinalDependencies,
        secondFinalValue,
      )
    );
    await expectReferenceRefusal(persistence, "readStepReceipt", transaction =>
      readFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        stored.secondAttempt,
        firstFinalDependencies,
        firstFinalValue,
      )
    );

    const missingPersistence = await createMigratedPGlitePersistence();
    await expectReferenceRefusal(
      missingPersistence,
      "readStepReceipt",
      transaction => readFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        stored.firstAttempt,
        firstFinalDependencies,
        firstFinalValue,
      ),
    );
    await expect(receiptAggregateCounts(persistence)).resolves.toEqual({
      receipts: String(stored.firstReceipts.length),
      dependencies: String(expectedReceiptDependencies(
        stored.firstReceipts,
      ).length),
    });
  }, 60_000);

  it("classifies an immutable same-attempt step occupant as a conflict", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const attempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-a",
          "1",
          null,
        );
        const receiptValues = await completeFrameworkMigrationPlanSteps(
          attempt.plan.plan,
          attempt.attempt,
          FIRST_COMPLETED_AT,
        );
        const receipts = await ensureStoredReceiptGraph(
          transaction,
          attempt,
          receiptValues,
        );
        return { attempt, receiptValues, receipts };
      },
    );
    const finalStep = requiredLast(stored.attempt.plan.plan.frame.steps);
    const dependencyValues = dependenciesForArray(
      requiredLast(stored.receiptValues),
      stored.receiptValues,
    );
    const conflicting = await runEffect(captureFrameworkMigrationStepReceipt({
      attempt: stored.attempt.attempt,
      step: finalStep,
      dependencyReceipts: dependencyValues,
      observedPostconditionSha256: finalStep.postconditionSha256,
      completedAt: SECOND_COMPLETED_AT,
    }));
    const dependencies = dependenciesForArray(
      requiredLast(stored.receiptValues),
      stored.receipts,
    );

    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationStepReceiptInTransactionEffect(
          transaction,
          stored.attempt,
          dependencies,
          conflicting,
        ),
      ),
    );
    expect(failure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "ensureStepReceipt",
      reason: "immutableConflict",
    });
    await expect(receiptAggregateCounts(persistence)).resolves.toEqual({
      receipts: String(stored.receipts.length),
      dependencies: String(expectedReceiptDependencies(stored.receipts).length),
    });
  }, PGLITE_TEST_TIMEOUT);

  it("reports missing and reordered dependency sidecars without healing", async () => {
    const missingPersistence = await createMigratedPGlitePersistence();
    const missing = await storedReceiptFixture(missingPersistence);
    const missingFinal = requiredLast(missing.receipts);
    const missingDependencies = dependenciesForArray(
      requiredLast(missing.receiptValues),
      missing.receipts,
    );
    await missingPersistence.drizzle.delete(
      fxSystemFrameworkMigrationStepReceiptDependencies,
    ).where(and(
      eq(
        fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId,
        missingFinal.storageId,
      ),
      eq(
        fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal,
        0,
      ),
    ));
    const missingFailure = await missingPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationStepReceiptInTransactionEffect(
          transaction,
          missing.attempt,
          missingDependencies,
          requiredLast(missing.receiptValues),
        ),
      ),
    );
    expect(missingFailure).toMatchObject({
      operation: "readStepReceipt",
      reason: "storedCorruption",
    });
    const missingCounts = await receiptAggregateCounts(missingPersistence);
    expect(missingCounts).toEqual({
      receipts: String(missing.receipts.length),
      dependencies: String(
        expectedReceiptDependencies(missing.receipts).length - 1,
      ),
    });
    await missingPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationStepReceiptInTransactionEffect(
          transaction,
          missing.attempt,
          missingDependencies,
          requiredLast(missing.receiptValues),
        ),
      ),
    );
    await expect(receiptAggregateCounts(missingPersistence)).resolves.toEqual(
      missingCounts,
    );

    const reorderedPersistence = await createMigratedPGlitePersistence();
    const reordered = await storedReceiptFixture(reorderedPersistence);
    const reorderedFinal = requiredLast(reordered.receipts);
    const reorderedValue = requiredLast(reordered.receiptValues);
    const reorderedDependencies = dependenciesForArray(
      reorderedValue,
      reordered.receipts,
    );
    if (reorderedDependencies.length < 2) {
      throw new Error("Fixture final receipt must have two dependencies");
    }
    await setDependencyOrdinal(
      reorderedPersistence,
      reorderedFinal.storageId,
      0,
      99,
    );
    await setDependencyOrdinal(
      reorderedPersistence,
      reorderedFinal.storageId,
      1,
      0,
    );
    await setDependencyOrdinal(
      reorderedPersistence,
      reorderedFinal.storageId,
      99,
      1,
    );
    const reorderedFailure = await reorderedPersistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationStepReceiptInTransactionEffect(
          transaction,
          reordered.attempt,
          reorderedDependencies,
          reorderedValue,
        ),
      ),
    );
    expect(reorderedFailure).toMatchObject({
      operation: "readStepReceipt",
      reason: "storedCorruption",
    });
    await expect(receiptAggregateCounts(reorderedPersistence)).resolves.toEqual({
      receipts: String(reordered.receipts.length),
      dependencies: String(expectedReceiptDependencies(
        reordered.receipts,
      ).length),
    });
  }, 60_000);

  it("rejects corrupt and over-limit canonical receipt bytes without healing", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedReceiptFixture(persistence);
    const root = requiredFirst(stored.receipts);
    const rootValue = requiredFirst(stored.receiptValues);
    const changedBytes = canonicalBytes(rootValue);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationStepReceipts,
    ).set({ canonicalBytes: changedBytes }).where(eq(
      fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
      root.storageId,
    ));
    const corruptFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationStepReceiptInTransactionEffect(
          transaction,
          stored.attempt,
          [],
          rootValue,
        ),
      ),
    );
    expect(corruptFailure).toMatchObject({
      operation: "readStepReceipt",
      reason: "storedCorruption",
    });

    await persistence.query(`
      alter table fx_system_framework_migration_step_receipt
        drop constraint fx_framework_migration_receipt_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await persistence.drizzle.update(
      fxSystemFrameworkMigrationStepReceipts,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkMigrationStepReceipts.receiptStorageId,
      root.storageId,
    ));
    const overLimitFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationStepReceiptInTransactionEffect(
          transaction,
          stored.attempt,
          [],
          rootValue,
        ),
      ),
    );
    expect(overLimitFailure).toMatchObject({
      operation: "ensureStepReceipt",
      reason: "storedCorruption",
    });
    await expect(receiptAggregateCounts(persistence)).resolves.toEqual({
      receipts: String(stored.receipts.length),
      dependencies: String(expectedReceiptDependencies(stored.receipts).length),
    });
  }, 60_000);

  it("follows caller rollback and preserves the exact foreign driver cause", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const attempt = await persistence.drizzle.transaction(
      transaction => ensureStoredAttempt(
        transaction,
        values,
        "attempt-rollback",
        "1",
        null,
      ),
    );
    const receiptValues = await completeFrameworkMigrationPlanSteps(
      attempt.plan.plan,
      attempt.attempt,
      FIRST_COMPLETED_AT,
    );
    const rootValue = requiredFirst(receiptValues);
    const deliberateRollback = new Error("deliberate receipt rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(
        ensureFrameworkMigrationStepReceiptInTransactionEffect(
          transaction,
          attempt,
          [],
          rootValue,
        ),
      );
      throw deliberateRollback;
    })).rejects.toBe(deliberateRollback);
    await expect(receiptAggregateCounts(persistence)).resolves.toEqual({
      receipts: "0",
      dependencies: "0",
    });

    const driverCause = new Error("step receipt driver unavailable");
    const driverFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationStepReceiptInTransactionEffect(
          rejectingReceiptRootSelectTransaction(transaction, driverCause),
          attempt,
          [],
          rootValue,
        ),
      ),
    );
    expect(driverFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readStepReceipt",
      reason: "resourceFailure",
      cause: driverCause,
    });
  }, PGLITE_TEST_TIMEOUT);
});

async function freshPlanRepositoryValues() {
  const artifact = await syntheticSystemArtifact();
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

async function ensureStoredAttempt(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof freshPlanRepositoryValues>>,
  attemptId: string,
  attemptFence: string,
  previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
): Promise<RestoredFrameworkMigrationAttemptStart> {
  const admission = previousAttempt?.admission ??
    await ensureStoredAdmission(transaction, values);
  const attempt = await captureAttempt(
    admission,
    attemptId,
    attemptFence,
    previousAttempt,
  );
  return runEffect(ensureFrameworkMigrationAttemptStartInTransactionEffect(
    transaction,
    admission,
    previousAttempt,
    attempt,
  ));
}

async function ensureStoredAdmission(
  transaction: FlarexMetadataTransaction,
  values: Awaited<ReturnType<typeof freshPlanRepositoryValues>>,
): Promise<RestoredFrameworkMigrationPlanAdmission> {
  const plan = await ensureStoredPlan(transaction, values);
  const admission = await runEffect(captureFrameworkMigrationPlanAdmission({
    plan: plan.plan,
    nameAssignments: plan.plan.physicalLayout.nameAssignments,
    previousPlanSha256: null,
    admittedAt: STARTED_AT,
  }));
  return runEffect(
    ensureFrameworkMigrationPlanAdmissionInTransactionEffect(
      transaction,
      plan,
      null,
      admission,
    ),
  );
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

async function captureAttempt(
  admission: RestoredFrameworkMigrationPlanAdmission,
  attemptId: string,
  attemptFence: string,
  previousAttempt: RestoredFrameworkMigrationAttemptStart | null,
) {
  return runEffect(captureFrameworkMigrationAttemptStart({
    admission: admission.admission,
    attemptId,
    attemptFence,
    leaseOwnerId: "worker-a",
    leaseExpiresAt: SECOND_COMPLETED_AT,
    previousAttemptId: previousAttempt?.attempt.frame.attemptId ?? null,
    startedAt: STARTED_AT,
  }));
}

async function ensureStoredReceiptGraph(
  transaction: FlarexMetadataTransaction,
  attempt: RestoredFrameworkMigrationAttemptStart,
  receiptValues: readonly ReceiptValue[],
): Promise<readonly RestoredFrameworkMigrationStepReceipt[]> {
  const restoredByStepId = new Map<
    string,
    RestoredFrameworkMigrationStepReceipt
  >();
  const restored: RestoredFrameworkMigrationStepReceipt[] = [];
  for (const receipt of receiptValues) {
    const value = await runEffect(
      ensureFrameworkMigrationStepReceiptInTransactionEffect(
        transaction,
        attempt,
        dependenciesFor(receipt, restoredByStepId),
        receipt,
      ),
    );
    restoredByStepId.set(receipt.frame.stepId, value);
    restored.push(value);
  }
  return Object.freeze(restored);
}

function dependenciesFor(
  receipt: ReceiptValue,
  restoredByStepId: ReadonlyMap<
    string,
    RestoredFrameworkMigrationStepReceipt
  >,
): readonly RestoredFrameworkMigrationStepReceipt[] {
  return receipt.frame.dependencyReceipts.map(reference => {
    const restored = restoredByStepId.get(reference.stepId);
    if (restored === undefined) {
      throw new Error("Fixture restored dependency receipt is missing");
    }
    return restored;
  });
}

function dependenciesForArray<T extends ReceiptValue | RestoredFrameworkMigrationStepReceipt>(
  receipt: ReceiptValue,
  values: readonly T[],
): readonly T[] {
  const byStepId = new Map(values.map(value => [
    "receipt" in value ? value.receipt.frame.stepId : value.frame.stepId,
    value,
  ]));
  return receipt.frame.dependencyReceipts.map(reference => {
    const value = byStepId.get(reference.stepId);
    if (value === undefined) {
      throw new Error("Fixture dependency receipt is missing");
    }
    return value;
  });
}

function replaceFirstDependencyWithDuplicate(
  dependencies: readonly RestoredFrameworkMigrationStepReceipt[],
): readonly RestoredFrameworkMigrationStepReceipt[] {
  const duplicate = dependencies[1];
  if (duplicate === undefined) {
    throw new Error("Fixture receipt must have two dependencies");
  }
  return Object.freeze([duplicate, ...dependencies.slice(1)]);
}

async function storedReceiptFixture(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const values = await freshPlanRepositoryValues();
  return persistence.drizzle.transaction(async transaction => {
    const attempt = await ensureStoredAttempt(
      transaction,
      values,
      "attempt-a",
      "1",
      null,
    );
    const receiptValues = await completeFrameworkMigrationPlanSteps(
      attempt.plan.plan,
      attempt.attempt,
      FIRST_COMPLETED_AT,
    );
    const receipts = await ensureStoredReceiptGraph(
      transaction,
      attempt,
      receiptValues,
    );
    return { attempt, receiptValues, receipts };
  });
}

async function receiptAggregateCounts(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<Readonly<{ receipts: string; dependencies: string }>> {
  const [receipts, dependencies] = await Promise.all([
    persistence.query<{ count: string }>(`
      select count(*)::text as count
        from fx_system_framework_migration_step_receipt
    `),
    persistence.query<{ count: string }>(`
      select count(*)::text as count
        from fx_system_framework_migration_step_receipt_dependency
    `),
  ]);
  const receiptRow = receipts.rows[0];
  const dependencyRow = dependencies.rows[0];
  if (receiptRow === undefined || dependencyRow === undefined) {
    throw new Error("Missing receipt aggregate count row");
  }
  return Object.freeze({
    receipts: receiptRow.count,
    dependencies: dependencyRow.count,
  });
}

async function storedReceiptRoots(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkMigrationStepReceipts,
  ).orderBy(asc(fxSystemFrameworkMigrationStepReceipts.receiptStorageId));
  return rows.map(row => ({
    receiptStorageId: row.receiptStorageId,
    collisionStorageId: row.collisionStorageId,
    planStorageId: row.planStorageId,
    attemptStorageId: row.attemptStorageId,
    attemptId: row.attemptId,
    attemptFence: row.attemptFence,
    stepId: row.stepId,
    stepSha256: Encoding.encodeHex(row.stepSha256),
    preconditionSha256: Encoding.encodeHex(row.preconditionSha256),
    postconditionSha256: Encoding.encodeHex(row.postconditionSha256),
    observedPostconditionSha256:
      Encoding.encodeHex(row.observedPostconditionSha256),
    dependencyCount: row.dependencyCount,
    stepReceiptSha256: Encoding.encodeHex(row.stepReceiptSha256),
    frameFormat: row.frameFormat,
    frameVersion: row.frameVersion,
    canonicalByteLength: row.canonicalByteLength,
    canonicalBytes: row.canonicalBytes,
  }));
}

function expectedReceiptRoots(
  attempt: RestoredFrameworkMigrationAttemptStart,
  receipts: readonly RestoredFrameworkMigrationStepReceipt[],
) {
  return receipts.map(restored => ({
    receiptStorageId: restored.storageId,
    collisionStorageId: attempt.collision.storageId,
    planStorageId: attempt.plan.storageId,
    attemptStorageId: attempt.storageId,
    attemptId: restored.receipt.frame.attemptId,
    attemptFence: BigInt(restored.receipt.frame.attemptFence),
    stepId: restored.receipt.frame.stepId,
    stepSha256: restored.receipt.frame.stepSha256,
    preconditionSha256: restored.receipt.frame.preconditionSha256,
    postconditionSha256: restored.receipt.frame.postconditionSha256,
    observedPostconditionSha256:
      restored.receipt.frame.observedPostconditionSha256,
    dependencyCount: restored.receipt.frame.dependencyReceipts.length,
    stepReceiptSha256: restored.receipt.sha256,
    frameFormat: restored.receipt.frame.format,
    frameVersion: restored.receipt.frame.version,
    canonicalByteLength: canonicalBytes(restored.receipt).byteLength,
    canonicalBytes: canonicalBytes(restored.receipt),
  }));
}

async function storedReceiptDependencies(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkMigrationStepReceiptDependencies,
  ).orderBy(
    asc(fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId),
    asc(fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal),
  );
  return rows.map(row => ({
    receiptStorageId: row.receiptStorageId,
    attemptStorageId: row.attemptStorageId,
    dependencyOrdinal: row.dependencyOrdinal,
    dependencyReceiptStorageId: row.dependencyReceiptStorageId,
    dependencyStepId: row.dependencyStepId,
    dependencyStepReceiptSha256:
      Encoding.encodeHex(row.dependencyStepReceiptSha256),
  }));
}

function expectedReceiptDependencies(
  receipts: readonly RestoredFrameworkMigrationStepReceipt[],
) {
  const byStepId = new Map(receipts.map(receipt => [
    receipt.receipt.frame.stepId,
    receipt,
  ]));
  return receipts.flatMap(receipt =>
    receipt.receipt.frame.dependencyReceipts.map((reference, ordinal) => {
      const dependency = byStepId.get(reference.stepId);
      if (dependency === undefined) {
        throw new Error("Fixture stored dependency receipt is missing");
      }
      return {
        receiptStorageId: receipt.storageId,
        attemptStorageId: receipt.attempt.storageId,
        dependencyOrdinal: ordinal,
        dependencyReceiptStorageId: dependency.storageId,
        dependencyStepId: reference.stepId,
        dependencyStepReceiptSha256: reference.stepReceiptSha256,
      };
    })
  );
}

async function setDependencyOrdinal(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  receiptStorageId: bigint,
  currentOrdinal: number,
  dependencyOrdinal: number,
): Promise<void> {
  await persistence.drizzle.update(
    fxSystemFrameworkMigrationStepReceiptDependencies,
  ).set({ dependencyOrdinal }).where(and(
    eq(
      fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId,
      receiptStorageId,
    ),
    eq(
      fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal,
      currentOrdinal,
    ),
  ));
}

async function expectReferenceRefusal(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  operation: "ensureStepReceipt" | "readStepReceipt",
  effect: (
    transaction: FlarexMetadataTransaction,
  ) => Effect.Effect<unknown, FrameworkMigrationRepositoryError>,
): Promise<void> {
  const failure = await persistence.drizzle.transaction(
    transaction => runEffectFailure(effect(transaction)),
  );
  expect(failure).toMatchObject({
    _tag: "FrameworkMigrationRepositoryError",
    operation,
    reason: "referenceRefusal",
  });
}

function canonicalBytes(
  value: ReceiptValue,
): Uint8Array {
  return new TextEncoder().encode(value.canonicalJson);
}

function requiredFirst<T>(values: readonly T[]): T {
  const value = values[0];
  if (value === undefined) throw new Error("Fixture value is missing");
  return value;
}

function requiredLast<T>(values: readonly T[]): T {
  const value = values.at(-1);
  if (value === undefined) throw new Error("Fixture value is missing");
  return value;
}

function rejectingReceiptRootSelectTransaction(
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
            throw new TypeError("Receipt read builder must remain an object");
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
        if (!isReceiptRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Receipt select must return a query object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isReceiptRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "receiptStorageId") &&
    Object.hasOwn(input, "dependencyCount") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}

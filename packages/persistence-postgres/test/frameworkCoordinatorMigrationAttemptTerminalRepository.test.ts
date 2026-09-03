import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Encoding, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import * as persistenceRoot from "../src";

import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import {
  MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES,
  captureFrameworkMigrationAttemptStart,
  captureFrameworkMigrationAttemptTerminal,
  captureFrameworkMigrationPlanAdmission,
  captureFrameworkMigrationStepReceipt,
  captureFreshRelationalMigrationPlan,
} from "../src/migrationCoordination/canonical";
import {
  ensureFrameworkMigrationAttemptStartInTransactionEffect,
} from "../src/migrationCoordination/migrationAttemptRepository";
import {
  corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect,
  ensureFrameworkMigrationAttemptTerminalInTransactionEffect,
  readFrameworkMigrationAttemptTerminalInTransactionEffect,
  resolveAuthenticatedFrameworkMigrationAttemptTerminalOccupantsEffect,
} from "../src/migrationCoordination/migrationAttemptTerminalRepository";
import {
  ensureFrameworkMigrationPlanAdmissionInTransactionEffect,
} from "../src/migrationCoordination/migrationPlanAdmissionRepository";
import {
  ensureFreshRelationalMigrationPlanInTransactionEffect,
} from "../src/migrationCoordination/migrationPlanRepository";
import {
  ensureRelationalPhysicalNameAssignmentInTransactionEffect,
} from "../src/migrationCoordination/physicalNameAssignmentRepository";
import type { FrameworkMigrationRepositoryError } from
  "../src/migrationCoordination/repositoryErrors";
import {
  fxSystemFrameworkMigrationAttemptTerminals,
  fxSystemFrameworkMigrationStepReceiptDependencies,
} from "../src/migrationCoordination/schema";
import {
  ensureFrameworkMigrationStepReceiptInTransactionEffect,
} from "../src/migrationCoordination/migrationStepReceiptRepository";
import {
  ensureFrameworkMigrationCollisionDomainInTransactionEffect,
  ensureFrameworkSchemaTargetNamespaceInTransactionEffect,
} from "../src/migrationCoordination/targetCollisionRepository";
import type {
  FrameworkMigrationAttemptOutcome,
} from "../src/migrationCoordination/model";
import {
  restoreStoredFrameworkMigrationStepReceipt,
  restoreStoredFrameworkMigrationAttemptTerminal,
  type RestoredFrameworkMigrationAttemptStart,
  type RestoredFrameworkMigrationAttemptTerminal,
  type RestoredFrameworkMigrationCollisionDomain,
  type RestoredFrameworkMigrationPlanAdmission,
  type RestoredFrameworkMigrationStepReceipt,
  type RestoredFreshRelationalMigrationPlan,
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

const PGLITE_TEST_TIMEOUT = 60_000;
const STARTED_AT = "2026-08-27T08:30:00.000Z";
const FIRST_COMPLETED_AT = "2026-08-27T08:31:00.000Z";
const SECOND_COMPLETED_AT = "2026-08-27T08:32:00.000Z";
const FIRST_TERMINAL_AT = "2026-08-27T08:33:00.000Z";
const SECOND_TERMINAL_AT = "2026-08-27T08:34:00.000Z";
const FAILED_EVIDENCE_SHA256 = "11".repeat(32);
const UNCERTAIN_EVIDENCE_SHA256 = "22".repeat(32);

type ReceiptValue = Awaited<
  ReturnType<typeof completeFrameworkMigrationPlanSteps>
>[number];

describe("framework coordinator migration-attempt terminal repository", () => {
  it("keeps transaction kernels and receipt-prefix restoration source-private", async () => {
    expect(
      "ensureFrameworkMigrationAttemptTerminalInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "readFrameworkMigrationAttemptTerminalInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "resolveAuthenticatedFrameworkMigrationAttemptTerminalOccupantsEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);
    expect(
      "restoreFrameworkMigrationStepReceiptPrefixForAttemptTerminalInTransactionEffect" in
        persistenceRoot,
    ).toBe(false);

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    const exportedSources = Object.values(packageJson.default.exports);
    expect(exportedSources).not.toContain(
      "./src/migrationCoordination/migrationAttemptTerminalRepository.ts",
    );
    expect(exportedSources).not.toContain(
      "./src/migrationCoordination/migrationStepReceiptRepository.ts",
    );
  });

  it("ensures, reads, and exactly replays a successful full-plan terminal", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const attempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-success",
          "1",
          null,
        );
        const receiptValues = await completeFrameworkMigrationPlanSteps(
          attempt.plan.plan,
          attempt.attempt,
          FIRST_COMPLETED_AT,
        );
        const receipts = await ensureStoredReceiptPrefix(
          transaction,
          attempt,
          receiptValues,
        );
        const terminal = await captureTerminal(
          attempt,
          receiptValues,
          succeededOutcome(attempt),
          FIRST_TERMINAL_AT,
        );
        const missing = await runEffect(
          readFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            attempt,
            receipts,
            terminal,
          ),
        );
        expect(Option.isNone(missing)).toBe(true);

        const ensured = await runEffect(
          ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            attempt,
            receipts,
            terminal,
          ),
        );
        const replayed = await runEffect(
          ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            attempt,
            receipts,
            terminal,
          ),
        );
        const read = Option.getOrThrow(await runEffect(
          readFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            attempt,
            receipts,
            terminal,
          ),
        ));
        expect(replayed.storageId).toBe(ensured.storageId);
        expect(read).toEqual(ensured);
        return { attempt, receiptValues, receipts, terminal, ensured };
      },
    );

    const separateReplay = await persistence.drizzle.transaction(
      transaction => runEffect(
        ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
          transaction,
          stored.attempt,
          stored.receipts,
          stored.terminal,
        ),
      ),
    );
    expect(separateReplay.storageId).toBe(stored.ensured.storageId);
    expect(separateReplay.terminal).toEqual(stored.terminal);
    expect(separateReplay.terminal).not.toBe(stored.terminal);
    await expect(terminalCount(persistence)).resolves.toBe("1");
    await expect(storedTerminalRows(persistence)).resolves.toEqual([
      expectedTerminalRow(stored.ensured, stored.receipts),
    ]);
  }, PGLITE_TEST_TIMEOUT);

  it("corroborates the complete receipt prefix for downstream aggregates", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedTerminalFixture(persistence);
    const firstReceipt = requiredFirst(stored.receipts);
    const firstStep = requiredFirst(stored.attempt.plan.plan.frame.steps);
    expect(firstStep.dependencies).toHaveLength(0);
    const alternateValue = await runEffect(
      captureFrameworkMigrationStepReceipt({
        attempt: stored.attempt.attempt,
        step: firstStep,
        dependencyReceipts: [],
        observedPostconditionSha256: firstStep.postconditionSha256,
        completedAt: SECOND_COMPLETED_AT,
      }),
    );
    expect(alternateValue.sha256).not.toBe(firstReceipt.receipt.sha256);
    const alternateBytes = canonicalBytes(alternateValue);
    const alternateReceipt = await runEffect(
      restoreStoredFrameworkMigrationStepReceipt({
        row: {
          receiptStorageId: firstReceipt.storageId,
          collisionStorageId: stored.attempt.collision.storageId,
          planStorageId: stored.attempt.plan.storageId,
          attemptStorageId: stored.attempt.storageId,
          attemptId: alternateValue.frame.attemptId,
          attemptFence: BigInt(alternateValue.frame.attemptFence),
          stepId: alternateValue.frame.stepId,
          stepSha256: decodeSha256(alternateValue.frame.stepSha256),
          preconditionSha256:
            decodeSha256(alternateValue.frame.preconditionSha256),
          postconditionSha256:
            decodeSha256(alternateValue.frame.postconditionSha256),
          observedPostconditionSha256:
            decodeSha256(alternateValue.frame.observedPostconditionSha256),
          dependencyCount: 0,
          stepReceiptSha256: decodeSha256(alternateValue.sha256),
          frameFormat: alternateValue.frame.format,
          frameVersion: alternateValue.frame.version,
          canonicalByteLength: alternateBytes.byteLength,
          observedCanonicalByteLength: alternateBytes.byteLength,
          canonicalBytes: alternateBytes,
        },
        dependencyRows: [],
        collision: stored.attempt.collision,
        plan: stored.attempt.plan,
        attempt: stored.attempt,
        dependencyReceipts: [],
      }),
    );
    const mismatchedPrefix = Object.freeze([
      alternateReceipt,
      ...stored.receipts.slice(1),
    ]);
    const mismatchedTerminal = await restoreTerminalForResolver(
      stored.attempt,
      mismatchedPrefix,
      stored.terminalValue,
      stored.terminal.storageId,
    );

    const corroborated = await persistence.drizzle.transaction(
      transaction => runEffect(
        corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect(
          transaction,
          stored.terminal,
          "readAttemptTerminal",
        ),
      ),
    );
    expect(corroborated).toEqual(stored.terminal);

    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        corroborateRestoredFrameworkMigrationAttemptTerminalInTransactionEffect(
          transaction,
          mismatchedTerminal,
          "readAttemptTerminal",
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "readAttemptTerminal",
      reason: "referenceRefusal",
    });
  }, PGLITE_TEST_TIMEOUT);

  it("stores failed and uncertain empty or partial prefixes with exact nullable projections", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const stored = await persistence.drizzle.transaction(
      async transaction => {
        const emptyAttempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-failed-empty",
          "1",
          null,
        );
        const emptyTerminalValue = await captureTerminal(
          emptyAttempt,
          [],
          failedOutcome("operationFailed", FAILED_EVIDENCE_SHA256),
          FIRST_TERMINAL_AT,
        );
        const emptyTerminal = await runEffect(
          ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            emptyAttempt,
            [],
            emptyTerminalValue,
          ),
        );

        const failedAttempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-failed-prefix",
          "2",
          emptyAttempt,
        );
        const failedValues = await completeFrameworkMigrationPlanSteps(
          failedAttempt.plan.plan,
          failedAttempt.attempt,
          FIRST_COMPLETED_AT,
        );
        const failedPrefixValues = requiredPrefix(failedValues, 2);
        const failedPrefix = await ensureStoredReceiptPrefix(
          transaction,
          failedAttempt,
          failedPrefixValues,
        );
        const failedTerminalValue = await captureTerminal(
          failedAttempt,
          failedPrefixValues,
          failedOutcome("validationFailed", FAILED_EVIDENCE_SHA256),
          FIRST_TERMINAL_AT,
        );
        const failedTerminal = await runEffect(
          ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            failedAttempt,
            failedPrefix,
            failedTerminalValue,
          ),
        );

        const uncertainAttempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-uncertain-prefix",
          "3",
          failedAttempt,
        );
        const uncertainValues = await completeFrameworkMigrationPlanSteps(
          uncertainAttempt.plan.plan,
          uncertainAttempt.attempt,
          SECOND_COMPLETED_AT,
        );
        const uncertainPrefixValues = requiredPrefix(uncertainValues, 1);
        const uncertainPrefix = await ensureStoredReceiptPrefix(
          transaction,
          uncertainAttempt,
          uncertainPrefixValues,
        );
        const uncertainTerminalValue = await captureTerminal(
          uncertainAttempt,
          uncertainPrefixValues,
          uncertainOutcome(UNCERTAIN_EVIDENCE_SHA256),
          SECOND_TERMINAL_AT,
        );
        const uncertainTerminal = await runEffect(
          ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
            transaction,
            uncertainAttempt,
            uncertainPrefix,
            uncertainTerminalValue,
          ),
        );
        return {
          emptyTerminal,
          failedTerminal,
          failedPrefix,
          uncertainTerminal,
          uncertainPrefix,
        };
      },
    );

    await expect(storedTerminalRows(persistence)).resolves.toEqual([
      expectedTerminalRow(stored.emptyTerminal, []),
      expectedTerminalRow(stored.failedTerminal, stored.failedPrefix),
      expectedTerminalRow(stored.uncertainTerminal, stored.uncertainPrefix),
    ]);
    const rows = await persistence.drizzle.select({
      outcomeKind: fxSystemFrameworkMigrationAttemptTerminals.outcomeKind,
      requiredStepSetSha256:
        fxSystemFrameworkMigrationAttemptTerminals.requiredStepSetSha256,
      failureReason: fxSystemFrameworkMigrationAttemptTerminals.failureReason,
      evidenceSha256: fxSystemFrameworkMigrationAttemptTerminals.evidenceSha256,
      lastReceiptStorageId:
        fxSystemFrameworkMigrationAttemptTerminals.lastReceiptStorageId,
      lastStepReceiptSha256:
        fxSystemFrameworkMigrationAttemptTerminals.lastStepReceiptSha256,
    }).from(fxSystemFrameworkMigrationAttemptTerminals).orderBy(
      asc(fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId),
    );
    expect(rows.map(row => ({
      outcomeKind: row.outcomeKind,
      requiredStepSetSha256: nullableSha256(row.requiredStepSetSha256),
      failureReason: row.failureReason,
      evidenceSha256: nullableSha256(row.evidenceSha256),
      lastReceiptStorageId: row.lastReceiptStorageId,
      lastStepReceiptSha256: nullableSha256(row.lastStepReceiptSha256),
    }))).toEqual([
      {
        outcomeKind: "failed",
        requiredStepSetSha256: null,
        failureReason: "operationFailed",
        evidenceSha256: FAILED_EVIDENCE_SHA256,
        lastReceiptStorageId: null,
        lastStepReceiptSha256: null,
      },
      {
        outcomeKind: "failed",
        requiredStepSetSha256: null,
        failureReason: "validationFailed",
        evidenceSha256: FAILED_EVIDENCE_SHA256,
        lastReceiptStorageId: requiredLast(stored.failedPrefix).storageId,
        lastStepReceiptSha256:
          requiredLast(stored.failedPrefix).receipt.sha256,
      },
      {
        outcomeKind: "decisionUncertain",
        requiredStepSetSha256: null,
        failureReason: null,
        evidenceSha256: UNCERTAIN_EVIDENCE_SHA256,
        lastReceiptStorageId: requiredLast(stored.uncertainPrefix).storageId,
        lastStepReceiptSha256:
          requiredLast(stored.uncertainPrefix).receipt.sha256,
      },
    ]);
  }, PGLITE_TEST_TIMEOUT);

  it("resolves semantic occupants before lazily consulting the digest index", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedTerminalFixture(persistence);
    const exactOccupant = Object.freeze({
      value: stored.terminal,
      stepReceipts: stored.receipts,
    });
    const conflictingValue = await captureTerminal(
      stored.attempt,
      stored.receiptValues,
      succeededOutcome(stored.attempt),
      SECOND_TERMINAL_AT,
    );
    const conflictingRestored = await restoreTerminalForResolver(
      stored.attempt,
      stored.receipts,
      conflictingValue,
      9_999n,
    );
    const conflictingOccupant = Object.freeze({
      value: conflictingRestored,
      stepReceipts: stored.receipts,
    });

    let exactDigestReads = 0;
    const exact = await runEffect(
      resolveAuthenticatedFrameworkMigrationAttemptTerminalOccupantsEffect(
        stored.attempt,
        stored.receipts,
        stored.terminalValue,
        "readAttemptTerminal",
        {
          readByAttempt: () => Effect.succeed(Option.some(exactOccupant)),
          readByDigest: () => {
            exactDigestReads += 1;
            return Effect.succeed(Option.none());
          },
        },
      ),
    );
    expect(Option.getOrThrow(exact)).toEqual(stored.terminal);
    expect(exactDigestReads).toBe(0);

    let conflictDigestReads = 0;
    const semanticFailure = await runEffectFailure(
      resolveAuthenticatedFrameworkMigrationAttemptTerminalOccupantsEffect(
        stored.attempt,
        stored.receipts,
        stored.terminalValue,
        "readAttemptTerminal",
        {
          readByAttempt: () =>
            Effect.succeed(Option.some(conflictingOccupant)),
          readByDigest: () => {
            conflictDigestReads += 1;
            return Effect.succeed(Option.some(exactOccupant));
          },
        },
      ),
    );
    expect(semanticFailure).toMatchObject({
      operation: "readAttemptTerminal",
      reason: "immutableConflict",
    });
    expect(conflictDigestReads).toBe(0);

    let absentDigestReads = 0;
    const digestFailure = await runEffectFailure(
      resolveAuthenticatedFrameworkMigrationAttemptTerminalOccupantsEffect(
        stored.attempt,
        stored.receipts,
        stored.terminalValue,
        "readAttemptTerminal",
        {
          readByAttempt: () => Effect.succeed(Option.none()),
          readByDigest: () => {
            absentDigestReads += 1;
            return Effect.succeed(Option.some(conflictingOccupant));
          },
        },
      ),
    );
    expect(digestFailure).toMatchObject({
      operation: "readAttemptTerminal",
      reason: "immutableConflict",
    });
    expect(absentDigestReads).toBe(1);
  }, PGLITE_TEST_TIMEOUT);

  it("refuses forged, missing, shortened, reordered, and cross-attempt prerequisites", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedTerminalFixture(persistence);
    const second = await persistence.drizzle.transaction(
      async transaction => {
        const attemptValue = await captureAttempt(
          stored.attempt.admission,
          "attempt-other",
          "2",
          stored.attempt,
        );
        const attempt = await runEffect(
          ensureFrameworkMigrationAttemptStartInTransactionEffect(
            transaction,
            stored.attempt.admission,
            stored.attempt,
            attemptValue,
          ),
        );
        const receiptValues = await completeFrameworkMigrationPlanSteps(
          attempt.plan.plan,
          attempt.attempt,
          SECOND_COMPLETED_AT,
        );
        const receipts = await ensureStoredReceiptPrefix(
          transaction,
          attempt,
          receiptValues,
        );
        const terminal = await captureTerminal(
          attempt,
          receiptValues,
          succeededOutcome(attempt),
          SECOND_TERMINAL_AT,
        );
        return { attempt, receiptValues, receipts, terminal };
      },
    );

    await expectReferenceRefusal(
      persistence,
      "ensureAttemptTerminal",
      transaction => ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        Object.freeze({ ...stored.attempt }),
        stored.receipts,
        stored.terminalValue,
      ),
    );
    await expectReferenceRefusal(
      persistence,
      "ensureAttemptTerminal",
      transaction => ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        stored.attempt,
        stored.receipts,
        Object.freeze({ ...stored.terminalValue }),
      ),
    );
    const firstReceipt = requiredFirst(stored.receipts);
    await expectReferenceRefusal(
      persistence,
      "ensureAttemptTerminal",
      transaction => ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        stored.attempt,
        Object.freeze([
          Object.freeze({ ...firstReceipt }),
          ...stored.receipts.slice(1),
        ]),
        stored.terminalValue,
      ),
    );
    await expectReferenceRefusal(
      persistence,
      "readAttemptTerminal",
      transaction => readFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        stored.attempt,
        stored.receipts.slice(0, -1),
        stored.terminalValue,
      ),
    );
    await expectReferenceRefusal(
      persistence,
      "readAttemptTerminal",
      transaction => readFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        stored.attempt,
        swapFirstTwo(stored.receipts),
        stored.terminalValue,
      ),
    );
    await expectReferenceRefusal(
      persistence,
      "ensureAttemptTerminal",
      transaction => ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        second.attempt,
        stored.receipts,
        second.terminal,
      ),
    );
    await expectReferenceRefusal(
      persistence,
      "readAttemptTerminal",
      transaction => readFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        second.attempt,
        second.receipts,
        stored.terminalValue,
      ),
    );

    const missingPersistence = await createMigratedPGlitePersistence();
    await expectReferenceRefusal(
      missingPersistence,
      "readAttemptTerminal",
      transaction => readFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        stored.attempt,
        stored.receipts,
        stored.terminalValue,
      ),
    );
    await expect(terminalCount(persistence)).resolves.toBe("1");
  }, 90_000);

  it("classifies a different authentic terminal on one attempt as immutable", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const stored = await storedTerminalFixture(persistence);
    const before = await storedTerminalRows(persistence);
    const conflicting = await captureTerminal(
      stored.attempt,
      stored.receiptValues,
      succeededOutcome(stored.attempt),
      SECOND_TERMINAL_AT,
    );
    const failure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
          transaction,
          stored.attempt,
          stored.receipts,
          conflicting,
        ),
      ),
    );
    expect(failure).toMatchObject({
      operation: "ensureAttemptTerminal",
      reason: "immutableConflict",
    });
    await expect(storedTerminalRows(persistence)).resolves.toEqual(before);
  }, PGLITE_TEST_TIMEOUT);

  it("reports projection, tail-prefix, and receipt-sidecar corruption without healing", async () => {
    const projectionPersistence = await createMigratedPGlitePersistence();
    const projection = await storedTerminalFixture(projectionPersistence);
    const wrongRequiredStepSet = new Uint8Array(32).fill(0x7a);
    await projectionPersistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptTerminals,
    ).set({ requiredStepSetSha256: wrongRequiredStepSet }).where(eq(
      fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
      projection.terminal.storageId,
    ));
    await expectStoredCorruption(
      projectionPersistence,
      "readAttemptTerminal",
      transaction => readFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        projection.attempt,
        projection.receipts,
        projection.terminalValue,
      ),
    );
    expect(nullableSha256((await projectionPersistence.drizzle.select({
      value: fxSystemFrameworkMigrationAttemptTerminals.requiredStepSetSha256,
    }).from(fxSystemFrameworkMigrationAttemptTerminals))[0]?.value ?? null))
      .toBe(Encoding.encodeHex(wrongRequiredStepSet));

    const tailPersistence = await createMigratedPGlitePersistence();
    const tail = await storedTerminalFixture(tailPersistence);
    const earlierReceipt = tail.receipts.at(-2);
    if (earlierReceipt === undefined) {
      throw new Error("Fixture requires at least two receipts");
    }
    await tailPersistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptTerminals,
    ).set({
      lastReceiptStorageId: earlierReceipt.storageId,
      lastStepReceiptSha256: decodeSha256(earlierReceipt.receipt.sha256),
    }).where(eq(
      fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
      tail.terminal.storageId,
    ));
    const tailRowsBefore = await storedTerminalRows(tailPersistence);
    await expectStoredCorruption(
      tailPersistence,
      "ensureAttemptTerminal",
      transaction => ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        tail.attempt,
        tail.receipts,
        tail.terminalValue,
      ),
    );
    await expect(storedTerminalRows(tailPersistence)).resolves.toEqual(
      tailRowsBefore,
    );

    const sidecarPersistence = await createMigratedPGlitePersistence();
    const sidecar = await storedTerminalFixture(sidecarPersistence);
    const finalReceipt = requiredLast(sidecar.receipts);
    await setDependencyOrdinal(
      sidecarPersistence,
      finalReceipt.storageId,
      0,
      99,
    );
    await setDependencyOrdinal(
      sidecarPersistence,
      finalReceipt.storageId,
      1,
      0,
    );
    await setDependencyOrdinal(
      sidecarPersistence,
      finalReceipt.storageId,
      99,
      1,
    );
    const sidecarsBefore = await receiptDependencyRows(sidecarPersistence);
    await expectStoredCorruption(
      sidecarPersistence,
      "readAttemptTerminal",
      transaction => readFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        sidecar.attempt,
        sidecar.receipts,
        sidecar.terminalValue,
      ),
    );
    await expect(receiptDependencyRows(sidecarPersistence)).resolves.toEqual(
      sidecarsBefore,
    );
  }, 120_000);

  it("rejects changed and over-limit terminal canonical bytes without healing", async () => {
    const corruptPersistence = await createMigratedPGlitePersistence();
    const corrupt = await storedTerminalFixture(corruptPersistence);
    const changedBytes = canonicalBytes(corrupt.terminalValue);
    changedBytes[changedBytes.byteLength - 2] = 0x20;
    await corruptPersistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptTerminals,
    ).set({ canonicalBytes: changedBytes }).where(eq(
      fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
      corrupt.terminal.storageId,
    ));
    await expectStoredCorruption(
      corruptPersistence,
      "readAttemptTerminal",
      transaction => readFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        corrupt.attempt,
        corrupt.receipts,
        corrupt.terminalValue,
      ),
    );
    await expect(terminalCount(corruptPersistence)).resolves.toBe("1");

    const oversizedPersistence = await createMigratedPGlitePersistence();
    const oversized = await storedTerminalFixture(oversizedPersistence);
    await oversizedPersistence.query(`
      alter table fx_system_framework_migration_attempt_terminal
        drop constraint fx_framework_migration_terminal_frame_check
    `);
    const oversizedBytes = new Uint8Array(
      MAX_FRAMEWORK_MIGRATION_LEDGER_CANONICAL_BYTES + 1,
    ).fill(0x20);
    await oversizedPersistence.drizzle.update(
      fxSystemFrameworkMigrationAttemptTerminals,
    ).set({
      canonicalByteLength: oversizedBytes.byteLength,
      canonicalBytes: oversizedBytes,
    }).where(eq(
      fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
      oversized.terminal.storageId,
    ));
    const oversizedRowsBefore = await storedTerminalRows(oversizedPersistence);
    await expectStoredCorruption(
      oversizedPersistence,
      "ensureAttemptTerminal",
      transaction => ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        oversized.attempt,
        oversized.receipts,
        oversized.terminalValue,
      ),
    );
    await expect(storedTerminalRows(oversizedPersistence)).resolves.toEqual(
      oversizedRowsBefore,
    );
  }, 90_000);

  it("follows caller rollback and preserves the exact foreign driver cause", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await freshPlanRepositoryValues();
    const prepared = await persistence.drizzle.transaction(
      async transaction => {
        const attempt = await ensureStoredAttempt(
          transaction,
          values,
          "attempt-rollback",
          "1",
          null,
        );
        const receiptValues = await completeFrameworkMigrationPlanSteps(
          attempt.plan.plan,
          attempt.attempt,
          FIRST_COMPLETED_AT,
        );
        const receipts = await ensureStoredReceiptPrefix(
          transaction,
          attempt,
          receiptValues,
        );
        const terminal = await captureTerminal(
          attempt,
          receiptValues,
          succeededOutcome(attempt),
          FIRST_TERMINAL_AT,
        );
        return { attempt, receiptValues, receipts, terminal };
      },
    );
    const deliberateRollback = new Error("deliberate terminal rollback");
    await expect(persistence.drizzle.transaction(async transaction => {
      await runEffect(
        ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
          transaction,
          prepared.attempt,
          prepared.receipts,
          prepared.terminal,
        ),
      );
      throw deliberateRollback;
    })).rejects.toBe(deliberateRollback);
    await expect(terminalCount(persistence)).resolves.toBe("0");

    const driverCause = new Error("attempt terminal driver unavailable");
    const driverFailure = await persistence.drizzle.transaction(
      transaction => runEffectFailure(
        readFrameworkMigrationAttemptTerminalInTransactionEffect(
          rejectingTerminalRootSelectTransaction(transaction, driverCause),
          prepared.attempt,
          prepared.receipts,
          prepared.terminal,
        ),
      ),
    );
    expect(driverFailure).toMatchObject({
      _tag: "FrameworkMigrationRepositoryError",
      operation: "readAttemptTerminal",
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
    leaseExpiresAt: SECOND_TERMINAL_AT,
    previousAttemptId: previousAttempt?.attempt.frame.attemptId ?? null,
    startedAt: STARTED_AT,
  }));
}

async function ensureStoredReceiptPrefix(
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
        receipt.frame.dependencyReceipts.map(reference => {
          const dependency = restoredByStepId.get(reference.stepId);
          if (dependency === undefined) {
            throw new Error("Fixture restored dependency receipt is missing");
          }
          return dependency;
        }),
        receipt,
      ),
    );
    restoredByStepId.set(receipt.frame.stepId, value);
    restored.push(value);
  }
  return Object.freeze(restored);
}

async function captureTerminal(
  attempt: RestoredFrameworkMigrationAttemptStart,
  receiptValues: readonly ReceiptValue[],
  outcome: FrameworkMigrationAttemptOutcome,
  terminalAt: string,
) {
  return runEffect(captureFrameworkMigrationAttemptTerminal({
    attempt: attempt.attempt,
    outcome,
    stepReceipts: receiptValues,
    terminalAt,
  }));
}

function succeededOutcome(
  attempt: RestoredFrameworkMigrationAttemptStart,
): FrameworkMigrationAttemptOutcome {
  return Object.freeze({
    kind: "succeeded",
    requiredStepSetSha256: attempt.plan.plan.requiredStepSetSha256,
  });
}

function failedOutcome(
  reason: Extract<
    FrameworkMigrationAttemptOutcome,
    { readonly kind: "failed" }
  >["reason"],
  evidenceSha256: string,
): FrameworkMigrationAttemptOutcome {
  return Object.freeze({ kind: "failed", reason, evidenceSha256 });
}

function uncertainOutcome(
  evidenceSha256: string,
): FrameworkMigrationAttemptOutcome {
  return Object.freeze({ kind: "decisionUncertain", evidenceSha256 });
}

async function storedTerminalFixture(
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
    const receipts = await ensureStoredReceiptPrefix(
      transaction,
      attempt,
      receiptValues,
    );
    const terminalValue = await captureTerminal(
      attempt,
      receiptValues,
      succeededOutcome(attempt),
      FIRST_TERMINAL_AT,
    );
    const terminal = await runEffect(
      ensureFrameworkMigrationAttemptTerminalInTransactionEffect(
        transaction,
        attempt,
        receipts,
        terminalValue,
      ),
    );
    return { attempt, receiptValues, receipts, terminalValue, terminal };
  });
}

async function restoreTerminalForResolver(
  attempt: RestoredFrameworkMigrationAttemptStart,
  receipts: readonly RestoredFrameworkMigrationStepReceipt[],
  terminal: Awaited<ReturnType<typeof captureTerminal>>,
  terminalStorageId: bigint,
): Promise<RestoredFrameworkMigrationAttemptTerminal> {
  const lastReceipt = receipts.at(-1) ?? null;
  return runEffect(restoreStoredFrameworkMigrationAttemptTerminal({
    row: {
      terminalStorageId,
      collisionStorageId: attempt.collision.storageId,
      planStorageId: attempt.plan.storageId,
      attemptStorageId: attempt.storageId,
      admissionStorageId: attempt.admission.storageId,
      admissionSha256: decodeSha256(attempt.admission.admission.sha256),
      attemptId: terminal.frame.attemptId,
      attemptFence: BigInt(terminal.frame.attemptFence),
      outcomeKind: terminal.frame.outcome.kind,
      requiredStepSetSha256: terminal.frame.outcome.kind === "succeeded"
        ? decodeSha256(terminal.frame.outcome.requiredStepSetSha256)
        : null,
      failureReason: terminal.frame.outcome.kind === "failed"
        ? terminal.frame.outcome.reason
        : null,
      evidenceSha256: terminal.frame.outcome.kind === "succeeded"
        ? null
        : decodeSha256(terminal.frame.outcome.evidenceSha256),
      lastReceiptStorageId: lastReceipt?.storageId ?? null,
      lastStepReceiptSha256: lastReceipt === null
        ? null
        : decodeSha256(lastReceipt.receipt.sha256),
      attemptTerminalSha256: decodeSha256(terminal.sha256),
      frameFormat: terminal.frame.format,
      frameVersion: terminal.frame.version,
      canonicalByteLength: canonicalBytes(terminal).byteLength,
      observedCanonicalByteLength: canonicalBytes(terminal).byteLength,
      canonicalBytes: canonicalBytes(terminal),
    },
    collision: attempt.collision,
    plan: attempt.plan,
    admission: attempt.admission,
    attempt,
    stepReceipts: receipts,
  }));
}

async function terminalCount(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
): Promise<string> {
  const result = await persistence.query<{ count: string }>(`
    select count(*)::text as count
      from fx_system_framework_migration_attempt_terminal
  `);
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing terminal count row");
  return row.count;
}

async function storedTerminalRows(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  const rows = await persistence.drizzle.select().from(
    fxSystemFrameworkMigrationAttemptTerminals,
  ).orderBy(asc(
    fxSystemFrameworkMigrationAttemptTerminals.terminalStorageId,
  ));
  return rows.map(row => ({
    terminalStorageId: row.terminalStorageId,
    collisionStorageId: row.collisionStorageId,
    planStorageId: row.planStorageId,
    attemptStorageId: row.attemptStorageId,
    admissionStorageId: row.admissionStorageId,
    admissionSha256: Encoding.encodeHex(row.admissionSha256),
    attemptId: row.attemptId,
    attemptFence: row.attemptFence,
    outcomeKind: row.outcomeKind,
    requiredStepSetSha256: nullableSha256(row.requiredStepSetSha256),
    failureReason: row.failureReason,
    evidenceSha256: nullableSha256(row.evidenceSha256),
    lastReceiptStorageId: row.lastReceiptStorageId,
    lastStepReceiptSha256: nullableSha256(row.lastStepReceiptSha256),
    attemptTerminalSha256: Encoding.encodeHex(row.attemptTerminalSha256),
    frameFormat: row.frameFormat,
    frameVersion: row.frameVersion,
    canonicalByteLength: row.canonicalByteLength,
    canonicalBytes: row.canonicalBytes,
  }));
}

function expectedTerminalRow(
  terminal: RestoredFrameworkMigrationAttemptTerminal,
  receipts: readonly RestoredFrameworkMigrationStepReceipt[],
) {
  const { attempt } = terminal;
  const outcome = terminal.terminal.frame.outcome;
  const lastReceipt = receipts.at(-1) ?? null;
  return {
    terminalStorageId: terminal.storageId,
    collisionStorageId: attempt.collision.storageId,
    planStorageId: attempt.plan.storageId,
    attemptStorageId: attempt.storageId,
    admissionStorageId: attempt.admission.storageId,
    admissionSha256: attempt.admission.admission.sha256,
    attemptId: terminal.terminal.frame.attemptId,
    attemptFence: BigInt(terminal.terminal.frame.attemptFence),
    outcomeKind: outcome.kind,
    requiredStepSetSha256: outcome.kind === "succeeded"
      ? outcome.requiredStepSetSha256
      : null,
    failureReason: outcome.kind === "failed" ? outcome.reason : null,
    evidenceSha256: outcome.kind === "succeeded"
      ? null
      : outcome.evidenceSha256,
    lastReceiptStorageId: lastReceipt?.storageId ?? null,
    lastStepReceiptSha256: lastReceipt?.receipt.sha256 ?? null,
    attemptTerminalSha256: terminal.terminal.sha256,
    frameFormat: terminal.terminal.frame.format,
    frameVersion: terminal.terminal.frame.version,
    canonicalByteLength: canonicalBytes(terminal.terminal).byteLength,
    canonicalBytes: canonicalBytes(terminal.terminal),
  };
}

async function receiptDependencyRows(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
) {
  return persistence.drizzle.select().from(
    fxSystemFrameworkMigrationStepReceiptDependencies,
  ).orderBy(
    asc(fxSystemFrameworkMigrationStepReceiptDependencies.receiptStorageId),
    asc(fxSystemFrameworkMigrationStepReceiptDependencies.dependencyOrdinal),
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
  operation: "ensureAttemptTerminal" | "readAttemptTerminal",
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

async function expectStoredCorruption(
  persistence: Awaited<ReturnType<typeof createMigratedPGlitePersistence>>,
  operation: "ensureAttemptTerminal" | "readAttemptTerminal",
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
    reason: "storedCorruption",
  });
}

function requiredPrefix<T>(values: readonly T[], length: number): readonly T[] {
  const prefix = values.slice(0, length);
  if (prefix.length !== length) {
    throw new Error("Fixture does not contain the required prefix");
  }
  return Object.freeze(prefix);
}

function swapFirstTwo<T>(values: readonly T[]): readonly T[] {
  const first = values[0];
  const second = values[1];
  if (first === undefined || second === undefined) {
    throw new Error("Fixture requires two values");
  }
  return Object.freeze([second, first, ...values.slice(2)]);
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

function canonicalBytes(value: Readonly<{ canonicalJson: string }>): Uint8Array {
  return new TextEncoder().encode(value.canonicalJson);
}

function decodeSha256(value: string): Uint8Array {
  return Result.match(Encoding.decodeHex(value), {
    onFailure: () => {
      throw new Error("Fixture SHA-256 must be hexadecimal");
    },
    onSuccess: decoded => decoded,
  });
}

function nullableSha256(value: Uint8Array | null): string | null {
  return value === null ? null : Encoding.encodeHex(value);
}

function rejectingTerminalRootSelectTransaction(
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
            throw new TypeError("Terminal read builder must remain an object");
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
        if (!isTerminalRootSelection(args[0])) return query;
        if (!isNonArrayRecord(query)) {
          throw new TypeError("Terminal select must return a query object");
        }
        return rejectAtLimit(query);
      };
    },
  });
}

function isTerminalRootSelection(input: unknown): boolean {
  return isNonArrayRecord(input) &&
    Object.hasOwn(input, "terminalStorageId") &&
    Object.hasOwn(input, "outcomeKind") &&
    Object.hasOwn(input, "observedCanonicalByteLength");
}

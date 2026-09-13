import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as driverRows from "../src/detachDriverRows";
import * as storedValues from "../src/migrationCoordination/storedRestoration";
import { captureFrameworkMigrationAttemptStart, encodeFrameworkMigrationStepReceiptFrame } from "../src/migrationCoordination/canonical";
import { capturedAuthorityForStepReceipt } from "../src/migrationCoordination/authority";
import { ensureFrameworkMigrationAttemptStartInTransactionEffect } from "../src/migrationCoordination/migrationAttemptRepository";
import { readFrameworkMigrationDirectCompletionsInTransactionEffect, ensureFrameworkMigrationCommittedCompletionInTransactionEffect } from "../src/migrationCoordination/migrationStepReceiptRepository";
import { createSuccessfulTerminalPlanValues, storeSuccessfulTerminalGraphInTransaction,
  COORDINATOR_STARTED_AT, COORDINATOR_TERMINAL_AT } from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("protected command direct completion references", () => {
  it("encodes detached exact receipt bytes without granting restored or captured authority", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const expected = graph.receipts.at(-1)?.receipt;
    if (expected === undefined || expected.frame.dependencyReceipts.length === 0) throw new Error("Missing receipt fixture");
    const input = structuredClone(expected.frame);
    const encoded = await runEffect(encodeFrameworkMigrationStepReceiptFrame(input));
    expect(encoded.canonicalJson).toBe(expected.canonicalJson);
    expect(encoded.sha256).toBe(expected.sha256);
    expect(encoded.frame).not.toBe(input);
    expect(encoded.frame.collision).not.toBe(input.collision);
    expect(encoded.frame.dependencyReceipts[0]).not.toBe(input.dependencyReceipts[0]);
    expect(Object.isFrozen(encoded.frame.dependencyReceipts[0])).toBe(true);
    expect(capturedAuthorityForStepReceipt(encoded)).toBeUndefined();
    expect(encoded).not.toHaveProperty("storageId");
    expect(await runEffectFailure(encodeFrameworkMigrationStepReceiptFrame({ ...input, unexpected: true })))
      .toMatchObject({ reason: "invalidInput" });
  }, 90_000);

  it("rereads exact committed roots and sidecars on replay and refuses altered returned projections", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const receipt = graph.receipts.at(-1);
    const step = graph.plan.plan.frame.steps.at(-1);
    if (receipt === undefined || step === undefined || step.dependencies.length === 0) throw new Error("Missing dependent receipt");
    const dependencies = await persistence.drizzle.transaction(transaction => runEffect(
      readFrameworkMigrationDirectCompletionsInTransactionEffect(transaction, graph.attempt, step, step.ordinal,
        new Map([[graph.attempt.storageId, graph.attempt]])),
    ));
    const replay = () => persistence.drizzle.transaction(transaction => runEffect(
      ensureFrameworkMigrationCommittedCompletionInTransactionEffect(transaction, graph.attempt, step, dependencies, receipt.receipt),
    ));
    expect(await replay()).toMatchObject({ storageId: receipt.storageId, sha256: receipt.receipt.sha256 });
    for (const changed of ["root", "sidecar"] as const) {
      const detach = driverRows.detachDriverRows;
      const reads = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(rows => detach(rows).map(row => {
        if (changed === "root" && "canonicalBytes" in row && "receiptStorageId" in row) return { ...row, stepId: "altered-step" };
        if (changed === "sidecar" && "dependencyOrdinal" in row) return { ...row, dependencyOrdinal: -1 };
        return row;
      }));
      try { await expect(replay()).rejects.toMatchObject({ reason: "storedCorruption" }); }
      finally { reads.mockRestore(); }
    }
    expect(await replay()).toMatchObject({ storageId: receipt.storageId });
  }, 90_000);

  it.each([0, 14])("reads one normalized reference per direct edge with %i extra tables", async extraTables => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues(extraTables);
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const lineage = new Map([[graph.attempt.storageId, graph.attempt]]);
    const expectedByStep = new Map(graph.receipts.map(receipt => [receipt.receipt.frame.stepId, receipt]));
    let referenceRows = 0;
    let canonicalBytes = 0;
    const detach = driverRows.detachDriverRows;
    const reads = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(rows => {
      const output = detach(rows);
      for (const row of output) {
        if (Object.hasOwn(row, "receiptStorageId")) referenceRows++;
        if ("canonicalBytes" in row && row.canonicalBytes instanceof Uint8Array) canonicalBytes += row.canonicalBytes.byteLength;
      }
      return output;
    });
    const receipts = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationStepReceipt");
    const attempts = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationAttemptStart");
    try {
      await persistence.drizzle.transaction(transaction => runEffect(Effect.gen(function* () {
        for (const step of graph.attempt.plan.plan.frame.steps) {
          const direct = yield* readFrameworkMigrationDirectCompletionsInTransactionEffect(transaction, graph.attempt, step, step.ordinal, lineage);
          expect(direct).toHaveLength(step.dependencies.length);
          for (const reference of direct) {
            const expected = expectedByStep.get(reference.step.stepId);
            expect(reference.storageId).toBe(expected?.storageId);
            expect(reference.sha256).toBe(expected?.receipt.sha256);
            expect(reference.producer).toBe(graph.attempt);
          }
        }
      })));
      const edges = graph.plan.plan.frame.steps.reduce((sum, step) => sum + step.dependencies.length, 0);
      expect(referenceRows).toBe(edges);
      expect(canonicalBytes).toBe(0);
      expect(receipts).not.toHaveBeenCalled();
      expect(attempts).not.toHaveBeenCalled();
    } finally { reads.mockRestore(); receipts.mockRestore(); attempts.mockRestore(); }
  }, 90_000);

  it("retains the actual producer across takeover and refuses an unrelated greater fence", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const branches = await persistence.drizzle.transaction(async transaction => {
      const result = [];
      for (const [index, previous] of [graph.attempt, null].entries()) {
        const value = await runEffect(captureFrameworkMigrationAttemptStart({ admission: graph.admission.admission,
          attemptId: `direct-reference-${index}`, attemptFence: String(index + 2), leaseOwnerId: "worker-b",
          leaseExpiresAt: COORDINATOR_TERMINAL_AT, previousAttemptId: previous?.attempt.frame.attemptId ?? null,
          startedAt: COORDINATOR_STARTED_AT }));
        result.push(await runEffect(ensureFrameworkMigrationAttemptStartInTransactionEffect(transaction, graph.admission, previous, value)));
      }
      return result;
    });
    const successor = branches[0];
    const unrelated = branches[1];
    if (successor === undefined || unrelated === undefined) throw new Error("Missing attempt fixture");
    const step = successor.plan.plan.frame.steps.at(-1);
    const unrelatedStep = unrelated.plan.plan.frame.steps.at(-1);
    if (step === undefined || unrelatedStep === undefined || step.dependencies.length === 0) throw new Error("Missing dependent step");
    const completions = await persistence.drizzle.transaction(transaction => runEffect(
      readFrameworkMigrationDirectCompletionsInTransactionEffect(transaction, successor, step, step.ordinal,
        new Map([[successor.storageId, successor], [graph.attempt.storageId, graph.attempt]])),
    ));
    expect(completions).toHaveLength(step.dependencies.length);
    expect(completions.every(completion => completion.producer.storageId === graph.attempt.storageId)).toBe(true);
    expect(await persistence.drizzle.transaction(transaction => runEffectFailure(
      readFrameworkMigrationDirectCompletionsInTransactionEffect(transaction, unrelated, unrelatedStep, unrelatedStep.ordinal,
        new Map([[unrelated.storageId, unrelated], [graph.attempt.storageId, graph.attempt]])),
    ))).toMatchObject({ reason: "storedCorruption" });
  }, 90_000);
});

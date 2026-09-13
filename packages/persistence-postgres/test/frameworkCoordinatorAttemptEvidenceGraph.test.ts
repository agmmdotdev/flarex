import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as driverRows from "../src/detachDriverRows";
import * as storedValues from "../src/migrationCoordination/storedRestoration";
import { captureFrameworkMigrationAttemptStart, captureFrameworkMigrationAttemptTerminal, captureFrameworkMigrationPlanAdmission } from "../src/migrationCoordination/canonical";
import { ensureFrameworkMigrationPlanAdmissionInTransactionEffect } from "../src/migrationCoordination/migrationPlanAdmissionRepository";
import { ensureFreshRelationalMigrationPlanInTransactionEffect } from "../src/migrationCoordination/migrationPlanRepository";
import { capturedAuthorityForAttemptTerminal } from "../src/migrationCoordination/authority";
import { ensureFrameworkMigrationAttemptTerminalInTransactionEffect, restoreFrameworkMigrationEventTerminalSubjectsInTransactionEffect } from "../src/migrationCoordination/migrationAttemptTerminalRepository";
import * as receiptRepository from "../src/migrationCoordination/migrationStepReceiptRepository";
import { makeFrameworkGraphReferenceRead, withFrameworkGraphReadPass } from "../src/migrationCoordination/graphReadPass";
import { ensureFrameworkMigrationAttemptStartInTransactionEffect, restoreFrameworkMigrationEventAttemptSubjectsInTransactionEffect } from "../src/migrationCoordination/migrationAttemptRepository";
import { restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect } from "../src/migrationCoordination/migrationStepReceiptRepository";
import { createSuccessfulTerminalPlanValues, storeSuccessfulTerminalGraphInTransaction, COORDINATOR_STARTED_AT, COORDINATOR_TERMINAL_AT } from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe("attempt evidence graph", () => {
  it("retains an earlier empty terminal while later-fence receipts occupy the plan", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const earlier = await persistence.drizzle.transaction(async transaction => {
      const plan = await runEffect(ensureFreshRelationalMigrationPlanInTransactionEffect(transaction, graph.collision, values.planValue));
      const admissionValue = await runEffect(captureFrameworkMigrationPlanAdmission({ plan: plan.plan,
        nameAssignments: plan.plan.physicalLayout.nameAssignments, previousPlanSha256: null, admittedAt: COORDINATOR_TERMINAL_AT }));
      const admission = await runEffect(ensureFrameworkMigrationPlanAdmissionInTransactionEffect(transaction, plan, null, admissionValue));
      const value = await runEffect(captureFrameworkMigrationAttemptStart({ admission: admission.admission,
        attemptId: "earlier-empty", attemptFence: "0", leaseOwnerId: "worker-a", leaseExpiresAt: COORDINATOR_TERMINAL_AT,
        previousAttemptId: null, startedAt: COORDINATOR_STARTED_AT }));
      const attempt = await runEffect(ensureFrameworkMigrationAttemptStartInTransactionEffect(transaction, admission, null, value));
      const terminal = await runEffect(captureFrameworkMigrationAttemptTerminal({ attempt: attempt.attempt, stepReceipts: [],
        terminalAt: COORDINATOR_TERMINAL_AT, outcome: { kind: "failed", reason: "operationFailed", evidenceSha256: "a".repeat(64) } }));
      return runEffect(ensureFrameworkMigrationAttemptTerminalInTransactionEffect(transaction, attempt, [], terminal));
    });
    const restored = await persistence.drizzle.transaction(transaction => runEffect(Effect.gen(function* () {
      const attempts = yield* restoreFrameworkMigrationEventAttemptSubjectsInTransactionEffect(transaction, graph.collision,
        [earlier.attempt, graph.attempt].map(attempt => ({ kind: "attemptStarted", attemptStartSha256: attempt.attempt.sha256 })), "readEvent");
      return yield* restoreFrameworkMigrationEventTerminalSubjectsInTransactionEffect(transaction, graph.collision,
        [earlier.terminal.sha256, graph.terminal.terminal.sha256], attempts.byStorageId, "readEvent");
    })));
    const empty = restored.get(earlier.terminal.sha256);
    const complete = restored.get(graph.terminal.terminal.sha256);
    if (empty === undefined || complete === undefined) throw new Error("Missing terminal evidence");
    expect(storedValues.restoredFrameworkMigrationAttemptTerminalStepReceipts(empty)).toEqual([]);
    expect(storedValues.restoredFrameworkMigrationAttemptTerminalStepReceipts(complete)).toHaveLength(graph.receipts.length);
    const emptyAuthority = capturedAuthorityForAttemptTerminal(empty.terminal);
    const completeAuthority = capturedAuthorityForAttemptTerminal(complete.terminal);
    expect(emptyAuthority?.completedStepCount).toBe(0);
    expect(completeAuthority?.completedStepCount).toBe(graph.receipts.length);
    expect(emptyAuthority?.stepReceipts).toBe(completeAuthority?.stepReceipts);
  }, 90_000);

  it.each([4, 16])("reads and issues each of %i attempts once despite repeated leases and receipt subjects", async count => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const attempts = [graph.attempt];
    const terminals = [graph.terminal];
    await persistence.drizzle.transaction(async transaction => {
      let previous = graph.attempt;
      for (let index = 1; index < count; index++) {
        // The last attempt forks from the first. A greater fence alone never
        // establishes ancestry of receipts produced on the other branch.
        if (index === count - 1) previous = graph.attempt;
        const value = await runEffect(captureFrameworkMigrationAttemptStart({
          admission: graph.admission.admission, attemptId: `attempt-${index}`, attemptFence: String(index + 1),
          leaseOwnerId: "worker-a", leaseExpiresAt: COORDINATOR_TERMINAL_AT,
          previousAttemptId: previous.attempt.frame.attemptId, startedAt: COORDINATOR_STARTED_AT,
        }));
        previous = await runEffect(ensureFrameworkMigrationAttemptStartInTransactionEffect(transaction, graph.admission, previous, value));
        attempts.push(previous);
        const terminal = await runEffect(captureFrameworkMigrationAttemptTerminal({ attempt: previous.attempt,
          stepReceipts: graph.receiptValues, terminalAt: COORDINATOR_TERMINAL_AT,
          outcome: { kind: "failed", reason: "superseded", evidenceSha256: "a".repeat(64) } }));
        terminals.push(await runEffect(ensureFrameworkMigrationAttemptTerminalInTransactionEffect(transaction, previous, graph.receipts, terminal)));
      }
    });
    const references = attempts.flatMap(attempt => [
      { kind: "attemptStarted" as const, attemptStartSha256: attempt.attempt.sha256 },
      ...Array.from({ length: 32 }, () => ({ kind: "leaseRenewed" as const,
        attemptId: attempt.attempt.frame.attemptId, attemptFence: attempt.attempt.frame.attemptFence })),
    ]);
    let attemptRows = 0;
    let canonicalBytes = 0;
    const detach = driverRows.detachDriverRows;
    const reads = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(rows => {
      const detached = detach(rows);
      for (const row of detached) {
        if (Object.hasOwn(row, "attemptStartSha256")) {
          attemptRows++;
          if ("canonicalBytes" in row && row.canonicalBytes instanceof Uint8Array) canonicalBytes += row.canonicalBytes.byteLength;
        }
      }
      return detached;
    });
    const issued = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationAttemptStart");
    const prefixReads = vi.spyOn(receiptRepository, "restoreFrameworkMigrationStepReceiptPrefixForAttemptTerminalInTransactionEffect");
    try {
      const result = await persistence.drizzle.transaction(transaction => runEffect(Effect.gen(function* () {
        const fill = makeFrameworkGraphReferenceRead<number>();
        for (let index = 0; index < 512; index++) yield* fill(Effect.succeed(index), transaction, index);
        const subjects = yield* restoreFrameworkMigrationEventAttemptSubjectsInTransactionEffect(transaction, graph.collision, references, "readEvent");
        const receipts = yield* restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect(transaction, graph.collision,
          graph.receipts.map(receipt => receipt.receipt.sha256), "readEvent", subjects.byStorageId);
        const terminalSubjects = yield* restoreFrameworkMigrationEventTerminalSubjectsInTransactionEffect(transaction, graph.collision,
          terminals.map(terminal => terminal.terminal.sha256), subjects.byStorageId, "readEvent");
        return { subjects, receipts, terminalSubjects };
      }).pipe(read => withFrameworkGraphReadPass(read, transaction))));
      expect(result.subjects.byStorageId.size).toBe(count);
      expect(result.receipts.size).toBe(graph.receipts.length);
      expect(issued).toHaveBeenCalledTimes(count);
      expect(attemptRows).toBe(count);
      expect(prefixReads).toHaveBeenCalledTimes(1);
      expect(result.terminalSubjects.size).toBe(count);
      const terminalReceiptArrays = new Set([...result.terminalSubjects.values()].map(terminal => {
        const authority = capturedAuthorityForAttemptTerminal(terminal.terminal);
        expect(authority?.completedStepCount).toBe(graph.receipts.length);
        expect(storedValues.restoredFrameworkMigrationAttemptTerminalStepReceipts(terminal)?.map(receipt => receipt.receipt.sha256))
          .toEqual(graph.receipts.map(receipt => receipt.receipt.sha256));
        return authority?.stepReceipts;
      }));
      expect(terminalReceiptArrays.size).toBe(1);
      expect(canonicalBytes).toBe(attempts.reduce((bytes, attempt) => bytes + new TextEncoder().encode(attempt.attempt.canonicalJson).byteLength, 0));
      for (const [producerIndex, producer] of attempts.entries()) for (const [successorIndex, successor] of attempts.entries()) {
        const restoredProducer = result.subjects.byStorageId.get(producer.storageId);
        const restoredSuccessor = result.subjects.byStorageId.get(successor.storageId);
        if (restoredProducer === undefined || restoredSuccessor === undefined) throw new Error("Missing attempt evidence");
        expect(storedValues.isRestoredFrameworkMigrationAttemptAncestor(restoredProducer, restoredSuccessor)).toBe(
          producerIndex === successorIndex || producerIndex === 0 ||
          (producerIndex < successorIndex && successorIndex < count - 1));
      }
      process.stdout.write(JSON.stringify({ attempts: count, eventReferences: references.length, attemptRows, canonicalBytes,
        issuedAttempts: issued.mock.calls.length }) + "\n");
      expect(await persistence.drizzle.transaction(transaction => runEffectFailure(
        restoreFrameworkMigrationEventAttemptSubjectsInTransactionEffect(transaction, graph.collision,
          [{ kind: "leaseRenewed", attemptId: graph.attempt.attempt.frame.attemptId, attemptFence: "999" }], "readEvent"),
      ))).toMatchObject({ reason: "storedCorruption" });
    } finally { reads.mockRestore(); issued.mockRestore(); prefixReads.mockRestore(); }
  }, 120_000);
});

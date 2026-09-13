import { Effect, Encoding, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as driverRows from "../src/detachDriverRows";
import * as storedValues from "../src/migrationCoordination/storedRestoration";
import { captureFrameworkMigrationAttemptStart, captureFrameworkMigrationAttemptTerminal, captureFrameworkMigrationPlanAdmission,
  encodeFrameworkMigrationStepReceiptFrame } from "../src/migrationCoordination/canonical";
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
  it("refuses a changed canonical root during the terminal inventory reread", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const first = graph.receipts[0];
    if (first === undefined) throw new Error("Missing first receipt");
    const changed = await runEffect(encodeFrameworkMigrationStepReceiptFrame({ ...first.receipt.frame, completedAt: COORDINATOR_TERMINAL_AT }));
    const bytes = new TextEncoder().encode(changed.canonicalJson);
    const digest = Result.getOrThrow(Encoding.decodeHex(changed.sha256));
    let terminalPhase = false;
    let altered = false;
    const detach = driverRows.detachDriverRows;
    const reads = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(rows => detach(rows).map(row => {
      if (terminalPhase && "receiptStorageId" in row && row.receiptStorageId === first.storageId && "canonicalBytes" in row) {
        altered = true;
        return { ...row, canonicalBytes: bytes, canonicalByteLength: bytes.byteLength,
          observedCanonicalByteLength: bytes.byteLength, stepReceiptSha256: digest };
      }
      return row;
    }));
    try {
      await expect(persistence.drizzle.transaction(transaction => runEffect(Effect.gen(function* () {
        const working = receiptRepository.makeFrameworkMigrationReceiptReadGraph(transaction);
        const attempts = (yield* restoreFrameworkMigrationEventAttemptSubjectsInTransactionEffect(transaction, graph.collision,
          [{ kind: "attemptStarted", attemptStartSha256: graph.attempt.attempt.sha256 }], "readEvent")).byStorageId;
        yield* restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect(transaction, graph.collision,
          graph.receipts.map(receipt => receipt.receipt.sha256), "readEvent", attempts, working);
        terminalPhase = true;
        return yield* restoreFrameworkMigrationEventTerminalSubjectsInTransactionEffect(transaction, graph.collision,
          [graph.terminal.terminal.sha256], attempts, "readEvent", working);
      })))).rejects.toMatchObject({ reason: "storedCorruption" });
      expect(altered).toBe(true);
    } finally { reads.mockRestore(); }
  }, 90_000);

  it("refuses a receipt graph borrowed from a different transaction", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const foreign = await persistence.drizzle.transaction(async transaction => receiptRepository.makeFrameworkMigrationReceiptReadGraph(transaction));
    expect(await persistence.drizzle.transaction(transaction => runEffectFailure(
      restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect(transaction, graph.collision, [], "readEvent", undefined, foreign),
    ))).toMatchObject({ reason: "storedCorruption" });
  }, 90_000);

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

  it.each([{ count: 4, extraTables: 0 }, { count: 16, extraTables: 0 }, { count: 4, extraTables: 14 }])("shares receipt evidence across $count attempts and $extraTables extra tables", async ({ count, extraTables }) => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues(extraTables);
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
    let receiptRows = 0;
    let receiptBytes = 0;
    let dependencyRows = 0;
    let canonicalBytes = 0;
    const detach = driverRows.detachDriverRows;
    const reads = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(rows => {
      const detached = detach(rows);
      for (const row of detached) {
        if ("receiptStorageId" in row && "canonicalBytes" in row && row.canonicalBytes instanceof Uint8Array) {
          receiptRows++; receiptBytes += row.canonicalBytes.byteLength;
        }
        if ("dependencyOrdinal" in row && "receiptStorageId" in row) dependencyRows++;
        if (Object.hasOwn(row, "attemptStartSha256")) {
          attemptRows++;
          if ("canonicalBytes" in row && row.canonicalBytes instanceof Uint8Array) canonicalBytes += row.canonicalBytes.byteLength;
        }
      }
      return detached;
    });
    const issued = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationAttemptStart");
    const receiptNodes = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationStepReceipt");
    const prefixReads = vi.spyOn(receiptRepository, "restoreFrameworkMigrationStepReceiptPrefixForAttemptTerminalInTransactionEffect");
    try {
      const result = await persistence.drizzle.transaction(transaction => runEffect(Effect.gen(function* () {
        const fill = makeFrameworkGraphReferenceRead<number>();
        for (let index = 0; index < 512; index++) yield* fill(Effect.succeed(index), transaction, index);
        const subjects = yield* restoreFrameworkMigrationEventAttemptSubjectsInTransactionEffect(transaction, graph.collision, references, "readEvent");
        const receiptGraph = receiptRepository.makeFrameworkMigrationReceiptReadGraph(transaction);
        const receipts = yield* restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect(transaction, graph.collision,
          graph.receipts.map(receipt => receipt.receipt.sha256), "readEvent", subjects.byStorageId, receiptGraph);
        const terminalSubjects = yield* restoreFrameworkMigrationEventTerminalSubjectsInTransactionEffect(transaction, graph.collision,
          terminals.map(terminal => terminal.terminal.sha256), subjects.byStorageId, "readEvent", receiptGraph);
        return { subjects, receipts, terminalSubjects, receiptGraph };
      }).pipe(read => withFrameworkGraphReadPass(read, transaction))));
      expect(result.subjects.byStorageId.size).toBe(count);
      expect(result.receipts.size).toBe(graph.receipts.length);
      expect(issued).toHaveBeenCalledTimes(count);
      expect(receiptNodes).toHaveBeenCalledTimes(graph.receipts.length);
      expect(receiptRows).toBe(2 * graph.receipts.length);
      expect(receiptBytes).toBe(2 * graph.receipts.reduce((bytes, receipt) => bytes + new TextEncoder().encode(receipt.receipt.canonicalJson).byteLength, 0));
      expect(dependencyRows).toBe(graph.plan.plan.frame.steps.reduce((edges, step) => edges + step.dependencies.length, 0));
      expect(attemptRows).toBe(count);
      expect(prefixReads).toHaveBeenCalledTimes(1);
      expect(result.terminalSubjects.size).toBe(count);
      expect(result.receiptGraph.contextsByPlan.size).toBe(1);
      const retained = result.receiptGraph.contextsByPlan.get(graph.plan.storageId);
      if (retained === undefined) throw new Error("Missing retained receipt graph");
      expect(retained.rootsByStorageId.size).toBe(graph.receipts.length);
      expect(retained.restoredByStorageId.size).toBe(graph.receipts.length);
      const retainedCanonicalBytes = [...retained.rootsByStorageId.values()].reduce((bytes, row) =>
        bytes + (row.canonicalBytes?.byteLength ?? 0), 0);
      expect(retainedCanonicalBytes).toBe(receiptBytes / 2);
      const terminalReceiptArrays = new Set([...result.terminalSubjects.values()].map(terminal => {
        const authority = capturedAuthorityForAttemptTerminal(terminal.terminal);
        expect(authority?.completedStepCount).toBe(graph.receipts.length);
        expect(storedValues.restoredFrameworkMigrationAttemptTerminalStepReceipts(terminal)?.map(receipt => receipt.receipt.sha256))
          .toEqual(graph.receipts.map(receipt => receipt.receipt.sha256));
        for (const receipt of storedValues.restoredFrameworkMigrationAttemptTerminalStepReceipts(terminal) ?? []) {
          expect(receipt).toBe(result.receipts.get(receipt.receipt.sha256));
        }
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
        issuedAttempts: issued.mock.calls.length, receiptRows, receiptBytes, dependencyRows, receiptNodes: receiptNodes.mock.calls.length }) + "\n");
      expect(await persistence.drizzle.transaction(transaction => runEffectFailure(
        restoreFrameworkMigrationEventAttemptSubjectsInTransactionEffect(transaction, graph.collision,
          [{ kind: "leaseRenewed", attemptId: graph.attempt.attempt.frame.attemptId, attemptFence: "999" }], "readEvent"),
      ))).toMatchObject({ reason: "storedCorruption" });
    } finally { reads.mockRestore(); issued.mockRestore(); receiptNodes.mockRestore(); prefixReads.mockRestore(); }
  }, 120_000);
});

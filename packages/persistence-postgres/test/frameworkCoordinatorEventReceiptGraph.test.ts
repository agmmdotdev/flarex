import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as driverRows from "../src/detachDriverRows";
import * as storedValues from "../src/migrationCoordination/storedRestoration";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import type { FrameworkMigrationStepReceiptSha256 } from "../src/migrationCoordination/identity";
import { makeFrameworkGraphReferenceRead, withFrameworkGraphReadPass } from "../src/migrationCoordination/graphReadPass";
import { restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect, makeFrameworkMigrationReceiptReadGraph } from "../src/migrationCoordination/migrationStepReceiptRepository";
import { runAdditiveFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { fxSystemFrameworkMigrationAttemptStarts } from "../src/migrationCoordination/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { createAdditiveFixture } from "./frameworkCoordinatorAdditiveTestSupport";
import { createSuccessfulTerminalPlanValues, storeSuccessfulTerminalGraphInTransaction } from "./frameworkCoordinatorRepositoryTestSupport";
import { withAdministrativeFrameworkMetadataRepair } from "./frameworkMetadataRepairTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

describe("event receipt graph restoration", () => {
  it.each([
    { extraTables: 0, reverse: false },
    { extraTables: 0, reverse: true },
    { extraTables: 14, reverse: false },
    { extraTables: 14, reverse: true },
  ])("restores each node once with $extraTables extra tables and reverse=$reverse", async ({ extraTables, reverse }) => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues(extraTables);
    const graph = await persistence.drizzle.transaction(transaction =>
      storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const digests = graph.receipts.map(receipt => receipt.receipt.sha256);
    const requested = reverse ? digests.toReversed() : digests;
    const edges = graph.receipts.reduce((count, receipt) => count + receipt.receipt.frame.dependencyReceipts.length, 0);
    let receiptRows = 0;
    let dependencyRows = 0;
    const detach = driverRows.detachDriverRows;
    const reads = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(rows => {
      const detached = detach(rows);
      for (const row of detached) {
        if (Object.hasOwn(row, "dependencyCount") && Object.hasOwn(row, "observedPostconditionSha256")) receiptRows += 1;
        if (Object.hasOwn(row, "dependencyReceiptStorageId")) dependencyRows += 1;
      }
      return detached;
    });
    const restorations = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationStepReceipt");
    const attempts = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationAttemptStart");
    try {
      const subjects = await persistence.drizzle.transaction(transaction => runEffect(readSubjectsWithFullMemo(
        transaction, graph.collision, [...requested, ...requested.slice(0, 2)])));
      expect(subjects.size).toBe(graph.receipts.length);
      for (const expected of graph.receipts) {
        const actual = subjects.get(expected.receipt.sha256);
        expect(actual?.receipt.canonicalJson).toBe(expected.receipt.canonicalJson);
        expect(actual?.attempt.attempt.canonicalJson).toBe(expected.attempt.attempt.canonicalJson);
      }
      expect(restorations).toHaveBeenCalledTimes(graph.receipts.length);
      expect(attempts).toHaveBeenCalledTimes(1);
      expect(dependencyRows).toBe(edges);
      // Reverse input can fetch a prerequisite before its later digest batch.
      // It still restores that prerequisite once and fetches at most twice.
      expect(receiptRows).toBeLessThanOrEqual((reverse ? 2 : 1) * graph.receipts.length);
      process.stdout.write(JSON.stringify({ steps: graph.receipts.length, edges, reverse, receiptRows,
        dependencyRows, restoredNodes: restorations.mock.calls.length, restoredAttempts: attempts.mock.calls.length }) + "\n");
    } finally {
      reads.mockRestore();
      restorations.mockRestore();
      attempts.mockRestore();
    }
  }, 90_000);

  it.each([false, true])("isolates producer state on A/B/A plan traversal with shared graph=%s", async shared => {
    const fixture = await createAdditiveFixture();
    const successor = await runEffect(runAdditiveFrameworkMigrationCoordinatorEffect(fixture.input));
    if (successor.kind !== "ready") throw new Error("Expected additive readiness");
    const base = storedValues.restoredFrameworkMigrationAttemptTerminalStepReceipts(fixture.base.readiness.installation.terminal);
    const added = storedValues.restoredFrameworkMigrationAttemptTerminalStepReceipts(successor.readiness.installation.terminal);
    if (base === undefined || added === undefined || base.length < 2) throw new Error("Missing plan receipts");
    expect(fixture.base.readiness.installation.plan.storageId).not.toBe(successor.readiness.installation.plan.storageId);
    const requested = [...base.slice(0, 1), ...added, ...base.slice(1)];
    const attempts = vi.spyOn(storedValues, "restoreStoredFrameworkMigrationAttemptStart");
    try {
      const restored = await fixture.persistence.drizzle.transaction(transaction => runEffect(readSubjectsWithFullMemo(
        transaction, fixture.base.readiness.installation.collision, requested.map(receipt => receipt.receipt.sha256), shared)));
      expect(restored.size).toBe(requested.length);
      for (const receipt of requested) {
        const actual = restored.get(receipt.receipt.sha256);
        expect(actual?.receipt.canonicalJson).toBe(receipt.receipt.canonicalJson);
        expect(actual?.attempt.attempt.canonicalJson).toBe(receipt.attempt.attempt.canonicalJson);
        expect(actual?.attempt.plan.storageId).toBe(receipt.attempt.plan.storageId);
      }
      // The independent reader releases A; the explicit graph retains separate
      // A/B contexts. Additive admission also authenticates base history.
      const producerRestorations = attempts.mock.calls.filter(([input]) => input.row.attemptStorageId ===
        successor.readiness.installation.terminal.attempt.storageId);
      expect(producerRestorations).toHaveLength(1);
    } finally { attempts.mockRestore(); }
  }, 180_000);

  it("rechecks producer bytes after a completed read and after a failed read", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction => storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const digests = graph.receipts.map(receipt => receipt.receipt.sha256);
    await persistence.drizzle.transaction(async transaction => {
      const read = () => readSubjectsWithFullMemo(transaction, graph.collision, digests);
      expect((await runEffect(read())).size).toBe(digests.length);
      const original = new TextEncoder().encode(graph.attempt.attempt.canonicalJson);
      const changed = new TextEncoder().encode(graph.attempt.attempt.canonicalJson.replace("worker-a", "worker-b"));
      expect(changed).not.toEqual(original);
      expect(changed.byteLength).toBe(original.byteLength);
      const replaceBytes = (canonicalBytes: Uint8Array) => withAdministrativeFrameworkMetadataRepair(transaction,
        ["fx_system_framework_migration_attempt_start"], () => transaction.update(fxSystemFrameworkMigrationAttemptStarts)
          .set({ canonicalBytes }).where(eq(fxSystemFrameworkMigrationAttemptStarts.attemptStorageId, graph.attempt.storageId)));
      await replaceBytes(changed);
      expect(await runEffectFailure(read())).toMatchObject({ reason: "storedCorruption" });
      await replaceBytes(original);
      expect((await runEffect(read())).size).toBe(digests.length);
    });
  }, 90_000);
});

const readSubjectsWithFullMemo = Effect.fn("EventReceiptGraphTest.readSubjectsWithFullMemo")(
  function* (transaction: FlarexMetadataTransaction, collision: storedValues.RestoredFrameworkMigrationCollisionDomain,
    digests: readonly FrameworkMigrationStepReceiptSha256[], shared = false) {
    // Consume the existing opportunistic budget without a production bypass.
    const fill = makeFrameworkGraphReferenceRead<number>();
    for (let index = 0; index < 512; index++) yield* fill(Effect.succeed(index), transaction, index);
    return yield* restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect(transaction, collision, digests, "readEvent",
      undefined, shared ? makeFrameworkMigrationReceiptReadGraph(transaction) : undefined);
  }, withFrameworkGraphReadPass,
);

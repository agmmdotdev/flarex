import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as driverRows from "../src/detachDriverRows";
import * as storedValues from "../src/migrationCoordination/storedRestoration";
import { makeFrameworkGraphReferenceRead, withFrameworkGraphReadPass } from "../src/migrationCoordination/graphReadPass";
import { restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect } from "../src/migrationCoordination/migrationStepReceiptRepository";
import { runEffect } from "./effectTestRuntime";
import { createSuccessfulTerminalPlanValues, storeSuccessfulTerminalGraphInTransaction } from "./frameworkCoordinatorRepositoryTestSupport";
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
    try {
      const subjects = await persistence.drizzle.transaction(transaction => runEffect(withFrameworkGraphReadPass(Effect.gen(function* () {
        // Consume the existing opportunistic memo budget. The graph algorithm
        // must not depend on cache capacity or a production bypass/test mode.
        const fill = makeFrameworkGraphReferenceRead<number>();
        for (let index = 0; index < 512; index++) yield* fill(Effect.succeed(index), transaction, index);
        return yield* restoreFrameworkMigrationEventReceiptSubjectsInTransactionEffect(transaction, graph.collision,
          [...requested, ...requested.slice(0, 2)], "readEvent");
      }), transaction)));
      expect(subjects.size).toBe(graph.receipts.length);
      for (const expected of graph.receipts) {
        const actual = subjects.get(expected.receipt.sha256);
        expect(actual?.receipt.canonicalJson).toBe(expected.receipt.canonicalJson);
        expect(actual?.attempt.attempt.canonicalJson).toBe(expected.attempt.attempt.canonicalJson);
      }
      expect(restorations).toHaveBeenCalledTimes(graph.receipts.length);
      expect(dependencyRows).toBe(edges);
      // Reverse input can fetch a prerequisite before its later digest batch.
      // It still restores that prerequisite once and fetches at most twice.
      expect(receiptRows).toBeLessThanOrEqual((reverse ? 2 : 1) * graph.receipts.length);
      process.stdout.write(JSON.stringify({ steps: graph.receipts.length, edges, reverse, receiptRows,
        dependencyRows, restoredNodes: restorations.mock.calls.length }) + "\n");
    } finally {
      reads.mockRestore();
      restorations.mockRestore();
    }
  }, 90_000);
});

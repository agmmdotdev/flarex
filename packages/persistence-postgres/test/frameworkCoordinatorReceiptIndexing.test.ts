import { describe, expect, it, vi } from "vitest";
import * as driverRows from "../src/detachDriverRows";
import { capturedPlanForStep, capturedStepForPlan } from "../src/migrationCoordination/authority";
import { readFrameworkMigrationStepReceiptPrefixInTransactionEffect } from "../src/migrationCoordination/migrationStepReceiptRepository";
import { runEffect } from "./effectTestRuntime";
import { createSuccessfulTerminalPlanValues, storeSuccessfulTerminalGraphInTransaction } from "./frameworkCoordinatorRepositoryTestSupport";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

describe("migration receipt lookup work", () => {
  it.each([0, 10])("visits sidecar owners linearly with %i extra tables", async extraTables => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues(extraTables);
    const graph = await persistence.drizzle.transaction(transaction =>
      storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const edges = graph.receipts.reduce((count, receipt) => count + receipt.receipt.frame.dependencyReceipts.length, 0);
    let sidecarRows = 0;
    let ownerVisits = 0;
    const detach = driverRows.detachDriverRows;
    // Observe property visits after real detachment; SQL, canonical decoding,
    // projection checks and authority issuance still execute unchanged.
    const observation = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(rows =>
      detach(rows).map(row => {
        if (!Object.hasOwn(row, "dependencyReceiptStorageId")) return row;
        sidecarRows += 1;
        return new Proxy(row, {
          get(target, key, receiver) {
            if (key === "receiptStorageId") ownerVisits += 1;
            return Reflect.get(target, key, receiver);
          },
        });
      }));
    try {
      const receipts = await persistence.drizzle.transaction(transaction =>
        runEffect(readFrameworkMigrationStepReceiptPrefixInTransactionEffect(transaction, graph.attempt)));
      expect(receipts.map(receipt => receipt.receipt.canonicalJson)).toEqual(graph.receiptValues.map(receipt => receipt.canonicalJson));
      expect(sidecarRows).toBe(edges);
      // One grouping pass plus the existing per-edge repository/value checks.
      // Re-filtering all edges for each receipt exceeds this bound as N grows.
      expect(ownerVisits).toBeLessThanOrEqual(4 * edges);
      process.stdout.write(JSON.stringify({ steps: receipts.length, edges, sidecarRows, ownerVisits }) + "\n");
    } finally {
      observation.mockRestore();
    }
  }, 60_000);

  it("retains bounded per-receipt reads when the sidecar batch is oversized", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction =>
      storeSuccessfulTerminalGraphInTransaction(transaction, values));
    const detach = driverRows.detachDriverRows;
    let expanded = false;
    let individualReads = 0;
    const observation = vi.spyOn(driverRows, "detachDriverRows").mockImplementation(rows => {
      const detached = detach(rows);
      const first = detached[0];
      if (first === undefined || !Object.hasOwn(first, "dependencyReceiptStorageId")) return detached;
      if (expanded) {
        individualReads += 1;
        return detached;
      }
      // Simulate the existing batch overflow signal. Its incomplete transport
      // rows must be discarded; original bounded SQL reads still validate each
      // receipt against the real database rather than accept this batch.
      expanded = true;
      return Array.from({ length: 4097 }, () => first);
    });
    try {
      const receipts = await persistence.drizzle.transaction(transaction =>
        runEffect(readFrameworkMigrationStepReceiptPrefixInTransactionEffect(transaction, graph.attempt)));
      expect(expanded).toBe(true);
      expect(individualReads).toBeGreaterThan(0);
      expect(receipts.map(receipt => receipt.receipt.canonicalJson)).toEqual(graph.receiptValues.map(receipt => receipt.canonicalJson));
    } finally {
      observation.mockRestore();
    }
  }, 30_000);

  it("resolves only each captured or restored plan's own issued steps", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const values = await createSuccessfulTerminalPlanValues();
    const graph = await persistence.drizzle.transaction(transaction =>
      storeSuccessfulTerminalGraphInTransaction(transaction, values));
    for (const plan of [values.planValue, graph.plan.plan]) {
      for (const step of plan.frame.steps) {
        expect(capturedStepForPlan(plan, step.stepId)).toBe(step);
        expect(capturedPlanForStep(step)).toBe(plan);
        expect(capturedStepForPlan(Object.freeze({ ...plan }), step.stepId)).toBeUndefined();
      }
      expect(capturedStepForPlan(plan, "missing-step")).toBeUndefined();
    }
    expect(graph.plan.plan).not.toBe(values.planValue);
    for (const step of values.planValue.frame.steps) {
      expect(capturedStepForPlan(graph.plan.plan, step.stepId)).not.toBe(step);
    }
  }, 30_000);
});

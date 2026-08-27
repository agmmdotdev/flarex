import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  fxSystemDurableTaskComputeCancellationsV1,
  fxSystemDurableTaskComputeDispatchesV1,
} from "../src/schema";
import {
  decodeStoredTaskComputeDeliveryEvidenceV1,
  deleteTaskComputePendingConstraintRowV1,
  invalidTaskComputePendingStatementsV1,
  invalidTaskComputeDeliveryStatementsV1,
  proveLosslessComputeProfileStorageV1,
  seedTaskComputeDeliverySchemaV1,
  seedTaskComputePendingConstraintRowV1,
  settleTaskComputeDeliverySchemaV1,
} from "./taskComputeDeliverySchemaV1TestSupport";

describe("DTE06-C1 compute delivery schema", () => {
  it("migrates idempotently and enforces operation-specific evidence shapes", async () => {
    const db = new PGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      await persistence.migrate();
      const seeded = await seedTaskComputeDeliverySchemaV1(persistence);
      await proveLosslessComputeProfileStorageV1(persistence);
      const [dispatch] = await persistence.drizzle.select({
        maximumDurationMs:
          fxSystemDurableTaskComputeDispatchesV1.maximumDurationMs,
      }).from(fxSystemDurableTaskComputeDispatchesV1);
      expect(dispatch?.maximumDurationMs).toBe(300_000);
      expect(typeof dispatch?.maximumDurationMs).toBe("number");

      expect(await states(persistence)).toEqual({
        dispatch: "prepared",
        cancellation: "waiting_dispatch",
      });
      for (const statement of invalidTaskComputeDeliveryStatementsV1) {
        await expect(persistence.query(statement)).rejects.toThrow();
      }
      await seedTaskComputePendingConstraintRowV1(
        persistence,
        seeded.scopeId,
        seeded.runId,
      );
      for (const statement of invalidTaskComputePendingStatementsV1) {
        await expect(persistence.query(statement)).rejects.toThrow();
      }
      await deleteTaskComputePendingConstraintRowV1(
        persistence,
        seeded.scopeId,
        seeded.runId,
      );

      await settleTaskComputeDeliverySchemaV1(persistence, seeded.evidence);
      const decoded = await decodeStoredTaskComputeDeliveryEvidenceV1(
        persistence,
      );
      expect(decoded.dispatchRequest.identity.scopeId).toBe(seeded.scopeId);
      expect(decoded.computeProfile).toBe("compute-small");
      expect(decoded.dispatchAcceptance.kind).toBe("accepted");
      expect(decoded.cancellationRequest.cancellationGeneration).toBe(1n);
      expect(decoded.cancellationReceipt.kind).toBe("interruption_requested");
      expect(await states(persistence)).toEqual({
        dispatch: "accepted",
        cancellation: "delivered",
      });
    } finally {
      await db.close();
    }
  });
});

async function states(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
  const [dispatch] = await persistence.drizzle.select({
    state: fxSystemDurableTaskComputeDispatchesV1.deliveryState,
  }).from(fxSystemDurableTaskComputeDispatchesV1);
  const [cancellation] = await persistence.drizzle.select({
    state: fxSystemDurableTaskComputeCancellationsV1.deliveryState,
  }).from(fxSystemDurableTaskComputeCancellationsV1);
  if (dispatch === undefined || cancellation === undefined) {
    throw new Error("compute delivery state row missing");
  }
  return {
    dispatch: dispatch.state,
    cancellation: cancellation.state,
  };
}

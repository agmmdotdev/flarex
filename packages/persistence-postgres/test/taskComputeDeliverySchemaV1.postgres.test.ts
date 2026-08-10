import { describe, expect, it } from "vitest";

import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { fxSystemDurableTaskComputeDispatchesV1 } from "../src/schema";
import {
  decodeStoredTaskComputeDeliveryEvidenceV1,
  invalidTaskComputeDeliveryStatementsV1,
  proveLosslessComputeProfileStorageV1,
  seedTaskComputeDeliverySchemaV1,
  settleTaskComputeDeliverySchemaV1,
} from "./taskComputeDeliverySchemaV1TestSupport";
import { seedRegisteredTaskSystemParentV1 } from
  "./taskSystemPostgresTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("DTE06-C1 PostgreSQL acceptance environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting DTE06-C1.",
    ).not.toBeNull();
  });
});

describePostgres("real PostgreSQL DTE06-C1 compute delivery schema", () => {
  it("migrates with an ordinary role and enforces both state machines", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const parent = await seedRegisteredTaskSystemParentV1(
        persistence,
        "dte06-c1:compute-delivery-schema",
      );
      const seeded = await seedTaskComputeDeliverySchemaV1(
        persistence,
        parent,
      );
      await proveLosslessComputeProfileStorageV1(persistence);
      const [dispatch] = await persistence.drizzle.select({
        maximumDurationMs:
          fxSystemDurableTaskComputeDispatchesV1.maximumDurationMs,
      }).from(fxSystemDurableTaskComputeDispatchesV1);
      expect(dispatch?.maximumDurationMs).toBe(300_000);
      expect(typeof dispatch?.maximumDurationMs).toBe("number");
      for (const statement of invalidTaskComputeDeliveryStatementsV1) {
        await expect(persistence.query(statement)).rejects.toThrow();
      }
      await settleTaskComputeDeliverySchemaV1(persistence, seeded.evidence);
      const decoded = await decodeStoredTaskComputeDeliveryEvidenceV1(
        persistence,
      );
      expect(decoded.dispatchRequest.identity.scopeId).toBe(seeded.scopeId);
      expect(decoded.computeProfile).toBe("compute-small");
      expect(decoded.dispatchAcceptance.kind).toBe("accepted");
      expect(decoded.cancellationRequest.cancellationGeneration).toBe(1n);
      expect(decoded.cancellationReceipt.kind).toBe("interruption_requested");

      const result = await persistence.query<{ count: number }>(`
        select count(*)::int as count
        from information_schema.tables
        where table_schema = current_schema()
          and table_name in (
            'fx_system_durable_task_compute_dispatch_v1',
            'fx_system_durable_task_compute_cancellation_v1'
          )
      `);
      expect(result.rows).toEqual([{ count: 2 }]);
    });
  }, 480_000);
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  createFlarexRetainedHistoryMaintenanceManualTrigger,
} from "../src/retainedHistoryMaintenance";

describe("O11-F3a private manual retained-history wake", () => {
  it("runs one bounded host-neutral invocation and returns JSON without cursors", async () => {
    let calls = 0;
    const trigger = createFlarexRetainedHistoryMaintenanceManualTrigger({
      runEffect: () => Effect.sync(() => {
        calls += 1;
        return Object.freeze({
          kind: "completed" as const,
          reason: "countBudget" as const,
          invocations: 2,
          directoryPagesRead: 3,
          maintenancePagesExecuted: 4,
          batches: Object.freeze([Object.freeze({
            version:
              "flarex.retained-history-multi-scope-maintenance-receipt.v1" as const,
            stopReason: "cycleExhausted" as const,
            directoryPagesRead: 3,
            scopeVisits: 2,
            scopesFailed: 2,
            maintenanceRuns: 0,
            maintenance: null,
            continuation: null,
          })]),
          nextRunAt: new Date("2030-01-01T00:00:00.000Z"),
        });
      }),
    });

    const projection = await Effect.runPromise(trigger.runEffect());
    expect(projection).toEqual({
      operation: "retainedHistoryMaintenance",
      status: "completed",
      reason: "countBudget",
      invocations: 2,
      directoryPagesRead: 3,
      maintenancePagesExecuted: 4,
      scopeVisits: 2,
      scopesFailed: 2,
      nextRunAt: "2030-01-01T00:00:00.000Z",
    });
    expect("continuation" in projection).toBe(false);
    expect(calls).toBe(1);
  });

  it("projects duplicate and not-due wakes without invoking hidden work", async () => {
    for (const [result, expected] of [
      [
        Object.freeze({
          kind: "busy" as const,
          claimExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
        }),
        Object.freeze({
          operation: "retainedHistoryMaintenance",
          status: "busy",
          claimExpiresAt: "2030-01-01T00:00:00.000Z",
        }),
      ],
      [
        Object.freeze({
          kind: "notDue" as const,
          nextRunAt: new Date("2030-01-02T00:00:00.000Z"),
        }),
        Object.freeze({
          operation: "retainedHistoryMaintenance",
          status: "not_due",
          nextRunAt: "2030-01-02T00:00:00.000Z",
        }),
      ],
    ] as const) {
      const trigger = createFlarexRetainedHistoryMaintenanceManualTrigger({
        runEffect: () => Effect.succeed(result),
      });
      await expect(Effect.runPromise(trigger.runEffect())).resolves.toEqual(
        expected,
      );
    }
  });
});

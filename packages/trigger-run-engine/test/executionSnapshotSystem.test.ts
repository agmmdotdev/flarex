// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/systems/executionSnapshotSystem.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ExecutionSnapshotSystem } from "../src/executionSnapshotSystem.js";
import type { CreateExecutionSnapshotInput, ExecutionStatus } from "../src/model.js";
import {
  DATABASE_TIME_MS,
  executingSnapshot,
  heartbeatTimeouts,
  latestSnapshot,
  RUN_ID,
  scriptedAttemptStart,
} from "./scriptedAttemptStart.js";

const system = new ExecutionSnapshotSystem({ heartbeatTimeouts });
const input: CreateExecutionSnapshotInput = {
  run: { id: RUN_ID, status: "EXECUTING", attemptNumber: 1 },
  snapshot: { executionStatus: "EXECUTING", description: "Attempt created, starting execution" },
  previousSnapshotId: latestSnapshot.id,
  completedWaitpoints: [{ id: "wait_completed", index: 2 }],
};

// Retained source dispatch: executionSnapshotSystem.ts:432-525, 635-658.
describe("adopted ExecutionSnapshotSystem.createExecutionSnapshot", () => {
  it.each([
    ["PENDING_EXECUTING", 30_000],
    ["PENDING_CANCEL", 60_000],
    ["EXECUTING", 90_000],
    ["EXECUTING_WITH_WAITPOINTS", 120_000],
    ["SUSPENDED", 150_000],
  ] satisfies readonly (readonly [ExecutionStatus, number])[])(
    "requests the source heartbeat interval for %s using operation database time",
    async (executionStatus, intervalMs) => {
      const returned = { ...executingSnapshot, executionStatus, createdAtMs: DATABASE_TIME_MS - 1_000 };
      const { operation, requests } = scriptedAttemptStart({ created: returned });

      const result = await Effect.runPromise(system.createExecutionSnapshot(operation, input));

      expect(result).toBe(returned);
      expect(requests).toEqual([
        { kind: "createExecutionSnapshot", input },
        { kind: "recordIntent", intent: {
          kind: "heartbeatDue", runId: RUN_ID, snapshotId: returned.id,
          availableAtMs: DATABASE_TIME_MS + intervalMs,
        } },
        { kind: "recordIntent", intent: {
          kind: "executionSnapshotCreated", runId: RUN_ID, snapshot: returned,
          completedWaitpointIds: ["wait_completed"], atMs: returned.createdAtMs,
        } },
      ]);
    },
  );

  it.each(["RUN_CREATED", "DELAYED", "QUEUED", "QUEUED_EXECUTING", "FINISHED"] as const)(
    "records only the snapshot notice for %s",
    async (executionStatus) => {
      const returned = { ...executingSnapshot, executionStatus, completedWaitpoints: [] };
      const { operation, requests } = scriptedAttemptStart({ created: returned });

      await Effect.runPromise(system.createExecutionSnapshot(operation, {
        run: input.run, snapshot: input.snapshot,
      }));

      expect(requests).toEqual([
        { kind: "createExecutionSnapshot", input: { run: input.run, snapshot: input.snapshot } },
        { kind: "recordIntent", intent: {
          kind: "executionSnapshotCreated", runId: RUN_ID, snapshot: returned,
          completedWaitpointIds: [], atMs: returned.createdAtMs,
        } },
      ]);
    },
  );

  it("suppresses heartbeat on a snapshot error while retaining its durable notice", async () => {
    const { operation, requests } = scriptedAttemptStart();
    const errorInput = { ...input, error: "Execution state error" };

    await Effect.runPromise(system.createExecutionSnapshot(operation, errorInput));

    expect(requests).toEqual([
      { kind: "createExecutionSnapshot", input: errorInput },
      { kind: "recordIntent", intent: {
        kind: "executionSnapshotCreated", runId: RUN_ID, snapshot: executingSnapshot,
        completedWaitpointIds: ["wait_completed"], atMs: executingSnapshot.createdAtMs,
      } },
    ]);
  });
});

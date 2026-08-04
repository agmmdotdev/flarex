// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/tests/heartbeats.test.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decideHandleLeaseExpiryV1 } from "../../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { ATTEMPT_ID, FENCE_1, LEASE_VERSION_1, NOW, RUN_ID, committedDecision, databaseTime, executingAggregate } from "../support.js";

describe("Trigger heartbeat recovery translation", () => {
  it("treats an early expiry wake as current and an expired wake as durable recovery", () => {
    const live = executingAggregate({ leaseExpiresAt: databaseTime(NOW + 1) });
    const command = { type: "handle_lease_expiry" as const, runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1, expectedLeaseVersion: LEASE_VERSION_1 };
    expect(Result.getOrThrow(decideHandleLeaseExpiryV1(command, {
      databaseNowMs: NOW, current: live, attemptGrantCandidate: null,
    }))).toMatchObject({ kind: "no_change", outcome: { reason: "lease_not_expired" } });

    const expired = executingAggregate({ leaseExpiresAt: databaseTime(NOW - 1), effectCursor: 8n });
    const committed = committedDecision(decideHandleLeaseExpiryV1(command, {
      databaseNowMs: NOW, current: expired, attemptGrantCandidate: null,
    }));
    expect(committed.outcome.kind).toBe("retry_scheduled");
    expect(committed.requestedEffects.map((entry) => entry.effect.kind)).toEqual([
      "release_queue_ownership", "wake_retry", "publish_lifecycle_event", "notify_current_state",
    ]);
  });
});

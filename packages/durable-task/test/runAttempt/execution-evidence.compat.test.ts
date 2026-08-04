// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/systems/executionSnapshotSystem.test.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { describe, expect, it } from "vitest";
import { decideHeartbeatAttemptV1 } from "../../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { ATTEMPT_ID, FENCE_1, NOW, RUN_ID, committedDecision, executingAggregate, heartbeatSequence } from "../support.js";

describe("Trigger execution snapshot translation", () => {
  it("records one heartbeat evidence item and ordered replacement-wake effects", () => {
    const current = executingAggregate({ effectCursor: 8n });
    const decision = committedDecision(decideHeartbeatAttemptV1(
      { type: "heartbeat_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1, heartbeatSequence: heartbeatSequence(2) },
      { databaseNowMs: NOW, current, attemptGrantCandidate: null },
    ));
    expect(decision.evidence.map((entry) => entry.kind)).toEqual(["heartbeat_accepted"]);
    expect(decision.requestedEffects.map((entry) => [Number(entry.sequence), entry.effect.kind])).toEqual([
      [9, "cancel_obsolete_lease_wake"], [10, "wake_lease_expiry"], [11, "notify_current_state"],
    ]);
  });
});

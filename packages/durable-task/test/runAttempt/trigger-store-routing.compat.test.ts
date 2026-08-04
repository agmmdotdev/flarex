// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/systems/runAttemptSystem.test.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { describe, expect, it } from "vitest";
import { decideStartAttemptV1 } from "../../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { ATTEMPT_ID, ATTEMPT_NUMBER_1, FENCE_1, JITTER, NOW, RUN_ID, RUN_VERSION_1, committedDecision, readyAggregate } from "../support.js";

describe("Trigger store-routing translation", () => {
  it("accepts a store-issued candidate without exposing a database client", () => {
    const current = readyAggregate();
    const decision = committedDecision(decideStartAttemptV1(
      { type: "start_attempt", runId: RUN_ID, expectedRunVersion: RUN_VERSION_1, retryJitter: JITTER },
      { databaseNowMs: NOW, current, attemptGrantCandidate: { attemptId: ATTEMPT_ID, attemptNumber: ATTEMPT_NUMBER_1, executionFence: FENCE_1 } },
    ));
    expect(decision.next.phase).toBe("attempt_granted");
    expect(Object.keys(decision)).not.toContain("tx");
    expect(Object.keys(decision)).not.toContain("environmentId");
  });
});

// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/tests/startRunAttemptReadResidency.test.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decideStartAttemptV1 } from "../../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { ATTEMPT_ID, ATTEMPT_NUMBER_1, FENCE_1, JITTER, NOW, RUN_ID, RUN_VERSION_2, readyAggregate } from "../support.js";

describe("start authority translation", () => {
  it("returns current state for an old discovery version without using the candidate", () => {
    const current = readyAggregate();
    const decision = Result.getOrThrow(decideStartAttemptV1(
      { type: "start_attempt", runId: RUN_ID, expectedRunVersion: RUN_VERSION_2, retryJitter: JITTER },
      { databaseNowMs: NOW, current, attemptGrantCandidate: { attemptId: ATTEMPT_ID, attemptNumber: ATTEMPT_NUMBER_1, executionFence: FENCE_1 } },
    ));
    expect(decision).toMatchObject({ kind: "no_change", disposition: "current", outcome: { reason: "stale_run_version" } });
  });
});

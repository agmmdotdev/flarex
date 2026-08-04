// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/retryDecisionReadAfterWrite.replicaLag.test.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { describe, expect, it } from "vitest";
import { decideCompleteAttemptV1 } from "../../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { ATTEMPT_ID, FENCE_1, NOW, RUN_ID, committedDecision, databaseTime, duration, executingAggregate } from "../support.js";

describe("retry authority translation", () => {
  it("derives retry eligibility from transaction database time", () => {
    const observed = databaseTime(NOW + 10_000);
    const current = executingAggregate({ leaseExpiresAt: databaseTime(observed + 30_000), effectCursor: 8n });
    const decision = committedDecision(decideCompleteAttemptV1(
      { type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1, completion: {
        kind: "failed", failure: { kind: "task_failure", code: "handler_failed", message: null },
        retry: { kind: "override_delay", delayMs: duration(6_000) }, executionDurationMs: null,
      } },
      { databaseNowMs: observed, current, attemptGrantCandidate: null },
    ));
    expect(decision.outcome).toMatchObject({ kind: "retry_scheduled", retry: { notBeforeMs: observed + 6_000 } });
    expect(decision.requestedEffects[2]?.effect.kind).toBe("wake_retry");
  });
});

// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/tests/cancelling.test.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { describe, expect, it } from "vitest";
import { decideRequestCancellationV1 } from "../../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import { NOW, RUN_ID, committedDecision, executingAggregate } from "../support.js";

describe("Trigger cancellation translation", () => {
  it("persists generation one and requests fenced execution cancellation", () => {
    const current = executingAggregate({ effectCursor: 11n });
    const decision = committedDecision(decideRequestCancellationV1(
      { type: "request_cancellation", runId: RUN_ID, reason: { code: "requested", message: null } },
      { databaseNowMs: NOW, current, attemptGrantCandidate: null },
    ));
    expect(decision.outcome).toMatchObject({ kind: "cancellation_requested", cancellation: { generation: 1n } });
    expect(decision.requestedEffects.map((entry) => entry.effect.kind)).toEqual([
      "request_execution_cancellation", "publish_lifecycle_event", "notify_current_state",
    ]);
  });
});

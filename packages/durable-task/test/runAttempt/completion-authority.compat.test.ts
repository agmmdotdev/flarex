// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/tests/runAttemptSystemReplicaLag.guard.test.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Brand, Result } from "effect";
import { describe, expect, it } from "vitest";
import { decideCompleteAttemptV1 } from "../../src/runAttempt/Layers/RunAttemptLifecycleLive.js";
import type { TaskFailureMessageV1 } from "../../src/runAttempt/Model.js";
import { ATTEMPT_ID, FENCE_1, NOW, RUN_ID, attemptId, committedDecision, executingAggregate } from "../support.js";

describe("completion authority translation", () => {
  it("does not let a completion for another attempt mutate current state", () => {
    const current = executingAggregate();
    const decision = Result.getOrThrow(decideCompleteAttemptV1(
      { type: "complete_attempt", runId: RUN_ID, attemptId: attemptId("attempt_00000000-0000-4000-8000-000000000002"), executionFence: FENCE_1, completion: { kind: "succeeded", result: null, executionDurationMs: null } },
      { databaseNowMs: NOW, current, attemptGrantCandidate: null },
    ));
    expect(decision).toMatchObject({ kind: "no_change", disposition: "current", outcome: { reason: "stale_attempt" } });
  });

  it("replays a failure when only its diagnostic message changes", () => {
    const firstMessage = Brand.nominal<TaskFailureMessageV1>()("first diagnostic");
    const secondMessage = Brand.nominal<TaskFailureMessageV1>()("second diagnostic");
    const current = executingAggregate({ effectCursor: 8n });
    const first = committedDecision(decideCompleteAttemptV1(
      { type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1, completion: {
        kind: "failed", failure: { kind: "system_failure", code: "configuration_invalid", message: firstMessage },
        retry: { kind: "use_bound_policy" }, executionDurationMs: null,
      } },
      { databaseNowMs: NOW, current, attemptGrantCandidate: null },
    ));
    const replay = Result.getOrThrow(decideCompleteAttemptV1(
      { type: "complete_attempt", runId: RUN_ID, attemptId: ATTEMPT_ID, executionFence: FENCE_1, completion: {
        kind: "failed", failure: { kind: "system_failure", code: "configuration_invalid", message: secondMessage },
        retry: { kind: "use_bound_policy" }, executionDurationMs: null,
      } },
      { databaseNowMs: NOW, current: first.next, attemptGrantCandidate: null },
    ));
    expect(replay).toMatchObject({ kind: "no_change", disposition: "idempotent", replay: { outcome: { kind: "terminal_failed" } } });
  });
});

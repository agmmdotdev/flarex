// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// upstream/internal-packages/run-engine/src/engine/tests/attemptFailures.test.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decideFailurePolicyV1 } from "../../src/runAttempt/Policy.js";
import type { TaskExecutionFailureV1 } from "../../src/runAttempt/Model.js";
import { NOW, duration, executingAggregate } from "../support.js";

describe("Trigger attempt-failure translation", () => {
  it.each([
    [{ kind: "task_failure", code: "handler_failed", message: null }, "retry"],
    [{ kind: "system_failure", code: "provider_failure", message: null }, "retry"],
    [{ kind: "system_failure", code: "configuration_invalid", message: null }, "terminal"],
    [{ kind: "timed_out", code: "maximum_duration_exceeded", message: null }, "terminal"],
  ] satisfies ReadonlyArray<readonly [TaskExecutionFailureV1, "retry" | "terminal"]>)(
    "classifies $0",
    (failure, expected) => {
      const current = executingAggregate();
      if (current.phase !== "executing") throw new Error("fixture invariant");
      const result = decideFailurePolicyV1({
        operation: "complete_attempt", runId: current.runId, databaseNowMs: NOW,
        boundPolicy: current.boundPolicy, currentAttempt: current.currentAttempt, failure,
        directive: { kind: "override_delay", delayMs: duration(1) }, directiveSource: "completion",
        cancellationRequested: false, leaseExpiry: false,
      });
      expect(Result.getOrThrow(result).kind).toBe(expected);
    },
  );
});

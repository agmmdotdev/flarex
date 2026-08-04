import { Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  calculateBoundRetryDelayV1,
  decideFailurePolicyV1,
  isRunAttemptExecutingV1,
  isRunAttemptFinishedOrPendingFinishedV1,
  isRunAttemptInitialV1,
  isRunAttemptPendingExecutingV1,
} from "../src/runAttempt/Policy.js";
import { COMPUTE_LARGE, COMPUTE_SMALL, NOW, POLICY, duration, executingAggregate } from "./support.js";

describe("run-attempt policy", () => {
  it("adapts Trigger execution-status predicates to the closed Flarex phases", () => {
    const executing = executingAggregate();
    expect(isRunAttemptExecutingV1(executing)).toBe(true);
    expect(isRunAttemptPendingExecutingV1(executing)).toBe(false);
    expect(isRunAttemptInitialV1(executing)).toBe(false);
    expect(isRunAttemptFinishedOrPendingFinishedV1(executing)).toBe(false);
    expect(isRunAttemptFinishedOrPendingFinishedV1(executingAggregate({ cancellation: "requested" }))).toBe(true);
  });
  it("uses stored jitter in the admitted Trigger retry formula", () => {
    const current = executingAggregate();
    if (current.phase !== "executing") throw new Error("fixture invariant");
    const result = calculateBoundRetryDelayV1({
      operation: "complete_attempt",
      runId: current.runId,
      boundPolicy: current.boundPolicy,
      currentAttempt: current.currentAttempt,
    });
    expect(Result.getOrThrow(result)).toBe(1_250);
  });

  it("forces OOM escalation onto durable delivery", () => {
    const current = executingAggregate();
    if (current.phase !== "executing") throw new Error("fixture invariant");
    const result = decideFailurePolicyV1({
      operation: "complete_attempt",
      runId: current.runId,
      databaseNowMs: NOW,
      boundPolicy: { ...current.boundPolicy, runAttempt: POLICY },
      currentAttempt: current.currentAttempt,
      failure: { kind: "resource_exhaustion", code: "out_of_memory", message: null },
      directive: { kind: "override_delay", delayMs: duration(0) },
      directiveSource: "completion",
      cancellationRequested: false,
      leaseExpiry: false,
    });
    expect(Result.getOrThrow(result)).toMatchObject({
      kind: "retry",
      delivery: "durable",
      nextComputeProfile: COMPUTE_LARGE,
      evidence: { decision: { eligibility: "oom_escalation" } },
    });
    expect(current.currentAttempt.computeProfile).toBe(COMPUTE_SMALL);
  });

  it("does not let an override make a permanent configuration failure retryable", () => {
    const current = executingAggregate();
    if (current.phase !== "executing") throw new Error("fixture invariant");
    const result = decideFailurePolicyV1({
      operation: "complete_attempt", runId: current.runId, databaseNowMs: NOW,
      boundPolicy: current.boundPolicy, currentAttempt: current.currentAttempt,
      failure: { kind: "system_failure", code: "configuration_invalid", message: null },
      directive: { kind: "override_delay", delayMs: duration(0) },
      directiveSource: "completion", cancellationRequested: false, leaseExpiry: false,
    });
    expect(Result.getOrThrow(result)).toMatchObject({
      kind: "terminal",
      evidence: { decision: { reason: "failure_not_retryable" } },
    });
  });
});

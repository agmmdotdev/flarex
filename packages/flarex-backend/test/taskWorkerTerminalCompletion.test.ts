import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
  TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
  decodeTaskWorkerSessionSettlementV1,
  type TaskWorkerSessionFailureCodeV1,
  type TaskWorkerSessionInterruptionReasonV1,
  type TaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";

import { mapTaskWorkerTerminalDisposition } from
  "../src/taskComputeDelivery/TaskWorkerTerminalCompletion";

describe("Task Worker terminal completion", () => {
  it.each([
    ["input_validation_failed", "task_failure", "input_validation_failed", "use_bound_policy"],
    ["output_validation_failed", "task_failure", "output_validation_failed", "use_bound_policy"],
    ["handler_failed", "task_failure", "handler_failed", "use_bound_policy"],
    ["runtime_input_unavailable", "system_failure", "task_binding_unavailable", "use_bound_policy"],
    ["configuration_invalid", "system_failure", "configuration_invalid", "do_not_retry"],
    ["internal_invariant", "system_failure", "internal_invariant", "do_not_retry"],
  ] as const)(
    "maps %s into the exact durable failure and retry directive",
    (runtimeCode, failureKind, durableCode, retryKind) => {
      const disposition = mapTaskWorkerTerminalDisposition(failed(runtimeCode));
      expect(disposition).toEqual({
        kind: "complete",
        completion: {
          kind: "failed",
          failure: { kind: failureKind, code: durableCode, message: null },
          retry: { kind: retryKind },
          executionDurationMs: null,
        },
      });
    },
  );

  it.each([
    ["cancellation_requested", "complete"],
    ["maximum_duration", "complete"],
    ["host_shutdown", "unconfirmed"],
  ] as const)("maps %s interruption without inventing completion", (reason, kind) => {
    const disposition = mapTaskWorkerTerminalDisposition(interrupted(reason));
    expect(disposition.kind).toBe(kind);
    if (reason === "cancellation_requested") {
      expect(disposition).toEqual({
        kind: "complete",
        completion: {
          kind: "cancellation_acknowledged",
          cancellationGeneration: 3n,
          executionDurationMs: null,
        },
      });
    } else if (reason === "maximum_duration") {
      expect(disposition).toEqual({
        kind: "complete",
        completion: {
          kind: "failed",
          failure: {
            kind: "timed_out",
            code: "maximum_duration_exceeded",
            message: null,
          },
          retry: { kind: "use_bound_policy" },
          executionDurationMs: null,
        },
      });
    }
  });

  it("keeps a completed value on the publication side of the durability boundary", () => {
    const settlement = decodedSettlement({
      kind: "completed",
      result: {
        format: "flarex.application-task-worker-result",
        version: 1,
        kind: "completed",
        identity: identity(),
        value: null,
        valueSemanticBytes: 1,
      },
    });
    const disposition = mapTaskWorkerTerminalDisposition(settlement);
    expect(disposition.kind).toBe("publish_result");
    if (disposition.kind !== "publish_result") return;
    expect(disposition.result).toBe(settlement.outcome.kind === "completed"
      ? settlement.outcome.result
      : undefined);
  });
});

function failed(code: TaskWorkerSessionFailureCodeV1): TaskWorkerSessionSettlementV1 {
  return decodedSettlement({
    kind: "failed",
    failure: { code, message: null },
  });
}

function interrupted(
  reason: TaskWorkerSessionInterruptionReasonV1,
): TaskWorkerSessionSettlementV1 {
  return decodedSettlement({
    kind: "interrupted",
    interruption: { cancellationGeneration: 3n, reason },
  });
}

function decodedSettlement(outcome: unknown): TaskWorkerSessionSettlementV1 {
  return Result.getOrThrow(decodeTaskWorkerSessionSettlementV1({
    format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
    version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
    kind: "settled",
    generation: "application_v1",
    identity: identity(),
    executionId: "execution-1",
    outcome,
  }));
}

function identity() {
  return {
    version: "flarex.task-compute-dispatch-identity.v1" as const,
    scopeId: "scope_00000000-0000-4000-8000-000000000001",
    runId: "run_00000000-0000-4000-8000-000000000002",
    requestedEffectSequence: 1n,
    attemptId: "attempt_00000000-0000-4000-8000-000000000003",
    executionFence: 1n,
  };
}

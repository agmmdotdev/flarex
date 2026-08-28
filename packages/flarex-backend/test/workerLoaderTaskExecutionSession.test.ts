import {
  TaskCancellationGenerationV1Schema,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Cause, Effect, Exit, Option, Result, Schema } from "effect";
import {
  APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
  APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/application-task-worker-v1";
import {
  LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
  LEGACY_TASK_WORKER_RESULT_VERSION_V1,
} from "flarex-protocol/internal/legacy-task-worker-v1";
import {
  TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
  TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
  TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
  decodeTaskWorkerSessionAcceptanceV1,
  decodeTaskWorkerSessionInterruptionAcceptanceV1,
  decodeTaskWorkerSessionSettlementV1,
} from "flarex-protocol/internal/task-worker-session-v1";
import { describe, expect, it } from "vitest";

import {
  type TaskWorkerSession,
  TaskWorkerSessionHostError,
} from "../src/artifactRuntime/TaskWorkerSessionHost.js";
import { TaskExecutionSessionError } from
  "../src/taskComputeDelivery/TaskExecutionSession.js";
import { adaptWorkerLoaderTaskExecutionSession } from
  "../src/taskComputeDelivery/WorkerLoaderTaskExecutionSession.js";

describe("Worker Loader Task execution session adapter", () => {
  it("projects versioned Worker values into transport-neutral session semantics", async () => {
    let interruptionRequest: unknown;
    const workerSession: TaskWorkerSession = Object.freeze({
      acceptance: acceptance(),
      maximumCloseMilliseconds: 125,
      requestInterruption: (request: unknown) => {
        interruptionRequest = request;
        return Effect.succeed(Result.getOrThrow(
          decodeTaskWorkerSessionInterruptionAcceptanceV1({
            format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
            version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
            kind: "interruption_requested",
            generation: "application_v1",
            identity: identity(),
            executionId: "task-worker-execution-1",
            cancellationGeneration: 2n,
            reason: "cancellation_requested",
          }),
        ));
      },
      settlement: Effect.succeed(completedSettlement("application_v1")),
      close: Effect.void,
    });

    const session = adaptWorkerLoaderTaskExecutionSession(workerSession);
    expect(session.maximumCloseMilliseconds).toBe(125);
    expect(session.acceptance).toEqual({
      generation: "application_v1",
      identity: identity(),
      executionId: "task-worker-execution-1",
      cancellationGeneration: 1n,
    });
    expect(session.acceptance).not.toHaveProperty("format");
    expect(session.acceptance).not.toHaveProperty("version");

    await Effect.runPromise(session.requestInterruption(Object.freeze({
      generation: "application_v1",
      identity: session.acceptance.identity,
      executionId: session.acceptance.executionId,
      cancellationGeneration: Result.getOrThrow(
        Schema.decodeUnknownResult(
          Schema.toType(TaskCancellationGenerationV1Schema),
        )(2n),
      ),
      reason: "cancellation_requested",
    })));
    expect(interruptionRequest).toEqual({
      format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
      version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
      generation: "application_v1",
      identity: identity(),
      executionId: "task-worker-execution-1",
      cancellationGeneration: 2n,
      reason: "cancellation_requested",
    });

    const observedSettlement = await Effect.runPromise(session.settlement);
    expect(observedSettlement).toEqual({
      generation: "application_v1",
      identity: identity(),
      executionId: "task-worker-execution-1",
      outcome: {
        kind: "completed",
        result: { value: null, valueSemanticBytes: 1 },
      },
    });
    expect(observedSettlement).not.toHaveProperty("format");
    expect(observedSettlement).not.toHaveProperty("version");
    if (observedSettlement.outcome.kind !== "completed") return;
    expect(observedSettlement.outcome.result).not.toHaveProperty("format");
    expect(observedSettlement.outcome.result).not.toHaveProperty("identity");
  });

  it("projects a legacy completed result without leaking its Worker envelope", async () => {
    const workerSession: TaskWorkerSession = Object.freeze({
      acceptance: acceptance("legacy_dynamic_worker_v1"),
      maximumCloseMilliseconds: 125,
      requestInterruption: () => Effect.never,
      settlement: Effect.succeed(completedSettlement(
        "legacy_dynamic_worker_v1",
      )),
      close: Effect.void,
    });

    const settlement = await Effect.runPromise(
      adaptWorkerLoaderTaskExecutionSession(workerSession).settlement,
    );

    expect(settlement).toEqual({
      generation: "legacy_dynamic_worker_v1",
      identity: identity(),
      executionId: "task-worker-execution-1",
      outcome: {
        kind: "completed",
        result: { value: null, valueSemanticBytes: 1 },
      },
    });
  });

  it("classifies Worker failures once at the adapter boundary", async () => {
    const workerFailure = new TaskWorkerSessionHostError({
      operation: "start",
      reason: "workerLoadFailed",
    });
    const workerSession: TaskWorkerSession = Object.freeze({
      acceptance: acceptance(),
      maximumCloseMilliseconds: 125,
      requestInterruption: () => Effect.fail(workerFailure),
      settlement: Effect.never,
      close: Effect.void,
    });
    const session = adaptWorkerLoaderTaskExecutionSession(workerSession);

    const exit = await Effect.runPromiseExit(session.requestInterruption({
      generation: "application_v1",
      identity: session.acceptance.identity,
      executionId: session.acceptance.executionId,
      cancellationGeneration: Result.getOrThrow(
        Schema.decodeUnknownResult(
          Schema.toType(TaskCancellationGenerationV1Schema),
        )(2n),
      ),
      reason: "cancellation_requested",
    }));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) return;
    const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
    expect(failure).toBeInstanceOf(TaskExecutionSessionError);
    expect(failure).toMatchObject({
      operation: "requestInterruption",
      reason: "providerUnavailable",
      cause: workerFailure,
    });
  });
});

function acceptance(
  generation: "application_v1" | "legacy_dynamic_worker_v1" = "application_v1",
) {
  return Result.getOrThrow(decodeTaskWorkerSessionAcceptanceV1({
    format: TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
    version: TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
    kind: "accepted",
    generation,
    identity: identity(),
    executionId: "task-worker-execution-1",
    cancellationGeneration: 1n,
  }));
}

function completedSettlement(
  generation: "application_v1" | "legacy_dynamic_worker_v1",
) {
  const result = generation === "application_v1"
    ? {
        format: APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
        version: APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
        kind: "completed" as const,
        identity: identity(),
        value: null,
        valueSemanticBytes: 1,
      }
    : {
        format: LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
        version: LEGACY_TASK_WORKER_RESULT_VERSION_V1,
        kind: "completed" as const,
        identity: identity(),
        value: null,
        valueSemanticBytes: 1,
      };
  return Result.getOrThrow(decodeTaskWorkerSessionSettlementV1({
    format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
    version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
    kind: "settled",
    generation,
    identity: identity(),
    executionId: "task-worker-execution-1",
    outcome: { kind: "completed", result },
  }));
}

function identity() {
  return Object.freeze({
    version: "flarex.task-compute-dispatch-identity.v1" as const,
    scopeId: "scope_00000000-0000-4000-8000-000000000001",
    runId: "run_00000000-0000-4000-8000-000000000001",
    requestedEffectSequence: 1n,
    attemptId: "attempt_00000000-0000-4000-8000-000000000001",
    executionFence: 1n,
  });
}

import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
  TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
  TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
  TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
  TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
  TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
  TASK_WORKER_SESSION_START_FORMAT_V1,
  TASK_WORKER_SESSION_START_VERSION_V1,
  decodeTaskWorkerSessionAcceptanceV1,
  decodeTaskWorkerSessionInterruptionAcceptanceV1,
  decodeTaskWorkerSessionInterruptionRequestV1,
  decodeTaskWorkerSessionSettlementV1,
  decodeTaskWorkerSessionStartRequestV1,
  taskWorkerSessionIdentitiesEqualV1,
} from "../src/task-worker-session-v1";
import {
  APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
  APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
  APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
} from "../src/application-task-worker-v1";
import {
  LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
  LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
  LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
  LEGACY_TASK_WORKER_RESULT_VERSION_V1,
} from "../src/legacy-task-worker-v1";

describe("Task Worker session V1", () => {
  it.each(["application_v1", "legacy_dynamic_worker_v1"] as const)(
    "decodes and owns an exact %s start request",
    generation => {
      const source = startRequest(generation);
      const decoded = decodeTaskWorkerSessionStartRequestV1(source);
      expect(Result.isSuccess(decoded)).toBe(true);
      if (Result.isFailure(decoded)) return;
      expect(decoded.success).not.toBe(source);
      expect(Object.isFrozen(decoded.success)).toBe(true);
      expect(decoded.success.generation).toBe(generation);
      if (decoded.success.generation === "application_v1") {
        const bytes = decoded.success.request.dispatch.applicationTaskRuntimeTargetSha256;
        expect(bytes).not.toBe(
          (source.request as ReturnType<typeof applicationRequest>).dispatch
            .applicationTaskRuntimeTargetSha256,
        );
      }
    },
  );

  it("rejects excess, accessor, and cross-generation start input", () => {
    expect(Result.isFailure(decodeTaskWorkerSessionStartRequestV1({
      ...startRequest("application_v1"),
      excess: true,
    }))).toBe(true);
    let reads = 0;
    const accessor = { ...startRequest("application_v1") };
    Object.defineProperty(accessor, "request", {
      enumerable: true,
      get() {
        reads += 1;
        return applicationRequest();
      },
    });
    expect(Result.isFailure(decodeTaskWorkerSessionStartRequestV1(accessor))).toBe(true);
    expect(reads).toBe(0);
    expect(Result.isFailure(decodeTaskWorkerSessionStartRequestV1({
      ...startRequest("legacy_dynamic_worker_v1"),
      generation: "application_v1",
    }))).toBe(true);
  });

  it("decodes exact correlated acceptance, interruption, and settlement envelopes", () => {
    const identity = dispatchIdentity();
    const acceptance = Result.getOrThrow(decodeTaskWorkerSessionAcceptanceV1({
      format: TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
      version: TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
      kind: "accepted",
      generation: "application_v1",
      identity,
      executionId: "execution-1",
      cancellationGeneration: 0n,
    }));
    expect(taskWorkerSessionIdentitiesEqualV1(
      acceptance.identity,
      acceptance.identity,
    )).toBe(true);
    expect(Result.isSuccess(decodeTaskWorkerSessionInterruptionRequestV1({
      format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
      version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
      generation: "application_v1",
      identity,
      executionId: "execution-1",
      cancellationGeneration: 1n,
      reason: "cancellation_requested",
    }))).toBe(true);
    expect(Result.isSuccess(decodeTaskWorkerSessionSettlementV1({
      format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
      version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
      kind: "settled",
      generation: "application_v1",
      identity,
      executionId: "execution-1",
      outcome: {
        kind: "failed",
        failure: { code: "handler_failed", message: null },
      },
    }))).toBe(true);
    expect(Result.isFailure(decodeTaskWorkerSessionInterruptionRequestV1({
      format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
      version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
      generation: "application_v1",
      identity,
      executionId: "execution-1",
      cancellationGeneration: 0n,
      reason: "cancellation_requested",
    }))).toBe(true);
  });

  it.each(["application_v1", "legacy_dynamic_worker_v1"] as const)(
    "decodes an owned, generation-correlated %s completed settlement",
    generation => {
      const identity = dispatchIdentity();
      const result = generation === "application_v1"
        ? {
            format: APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
            version: APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
            kind: "completed" as const,
            identity,
            value: null,
            valueSemanticBytes: 1,
          }
        : {
            format: LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
            version: LEGACY_TASK_WORKER_RESULT_VERSION_V1,
            kind: "completed" as const,
            identity,
            value: null,
            valueSemanticBytes: 1,
          };
      const decoded = decodeTaskWorkerSessionSettlementV1({
        format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
        version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
        kind: "settled",
        generation,
        identity,
        executionId: "execution-1",
        outcome: { kind: "completed", result },
      });
      expect(Result.isSuccess(decoded)).toBe(true);
      if (Result.isFailure(decoded)) return;
      expect(decoded.success.outcome.kind).toBe("completed");
      expect(Object.isFrozen(decoded.success.outcome)).toBe(true);
      expect(Object.isFrozen(decoded.success.identity)).toBe(true);
    },
  );

  it("rejects result identity drift and excess terminal outcome fields", () => {
    const identity = dispatchIdentity();
    const settlement = {
      format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
      version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
      kind: "settled",
      generation: "application_v1",
      identity,
      executionId: "execution-1",
      outcome: {
        kind: "completed",
        result: {
          format: APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
          version: APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
          kind: "completed",
          identity: { ...identity, executionFence: 2n },
          value: null,
          valueSemanticBytes: 1,
        },
      },
    };
    expect(Result.isFailure(decodeTaskWorkerSessionSettlementV1(settlement))).toBe(true);
    expect(Result.isFailure(decodeTaskWorkerSessionSettlementV1({
      ...settlement,
      outcome: {
        kind: "failed",
        failure: { code: "handler_failed", message: null },
        excess: true,
      },
    }))).toBe(true);
  });

  it("rejects nested terminal accessors without invoking them", () => {
    let reads = 0;
    const failureValue = { code: "handler_failed" };
    Object.defineProperty(failureValue, "message", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("terminal getter must not run");
      },
    });
    expect(Result.isFailure(decodeTaskWorkerSessionSettlementV1({
      format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
      version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
      kind: "settled",
      generation: "application_v1",
      identity: dispatchIdentity(),
      executionId: "execution-1",
      outcome: { kind: "failed", failure: failureValue },
    }))).toBe(true);
    expect(reads).toBe(0);
  });

  it("rejects nested identity accessors without invoking them", () => {
    let reads = 0;
    const identity = { ...dispatchIdentity() };
    Object.defineProperty(identity, "runId", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("identity getter must not run");
      },
    });
    const acceptance = {
        format: TASK_WORKER_SESSION_ACCEPTANCE_FORMAT_V1,
        version: TASK_WORKER_SESSION_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        generation: "application_v1",
        identity,
        executionId: "execution-1",
        cancellationGeneration: 0n,
      };
    const interruptionRequest = {
        format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
        version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
        generation: "application_v1",
        identity,
        executionId: "execution-1",
        cancellationGeneration: 1n,
        reason: "cancellation_requested",
      };
    const interruptionAcceptance = {
        format: TASK_WORKER_SESSION_INTERRUPTION_FORMAT_V1,
        version: TASK_WORKER_SESSION_INTERRUPTION_VERSION_V1,
        kind: "interruption_requested",
        generation: "application_v1",
        identity,
        executionId: "execution-1",
        cancellationGeneration: 1n,
        reason: "cancellation_requested",
      };
    const settlement = {
        format: TASK_WORKER_SESSION_SETTLEMENT_FORMAT_V1,
        version: TASK_WORKER_SESSION_SETTLEMENT_VERSION_V1,
        kind: "settled",
        generation: "application_v1",
        identity,
        executionId: "execution-1",
        outcome: {
          kind: "interrupted",
          interruption: {
            cancellationGeneration: 1n,
            reason: "cancellation_requested",
          },
        },
      };
    expect(Result.isFailure(decodeTaskWorkerSessionAcceptanceV1(acceptance))).toBe(true);
    expect(Result.isFailure(
      decodeTaskWorkerSessionInterruptionRequestV1(interruptionRequest),
    )).toBe(true);
    expect(Result.isFailure(
      decodeTaskWorkerSessionInterruptionAcceptanceV1(interruptionAcceptance),
    )).toBe(true);
    expect(Result.isFailure(decodeTaskWorkerSessionSettlementV1(settlement))).toBe(true);
    expect(reads).toBe(0);
  });
});

function startRequest(generation: "application_v1" | "legacy_dynamic_worker_v1") {
  return {
    format: TASK_WORKER_SESSION_START_FORMAT_V1,
    version: TASK_WORKER_SESSION_START_VERSION_V1,
    generation,
    executionId: "execution-1",
    request: generation === "application_v1" ? applicationRequest() : legacyRequest(),
  };
}

function applicationRequest() {
  return {
    format: APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      ...dispatch(),
      applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(7),
    },
  };
}

function legacyRequest() {
  return {
    format: LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
    version: LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      ...dispatch(),
      taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
    },
  };
}

function dispatch() {
  return {
    version: "flarex.task-compute-dispatch-request.v1" as const,
    identity: dispatchIdentity(),
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile: "standard-1x",
    cancellation: { kind: "not_requested" as const, generation: 0n },
    maximumDurationMs: 30_000,
  };
}

function dispatchIdentity() {
  return {
    version: "flarex.task-compute-dispatch-identity.v1" as const,
    scopeId: "scope_00000000-0000-4000-8000-000000000001",
    runId: "run_00000000-0000-4000-8000-000000000002",
    requestedEffectSequence: 1n,
    attemptId: "attempt_00000000-0000-4000-8000-000000000003",
    executionFence: 1n,
  };
}

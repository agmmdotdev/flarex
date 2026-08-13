import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
  LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
  LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
  LEGACY_TASK_WORKER_RESULT_VERSION_V1,
  decodeLegacyTaskWorkerRequestV1,
  decodeLegacyTaskWorkerResultV1,
} from "../src/legacy-task-worker-v1";
import { normalizeApplicationTaskWorkerValueV1 } from
  "../src/application-task-worker-v1";

describe("Legacy task Worker V1 contract", () => {
  it("decodes the exact Legacy request without accepting Application authority", () => {
    const request = workerRequest();
    const decoded = decodeLegacyTaskWorkerRequestV1(request);
    expect(Result.isSuccess(decoded)).toBe(true);
    expect(Result.isFailure(decodeLegacyTaskWorkerRequestV1({
      ...request,
      dispatch: {
        ...request.dispatch,
        applicationTaskRuntimeTargetSha256: new Uint8Array(32),
      },
    }))).toBe(true);
    expect(Result.isFailure(decodeLegacyTaskWorkerRequestV1({
      ...request,
      dispatch: {
        ...request.dispatch,
        taskDefinitionRevisionId: "task-definition-revision",
      },
    }))).toBe(true);
    expect(Result.isFailure(decodeLegacyTaskWorkerRequestV1({
      ...request,
      format: "flarex.application-task-worker-request",
    }))).toBe(true);
  });

  it("rejects accessors without invoking them and correlates result size", () => {
    let reads = 0;
    const request = workerRequest();
    const accessor = Object.defineProperty({
      format: request.format,
      version: request.version,
    }, "dispatch", {
      enumerable: true,
      get() { reads += 1; return request.dispatch; },
    });
    expect(Result.isFailure(decodeLegacyTaskWorkerRequestV1(accessor))).toBe(true);
    expect(reads).toBe(0);

    const normalized = Result.getOrThrow(
      normalizeApplicationTaskWorkerValueV1({ greeting: "hello" }, "result"),
    );
    const result = {
      format: LEGACY_TASK_WORKER_RESULT_FORMAT_V1,
      version: LEGACY_TASK_WORKER_RESULT_VERSION_V1,
      kind: "completed",
      identity: request.dispatch.identity,
      value: normalized.value,
      valueSemanticBytes: normalized.semanticSizeBytes,
    };
    expect(Result.isSuccess(decodeLegacyTaskWorkerResultV1(result))).toBe(true);
    expect(Result.isFailure(decodeLegacyTaskWorkerResultV1({
      ...result,
      valueSemanticBytes: result.valueSemanticBytes + 1,
    }))).toBe(true);
  });
});

function workerRequest() {
  return {
    format: LEGACY_TASK_WORKER_REQUEST_FORMAT_V1,
    version: LEGACY_TASK_WORKER_REQUEST_VERSION_V1,
    dispatch: {
      version: "flarex.task-compute-dispatch-request.v1",
      identity: {
        version: "flarex.task-compute-dispatch-identity.v1",
        scopeId: "scope_00000000-0000-4000-8000-000000000001",
        runId: "run_00000000-0000-4000-8000-000000000002",
        requestedEffectSequence: 1n,
        attemptId: "attempt_00000000-0000-4000-8000-000000000003",
        executionFence: 1n,
      },
      taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000004",
      attemptNumber: 1,
      leaseVersion: 1n,
      computeProfile: "standard-1x",
      cancellation: { kind: "not_requested", generation: 0n },
      maximumDurationMs: 30_000,
    },
  };
}

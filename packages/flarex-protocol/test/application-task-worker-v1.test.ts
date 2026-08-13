import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
  APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
  APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
  APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
  decodeApplicationTaskWorkerRequestV1,
  decodeApplicationTaskWorkerResultV1,
  normalizeApplicationTaskWorkerValueV1,
} from "../src/application-task-worker-v1";

describe("Application task Worker V1 contract", () => {
  it("decodes and detaches the exact dispatch request", () => {
    const request = workerRequest();
    const decoded = decodeApplicationTaskWorkerRequestV1(request);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) return;
    request.dispatch.applicationTaskRuntimeTargetSha256.fill(9);
    expect(decoded.success.dispatch.applicationTaskRuntimeTargetSha256)
      .toEqual(new Uint8Array(32).fill(7));
  });

  it("rejects accessors and decorated records without invoking getters", () => {
    let reads = 0;
    const request = workerRequest();
    const accessor = Object.defineProperty({
      format: request.format,
      version: request.version,
    }, "dispatch", {
      enumerable: true,
      get() { reads += 1; return request.dispatch; },
    });
    expect(Result.isFailure(decodeApplicationTaskWorkerRequestV1(accessor)))
      .toBe(true);
    expect(reads).toBe(0);
    expect(Result.isFailure(decodeApplicationTaskWorkerRequestV1({
      ...request,
      extra: true,
    }))).toBe(true);

    for (const nested of [
      {
        ...request,
        dispatch: Object.defineProperty({
          ...request.dispatch,
        }, "identity", {
          enumerable: true,
          get() { reads += 1; return request.dispatch.identity; },
        }),
      },
      {
        ...request,
        dispatch: Object.defineProperty({
          ...request.dispatch,
        }, "cancellation", {
          enumerable: true,
          get() { reads += 1; return request.dispatch.cancellation; },
        }),
      },
    ]) {
      expect(Result.isFailure(decodeApplicationTaskWorkerRequestV1(nested)))
        .toBe(true);
    }
    expect(reads).toBe(0);
  });

  it("correlates result semantic bytes", () => {
    const normalized = Result.getOrThrow(
      normalizeApplicationTaskWorkerValueV1({ greeting: "hello" }, "result"),
    );
    const result = {
      format: APPLICATION_TASK_WORKER_RESULT_FORMAT_V1,
      version: APPLICATION_TASK_WORKER_RESULT_VERSION_V1,
      kind: "completed",
      identity: workerRequest().dispatch.identity,
      value: normalized.value,
      valueSemanticBytes: normalized.semanticSizeBytes,
    };
    expect(Result.isSuccess(decodeApplicationTaskWorkerResultV1(result))).toBe(true);
    expect(Result.isFailure(decodeApplicationTaskWorkerResultV1({
      ...result,
      valueSemanticBytes: result.valueSemanticBytes + 1,
    }))).toBe(true);
    let reads = 0;
    const accessorIdentity = Object.defineProperty({}, "version", {
      enumerable: true,
      get() { reads += 1; return result.identity.version; },
    });
    for (const [key, value] of Object.entries(result.identity)) {
      if (key === "version") continue;
      Object.defineProperty(accessorIdentity, key, {
        enumerable: true,
        value,
      });
    }
    expect(Result.isFailure(decodeApplicationTaskWorkerResultV1({
      ...result,
      identity: accessorIdentity,
    }))).toBe(true);
    expect(reads).toBe(0);
  });

  it("rejects shadowed digest length and unbounded dispatch scalars", () => {
    const request = workerRequest();
    const shortDigest = new Uint8Array(31);
    Object.defineProperty(shortDigest, "byteLength", { value: 32 });
    expect(Result.isFailure(decodeApplicationTaskWorkerRequestV1({
      ...request,
      dispatch: {
        ...request.dispatch,
        applicationTaskRuntimeTargetSha256: shortDigest,
      },
    }))).toBe(true);
    expect(Result.isFailure(decodeApplicationTaskWorkerRequestV1({
      ...workerRequest(),
      dispatch: {
        ...workerRequest().dispatch,
        identity: {
          ...workerRequest().dispatch.identity,
          requestedEffectSequence: 9_223_372_036_854_775_808n,
        },
      },
    }))).toBe(true);
    for (const identity of [
      { ...request.dispatch.identity, runId: "run_not-a-uuid" },
      { ...request.dispatch.identity, attemptId: "attempt_not-a-uuid" },
    ]) {
      expect(Result.isFailure(decodeApplicationTaskWorkerRequestV1({
        ...request,
        dispatch: { ...request.dispatch, identity },
      }))).toBe(true);
    }
  });
});

function workerRequest() {
  return {
    format: APPLICATION_TASK_WORKER_REQUEST_FORMAT_V1,
    version: APPLICATION_TASK_WORKER_REQUEST_VERSION_V1,
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
      applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(7),
      attemptNumber: 1,
      leaseVersion: 1n,
      computeProfile: "standard-1x",
      cancellation: { kind: "not_requested", generation: 0n },
      maximumDurationMs: 30_000,
    },
  };
}

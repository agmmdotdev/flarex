import {
  TASK_RESULT_CODEC_V1,
  type ApplicationTaskRunAttemptAggregateV1,
  type ApplicationTaskSystemRunAttemptStoreShape,
  type TaskAttemptIdV1,
  type TaskAttemptNumberV1,
  type TaskCancellationGenerationV1,
  type TaskComputeProfileRefV1,
  type TaskDatabaseTimeMsV1,
  type TaskDurationMsV1,
  type TaskExecutionFenceV1,
  type TaskLeaseVersionV1,
  type TaskMaximumAttemptsV1,
  type TaskResultCommitmentV1,
  type TaskRetryFactorV1,
  type TaskRunIdV1,
  type TaskRunVersionV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type { ApplicationTaskRuntimeTargetSha256V1 } from
  "@flarex/durable-task/internal/run-creation-v1";
import { Brand, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  makeStandardApplicationTaskResultQueryLayer,
  readStandardApplicationTaskResult,
} from "../src/StandardApplicationTaskResultQuery.js";

const runId = Brand.nominal<TaskRunIdV1>()("run-standard-result-query-1");
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
const duration = Brand.nominal<TaskDurationMsV1>();
const commitment: TaskResultCommitmentV1 = Object.freeze({
  codec: TASK_RESULT_CODEC_V1,
  byteLength: 5,
  sha256: new Uint8Array(32).fill(0x73),
});

describe("StandardApplicationTaskResultQuery", () => {
  it("composes scope authorization and result loading without extra policy", async () => {
    const inspectRunAttempt = vi.fn<
      ApplicationTaskSystemRunAttemptStoreShape["inspectRunAttempt"]
    >(() => Effect.succeed({
      observedAtMs: databaseTime(2_000),
      current: terminalApplicationAggregate(),
    }));
    const value = Object.freeze({ result: "ready" });
    const read = vi.fn<
      Parameters<typeof makeStandardApplicationTaskResultQueryLayer>[0][
        "resultStore"
      ]["read"]
    >(() => Effect.succeed({
      commitment,
      objectKey: "private/result",
      value,
      canonicalBytes: new Uint8Array([1]),
      semanticSizeBytes: 1,
    }));

    const result = await Effect.runPromise(
      readStandardApplicationTaskResult(runId).pipe(Effect.provide(
        makeStandardApplicationTaskResultQueryLayer({
          runAttemptStore: { inspectRunAttempt },
          resultStore: { read },
        }),
      )),
    );

    expect(result).toBe(value);
    expect(inspectRunAttempt).toHaveBeenCalledWith({
      operation: "inspect_current_attempt",
      runId,
    });
    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      codec: commitment.codec,
      byteLength: commitment.byteLength,
    }));
  });
});

function terminalApplicationAggregate(): ApplicationTaskRunAttemptAggregateV1 {
  return {
    version: "flarex.task-run-attempt-aggregate.v1" as const,
    runId,
    applicationTaskRuntimeTargetSha256:
      Brand.nominal<ApplicationTaskRuntimeTargetSha256V1>()(
        new Uint8Array(32).fill(0x54),
      ),
    createdAtMs: databaseTime(1_000),
    runVersion: Brand.nominal<TaskRunVersionV1>()(4n),
    boundPolicy: {
      runAttempt: {
        version: 1 as const,
        retry: {
          maxAttempts: Brand.nominal<TaskMaximumAttemptsV1>()(1),
          factor: Brand.nominal<TaskRetryFactorV1>()(1),
          minTimeoutInMs: duration(0),
          maxTimeoutInMs: duration(0),
          randomize: false,
        },
        outOfMemory: { kind: "disabled" as const },
      },
      maximumDurationMs: duration(1_000),
      initialComputeProfile:
        Brand.nominal<TaskComputeProfileRefV1>()("standard-1x"),
      leaseDurationMs: duration(1_000),
      immediateRetryThresholdMs: duration(1),
    },
    attemptHistory: {
      kind: "issued" as const,
      lastAttemptNumber: Brand.nominal<TaskAttemptNumberV1>()(1),
    },
    leaseHistory: {
      kind: "issued" as const,
      lastLeaseVersion: Brand.nominal<TaskLeaseVersionV1>()(1n),
    },
    lastLifecycleAcceptance: null,
    completionReplays: Object.freeze([]),
    requestedEffectCursor: { kind: "none" as const },
    phase: "terminal" as const,
    terminal: {
      kind: "succeeded" as const,
      completedAtMs: databaseTime(2_000),
      attempt: {
        attemptId: Brand.nominal<TaskAttemptIdV1>()(
          "attempt_standard_result_query_1",
        ),
        attemptNumber: Brand.nominal<TaskAttemptNumberV1>()(1),
        executionFence: Brand.nominal<TaskExecutionFenceV1>()(1n),
      },
      result: commitment,
      executionDurationMs: null,
    },
    cancellation: {
      kind: "not_requested" as const,
      generation: Brand.nominal<TaskCancellationGenerationV1>()(0n),
    },
  };
}

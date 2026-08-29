import {
  TaskSystemRunAttemptUnavailableError,
  type ApplicationTaskRunAttemptAggregateV1,
  type ApplicationTaskSystemRunAttemptStoreShape,
  type ApplicationTaskSystemRunAttemptTransactionReceiptV1,
  type TaskCancellationGenerationV1,
  type TaskCancellationReasonV1,
  type TaskComputeProfileRefV1,
  type TaskDatabaseTimeMsV1,
  type TaskDurationMsV1,
  type TaskMaximumAttemptsV1,
  type TaskRetryFactorV1,
  type TaskRunIdV1,
  type TaskRunVersionV1,
  type TaskSystemRunAttemptStoreErrorV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import type { ApplicationTaskRuntimeTargetSha256V1 } from
  "@flarex/durable-task/internal/run-creation-v1";
import { Brand, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeStandardApplicationTaskCancellationLayer,
  requestStandardApplicationTaskCancellation,
} from "../src/StandardApplicationTaskCancellation.js";

const runId = Brand.nominal<TaskRunIdV1>()(
  "run_00000000-0000-4000-8000-000000000071",
);
const databaseTime = Brand.nominal<TaskDatabaseTimeMsV1>();
const runVersion = Brand.nominal<TaskRunVersionV1>();
const cancellationGeneration = Brand.nominal<TaskCancellationGenerationV1>();
const duration = Brand.nominal<TaskDurationMsV1>();
const reason: TaskCancellationReasonV1 = Object.freeze({
  code: "requested",
  message: null,
});

describe("StandardApplicationTaskCancellation", () => {
  it("submits one exact lifecycle command and preserves its receipt", async () => {
    const recording = makeRecordingApplicationStore();

    const receipt = await Effect.runPromise(
      requestStandardApplicationTaskCancellation(runId, reason).pipe(
        Effect.provide(
          makeStandardApplicationTaskCancellationLayer(recording.store),
        ),
      ),
    );

    expect(recording.transactionCount()).toBe(1);
    expect(recording.lastOperation()).toEqual({
      operation: "request_cancellation",
      runId,
    });
    expect(receipt).toBe(recording.lastReceipt());
    expect(receipt.disposition).toBe("accepted");
    expect(receipt.outcome.kind).toBe("terminal_cancelled");
    if (receipt.outcome.kind === "terminal_cancelled") {
      expect(receipt.outcome.terminal.reason).toStrictEqual(reason);
    }
  });

  it("preserves a scope-store failure by identity without retry", async () => {
    const failure = new TaskSystemRunAttemptUnavailableError({
      operation: "request_cancellation",
      runId,
      reason: "unavailable",
    });
    const recording = makeRecordingApplicationStore(failure);

    const result = await Effect.runPromise(Effect.result(
      requestStandardApplicationTaskCancellation(runId, reason).pipe(
        Effect.provide(
          makeStandardApplicationTaskCancellationLayer(recording.store),
        ),
      ),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) expect(result.failure).toBe(failure);
    expect(recording.transactionCount()).toBe(1);
    expect(recording.lastReceipt()).toBeUndefined();
  });

  it("keeps equal run ids isolated by the captured Application store", async () => {
    const first = makeRecordingApplicationStore();
    const second = makeRecordingApplicationStore();
    const request = (store: ApplicationTaskSystemRunAttemptStoreShape) =>
      Effect.runPromise(
        requestStandardApplicationTaskCancellation(runId, reason).pipe(
          Effect.provide(makeStandardApplicationTaskCancellationLayer(store)),
        ),
      );

    await request(first.store);
    expect(first.transactionCount()).toBe(1);
    expect(second.transactionCount()).toBe(0);

    await request(second.store);
    expect(first.transactionCount()).toBe(1);
    expect(second.transactionCount()).toBe(1);
  });
});

function makeRecordingApplicationStore(
  failure?: TaskSystemRunAttemptStoreErrorV1,
) {
  let current = readyApplicationAggregate();
  let transactionCount = 0;
  let lastOperation:
    | { readonly operation: "request_cancellation"; readonly runId: TaskRunIdV1 }
    | undefined;
  let lastReceipt: unknown;

  const transactRunAttempt: ApplicationTaskSystemRunAttemptStoreShape[
    "transactRunAttempt"
  ] = request => {
    transactionCount += 1;
    if (request.operation === "request_cancellation") {
      lastOperation = { operation: request.operation, runId: request.runId };
    }
    if (failure !== undefined) return Effect.fail(failure);

    return Effect.gen(function* () {
      const decision = yield* Effect.fromResult(request.decide({
        databaseNowMs: databaseTime(2_000),
        current,
        attemptGrantCandidate: null,
      }));
      if (decision.kind !== "commit") {
        return yield* Effect.die("expected cancellation to commit");
      }
      current = decision.next;
      const receipt: ApplicationTaskSystemRunAttemptTransactionReceiptV1<
        typeof decision.outcome
      > = {
        disposition: "accepted",
        observedAtMs: databaseTime(2_000),
        runVersion: decision.next.runVersion,
        outcome: decision.outcome,
        evidence: decision.evidence,
        requestedEffects: decision.requestedEffects,
      };
      lastReceipt = receipt;
      return receipt;
    });
  };

  return {
    store: {
      transactRunAttempt,
      inspectRunAttempt: () => Effect.die("inspection is not admitted"),
    } satisfies ApplicationTaskSystemRunAttemptStoreShape,
    transactionCount: () => transactionCount,
    lastOperation: () => lastOperation,
    lastReceipt: () => lastReceipt,
  };
}

function readyApplicationAggregate(): ApplicationTaskRunAttemptAggregateV1 {
  return {
    version: "flarex.task-run-attempt-aggregate.v1",
    runId,
    applicationTaskRuntimeTargetSha256:
      Brand.nominal<ApplicationTaskRuntimeTargetSha256V1>()(
        new Uint8Array(32).fill(0x54),
      ),
    createdAtMs: databaseTime(1_000),
    runVersion: runVersion(1n),
    boundPolicy: {
      runAttempt: {
        version: 1,
        retry: {
          maxAttempts: Brand.nominal<TaskMaximumAttemptsV1>()(1),
          factor: Brand.nominal<TaskRetryFactorV1>()(1),
          minTimeoutInMs: duration(0),
          maxTimeoutInMs: duration(0),
          randomize: false,
        },
        outOfMemory: { kind: "disabled" },
      },
      maximumDurationMs: duration(1_000),
      initialComputeProfile:
        Brand.nominal<TaskComputeProfileRefV1>()("standard-1x"),
      leaseDurationMs: duration(1_000),
      immediateRetryThresholdMs: duration(1),
    },
    attemptHistory: { kind: "none" },
    leaseHistory: { kind: "none" },
    lastLifecycleAcceptance: null,
    completionReplays: Object.freeze([]),
    requestedEffectCursor: { kind: "none" },
    phase: "ready",
    ready: { kind: "initial", eligibleAtMs: databaseTime(1_000) },
    cancellation: {
      kind: "not_requested",
      generation: cancellationGeneration(0n),
    },
  };
}

import { Brand, Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";

import {
  fromCurrentTaskRunAttemptAggregate,
  toCurrentTaskRunAttemptAggregate,
} from "../src/runAttempt/DefinitionReference.js";
import {
  TaskSystemRunAttemptCorruptionError,
  TaskSystemRunAttemptStaleScopeAuthorityError,
  TaskSystemRunAttemptTerminalStoreError,
  TaskSystemRunAttemptTransientStoreError,
  TaskSystemRunAttemptUnavailableError,
} from "../src/runAttempt/Errors.js";
import {
  TASK_RESULT_CODEC_V1,
  type ApplicationTaskRunAttemptAggregateV1,
  type ApplicationTaskSystemRunAttemptInspectionSnapshotV1,
  type TaskFailureMessageV1,
  type TaskRunAttemptAggregateV1,
} from "../src/runAttempt/Model.js";
import type { ApplicationTaskSystemRunAttemptStoreShape } from
  "../src/runAttempt/Services/TaskSystemRunAttemptStore.js";
import {
  makeTaskRunResultQueryLayer,
  TaskRunResultQuery,
} from "../src/runResult/index.js";
import {
  ATTEMPT_ID,
  ATTEMPT_NUMBER_1,
  COMPUTE_SMALL,
  FENCE_1,
  LEASE_VERSION_1,
  NOW,
  RUN_ID,
  activeAggregate,
  aggregateBase,
  cancellationGeneration,
  databaseTime,
  readyAggregate,
  runVersion,
} from "./support.js";

type InspectionStore = Pick<
  ApplicationTaskSystemRunAttemptStoreShape,
  "inspectRunAttempt"
>;

const failureMessage = Brand.nominal<TaskFailureMessageV1>();

describe("TaskRunResultQuery", () => {
  it("authorizes exactly one scope-qualified committed result with owned bytes", async () => {
    const digest = new Uint8Array(32).fill(0x72);
    const expectedCommitment = {
      codec: TASK_RESULT_CODEC_V1,
      byteLength: 42,
      sha256: digest,
    } as const;
    const snapshot = applicationSnapshot(terminalAggregate({
      kind: "succeeded",
      completedAtMs: NOW,
      attempt: terminalAttempt(),
      result: expectedCommitment,
      executionDurationMs: null,
    }));
    const inspectRunAttempt = vi.fn<InspectionStore["inspectRunAttempt"]>(
      () => Effect.succeed(snapshot),
    );
    const commitment = await authorizeWith({ inspectRunAttempt });

    expect(inspectRunAttempt).toHaveBeenCalledOnce();
    expect(inspectRunAttempt).toHaveBeenCalledWith({
      operation: "inspect_current_attempt",
      runId: RUN_ID,
    });
    expect(commitment).toEqual(expectedCommitment);
    expect(Object.isFrozen(commitment)).toBe(true);
    expect(commitment.sha256).not.toBe(digest);
    digest.fill(0xff);
    expect(commitment.sha256).toEqual(new Uint8Array(32).fill(0x72));
  });

  it.each([
    ["ready", readyAggregate(), "run_incomplete"],
    ["attempt_granted", activeAggregate({ phase: "attempt_granted" }),
      "run_incomplete"],
    ["executing", activeAggregate({ phase: "executing" }), "run_incomplete"],
    ["retry_waiting", retryWaitingAggregate(), "run_incomplete"],
    ["failed", terminalAggregate({
      kind: "failed",
      completedAtMs: NOW,
      attempt: terminalAttempt(),
      classification: "task_failure",
      failure: {
        kind: "task_failure",
        code: "handler_failed",
        message: failureMessage("private failure"),
      },
      executionDurationMs: null,
    }), "run_not_succeeded"],
    ["cancelled", cancelledAggregate(), "run_not_succeeded"],
    ["result absent", terminalAggregate({
      kind: "succeeded",
      completedAtMs: NOW,
      attempt: terminalAttempt(),
      result: null,
      executionDurationMs: null,
    }), "result_absent"],
  ] as const)("rejects %s state", async (_label, aggregate, reason) => {
    const result = await Effect.runPromise(Effect.result(authorizeWithEffect({
      inspectRunAttempt: () => Effect.succeed(applicationSnapshot(aggregate)),
    })));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "TaskRunResultUnavailableError",
        runId: RUN_ID,
        reason,
      });
    }
  });

  it("propagates every inspection failure by identity without retrying", async () => {
    const failures = [
      new TaskSystemRunAttemptUnavailableError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        reason: "unavailable",
      }),
      new TaskSystemRunAttemptCorruptionError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        reason: "aggregate_invalid",
      }),
      new TaskSystemRunAttemptStaleScopeAuthorityError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        authority: "epoch",
      }),
      new TaskSystemRunAttemptTransientStoreError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        reason: "timeout",
        cause: new Error("timed out"),
      }),
      new TaskSystemRunAttemptTerminalStoreError({
        operation: "inspect_current_attempt",
        runId: RUN_ID,
        reason: "unsupported_integration",
        cause: null,
      }),
    ] as const;

    for (const expected of failures) {
      const inspectRunAttempt = vi.fn<InspectionStore["inspectRunAttempt"]>(
        () => Effect.fail(expected),
      );
      const result = await Effect.runPromise(Effect.result(
        authorizeWithEffect({ inspectRunAttempt }),
      ));
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure).toBe(expected);
      expect(inspectRunAttempt).toHaveBeenCalledOnce();
    }
  });
});

function authorizeWith(store: InspectionStore) {
  return Effect.runPromise(authorizeWithEffect(store));
}

function authorizeWithEffect(store: InspectionStore) {
  return Effect.gen(function* () {
    const query = yield* TaskRunResultQuery;
    return yield* query.authorizeRead(RUN_ID);
  }).pipe(Effect.provide(makeTaskRunResultQueryLayer(store)));
}

function applicationSnapshot(
  aggregate: TaskRunAttemptAggregateV1,
): ApplicationTaskSystemRunAttemptInspectionSnapshotV1 {
  return Object.freeze({
    observedAtMs: NOW,
    current: toApplicationAggregate(aggregate),
  });
}

function terminalAggregate(
  terminal: Extract<
    TaskRunAttemptAggregateV1,
    { readonly phase: "terminal" }
  >["terminal"],
): TaskRunAttemptAggregateV1 {
  return {
    ...aggregateBase(runVersion(4n), {
      attemptNo: ATTEMPT_NUMBER_1,
      lease: LEASE_VERSION_1,
    }),
    phase: "terminal",
    terminal,
    cancellation: {
      kind: "not_requested",
      generation: cancellationGeneration(0n),
    },
  } as TaskRunAttemptAggregateV1;
}

function retryWaitingAggregate(): TaskRunAttemptAggregateV1 {
  return {
    ...aggregateBase(runVersion(3n), {
      attemptNo: ATTEMPT_NUMBER_1,
      lease: LEASE_VERSION_1,
    }),
    phase: "retry_waiting",
    retry: {
      previousAttempt: terminalAttempt(),
      acceptedAtMs: NOW,
      notBeforeMs: databaseTime(NOW + 1_000),
      nextComputeProfile: COMPUTE_SMALL,
      cause: {
        kind: "failed_completion",
        failure: {
          kind: "task_failure",
          code: "handler_failed",
          message: failureMessage("private retry failure"),
        },
      },
    },
    cancellation: {
      kind: "not_requested",
      generation: cancellationGeneration(0n),
    },
  };
}

function cancelledAggregate(): TaskRunAttemptAggregateV1 {
  const cancellation = {
    kind: "resolved" as const,
    generation: cancellationGeneration(1n),
    reason: { code: "requested" as const, message: null },
    requestedAtMs: NOW,
    resolvedAtMs: NOW,
    resolution: "without_active_attempt" as const,
  };
  return {
    ...aggregateBase(runVersion(4n)),
    phase: "terminal",
    terminal: {
      kind: "cancelled",
      completedAtMs: NOW,
      attempt: null,
      cancellationGeneration: cancellation.generation,
      reason: cancellation.reason,
      resolution: cancellation.resolution,
      executionDurationMs: null,
    },
    cancellation,
  };
}

function terminalAttempt() {
  return {
    attemptId: ATTEMPT_ID,
    attemptNumber: ATTEMPT_NUMBER_1,
    executionFence: FENCE_1,
  };
}

function toApplicationAggregate(
  aggregate: TaskRunAttemptAggregateV1,
): ApplicationTaskRunAttemptAggregateV1 {
  const current = toCurrentTaskRunAttemptAggregate({
    generation: "legacy_definition_v1",
    aggregate,
  });
  const persisted = Result.getOrThrow(fromCurrentTaskRunAttemptAggregate(
    replaceDefinitionReferences(current) as Parameters<
      typeof fromCurrentTaskRunAttemptAggregate
    >[0],
    "application_v1",
  ));
  if (persisted.generation !== "application_v1") {
    throw new Error("Expected Application aggregate.");
  }
  return persisted.aggregate;
}

function replaceDefinitionReferences(value: unknown): unknown {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (Array.isArray(value)) return value.map(replaceDefinitionReferences);
  if (value === null || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, unknown>>;
  const entries = Object.entries(record)
    .filter(([key]) => key !== "definitionReference")
    .map(([key, child]) => [key, replaceDefinitionReferences(child)]);
  if (!("definitionReference" in record)) return Object.fromEntries(entries);
  return {
    ...Object.fromEntries(entries),
    definitionReference: {
      generation: "application_v1",
      applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(0x52),
    },
  };
}

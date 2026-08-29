import { Brand, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  fromCurrentTaskRunAttemptAggregate,
  toCurrentTaskRunAttemptAggregate,
} from "../src/runAttempt/DefinitionReference.js";
import {
  TASK_RESULT_CODEC_V1,
  type ApplicationTaskRunAttemptAggregateV1,
  type TaskCancellationMessageV1,
  type TaskExecutionDurationMsV1,
  type TaskFailureMessageV1,
  type TaskRunAttemptAggregateV1,
} from "../src/runAttempt/Model.js";
import {
  decodeTaskRunListStoreItem,
  projectTaskRun,
  type TaskRunProjection,
} from "../src/runProjection/index.js";
import {
  ATTEMPT_ID,
  ATTEMPT_NUMBER_1,
  COMPUTE_LARGE,
  COMPUTE_SMALL,
  FENCE_1,
  LEASE_VERSION_1,
  NOW,
  RUN_VERSION_2,
  activeAggregate,
  aggregateBase,
  cancellationGeneration,
  databaseTime,
  duration,
  readyAggregate,
  runVersion,
} from "./support.js";

const RUNTIME_TARGET = new Uint8Array(32).fill(0x71);
const OBSERVED_AT = databaseTime(NOW + 10_000);
const COMPLETED_AT = databaseTime(NOW + 5_000);
const cancellationMessage = Brand.nominal<TaskCancellationMessageV1>();
const executionDuration = Brand.nominal<TaskExecutionDurationMsV1>();
const failureMessage = Brand.nominal<TaskFailureMessageV1>();
const CANCELLATION_REASON = {
  code: "policy_cancelled" as const,
  message: cancellationMessage("private cancellation diagnostic"),
};

describe("Task run projection", () => {
  it("projects every non-terminal phase without lifecycle command authority", () => {
    const ready = project(readyAggregate());
    expect(ready.state).toEqual({
      kind: "ready",
      eligibleAtMs: NOW,
      retry: null,
      cancellation: { kind: "not_requested" },
    });

    const granted = project(activeAggregate({ phase: "attempt_granted" }));
    expect(granted.state).toEqual({
      kind: "attempt_granted",
      attempt: {
        attemptNumber: ATTEMPT_NUMBER_1,
        computeProfile: COMPUTE_SMALL,
        grantedAtMs: NOW,
        leaseExpiresAtMs: databaseTime(NOW + 30_000),
      },
      cancellation: { kind: "not_requested" },
    });

    const executingAggregate = activeAggregate({
      phase: "executing",
      cancellation: "requested",
    });
    if (
      executingAggregate.phase !== "executing" ||
      executingAggregate.cancellation.kind !== "requested"
    ) {
      throw new Error("Expected executing aggregate.");
    }
    const executing = project({
      ...executingAggregate,
      cancellation: {
        ...executingAggregate.cancellation,
        reason: CANCELLATION_REASON,
      },
    });
    expect(executing.state).toEqual({
      kind: "executing",
      attempt: {
        attemptNumber: ATTEMPT_NUMBER_1,
        computeProfile: COMPUTE_SMALL,
        grantedAtMs: NOW,
        leaseExpiresAtMs: databaseTime(NOW + 30_000),
      },
      cancellation: {
        kind: "requested",
        code: "policy_cancelled",
        requestedAtMs: NOW,
      },
    });

    const retryWaitingSource = retryWaitingAggregate();
    const retryWaiting = project(retryWaitingSource);
    expect(retryWaiting.state).toEqual({
      kind: "retry_waiting",
      retry: {
        previousAttemptNumber: ATTEMPT_NUMBER_1,
        acceptedAtMs: NOW,
        eligibleAtMs: databaseTime(NOW + 1_000),
        nextComputeProfile: COMPUTE_LARGE,
        cause: {
          kind: "failed_completion",
          failure: { kind: "task_failure", code: "handler_failed" },
        },
      },
      cancellation: { kind: "not_requested" },
    });

    const retry = retryWaitingSource.phase === "retry_waiting"
      ? retryWaitingSource.retry
      : null;
    if (retry === null) throw new Error("Expected retry-waiting aggregate.");
    const immediateRetry = project({
      ...aggregateBase(runVersion(4n), {
        attemptNo: ATTEMPT_NUMBER_1,
        lease: LEASE_VERSION_1,
      }),
      phase: "ready",
      ready: {
        kind: "immediate_retry",
        eligibleAtMs: retry.notBeforeMs,
        acceptedRetry: retry,
      },
      cancellation: {
        kind: "not_requested",
        generation: cancellationGeneration(0n),
      },
    });
    expect(immediateRetry.state).toEqual({
      kind: "ready",
      eligibleAtMs: databaseTime(NOW + 1_000),
      retry: retryWaiting.state.kind === "retry_waiting"
        ? retryWaiting.state.retry
        : null,
      cancellation: { kind: "not_requested" },
    });

    for (const projection of [
      ready,
      granted,
      executing,
      retryWaiting,
      immediateRetry,
    ]) {
      expect(hasOwnKeyDeep(projection, "applicationTaskRuntimeTargetSha256"))
        .toBe(false);
      expect(hasOwnKeyDeep(projection, "attemptId")).toBe(false);
      expect(hasOwnKeyDeep(projection, "executionFence")).toBe(false);
      expect(hasOwnKeyDeep(projection, "heartbeat")).toBe(false);
      expect(hasOwnKeyDeep(projection, "message")).toBe(false);
      expectFrozenRecords(projection);
    }
  });

  it("projects success commitment metadata without retaining result bytes or body", () => {
    const digest = Uint8Array.from({ length: 32 }, (_, index) => index);
    const projection = project(terminalAggregate({
      terminal: {
        kind: "succeeded",
        completedAtMs: COMPLETED_AT,
        attempt: terminalAttempt(),
        result: {
          codec: TASK_RESULT_CODEC_V1,
          byteLength: 123,
          sha256: digest,
        },
        executionDurationMs: executionDuration(2_500),
      },
      cancellation: { kind: "not_requested", generation: cancellationGeneration(0n) },
    }));

    expect(projection.state).toEqual({
      kind: "succeeded",
      completedAtMs: COMPLETED_AT,
      attemptNumber: ATTEMPT_NUMBER_1,
      executionDurationMs: executionDuration(2_500),
      result: {
        codec: TASK_RESULT_CODEC_V1,
        byteLength: 123,
        sha256Hex: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
      },
      cancellation: { kind: "not_requested" },
    });
    digest.fill(0xff);
    if (projection.state.kind !== "succeeded" || projection.state.result === null) {
      throw new Error("Expected successful result metadata.");
    }
    expect(projection.state.result.sha256Hex).toBe(
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    );
    expect(hasOwnKeyDeep(projection, "sha256")).toBe(false);
    expect(hasOwnKeyDeep(projection, "body")).toBe(false);
    expectFrozenRecords(projection);
  });

  it("redacts terminal failure and superseded-cancellation diagnostics", () => {
    const projection = project(terminalAggregate({
      terminal: {
        kind: "failed",
        completedAtMs: COMPLETED_AT,
        attempt: terminalAttempt(),
        classification: "system_failure",
        failure: {
          kind: "system_failure",
          code: "provider_failure",
          message: failureMessage("private provider diagnostic"),
        },
        executionDurationMs: null,
      },
      cancellation: {
        kind: "resolved",
        generation: cancellationGeneration(1n),
        reason: CANCELLATION_REASON,
        requestedAtMs: NOW,
        resolvedAtMs: COMPLETED_AT,
        resolution: "superseded_by_completion",
      },
    }));

    expect(projection.state).toEqual({
      kind: "failed",
      completedAtMs: COMPLETED_AT,
      attemptNumber: ATTEMPT_NUMBER_1,
      executionDurationMs: null,
      failure: { kind: "system_failure", code: "provider_failure" },
      cancellation: {
        kind: "resolved",
        code: "policy_cancelled",
        requestedAtMs: NOW,
        resolvedAtMs: COMPLETED_AT,
        resolution: "superseded_by_completion",
      },
    });
    expect(hasOwnKeyDeep(projection, "message")).toBe(false);
    expectFrozenRecords(projection);
  });

  it.each([
    ["without_active_attempt", null, null],
    ["acknowledged", ATTEMPT_NUMBER_1, executionDuration(750)],
    ["lease_expired", ATTEMPT_NUMBER_1, null],
  ] as const)(
    "projects %s terminal cancellation with its exact correlation",
    (resolution, expectedAttemptNumber, expectedDuration) => {
      const projection = project(cancelledAggregate(resolution));
      expect(projection.state).toEqual({
        kind: "cancelled",
        completedAtMs: COMPLETED_AT,
        attemptNumber: expectedAttemptNumber,
        executionDurationMs: expectedDuration,
        cancellation: {
          kind: "resolved",
          code: "policy_cancelled",
          requestedAtMs: NOW,
          resolvedAtMs: COMPLETED_AT,
          resolution,
        },
      });
      expect(hasOwnKeyDeep(projection, "generation")).toBe(false);
      expect(hasOwnKeyDeep(projection, "message")).toBe(false);
      expectFrozenRecords(projection);
    },
  );

  it("returns an unversioned owned point projection", () => {
    const projection = project(readyAggregate(RUN_VERSION_2));
    expect(projection).toMatchObject({
      runId: readyAggregate().runId,
      createdAtMs: NOW,
      observedAtMs: OBSERVED_AT,
      runVersion: RUN_VERSION_2,
    });
    expect(projection).not.toHaveProperty("version");
    expectTypeOf(projection).toEqualTypeOf<TaskRunProjection>();
    expectFrozenRecords(projection);
  });
});

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
      nextComputeProfile: COMPUTE_LARGE,
      cause: {
        kind: "failed_completion",
        failure: {
          kind: "task_failure",
          code: "handler_failed",
          message: failureMessage("private retry diagnostic"),
        },
      },
    },
    cancellation: { kind: "not_requested", generation: cancellationGeneration(0n) },
  };
}

function terminalAggregate(
  terminalState: Pick<
    Extract<TaskRunAttemptAggregateV1, { readonly phase: "terminal" }>,
    "terminal" | "cancellation"
  >,
): TaskRunAttemptAggregateV1 {
  return {
    ...aggregateBase(runVersion(4n), {
      attemptNo: ATTEMPT_NUMBER_1,
      lease: LEASE_VERSION_1,
    }),
    phase: "terminal",
    ...terminalState,
  } as TaskRunAttemptAggregateV1;
}

function cancelledAggregate(
  resolution: "without_active_attempt" | "acknowledged" | "lease_expired",
): TaskRunAttemptAggregateV1 {
  const cancellation = {
    kind: "resolved" as const,
    generation: cancellationGeneration(1n),
    reason: CANCELLATION_REASON,
    requestedAtMs: NOW,
    resolvedAtMs: COMPLETED_AT,
    resolution,
  };
  switch (resolution) {
    case "without_active_attempt":
      return terminalAggregate({
        terminal: {
          kind: "cancelled",
          completedAtMs: COMPLETED_AT,
          attempt: null,
          cancellationGeneration: cancellation.generation,
          reason: CANCELLATION_REASON,
          resolution,
          executionDurationMs: null,
        },
        cancellation: { ...cancellation, resolution },
      });
    case "acknowledged":
      return terminalAggregate({
        terminal: {
          kind: "cancelled",
          completedAtMs: COMPLETED_AT,
          attempt: terminalAttempt(),
          cancellationGeneration: cancellation.generation,
          reason: CANCELLATION_REASON,
          resolution,
          executionDurationMs: executionDuration(750),
        },
        cancellation: { ...cancellation, resolution },
      });
    case "lease_expired":
      return terminalAggregate({
        terminal: {
          kind: "cancelled",
          completedAtMs: COMPLETED_AT,
          attempt: terminalAttempt(),
          cancellationGeneration: cancellation.generation,
          reason: CANCELLATION_REASON,
          resolution,
          executionDurationMs: null,
        },
        cancellation: { ...cancellation, resolution },
      });
  }
}

function terminalAttempt() {
  return {
    attemptId: ATTEMPT_ID,
    attemptNumber: ATTEMPT_NUMBER_1,
    executionFence: FENCE_1,
  };
}

function project(aggregate: TaskRunAttemptAggregateV1): TaskRunProjection {
  const projection = projectTaskRun({
    observedAtMs: OBSERVED_AT,
    current: toApplicationAggregate(aggregate),
  });
  const listItem = {
    runId: projection.runId,
    createdAtMs: projection.createdAtMs,
    runVersion: projection.runVersion,
    state: projection.state,
  };
  expect(Result.getOrThrow(decodeTaskRunListStoreItem(listItem)))
    .toEqual(listItem);
  return projection;
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
      applicationTaskRuntimeTargetSha256: new Uint8Array(RUNTIME_TARGET),
    },
  };
}

function hasOwnKeyDeep(value: unknown, key: string): boolean {
  if (value === null || typeof value !== "object") return false;
  if (Object.hasOwn(value, key)) return true;
  return Object.values(value).some((child) => hasOwnKeyDeep(child, key));
}

function expectFrozenRecords(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectFrozenRecords(child);
}

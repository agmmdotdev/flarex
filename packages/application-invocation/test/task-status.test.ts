import type { StandardApplicationTaskRunStatus } from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import { Brand } from "effect";
import { describe, expect, it } from "vitest";

import { projectTaskRunStatus } from "../src/TaskStatus.js";

type StandardState = StandardApplicationTaskRunStatus["state"];
type StandardFailure = Extract<
  StandardState,
  { readonly kind: "failed" }
>["failure"];

const runId = Brand.nominal<StandardApplicationTaskRunStatus["runId"]>();
const databaseTime = Brand.nominal<
  StandardApplicationTaskRunStatus["createdAtMs"]
>();
const runVersion = Brand.nominal<
  StandardApplicationTaskRunStatus["runVersion"]
>();
const attemptNumber = Brand.nominal<
  Extract<StandardState, { readonly kind: "attempt_granted" }>["attempt"][
    "attemptNumber"
  ]
>();
const computeProfile = Brand.nominal<
  Extract<StandardState, { readonly kind: "attempt_granted" }>["attempt"][
    "computeProfile"
  ]
>();
const executionDuration = Brand.nominal<
  NonNullable<
    Extract<StandardState, { readonly kind: "failed" }>["executionDurationMs"]
  >
>();

const RUN_ID = runId("run_00000000-0000-4000-8000-000000000091");
const ATTEMPT_1 = attemptNumber(1);
const ATTEMPT = Object.freeze({
  attemptNumber: ATTEMPT_1,
  computeProfile: computeProfile("standard-1x"),
  grantedAtMs: databaseTime(1_100),
  leaseExpiresAtMs: databaseTime(2_100),
});

describe("clean Task-run status projection", () => {
  it("renames active and retry lifecycle vocabulary and owns every nested value", () => {
    const activeSource = makeStatus({
      kind: "attempt_granted",
      attempt: ATTEMPT,
      cancellation: {
        kind: "requested",
        code: "policy_cancelled",
        requestedAtMs: databaseTime(1_200),
      },
    });
    const active = projectTaskRunStatus(activeSource);

    expect(active.state).toEqual({
      kind: "attemptGranted",
      attempt: {
        attemptNumber: 1,
        computeProfile: "standard-1x",
        grantedAtMs: 1_100,
        leaseExpiresAtMs: 2_100,
      },
      cancellation: {
        kind: "requested",
        code: "policyCancelled",
        requestedAtMs: 1_200,
      },
    });
    expect(active.state).not.toBe(activeSource.state);
    if (active.state.kind !== "attemptGranted") {
      throw new Error("Expected an attempt-granted projection.");
    }
    expect(active.state.attempt).not.toBe(ATTEMPT);
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(active.state)).toBe(true);
    expect(Object.isFrozen(active.state.attempt)).toBe(true);
    expect(Object.isFrozen(active.state.cancellation)).toBe(true);

    const retry = projectTaskRunStatus(makeStatus({
      kind: "retry_waiting",
      retry: {
        previousAttemptNumber: ATTEMPT_1,
        acceptedAtMs: databaseTime(1_300),
        eligibleAtMs: databaseTime(1_500),
        nextComputeProfile: computeProfile("large-1x"),
        cause: {
          kind: "lease_expired_after_heartbeat",
          failure: {
            kind: "resource_exhaustion",
            code: "possible_out_of_memory",
          },
        },
      },
      cancellation: { kind: "not_requested" },
    }));

    expect(retry.state).toEqual({
      kind: "retryWaiting",
      retry: {
        previousAttemptNumber: 1,
        acceptedAtMs: 1_300,
        eligibleAtMs: 1_500,
        nextComputeProfile: "large-1x",
        cause: {
          kind: "leaseExpiredAfterHeartbeat",
          failure: {
            kind: "resourceExhaustion",
            code: "possibleOutOfMemory",
          },
        },
      },
      cancellation: { kind: "notRequested" },
    });
    if (retry.state.kind !== "retryWaiting") {
      throw new Error("Expected a retry-waiting projection.");
    }
    expect(Object.isFrozen(retry.state.retry)).toBe(true);
    expect(Object.isFrozen(retry.state.retry.cause)).toBe(true);
    expect(Object.isFrozen(retry.state.retry.cause.failure)).toBe(true);
  });

  it("hides the internal result codec and maps completion cancellation", () => {
    const source = makeStatus({
      kind: "succeeded",
      completedAtMs: databaseTime(2_000),
      attemptNumber: ATTEMPT_1,
      executionDurationMs: executionDuration(900),
      result: {
        codec: "flarex.task-result.v1",
        byteLength: 42,
        sha256Hex: "ab".repeat(32),
      },
      cancellation: {
        kind: "resolved",
        code: "execution_cancelled",
        requestedAtMs: databaseTime(1_800),
        resolvedAtMs: databaseTime(2_000),
        resolution: "superseded_by_completion",
      },
    });

    const projected = projectTaskRunStatus(source);

    expect(projected.state).toEqual({
      kind: "succeeded",
      completedAtMs: 2_000,
      attemptNumber: 1,
      executionDurationMs: 900,
      result: { byteLength: 42, sha256Hex: "ab".repeat(32) },
      cancellation: {
        kind: "resolved",
        code: "executionCancelled",
        requestedAtMs: 1_800,
        resolvedAtMs: 2_000,
        resolution: "supersededByCompletion",
      },
    });
    if (projected.state.kind !== "succeeded") {
      throw new Error("Expected a succeeded projection.");
    }
    expect(projected.state.result).not.toHaveProperty("codec");
    expect(Object.isFrozen(projected.state.result)).toBe(true);
    expect(Object.isFrozen(projected.state.cancellation)).toBe(true);
  });

  it.each([
    ["failed_completion", "failedCompletion"],
    ["lease_expired_before_heartbeat", "leaseExpiredBeforeHeartbeat"],
    ["lease_expired_after_heartbeat", "leaseExpiredAfterHeartbeat"],
  ] as const)("maps retry cause %s", (kind, expected) => {
    const projected = projectTaskRunStatus(makeStatus({
      kind: "retry_waiting",
      retry: {
        previousAttemptNumber: ATTEMPT_1,
        acceptedAtMs: databaseTime(1_300),
        eligibleAtMs: databaseTime(1_500),
        nextComputeProfile: computeProfile("large-1x"),
        cause: {
          kind,
          failure: { kind: "task_failure", code: "handler_failed" },
        },
      },
      cancellation: { kind: "not_requested" },
    }));

    expect(projected.state).toMatchObject({
      kind: "retryWaiting",
      retry: { cause: { kind: expected } },
    });
  });

  it.each([
    [{ kind: "task_failure", code: "uncaught_exception" },
      { kind: "taskFailure", code: "uncaughtException" }],
    [{ kind: "task_failure", code: "input_validation_failed" },
      { kind: "taskFailure", code: "inputValidationFailed" }],
    [{ kind: "task_failure", code: "output_validation_failed" },
      { kind: "taskFailure", code: "outputValidationFailed" }],
    [{ kind: "task_failure", code: "middleware_failed" },
      { kind: "taskFailure", code: "middlewareFailed" }],
    [{ kind: "task_failure", code: "handler_failed" },
      { kind: "taskFailure", code: "handlerFailed" }],
    [{ kind: "system_failure", code: "attempt_dispatch_failed" },
      { kind: "systemFailure", code: "attemptDispatchFailed" }],
    [{ kind: "system_failure", code: "runtime_start_failed" },
      { kind: "systemFailure", code: "runtimeStartFailed" }],
    [{ kind: "system_failure", code: "execution_lost" },
      { kind: "systemFailure", code: "executionLost" }],
    [{ kind: "system_failure", code: "execution_aborted" },
      { kind: "systemFailure", code: "executionAborted" }],
    [{ kind: "system_failure", code: "provider_evicted" },
      { kind: "systemFailure", code: "providerEvicted" }],
    [{ kind: "system_failure", code: "provider_failure" },
      { kind: "systemFailure", code: "providerFailure" }],
    [{ kind: "system_failure", code: "task_binding_unavailable" },
      { kind: "systemFailure", code: "taskBindingUnavailable" }],
    [{ kind: "system_failure", code: "configuration_invalid" },
      { kind: "systemFailure", code: "configurationInvalid" }],
    [{ kind: "system_failure", code: "internal_invariant" },
      { kind: "systemFailure", code: "internalInvariant" }],
    [{ kind: "resource_exhaustion", code: "out_of_memory" },
      { kind: "resourceExhaustion", code: "outOfMemory" }],
    [{ kind: "resource_exhaustion", code: "possible_out_of_memory" },
      { kind: "resourceExhaustion", code: "possibleOutOfMemory" }],
    [{ kind: "resource_exhaustion", code: "process_crashed" },
      { kind: "resourceExhaustion", code: "processCrashed" }],
    [{ kind: "resource_exhaustion", code: "disk_exhausted" },
      { kind: "resourceExhaustion", code: "diskExhausted" }],
    [{ kind: "timed_out", code: "maximum_duration_exceeded" },
      { kind: "timedOut", code: "maximumDurationExceeded" }],
  ] satisfies readonly (readonly [StandardFailure, {
    readonly kind: string;
    readonly code: string;
  }])[])("maps failure %o", (failure, expected) => {
    const projected = projectTaskRunStatus(makeStatus({
      kind: "failed",
      completedAtMs: databaseTime(2_000),
      attemptNumber: ATTEMPT_1,
      executionDurationMs: null,
      failure,
      cancellation: { kind: "not_requested" },
    }));

    expect(projected.state).toMatchObject({
      kind: "failed",
      failure: expected,
      cancellation: { kind: "notRequested" },
    });
  });

  it.each([
    ["without_active_attempt", "withoutActiveAttempt", null, null],
    ["acknowledged", "acknowledged", ATTEMPT_1, executionDuration(700)],
    ["lease_expired", "leaseExpired", ATTEMPT_1, null],
  ] as const)(
    "maps the %s cancellation resolution",
    (resolution, expectedResolution, sourceAttempt, sourceDuration) => {
      const state: StandardState = resolution === "without_active_attempt"
        ? {
          kind: "cancelled",
          completedAtMs: databaseTime(2_000),
          attemptNumber: null,
          executionDurationMs: null,
          cancellation: {
            kind: "resolved",
            code: "requested",
            requestedAtMs: databaseTime(1_800),
            resolvedAtMs: databaseTime(2_000),
            resolution,
          },
        }
        : resolution === "acknowledged"
        ? {
          kind: "cancelled",
          completedAtMs: databaseTime(2_000),
          attemptNumber: sourceAttempt,
          executionDurationMs: sourceDuration,
          cancellation: {
            kind: "resolved",
            code: "requested",
            requestedAtMs: databaseTime(1_800),
            resolvedAtMs: databaseTime(2_000),
            resolution,
          },
        }
        : {
          kind: "cancelled",
          completedAtMs: databaseTime(2_000),
          attemptNumber: sourceAttempt,
          executionDurationMs: null,
          cancellation: {
            kind: "resolved",
            code: "requested",
            requestedAtMs: databaseTime(1_800),
            resolvedAtMs: databaseTime(2_000),
            resolution,
          },
        };

      const projected = projectTaskRunStatus(makeStatus(state));

      expect(projected.state).toMatchObject({
        kind: "cancelled",
        cancellation: {
          kind: "resolved",
          resolution: expectedResolution,
        },
      });
    },
  );
});

function makeStatus(
  state: StandardState,
): StandardApplicationTaskRunStatus {
  return Object.freeze({
    runId: RUN_ID,
    createdAtMs: databaseTime(1_000),
    observedAtMs: databaseTime(2_100),
    runVersion: runVersion(3n),
    state: Object.freeze(state),
  });
}

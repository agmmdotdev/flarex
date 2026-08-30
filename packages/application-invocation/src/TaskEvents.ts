import {
  StandardApplicationTaskEventHistoryQuery,
  type StandardApplicationTaskEventHistory,
  type StandardApplicationTaskEventHistoryQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-read-query";
import { Effect } from "effect";

import { inspectTaskRunRef, type TaskRunRef } from "./TaskRunRef.js";
import {
  projectTaskCancellationCode,
  projectTaskRunFailure,
  projectTaskRunId,
  type TaskCancellationCode,
  type TaskRunFailure,
  type TaskRunId,
} from "./TaskStatus.js";

export type TaskLifecycleEvent =
  | {
      readonly kind: "attemptGranted";
      readonly attemptNumber: number;
    }
  | {
      readonly kind: "executionObserved";
      readonly attemptNumber: number;
    }
  | {
      readonly kind: "cancellationRequested";
      readonly attemptNumber: number;
      readonly generation: bigint;
      readonly reasonCode: TaskCancellationCode;
    }
  | {
      readonly kind: "retryScheduled";
      readonly previousAttemptNumber: number;
      readonly retry:
        | {
            readonly source: "failedCompletion";
            readonly delivery: "immediate" | "durable";
          }
        | {
            readonly source: "leaseExpiry";
            readonly delivery: "durable";
          };
      readonly notBeforeMs: number;
    }
  | {
      readonly kind: "runSucceeded";
      readonly attemptNumber: number;
      readonly hasResult: boolean;
    }
  | {
      readonly kind: "runCancelled";
      readonly generation: bigint;
      readonly reasonCode: TaskCancellationCode;
      readonly cancellation:
        | {
            readonly attemptNumber: null;
            readonly resolution: "withoutActiveAttempt";
          }
        | {
            readonly attemptNumber: number;
            readonly resolution: "acknowledged" | "leaseExpired";
          };
    }
  | {
      readonly kind: "runFailed";
      readonly attemptNumber: number | null;
      readonly failure: TaskRunFailure;
    };

export interface TaskEvent {
  readonly sequence: bigint;
  readonly recordedRunVersion: bigint;
  readonly observedAtMs: number;
  readonly event: TaskLifecycleEvent;
}

export interface TaskEventHistory {
  readonly runId: TaskRunId;
  readonly observedAtMs: number;
  readonly runVersion: bigint;
  readonly events: readonly TaskEvent[];
}

export type ListTaskEventsError = StandardApplicationTaskEventHistoryQueryError;

/** Lists the durable lifecycle events recorded for one issued Task-run ref. */
export const listTaskEvents = Effect.fn("Application.listTaskEvents")(
  function* (
    reference: TaskRunRef,
  ): Effect.fn.Return<
    TaskEventHistory,
    ListTaskEventsError,
    StandardApplicationTaskEventHistoryQuery
  > {
    const referenceState = inspectTaskRunRef(reference);
    if (referenceState === undefined) {
      throw new TypeError("Task run metadata is unavailable.");
    }
    const history = yield* StandardApplicationTaskEventHistoryQuery;
    if (history.scope !== referenceState.query) {
      throw new TypeError("Task run metadata is unavailable.");
    }
    const result = yield* history.list(referenceState.runId);
    return projectTaskEventHistory(result);
  },
);

type StandardTaskLifecycleEvent =
  StandardApplicationTaskEventHistory["events"][number]["event"];

export function projectTaskEventHistory(
  history: StandardApplicationTaskEventHistory,
): TaskEventHistory {
  const events = Object.freeze(history.events.map(entry => Object.freeze({
    sequence: entry.sequence,
    recordedRunVersion: entry.recordedRunVersion,
    observedAtMs: entry.observedAtMs,
    event: projectTaskLifecycleEvent(entry.event),
  })));
  return Object.freeze({
    runId: projectTaskRunId(history.runId),
    observedAtMs: history.observedAtMs,
    runVersion: history.runVersion,
    events,
  });
}

function projectTaskLifecycleEvent(
  event: StandardTaskLifecycleEvent,
): TaskLifecycleEvent {
  switch (event.kind) {
    case "attempt_granted":
      return Object.freeze({
        kind: "attemptGranted",
        attemptNumber: event.attemptNumber,
      });
    case "execution_observed":
      return Object.freeze({
        kind: "executionObserved",
        attemptNumber: event.attemptNumber,
      });
    case "cancellation_requested":
      return Object.freeze({
        kind: "cancellationRequested",
        attemptNumber: event.attemptNumber,
        generation: event.generation,
        reasonCode: projectTaskCancellationCode(event.reasonCode),
      });
    case "retry_scheduled":
      return Object.freeze({
        kind: "retryScheduled",
        previousAttemptNumber: event.previousAttemptNumber,
        retry: projectTaskEventRetry(event.retry),
        notBeforeMs: event.notBeforeMs,
      });
    case "run_succeeded":
      return Object.freeze({
        kind: "runSucceeded",
        attemptNumber: event.attemptNumber,
        hasResult: event.hasResult,
      });
    case "run_cancelled":
      return Object.freeze({
        kind: "runCancelled",
        generation: event.generation,
        reasonCode: projectTaskCancellationCode(event.reasonCode),
        cancellation: projectTaskEventCancellation(event.cancellation),
      });
    case "run_failed":
      return Object.freeze({
        kind: "runFailed",
        attemptNumber: event.attemptNumber,
        failure: projectTaskRunFailure(event.failure),
      });
    default: {
      const unhandledEvent: never = event;
      throw new TypeError(
        `Unhandled Task lifecycle event: ${String(unhandledEvent)}`,
      );
    }
  }
}

function projectTaskEventRetry(
  retry: Extract<
    StandardTaskLifecycleEvent,
    { readonly kind: "retry_scheduled" }
  >["retry"],
): Extract<
  TaskLifecycleEvent,
  { readonly kind: "retryScheduled" }
>["retry"] {
  switch (retry.source) {
    case "failed_completion":
      return Object.freeze({
        source: "failedCompletion",
        delivery: retry.delivery,
      });
    case "lease_expiry":
      return Object.freeze({
        source: "leaseExpiry",
        delivery: "durable",
      });
    default: {
      const unhandledRetry: never = retry;
      throw new TypeError(
        `Unhandled Task event retry: ${String(unhandledRetry)}`,
      );
    }
  }
}

function projectTaskEventCancellation(
  cancellation: Extract<
    StandardTaskLifecycleEvent,
    { readonly kind: "run_cancelled" }
  >["cancellation"],
): Extract<
  TaskLifecycleEvent,
  { readonly kind: "runCancelled" }
>["cancellation"] {
  switch (cancellation.resolution) {
    case "without_active_attempt":
      return Object.freeze({
        attemptNumber: null,
        resolution: "withoutActiveAttempt",
      });
    case "acknowledged":
      return Object.freeze({
        attemptNumber: cancellation.attemptNumber,
        resolution: "acknowledged",
      });
    case "lease_expired":
      return Object.freeze({
        attemptNumber: cancellation.attemptNumber,
        resolution: "leaseExpired",
      });
    default: {
      const unhandledCancellation: never = cancellation;
      throw new TypeError(
        `Unhandled Task event cancellation: ${String(unhandledCancellation)}`,
      );
    }
  }
}

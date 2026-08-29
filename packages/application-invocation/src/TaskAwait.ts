import {
  StandardApplicationTaskRunQuery,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import {
  StandardApplicationTaskResultQuery,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-result-query";
import { Data, Duration, Effect, Option, Result } from "effect";

import {
  inspectTask,
  inspectTaskRun,
  type InspectTaskError,
  readTaskResult,
  type ReadTaskResultError,
  type TaskRun,
  type TaskRunStatus,
} from "./Task.js";

const DEFAULT_TASK_POLL_INTERVAL = Duration.millis(250);
const MAX_TASK_AWAIT_TIMER_MILLISECONDS = 2 ** 31 - 1;

type TaskRunFailedState = Extract<
  TaskRunStatus["state"],
  { readonly kind: "failed" }
>;
type TaskRunCancelledState = Extract<
  TaskRunStatus["state"],
  { readonly kind: "cancelled" }
>;

export interface AwaitTaskOptions {
  readonly timeout: Duration.Input;
  readonly pollInterval?: Duration.Input;
}

class TaskAwaitOptionsFailure extends Data.TaggedError(
  "TaskAwaitOptionsError",
)<{
  readonly field: "timeout" | "pollInterval";
  readonly reason:
    | "invalid_duration"
    | "not_finite"
    | "not_positive"
    | "outside_timer_range";
}> {}

class TaskAwaitTimeoutFailure extends Data.TaggedError(
  "TaskAwaitTimeoutError",
)<{
  readonly runId: TaskRun<unknown>["runId"];
  readonly timeout: Duration.Duration;
  readonly lastStatus: TaskRunStatus | null;
}> {}

class TaskRunFailedFailure extends Data.TaggedError(
  "TaskRunFailedError",
)<{
  readonly runId: TaskRun<unknown>["runId"];
  readonly observedAtMs: TaskRunStatus["observedAtMs"];
  readonly runVersion: TaskRunStatus["runVersion"];
  readonly state: TaskRunFailedState;
}> {}

class TaskRunCancelledFailure extends Data.TaggedError(
  "TaskRunCancelledError",
)<{
  readonly runId: TaskRun<unknown>["runId"];
  readonly observedAtMs: TaskRunStatus["observedAtMs"];
  readonly runVersion: TaskRunStatus["runVersion"];
  readonly state: TaskRunCancelledState;
}> {}

export type TaskAwaitOptionsError = TaskAwaitOptionsFailure;
export type TaskAwaitTimeoutError = TaskAwaitTimeoutFailure;
export type TaskRunFailedError = TaskRunFailedFailure;
export type TaskRunCancelledError = TaskRunCancelledFailure;

export type AwaitTaskError =
  | TaskAwaitOptionsError
  | TaskAwaitTimeoutError
  | TaskRunFailedError
  | TaskRunCancelledError
  | InspectTaskError
  | ReadTaskResultError;

interface NormalizedAwaitTaskOptions {
  readonly timeout: Duration.Duration;
  readonly pollInterval: Duration.Duration;
}

/** Waits for one opaque durable run and returns its validated output. */
export const awaitTask = Effect.fn("Application.awaitTask")(function* <Output>(
  run: TaskRun<Output>,
  options: AwaitTaskOptions,
): Effect.fn.Return<
  Output,
  AwaitTaskError,
  StandardApplicationTaskRunQuery | StandardApplicationTaskResultQuery
> {
  inspectTaskRun(run);
  const policy = yield* Effect.fromResult(normalizeAwaitTaskOptions(options));
  let lastStatus: TaskRunStatus | null = null;

  const wait = Effect.gen(function* () {
    while (true) {
      const status = yield* inspectTask(run);
      lastStatus = status;
      switch (status.state.kind) {
        case "succeeded":
          return yield* readTaskResult(run);
        case "failed":
          return yield* new TaskRunFailedFailure({
            runId: status.runId,
            observedAtMs: status.observedAtMs,
            runVersion: status.runVersion,
            state: status.state,
          });
        case "cancelled":
          return yield* new TaskRunCancelledFailure({
            runId: status.runId,
            observedAtMs: status.observedAtMs,
            runVersion: status.runVersion,
            state: status.state,
          });
        case "ready":
        case "attempt_granted":
        case "executing":
        case "retry_waiting":
          yield* Effect.sleep(policy.pollInterval);
          break;
        default: {
          const unhandledState: never = status.state;
          return yield* Effect.die(unhandledState);
        }
      }
    }
  });

  return yield* wait.pipe(Effect.timeoutOrElse({
    duration: policy.timeout,
    orElse: () => Effect.fail(new TaskAwaitTimeoutFailure({
      runId: run.runId,
      timeout: policy.timeout,
      lastStatus,
    })),
  }));
});

function normalizeAwaitTaskOptions(
  options: AwaitTaskOptions,
): Result.Result<NormalizedAwaitTaskOptions, TaskAwaitOptionsError> {
  return Result.gen(function* () {
    const timeout = yield* normalizePositiveFiniteDuration(
      "timeout",
      options.timeout,
    );
    const pollInterval = options.pollInterval === undefined
      ? DEFAULT_TASK_POLL_INTERVAL
      : yield* normalizePositiveFiniteDuration(
        "pollInterval",
        options.pollInterval,
      );
    return Object.freeze({ timeout, pollInterval });
  });
}

function normalizePositiveFiniteDuration(
  field: TaskAwaitOptionsError["field"],
  input: Duration.Input,
): Result.Result<Duration.Duration, TaskAwaitOptionsError> {
  return Option.match(Duration.fromInput(input), {
    onNone: () => Result.fail(new TaskAwaitOptionsFailure({
      field,
      reason: "invalid_duration",
    })),
    onSome: (duration) => {
      if (!Duration.isFinite(duration)) {
        return Result.fail(new TaskAwaitOptionsFailure({
          field,
          reason: "not_finite",
        }));
      }
      if (!Duration.isPositive(duration)) {
        return Result.fail(new TaskAwaitOptionsFailure({
          field,
          reason: "not_positive",
        }));
      }
      const milliseconds = Duration.toMillis(duration);
      if (
        milliseconds < 1 ||
        milliseconds > MAX_TASK_AWAIT_TIMER_MILLISECONDS
      ) {
        return Result.fail(new TaskAwaitOptionsFailure({
          field,
          reason: "outside_timer_range",
        }));
      }
      return Result.succeed(duration);
    },
  });
}

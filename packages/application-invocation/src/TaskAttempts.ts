import {
  StandardApplicationTaskAttemptHistoryQuery,
  type StandardApplicationTaskAttemptHistory,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-read-query";
import { Effect } from "effect";

import {
  projectListTaskAttemptsError,
  type TaskReadError,
} from "./TaskReadError.js";
import {
  inspectTaskRunRef,
  type TaskRunRef,
} from "./TaskRunRef.js";
import {
  projectTaskRunId,
  type TaskRunId,
} from "./TaskStatus.js";

export interface TaskAttempt {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly admittedRunVersion: bigint;
}

export interface TaskAttemptHistory {
  readonly runId: TaskRunId;
  readonly observedAtMs: number;
  readonly runVersion: bigint;
  readonly attempts: readonly TaskAttempt[];
}

export type ListTaskAttemptsError =
  TaskReadError<"listTaskAttempts">;

/** Lists immutable attempt admissions for one issued read-only Task-run ref. */
export const listTaskAttempts = Effect.fn("Application.listTaskAttempts")(
  function* (
    reference: TaskRunRef,
  ): Effect.fn.Return<
    TaskAttemptHistory,
    ListTaskAttemptsError,
    StandardApplicationTaskAttemptHistoryQuery
  > {
    const referenceState = inspectTaskRunRef(reference);
    if (referenceState === undefined) {
      throw new TypeError("Task run metadata is unavailable.");
    }
    const history = yield* StandardApplicationTaskAttemptHistoryQuery;
    if (history.scope !== referenceState.query) {
      throw new TypeError("Task run metadata is unavailable.");
    }
    const result = yield* history.list(referenceState.runId).pipe(
      Effect.mapError(error =>
        projectListTaskAttemptsError(referenceState.runId, error)
      ),
    );
    return projectTaskAttemptHistory(result);
  },
);

function projectTaskAttemptHistory(
  history: StandardApplicationTaskAttemptHistory,
): TaskAttemptHistory {
  const attempts = Object.freeze(history.attempts.map(attempt => Object.freeze({
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    admittedRunVersion: attempt.admittedRunVersion,
  })));
  return Object.freeze({
    runId: projectTaskRunId(history.runId),
    observedAtMs: history.observedAtMs,
    runVersion: history.runVersion,
    attempts,
  });
}

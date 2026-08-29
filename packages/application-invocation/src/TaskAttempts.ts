import {
  StandardApplicationTaskAttemptHistoryQuery,
  type StandardApplicationTaskAttemptHistory,
  type StandardApplicationTaskAttemptHistoryQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-attempt-history-query";
import { Effect } from "effect";

import {
  inspectTaskRunRef,
  type TaskRunRef,
} from "./TaskRunRef.js";

export type TaskAttempt =
  StandardApplicationTaskAttemptHistory["attempts"][number];
export type TaskAttemptHistory = StandardApplicationTaskAttemptHistory;
export type ListTaskAttemptsError =
  StandardApplicationTaskAttemptHistoryQueryError;

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
    return yield* history.list(referenceState.runId);
  },
);

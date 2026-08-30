import {
  StandardApplicationTaskEventHistoryQuery,
  type StandardApplicationTaskEventHistory,
  type StandardApplicationTaskEventHistoryQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-read-query";
import { Effect } from "effect";

import { inspectTaskRunRef, type TaskRunRef } from "./TaskRunRef.js";

export type TaskEvent = StandardApplicationTaskEventHistory["events"][number];
export type TaskEventHistory = StandardApplicationTaskEventHistory;
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
    return yield* history.list(referenceState.runId);
  },
);

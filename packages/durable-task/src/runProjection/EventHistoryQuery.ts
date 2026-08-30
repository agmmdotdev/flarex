import { Context, Data, Effect, Layer, Result } from "effect";

import type { TaskLifecycleEventProjectionV1 } from
  "../runAttempt/Model.js";
import {
  decodeTaskDatabaseTimeMsV1,
} from "../runAttempt/Schema.js";
import { decodeTaskAttemptHistoryRunVersion } from
  "./AttemptHistorySchema.js";
import {
  MAX_TASK_EVENT_HISTORY_ENTRIES,
  type ApplicationTaskEventHistoryStoreShape,
  type TaskEventHistory,
  type TaskEventHistoryEntry,
  type TaskEventHistoryStoreError,
  type TaskEventHistoryStoreItem,
  type TaskEventHistoryStoreSnapshot,
} from "./EventHistoryModel.js";
import { decodeTaskEventHistoryStoreItem } from "./EventHistorySchema.js";

class TaskEventHistoryStoreContractFailure extends Data.TaggedError(
  "TaskEventHistoryStoreContractError",
)<{
  readonly reason:
    | "snapshot_invalid"
    | "observation_invalid"
    | "run_version_invalid"
    | "too_many_events"
    | "event_invalid"
    | "event_order_invalid"
    | "recorded_version_not_advanced"
    | "recorded_version_exceeds_run";
}> {}

export type TaskEventHistoryStoreContractError =
  TaskEventHistoryStoreContractFailure;
export type TaskEventHistoryQueryError =
  | TaskEventHistoryStoreContractError
  | TaskEventHistoryStoreError;

export interface TaskEventHistoryQueryApi {
  readonly list: (
    runId: TaskEventHistory["runId"],
  ) => Effect.Effect<TaskEventHistory, TaskEventHistoryQueryError>;
}

/** One current Application scope's bounded durable lifecycle timeline. */
export class TaskEventHistoryQuery extends Context.Service<
  TaskEventHistoryQuery,
  TaskEventHistoryQueryApi
>()("flarex/durable-task/TaskEventHistoryQuery") {}

export function makeTaskEventHistoryQueryLayer(
  store: ApplicationTaskEventHistoryStoreShape,
): Layer.Layer<TaskEventHistoryQuery> {
  const listEvents = store.listEvents;
  const list: TaskEventHistoryQueryApi["list"] = Effect.fn(
    "TaskEventHistoryQuery.list",
  )(function* (runId) {
    const snapshot = yield* listEvents(runId);
    return yield* Effect.fromResult(projectEventHistory(runId, snapshot));
  });
  return Layer.succeed(TaskEventHistoryQuery, TaskEventHistoryQuery.of({ list }));
}

function projectEventHistory(
  runId: TaskEventHistory["runId"],
  snapshot: TaskEventHistoryStoreSnapshot,
): Result.Result<TaskEventHistory, TaskEventHistoryStoreContractError> {
  const eventsInput = snapshot.events;
  return Result.gen(function* () {
    if (!Array.isArray(eventsInput)) {
      return yield* contractFailure("snapshot_invalid");
    }
    const observedAtMs = yield* decodeTaskDatabaseTimeMsV1(
      snapshot.observedAtMs,
    ).pipe(Result.mapError(() => contractError("observation_invalid")));
    const runVersion = yield* decodeTaskAttemptHistoryRunVersion(
      snapshot.runVersion,
    ).pipe(Result.mapError(() => contractError("run_version_invalid")));
    if (eventsInput.length > MAX_TASK_EVENT_HISTORY_ENTRIES) {
      return yield* contractFailure("too_many_events");
    }

    const events: TaskEventHistoryEntry[] = [];
    let previousSequence = 0n;
    let previousRunVersion = 0n;
    for (const input of eventsInput) {
      const decoded = yield* decodeStoreItem(input);
      if (decoded.sequence <= previousSequence) {
        return yield* contractFailure("event_order_invalid");
      }
      if (decoded.acceptedRunVersion <= previousRunVersion) {
        return yield* contractFailure("recorded_version_not_advanced");
      }
      if (decoded.acceptedRunVersion > runVersion) {
        return yield* contractFailure("recorded_version_exceeds_run");
      }
      previousSequence = decoded.sequence;
      previousRunVersion = decoded.acceptedRunVersion;
      events.push(Object.freeze({
        sequence: decoded.sequence,
        recordedRunVersion: decoded.acceptedRunVersion,
        observedAtMs: decoded.observedAtMs,
        event: freezeEvent(decoded.event),
      }));
    }
    return Object.freeze({
      runId,
      observedAtMs,
      runVersion,
      events: Object.freeze(events),
    });
  });
}

function decodeStoreItem(
  input: TaskEventHistoryStoreItem | undefined,
): Result.Result<TaskEventHistoryStoreItem, TaskEventHistoryStoreContractError> {
  return decodeTaskEventHistoryStoreItem(input).pipe(
    Result.mapError(() => contractError("event_invalid")),
  );
}

function freezeEvent(
  event: TaskLifecycleEventProjectionV1,
): TaskLifecycleEventProjectionV1 {
  switch (event.kind) {
    case "retry_scheduled":
      return Object.freeze({ ...event, retry: Object.freeze({ ...event.retry }) });
    case "run_cancelled":
      return Object.freeze({
        ...event,
        cancellation: Object.freeze({ ...event.cancellation }),
      });
    case "run_failed":
      return Object.freeze({ ...event, failure: Object.freeze({ ...event.failure }) });
    case "attempt_granted":
    case "execution_observed":
    case "cancellation_requested":
    case "run_succeeded":
      return Object.freeze({ ...event });
  }
}

function contractFailure(
  reason: TaskEventHistoryStoreContractError["reason"],
): Result.Result<never, TaskEventHistoryStoreContractError> {
  return Result.fail(contractError(reason));
}

function contractError(
  reason: TaskEventHistoryStoreContractError["reason"],
): TaskEventHistoryStoreContractError {
  return new TaskEventHistoryStoreContractFailure({ reason });
}

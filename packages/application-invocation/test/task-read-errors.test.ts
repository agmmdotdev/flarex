import type {
  StandardApplicationTaskAttemptHistoryQueryError,
  StandardApplicationTaskEventHistoryQueryError,
  StandardApplicationTaskRunListQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-read-query";
import type {
  StandardApplicationTaskRunQueryApi,
  StandardApplicationTaskRunQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import { Brand, Data } from "effect";
import { describe, expect, it } from "vitest";

import {
  projectInspectTaskError,
  projectListTaskAttemptsError,
  projectListTaskEventsError,
  projectListTaskRunsError,
  type TaskReadErrorReason,
} from "../src/TaskReadError.js";

type InternalRunId = Parameters<
  StandardApplicationTaskRunQueryApi["inspect"]
>[0];
const runId = Brand.nominal<InternalRunId>()(
  "run_00000000-0000-4000-8000-0000000000f1",
);

class InspectionUnavailableFailure extends Data.TaggedError(
  "TaskSystemRunAttemptUnavailableError",
)<{
  readonly operation: "inspect_current_attempt";
  readonly runId: InternalRunId;
  readonly reason: "unavailable";
}> {}

class InspectionCorruptionFailure extends Data.TaggedError(
  "TaskSystemRunAttemptCorruptionError",
)<{
  readonly operation: "inspect_current_attempt";
  readonly runId: InternalRunId;
  readonly reason: "aggregate_invalid";
}> {}

class InspectionStaleScopeFailure extends Data.TaggedError(
  "TaskSystemRunAttemptStaleScopeAuthorityError",
)<{
  readonly operation: "inspect_current_attempt";
  readonly runId: InternalRunId;
  readonly authority: "epoch";
}> {}

class InspectionTransientFailure extends Data.TaggedError(
  "TaskSystemRunAttemptTransientStoreError",
)<{
  readonly operation: "inspect_current_attempt";
  readonly runId: InternalRunId;
  readonly reason: "timeout";
  readonly cause: unknown;
}> {}

class InspectionTerminalFailure extends Data.TaggedError(
  "TaskSystemRunAttemptTerminalStoreError",
)<{
  readonly operation: "inspect_current_attempt";
  readonly runId: InternalRunId;
  readonly reason: "wrong_placement";
  readonly cause: unknown | null;
}> {}

class RunListStoreFailure extends Data.TaggedError(
  "TaskRunListStoreError",
)<{
  readonly operation: "list_task_runs";
  readonly reason:
    | "unavailable"
    | "corrupt_data"
    | "stale_scope_authority"
    | "transient"
    | "unsupported";
  readonly cause: unknown;
}> {}

class RunListContractFailure extends Data.TaggedError(
  "TaskRunListStoreContractError",
)<{
  readonly reason: "item_invalid";
}> {}

class AttemptHistoryStoreFailure extends Data.TaggedError(
  "TaskAttemptHistoryStoreError",
)<{
  readonly operation: "list_task_attempts";
  readonly runId: InternalRunId;
  readonly reason: HistoryStoreReason;
  readonly cause: unknown;
}> {}

class AttemptHistoryContractFailure extends Data.TaggedError(
  "TaskAttemptHistoryStoreContractError",
)<{
  readonly reason: "attempt_invalid";
}> {}

class EventHistoryStoreFailure extends Data.TaggedError(
  "TaskEventHistoryStoreError",
)<{
  readonly operation: "list_task_events";
  readonly runId: InternalRunId;
  readonly reason: HistoryStoreReason;
  readonly cause: unknown;
}> {}

class EventHistoryContractFailure extends Data.TaggedError(
  "TaskEventHistoryStoreContractError",
)<{
  readonly reason: "event_invalid";
}> {}

type HistoryStoreReason =
  | "run_not_found"
  | "unavailable"
  | "corrupt_data"
  | "stale_scope_authority"
  | "transient"
  | "unsupported";

const storeReasonCases = [
  ["unavailable", "unavailable"],
  ["corrupt_data", "corruptData"],
  ["stale_scope_authority", "staleScopeAuthority"],
  ["transient", "transient"],
  ["unsupported", "unsupported"],
] as const satisfies readonly (readonly [
  RunListStoreFailure["reason"],
  TaskReadErrorReason,
])[];

const historyReasonCases = [
  ["run_not_found", "runNotFound"],
  ...storeReasonCases,
] as const satisfies readonly (readonly [
  HistoryStoreReason,
  TaskReadErrorReason,
])[];

describe("clean Task read-error projection", () => {
  it.each([
    [new InspectionUnavailableFailure({
      operation: "inspect_current_attempt",
      runId,
      reason: "unavailable",
    }), "unavailable"],
    [new InspectionCorruptionFailure({
      operation: "inspect_current_attempt",
      runId,
      reason: "aggregate_invalid",
    }), "corruptData"],
    [new InspectionStaleScopeFailure({
      operation: "inspect_current_attempt",
      runId,
      authority: "epoch",
    }), "staleScopeAuthority"],
    [new InspectionTransientFailure({
      operation: "inspect_current_attempt",
      runId,
      reason: "timeout",
      cause: null,
    }), "transient"],
    [new InspectionTerminalFailure({
      operation: "inspect_current_attempt",
      runId,
      reason: "wrong_placement",
      cause: null,
    }), "terminal"],
  ] as const satisfies readonly (readonly [
    StandardApplicationTaskRunQueryError,
    TaskReadErrorReason,
  ])[])("maps inspection $0._tag", (source, reason) => {
    const projected = projectInspectTaskError(source);
    expect(projected).toMatchObject({
      _tag: "TaskReadError",
      operation: "inspectTask",
      runId,
      reason,
      cause: source,
    });
    expect(projected.cause).toBe(source);
  });

  it.each(storeReasonCases)(
    "maps run-list store reason %s",
    (sourceReason, reason) => {
      const source: StandardApplicationTaskRunListQueryError =
        new RunListStoreFailure({
          operation: "list_task_runs",
          reason: sourceReason,
          cause: null,
        });
      const projected = projectListTaskRunsError(source);
      expect(projected).toMatchObject({
        _tag: "TaskReadError",
        operation: "listTaskRuns",
        runId: null,
        reason,
        cause: source,
      });
      expect(projected.cause).toBe(source);
    },
  );

  it("maps run-list contract failures to corrupt data", () => {
    const source: StandardApplicationTaskRunListQueryError =
      new RunListContractFailure({ reason: "item_invalid" });
    const projected = projectListTaskRunsError(source);
    expect(projected).toMatchObject({
      operation: "listTaskRuns",
      reason: "corruptData",
      cause: source,
    });
    expect(projected.cause).toBe(source);
  });

  it.each(historyReasonCases)(
    "maps attempt-history store reason %s",
    (sourceReason, reason) => {
      const source: StandardApplicationTaskAttemptHistoryQueryError =
        new AttemptHistoryStoreFailure({
          operation: "list_task_attempts",
          runId,
          reason: sourceReason,
          cause: null,
        });
      const projected = projectListTaskAttemptsError(runId, source);
      expect(projected).toMatchObject({
        _tag: "TaskReadError",
        operation: "listTaskAttempts",
        runId,
        reason,
        cause: source,
      });
      expect(projected.cause).toBe(source);
    },
  );

  it("maps attempt-history contract failures to corrupt data", () => {
    const source: StandardApplicationTaskAttemptHistoryQueryError =
      new AttemptHistoryContractFailure({ reason: "attempt_invalid" });
    const projected = projectListTaskAttemptsError(runId, source);
    expect(projected).toMatchObject({
      operation: "listTaskAttempts",
      reason: "corruptData",
      cause: source,
    });
    expect(projected.cause).toBe(source);
  });

  it.each(historyReasonCases)(
    "maps event-history store reason %s",
    (sourceReason, reason) => {
      const source: StandardApplicationTaskEventHistoryQueryError =
        new EventHistoryStoreFailure({
          operation: "list_task_events",
          runId,
          reason: sourceReason,
          cause: null,
        });
      const projected = projectListTaskEventsError(runId, source);
      expect(projected).toMatchObject({
        _tag: "TaskReadError",
        operation: "listTaskEvents",
        runId,
        reason,
        cause: source,
      });
      expect(projected.cause).toBe(source);
    },
  );

  it("maps event-history contract failures to corrupt data", () => {
    const source: StandardApplicationTaskEventHistoryQueryError =
      new EventHistoryContractFailure({ reason: "event_invalid" });
    const projected = projectListTaskEventsError(runId, source);
    expect(projected).toMatchObject({
      operation: "listTaskEvents",
      reason: "corruptData",
      cause: source,
    });
    expect(projected.cause).toBe(source);
  });
});

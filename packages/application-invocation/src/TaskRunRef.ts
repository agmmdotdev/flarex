import type {
  StandardApplicationTaskRunQueryApi,
  StandardApplicationTaskRunStatus,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";

declare const TaskRunRefType: unique symbol;

/** Opaque process-local identity for read-only Task-run inspection. */
export interface TaskRunRef {
  readonly [TaskRunRefType]: true;
}

type TaskRunRefRunId = StandardApplicationTaskRunStatus["runId"];

export interface TaskRunRefState {
  readonly runId: TaskRunRefRunId;
  readonly query: StandardApplicationTaskRunQueryApi;
}

const taskRunRefStates = new WeakMap<object, TaskRunRefState>();
const taskRunRefIssueToken = Symbol("TaskRunRef.issue");

class TaskRunRefHandle implements TaskRunRef {
  declare readonly [TaskRunRefType]: true;

  constructor(
    issueToken: typeof taskRunRefIssueToken,
    runId: TaskRunRefRunId,
    query: StandardApplicationTaskRunQueryApi,
  ) {
    if (issueToken !== taskRunRefIssueToken) {
      throw new TypeError("Task run reference issuance is unavailable.");
    }
    taskRunRefStates.set(this, Object.freeze({ runId, query }));
    Object.freeze(this);
  }
}

export function issueTaskRunRef(
  runId: TaskRunRefRunId,
  query: StandardApplicationTaskRunQueryApi,
): TaskRunRef {
  return new TaskRunRefHandle(taskRunRefIssueToken, runId, query);
}

export function inspectTaskRunRef(
  reference: object,
): TaskRunRefState | undefined {
  return taskRunRefStates.get(reference);
}

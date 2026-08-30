import type { TaskReference } from "@flarex/application-definition";
import {
  inspectTaskReference,
  type InspectedTaskReference,
} from "@flarex/application-definition/internal/task-definition";
import {
  createStandardApplicationTaskRun,
  type StandardApplicationTaskRunCreationReceipt,
  StandardApplicationTaskSystem,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import {
  inspectStandardApplicationTaskRun,
  StandardApplicationTaskRunQuery,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import {
  readStandardApplicationTaskResult,
  StandardApplicationTaskResultQuery,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-result-query";
import { Effect } from "effect";
import type { ExecutionIdentity } from "flarex-protocol/auth";

import {
  projectTaskAdmissionError,
  type TaskAdmissionError,
} from "./TaskAdmissionError.js";
import {
  type ApplicationTaskResultContractError,
  taskResultContractError,
  validateResultContract,
} from "./ResultContract.js";
import {
  type ApplicationRequestKeyError,
  normalizeTaskRequestKey,
} from "./RequestKey.js";
import {
  inspectTaskRunRef,
  type TaskRunRef,
} from "./TaskRunRef.js";
import {
  projectInspectTaskError,
  projectReadTaskResultError,
  type TaskReadError,
} from "./TaskReadError.js";
import {
  projectTaskRunId,
  projectTaskRunStatus,
  type TaskRunId,
  type TaskRunStatus,
} from "./TaskStatus.js";

declare const TaskRunType: unique symbol;

export interface TaskRun<Output> {
  readonly [TaskRunType]: Output;
  readonly runId: TaskRunId;
}

export interface StartTaskOptions {
  readonly requestKey: string;
  readonly identity: Extract<ExecutionIdentity, { readonly kind: "user" }>;
}

export type StartTaskError =
  | TaskAdmissionError
  | ApplicationRequestKeyError<"startTask">;
export type InspectTaskError = TaskReadError<"inspectTask">;
export type ReadTaskResultError =
  | TaskReadError<"readTaskResult">
  | ApplicationTaskResultContractError;

export interface InspectedTaskRun<Output> {
  readonly standardReference:
    InspectedTaskReference<unknown, Output>["standard"];
  readonly returnsValidator:
    InspectedTaskReference<unknown, Output>["returnsValidator"];
  readonly receipt: StandardApplicationTaskRunCreationReceipt;
}

const taskRunStates = new WeakMap<object, InspectedTaskRun<unknown>>();

class TaskRunHandle<Output> implements TaskRun<Output> {
  declare readonly [TaskRunType]: Output;

  constructor(
    readonly runId: TaskRun<Output>["runId"],
    standardReference: InspectedTaskReference<unknown, Output>["standard"],
    returnsValidator: InspectedTaskReference<
      unknown,
      Output
    >["returnsValidator"],
    receipt: StandardApplicationTaskRunCreationReceipt,
  ) {
    taskRunStates.set(this, Object.freeze({
      standardReference,
      returnsValidator,
      receipt,
    }));
    Object.freeze(this);
  }
}

/** Admits one durable run; execution and result observation remain separate. */
export const startTask = Effect.fn("Application.startTask")(function* <
  Payload,
  Output,
>(
  reference: TaskReference<Payload, Output>,
  payload: NoInfer<Payload>,
  options: StartTaskOptions,
): Effect.fn.Return<
  TaskRun<Output>,
  StartTaskError,
  StandardApplicationTaskSystem
> {
  const inspected = inspectTaskReference(reference);
  const standard = inspected.standard;
  const requestKey = yield* Effect.fromResult(
    normalizeTaskRequestKey(options.requestKey),
  );
  const receipt = yield* createStandardApplicationTaskRun(standard, {
    version: 1,
    requestKey,
    payload,
    executionIdentity: options.identity,
  }).pipe(Effect.mapError(projectTaskAdmissionError));
  return new TaskRunHandle<Output>(
    projectTaskRunId(receipt.runId),
    standard,
    inspected.returnsValidator,
    receipt,
  );
});

/** Reads current authoritative status for one issued Task-run identity. */
export const inspectTask = Effect.fn("Application.inspectTask")(function* (
  run: TaskRun<unknown> | TaskRunRef,
): Effect.fn.Return<
  TaskRunStatus,
  InspectTaskError,
  StandardApplicationTaskRunQuery
> {
  const taskRunState = taskRunStates.get(run);
  if (taskRunState !== undefined) {
    const status = yield* inspectStandardApplicationTaskRun(
      taskRunState.receipt.runId,
    ).pipe(Effect.mapError(projectInspectTaskError));
    return projectTaskRunStatus(status);
  }
  const referenceState = inspectTaskRunRef(run);
  if (referenceState === undefined) {
    throw new TypeError("Task run metadata is unavailable.");
  }
  const query = yield* StandardApplicationTaskRunQuery;
  if (query !== referenceState.query) {
    throw new TypeError("Task run metadata is unavailable.");
  }
  const status = yield* inspectStandardApplicationTaskRun(
    referenceState.runId,
  ).pipe(Effect.mapError(projectInspectTaskError));
  return projectTaskRunStatus(status);
});

/** Reads one available canonical result and binds it to the run's output type. */
export const readTaskResult = Effect.fn("Application.readTaskResult")(
  function* <Output>(
    run: TaskRun<Output>,
  ): Effect.fn.Return<
    Output,
    ReadTaskResultError,
    StandardApplicationTaskResultQuery
  > {
    const inspected = inspectTaskRun(run);
    const result = yield* readStandardApplicationTaskResult(
      inspected.receipt.runId,
    ).pipe(Effect.mapError(error =>
      projectReadTaskResultError(run.runId, error)
    ));
    const validated = yield* validateResultContract(
      inspected,
      result,
      cause => taskResultContractError(cause, result),
    );
    // SAFETY: the opaque run's captured output validator accepted this
    // canonical result value.
    return validated as Output;
  },
);

export function inspectTaskRun<Output>(
  run: TaskRun<Output>,
): InspectedTaskRun<Output> {
  const state = taskRunStates.get(run);
  if (state === undefined) {
    throw new TypeError("Task run metadata is unavailable.");
  }
  return state as InspectedTaskRun<Output>;
}

export function isTaskRun(run: object): run is TaskRun<unknown> {
  return taskRunStates.has(run);
}

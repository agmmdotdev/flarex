import type { TaskReference } from "@flarex/application-definition";
import {
  inspectTaskReference,
  type InspectedTaskReference,
} from "@flarex/application-definition/internal/task-definition";
import {
  createStandardApplicationTaskRun,
  type CreateStandardApplicationTaskRunError,
  type StandardApplicationTaskRunCreationReceipt,
  type StandardApplicationTaskRunRequestV1,
  StandardApplicationTaskSystem,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import {
  inspectStandardApplicationTaskRun,
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryError,
  type StandardApplicationTaskRunStatus,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import {
  readStandardApplicationTaskResult,
  StandardApplicationTaskResultQuery,
  type StandardApplicationTaskResultQueryError,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-result-query";
import { Effect } from "effect";

import {
  type ApplicationTaskResultContractError,
  taskResultContractError,
  validateResultContract,
} from "./ResultContract.js";

declare const TaskRunType: unique symbol;

export interface TaskRun<Output> {
  readonly [TaskRunType]: Output;
  readonly runId: StandardApplicationTaskRunCreationReceipt["runId"];
}

export interface StartTaskOptions {
  readonly requestKey: StandardApplicationTaskRunRequestV1<never>["requestKey"];
  readonly identity:
    StandardApplicationTaskRunRequestV1<never>["executionIdentity"];
}

export type StartTaskError = CreateStandardApplicationTaskRunError;
export type InspectTaskError = StandardApplicationTaskRunQueryError;
export type ReadTaskResultError =
  | StandardApplicationTaskResultQueryError
  | ApplicationTaskResultContractError;
export type TaskRunStatus = StandardApplicationTaskRunStatus;

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
  const receipt = yield* createStandardApplicationTaskRun(standard, {
    version: 1,
    requestKey: options.requestKey,
    payload,
    executionIdentity: options.identity,
  });
  return new TaskRunHandle<Output>(
    receipt.runId,
    standard,
    inspected.returnsValidator,
    receipt,
  );
});

/** Reads the current authoritative status for one opaque durable run handle. */
export const inspectTask = Effect.fn("Application.inspectTask")(function* <
  Output,
>(
  run: TaskRun<Output>,
): Effect.fn.Return<
  TaskRunStatus,
  InspectTaskError,
  StandardApplicationTaskRunQuery
> {
  inspectTaskRun(run);
  return yield* inspectStandardApplicationTaskRun(run.runId);
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
    const result = yield* readStandardApplicationTaskResult(run.runId);
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

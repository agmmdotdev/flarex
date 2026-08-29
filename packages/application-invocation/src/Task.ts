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
import { Effect } from "effect";

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
export type TaskRunStatus = StandardApplicationTaskRunStatus;

export interface InspectedTaskRun<Output> {
  readonly standardReference:
    InspectedTaskReference<unknown, Output>["standard"];
  readonly receipt: StandardApplicationTaskRunCreationReceipt;
}

const taskRunStates = new WeakMap<object, InspectedTaskRun<unknown>>();

class TaskRunHandle<Output> implements TaskRun<Output> {
  declare readonly [TaskRunType]: Output;

  constructor(
    readonly runId: TaskRun<Output>["runId"],
    standardReference: InspectedTaskReference<unknown, Output>["standard"],
    receipt: StandardApplicationTaskRunCreationReceipt,
  ) {
    taskRunStates.set(this, Object.freeze({ standardReference, receipt }));
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
  const standard = inspectTaskReference(reference).standard;
  const receipt = yield* createStandardApplicationTaskRun(standard, {
    version: 1,
    requestKey: options.requestKey,
    payload,
    executionIdentity: options.identity,
  });
  return new TaskRunHandle<Output>(receipt.runId, standard, receipt);
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

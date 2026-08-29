import type { TaskReference } from "@flarex/application-definition";
import { inspectTaskReference } from
  "@flarex/application-definition/internal/task-definition";
import {
  createStandardApplicationTaskRun,
  type CreateStandardApplicationTaskRunError,
  type StandardApplicationTaskRunCreationReceipt,
  type StandardApplicationTaskRunRequestV1,
  StandardApplicationTaskSystem,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
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

export interface InspectedTaskRun {
  readonly receipt: StandardApplicationTaskRunCreationReceipt;
}

const taskRunStates = new WeakMap<TaskRun<unknown>, InspectedTaskRun>();

class TaskRunHandle<Output> implements TaskRun<Output> {
  declare readonly [TaskRunType]: Output;

  constructor(
    readonly runId: TaskRun<Output>["runId"],
    receipt: StandardApplicationTaskRunCreationReceipt,
  ) {
    taskRunStates.set(this, Object.freeze({ receipt }));
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
  return new TaskRunHandle<Output>(receipt.runId, receipt);
});

export function inspectTaskRun(run: TaskRun<unknown>): InspectedTaskRun {
  const state = taskRunStates.get(run);
  if (state === undefined) {
    throw new TypeError("Task run metadata is unavailable.");
  }
  return state;
}

export function isTaskRun(run: object): run is TaskRun<unknown> {
  return taskRunStates.has(run as TaskRun<unknown>);
}

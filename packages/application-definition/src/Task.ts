import {
  defineStandardApplicationTaskV1,
  type StandardApplicationTaskDefinitionV1,
  type StandardApplicationTaskReferenceV1,
} from
  "@flarex/standard-application-definition/internal/task-authoring-v1";
import type {
  CanonicalTaskComputeProfileInputV1,
  CanonicalTaskManifestV1,
  CanonicalTaskRunAttemptPolicyInputV1,
  InvalidStandardApplicationTaskDefinitionV1Error,
} from
  "@flarex/standard-application-definition/internal/task-definition-v1";
import { Result } from "effect";

import {
  type ApplicationModule,
  type InferValidator,
  inspectApplicationModule,
  inspectValidator,
  type Validator,
} from "./Authoring.js";

type RequiredTaskValidator = Validator<unknown, "required", string>;

declare const TaskReferenceType: unique symbol;
declare const TaskDefinitionType: unique symbol;
declare const TaskDefinitionHandleType: unique symbol;

export interface TaskReference<Payload, Output> {
  readonly [TaskReferenceType]: Readonly<{
    readonly payload: (payload: Payload) => Payload;
    readonly output: Output;
  }>;
}

export interface TaskDefinitionHandle {
  readonly [TaskDefinitionHandleType]: true;
}

export interface TaskDefinition<Payload, Output> extends TaskDefinitionHandle {
  readonly [TaskDefinitionType]: TaskReference<Payload, Output>;
  readonly reference: TaskReference<Payload, Output>;
}

export interface TaskHandler {
  readonly module: ApplicationModule;
  readonly exportName: string;
}

export type TaskAttemptPolicy = Omit<
  CanonicalTaskRunAttemptPolicyInputV1,
  "version"
>;

export type TaskComputeProfile = CanonicalTaskComputeProfileInputV1;
export type TaskQueue = CanonicalTaskManifestV1["queue"];
export type InvalidTaskDefinitionError =
  InvalidStandardApplicationTaskDefinitionV1Error;

type InferTaskOutput<Output extends RequiredTaskValidator | null> =
  Output extends RequiredTaskValidator ? InferValidator<Output> : unknown;

export interface TaskInput<
  Payload extends RequiredTaskValidator,
  Output extends RequiredTaskValidator | null,
> {
  readonly id: unknown;
  readonly handler: TaskHandler;
  readonly payload: Payload;
  readonly returns: Output;
  readonly attempts: TaskAttemptPolicy;
  readonly maximumDurationInSeconds:
    CanonicalTaskManifestV1["maximumDurationInSeconds"];
  readonly compute: TaskComputeProfile;
  readonly queue: TaskQueue;
}

export interface InspectedTaskReference<Payload, Output> {
  readonly standard: StandardApplicationTaskReferenceV1<Payload, Output>;
}

export interface InspectedTaskDefinition<Payload, Output> {
  readonly standard: StandardApplicationTaskDefinitionV1<Payload, Output>;
}

const taskReferenceStates = new WeakMap<
  object,
  InspectedTaskReference<unknown, unknown>
>();
const taskDefinitionStates = new WeakMap<
  object,
  InspectedTaskDefinition<unknown, unknown>
>();

class TaskReferenceHandle<Payload, Output>
  implements TaskReference<Payload, Output> {
  declare readonly [TaskReferenceType]: Readonly<{
    readonly payload: (payload: Payload) => Payload;
    readonly output: Output;
  }>;

  constructor(standard: StandardApplicationTaskReferenceV1<Payload, Output>) {
    taskReferenceStates.set(this, Object.freeze({ standard }));
    Object.freeze(this);
  }
}

class TaskDefinitionHandleImpl<Payload, Output>
  implements TaskDefinition<Payload, Output> {
  declare readonly [TaskDefinitionHandleType]: true;
  declare readonly [TaskDefinitionType]: TaskReference<Payload, Output>;

  readonly reference: TaskReference<Payload, Output>;

  constructor(standard: StandardApplicationTaskDefinitionV1<Payload, Output>) {
    this.reference = new TaskReferenceHandle(standard.reference);
    taskDefinitionStates.set(this, Object.freeze({ standard }));
    Object.freeze(this);
  }
}

/**
 * Defines one durable Task without activating, selecting, starting, or
 * delivering it. The application module owns both handler paths.
 */
export function task<
  Payload extends RequiredTaskValidator,
  Output extends RequiredTaskValidator | null,
>(
  input: TaskInput<Payload, Output>,
): Result.Result<
  TaskDefinition<InferValidator<Payload>, InferTaskOutput<Output>>,
  InvalidTaskDefinitionError
> {
  const module = input.handler.module;
  inspectApplicationModule(module);
  return defineStandardApplicationTaskV1({
    taskId: input.id,
    handler: {
      logicalModulePath: module.path,
      artifactModulePath: module.source.path,
      exportName: input.handler.exportName,
    },
    payload: inspectValidator(input.payload),
    output: input.returns === null ? null : inspectValidator(input.returns),
    runAttemptPolicy: {
      ...input.attempts,
      version: 1,
    },
    maximumDurationInSeconds: input.maximumDurationInSeconds,
    computeProfile: input.compute,
    queue: input.queue,
  }).pipe(Result.map(standard => {
    // SAFETY: the clean validators retain these exact value types in their
    // private metadata; the Standard constructor cannot express that through
    // the intentionally unknown-valued inspection boundary.
    const typed = standard as StandardApplicationTaskDefinitionV1<
      InferValidator<Payload>,
      InferTaskOutput<Output>
    >;
    return new TaskDefinitionHandleImpl(typed);
  }));
}

export function inspectTaskReference<Payload, Output>(
  reference: TaskReference<Payload, Output>,
): InspectedTaskReference<Payload, Output> {
  const state = taskReferenceStates.get(reference);
  if (state === undefined) {
    throw new TypeError("Task reference metadata is unavailable.");
  }
  return state as InspectedTaskReference<Payload, Output>;
}

export function isTaskReference(
  reference: object,
): boolean {
  return taskReferenceStates.has(reference);
}

export function inspectTaskDefinition(
  definition: TaskDefinitionHandle,
): InspectedTaskDefinition<unknown, unknown> {
  const state = taskDefinitionStates.get(definition);
  if (state === undefined) {
    throw new TypeError("Task definition metadata is unavailable.");
  }
  return state;
}

export function isTaskDefinition(
  definition: object,
): definition is TaskDefinitionHandle {
  return taskDefinitionStates.has(definition);
}

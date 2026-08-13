import {
  InvalidTaskRunCreationRequestError,
  decodeTaskRunCreationRequestKeyV1,
  decodeTaskRunCreationRequestV1,
  type TaskRunCreationReceiptV1,
  type TaskRunCreationRequestKeyV1,
  type TaskRunCreationRequestV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decodeTaskDefinitionRevisionIdV1,
  type TaskDefinitionRevisionIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect, Result } from "effect";

import type {
  TaskRunInputStore,
  TaskRunInputStoreError,
} from "./TaskRunInputStore.js";

export class TaskRunCreationCoordinatorConfigurationError
  extends Data.TaggedError("TaskRunCreationCoordinatorConfigurationError")<{
    readonly reason: "invalid_input_store" | "invalid_creation_port";
  }> {}

export class TaskRunCreationCoordinatorInputError
  extends Data.TaggedError("TaskRunCreationCoordinatorInputError")<{
    readonly reason: "invalid_shape" | "invalid_definition_revision";
  }> {}

export interface TaskRunCreationPort<CreationError> {
  readonly createRun: (
    request: TaskRunCreationRequestV1,
  ) => Effect.Effect<TaskRunCreationReceiptV1, CreationError>;
}

export type TaskRunCreationCoordinatorError<CreationError> =
  | TaskRunCreationCoordinatorInputError
  | InvalidTaskRunCreationRequestError
  | TaskRunInputStoreError
  | CreationError;

export interface TaskRunCreationCoordinator<CreationError> {
  readonly create: (
    input: unknown,
  ) => Effect.Effect<
    TaskRunCreationReceiptV1,
    TaskRunCreationCoordinatorError<CreationError>
  >;
}

interface CapturedCreationInput {
  readonly requestKey: TaskRunCreationRequestKeyV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly input: unknown;
}

export function makeTaskRunCreationCoordinator<CreationError>(
  inputStore: TaskRunInputStore,
  creationPort: TaskRunCreationPort<CreationError>,
): Result.Result<
  TaskRunCreationCoordinator<CreationError>,
  TaskRunCreationCoordinatorConfigurationError
> {
  return Result.gen(function* () {
    const publish = yield* captureInputStorePublish(inputStore);
    const createRun = yield* captureCreationPortCreateRun(creationPort);
    const create: TaskRunCreationCoordinator<CreationError>["create"] =
      Effect.fn("TaskRunCreationCoordinator.create")(function* (input) {
        const captured = yield* Effect.fromResult(captureCreationInput(input));
        const reference = yield* publish.call(inputStore, captured.input);
        const request = yield* Effect.fromResult(
          decodeTaskRunCreationRequestV1({
            version: 1,
            requestKey: captured.requestKey,
            taskDefinitionRevisionId: captured.taskDefinitionRevisionId,
            input: reference,
          }),
        );
        return yield* createRun.call(creationPort, request);
      });
    return Object.freeze({ create });
  });
}

function captureInputStorePublish(
  owner: TaskRunInputStore,
): Result.Result<
  TaskRunInputStore["publish"],
  TaskRunCreationCoordinatorConfigurationError
> {
  return Result.try({
    try: () => owner.publish,
    catch: () => new TaskRunCreationCoordinatorConfigurationError({
      reason: "invalid_input_store",
    }),
  }).pipe(Result.filterOrFail(
    operation => typeof operation === "function",
    () => new TaskRunCreationCoordinatorConfigurationError({
      reason: "invalid_input_store",
    }),
  ));
}

function captureCreationPortCreateRun<CreationError>(
  owner: TaskRunCreationPort<CreationError>,
): Result.Result<
  TaskRunCreationPort<CreationError>["createRun"],
  TaskRunCreationCoordinatorConfigurationError
> {
  return Result.try({
    try: () => owner.createRun,
    catch: () => new TaskRunCreationCoordinatorConfigurationError({
      reason: "invalid_creation_port",
    }),
  }).pipe(Result.filterOrFail(
    operation => typeof operation === "function",
    () => new TaskRunCreationCoordinatorConfigurationError({
      reason: "invalid_creation_port",
    }),
  ));
}

function captureCreationInput(
  input: unknown,
): Result.Result<
  CapturedCreationInput,
  TaskRunCreationCoordinatorInputError | InvalidTaskRunCreationRequestError
> {
  return captureCreationInputData(input).pipe(Result.flatMap(captured =>
    Result.gen(function* () {
      const requestKey = yield* decodeTaskRunCreationRequestKeyV1(
        captured.requestKey,
      );
      const taskDefinitionRevisionId = yield* decodeTaskDefinitionRevisionIdV1(
        captured.taskDefinitionRevisionId,
      ).pipe(Result.mapError(() =>
        new TaskRunCreationCoordinatorInputError({
          reason: "invalid_definition_revision",
        })
      ));
      return Object.freeze({
        requestKey,
        taskDefinitionRevisionId,
        input: captured.input,
      });
    })
  ));
}

function captureCreationInputData(
  input: unknown,
): Result.Result<
  Readonly<Record<"requestKey" | "taskDefinitionRevisionId" | "input", unknown>>,
  TaskRunCreationCoordinatorInputError
> {
  return Result.try({
    try: () => {
      if (!isNonArrayRecord(input)) return undefined;
      const prototype = Reflect.getPrototypeOf(input);
      if (prototype !== Object.prototype && prototype !== null) return undefined;
      const expected = [
        "requestKey",
        "taskDefinitionRevisionId",
        "input",
      ] as const;
      const keys = Reflect.ownKeys(input);
      if (
        keys.length !== expected.length
        || expected.some(key => !keys.includes(key))
      ) return undefined;
      const captured: Record<(typeof expected)[number], unknown> = {
        requestKey: undefined,
        taskDefinitionRevisionId: undefined,
        input: undefined,
      };
      for (const key of expected) {
        const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
        if (
          descriptor === undefined
          || !("value" in descriptor)
          || descriptor.enumerable !== true
        ) return undefined;
        captured[key] = descriptor.value;
      }
      return Object.freeze(captured);
    },
    catch: () => new TaskRunCreationCoordinatorInputError({
      reason: "invalid_shape",
    }),
  }).pipe(Result.flatMap(captured => captured === undefined
    ? Result.fail(new TaskRunCreationCoordinatorInputError({
      reason: "invalid_shape",
    }))
    : Result.succeed(captured)
  ));
}

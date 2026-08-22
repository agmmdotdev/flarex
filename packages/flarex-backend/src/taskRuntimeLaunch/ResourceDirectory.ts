import type { CurrentTaskComputeDispatchRequestV1 } from
  "@flarex/durable-task/internal/compute-provider-v1";
import { Data, Effect, Result } from "effect";
import type { ReplacementScopeIdV1 } from
  "flarex-protocol/storage-authority";

import {
  ApplicationAnalysisSourceReadError,
  type ApplicationAnalysisSourceReader,
} from "../sourceArtifactV2/ApplicationAnalysisReader.js";
import {
  TaskExecutionPrincipalStoreCorruptionError,
  TaskExecutionPrincipalStoreInputError,
  TaskExecutionPrincipalStoreNotFoundError,
  TaskExecutionPrincipalStoreResourceError,
  TaskExecutionPrincipalStoreSettlementUncertainError,
  type TaskExecutionPrincipalReader,
} from "../taskExecutionPrincipal/TaskExecutionPrincipalStore.js";
import {
  TaskInputStoreCorruptionError,
  TaskInputStoreInputError,
  TaskInputStoreNotFoundError,
  TaskInputStoreResourceError,
  TaskInputStoreSettlementUncertainError,
  type TaskInputStore,
} from "../taskInput/TaskInputStore.js";
import {
  TaskRuntimeObjectStoreCorruptionError,
  TaskRuntimeObjectStoreInputError,
  TaskRuntimeObjectStoreNotFoundError,
  TaskRuntimeObjectStoreResourceError,
  TaskRuntimeObjectStoreSettlementUncertainError,
  type TaskRuntimeObjectStore,
} from "../taskRuntimePublication/TaskRuntimeObjectStore.js";
import {
  TaskRuntimeLaunchPortError,
  type CurrentTaskRuntimeLaunchEvidence,
  type TaskRuntimeLaunchDirectory,
  type TaskRuntimeLaunchLocatedSource,
} from "./Model.js";

export interface TaskRuntimeLaunchLocatedResources {
  readonly scopeId: ReplacementScopeIdV1;
  readonly readEvidence: (
    request: CurrentTaskComputeDispatchRequestV1,
  ) => Effect.Effect<
    CurrentTaskRuntimeLaunchEvidence,
    TaskRuntimeLaunchPortError<"read_evidence">
  >;
  readonly runtimeObjects: TaskRuntimeObjectStore;
  readonly inputs: TaskInputStore;
  readonly applicationSource: ApplicationAnalysisSourceReader;
  readonly principals: TaskExecutionPrincipalReader;
}

export interface TaskRuntimeLaunchResourceDirectory {
  readonly resolve: (
    scopeId: ReplacementScopeIdV1,
  ) => Effect.Effect<
    TaskRuntimeLaunchLocatedResources,
    TaskRuntimeLaunchPortError<"resolve_source">
  >;
}

export class TaskRuntimeLaunchResourceDirectoryConfigurationError
  extends Data.TaggedError(
    "TaskRuntimeLaunchResourceDirectoryConfigurationError",
  )<{
    readonly reason: "invalid_directory";
    readonly cause?: unknown;
  }> {}

/**
 * Adapts located database evidence plus immutable object owners into the
 * existing launch-authority port. It owns no cache, lifecycle decision, or
 * object key derivation.
 */
export function makeTaskRuntimeLaunchDirectoryFromResources(
  resources: TaskRuntimeLaunchResourceDirectory,
): Result.Result<
  TaskRuntimeLaunchDirectory,
  TaskRuntimeLaunchResourceDirectoryConfigurationError
> {
  return captureResourceDirectory(resources).pipe(Result.map(captured => {
    const resolve: TaskRuntimeLaunchDirectory["resolve"] = Effect.fn(
      "TaskRuntimeLaunchResourceDirectory.resolve",
    )(function* (scopeId) {
      const located = yield* captured.resolve(scopeId);
      const source = yield* Effect.fromResult(captureLocatedResources(located));
      return makeLocatedSource(source);
    });
    return Object.freeze({ resolve });
  }));
}

interface CapturedResourceDirectory {
  readonly resolve: TaskRuntimeLaunchResourceDirectory["resolve"];
}

interface CapturedLocatedResources {
  readonly scopeId: ReplacementScopeIdV1;
  readonly readEvidence: TaskRuntimeLaunchLocatedSource["readEvidence"];
  readonly readRuntimeObject: TaskRuntimeObjectStore["read"];
  readonly readInput: TaskInputStore["read"];
  readonly readApplicationSource: ApplicationAnalysisSourceReader["read"];
  readonly readPrincipal: TaskExecutionPrincipalReader["read"];
}

function captureResourceDirectory(
  input: TaskRuntimeLaunchResourceDirectory,
): Result.Result<
  CapturedResourceDirectory,
  TaskRuntimeLaunchResourceDirectoryConfigurationError
> {
  return Result.try({
    try: () => {
      const owner = input;
      const resolve = owner.resolve;
      if (typeof resolve !== "function") throw new Error("Invalid resource directory.");
      return Object.freeze({
        resolve: (scopeId: ReplacementScopeIdV1) =>
          resolve.call(owner, scopeId),
      });
    },
    catch: cause => new TaskRuntimeLaunchResourceDirectoryConfigurationError({
      reason: "invalid_directory",
      cause,
    }),
  });
}

function captureLocatedResources(
  input: TaskRuntimeLaunchLocatedResources,
): Result.Result<
  CapturedLocatedResources,
  TaskRuntimeLaunchPortError<"resolve_source">
> {
  return Result.try({
    try: () => {
      const owner = input;
      const runtimeOwner = owner.runtimeObjects;
      const inputOwner = owner.inputs;
      const sourceOwner = owner.applicationSource;
      const principalOwner = owner.principals;
      const readEvidence = owner.readEvidence;
      const readRuntimeObject = runtimeOwner.read;
      const readInput = inputOwner.read;
      const readApplicationSource = sourceOwner.read;
      const readPrincipal = principalOwner.read;
      if (
        typeof readEvidence !== "function" ||
        typeof readRuntimeObject !== "function" ||
        typeof readInput !== "function" ||
        typeof readApplicationSource !== "function" ||
        typeof readPrincipal !== "function"
      ) throw new Error("Invalid located launch resources.");
      return Object.freeze({
        scopeId: owner.scopeId,
        readEvidence: (request: CurrentTaskComputeDispatchRequestV1) =>
          readEvidence.call(owner, request),
        readRuntimeObject: (reference: Parameters<typeof readRuntimeObject>[0]) =>
          readRuntimeObject.call(runtimeOwner, reference),
        readInput: (reference: Parameters<typeof readInput>[0]) =>
          readInput.call(inputOwner, reference),
        readApplicationSource: (
          rootSha256: Parameters<typeof readApplicationSource>[0],
        ) => readApplicationSource.call(sourceOwner, rootSha256),
        readPrincipal: (reference: Parameters<typeof readPrincipal>[0]) =>
          readPrincipal.call(principalOwner, reference),
      });
    },
    catch: cause => portError("resolve_source", "invalid_configuration", cause),
  });
}

function makeLocatedSource(
  resources: CapturedLocatedResources,
): TaskRuntimeLaunchLocatedSource {
  const readRuntimeObject: TaskRuntimeLaunchLocatedSource["readRuntimeObject"] =
    reference => resources.readRuntimeObject(reference).pipe(
      Effect.map(stored => stored.bytes),
      Effect.mapError(mapRuntimeObjectError),
    );
  const readInput: TaskRuntimeLaunchLocatedSource["readInput"] =
    reference => resources.readInput(reference).pipe(
      Effect.map(stored => stored.canonicalBytes),
      Effect.mapError(mapInputError),
    );
  const readApplicationSource: NonNullable<
    TaskRuntimeLaunchLocatedSource["readApplicationSource"]
  > = rootSha256 => resources.readApplicationSource(rootSha256).pipe(
    Effect.mapError(mapApplicationSourceError),
  );
  const readPrincipal: NonNullable<
    TaskRuntimeLaunchLocatedSource["readPrincipal"]
  > = reference => resources.readPrincipal(reference).pipe(
    Effect.map(stored => stored.canonicalBytes),
    Effect.mapError(mapPrincipalError),
  );
  return Object.freeze({
    scopeId: resources.scopeId,
    readEvidence: resources.readEvidence,
    readRuntimeObject,
    readInput,
    readApplicationSource,
    readPrincipal,
  });
}

function mapRuntimeObjectError(
  error:
    | TaskRuntimeObjectStoreInputError
    | TaskRuntimeObjectStoreNotFoundError
    | TaskRuntimeObjectStoreResourceError
    | TaskRuntimeObjectStoreCorruptionError
    | TaskRuntimeObjectStoreSettlementUncertainError,
): TaskRuntimeLaunchPortError<"read_runtime_object"> {
  if (error instanceof TaskRuntimeObjectStoreNotFoundError) {
    return portError("read_runtime_object", "not_found", error);
  }
  if (
    error instanceof TaskRuntimeObjectStoreResourceError ||
    error instanceof TaskRuntimeObjectStoreSettlementUncertainError
  ) return portError("read_runtime_object", "resource_failure", error);
  return portError("read_runtime_object", "corrupt", error);
}

function mapInputError(
  error:
    | TaskInputStoreInputError
    | TaskInputStoreNotFoundError
    | TaskInputStoreResourceError
    | TaskInputStoreCorruptionError
    | TaskInputStoreSettlementUncertainError,
): TaskRuntimeLaunchPortError<"read_input"> {
  if (error instanceof TaskInputStoreNotFoundError) {
    return portError("read_input", "not_found", error);
  }
  if (
    error instanceof TaskInputStoreResourceError ||
    error instanceof TaskInputStoreSettlementUncertainError
  ) return portError("read_input", "resource_failure", error);
  return portError("read_input", "corrupt", error);
}

function mapApplicationSourceError(
  error: ApplicationAnalysisSourceReadError,
): TaskRuntimeLaunchPortError<"read_application_source"> {
  switch (error.reason) {
    case "notFound":
      return portError("read_application_source", "not_found", error);
    case "sourceReadFailed":
      return portError("read_application_source", "resource_failure", error);
    case "internalFailure":
      return portError("read_application_source", "invariant_failure", error);
    case "invalidRoot":
    case "limitExceeded":
    case "invalidSourceArtifact":
    case "unsupportedAuth":
    case "invalidSourceText":
      return portError("read_application_source", "corrupt", error);
  }
}

function mapPrincipalError(
  error:
    | TaskExecutionPrincipalStoreInputError
    | TaskExecutionPrincipalStoreNotFoundError
    | TaskExecutionPrincipalStoreResourceError
    | TaskExecutionPrincipalStoreCorruptionError
    | TaskExecutionPrincipalStoreSettlementUncertainError,
): TaskRuntimeLaunchPortError<"read_principal"> {
  if (error instanceof TaskExecutionPrincipalStoreNotFoundError) {
    return portError("read_principal", "not_found", error);
  }
  if (
    error instanceof TaskExecutionPrincipalStoreResourceError ||
    error instanceof TaskExecutionPrincipalStoreSettlementUncertainError
  ) return portError("read_principal", "resource_failure", error);
  return portError("read_principal", "corrupt", error);
}

function portError(
  operation: "resolve_source",
  reason:
    | "authority_unavailable"
    | "invalid_configuration"
    | "resource_failure",
  cause: unknown,
): TaskRuntimeLaunchPortError<"resolve_source">;
function portError(
  operation: "read_runtime_object",
  reason: "not_found" | "corrupt" | "resource_failure",
  cause: unknown,
): TaskRuntimeLaunchPortError<"read_runtime_object">;
function portError(
  operation: "read_input",
  reason: "not_found" | "corrupt" | "resource_failure",
  cause: unknown,
): TaskRuntimeLaunchPortError<"read_input">;
function portError(
  operation: "read_application_source",
  reason:
    | "not_found"
    | "corrupt"
    | "invariant_failure"
    | "resource_failure",
  cause: unknown,
): TaskRuntimeLaunchPortError<"read_application_source">;
function portError(
  operation: "read_principal",
  reason: "not_found" | "corrupt" | "resource_failure",
  cause: unknown,
): TaskRuntimeLaunchPortError<"read_principal">;
function portError(
  operation:
    | "resolve_source"
    | "read_runtime_object"
    | "read_application_source"
    | "read_principal"
    | "read_input",
  reason:
    | "authority_unavailable"
    | "invalid_configuration"
    | "invariant_failure"
    | "not_found"
    | "corrupt"
    | "resource_failure",
  cause: unknown,
): TaskRuntimeLaunchPortError {
  return new TaskRuntimeLaunchPortError({
    operation,
    reason,
    cause,
  });
}

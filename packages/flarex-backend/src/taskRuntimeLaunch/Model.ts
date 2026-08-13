import {
  type TaskComputeDispatchRequestV1,
  validateTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  type TaskInputReferenceV1,
  decodeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import type {
  TaskDefinitionRuntimeBindingV1,
  TaskRuntimeObjectReferenceV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Data, Effect, Result } from "effect";
import type {
  ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";

export type TaskRuntimeLaunchPortOperation =
  | "resolve_source"
  | "read_evidence"
  | "read_runtime_object"
  | "read_input";

export type TaskRuntimeLaunchPortFailureReason<
  Operation extends TaskRuntimeLaunchPortOperation,
> = Operation extends "resolve_source"
  ? "authority_unavailable" | "resource_failure"
  : Operation extends "read_evidence"
    ? "not_found" | "corrupt" | "resource_failure"
    : "not_found" | "corrupt" | "resource_failure";

export class TaskRuntimeLaunchPortError<
  Operation extends TaskRuntimeLaunchPortOperation =
    TaskRuntimeLaunchPortOperation,
> extends Data.TaggedError("TaskRuntimeLaunchPortError")<{
  readonly operation: Operation;
  readonly reason: TaskRuntimeLaunchPortFailureReason<Operation>;
  readonly cause?: unknown;
}> {}

export type TaskRuntimeLaunchValidationOperation = "resolve" | "read_input";

export type TaskRuntimeLaunchValidationReason<
  Operation extends TaskRuntimeLaunchValidationOperation,
> = Operation extends "resolve"
  ?
    | "invalid_request"
    | "invalid_source"
    | "scope_mismatch"
    | "invalid_evidence"
    | "request_mismatch"
    | "invalid_runtime_binding"
    | "runtime_binding_mismatch"
    | "runtime_policy_mismatch"
    | "runtime_object_budget_exceeded"
    | "runtime_object_invalid"
  : "input_invalid";

export class TaskRuntimeLaunchValidationError<
  Operation extends TaskRuntimeLaunchValidationOperation =
    TaskRuntimeLaunchValidationOperation,
> extends Data.TaggedError("TaskRuntimeLaunchValidationError")<{
  readonly operation: Operation;
  readonly reason: TaskRuntimeLaunchValidationReason<Operation>;
  readonly path?: string;
  readonly cause?: unknown;
}> {}

export class TaskRuntimeLaunchHashError extends Data.TaggedError(
  "TaskRuntimeLaunchHashError",
)<{
  readonly reason:
    | "invalid_budget"
    | "invalid_bytes"
    | "input_bytes_exceeded"
    | "unavailable"
    | "native_rejected";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class TaskRuntimeLaunchHashInvariantDefect extends Data.TaggedError(
  "TaskRuntimeLaunchHashInvariantDefect",
)<{
  readonly observedByteLength?: number;
}> {}

export class TaskRuntimeLaunchObjectCodecError extends Data.TaggedError(
  "TaskRuntimeLaunchObjectCodecError",
)<{
  readonly reason: "invalid_body" | "unsupported_role";
  readonly cause?: unknown;
}> {}

export class TaskRuntimeLaunchConfigurationError extends Data.TaggedError(
  "TaskRuntimeLaunchConfigurationError",
)<{
  readonly reason: "invalid_options";
  readonly cause?: unknown;
}> {}

export interface TaskRuntimeLaunchEvidence {
  readonly preparedExecution: unknown;
  readonly runtimeBinding: unknown;
  readonly runtimeBindingCanonicalBytes: unknown;
}

/**
 * Scope-local capability. Several located sources may coexist in one Worker,
 * so this remains an explicit value rather than a singleton Context service.
 */
export interface TaskRuntimeLaunchLocatedSource {
  readonly scopeId: ReplacementScopeIdV1;
  readonly readEvidence: (
    request: TaskComputeDispatchRequestV1,
  ) => Effect.Effect<
    TaskRuntimeLaunchEvidence,
    TaskRuntimeLaunchPortError<"read_evidence">
  >;
  readonly readRuntimeObject: (
    reference: TaskRuntimeObjectReferenceV1,
  ) => Effect.Effect<
    unknown,
    TaskRuntimeLaunchPortError<"read_runtime_object">
  >;
  readonly readInput: (
    reference: TaskInputReferenceV1,
  ) => Effect.Effect<unknown, TaskRuntimeLaunchPortError<"read_input">>;
}

export interface TaskRuntimeLaunchDirectory {
  readonly resolve: (
    scopeId: ReplacementScopeIdV1,
  ) => Effect.Effect<
    TaskRuntimeLaunchLocatedSource,
    TaskRuntimeLaunchPortError<"resolve_source">
  >;
}

export type TaskRuntimeLaunchSha256 = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, TaskRuntimeLaunchHashError>;

/**
 * Trusted role-owned codec seam. The caller receives an owned byte copy and
 * must fail unless the body is canonical for the declared object role.
 */
export type TaskRuntimeLaunchObjectValidator = (
  reference: TaskRuntimeObjectReferenceV1,
  ownedBytes: Uint8Array,
) => Effect.Effect<void, TaskRuntimeLaunchObjectCodecError>;

export interface TaskRuntimeLaunchObject {
  readonly reference: TaskRuntimeObjectReferenceV1;
  /** Owned mutable bytes transferred to the later materializer. */
  readonly bytes: Uint8Array;
}

export type TaskRuntimeInputReadError =
  | TaskRuntimeLaunchPortError<"read_input">
  | TaskRuntimeLaunchValidationError<"read_input">;

/**
 * Exact-input, process-local capability. It intentionally exposes no bucket
 * or key-selection authority and returns a new owned byte array on every read.
 */
export interface TaskRuntimeInputSource {
  readonly reference: TaskInputReferenceV1;
  readonly read: () => Effect.Effect<Uint8Array, TaskRuntimeInputReadError>;
}

export interface TaskRuntimeLaunchSubject {
  readonly request: TaskComputeDispatchRequestV1;
  readonly runtimeBinding: TaskDefinitionRuntimeBindingV1;
  readonly runtimeObjects: ReadonlyArray<TaskRuntimeLaunchObject>;
  readonly input: TaskRuntimeInputSource;
}

export type TaskRuntimeLaunchAuthorityError =
  | TaskRuntimeLaunchPortError<"resolve_source">
  | TaskRuntimeLaunchPortError<"read_evidence">
  | TaskRuntimeLaunchPortError<"read_runtime_object">
  | TaskRuntimeLaunchValidationError<"resolve">
  | TaskRuntimeLaunchHashError;

export function decodeTaskRuntimeLaunchRequest(
  input: unknown,
): Result.Result<
  TaskComputeDispatchRequestV1,
  TaskRuntimeLaunchValidationError<"resolve">
> {
  return validateTaskComputeDispatchRequestV1(input).pipe(
    Result.mapError((cause) =>
      new TaskRuntimeLaunchValidationError<"resolve">({
        operation: "resolve",
        reason: "invalid_request",
        cause,
      })
    ),
  );
}

/** Protocol-owned decoding retained for the resolve boundary to map once. */
export const decodeTaskRuntimeInputReference = decodeTaskInputReferenceV1;

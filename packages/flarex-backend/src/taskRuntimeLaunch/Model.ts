import {
  type ApplicationTaskComputeDispatchRequestV1,
  type CurrentTaskComputeDispatchRequestV1,
  type TaskComputeDispatchRequestV1,
  validateCurrentTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  type TaskExecutionPrincipalReferenceV1,
  type TaskInputReferenceV1,
  decodeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import type {
  ApplicationTaskRunCreationAuthorityV1,
  ApplicationTaskRuntimeTargetV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import type {
  CanonicalTaskManifestV1,
  TaskDefinitionRuntimeBindingV1,
  TaskRuntimeObjectReferenceV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Data, Effect, Result } from "effect";
import type { ExecutionIdentity } from "flarex-protocol/auth";
import type {
  ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import type { ApplicationAnalysisSourceBundle } from
  "../sourceArtifactV2/ApplicationAnalysisReader.js";

export type TaskRuntimeLaunchPortOperation =
  | "resolve_source"
  | "read_evidence"
  | "read_runtime_object"
  | "read_application_source"
  | "read_principal"
  | "read_input";

export type TaskRuntimeLaunchPortFailureReason<
  Operation extends TaskRuntimeLaunchPortOperation,
> = Operation extends "resolve_source"
  ? "authority_unavailable" | "invalid_configuration" | "resource_failure"
  : Operation extends "read_application_source"
    ? "not_found" | "corrupt" | "invariant_failure" | "resource_failure"
  : Operation extends
      | "read_evidence"
      | "read_runtime_object"
      | "read_principal"
      | "read_input"
    ? "not_found" | "corrupt" | "resource_failure"
    : "not_found" | "resource_failure";

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
    | "application_authority_mismatch"
    | "application_source_invalid"
    | "principal_invalid"
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
  readonly generation?: never;
  readonly preparedExecution: unknown;
  readonly runtimeBinding: unknown;
  readonly runtimeBindingCanonicalBytes: unknown;
}

export interface ApplicationTaskRuntimeLaunchEvidence {
  readonly generation: "application_v1";
  readonly preparedExecution: unknown;
  readonly runtimeBinding?: never;
  readonly runtimeBindingCanonicalBytes?: never;
}

export type CurrentTaskRuntimeLaunchEvidence =
  | TaskRuntimeLaunchEvidence
  | ApplicationTaskRuntimeLaunchEvidence;

/**
 * Scope-local capability. Several located sources may coexist in one Worker,
 * so this remains an explicit value rather than a singleton Context service.
 */
export interface TaskRuntimeLaunchLocatedSource {
  readonly scopeId: ReplacementScopeIdV1;
  readonly readEvidence: (
    request: CurrentTaskComputeDispatchRequestV1,
  ) => Effect.Effect<
    CurrentTaskRuntimeLaunchEvidence,
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
  readonly readApplicationSource?: (
    rootSha256: string,
  ) => Effect.Effect<
    unknown,
    TaskRuntimeLaunchPortError<"read_application_source">
  >;
  readonly readPrincipal?: (
    reference: TaskExecutionPrincipalReferenceV1,
  ) => Effect.Effect<unknown, TaskRuntimeLaunchPortError<"read_principal">>;
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

export interface ApplicationTaskRuntimeLaunchSubject {
  readonly generation: "application_v1";
  readonly request: ApplicationTaskComputeDispatchRequestV1;
  readonly runtimeTarget: ApplicationTaskRuntimeTargetV1;
  readonly manifest: CanonicalTaskManifestV1;
  readonly creationAuthority: ApplicationTaskRunCreationAuthorityV1;
  readonly executionIdentity: Extract<
    ExecutionIdentity,
    { readonly kind: "user" }
  >;
  readonly source: ApplicationAnalysisSourceBundle;
  readonly input: TaskRuntimeInputSource;
}

export type CurrentTaskRuntimeLaunchSubject =
  | (TaskRuntimeLaunchSubject & { readonly generation?: never })
  | ApplicationTaskRuntimeLaunchSubject;

export type TaskRuntimeLaunchAuthorityError =
  | TaskRuntimeLaunchPortError<"resolve_source">
  | TaskRuntimeLaunchPortError<"read_evidence">
  | TaskRuntimeLaunchPortError<"read_runtime_object">
  | TaskRuntimeLaunchPortError<"read_application_source">
  | TaskRuntimeLaunchPortError<"read_principal">
  | TaskRuntimeLaunchValidationError<"resolve">
  | TaskRuntimeLaunchHashError;

export function decodeTaskRuntimeLaunchRequest(
  input: unknown,
): Result.Result<
  CurrentTaskComputeDispatchRequestV1,
  TaskRuntimeLaunchValidationError<"resolve">
> {
  return validateCurrentTaskComputeDispatchRequestV1(input).pipe(
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

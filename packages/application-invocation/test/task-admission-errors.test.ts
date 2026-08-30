import type { CreateStandardApplicationTaskRunError } from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import { Brand, Data } from "effect";
import { describe, expect, it } from "vitest";

import {
  projectTaskAdmissionError,
  type TaskAdmissionErrorReason,
} from "../src/TaskAdmissionError.js";

class InputFailure extends Data.TaggedError("TaskInputStoreInputError")<{
  readonly operation: "publish";
  readonly reason: "invalidValue";
}> {}

class IdentityFailure extends Data.TaggedError(
  "TaskExecutionPrincipalStoreInputError",
)<{
  readonly operation: "issue";
  readonly reason: "invalidIdentity";
}> {}

class CompositionFailure extends Data.TaggedError(
  "ApplicationTaskSystemCompositionError",
)<{ readonly reason: "principalScopeMismatch" }> {}

class ActivationFailure extends Data.TaggedError(
  "ApplicationActivationError",
)<{
  readonly operation: "read";
  readonly reason:
    | "invalidInput"
    | "invalidComposition"
    | "notReady"
    | "activeMissing"
    | "alreadyActive"
    | "expectedHead"
    | "scopeAuthority"
    | "concurrentHead"
    | "storedState"
    | "decisionUncertain"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

class ReadinessFailure extends Data.TaggedError("ApplicationReadinessError")<{
  readonly operation: "readReady";
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "storedState"
    | "schemaBinding"
    | "coldMaterialization"
    | "conflictingReplay"
    | "invalidComposition"
    | "decisionUncertain"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

class SchemaAuthorityFailure extends Data.TaggedError(
  "ApplicationSchemaAuthorityError",
)<{
  readonly operation: "readPublished";
  readonly reason:
    | "invalidDeployment"
    | "invalidManifest"
    | "invalidSchema"
    | "projectionMismatch"
    | "resourceFailure";
  readonly cause?: unknown;
}> {}

class TaskCatalogFailure extends Data.TaggedError(
  "ApplicationTaskCatalogSnapshotError",
)<{
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "storedState"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

class SelectionFailure extends Data.TaggedError(
  "ApplicationTaskSelectionError",
)<{
  readonly operation: "select";
  readonly reason:
    | "invalidComposition"
    | "invalidTaskId"
    | "taskMissing"
    | "storedTask"
    | "authorityMismatch"
    | "runtimeHostMismatch"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

class ShaResourceFailure extends Data.TaggedError(
  "StandardApplicationTaskSha256ResourceV1Error",
)<{ readonly reason: "unavailable" | "nativeRejected" }> {}

class CreationBindingFailure extends Data.TaggedError(
  "TaskSystemRunCreationBindingError",
)<{
  readonly operation: "create_run";
  readonly reason:
    | "request_authority_mismatch"
    | "authority_binding_mismatch"
    | "definition_unavailable"
    | "stored_binding_mismatch";
}> {}

class CreationCorruptionFailure extends Data.TaggedError(
  "TaskSystemRunCreationCorruptionError",
)<{
  readonly operation: "create_run";
  readonly reason: "database_clock_invalid";
}> {}

class CreationTransientFailure extends Data.TaggedError(
  "TaskSystemRunCreationTransientStoreError",
)<{
  readonly operation: "create_run";
  readonly reason: "timeout";
  readonly cause: unknown;
}> {}

class CreationTerminalFailure extends Data.TaggedError(
  "TaskSystemRunCreationTerminalStoreError",
)<{
  readonly operation: "create_run";
  readonly reason: "unsupported_integration";
  readonly cause: unknown;
}> {}

class PhysicalDefinitionConflictFailure extends Data.TaggedError(
  "PhysicalDefinitionLifecycleConflictError",
)<{
  readonly reason:
    | "authorityChanged"
    | "expectedFenceMismatch"
    | "requestConflict"
    | "transitionInvalid"
    | "storedStateInvalid";
}> {}

type IdempotencyConflict = Extract<
  CreateStandardApplicationTaskRunError,
  { readonly _tag: "TaskRunCreationIdempotencyConflictError" }
>;
class IdempotencyConflictFailure extends Data.TaggedError(
  "TaskRunCreationIdempotencyConflictError",
)<{
  readonly requestKey: IdempotencyConflict["requestKey"];
  readonly reason: "request_digest_mismatch";
}> {}

type TransactionFailure = Exclude<
  CreateStandardApplicationTaskRunError,
  { readonly _tag: string }
>;
class LocatedTransactionFailure extends Error {
  override readonly name = "LocatedReadCommittedTransactionFailureV1";

  constructor(readonly issue: TransactionFailure["issue"]) {
    super("Located transaction failed.");
  }
}

const requestKey = Brand.nominal<IdempotencyConflict["requestKey"]>()(
  "task-admission-conflict",
);

describe("clean Task admission-error projection", () => {
  it.each([
    [new InputFailure({
      operation: "publish",
      reason: "invalidValue",
    }), "invalidInput"],
    [new IdentityFailure({
      operation: "issue",
      reason: "invalidIdentity",
    }), "invalidIdentity"],
    [new CompositionFailure({
      reason: "principalScopeMismatch",
    }), "invalidConfiguration"],
    [new ActivationFailure({
      operation: "read",
      reason: "activeMissing",
      retryable: false,
    }), "applicationUnavailable"],
    [new SelectionFailure({
      operation: "select",
      reason: "runtimeHostMismatch",
      retryable: false,
    }), "incompatibleRuntime"],
    [new CreationBindingFailure({
      operation: "create_run",
      reason: "definition_unavailable",
    }), "taskNotFound"],
    [new IdempotencyConflictFailure({
      requestKey,
      reason: "request_digest_mismatch",
    }), "idempotencyConflict"],
    [new ShaResourceFailure({
      reason: "unavailable",
    }), "unavailable"],
    [new CreationCorruptionFailure({
      operation: "create_run",
      reason: "database_clock_invalid",
    }), "corruptData"],
    [new CreationBindingFailure({
      operation: "create_run",
      reason: "authority_binding_mismatch",
    }), "staleScopeAuthority"],
    [new CreationTransientFailure({
      operation: "create_run",
      reason: "timeout",
      cause: null,
    }), "transient"],
    [new CreationTerminalFailure({
      operation: "create_run",
      reason: "unsupported_integration",
      cause: null,
    }), "terminal"],
    [new ReadinessFailure({
      operation: "readReady",
      reason: "decisionUncertain",
      retryable: false,
    }), "settlementUncertain"],
  ] as const satisfies readonly (readonly [
    CreateStandardApplicationTaskRunError,
    TaskAdmissionErrorReason,
  ])[])("maps $0 to %s", (source, reason) => {
    const projected = projectTaskAdmissionError(source);
    expect(projected).toMatchObject({
      _tag: "TaskAdmissionError",
      operation: "startTask",
      reason,
      cause: source,
    });
    expect(projected.cause).toBe(source);
  });

  it.each([
    ["invalidInput", false, "invalidInput"],
    ["invalidComposition", false, "invalidConfiguration"],
    ["notReady", false, "applicationUnavailable"],
    ["activeMissing", false, "applicationUnavailable"],
    ["alreadyActive", false, "transient"],
    ["expectedHead", false, "transient"],
    ["concurrentHead", false, "transient"],
    ["scopeAuthority", false, "staleScopeAuthority"],
    ["storedState", false, "corruptData"],
    ["decisionUncertain", false, "settlementUncertain"],
    ["resourceFailure", true, "transient"],
    ["resourceFailure", false, "unavailable"],
  ] as const satisfies readonly (readonly [
    ActivationFailure["reason"],
    boolean,
    TaskAdmissionErrorReason,
  ])[])(
    "maps activation reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: CreateStandardApplicationTaskRunError =
        new ActivationFailure({
          operation: "read",
          reason: sourceReason,
          retryable,
        });
      expect(projectTaskAdmissionError(source).reason).toBe(reason);
    },
  );

  it.each([
    ["invalidDeployment", "invalidConfiguration"],
    ["invalidManifest", "corruptData"],
    ["invalidSchema", "corruptData"],
    ["projectionMismatch", "corruptData"],
    ["resourceFailure", "unavailable"],
  ] as const satisfies readonly (readonly [
    SchemaAuthorityFailure["reason"],
    TaskAdmissionErrorReason,
  ])[])("maps schema authority reason %s", (sourceReason, reason) => {
    const source: CreateStandardApplicationTaskRunError =
      new SchemaAuthorityFailure({
        operation: "readPublished",
        reason: sourceReason,
      });
    expect(projectTaskAdmissionError(source).reason).toBe(reason);
  });

  it.each([
    ["invalidInput", false, "corruptData"],
    ["authorityChanged", false, "staleScopeAuthority"],
    ["storedState", false, "corruptData"],
    ["resourceFailure", true, "transient"],
    ["resourceFailure", false, "unavailable"],
  ] as const satisfies readonly (readonly [
    TaskCatalogFailure["reason"],
    boolean,
    TaskAdmissionErrorReason,
  ])[])(
    "maps Task catalog reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: CreateStandardApplicationTaskRunError =
        new TaskCatalogFailure({ reason: sourceReason, retryable });
      expect(projectTaskAdmissionError(source).reason).toBe(reason);
    },
  );

  it.each([
    ["invalidInput", false, "corruptData"],
    ["authorityChanged", false, "staleScopeAuthority"],
    ["storedState", false, "corruptData"],
    ["schemaBinding", false, "corruptData"],
    ["coldMaterialization", false, "corruptData"],
    ["conflictingReplay", false, "transient"],
    ["invalidComposition", false, "invalidConfiguration"],
    ["decisionUncertain", false, "settlementUncertain"],
    ["resourceFailure", true, "transient"],
    ["resourceFailure", false, "unavailable"],
  ] as const satisfies readonly (readonly [
    ReadinessFailure["reason"],
    boolean,
    TaskAdmissionErrorReason,
  ])[])(
    "maps readiness reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: CreateStandardApplicationTaskRunError =
        new ReadinessFailure({
          operation: "readReady",
          reason: sourceReason,
          retryable,
        });
      expect(projectTaskAdmissionError(source).reason).toBe(reason);
    },
  );

  it.each([
    ["invalidComposition", false, "invalidConfiguration"],
    ["invalidTaskId", false, "corruptData"],
    ["taskMissing", false, "taskNotFound"],
    ["storedTask", false, "corruptData"],
    ["authorityMismatch", false, "staleScopeAuthority"],
    ["runtimeHostMismatch", false, "incompatibleRuntime"],
    ["resourceFailure", true, "transient"],
    ["resourceFailure", false, "unavailable"],
  ] as const satisfies readonly (readonly [
    SelectionFailure["reason"],
    boolean,
    TaskAdmissionErrorReason,
  ])[])(
    "maps selection reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: CreateStandardApplicationTaskRunError =
        new SelectionFailure({
          operation: "select",
          reason: sourceReason,
          retryable,
        });
      expect(projectTaskAdmissionError(source).reason).toBe(reason);
    },
  );

  it.each([
    ["request_authority_mismatch", "staleScopeAuthority"],
    ["authority_binding_mismatch", "staleScopeAuthority"],
    ["definition_unavailable", "taskNotFound"],
    ["stored_binding_mismatch", "corruptData"],
  ] as const satisfies readonly (readonly [
    CreationBindingFailure["reason"],
    TaskAdmissionErrorReason,
  ])[])("maps creation binding reason %s", (sourceReason, reason) => {
    const source: CreateStandardApplicationTaskRunError =
      new CreationBindingFailure({
        operation: "create_run",
        reason: sourceReason,
      });
    expect(projectTaskAdmissionError(source).reason).toBe(reason);
  });

  it.each([
    ["authorityChanged", "staleScopeAuthority"],
    ["expectedFenceMismatch", "transient"],
    ["requestConflict", "transient"],
    ["transitionInvalid", "corruptData"],
    ["storedStateInvalid", "corruptData"],
  ] as const satisfies readonly (readonly [
    PhysicalDefinitionConflictFailure["reason"],
    TaskAdmissionErrorReason,
  ])[])(
    "maps physical-definition conflict reason %s",
    (sourceReason, reason) => {
      const source: CreateStandardApplicationTaskRunError =
        new PhysicalDefinitionConflictFailure({ reason: sourceReason });
      expect(projectTaskAdmissionError(source).reason).toBe(reason);
    },
  );

  it.each([
    ["infrastructureFailure", "unavailable"],
    ["callbackRolledBack", "unavailable"],
    ["callbackCleanupFailed", "settlementUncertain"],
    ["decisionUncertain", "settlementUncertain"],
  ] as const)("maps transaction issue %s", (kind, reason) => {
    const issue: TransactionFailure["issue"] = kind === "infrastructureFailure"
      ? { kind, phase: "acquire", cause: null }
      : kind === "callbackRolledBack"
      ? { kind, callbackCause: null }
      : kind === "callbackCleanupFailed"
      ? { kind, callbackCause: null, transactionCause: null }
      : { kind, settlementCause: null };
    const source: CreateStandardApplicationTaskRunError =
      new LocatedTransactionFailure(issue);
    const projected = projectTaskAdmissionError(source);
    expect(projected.reason).toBe(reason);
    expect(projected.cause).toBe(source);
  });
});

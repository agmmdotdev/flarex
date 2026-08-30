import type { InvokeApplicationActionError } from
  "@flarex/standard-application-invocation/internal/application-action-system";
import { Data } from "effect";
import { describe, expect, it } from "vitest";

import {
  projectActionInvocationError,
  type ActionInvocationErrorReason,
} from "../src/ActionInvocationError.js";

class ActionInputFailure extends Data.TaggedError(
  "ApplicationActionInputError",
)<{
  readonly field: "functionRef" | "args" | "requestKey";
  readonly cause?: unknown;
}> {}

class SystemConfigurationFailure extends Data.TaggedError(
  "ApplicationActionSystemConfigurationError",
)<{
  readonly reason: "invalidExecutionContext" | "invalidHostPolicy";
  readonly cause?: unknown;
}> {}

class SystemCorruptionFailure extends Data.TaggedError(
  "ApplicationActionSystemCorruptionError",
)<{
  readonly detail: "completedResultMissing" | "completedResultInvalid";
  readonly cause?: unknown;
}> {}

class AdmissionFailure extends Data.TaggedError(
  "ApplicationActionAdmissionError",
)<{
  readonly reason:
    | "invalidComposition"
    | "invalidFunction"
    | "functionMissing"
    | "functionUnsupported"
    | "storedFunction"
    | "authorityMismatch"
    | "invalidExecutionAuthority"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

class ActivationFailure extends Data.TaggedError(
  "ApplicationActivationError",
)<{
  readonly operation: "activate" | "read" | "validateSelection";
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

class BuildIntegrationFailure extends Data.TaggedError(
  "AppUniqueConstraintSetBuildIntegrationV1Error",
)<{
  readonly phase: "targetTransaction";
  readonly retryable: boolean;
  readonly cause: unknown;
}> {}

class RequestKeyConflictFailure extends Data.TaggedError(
  "ApplicationActionRequestKeyConflictV1Error",
)<{ readonly requestKey: string }> {}

class StaleAuthorityFailure extends Data.TaggedError(
  "ApplicationActionAuthorityStaleV1Error",
)<{
  readonly reason: "scope" | "epoch" | "storageGenerationFence" | "physicalLocator";
}> {}

class LifecycleConflictFailure extends Data.TaggedError(
  "ApplicationActionLifecycleConflictV1Error",
)<{
  readonly operation: string;
  readonly expected: string;
  readonly actual: string;
}> {}

class EligibilityFailure extends Data.TaggedError(
  "AppUniqueConstraintSetEligibilityV1Error",
)<{
  readonly reason: "invalidPort" | "scopeMismatch" | "targetTransaction";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

class HostCompositionFailure extends Data.TaggedError(
  "ApplicationActionHostCompositionError",
)<{
  readonly reason:
    | "invalidInput"
    | "authorityMismatch"
    | "invalidArguments"
    | "invalidResult"
    | "invalidBundle"
    | "settlementUnavailable";
  readonly cause?: unknown;
}> {}

class RunnerCompositionFailure extends Data.TaggedError(
  "ApplicationActionRunnerCompositionError",
)<{
  readonly reason:
    | "invalidAuthority"
    | "invalidManifest"
    | "invalidRequest"
    | "runtimeHostMismatch"
    | "compatibilityDateMismatch"
    | "hostPolicyMismatch"
    | "sourceReadFailed"
    | "workerDefinitionFailed";
  readonly cause?: unknown;
}> {}

class ExecutionHostFailure extends Data.TaggedError(
  "ApplicationExecutionHostError",
)<{
  readonly operation: "transaction" | "action";
  readonly reason:
    | "invalidRequest"
    | "workerLoadFailed"
    | "workerDefinitionFailed"
    | "readBoundaryFailed"
    | "journalBoundaryFailed"
    | "callbackFailed"
    | "applicationError"
    | "userCodeFailed"
    | "terminalFailed"
    | "invalidResult"
    | "timedOut";
  readonly cause?: unknown;
}> {}

class EvidenceProtocolFailure extends Data.TaggedError(
  "ExecutionEvidenceProtocolV1Error",
)<{
  readonly identity: "flarex.r2/execution-evidence-body/v1";
  readonly operation: "encode" | "decode" | "reference";
  readonly reason: "invalidInput" | "boundsExceeded" | "malformed" | "nonCanonical";
  readonly path: string;
}> {}

class BodyInputFailure extends Data.TaggedError(
  "ExecutionEvidenceBodyInputV1Error",
)<{
  readonly operation: "putImmutable" | "readImmutable";
  readonly field: "kind" | "bytes" | "reference" | "budget";
  readonly reason: "invalidInput" | "budgetExceeded";
}> {}

class BodyResourceFailure extends Data.TaggedError(
  "ExecutionEvidenceBodyResourceV1Error",
)<{
  readonly operation: "put" | "get" | "readBody";
  readonly key: string;
}> {}

class BodySettlementFailure extends Data.TaggedError(
  "ExecutionEvidenceBodySettlementUncertainV1Error",
)<{
  readonly key: string;
  readonly stage: "create" | "reconcileRead";
}> {}

type TransactionFailure = Exclude<
  InvokeApplicationActionError,
  { readonly _tag: string }
>;

class LocatedTransactionFailure extends Error {
  override readonly name = "LocatedReadCommittedTransactionFailureV1";

  constructor(readonly issue: TransactionFailure["issue"]) {
    super("Located transaction failed.");
  }
}

describe("clean Action invocation-error projection", () => {
  it.each([
    [new ActionInputFailure({ field: "args" }), "invalidInput"],
    [new AdmissionFailure({
      reason: "functionMissing",
      retryable: false,
    }), "actionNotFound"],
    [new ActivationFailure({
      operation: "read",
      reason: "activeMissing",
      retryable: false,
    }), "applicationUnavailable"],
    [new RequestKeyConflictFailure({
      requestKey: "deliver-message",
    }), "idempotencyConflict"],
    [new SystemConfigurationFailure({
      reason: "invalidHostPolicy",
    }), "invalidConfiguration"],
    [new RunnerCompositionFailure({
      reason: "runtimeHostMismatch",
    }), "incompatibleRuntime"],
    [new ExecutionHostFailure({
      operation: "action",
      reason: "applicationError",
    }), "applicationError"],
    [new ExecutionHostFailure({
      operation: "action",
      reason: "userCodeFailed",
    }), "executionFailed"],
    [new BodyResourceFailure({
      operation: "get",
      key: "action/body",
    }), "unavailable"],
    [new SystemCorruptionFailure({
      detail: "completedResultMissing",
    }), "corruptData"],
    [new StaleAuthorityFailure({ reason: "epoch" }), "staleScopeAuthority"],
    [new LifecycleConflictFailure({
      operation: "settle",
      expected: "executing",
      actual: "completed",
    }), "transient"],
    [new ExecutionHostFailure({
      operation: "action",
      reason: "timedOut",
    }), "terminal"],
    [new BodySettlementFailure({
      key: "action/body",
      stage: "create",
    }), "settlementUncertain"],
  ] as const satisfies readonly (readonly [
    InvokeApplicationActionError,
    ActionInvocationErrorReason,
  ])[])("maps $0 to %s", (source, reason) => {
    const projected = projectActionInvocationError(source);
    expect(projected).toMatchObject({
      _tag: "ActionInvocationError",
      operation: "runAction",
      reason,
      cause: source,
    });
    expect(projected.cause).toBe(source);
  });

  it.each([
    ["invalidComposition", false, "invalidConfiguration"],
    ["invalidFunction", false, "invalidInput"],
    ["functionMissing", false, "actionNotFound"],
    ["functionUnsupported", false, "incompatibleRuntime"],
    ["storedFunction", false, "corruptData"],
    ["authorityMismatch", false, "staleScopeAuthority"],
    ["invalidExecutionAuthority", false, "corruptData"],
    ["resourceFailure", true, "transient"],
    ["resourceFailure", false, "unavailable"],
  ] as const satisfies readonly (readonly [
    AdmissionFailure["reason"],
    boolean,
    ActionInvocationErrorReason,
  ])[])(
    "maps Action admission reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: InvokeApplicationActionError = new AdmissionFailure({
        reason: sourceReason,
        retryable,
      });
      expect(projectActionInvocationError(source).reason).toBe(reason);
    },
  );

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
    ActionInvocationErrorReason,
  ])[])(
    "maps activation reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: InvokeApplicationActionError = new ActivationFailure({
        operation: "read",
        reason: sourceReason,
        retryable,
      });
      expect(projectActionInvocationError(source).reason).toBe(reason);
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
    ActionInvocationErrorReason,
  ])[])(
    "maps readiness reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: InvokeApplicationActionError = new ReadinessFailure({
        operation: "readReady",
        reason: sourceReason,
        retryable,
      });
      const projected = projectActionInvocationError(source);
      expect(projected.reason).toBe(reason);
      expect(projected.cause).toBe(source);
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
    ActionInvocationErrorReason,
  ])[])("maps schema authority reason %s", (sourceReason, reason) => {
    const source: InvokeApplicationActionError =
      new SchemaAuthorityFailure({
        operation: "readPublished",
        reason: sourceReason,
      });
    const projected = projectActionInvocationError(source);
    expect(projected.reason).toBe(reason);
    expect(projected.cause).toBe(source);
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
    ActionInvocationErrorReason,
  ])[])(
    "maps Task catalog reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: InvokeApplicationActionError = new TaskCatalogFailure({
        reason: sourceReason,
        retryable,
      });
      const projected = projectActionInvocationError(source);
      expect(projected.reason).toBe(reason);
      expect(projected.cause).toBe(source);
    },
  );

  it.each([
    ["authorityChanged", "staleScopeAuthority"],
    ["expectedFenceMismatch", "transient"],
    ["requestConflict", "transient"],
    ["transitionInvalid", "corruptData"],
    ["storedStateInvalid", "corruptData"],
  ] as const satisfies readonly (readonly [
    PhysicalDefinitionConflictFailure["reason"],
    ActionInvocationErrorReason,
  ])[])(
    "maps physical-definition conflict reason %s",
    (sourceReason, reason) => {
      const source: InvokeApplicationActionError =
        new PhysicalDefinitionConflictFailure({ reason: sourceReason });
      const projected = projectActionInvocationError(source);
      expect(projected.reason).toBe(reason);
      expect(projected.cause).toBe(source);
    },
  );

  it.each([
    [true, "transient"],
    [false, "unavailable"],
  ] as const)("maps build integration retryable=%s", (retryable, reason) => {
    const source: InvokeApplicationActionError = new BuildIntegrationFailure({
      phase: "targetTransaction",
      retryable,
      cause: null,
    });
    const projected = projectActionInvocationError(source);
    expect(projected.reason).toBe(reason);
    expect(projected.cause).toBe(source);
  });

  it.each([
    ["invalidInput", "corruptData"],
    ["authorityMismatch", "staleScopeAuthority"],
    ["invalidArguments", "corruptData"],
    ["invalidResult", "corruptData"],
    ["invalidBundle", "corruptData"],
    ["settlementUnavailable", "settlementUncertain"],
  ] as const satisfies readonly (readonly [
    HostCompositionFailure["reason"],
    ActionInvocationErrorReason,
  ])[])("maps host composition reason %s", (sourceReason, reason) => {
    const source: InvokeApplicationActionError = new HostCompositionFailure({
      reason: sourceReason,
    });
    expect(projectActionInvocationError(source).reason).toBe(reason);
  });

  it.each([
    ["invalidAuthority", "staleScopeAuthority"],
    ["invalidManifest", "corruptData"],
    ["invalidRequest", "corruptData"],
    ["runtimeHostMismatch", "incompatibleRuntime"],
    ["compatibilityDateMismatch", "incompatibleRuntime"],
    ["hostPolicyMismatch", "invalidConfiguration"],
    ["sourceReadFailed", "unavailable"],
    ["workerDefinitionFailed", "unavailable"],
  ] as const satisfies readonly (readonly [
    RunnerCompositionFailure["reason"],
    ActionInvocationErrorReason,
  ])[])("maps runner composition reason %s", (sourceReason, reason) => {
    const source: InvokeApplicationActionError = new RunnerCompositionFailure({
      reason: sourceReason,
    });
    expect(projectActionInvocationError(source).reason).toBe(reason);
  });

  it.each([
    ["invalidPort", false, null, "invalidConfiguration"],
    ["scopeMismatch", false, null, "staleScopeAuthority"],
    ["targetTransaction", true, new LocatedTransactionFailure({
      kind: "infrastructureFailure",
      phase: "acquire",
      cause: null,
    }), "transient"],
    ["targetTransaction", false, new LocatedTransactionFailure({
      kind: "decisionUncertain",
      settlementCause: null,
    }), "settlementUncertain"],
    [
      "targetTransaction",
      false,
      new Error("database unavailable"),
      "unavailable",
    ],
  ] as const satisfies readonly (readonly [
    EligibilityFailure["reason"],
    boolean,
    unknown,
    ActionInvocationErrorReason,
  ])[])(
    "maps unique-constraint eligibility reason %s with retryable=%s",
    (sourceReason, retryable, cause, reason) => {
      const source: InvokeApplicationActionError = new EligibilityFailure({
        reason: sourceReason,
        retryable,
        cause,
      });
      const projected = projectActionInvocationError(source);
      expect(projected.reason).toBe(reason);
      expect(projected.cause).toBe(source);
    },
  );

  it.each([
    ["invalidRequest", "corruptData"],
    ["workerLoadFailed", "unavailable"],
    ["workerDefinitionFailed", "unavailable"],
    ["readBoundaryFailed", "unavailable"],
    ["journalBoundaryFailed", "unavailable"],
    ["callbackFailed", "settlementUncertain"],
    ["applicationError", "applicationError"],
    ["userCodeFailed", "executionFailed"],
    ["terminalFailed", "terminal"],
    ["invalidResult", "corruptData"],
    ["timedOut", "terminal"],
  ] as const satisfies readonly (readonly [
    ExecutionHostFailure["reason"],
    ActionInvocationErrorReason,
  ])[])("maps execution-host reason %s", (sourceReason, reason) => {
    const source: InvokeApplicationActionError = new ExecutionHostFailure({
      operation: "action",
      reason: sourceReason,
    });
    expect(projectActionInvocationError(source).reason).toBe(reason);
  });

  it.each([
    ["invalidInput", "invalidInput"],
    ["boundsExceeded", "invalidInput"],
    ["malformed", "corruptData"],
    ["nonCanonical", "corruptData"],
  ] as const satisfies readonly (readonly [
    EvidenceProtocolFailure["reason"],
    ActionInvocationErrorReason,
  ])[])("maps evidence-protocol reason %s", (sourceReason, reason) => {
    const source: InvokeApplicationActionError = new EvidenceProtocolFailure({
      identity: "flarex.r2/execution-evidence-body/v1",
      operation: "encode",
      reason: sourceReason,
      path: "$",
    });
    expect(projectActionInvocationError(source).reason).toBe(reason);
  });

  it.each([
    ["invalidInput", "invalidInput"],
    ["budgetExceeded", "invalidInput"],
  ] as const satisfies readonly (readonly [
    BodyInputFailure["reason"],
    ActionInvocationErrorReason,
  ])[])("maps evidence-body input reason %s", (sourceReason, reason) => {
    const source: InvokeApplicationActionError = new BodyInputFailure({
      operation: "putImmutable",
      field: "bytes",
      reason: sourceReason,
    });
    expect(projectActionInvocationError(source).reason).toBe(reason);
  });

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
    const source: InvokeApplicationActionError =
      new LocatedTransactionFailure(issue);
    const projected = projectActionInvocationError(source);
    expect(projected.reason).toBe(reason);
    expect(projected.cause).toBe(source);
  });
});

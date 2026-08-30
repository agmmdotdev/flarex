import type { InvokeApplicationQueryError } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { Data } from "effect";
import { describe, expect, it } from "vitest";

import {
  projectQueryInvocationError,
  type QueryInvocationErrorReason,
} from "../src/QueryInvocationError.js";

class QueryInputFailure extends Data.TaggedError("ApplicationQueryInputError")<{
  readonly reason: "invalidFunction" | "invalidArguments" | "invalidIdentity";
  readonly cause?: unknown;
}> {}

class QueryCompositionFailure extends Data.TaggedError(
  "ApplicationQueryCompositionError",
)<{
  readonly reason:
    | "invalidExecutionContext"
    | "invalidTarget"
    | "sourceReadFailed"
    | "workerDefinitionFailed";
  readonly cause?: unknown;
}> {}

class QuerySnapshotFailure extends Data.TaggedError(
  "ApplicationQuerySnapshotError",
)<{
  readonly operation: "open" | "revalidate" | "pointRead" | "indexRead";
  readonly reason:
    | "invalidComposition"
    | "invalidInput"
    | "unsupportedTarget"
    | "functionMissing"
    | "functionUnsupported"
    | "storedFunction"
    | "schemaMismatch"
    | "indexMissing"
    | "indexUnavailable"
    | "historyUnavailable"
    | "budgetExceeded"
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

class EligibilityFailure extends Data.TaggedError(
  "AppUniqueConstraintSetEligibilityV1Error",
)<{
  readonly reason: "invalidPort" | "scopeMismatch" | "targetTransaction";
  readonly retryable: boolean;
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

type TransactionFailure = Exclude<
  InvokeApplicationQueryError,
  { readonly _tag: string }
>;

type NestedQueryOwnerError = Extract<
  InvokeApplicationQueryError,
  {
    readonly _tag:
      | "ApplicationQueryInputError"
      | "ApplicationQueryCompositionError"
      | "ApplicationQuerySnapshotError"
      | "ApplicationActivationError"
      | "ApplicationReadinessError"
      | "ApplicationSchemaAuthorityError"
      | "ApplicationTaskCatalogSnapshotError"
      | "AppUniqueConstraintSetBuildIntegrationV1Error"
      | "AppUniqueConstraintSetEligibilityV1Error"
      | "PhysicalDefinitionLifecycleConflictError"
      | "ApplicationExecutionHostError";
  }
>;

type DirectQueryOwnerError = Exclude<
  Extract<InvokeApplicationQueryError, { readonly _tag: string }>,
  NestedQueryOwnerError
>;

type DirectQueryOwnerTag = DirectQueryOwnerError["_tag"];

const DIRECT_QUERY_OWNER_REASON = Object.freeze({
  TrustedScopeAuthorityResolutionError: "staleScopeAuthority",
  ScopeClockNotFoundError: "staleScopeAuthority",
  ScopeExecutionAuthorityError: "staleScopeAuthority",
  AppUniqueConstraintSetBuildStaleAuthorityV1Error: "staleScopeAuthority",
  TrustedScopeAuthorityPortError: "unavailable",
  ScopeAuthorizationRevocationEpochPersistenceError: "unavailable",
  AppIndexDefinitionReadPersistenceError: "unavailable",
  AppSchemaVersionIndexBindingPersistenceError: "unavailable",
  AppUniqueConstraintCatalogPersistenceError: "unavailable",
  AppUniqueConstraintSetClosurePersistenceV1Error: "unavailable",
  PhysicalDefinitionLifecyclePersistenceError: "unavailable",
  SchemaVersionArtifactPersistenceError: "unavailable",
  ScopeClockCorruptionError: "corruptData",
  AppIndexDefinitionCatalogCorruptionError: "corruptData",
  AppUniqueConstraintCatalogCorruptionError: "corruptData",
  AppUniqueConstraintSetBuildStateV1Error: "corruptData",
  AppUniqueConstraintSetClosureCorruptionV1Error: "corruptData",
  IndexBuildReconciliationCatalogV1Error: "corruptData",
  InvalidAppIndexDefinitionBindingInputError: "corruptData",
  InvalidPhysicalDefinitionLifecycleInputError: "corruptData",
  InvalidPreparedPhysicalDefinitionLifecycleReadinessError: "corruptData",
  InvalidSchemaVersionArtifactInputError: "corruptData",
  SchemaVersionArtifactCorruptionError: "corruptData",
  InvalidPhysicalDefinitionLifecyclePortError: "invalidConfiguration",
  PointCommitUniqueConstraintEligibilityUnavailableV1Error:
    "invalidConfiguration",
} as const satisfies Readonly<
  Record<DirectQueryOwnerTag, QueryInvocationErrorReason>
>);

function directQueryOwnerFailure<Tag extends DirectQueryOwnerTag>(
  tag: Tag,
): Extract<DirectQueryOwnerError, { readonly _tag: Tag }> {
  const failure = Object.assign(new Error(`Synthetic ${tag}.`), { _tag: tag });
  // SAFETY: these projector branches deliberately consume only the exact tag;
  // the exhaustive record above is the compile-time owner-union proof.
  return failure as Extract<DirectQueryOwnerError, { readonly _tag: Tag }>;
}

class LocatedTransactionFailure extends Error {
  override readonly name = "LocatedReadCommittedTransactionFailureV1";

  constructor(readonly issue: TransactionFailure["issue"]) {
    super("Located transaction failed.");
  }
}

describe("clean Query invocation-error projection", () => {
  it.each(Object.entries(DIRECT_QUERY_OWNER_REASON))(
    "maps direct owner tag %s",
    (sourceTag, reason) => {
      const source = directQueryOwnerFailure(
        sourceTag as DirectQueryOwnerTag,
      );
      const projected = projectQueryInvocationError(source);
      expect(projected.reason).toBe(reason);
      expect(projected.cause).toBe(source);
    },
  );

  it.each([
    [new QueryInputFailure({ reason: "invalidArguments" }), "invalidInput"],
    [new QueryInputFailure({ reason: "invalidIdentity" }), "invalidIdentity"],
    [new QuerySnapshotFailure({
      operation: "open",
      reason: "functionMissing",
      retryable: false,
    }), "queryNotFound"],
    [new ActivationFailure({
      operation: "read",
      reason: "activeMissing",
      retryable: false,
    }), "applicationUnavailable"],
    [new QueryCompositionFailure({
      reason: "invalidTarget",
    }), "invalidConfiguration"],
    [new QuerySnapshotFailure({
      operation: "open",
      reason: "unsupportedTarget",
      retryable: false,
    }), "incompatibleRuntime"],
    [new QuerySnapshotFailure({
      operation: "open",
      reason: "indexMissing",
      retryable: false,
    }), "indexUnavailable"],
    [new QuerySnapshotFailure({
      operation: "open",
      reason: "historyUnavailable",
      retryable: false,
    }), "historyUnavailable"],
    [new QuerySnapshotFailure({
      operation: "open",
      reason: "budgetExceeded",
      retryable: false,
    }), "budgetExceeded"],
    [new ExecutionHostFailure({
      operation: "transaction",
      reason: "applicationError",
    }), "applicationError"],
    [new ExecutionHostFailure({
      operation: "transaction",
      reason: "userCodeFailed",
    }), "executionFailed"],
    [new QueryCompositionFailure({
      reason: "sourceReadFailed",
    }), "unavailable"],
    [new QuerySnapshotFailure({
      operation: "open",
      reason: "storedFunction",
      retryable: false,
    }), "corruptData"],
    [new EligibilityFailure({
      reason: "scopeMismatch",
      retryable: false,
    }), "staleScopeAuthority"],
    [new QuerySnapshotFailure({
      operation: "open",
      reason: "resourceFailure",
      retryable: true,
    }), "transient"],
    [new ExecutionHostFailure({
      operation: "transaction",
      reason: "timedOut",
    }), "terminal"],
    [new ActivationFailure({
      operation: "read",
      reason: "decisionUncertain",
      retryable: false,
    }), "settlementUncertain"],
  ] as const satisfies readonly (readonly [
    InvokeApplicationQueryError,
    QueryInvocationErrorReason,
  ])[])("maps $0 to %s", (source, reason) => {
    const projected = projectQueryInvocationError(source);
    expect(projected).toMatchObject({
      _tag: "QueryInvocationError",
      operation: "runQuery",
      reason,
      cause: source,
    });
    expect(projected.cause).toBe(source);
  });

  it.each([
    ["invalidFunction", "invalidInput"],
    ["invalidArguments", "invalidInput"],
    ["invalidIdentity", "invalidIdentity"],
  ] as const satisfies readonly (readonly [
    QueryInputFailure["reason"],
    QueryInvocationErrorReason,
  ])[])("maps Query input reason %s", (sourceReason, reason) => {
    expect(projectQueryInvocationError(
      new QueryInputFailure({ reason: sourceReason }),
    ).reason).toBe(reason);
  });

  it.each([
    ["invalidExecutionContext", "invalidConfiguration"],
    ["invalidTarget", "invalidConfiguration"],
    ["sourceReadFailed", "unavailable"],
    ["workerDefinitionFailed", "unavailable"],
  ] as const satisfies readonly (readonly [
    QueryCompositionFailure["reason"],
    QueryInvocationErrorReason,
  ])[])("maps Query composition reason %s", (sourceReason, reason) => {
    expect(projectQueryInvocationError(
      new QueryCompositionFailure({ reason: sourceReason }),
    ).reason).toBe(reason);
  });

  it.each([
    ["invalidComposition", false, "invalidConfiguration"],
    ["invalidInput", false, "invalidInput"],
    ["unsupportedTarget", false, "incompatibleRuntime"],
    ["functionMissing", false, "queryNotFound"],
    ["functionUnsupported", false, "incompatibleRuntime"],
    ["storedFunction", false, "corruptData"],
    ["schemaMismatch", false, "corruptData"],
    ["indexMissing", false, "indexUnavailable"],
    ["indexUnavailable", false, "indexUnavailable"],
    ["historyUnavailable", false, "historyUnavailable"],
    ["budgetExceeded", false, "budgetExceeded"],
    ["resourceFailure", true, "transient"],
    ["resourceFailure", false, "unavailable"],
  ] as const satisfies readonly (readonly [
    QuerySnapshotFailure["reason"],
    boolean,
    QueryInvocationErrorReason,
  ])[])(
    "maps Query snapshot reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: InvokeApplicationQueryError = new QuerySnapshotFailure({
        operation: "open",
        reason: sourceReason,
        retryable,
      });
      const projected = projectQueryInvocationError(source);
      expect(projected.reason).toBe(reason);
      expect(projected.cause).toBe(source);
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
    QueryInvocationErrorReason,
  ])[])(
    "maps activation reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: InvokeApplicationQueryError = new ActivationFailure({
        operation: "read",
        reason: sourceReason,
        retryable,
      });
      expect(projectQueryInvocationError(source).reason).toBe(reason);
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
    QueryInvocationErrorReason,
  ])[])(
    "maps readiness reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      const source: InvokeApplicationQueryError = new ReadinessFailure({
        operation: "readReady",
        reason: sourceReason,
        retryable,
      });
      expect(projectQueryInvocationError(source).reason).toBe(reason);
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
    QueryInvocationErrorReason,
  ])[])("maps schema authority reason %s", (sourceReason, reason) => {
    expect(projectQueryInvocationError(new SchemaAuthorityFailure({
      operation: "readPublished",
      reason: sourceReason,
    })).reason).toBe(reason);
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
    QueryInvocationErrorReason,
  ])[])(
    "maps Task catalog reason %s with retryable=%s",
    (sourceReason, retryable, reason) => {
      expect(projectQueryInvocationError(new TaskCatalogFailure({
        reason: sourceReason,
        retryable,
      })).reason).toBe(reason);
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
    QueryInvocationErrorReason,
  ])[])("maps physical-definition conflict reason %s", (sourceReason, reason) => {
    expect(projectQueryInvocationError(
      new PhysicalDefinitionConflictFailure({ reason: sourceReason }),
    ).reason).toBe(reason);
  });

  it.each([
    [true, "transient"],
    [false, "unavailable"],
  ] as const)("maps build integration retryable=%s", (retryable, reason) => {
    const source: InvokeApplicationQueryError = new BuildIntegrationFailure({
      phase: "targetTransaction",
      retryable,
      cause: null,
    });
    const projected = projectQueryInvocationError(source);
    expect(projected.reason).toBe(reason);
    expect(projected.cause).toBe(source);
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
    ["targetTransaction", false, new Error("database unavailable"), "unavailable"],
  ] as const satisfies readonly (readonly [
    EligibilityFailure["reason"],
    boolean,
    unknown,
    QueryInvocationErrorReason,
  ])[])(
    "maps unique-constraint eligibility reason %s with retryable=%s",
    (sourceReason, retryable, cause, reason) => {
      const source: InvokeApplicationQueryError = new EligibilityFailure({
        reason: sourceReason,
        retryable,
        cause,
      });
      const projected = projectQueryInvocationError(source);
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
    ["callbackFailed", "executionFailed"],
    ["applicationError", "applicationError"],
    ["userCodeFailed", "executionFailed"],
    ["terminalFailed", "terminal"],
    ["invalidResult", "corruptData"],
    ["timedOut", "terminal"],
  ] as const satisfies readonly (readonly [
    ExecutionHostFailure["reason"],
    QueryInvocationErrorReason,
  ])[])("maps execution-host reason %s", (sourceReason, reason) => {
    expect(projectQueryInvocationError(new ExecutionHostFailure({
      operation: "transaction",
      reason: sourceReason,
    })).reason).toBe(reason);
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
    const source: InvokeApplicationQueryError =
      new LocatedTransactionFailure(issue);
    const projected = projectQueryInvocationError(source);
    expect(projected.reason).toBe(reason);
    expect(projected.cause).toBe(source);
  });
});

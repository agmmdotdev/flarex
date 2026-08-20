import {
  type ApplicationTaskComputeDispatchRequestV1,
  validateApplicationTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, desc, eq, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  encodeExternalEffectExecutionSubjectV1,
  type ExternalEffectExecutionSubjectFrameV1,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  applicationTaskMutationRequestKeyV1FromDigest,
  encodeApplicationTaskMutationStableKeyPreimageV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import {
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import type { ScopeId } from "flarex-protocol/storage-authority";

import type { AppRowTransaction } from "./appRows";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import {
  runLocatedEffectQuery,
  runLocatedEffectTransaction,
} from "./locatedEffectTransaction";
import { getScopeClock } from "./scopeClock";
import {
  fxSystemDurableTaskAttemptIdentitiesV1,
  fxSystemDurableTaskRunsV1,
  fxSystemExternalEffectAttemptsV1,
  fxSystemScopeClocks,
} from "./schema";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import type { ScopePhysicalLocator } from "./scopeMetadataTypes";
import { captureScopePhysicalLocator } from "./scopePhysicalLocator";
import { scopePhysicalLocatorsEqual } from "./scopePhysicalLocator";
import { decodeAndCorrelateTaskSystemRunRowV1 } from "./taskSystemRunRowV1";
import {
  createDefaultLocatedReadCommittedTransactionRunnerV1,
} from "./transactionSessionActivation";
import {
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
  type RunLocatedReadCommittedTransactionV1,
} from "./transactionSessionAttemptKernel";

const TASK_EXTERNAL_EFFECT_TARGET_DB: unique symbol = Symbol(
  "FlarexDB/taskExternalEffectAuthorityTargetDb",
);
const MAX_TEXT_BYTES = 2_048;
const MAX_POSITIVE_INT64 = (1n << 63n) - 1n;
const UTF8 = new TextEncoder();
const decodeTransactionFunctionPath = Schema.decodeUnknownResult(
  TransactionFunctionPathV1Schema,
);
const decodeTransactionRequestKey = Schema.decodeUnknownResult(
  TransactionRequestKeyV1Schema,
);

export interface LocatedTaskExternalEffectAuthorityTarget
  extends LocatedReadCommittedAttemptTargetV1 {
  readonly [TASK_EXTERNAL_EFFECT_TARGET_DB]: FlarexMetadataDatabase;
}

export function createLocatedTaskExternalEffectAuthorityTarget(
  db: FlarexMetadataDatabase,
  physicalLocator: ScopePhysicalLocator,
  runReadCommitted: RunLocatedReadCommittedTransactionV1 =
    createDefaultLocatedReadCommittedTransactionRunnerV1(db),
): LocatedTaskExternalEffectAuthorityTarget {
  return Object.freeze({
    physicalLocator: captureScopePhysicalLocator(physicalLocator),
    getCurrentClock: (scopeId: ScopeId) => getScopeClock(db, scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: runReadCommitted,
    [TASK_EXTERNAL_EFFECT_TARGET_DB]: db,
  });
}

export interface TaskExternalEffectAuthoritySha256<HashError> {
  readonly hash: (bytes: Uint8Array) => Effect.Effect<Uint8Array, HashError>;
}

export type TaskExternalEffectAuthorityTransactionStep =
  | "afterPrepareInsert"
  | "afterDispatchUpdate"
  | "afterFailedBeforeDispatchUpdate"
  | "afterUncertainUpdate"
  | "afterConfirmationUpdate";

export interface TaskExternalEffectAuthorityContext {
  readonly target: LocatedTaskExternalEffectAuthorityTarget;
  readonly authority: TrustedScopeAuthority;
  readonly proofAfterTransactionStep?: (
    step: TaskExternalEffectAuthorityTransactionStep,
  ) => void;
}

export interface TaskExternalEffectAuthorityHashContext<HashError>
  extends TaskExternalEffectAuthorityContext {
  readonly sha256: TaskExternalEffectAuthoritySha256<HashError>;
}

export interface ApplicationTaskExternalEffectSubject {
  readonly _ApplicationTaskExternalEffectSubject: unique symbol;
}

interface ApplicationTaskExternalEffectSubjectState {
  readonly scopeId: ScopeId;
  readonly runId: ApplicationTaskComputeDispatchRequestV1["identity"]["runId"];
  readonly attemptId:
    ApplicationTaskComputeDispatchRequestV1["identity"]["attemptId"];
  readonly attemptNumber: ApplicationTaskComputeDispatchRequestV1["attemptNumber"];
  readonly executionFence:
    ApplicationTaskComputeDispatchRequestV1["identity"]["executionFence"];
  readonly applicationTaskRuntimeTargetSha256: Uint8Array;
  readonly subjectIdentitySha256: Uint8Array;
}

export interface TaskChildMutationEffectInput {
  readonly effectOrdinal: bigint;
  readonly requestIdentitySha256: Uint8Array;
  readonly functionPath: TransactionFunctionPathV1;
  readonly argumentsSha256: Uint8Array;
}

interface PreparedTaskChildMutationEffectInput
  extends TaskChildMutationEffectInput {
  readonly stableRequestKey: TransactionRequestKeyV1;
}

export type TaskExternalEffectAttemptState =
  | "prepared"
  | "failed_before_dispatch"
  | "dispatching"
  | "confirmed"
  | "uncertain";

export interface TaskChildMutationEffectProjection {
  readonly scopeId: ScopeId;
  readonly subjectIdentitySha256: Uint8Array;
  readonly subjectFence: bigint;
  readonly effectOrdinal: bigint;
  readonly stableRequestKey: TransactionRequestKeyV1;
  readonly requestIdentitySha256: Uint8Array;
  readonly functionPath: TransactionFunctionPathV1;
  readonly argumentsSha256: Uint8Array;
  readonly state: TaskExternalEffectAttemptState;
  readonly preparedAt: Date;
  readonly dispatchDeclaredAt: Date | null;
  readonly settledAt: Date | null;
  readonly outcomeSha256: Uint8Array | null;
  readonly terminalCode: string | null;
}

export interface TaskExternalEffectOperationReceipt {
  readonly disposition: "applied" | "replayed";
  readonly effect: TaskChildMutationEffectProjection;
}

export type TaskExternalEffectAuthorityOperation =
  | "issue"
  | "prepare"
  | "declare_dispatch"
  | "fail_before_dispatch"
  | "mark_uncertain"
  | "confirm";

export class TaskExternalEffectAuthorityInputError extends Data.TaggedError(
  "TaskExternalEffectAuthorityInputError",
)<{
  readonly operation: TaskExternalEffectAuthorityOperation;
  readonly field: string;
  readonly cause?: unknown;
}> {}

export class TaskExternalEffectAuthorityStaleError extends Data.TaggedError(
  "TaskExternalEffectAuthorityStaleError",
)<{
  readonly reason:
    | "scope"
    | "epoch"
    | "storage_generation_fence"
    | "physical_locator"
    | "run_missing"
    | "definition_generation"
    | "runtime_target"
    | "attempt"
    | "execution_fence"
    | "lease"
    | "phase";
}> {}

export class InvalidApplicationTaskExternalEffectSubjectError
  extends Data.TaggedError("InvalidApplicationTaskExternalEffectSubjectError")<{
    readonly reason: "not_issued" | "revoked" | "scope_mismatch";
  }> {}

export class TaskExternalEffectSequenceConflictError extends Data.TaggedError(
  "TaskExternalEffectSequenceConflictError",
)<{
  readonly expectedOrdinal: bigint;
  readonly suppliedOrdinal: bigint;
}> {}

export class TaskExternalEffectRequestConflictError extends Data.TaggedError(
  "TaskExternalEffectRequestConflictError",
)<{ readonly effectOrdinal: bigint; readonly field: string }> {}

export class TaskExternalEffectLifecycleConflictError extends Data.TaggedError(
  "TaskExternalEffectLifecycleConflictError",
)<{
  readonly operation: TaskExternalEffectAuthorityOperation;
  readonly expected: string;
  readonly actual: string;
}> {}

export class TaskExternalEffectAuthorityCorruptionError extends Data.TaggedError(
  "TaskExternalEffectAuthorityCorruptionError",
)<{ readonly detail: string }> {}

export class TaskExternalEffectAuthorityIntegrationError
  extends Data.TaggedError("TaskExternalEffectAuthorityIntegrationError")<{
    readonly operation: string;
    readonly cause: unknown;
  }> {}

export type IssueApplicationTaskExternalEffectSubjectError<HashError> =
  | TaskExternalEffectAuthorityInputError
  | TaskExternalEffectAuthorityStaleError
  | TaskExternalEffectAuthorityCorruptionError
  | TaskExternalEffectAuthorityIntegrationError
  | HashError;

export type PrepareTaskChildMutationEffectError<HashError> =
  | TaskExternalEffectAuthorityInputError
  | TaskExternalEffectAuthorityStaleError
  | InvalidApplicationTaskExternalEffectSubjectError
  | TaskExternalEffectSequenceConflictError
  | TaskExternalEffectRequestConflictError
  | TaskExternalEffectAuthorityCorruptionError
  | TaskExternalEffectAuthorityIntegrationError
  | HashError;

type TaskChildMutationEffectTransitionBaseError =
  | TaskExternalEffectAuthorityInputError
  | TaskExternalEffectAuthorityStaleError
  | InvalidApplicationTaskExternalEffectSubjectError
  | TaskExternalEffectLifecycleConflictError
  | TaskExternalEffectAuthorityCorruptionError
  | TaskExternalEffectAuthorityIntegrationError;

export type DeclareTaskChildMutationDispatchError =
  TaskChildMutationEffectTransitionBaseError;

export type ReconcileTaskChildMutationEffectError =
  | TaskChildMutationEffectTransitionBaseError
  | TaskExternalEffectRequestConflictError;

const subjectStates = new WeakMap<
  ApplicationTaskExternalEffectSubject,
  ApplicationTaskExternalEffectSubjectState
>();

export const issueApplicationTaskExternalEffectSubject = Effect.fn(
  "TaskExternalEffectAuthority.issue",
)(function* <HashError>(
  suppliedDispatch: unknown,
  context: TaskExternalEffectAuthorityHashContext<HashError>,
): Effect.fn.Return<
  ApplicationTaskExternalEffectSubject,
  IssueApplicationTaskExternalEffectSubjectError<HashError>
> {
  const dispatch = yield* Effect.fromResult(
    validateApplicationTaskComputeDispatchRequestV1(suppliedDispatch).pipe(
      Result.mapError(cause => new TaskExternalEffectAuthorityInputError({
        operation: "issue",
        field: "dispatch",
        cause,
      })),
    ),
  );
  if (dispatch.identity.scopeId !== context.authority.scopeId) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "scope",
    });
  }
  const runtimeTargetSha256 = copyBytes(
    dispatch.applicationTaskRuntimeTargetSha256,
  );
  const subjectFrame: ExternalEffectExecutionSubjectFrameV1 = Object.freeze({
    kind: "durable_task_attempt",
    scopeId: dispatch.identity.scopeId,
    runId: dispatch.identity.runId,
    attemptId: dispatch.identity.attemptId,
    taskDefinitionRevisionSha256: copyBytes(runtimeTargetSha256),
  });
  const encodedSubject = yield* Effect.fromResult(
    encodeExternalEffectExecutionSubjectV1(subjectFrame),
  ).pipe(Effect.mapError(() =>
    new TaskExternalEffectAuthorityCorruptionError({
      detail: "Task external-effect subject encoding failed",
    })
  ));
  const suppliedSubjectIdentitySha256 = yield* context.sha256.hash(
    copyBytes(encodedSubject.canonicalBytes),
  );
  if (!isUint8ArrayWithByteLength(suppliedSubjectIdentitySha256, 32)) {
    return yield* new TaskExternalEffectAuthorityCorruptionError({
      detail: "Task external-effect subject hash is not 32 bytes",
    });
  }
  const subjectIdentitySha256 = copyBytes(suppliedSubjectIdentitySha256);
  return yield* Effect.uninterruptible(Effect.gen(function* () {
    yield* runTransaction(context, "issue", tx => Effect.gen(function* () {
      yield* requireCurrentAuthority(tx, context);
      const run = yield* loadRunForUpdate(
        tx,
        dispatch.identity.scopeId,
        dispatch.identity.runId,
      );
      yield* requireDispatchMatchesRun(tx, run, dispatch, true);
      yield* requireAttemptIdentity(tx, dispatch);
    }));
    // SAFETY: the empty frozen handle carries no structural authority; only
    // WeakMap membership established below authenticates this capability.
    const subject = Object.freeze({}) as ApplicationTaskExternalEffectSubject;
    subjectStates.set(subject, Object.freeze({
      scopeId: dispatch.identity.scopeId,
      runId: dispatch.identity.runId,
      attemptId: dispatch.identity.attemptId,
      attemptNumber: dispatch.attemptNumber,
      executionFence: dispatch.identity.executionFence,
      applicationTaskRuntimeTargetSha256: copyBytes(runtimeTargetSha256),
      subjectIdentitySha256: copyBytes(subjectIdentitySha256),
    }));
    return subject;
  }));
});

export function revokeApplicationTaskExternalEffectSubject(
  subject: ApplicationTaskExternalEffectSubject,
): void {
  subjectStates.delete(subject);
}

export const prepareTaskChildMutationEffect = Effect.fn(
  "TaskExternalEffectAuthority.prepare",
)(function* <HashError>(
  suppliedSubject: ApplicationTaskExternalEffectSubject,
  suppliedInput: unknown,
  context: TaskExternalEffectAuthorityHashContext<HashError>,
): Effect.fn.Return<
  TaskExternalEffectOperationReceipt,
  PrepareTaskChildMutationEffectError<HashError>
> {
  const subject = yield* claimSubject(
    suppliedSubject,
    context.authority.scopeId,
  );
  const capturedInput = yield* capturePrepareInput(suppliedInput);
  const stableRequestKey = yield* deriveStableRequestKey(
    subject,
    capturedInput.effectOrdinal,
    context.sha256,
  );
  const input: PreparedTaskChildMutationEffectInput = Object.freeze({
    ...capturedInput,
    stableRequestKey,
  });
  return yield* runTransaction(context, "prepare", tx => Effect.gen(function* () {
    yield* requireCurrentSubjectParent(tx, subject, context, "live_lease");
    const current = yield* loadEffectIfPresentForUpdate(
      tx,
      subject,
      input.effectOrdinal,
    );
    if (current !== undefined) {
      const projection = yield* decodeTaskEffectRow(current);
      yield* requireEffectMatchesInput(projection, input);
      return operationReceipt("replayed", projection);
    }
    const previous = yield* loadLastEffectOrdinal(tx, subject);
    const expectedOrdinal = previous === undefined ? 1n : previous + 1n;
    if (
      expectedOrdinal > MAX_POSITIVE_INT64 ||
      input.effectOrdinal !== expectedOrdinal
    ) {
      return yield* new TaskExternalEffectSequenceConflictError({
        expectedOrdinal,
        suppliedOrdinal: input.effectOrdinal,
      });
    }
    const rows = yield* query(
      "prepare_insert",
      tx.insert(fxSystemExternalEffectAttemptsV1).values({
        scopeId: subject.scopeId,
        subjectKind: "durable_task_attempt",
        subjectIdentitySha256: subject.subjectIdentitySha256,
        subjectFence: subject.executionFence,
        effectOrdinal: input.effectOrdinal,
        effectKind: "child_mutation",
        stableEffectKey: input.stableRequestKey,
        requestIdentitySha256: input.requestIdentitySha256,
        childMutationRequestKey: input.stableRequestKey,
        childMutationFunctionPath: input.functionPath,
        childMutationArgumentsSha256: input.argumentsSha256,
        state: "prepared",
      }).returning(),
    );
    if (rows[0] === undefined) {
      return yield* corruption("Task external-effect insert returned no row");
    }
    yield* proofStep(context, "afterPrepareInsert");
    return operationReceipt(
      "applied",
      yield* decodeTaskEffectRow(rows[0]),
    );
  }));
});

const declareTaskChildMutationDispatchTransition = transitionTaskEffect(
  "declare_dispatch",
  "prepared",
  "dispatching",
  "afterDispatchUpdate",
  () => Effect.succeed(undefined),
);
const failTaskChildMutationBeforeDispatchTransition = transitionTaskEffect(
  "fail_before_dispatch",
  "prepared",
  "failed_before_dispatch",
  "afterFailedBeforeDispatchUpdate",
  (projection, terminalCode) =>
    projection.terminalCode === terminalCode
      ? Effect.succeed(undefined)
      : requestConflict(projection.effectOrdinal, "terminalCode"),
);
const markTaskChildMutationUncertainTransition = transitionTaskEffect(
  "mark_uncertain",
  "dispatching",
  "uncertain",
  "afterUncertainUpdate",
  (projection, terminalCode) =>
    projection.terminalCode === terminalCode
      ? Effect.succeed(undefined)
      : requestConflict(projection.effectOrdinal, "terminalCode"),
);

export const declareTaskChildMutationDispatch = Effect.fn(
  "TaskExternalEffectAuthority.declareDispatch",
)(function* (
  subject: ApplicationTaskExternalEffectSubject,
  effectOrdinal: unknown,
  context: TaskExternalEffectAuthorityContext,
): Effect.fn.Return<
  TaskExternalEffectOperationReceipt,
  DeclareTaskChildMutationDispatchError
> {
  return yield* declareTaskChildMutationDispatchTransition(
    subject,
    effectOrdinal,
    context,
  );
});

export const failTaskChildMutationBeforeDispatch = Effect.fn(
  "TaskExternalEffectAuthority.failBeforeDispatch",
)(function* (
  subject: ApplicationTaskExternalEffectSubject,
  effectOrdinal: unknown,
  terminalCode: unknown,
  context: TaskExternalEffectAuthorityContext,
): Effect.fn.Return<
  TaskExternalEffectOperationReceipt,
  ReconcileTaskChildMutationEffectError
> {
  const capturedTerminalCode = yield* requireText(
    terminalCode,
    "fail_before_dispatch",
    "terminalCode",
  );
  return yield* failTaskChildMutationBeforeDispatchTransition(
    subject,
    effectOrdinal,
    context,
    capturedTerminalCode,
  );
});

export const markTaskChildMutationUncertain = Effect.fn(
  "TaskExternalEffectAuthority.markUncertain",
)(function* (
  subject: ApplicationTaskExternalEffectSubject,
  effectOrdinal: unknown,
  terminalCode: unknown,
  context: TaskExternalEffectAuthorityContext,
): Effect.fn.Return<
  TaskExternalEffectOperationReceipt,
  ReconcileTaskChildMutationEffectError
> {
  const capturedTerminalCode = yield* requireText(
    terminalCode,
    "mark_uncertain",
    "terminalCode",
  );
  return yield* markTaskChildMutationUncertainTransition(
    subject,
    effectOrdinal,
    context,
    capturedTerminalCode,
  );
});

export const confirmTaskChildMutationEffect = Effect.fn(
  "TaskExternalEffectAuthority.confirm",
)(function* (
  suppliedSubject: ApplicationTaskExternalEffectSubject,
  suppliedEffectOrdinal: unknown,
  suppliedOutcomeSha256: unknown,
  context: TaskExternalEffectAuthorityContext,
): Effect.fn.Return<
  TaskExternalEffectOperationReceipt,
  ReconcileTaskChildMutationEffectError
> {
  const subject = yield* claimSubject(
    suppliedSubject,
    context.authority.scopeId,
  );
  const effectOrdinal = yield* requireOrdinal(
    suppliedEffectOrdinal,
    "confirm",
  );
  const outcomeSha256 = yield* requireDigest(
    suppliedOutcomeSha256,
    "confirm",
    "outcomeSha256",
  );
  return yield* runTransaction(context, "confirm", tx => Effect.gen(function* () {
    yield* requireCurrentSubjectParent(tx, subject, context, "settlement");
    const current = yield* loadEffectForUpdate(
      tx,
      subject,
      effectOrdinal,
      "confirm",
      "dispatching",
    );
    const projection = yield* decodeTaskEffectRow(current);
    if (projection.state === "confirmed") {
      if (
        projection.outcomeSha256 !== null &&
        bytesEqualFullScan(projection.outcomeSha256, outcomeSha256)
      ) return operationReceipt("replayed", projection);
      return yield* requestConflict(effectOrdinal, "outcomeSha256");
    }
    if (projection.state !== "dispatching") {
      return yield* lifecycleConflict(
        "confirm",
        "dispatching",
        projection.state,
      );
    }
    const rows = yield* query(
      "confirm_update",
      tx.update(fxSystemExternalEffectAttemptsV1).set({
        state: "confirmed",
        settledAt: sql`current_timestamp`,
        childMutationOutcomeSha256: outcomeSha256,
      }).where(effectWhere(subject, effectOrdinal, "dispatching")).returning(),
    );
    if (rows[0] === undefined) {
      return yield* lifecycleConflict(
        "confirm",
        "dispatching",
        "concurrent_transition",
      );
    }
    yield* proofStep(context, "afterConfirmationUpdate");
    return operationReceipt(
      "applied",
      yield* decodeTaskEffectRow(rows[0]),
    );
  }));
});

function transitionTaskEffect<ReplayError>(
  operation: Exclude<TaskExternalEffectAuthorityOperation, "issue" | "prepare" | "confirm">,
  expected: TaskExternalEffectAttemptState,
  next: TaskExternalEffectAttemptState,
  step: TaskExternalEffectAuthorityTransactionStep,
  reconcileReplay: (
    projection: TaskChildMutationEffectProjection,
    terminalCode: string | undefined,
  ) => Effect.Effect<void, ReplayError>,
) {
  return Effect.fn(`TaskExternalEffectAuthority.${operation}`)(
    function* (
      suppliedSubject: ApplicationTaskExternalEffectSubject,
      suppliedEffectOrdinal: unknown,
      context: TaskExternalEffectAuthorityContext,
      terminalCode?: string,
    ): Effect.fn.Return<
      TaskExternalEffectOperationReceipt,
      TaskChildMutationEffectTransitionBaseError | ReplayError
    > {
      const subject = yield* claimSubject(
        suppliedSubject,
        context.authority.scopeId,
      );
      const effectOrdinal = yield* requireOrdinal(
        suppliedEffectOrdinal,
        operation,
      );
      return yield* runTransaction(context, operation, tx => Effect.gen(function* () {
        yield* requireCurrentSubjectParent(
          tx,
          subject,
          context,
          operation === "declare_dispatch" ? "live_lease" : "settlement",
        );
        const current = yield* loadEffectForUpdate(
          tx,
          subject,
          effectOrdinal,
          operation,
          expected,
        );
        const projection = yield* decodeTaskEffectRow(current);
        if (projection.state === next) {
          yield* reconcileReplay(projection, terminalCode);
          return operationReceipt("replayed", projection);
        }
        if (
          operation === "declare_dispatch" &&
          (projection.state === "confirmed" || projection.state === "uncertain")
        ) return operationReceipt("replayed", projection);
        if (projection.state !== expected) {
          return yield* lifecycleConflict(
            operation,
            expected,
            projection.state,
          );
        }
        const rows = yield* query(
          `${operation}_update`,
          tx.update(fxSystemExternalEffectAttemptsV1).set({
            state: next,
            ...(next === "dispatching"
              ? { dispatchDeclaredAt: sql`current_timestamp` }
              : {}),
            ...(next === "failed_before_dispatch" || next === "uncertain"
              ? { settledAt: sql`current_timestamp`, terminalCode }
              : {}),
          }).where(effectWhere(subject, effectOrdinal, expected)).returning(),
        );
        if (rows[0] === undefined) {
          return yield* lifecycleConflict(
            operation,
            expected,
            "concurrent_transition",
          );
        }
        yield* proofStep(context, step);
        return operationReceipt(
          "applied",
          yield* decodeTaskEffectRow(rows[0]),
        );
      }));
    },
  );
}

type RunRow = typeof fxSystemDurableTaskRunsV1.$inferSelect;
type EffectRow = typeof fxSystemExternalEffectAttemptsV1.$inferSelect;

const requireCurrentSubjectParent = Effect.fn(
  "TaskExternalEffectAuthority.requireCurrentSubjectParent",
)(function* (
  tx: AppRowTransaction,
  subject: ApplicationTaskExternalEffectSubjectState,
  context: TaskExternalEffectAuthorityContext,
  leaseRequirement: "live_lease" | "settlement",
) {
  yield* requireCurrentAuthority(tx, context);
  const run = yield* loadRunForUpdate(tx, subject.scopeId, subject.runId);
  yield* requireSubjectMatchesRun(subject, run);
  if (leaseRequirement === "live_lease") yield* requireLiveLease(tx, run);
});

const requireDispatchMatchesRun = Effect.fn(
  "TaskExternalEffectAuthority.requireDispatchMatchesRun",
)(function* (
  tx: AppRowTransaction,
  row: RunRow,
  dispatch: ApplicationTaskComputeDispatchRequestV1,
  allowAttemptGranted: boolean,
): Effect.fn.Return<
  void,
  TaskExternalEffectAuthorityStaleError |
    TaskExternalEffectAuthorityCorruptionError |
    TaskExternalEffectAuthorityIntegrationError
> {
  yield* decodeCorrelatedApplicationRun(row);
  if (row.definitionGeneration !== "application_v1") {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "definition_generation",
    });
  }
  if (!isUint8ArrayWithByteLength(row.applicationTaskRuntimeTargetSha256, 32)) {
    return yield* corruption(
      "Application Task run is missing its runtime target digest",
    );
  }
  if (!bytesEqualFullScan(
    row.applicationTaskRuntimeTargetSha256,
    dispatch.applicationTaskRuntimeTargetSha256,
  )) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "runtime_target",
    });
  }
  if (row.currentAttemptId !== dispatch.identity.attemptId) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "attempt",
    });
  }
  if (row.executionFenceBasis !== dispatch.identity.executionFence) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "execution_fence",
    });
  }
  if (
    row.phase !== "executing" &&
    !(allowAttemptGranted && row.phase === "attempt_granted")
  ) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "phase",
    });
  }
  yield* requireLiveLease(tx, row);
});

const requireLiveLease = Effect.fn(
  "TaskExternalEffectAuthority.requireLiveLease",
)(function* (
  tx: AppRowTransaction,
  row: RunRow,
): Effect.fn.Return<
  void,
  TaskExternalEffectAuthorityStaleError |
    TaskExternalEffectAuthorityCorruptionError |
    TaskExternalEffectAuthorityIntegrationError
> {
  if (row.currentLeaseExpiresAtMs === null) {
    return yield* corruption(
      "Active Task external-effect parent is missing its lease expiry",
    );
  }
  const rows = yield* query(
    "lease_time_read",
    tx.select({ now: sql<Date>`clock_timestamp()` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, row.scopeId))
      .limit(1),
  );
  const now = databaseTimestampFromUnknown(rows[0]?.now);
  if (now === null) {
    return yield* corruption(
      "Task external-effect lease time query returned an invalid timestamp",
    );
  }
  if (BigInt(now.getTime()) >= row.currentLeaseExpiresAtMs) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "lease",
    });
  }
});

const requireSubjectMatchesRun = Effect.fn(
  "TaskExternalEffectAuthority.requireSubjectMatchesRun",
)(function* (
  subject: ApplicationTaskExternalEffectSubjectState,
  row: RunRow,
) {
  yield* decodeCorrelatedApplicationRun(row);
  if (row.definitionGeneration !== "application_v1") {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "definition_generation",
    });
  }
  if (!isUint8ArrayWithByteLength(row.applicationTaskRuntimeTargetSha256, 32)) {
    return yield* corruption(
      "Application Task run is missing its runtime target digest",
    );
  }
  if (!bytesEqualFullScan(
    row.applicationTaskRuntimeTargetSha256,
    subject.applicationTaskRuntimeTargetSha256,
  )) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "runtime_target",
    });
  }
  if (row.currentAttemptId !== subject.attemptId) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "attempt",
    });
  }
  if (row.executionFenceBasis !== subject.executionFence) {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "execution_fence",
    });
  }
  if (row.phase !== "executing") {
    return yield* new TaskExternalEffectAuthorityStaleError({
      reason: "phase",
    });
  }
});

function decodeCorrelatedApplicationRun(row: RunRow) {
  return Effect.fromResult(
    decodeAndCorrelateTaskSystemRunRowV1(row),
  ).pipe(
    Effect.mapError(reason =>
      new TaskExternalEffectAuthorityCorruptionError({
        detail: `Task run aggregate/projection correlation failed: ${reason}`,
      })
    ),
    Effect.flatMap(decoded => decoded.generation === "application_v1"
      ? Effect.succeed(decoded.aggregate)
      : corruption("Task external-effect subject resolved to a Legacy run")),
  );
}

function requireAttemptIdentity(
  tx: AppRowTransaction,
  dispatch: ApplicationTaskComputeDispatchRequestV1,
) {
  return query(
    "attempt_identity_read",
    tx.select().from(fxSystemDurableTaskAttemptIdentitiesV1).where(and(
      eq(
        fxSystemDurableTaskAttemptIdentitiesV1.scopeId,
        dispatch.identity.scopeId,
      ),
      eq(
        fxSystemDurableTaskAttemptIdentitiesV1.attemptId,
        dispatch.identity.attemptId,
      ),
    )).for("share").limit(1),
  ).pipe(Effect.flatMap(rows => {
    const row = rows[0];
    if (row === undefined || row.runId !== dispatch.identity.runId) {
      return Effect.fail(new TaskExternalEffectAuthorityStaleError({
        reason: "attempt",
      }));
    }
    if (row.executionFence !== dispatch.identity.executionFence) {
      return Effect.fail(new TaskExternalEffectAuthorityStaleError({
        reason: "execution_fence",
      }));
    }
    return row.attemptNumber === dispatch.attemptNumber
      ? Effect.void
      : Effect.fail(new TaskExternalEffectAuthorityStaleError({
          reason: "attempt",
        }));
  }));
}

function loadRunForUpdate(
  tx: AppRowTransaction,
  scopeId: ScopeId,
  runId: ApplicationTaskExternalEffectSubjectState["runId"],
) {
  return query(
    "run_for_update_read",
    tx.select().from(fxSystemDurableTaskRunsV1).where(and(
      eq(fxSystemDurableTaskRunsV1.scopeId, scopeId),
      eq(fxSystemDurableTaskRunsV1.runId, runId),
    )).for("update").limit(1),
  ).pipe(Effect.flatMap(rows => rows[0] === undefined
    ? Effect.fail(new TaskExternalEffectAuthorityStaleError({
        reason: "run_missing",
      }))
    : Effect.succeed(rows[0])));
}

function loadEffectIfPresentForUpdate(
  tx: AppRowTransaction,
  subject: ApplicationTaskExternalEffectSubjectState,
  effectOrdinal: bigint,
) {
  return query(
    "effect_for_update_read",
    tx.select().from(fxSystemExternalEffectAttemptsV1).where(
      effectWhere(subject, effectOrdinal),
    ).for("update").limit(1),
  ).pipe(Effect.map(rows => rows[0]));
}

function loadEffectForUpdate(
  tx: AppRowTransaction,
  subject: ApplicationTaskExternalEffectSubjectState,
  effectOrdinal: bigint,
  operation: TaskExternalEffectAuthorityOperation,
  expected: TaskExternalEffectAttemptState,
) {
  return loadEffectIfPresentForUpdate(tx, subject, effectOrdinal).pipe(
    Effect.flatMap(row => row === undefined
      ? lifecycleConflict(operation, expected, "missing")
      : Effect.succeed(row)),
  );
}

function loadLastEffectOrdinal(
  tx: AppRowTransaction,
  subject: ApplicationTaskExternalEffectSubjectState,
) {
  return query(
    "last_effect_ordinal_read",
    tx.select({ effectOrdinal: fxSystemExternalEffectAttemptsV1.effectOrdinal })
      .from(fxSystemExternalEffectAttemptsV1).where(and(
        eq(fxSystemExternalEffectAttemptsV1.scopeId, subject.scopeId),
        eq(fxSystemExternalEffectAttemptsV1.subjectKind, "durable_task_attempt"),
        eq(
          fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
          subject.subjectIdentitySha256,
        ),
        eq(fxSystemExternalEffectAttemptsV1.subjectFence, subject.executionFence),
      )).orderBy(desc(fxSystemExternalEffectAttemptsV1.effectOrdinal)).limit(1),
  ).pipe(Effect.map(rows => rows[0]?.effectOrdinal));
}

function effectWhere(
  subject: ApplicationTaskExternalEffectSubjectState,
  effectOrdinal: bigint,
  state?: TaskExternalEffectAttemptState,
) {
  return and(
    eq(fxSystemExternalEffectAttemptsV1.scopeId, subject.scopeId),
    eq(fxSystemExternalEffectAttemptsV1.subjectKind, "durable_task_attempt"),
    eq(
      fxSystemExternalEffectAttemptsV1.subjectIdentitySha256,
      subject.subjectIdentitySha256,
    ),
    eq(fxSystemExternalEffectAttemptsV1.subjectFence, subject.executionFence),
    eq(fxSystemExternalEffectAttemptsV1.effectOrdinal, effectOrdinal),
    ...(state === undefined
      ? []
      : [eq(fxSystemExternalEffectAttemptsV1.state, state)]),
  );
}

function requireCurrentAuthority(
  tx: AppRowTransaction,
  context: TaskExternalEffectAuthorityContext,
) {
  const authority = context.authority;
  if (!scopePhysicalLocatorsEqual(
    context.target.physicalLocator,
    authority.physicalLocator,
  )) {
    return Effect.fail(new TaskExternalEffectAuthorityStaleError({
      reason: "physical_locator",
    }));
  }
  return query(
    "scope_authority_read",
    tx.select({
      epoch: fxSystemScopeClocks.epoch,
      storageGeneration: fxSystemScopeClocks.storageGeneration,
      storageGenerationFence: fxSystemScopeClocks.storageGenerationFence,
    }).from(fxSystemScopeClocks).where(
      eq(fxSystemScopeClocks.scopeId, authority.scopeId),
    ).for("update").limit(1),
  ).pipe(Effect.flatMap(rows => {
    const row = rows[0];
    if (row === undefined || row.storageGeneration !== "flarexdb_v1") {
      return Effect.fail(new TaskExternalEffectAuthorityStaleError({
        reason: "scope",
      }));
    }
    if (row.epoch !== authority.epoch) {
      return Effect.fail(new TaskExternalEffectAuthorityStaleError({
        reason: "epoch",
      }));
    }
    return row.storageGenerationFence === authority.storageGenerationFence
      ? Effect.void
      : Effect.fail(new TaskExternalEffectAuthorityStaleError({
          reason: "storage_generation_fence",
        }));
  }));
}

function capturePrepareInput(
  supplied: unknown,
): Effect.Effect<TaskChildMutationEffectInput, TaskExternalEffectAuthorityInputError> {
  return Effect.fromResult(Result.gen(function* () {
    const record = yield* captureExactRecord(supplied, [
      "effectOrdinal",
      "requestIdentitySha256",
      "functionPath",
      "argumentsSha256",
    ], "prepare");
    const effectOrdinal = yield* captureOrdinalResult(
      record.effectOrdinal,
      "prepare",
    );
    const requestIdentitySha256 = yield* captureDigestResult(
      record.requestIdentitySha256,
      "prepare",
      "requestIdentitySha256",
    );
    const functionPathText = yield* captureTextResult(
      record.functionPath,
      "prepare",
      "functionPath",
    );
    const functionPath = yield* decodeTransactionFunctionPath(
      functionPathText,
    ).pipe(Result.mapError(cause => new TaskExternalEffectAuthorityInputError({
      operation: "prepare",
      field: "functionPath",
      cause,
    })));
    const argumentsSha256 = yield* captureDigestResult(
      record.argumentsSha256,
      "prepare",
      "argumentsSha256",
    );
    return Object.freeze({
      effectOrdinal,
      requestIdentitySha256,
      functionPath,
      argumentsSha256,
    });
  }));
}

function captureExactRecord<const Keys extends ReadonlyArray<string>>(
  supplied: unknown,
  keys: Keys,
  operation: TaskExternalEffectAuthorityOperation,
): Result.Result<
  Readonly<Record<Keys[number], unknown>>,
  TaskExternalEffectAuthorityInputError
> {
  try {
    if (!isNonArrayRecord(supplied)) {
      return inputFailure(operation, "$input");
    }
    const ownKeys = Reflect.ownKeys(supplied);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some(key => typeof key !== "string" || !keys.includes(key))
    ) return inputFailure(operation, "$input");
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(supplied, key);
      if (
        descriptor === undefined || descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) return inputFailure(operation, key);
      Object.defineProperty(captured, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    // SAFETY: every requested literal key was captured as an own enumerable
    // data property and all additional keys were rejected above.
    return Result.succeed(
      Object.freeze(captured) as Readonly<Record<Keys[number], unknown>>,
    );
  } catch (cause) {
    return Result.fail(new TaskExternalEffectAuthorityInputError({
      operation,
      field: "$input",
      cause,
    }));
  }
}

function captureOrdinalResult(
  value: unknown,
  operation: TaskExternalEffectAuthorityOperation,
) {
  return typeof value === "bigint" && value >= 1n &&
      value <= MAX_POSITIVE_INT64
    ? Result.succeed(value)
    : inputFailure(operation, "effectOrdinal");
}

function captureTextResult(
  value: unknown,
  operation: TaskExternalEffectAuthorityOperation,
  field: string,
) {
  if (typeof value !== "string" || value.length > MAX_TEXT_BYTES) {
    return inputFailure(operation, field);
  }
  return isNonBlankString(value) && !value.includes("\0") &&
      hasWellFormedUtf16(value) &&
      UTF8.encode(value).byteLength <= MAX_TEXT_BYTES
    ? Result.succeed(value)
    : inputFailure(operation, field);
}

function captureDigestResult(
  value: unknown,
  operation: TaskExternalEffectAuthorityOperation,
  field: string,
) {
  return isUint8ArrayWithByteLength(value, 32)
    ? Result.try({
        try: () => copyBytes(value),
        catch: cause => new TaskExternalEffectAuthorityInputError({
          operation,
          field,
          cause,
        }),
      })
    : inputFailure(operation, field);
}

function requireOrdinal(
  value: unknown,
  operation: TaskExternalEffectAuthorityOperation,
) {
  return Effect.fromResult(captureOrdinalResult(value, operation));
}

function requireText(
  value: unknown,
  operation: TaskExternalEffectAuthorityOperation,
  field: string,
) {
  return Effect.fromResult(captureTextResult(value, operation, field));
}

function requireDigest(
  value: unknown,
  operation: TaskExternalEffectAuthorityOperation,
  field: string,
) {
  return Effect.fromResult(captureDigestResult(value, operation, field));
}

function claimSubject(
  value: unknown,
  scopeId: ScopeId,
): Effect.Effect<
  ApplicationTaskExternalEffectSubjectState,
  InvalidApplicationTaskExternalEffectSubjectError
> {
  if (typeof value !== "object" || value === null) {
    return Effect.fail(new InvalidApplicationTaskExternalEffectSubjectError({
      reason: "not_issued",
    }));
  }
  // SAFETY: WeakMap lookup is the authority check; structural object shape does
  // not authenticate the supplied value and cannot create a matching entry.
  const state = subjectStates.get(value as ApplicationTaskExternalEffectSubject);
  if (state === undefined) {
    return Effect.fail(new InvalidApplicationTaskExternalEffectSubjectError({
      reason: "revoked",
    }));
  }
  return state.scopeId === scopeId
    ? Effect.succeed(state)
    : Effect.fail(new InvalidApplicationTaskExternalEffectSubjectError({
        reason: "scope_mismatch",
      }));
}

function requireEffectMatchesInput(
  projection: TaskChildMutationEffectProjection,
  input: PreparedTaskChildMutationEffectInput,
) {
  if (projection.stableRequestKey !== input.stableRequestKey) {
    return requestConflict(input.effectOrdinal, "stableRequestKey");
  }
  if (!bytesEqualFullScan(
    projection.requestIdentitySha256,
    input.requestIdentitySha256,
  )) return requestConflict(input.effectOrdinal, "requestIdentitySha256");
  if (projection.functionPath !== input.functionPath) {
    return requestConflict(input.effectOrdinal, "functionPath");
  }
  return bytesEqualFullScan(projection.argumentsSha256, input.argumentsSha256)
    ? Effect.void
    : requestConflict(input.effectOrdinal, "argumentsSha256");
}

const deriveStableRequestKey = Effect.fn(
  "TaskExternalEffectAuthority.deriveStableRequestKey",
)(function* <HashError>(
  subject: ApplicationTaskExternalEffectSubjectState,
  effectOrdinal: bigint,
  sha256: TaskExternalEffectAuthoritySha256<HashError>,
) {
  const preimage = yield* Effect.fromResult(
    encodeApplicationTaskMutationStableKeyPreimageV1({
      scopeId: subject.scopeId,
      runId: subject.runId,
      operationOrdinal: effectOrdinal,
    }),
  ).pipe(Effect.mapError(() =>
    new TaskExternalEffectAuthorityCorruptionError({
      detail: "Task mutation stable-key preimage encoding failed",
    })
  ));
  const suppliedDigest = yield* sha256.hash(copyBytes(preimage.canonicalBytes));
  if (!isUint8ArrayWithByteLength(suppliedDigest, 32)) {
    return yield* new TaskExternalEffectAuthorityCorruptionError({
      detail: "Task mutation stable-key hash is not 32 bytes",
    });
  }
  return yield* Effect.fromResult(
    applicationTaskMutationRequestKeyV1FromDigest(suppliedDigest),
  ).pipe(Effect.mapError(() =>
    new TaskExternalEffectAuthorityCorruptionError({
      detail: "Task mutation stable request-key projection failed",
    })
  ));
});

function decodeTaskEffectRow(
  row: EffectRow,
): Effect.Effect<
  TaskChildMutationEffectProjection,
  TaskExternalEffectAuthorityCorruptionError
> {
  const outcomeSha256 = row.childMutationOutcomeSha256;
  const argumentsSha256 = row.childMutationArgumentsSha256;
  const preparedAt = databaseDate(row.preparedAt);
  const dispatchDeclaredAt = nullableDatabaseDate(row.dispatchDeclaredAt);
  const settledAt = nullableDatabaseDate(row.settledAt);
  if (
    row.subjectKind !== "durable_task_attempt" ||
    row.effectKind !== "child_mutation" ||
    preparedAt === undefined || dispatchDeclaredAt === undefined ||
    settledAt === undefined ||
    row.subjectFence < 1n || row.effectOrdinal < 1n ||
    !isUint8ArrayWithByteLength(row.subjectIdentitySha256, 32) ||
    !isUint8ArrayWithByteLength(row.requestIdentitySha256, 32) ||
    row.childMutationRequestKey === null ||
    row.childMutationFunctionPath === null ||
    !isUint8ArrayWithByteLength(argumentsSha256, 32) ||
    row.stableEffectKey !== row.childMutationRequestKey ||
    (row.state === "confirmed" &&
      !isUint8ArrayWithByteLength(outcomeSha256, 32)) ||
    (row.state !== "confirmed" && outcomeSha256 !== null)
  ) return corruption("Task external-effect row is malformed");
  if (!taskEffectStateShapeIsValid(
    row.state,
    preparedAt,
    dispatchDeclaredAt,
    settledAt,
    row.terminalCode,
  )) return corruption("Task external-effect lifecycle state is malformed");
  return Effect.fromResult(Result.gen(function* () {
    const stableRequestKey = yield* decodeTransactionRequestKey(
      row.childMutationRequestKey,
    );
    if (!/^task-mutation:v1:[0-9a-f]{64}$/.test(stableRequestKey)) {
      return yield* Result.fail("invalid Task mutation request key");
    }
    const functionPath = yield* decodeTransactionFunctionPath(
      row.childMutationFunctionPath,
    );
    return Object.freeze({
      scopeId: row.scopeId,
      subjectIdentitySha256: copyBytes(row.subjectIdentitySha256),
      subjectFence: row.subjectFence,
      effectOrdinal: row.effectOrdinal,
      stableRequestKey,
      requestIdentitySha256: copyBytes(row.requestIdentitySha256),
      functionPath,
      argumentsSha256: copyBytes(argumentsSha256),
      state: row.state,
      preparedAt,
      dispatchDeclaredAt,
      settledAt,
      outcomeSha256: outcomeSha256 === null
        ? null
        : copyBytes(outcomeSha256),
      terminalCode: row.terminalCode,
    });
  })).pipe(Effect.mapError(() =>
    new TaskExternalEffectAuthorityCorruptionError({
      detail: "Task external-effect row contains invalid branded text",
    })
  ));
}

function taskEffectStateShapeIsValid(
  state: TaskExternalEffectAttemptState,
  preparedAt: Date,
  dispatchDeclaredAt: Date | null,
  settledAt: Date | null,
  terminalCode: string | null,
): boolean {
  if (
    (dispatchDeclaredAt !== null && dispatchDeclaredAt < preparedAt) ||
    (settledAt !== null && settledAt < preparedAt)
  ) return false;
  switch (state) {
    case "prepared":
      return dispatchDeclaredAt === null && settledAt === null &&
        terminalCode === null;
    case "failed_before_dispatch":
      return dispatchDeclaredAt === null && settledAt !== null &&
        isStoredTerminalCode(terminalCode);
    case "dispatching":
      return dispatchDeclaredAt !== null && settledAt === null &&
        terminalCode === null;
    case "uncertain":
      return dispatchDeclaredAt !== null && settledAt !== null &&
        isStoredTerminalCode(terminalCode);
    case "confirmed":
      return dispatchDeclaredAt !== null && settledAt !== null &&
        terminalCode === null;
  }
}

function isStoredTerminalCode(value: string | null): value is string {
  return typeof value === "string" && value.length <= MAX_TEXT_BYTES &&
    isNonBlankString(value) && !value.includes("\0") &&
    hasWellFormedUtf16(value) && UTF8.encode(value).byteLength <= MAX_TEXT_BYTES;
}

function hasWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function databaseDate(value: unknown): Date | undefined {
  return databaseTimestampFromUnknown(value) ?? undefined;
}

function nullableDatabaseDate(value: unknown): Date | null | undefined {
  return value === null ? null : databaseDate(value);
}

function operationReceipt(
  disposition: TaskExternalEffectOperationReceipt["disposition"],
  effect: TaskChildMutationEffectProjection,
): TaskExternalEffectOperationReceipt {
  return Object.freeze({ disposition, effect });
}

function proofStep(
  context: TaskExternalEffectAuthorityContext,
  step: TaskExternalEffectAuthorityTransactionStep,
) {
  return Effect.sync(() => context.proofAfterTransactionStep?.(step));
}

function inputFailure(
  operation: TaskExternalEffectAuthorityOperation,
  field: string,
): Result.Result<never, TaskExternalEffectAuthorityInputError> {
  return Result.fail(new TaskExternalEffectAuthorityInputError({
    operation,
    field,
  }));
}

function requestConflict(effectOrdinal: bigint, field: string) {
  return Effect.fail(new TaskExternalEffectRequestConflictError({
    effectOrdinal,
    field,
  }));
}

function lifecycleConflict(
  operation: TaskExternalEffectAuthorityOperation,
  expected: string,
  actual: string,
) {
  return Effect.fail(new TaskExternalEffectLifecycleConflictError({
    operation,
    expected,
    actual,
  }));
}

function corruption(detail: string) {
  return Effect.fail(new TaskExternalEffectAuthorityCorruptionError({ detail }));
}

function query<Row>(
  operation: string,
  queryValue: PromiseLike<ReadonlyArray<Row>>,
) {
  return runLocatedEffectQuery(
    queryValue,
    operation,
    (failureOperation, cause) =>
      new TaskExternalEffectAuthorityIntegrationError({
        operation: failureOperation,
        cause,
      }),
  );
}

function runTransaction<Value, Failure>(
  context: TaskExternalEffectAuthorityContext,
  operation: string,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
) {
  return runLocatedEffectTransaction(
    context.target,
    operation,
    work,
    (failureOperation, cause) =>
      new TaskExternalEffectAuthorityIntegrationError({
        operation: failureOperation,
        cause,
      }),
    "Task external-effect transaction rolled back.",
  );
}

import type {
  TaskSystemWakeSchedulerRepairDirectoryContinuationV1,
  TaskSystemWakeSchedulerRepairDirectoryErrorV1,
  TaskSystemWakeSchedulerRepairDirectoryItemV1,
} from "@flarex/persistence-postgres/internal/task-wake-scheduler-repair-directory-v1";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Clock, Data, Duration, Effect, Result } from "effect";

type ReadyPartitionV1 = Extract<
  TaskSystemWakeSchedulerRepairDirectoryItemV1,
  { readonly kind: "ready" }
>;
type SchedulerRequestV1 = Parameters<ReadyPartitionV1["scheduler"]["run"]>[0];
type DueKindV1 = SchedulerRequestV1["dueKind"];
type DueCursorV1 = NonNullable<SchedulerRequestV1["cursor"]>;
type RepairScopeIdV1 = ReadyPartitionV1["scopeId"];
type DirectoryHighWaterScopeIdV1 =
  TaskSystemWakeSchedulerRepairDirectoryContinuationV1["highWaterScopeId"];
type SchedulerReceiptV1 = Effect.Success<
  ReturnType<ReadyPartitionV1["scheduler"]["run"]>
>;
type RepairReadyItemV1<SchedulerFailure> = Extract<
  TaskRepairSweepDirectoryItemV1<SchedulerFailure>,
  { readonly kind: "ready" }
>;

export interface TaskRepairSweepSchedulerV1<Failure> {
  readonly run: (
    request: SchedulerRequestV1,
  ) => Effect.Effect<SchedulerReceiptV1, Failure>;
}

export type TaskRepairSweepDirectoryItemV1<SchedulerFailure> =
  | Omit<ReadyPartitionV1, "scheduler"> & Readonly<{
      readonly scheduler: TaskRepairSweepSchedulerV1<SchedulerFailure>;
    }>
  | Exclude<
      TaskSystemWakeSchedulerRepairDirectoryItemV1,
      { readonly kind: "ready" }
    >;

export interface TaskRepairSweepDirectoryV1<
  DirectoryFailure,
  SchedulerFailure,
> {
  readonly discoverEffect: (
    input: unknown,
  ) => Effect.Effect<
    Readonly<{
      readonly items:
        ReadonlyArray<TaskRepairSweepDirectoryItemV1<SchedulerFailure>>;
      readonly continuation:
        | TaskSystemWakeSchedulerRepairDirectoryContinuationV1
        | null;
    }>,
    DirectoryFailure
  >;
  readonly resolveEffect: (
    candidate: Readonly<{
      readonly deploymentId: string;
      readonly scopeId: RepairScopeIdV1;
    }>,
  ) => Effect.Effect<
    TaskRepairSweepDirectoryItemV1<SchedulerFailure>,
    DirectoryFailure
  >;
}

export type TaskRepairSweepDirectoryStateV1 =
  | Readonly<{ readonly kind: "unstarted" }>
  | Readonly<{
      readonly kind: "continuing";
      readonly continuation:
        TaskSystemWakeSchedulerRepairDirectoryContinuationV1;
    }>;

export type TaskRepairSweepDirectoryAfterV1 =
  | Extract<TaskRepairSweepDirectoryStateV1, { readonly kind: "continuing" }>
  | Readonly<{
      readonly kind: "exhausted";
      readonly highWaterScopeId: DirectoryHighWaterScopeIdV1;
    }>;

export interface TaskRepairSweepPartitionStateV1 {
  readonly expectedDeploymentId: string;
  readonly expectedScopeId: RepairScopeIdV1;
  readonly dueKind: DueKindV1;
  readonly cursor: DueCursorV1 | null;
  /**
   * Directory position after this active candidate. Missing is accepted only
   * for pre-E2C1 private evidence; that legacy cycle closes after the expected
   * partition so a later fresh cycle can safely rebuild its snapshot.
   */
  readonly directoryAfter?: TaskRepairSweepDirectoryAfterV1;
}

/**
 * Private operation-local continuation. It is not a wire or storage codec and
 * grants no authority; an active-partition resume freshly resolves its exact
 * persisted candidate before using the inner cursor.
 */
export interface TaskRepairSweepContinuationV1 {
  readonly version: "flarex.task-repair-sweep-continuation.v1";
  readonly directory: TaskRepairSweepDirectoryStateV1;
  readonly partition: TaskRepairSweepPartitionStateV1 | null;
}

export interface TaskRepairSweepOptionsV1 {
  readonly maximumDirectoryPages: number;
  readonly maximumSchedulerRuns: number;
  readonly maximumTaskPages: number;
  readonly maximumCandidates: number;
  readonly maximumRunMilliseconds: number;
  readonly maximumOperationMilliseconds: number;
  readonly settlementReserveMilliseconds: number;
}

export class TaskRepairSweepConfigurationV1Error extends Data.TaggedError(
  "TaskRepairSweepConfigurationV1Error",
)<{ readonly reason: "invalid_policy" }> {}

export class TaskRepairSweepDirectoryContractV1Error extends Data.TaggedError(
  "TaskRepairSweepDirectoryContractV1Error",
)<{ readonly reason: "item_overflow" | "resolved_item_mismatch" }> {}

export class TaskRepairSweepSchedulerContractV1Error extends Data.TaggedError(
  "TaskRepairSweepSchedulerContractV1Error",
)<{
  readonly reason:
    | "receipt_version_mismatch"
    | "receipt_kind_mismatch"
    | "stop_continuation_mismatch"
    | "continuation_kind_mismatch"
    | "continuation_snapshot_mismatch"
    | "ready_budget_invalid"
    | "partition_budget_exceeds_policy"
    | "page_charge_invalid"
    | "candidate_charge_invalid"
    | "handled_charge_mismatch";
}> {}

export class TaskRepairSweepOperationTimeoutV1Error extends Data.TaggedError(
  "TaskRepairSweepOperationTimeoutV1Error",
)<{
  readonly operation: "directory" | "resolve";
  readonly budgetNanoseconds: bigint;
}> {}

export type TaskRepairSweepErrorV1<
  DirectoryFailure = TaskSystemWakeSchedulerRepairDirectoryErrorV1,
> =
  | DirectoryFailure
  | TaskRepairSweepDirectoryContractV1Error
  | TaskRepairSweepSchedulerContractV1Error
  | TaskRepairSweepOperationTimeoutV1Error;

export type TaskRepairSweepStopReasonV1 =
  | "cycle_exhausted"
  | "directory_budget"
  | "scheduler_budget"
  | "task_page_budget"
  | "candidate_budget"
  | "no_time_to_start"
  | "time_budget";

export interface TaskRepairSweepReceiptV1 {
  readonly version: "flarex.task-repair-sweep-receipt.v1";
  readonly stopReason: TaskRepairSweepStopReasonV1;
  readonly directoryPagesRead: number;
  readonly partitionVisits: number;
  readonly partitionsFailed: number;
  readonly schedulerRuns: number;
  readonly taskPagesCharged: number;
  readonly candidatesCharged: number;
  readonly confirmedTaskPagesRead: number;
  readonly confirmedCandidatesHandled: number;
  readonly continuation: TaskRepairSweepContinuationV1 | null;
}

export interface TaskRepairSweepV1<DirectoryFailure =
  TaskSystemWakeSchedulerRepairDirectoryErrorV1> {
  readonly configuration: Readonly<{
    readonly maximumRunMilliseconds: number;
    readonly settlementReserveMilliseconds: number;
  }>;
  readonly runEffect: (
    continuation: TaskRepairSweepContinuationV1 | null,
  ) => Effect.Effect<
    TaskRepairSweepReceiptV1,
    TaskRepairSweepErrorV1<DirectoryFailure>
  >;
}

interface CapturedPolicyV1 extends TaskRepairSweepOptionsV1 {
  readonly maximumRunNanoseconds: bigint;
  readonly maximumOperationNanoseconds: bigint;
  readonly settlementReserveNanoseconds: bigint;
}

interface CountersV1 {
  directoryPagesRead: number;
  partitionVisits: number;
  partitionsFailed: number;
  schedulerRuns: number;
  taskPagesCharged: number;
  candidatesCharged: number;
  confirmedTaskPagesRead: number;
  confirmedCandidatesHandled: number;
}

const MAX_COUNT_V1 = 100;
const MAX_CANDIDATES_V1 = 10_000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

/**
 * Builds one private, host-neutral, count-bounded repair cycle with cooperative
 * time admission. It performs no checkpoint writes and exposes no Worker
 * scheduled handler. Callers must durably own the returned continuation before
 * a later roadmap may activate this operation.
 */
export function createTaskRepairSweepV1<DirectoryFailure, SchedulerFailure>(
  directory: TaskRepairSweepDirectoryV1<DirectoryFailure, SchedulerFailure>,
  options: TaskRepairSweepOptionsV1,
): Result.Result<
  TaskRepairSweepV1<DirectoryFailure>,
  TaskRepairSweepConfigurationV1Error
> {
  return Result.map(capturePolicy(options), (policy) => {
    const directoryOwner = directory;
    const discoverMethod = directoryOwner.discoverEffect;
    const resolveMethod = directoryOwner.resolveEffect;
    const discover: TaskRepairSweepDirectoryV1<
      DirectoryFailure,
      SchedulerFailure
    >["discoverEffect"] = (input) =>
      discoverMethod.call(directoryOwner, input);
    const resolve: TaskRepairSweepDirectoryV1<
      DirectoryFailure,
      SchedulerFailure
    >["resolveEffect"] = (candidate) =>
      resolveMethod.call(directoryOwner, candidate);

    const runEffect: TaskRepairSweepV1<DirectoryFailure>["runEffect"] = Effect.fn(
      "TaskRepairSweep.run",
    )(function* (suppliedContinuation) {
      let state = suppliedContinuation === null
        ? freshContinuation()
        : captureContinuation(suppliedContinuation);
      const counters: CountersV1 = {
        directoryPagesRead: 0,
        partitionVisits: 0,
        partitionsFailed: 0,
        schedulerRuns: 0,
        taskPagesCharged: 0,
        candidatesCharged: 0,
        confirmedTaskPagesRead: 0,
        confirmedCandidatesHandled: 0,
      };
      const startedAt = yield* Clock.currentTimeNanos;
      const deadline = startedAt + policy.maximumRunNanoseconds;

      while (true) {
        if (
          state.partition !== null
          && counters.schedulerRuns >= policy.maximumSchedulerRuns
        ) {
          return completed("scheduler_budget", counters, state);
        }
        let ready: RepairReadyItemV1<SchedulerFailure>;
        let partition: TaskRepairSweepPartitionStateV1;
        if (state.partition !== null) {
          const resolveBudget = yield* operationBudget(deadline, policy);
          if (resolveBudget === null) {
            return completed(
              hasStarted(counters) ? "time_budget" : "no_time_to_start",
              counters,
              state,
            );
          }
          const item = captureDirectoryItem(yield* resolve(Object.freeze({
            deploymentId: state.partition.expectedDeploymentId,
            scopeId: state.partition.expectedScopeId,
          })).pipe(Effect.timeoutOrElse({
            duration: Duration.nanos(resolveBudget),
            orElse: () => Effect.fail(
              new TaskRepairSweepOperationTimeoutV1Error({
                operation: "resolve",
                budgetNanoseconds: resolveBudget,
              }),
            ),
          })));
          counters.partitionVisits += 1;
          if (
            item.deploymentId !== state.partition.expectedDeploymentId
            || item.scopeId !== state.partition.expectedScopeId
          ) {
            return yield* new TaskRepairSweepDirectoryContractV1Error({
              reason: "resolved_item_mismatch",
            });
          }
          if (item.kind === "failed") {
            counters.partitionsFailed += 1;
            const next = afterPartition(state.partition);
            if (next === null) {
              return completed("cycle_exhausted", counters, null);
            }
            state = next;
            continue;
          }
          ready = item;
          partition = state.partition;
        } else {
          if (counters.directoryPagesRead >= policy.maximumDirectoryPages) {
            return completed("directory_budget", counters, state);
          }
          const directoryBudget = yield* operationBudget(deadline, policy);
          if (directoryBudget === null) {
            return completed(
              hasStarted(counters) ? "time_budget" : "no_time_to_start",
              counters,
              state,
            );
          }
          const page = yield* discover({
            limit: 1,
            ...(state.directory.kind === "continuing"
              ? { continuation: state.directory.continuation }
              : {}),
          }).pipe(Effect.timeoutOrElse({
            duration: Duration.nanos(directoryBudget),
            orElse: () => Effect.fail(
              new TaskRepairSweepOperationTimeoutV1Error({
                operation: "directory",
                budgetNanoseconds: directoryBudget,
              }),
            ),
          }));
          counters.directoryPagesRead += 1;
          if (page.items.length > 1) {
            return yield* new TaskRepairSweepDirectoryContractV1Error({
              reason: "item_overflow",
            });
          }
          const suppliedItem = page.items[0];
          if (suppliedItem === undefined) {
            const next = advanceDirectory(page.continuation);
            if (next !== null) {
              state = next;
              continue;
            }
            return completed("cycle_exhausted", counters, null);
          }
          const item = captureDirectoryItem(suppliedItem);
          counters.partitionVisits += 1;
          if (item.kind === "failed") {
            counters.partitionsFailed += 1;
            const next = advanceDirectory(page.continuation);
            if (next === null) {
              return completed("cycle_exhausted", counters, null);
            }
            state = next;
            continue;
          }
          ready = item;
          partition = freshPartitionState(ready, page.continuation);
        }
        yield* validateReadyPartitionPolicy(ready, policy);
        if (counters.schedulerRuns >= policy.maximumSchedulerRuns) {
          return completed(
            "scheduler_budget",
            counters,
            withPartition(state.directory, partition),
          );
        }
        if (
          counters.taskPagesCharged + ready.maximumPagesPerRun >
            policy.maximumTaskPages
        ) {
          return completed(
            "task_page_budget",
            counters,
            withPartition(state.directory, partition),
          );
        }
        if (
          counters.candidatesCharged + ready.maximumCandidatesPerRun >
            policy.maximumCandidates
        ) {
          return completed(
            "candidate_budget",
            counters,
            withPartition(state.directory, partition),
          );
        }
        const schedulerBudget = yield* operationBudget(deadline, policy);
        if (schedulerBudget === null) {
          return completed(
            hasStarted(counters) ? "time_budget" : "no_time_to_start",
            counters,
            withPartition(state.directory, partition),
          );
        }

        const schedulerResult = yield* Effect.result(ready.scheduler.run({
          dueKind: partition.dueKind,
          cursor: partition.cursor,
        }).pipe(Effect.timeoutOrElse({
          duration: Duration.nanos(schedulerBudget),
          orElse: () => Effect.fail("task_repair_scheduler_timeout" as const),
        })));
        counters.schedulerRuns += 1;
        if (Result.isFailure(schedulerResult)) {
          // The scheduler may have read pages and durably settled candidates
          // before a later typed failure or timeout. With no receipt, retain
          // the full admitted reservation so aggregate caps cannot be reused.
          counters.taskPagesCharged += ready.maximumPagesPerRun;
          counters.candidatesCharged += ready.maximumCandidatesPerRun;
          counters.partitionsFailed += 1;
          const next = afterPartition(partition);
          if (next === null) {
            return completed("cycle_exhausted", counters, null);
          }
          state = next;
          continue;
        }

        const receipt = yield* captureSchedulerReceipt(
          ready,
          partition,
          schedulerResult.success,
        );
        counters.taskPagesCharged += receipt.pagesRead;
        counters.candidatesCharged += receipt.candidatesHandled;
        counters.confirmedTaskPagesRead += receipt.pagesRead;
        counters.confirmedCandidatesHandled += receipt.candidatesHandled;

        if (receipt.continuation !== null) {
          state = withPartition(state.directory, Object.freeze({
            ...partition,
            cursor: receipt.continuation,
          }));
          continue;
        }
        if (partition.dueKind === "start_attempt") {
          state = withPartition(state.directory, Object.freeze({
            expectedDeploymentId: ready.deploymentId,
            expectedScopeId: ready.scopeId,
            dueKind: "handle_lease_expiry",
            cursor: null,
            ...(partition.directoryAfter === undefined ? {} : {
              directoryAfter: partition.directoryAfter,
            }),
          }));
          continue;
        }
        const next = afterPartition(partition);
        if (next === null) {
          return completed("cycle_exhausted", counters, null);
        }
        state = next;
      }
    });

    return Object.freeze({
      configuration: Object.freeze({
        maximumRunMilliseconds: policy.maximumRunMilliseconds,
        settlementReserveMilliseconds: policy.settlementReserveMilliseconds,
      }),
      runEffect,
    });
  });
}

function capturePolicy(
  options: TaskRepairSweepOptionsV1,
): Result.Result<CapturedPolicyV1, TaskRepairSweepConfigurationV1Error> {
  const maximumDirectoryPages = options.maximumDirectoryPages;
  const maximumSchedulerRuns = options.maximumSchedulerRuns;
  const maximumTaskPages = options.maximumTaskPages;
  const maximumCandidates = options.maximumCandidates;
  const maximumRunMilliseconds = options.maximumRunMilliseconds;
  const maximumOperationMilliseconds = options.maximumOperationMilliseconds;
  const settlementReserveMilliseconds = options.settlementReserveMilliseconds;
  const operationAndReserve = maximumOperationMilliseconds +
    settlementReserveMilliseconds;
  if (
    !isBoundedCount(maximumDirectoryPages)
    || !isBoundedCount(maximumSchedulerRuns)
    || !isBoundedCount(maximumTaskPages)
    || !isPositiveSafeInteger(maximumCandidates)
    || maximumCandidates > MAX_CANDIDATES_V1
    || !isPositiveSafeInteger(maximumRunMilliseconds)
    || !isPositiveSafeInteger(maximumOperationMilliseconds)
    || !isPositiveSafeInteger(settlementReserveMilliseconds)
    || !Number.isSafeInteger(operationAndReserve)
    || operationAndReserve > maximumRunMilliseconds
  ) {
    return Result.fail(new TaskRepairSweepConfigurationV1Error({
      reason: "invalid_policy",
    }));
  }
  return Result.succeed(Object.freeze({
    maximumDirectoryPages,
    maximumSchedulerRuns,
    maximumTaskPages,
    maximumCandidates,
    maximumRunMilliseconds,
    maximumOperationMilliseconds,
    settlementReserveMilliseconds,
    maximumRunNanoseconds: toNanoseconds(maximumRunMilliseconds),
    maximumOperationNanoseconds: toNanoseconds(
      maximumOperationMilliseconds,
    ),
    settlementReserveNanoseconds: toNanoseconds(
      settlementReserveMilliseconds,
    ),
  }));
}

function operationBudget(
  deadline: bigint,
  policy: CapturedPolicyV1,
): Effect.Effect<bigint | null> {
  return Effect.map(Clock.currentTimeNanos, (now) => {
    const available = deadline - now - policy.settlementReserveNanoseconds;
    if (available <= 0n) return null;
    return available < policy.maximumOperationNanoseconds
      ? available
      : policy.maximumOperationNanoseconds;
  });
}

function captureSchedulerReceipt<SchedulerFailure>(
  item: RepairReadyItemV1<SchedulerFailure>,
  partition: TaskRepairSweepPartitionStateV1,
  receipt: SchedulerReceiptV1,
): Effect.Effect<
  Readonly<{
    readonly pagesRead: number;
    readonly candidatesHandled: number;
    readonly continuation: DueCursorV1 | null;
  }>,
  TaskRepairSweepSchedulerContractV1Error
> {
  const dueKind = receipt.dueKind;
  const version = receipt.version;
  const throughMs = receipt.throughMs;
  const stopReason = receipt.stopReason;
  const pagesRead = receipt.pagesRead;
  const candidatesHandled = receipt.candidatesHandled;
  const handled = receipt.handled;
  const suppliedContinuation = receipt.continuation;
  const continuation = suppliedContinuation === null
    ? null
    : captureDueCursor(suppliedContinuation);
  if (version !== "flarex.task-wake-scheduler-run-receipt.v1") {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "receipt_version_mismatch",
    });
  }
  if (dueKind !== partition.dueKind) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "receipt_kind_mismatch",
    });
  }
  if (
    !isPositiveSafeInteger(pagesRead)
    || pagesRead > item.maximumPagesPerRun
  ) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "page_charge_invalid",
    });
  }
  if (
    !Number.isSafeInteger(candidatesHandled)
    || candidatesHandled < 0
    || candidatesHandled > item.maximumCandidatesPerRun
  ) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "candidate_charge_invalid",
    });
  }
  if (handled.length !== candidatesHandled) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "handled_charge_mismatch",
    });
  }
  if (
    (stopReason === "source_exhausted") !==
      (continuation === null)
  ) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "stop_continuation_mismatch",
    });
  }
  if (
    continuation !== null
    && (
      continuation.version !== 1
      || continuation.dueKind !== dueKind
    )
  ) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "continuation_kind_mismatch",
    });
  }
  if (
    continuation !== null
    && continuation.throughMs !== throughMs
  ) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "continuation_snapshot_mismatch",
    });
  }
  return Effect.succeed(Object.freeze({
    pagesRead,
    candidatesHandled,
    continuation,
  }));
}

function validateReadyPartitionPolicy<SchedulerFailure>(
  item: RepairReadyItemV1<SchedulerFailure>,
  policy: CapturedPolicyV1,
): Effect.Effect<void, TaskRepairSweepSchedulerContractV1Error> {
  if (
    !isBoundedCount(item.maximumPagesPerRun)
    || !isPositiveSafeInteger(item.maximumCandidatesPerRun)
    || item.maximumCandidatesPerRun > MAX_CANDIDATES_V1
  ) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "ready_budget_invalid",
    });
  }
  if (
    item.maximumPagesPerRun > policy.maximumTaskPages
    || item.maximumCandidatesPerRun > policy.maximumCandidates
  ) {
    return new TaskRepairSweepSchedulerContractV1Error({
      reason: "partition_budget_exceeds_policy",
    });
  }
  return Effect.void;
}

function captureDirectoryItem<SchedulerFailure>(
  item: TaskRepairSweepDirectoryItemV1<SchedulerFailure>,
): TaskRepairSweepDirectoryItemV1<SchedulerFailure> {
  const kind = item.kind;
  const deploymentId = item.deploymentId;
  const scopeId = item.scopeId;
  if (kind === "failed") {
    const reason = item.reason;
    return Object.freeze({ kind, deploymentId, scopeId, reason });
  }
  const maximumPagesPerRun = item.maximumPagesPerRun;
  const maximumCandidatesPerRun = item.maximumCandidatesPerRun;
  const schedulerOwner = item.scheduler;
  const runMethod = schedulerOwner.run;
  const scheduler: TaskRepairSweepSchedulerV1<SchedulerFailure> = Object.freeze({
    run: (request: SchedulerRequestV1) =>
      runMethod.call(schedulerOwner, request),
  });
  return Object.freeze({
    kind,
    deploymentId,
    scopeId,
    maximumPagesPerRun,
    maximumCandidatesPerRun,
    scheduler,
  });
}

function freshPartitionState(
  item: Readonly<{
    readonly deploymentId: string;
    readonly scopeId: RepairScopeIdV1;
  }>,
  directoryContinuation:
    TaskSystemWakeSchedulerRepairDirectoryContinuationV1 | null,
): TaskRepairSweepPartitionStateV1 {
  return Object.freeze({
    expectedDeploymentId: item.deploymentId,
    expectedScopeId: item.scopeId,
    dueKind: "start_attempt",
    cursor: null,
    directoryAfter: directoryStateAfter(directoryContinuation, item.scopeId),
  });
}

function freshContinuation(): TaskRepairSweepContinuationV1 {
  return Object.freeze({
    version: "flarex.task-repair-sweep-continuation.v1",
    directory: Object.freeze({ kind: "unstarted" }),
    partition: null,
  });
}

function advanceDirectory(
  continuation: TaskSystemWakeSchedulerRepairDirectoryContinuationV1 | null,
): TaskRepairSweepContinuationV1 | null {
  return continuation === null
    ? null
    : Object.freeze({
      version: "flarex.task-repair-sweep-continuation.v1",
      directory: Object.freeze({
        kind: "continuing",
        continuation: captureDirectoryContinuation(continuation),
      }),
      partition: null,
    });
}

function afterPartition(
  partition: TaskRepairSweepPartitionStateV1,
): TaskRepairSweepContinuationV1 | null {
  const directoryAfter = partition.directoryAfter;
  return directoryAfter === undefined || directoryAfter.kind === "exhausted"
    ? null
    : Object.freeze({
      version: "flarex.task-repair-sweep-continuation.v1",
      directory: captureDirectoryState(directoryAfter),
      partition: null,
    });
}

function directoryStateAfter(
  continuation: TaskSystemWakeSchedulerRepairDirectoryContinuationV1 | null,
  terminalScopeId: RepairScopeIdV1,
): TaskRepairSweepDirectoryAfterV1 {
  return continuation === null
    ? Object.freeze({
      kind: "exhausted",
      highWaterScopeId: terminalScopeId,
    })
    : Object.freeze({
      kind: "continuing",
      continuation: captureDirectoryContinuation(continuation),
    });
}

function withPartition(
  directory: TaskRepairSweepDirectoryStateV1,
  partition: TaskRepairSweepPartitionStateV1,
): TaskRepairSweepContinuationV1 {
  return Object.freeze({
    version: "flarex.task-repair-sweep-continuation.v1",
    directory,
    partition,
  });
}

function captureContinuation(
  continuation: TaskRepairSweepContinuationV1,
): TaskRepairSweepContinuationV1 {
  const partition = continuation.partition;
  return Object.freeze({
    version: continuation.version,
    directory: captureDirectoryState(continuation.directory),
    partition: partition === null ? null : capturePartitionState(partition),
  });
}

function capturePartitionState(
  partition: TaskRepairSweepPartitionStateV1,
): TaskRepairSweepPartitionStateV1 {
  const cursor = partition.cursor;
  const directoryAfter = partition.directoryAfter;
  return Object.freeze({
    expectedDeploymentId: partition.expectedDeploymentId,
    expectedScopeId: partition.expectedScopeId,
    dueKind: partition.dueKind,
    cursor: cursor === null ? null : captureDueCursor(cursor),
    ...(directoryAfter === undefined ? {} : {
      directoryAfter: captureDirectoryAfter(directoryAfter),
    }),
  });
}

function captureDirectoryState(
  directory: TaskRepairSweepDirectoryStateV1,
): TaskRepairSweepDirectoryStateV1 {
  return directory.kind === "unstarted"
    ? Object.freeze({ kind: "unstarted" })
    : Object.freeze({
      kind: "continuing",
      continuation: captureDirectoryContinuation(directory.continuation),
    });
}

function captureDirectoryAfter(
  directory: TaskRepairSweepDirectoryAfterV1,
): TaskRepairSweepDirectoryAfterV1 {
  return directory.kind === "exhausted"
    ? Object.freeze({
      kind: "exhausted",
      highWaterScopeId: directory.highWaterScopeId,
    })
    : Object.freeze({
      kind: "continuing",
      continuation: captureDirectoryContinuation(directory.continuation),
    });
}

function captureDirectoryContinuation(
  continuation: TaskSystemWakeSchedulerRepairDirectoryContinuationV1,
): TaskSystemWakeSchedulerRepairDirectoryContinuationV1 {
  return Object.freeze({
    codecVersion: continuation.codecVersion,
    highWaterScopeId: continuation.highWaterScopeId,
    lastScopeId: continuation.lastScopeId,
  });
}

function captureDueCursor(cursor: DueCursorV1): DueCursorV1 {
  return Object.freeze({
    version: cursor.version,
    dueKind: cursor.dueKind,
    throughMs: cursor.throughMs,
    dueAtMs: cursor.dueAtMs,
    runId: cursor.runId,
  });
}

function completed(
  stopReason: TaskRepairSweepStopReasonV1,
  counters: CountersV1,
  continuation: TaskRepairSweepContinuationV1 | null,
): TaskRepairSweepReceiptV1 {
  return Object.freeze({
    version: "flarex.task-repair-sweep-receipt.v1",
    stopReason,
    directoryPagesRead: counters.directoryPagesRead,
    partitionVisits: counters.partitionVisits,
    partitionsFailed: counters.partitionsFailed,
    schedulerRuns: counters.schedulerRuns,
    taskPagesCharged: counters.taskPagesCharged,
    candidatesCharged: counters.candidatesCharged,
    confirmedTaskPagesRead: counters.confirmedTaskPagesRead,
    confirmedCandidatesHandled: counters.confirmedCandidatesHandled,
    continuation,
  });
}

function hasStarted(counters: CountersV1): boolean {
  return counters.directoryPagesRead > 0 || counters.schedulerRuns > 0;
}

function isBoundedCount(value: number): boolean {
  return isPositiveSafeInteger(value) && value <= MAX_COUNT_V1;
}

function toNanoseconds(milliseconds: number): bigint {
  return BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
}

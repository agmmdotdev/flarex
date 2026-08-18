import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Clock, Data, Effect, Result } from "effect";

import {
  decodeRetainedHistorySchedulerContinuationV1,
  encodeRetainedHistorySchedulerContinuationV1,
  type EncodedRetainedHistorySchedulerContinuationV1,
  type RetainedHistorySchedulerContinuationCodecV1Error,
} from "./retainedHistorySchedulerContinuationCodecV1";
import {
  type RetainedHistoryMultiScopeMaintenanceError,
  type RetainedHistoryMultiScopeMaintenanceReceiptV1,
  type RetainedHistoryMultiScopeMaintenance,
} from "./retainedHistoryMultiScopeMaintenance";
import {
  retrySchedulerCheckpointOnceOnConfirmedRollbackV1,
  runWithSchedulerCheckpointCleanupV1,
  type SchedulerCheckpointCleanupStateV1,
} from "./schedulerCheckpointRunMechanicsV1";

export type RetainedHistorySchedulerAcquireResult<Run> =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{
      readonly kind: "acquired";
      readonly run: Run;
      readonly claimExpiresAt: Date;
      readonly continuation:
        | EncodedRetainedHistorySchedulerContinuationV1
        | null;
    }>;

export interface RetainedHistorySchedulerRenewResult {
  readonly kind: "renewed";
  readonly claimExpiresAt: Date;
}

export interface RetainedHistorySchedulerCheckpointResult {
  readonly kind: "checkpointed";
  readonly checkpointSequence: bigint;
}

export interface RetainedHistorySchedulerReleaseResult {
  readonly kind: "released";
  readonly nextRunAt: Date;
}

export interface RetainedHistorySchedulerCheckpointPort<
  Run,
  ConfigurationError,
  AcquireError,
  RenewError,
  CheckpointError,
  ReleaseError,
  AcquireRollback extends AcquireError,
  RenewRollback extends RenewError,
  CheckpointRollback extends CheckpointError,
  ReleaseRollback extends ReleaseError,
> {
  readonly configuration: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    ConfigurationError
  >;
  readonly acquireEffect: () => Effect.Effect<
    RetainedHistorySchedulerAcquireResult<Run>,
    AcquireError
  >;
  readonly renewEffect: (
    run: Run,
  ) => Effect.Effect<RetainedHistorySchedulerRenewResult, RenewError>;
  readonly checkpointEffect: (
    run: Run,
    continuation: EncodedRetainedHistorySchedulerContinuationV1 | null,
  ) => Effect.Effect<
    RetainedHistorySchedulerCheckpointResult,
    CheckpointError
  >;
  readonly releaseEffect: (
    run: Run,
  ) => Effect.Effect<RetainedHistorySchedulerReleaseResult, ReleaseError>;
  readonly isAcquireConfirmedRollback: (
    error: AcquireError,
  ) => error is AcquireRollback;
  readonly isRenewConfirmedRollback: (
    error: RenewError,
  ) => error is RenewRollback;
  readonly isCheckpointConfirmedRollback: (
    error: CheckpointError,
  ) => error is CheckpointRollback;
  readonly isReleaseConfirmedRollback: (
    error: ReleaseError,
  ) => error is ReleaseRollback;
}

export interface RetainedHistorySchedulerRunOptions {
  readonly maximumInvocations: number;
  readonly maximumDirectoryPages: number;
  readonly maximumMaintenancePages: number;
  readonly maximumRunMilliseconds: number;
  /** Cooperative admission ceiling; an in-flight O11-E page is never timed out. */
  readonly maximumInvocationMilliseconds: number;
  readonly settlementReserveMilliseconds: number;
}

export class RetainedHistorySchedulerRunConfigurationError
  extends Data.TaggedError("RetainedHistorySchedulerRunConfigurationError")<{
    readonly reason: "invalidPolicy";
  }> {}

export class RetainedHistorySchedulerRunContractError
  extends Data.TaggedError("RetainedHistorySchedulerRunContractError")<{
    readonly reason: "directoryChargeExceeded" | "maintenanceChargeExceeded";
  }> {}

export type RetainedHistorySchedulerRunStopReason =
  | "cycleExhausted"
  | "countBudget"
  | "noTimeToStart"
  | "timeBudget";

export type RetainedHistorySchedulerRunResult =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{
      readonly kind: "completed";
      readonly reason: RetainedHistorySchedulerRunStopReason;
      readonly invocations: number;
      readonly directoryPagesRead: number;
      readonly maintenancePagesExecuted: number;
      readonly batches:
        ReadonlyArray<RetainedHistoryMultiScopeMaintenanceReceiptV1>;
      readonly nextRunAt: Date;
    }>;

type RetainedHistorySchedulerRunFailure<
  AcquireError,
  RenewError,
  CheckpointError,
  ReleaseError,
> =
  | AcquireError
  | RenewError
  | CheckpointError
  | ReleaseError
  | RetainedHistoryMultiScopeMaintenanceError
  | RetainedHistorySchedulerRunContractError
  | RetainedHistorySchedulerContinuationCodecV1Error;

export interface RetainedHistorySchedulerHostNeutralRun<Failure> {
  readonly runEffect: () => Effect.Effect<
    RetainedHistorySchedulerRunResult,
    Failure
  >;
}

interface CapturedPolicy extends RetainedHistorySchedulerRunOptions {
  readonly maximumDirectoryPagesPerInvocation: number;
  readonly maximumMaintenancePagesPerInvocation: number;
  readonly claimDurationNanoseconds: bigint;
  readonly maximumRunNanoseconds: bigint;
  readonly maximumInvocationNanoseconds: bigint;
  readonly settlementReserveNanoseconds: bigint;
}

interface AcquiredState<Run> extends SchedulerCheckpointCleanupStateV1<Run> {
  leaseDeadline: bigint;
}

const MAX_COUNT = 1_024;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

/**
 * Durable, host-neutral O11-F2 runner. Platform and manual wake adapters call
 * this same operation; neither receives checkpoint, cursor, or scope authority.
 */
export function createRetainedHistorySchedulerRun<
  Run,
  ConfigurationError,
  AcquireError,
  RenewError,
  CheckpointError,
  ReleaseError,
  AcquireRollback extends AcquireError,
  RenewRollback extends RenewError,
  CheckpointRollback extends CheckpointError,
  ReleaseRollback extends ReleaseError,
>(
  checkpoint: RetainedHistorySchedulerCheckpointPort<
    Run,
    ConfigurationError,
    AcquireError,
    RenewError,
    CheckpointError,
    ReleaseError,
    AcquireRollback,
    RenewRollback,
    CheckpointRollback,
    ReleaseRollback
  >,
  multiScope: RetainedHistoryMultiScopeMaintenance,
  options: RetainedHistorySchedulerRunOptions,
): Result.Result<
  RetainedHistorySchedulerHostNeutralRun<
    RetainedHistorySchedulerRunFailure<
      AcquireError,
      RenewError,
      CheckpointError,
      ReleaseError
    >
  >,
  ConfigurationError | RetainedHistorySchedulerRunConfigurationError
> {
  return Result.gen(function* () {
    const checkpointOwner = checkpoint;
    const checkpointConfiguration = yield* checkpointOwner.configuration;
    const acquireMethod = checkpointOwner.acquireEffect;
    const renewMethod = checkpointOwner.renewEffect;
    const checkpointMethod = checkpointOwner.checkpointEffect;
    const releaseMethod = checkpointOwner.releaseEffect;
    const isAcquireConfirmedRollbackMethod =
      checkpointOwner.isAcquireConfirmedRollback;
    const isRenewConfirmedRollbackMethod =
      checkpointOwner.isRenewConfirmedRollback;
    const isCheckpointConfirmedRollbackMethod =
      checkpointOwner.isCheckpointConfirmedRollback;
    const isReleaseConfirmedRollbackMethod =
      checkpointOwner.isReleaseConfirmedRollback;
    const capturedCheckpoint: RetainedHistorySchedulerCheckpointPort<
      Run,
      ConfigurationError,
      AcquireError,
      RenewError,
      CheckpointError,
      ReleaseError,
      AcquireRollback,
      RenewRollback,
      CheckpointRollback,
      ReleaseRollback
    > = Object.freeze({
      configuration: Result.succeed(checkpointConfiguration),
      acquireEffect: () => acquireMethod.call(checkpointOwner),
      renewEffect: (run: Run) => renewMethod.call(checkpointOwner, run),
      checkpointEffect: (
        run: Run,
        continuation: EncodedRetainedHistorySchedulerContinuationV1 | null,
      ) =>
        checkpointMethod.call(checkpointOwner, run, continuation),
      releaseEffect: (run: Run) => releaseMethod.call(checkpointOwner, run),
      isAcquireConfirmedRollback: (
        error: AcquireError,
      ): error is AcquireRollback =>
        isAcquireConfirmedRollbackMethod.call(checkpointOwner, error),
      isRenewConfirmedRollback: (
        error: RenewError,
      ): error is RenewRollback =>
        isRenewConfirmedRollbackMethod.call(checkpointOwner, error),
      isCheckpointConfirmedRollback: (
        error: CheckpointError,
      ): error is CheckpointRollback =>
        isCheckpointConfirmedRollbackMethod.call(checkpointOwner, error),
      isReleaseConfirmedRollback: (
        error: ReleaseError,
      ): error is ReleaseRollback =>
        isReleaseConfirmedRollbackMethod.call(checkpointOwner, error),
    });
    const multiScopeOwner = multiScope;
    const multiScopeConfiguration = multiScopeOwner.configuration;
    const maximumDirectoryPagesPerInvocation =
      multiScopeConfiguration.maximumDirectoryPagesPerInvocation;
    const maximumMaintenancePagesPerInvocation =
      multiScopeConfiguration.maximumMaintenancePagesPerInvocation;
    const multiScopeRunMethod = multiScopeOwner.runEffect;
    const capturedMultiScope: RetainedHistoryMultiScopeMaintenance =
      Object.freeze({
        configuration: Object.freeze({
          maximumDirectoryPagesPerInvocation,
          maximumMaintenancePagesPerInvocation,
        }),
        runEffect: (continuation: Parameters<typeof multiScopeRunMethod>[0]) =>
          multiScopeRunMethod.call(multiScopeOwner, continuation),
      });
    const policy = yield* capturePolicy(
      options,
      checkpointConfiguration.claimDurationMilliseconds,
      maximumDirectoryPagesPerInvocation,
      maximumMaintenancePagesPerInvocation,
    );

    const runEffect = Effect.fn("RetainedHistorySchedulerRun.run")(
      function* () {
        const startedAt = yield* Clock.currentTimeNanos;
        const deadline = startedAt + policy.maximumRunNanoseconds;
        const acquired = yield*
          retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
            () => capturedCheckpoint.acquireEffect(),
            (error): error is AcquireRollback =>
              capturedCheckpoint.isAcquireConfirmedRollback(error),
            () => retryAdmissionEffect(deadline, policy),
          );

        if (acquired.kind === "notDue") {
          return Object.freeze({
            kind: "notDue" as const,
            nextRunAt: copyDate(acquired.nextRunAt),
          });
        }
        if (acquired.kind === "busy") {
          return Object.freeze({
            kind: "busy" as const,
            claimExpiresAt: copyDate(acquired.claimExpiresAt),
          });
        }

        const state: AcquiredState<Run> = {
          run: acquired.run,
          leaseDeadline: startedAt + policy.claimDurationNanoseconds,
          cleanupAllowed: true,
        };
        return yield* runWithSchedulerCheckpointCleanupV1(
          state,
          runAcquired(
            capturedCheckpoint,
            capturedMultiScope,
            policy,
            deadline,
            state,
            acquired.continuation,
          ),
          (run) => capturedCheckpoint.releaseEffect(run),
        );
      },
    );

    return Object.freeze({ runEffect });
  });
}

function capturePolicy(
  options: RetainedHistorySchedulerRunOptions,
  claimDurationMilliseconds: number,
  maximumDirectoryPagesPerInvocation: number,
  maximumMaintenancePagesPerInvocation: number,
): Result.Result<
  CapturedPolicy,
  RetainedHistorySchedulerRunConfigurationError
> {
  const maximumInvocations = options.maximumInvocations;
  const maximumDirectoryPages = options.maximumDirectoryPages;
  const maximumMaintenancePages = options.maximumMaintenancePages;
  const maximumRunMilliseconds = options.maximumRunMilliseconds;
  const maximumInvocationMilliseconds = options.maximumInvocationMilliseconds;
  const settlementReserveMilliseconds = options.settlementReserveMilliseconds;
  const invocationAndReserve = maximumInvocationMilliseconds +
    settlementReserveMilliseconds;
  if (
    !isBoundedCount(maximumInvocations) ||
    !isBoundedCount(maximumDirectoryPages) ||
    !isBoundedCount(maximumMaintenancePages) ||
    !isPositiveSafeInteger(maximumDirectoryPagesPerInvocation) ||
    maximumDirectoryPagesPerInvocation > maximumDirectoryPages ||
    !isPositiveSafeInteger(maximumMaintenancePagesPerInvocation) ||
    maximumMaintenancePagesPerInvocation > maximumMaintenancePages ||
    !isPositiveSafeInteger(maximumRunMilliseconds) ||
    !isPositiveSafeInteger(maximumInvocationMilliseconds) ||
    !isPositiveSafeInteger(settlementReserveMilliseconds) ||
    !isPositiveSafeInteger(claimDurationMilliseconds) ||
    !Number.isSafeInteger(invocationAndReserve) ||
    invocationAndReserve > maximumRunMilliseconds ||
    invocationAndReserve > claimDurationMilliseconds
  ) {
    return Result.fail(new RetainedHistorySchedulerRunConfigurationError({
      reason: "invalidPolicy",
    }));
  }
  return Result.succeed(Object.freeze({
    maximumInvocations,
    maximumDirectoryPages,
    maximumMaintenancePages,
    maximumRunMilliseconds,
    maximumInvocationMilliseconds,
    settlementReserveMilliseconds,
    maximumDirectoryPagesPerInvocation,
    maximumMaintenancePagesPerInvocation,
    claimDurationNanoseconds: toNanoseconds(claimDurationMilliseconds),
    maximumRunNanoseconds: toNanoseconds(maximumRunMilliseconds),
    maximumInvocationNanoseconds: toNanoseconds(
      maximumInvocationMilliseconds,
    ),
    settlementReserveNanoseconds: toNanoseconds(
      settlementReserveMilliseconds,
    ),
  }));
}

function runAcquired<
  Run,
  ConfigurationError,
  AcquireError,
  RenewError,
  CheckpointError,
  ReleaseError,
  AcquireRollback extends AcquireError,
  RenewRollback extends RenewError,
  CheckpointRollback extends CheckpointError,
  ReleaseRollback extends ReleaseError,
>(
  checkpoint: RetainedHistorySchedulerCheckpointPort<
    Run,
    ConfigurationError,
    AcquireError,
    RenewError,
    CheckpointError,
    ReleaseError,
    AcquireRollback,
    RenewRollback,
    CheckpointRollback,
    ReleaseRollback
  >,
  multiScope: RetainedHistoryMultiScopeMaintenance,
  policy: CapturedPolicy,
  deadline: bigint,
  state: AcquiredState<Run>,
  persistedContinuation: EncodedRetainedHistorySchedulerContinuationV1 | null,
): Effect.Effect<
  RetainedHistorySchedulerRunResult,
  | RenewError
  | CheckpointError
  | ReleaseError
  | RetainedHistoryMultiScopeMaintenanceError
  | RetainedHistorySchedulerRunContractError
  | RetainedHistorySchedulerContinuationCodecV1Error
> {
  return Effect.gen(function* () {
    let continuation = persistedContinuation === null
      ? null
      : yield* decodeRetainedHistorySchedulerContinuationV1(
        persistedContinuation,
      );
    const batches: RetainedHistoryMultiScopeMaintenanceReceiptV1[] = [];
    let invocations = 0;
    let directoryPagesRead = 0;
    let maintenancePagesExecuted = 0;

    while (true) {
      if (!(yield* invocationAdmissionEffect(
        deadline,
        policy,
        state.leaseDeadline,
      ))) {
        const released = yield* releaseKnownRun(
          checkpoint,
          deadline,
          policy,
          state,
        );
        return completed(
          invocations === 0 ? "noTimeToStart" : "timeBudget",
          invocations,
          directoryPagesRead,
          maintenancePagesExecuted,
          batches,
          released.nextRunAt,
        );
      }
      if (
        invocations >= policy.maximumInvocations ||
        directoryPagesRead +
            policy.maximumDirectoryPagesPerInvocation >
          policy.maximumDirectoryPages ||
        maintenancePagesExecuted +
            policy.maximumMaintenancePagesPerInvocation >
          policy.maximumMaintenancePages
      ) {
        const released = yield* releaseKnownRun(
          checkpoint,
          deadline,
          policy,
          state,
        );
        return completed(
          "countBudget",
          invocations,
          directoryPagesRead,
          maintenancePagesExecuted,
          batches,
          released.nextRunAt,
        );
      }

      const batch = yield* multiScope.runEffect(continuation);
      const batchMaintenancePages = batch.maintenance?.pagesExecuted ?? 0;
      if (directoryPagesRead + batch.directoryPagesRead >
        policy.maximumDirectoryPages) {
        return yield* new RetainedHistorySchedulerRunContractError({
          reason: "directoryChargeExceeded",
        });
      }
      if (
        maintenancePagesExecuted + batchMaintenancePages >
          policy.maximumMaintenancePages
      ) {
        return yield* new RetainedHistorySchedulerRunContractError({
          reason: "maintenanceChargeExceeded",
        });
      }
      invocations += 1;
      directoryPagesRead += batch.directoryPagesRead;
      maintenancePagesExecuted += batchMaintenancePages;
      batches.push(batch);

      const encoded = batch.continuation === null
        ? null
        : yield* encodeRetainedHistorySchedulerContinuationV1(
          batch.continuation,
        );
      state.cleanupAllowed = false;
      yield* retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
        () => checkpoint.checkpointEffect(state.run, encoded),
        (error): error is CheckpointRollback =>
          checkpoint.isCheckpointConfirmedRollback(error),
        () => retryAdmissionEffect(deadline, policy, state.leaseDeadline),
      );
      state.cleanupAllowed = true;

      if (batch.continuation === null) {
        const released = yield* releaseKnownRun(
          checkpoint,
          deadline,
          policy,
          state,
        );
        return completed(
          "cycleExhausted",
          invocations,
          directoryPagesRead,
          maintenancePagesExecuted,
          batches,
          released.nextRunAt,
        );
      }
      continuation = batch.continuation;

      if (
        invocations >= policy.maximumInvocations ||
        directoryPagesRead +
            policy.maximumDirectoryPagesPerInvocation >
          policy.maximumDirectoryPages ||
        maintenancePagesExecuted +
            policy.maximumMaintenancePagesPerInvocation >
          policy.maximumMaintenancePages
      ) {
        const released = yield* releaseKnownRun(
          checkpoint,
          deadline,
          policy,
          state,
        );
        return completed(
          "countBudget",
          invocations,
          directoryPagesRead,
          maintenancePagesExecuted,
          batches,
          released.nextRunAt,
        );
      }

      if (!(yield* renewalAdmissionEffect(
        deadline,
        policy,
        state.leaseDeadline,
      ))) {
        const released = yield* releaseKnownRun(
          checkpoint,
          deadline,
          policy,
          state,
        );
        return completed(
          "timeBudget",
          invocations,
          directoryPagesRead,
          maintenancePagesExecuted,
          batches,
          released.nextRunAt,
        );
      }

      const renewalStartedAt = yield* Clock.currentTimeNanos;
      state.cleanupAllowed = false;
      yield* retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
        () => checkpoint.renewEffect(state.run),
        (error): error is RenewRollback =>
          checkpoint.isRenewConfirmedRollback(error),
        () => retryAdmissionEffect(deadline, policy, state.leaseDeadline),
      );
      state.leaseDeadline = renewalStartedAt + policy.claimDurationNanoseconds;
      state.cleanupAllowed = true;
    }
  }).pipe(Effect.withSpan("RetainedHistorySchedulerRun.runAcquired"));
}

function releaseKnownRun<
  Run,
  ConfigurationError,
  AcquireError,
  RenewError,
  CheckpointError,
  ReleaseError,
  AcquireRollback extends AcquireError,
  RenewRollback extends RenewError,
  CheckpointRollback extends CheckpointError,
  ReleaseRollback extends ReleaseError,
>(
  checkpoint: RetainedHistorySchedulerCheckpointPort<
    Run,
    ConfigurationError,
    AcquireError,
    RenewError,
    CheckpointError,
    ReleaseError,
    AcquireRollback,
    RenewRollback,
    CheckpointRollback,
    ReleaseRollback
  >,
  deadline: bigint,
  policy: CapturedPolicy,
  state: AcquiredState<Run>,
): Effect.Effect<RetainedHistorySchedulerReleaseResult, ReleaseError> {
  state.cleanupAllowed = false;
  return retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
    () => checkpoint.releaseEffect(state.run),
    (error): error is ReleaseRollback =>
      checkpoint.isReleaseConfirmedRollback(error),
    () => retryAdmissionEffect(deadline, policy, state.leaseDeadline),
  );
}

function invocationAdmissionEffect(
  deadline: bigint,
  policy: CapturedPolicy,
  leaseDeadline: bigint,
): Effect.Effect<boolean> {
  return Clock.currentTimeNanos.pipe(Effect.map((now) => {
    const effectiveDeadline = leaseDeadline < deadline
      ? leaseDeadline
      : deadline;
    return now + policy.maximumInvocationNanoseconds +
        policy.settlementReserveNanoseconds <= effectiveDeadline;
  }));
}

function retryAdmissionEffect(
  deadline: bigint,
  policy: CapturedPolicy,
  leaseDeadline: bigint = deadline,
): Effect.Effect<boolean> {
  return Clock.currentTimeNanos.pipe(Effect.map((now) => {
    const effectiveDeadline = leaseDeadline < deadline
      ? leaseDeadline
      : deadline;
    return now + policy.settlementReserveNanoseconds <= effectiveDeadline;
  }));
}

function renewalAdmissionEffect(
  deadline: bigint,
  policy: CapturedPolicy,
  leaseDeadline: bigint,
): Effect.Effect<boolean> {
  return Clock.currentTimeNanos.pipe(Effect.map((now) =>
    now + policy.settlementReserveNanoseconds <= leaseDeadline &&
    now + policy.maximumInvocationNanoseconds +
        policy.settlementReserveNanoseconds <= deadline
  ));
}

function completed(
  reason: RetainedHistorySchedulerRunStopReason,
  invocations: number,
  directoryPagesRead: number,
  maintenancePagesExecuted: number,
  batches: ReadonlyArray<RetainedHistoryMultiScopeMaintenanceReceiptV1>,
  nextRunAt: Date,
): Extract<RetainedHistorySchedulerRunResult, { kind: "completed" }> {
  return Object.freeze({
    kind: "completed",
    reason,
    invocations,
    directoryPagesRead,
    maintenancePagesExecuted,
    batches: Object.freeze([...batches]),
    nextRunAt: copyDate(nextRunAt),
  });
}

function isBoundedCount(value: number): boolean {
  return isPositiveSafeInteger(value) && value <= MAX_COUNT;
}

function toNanoseconds(milliseconds: number): bigint {
  return BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
}

function copyDate(input: Date): Date {
  return new Date(input.getTime());
}

import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Clock, Data, Effect, Result } from "effect";

import {
  type EncodedTaskRepairSweepContinuationV1,
  TaskRepairSweepContinuationCodecV1Error,
  decodeTaskRepairSweepContinuationV1,
  encodeTaskRepairSweepContinuationV1,
} from "./taskRepairSweepContinuationCodecV1";
import {
  type TaskRepairSweepErrorV1,
  type TaskRepairSweepReceiptV1,
  type TaskRepairSweepV1,
} from "./taskRepairSweepV1";
import {
  retrySchedulerCheckpointOnceOnConfirmedRollbackV1,
  runWithSchedulerCheckpointCleanupV1,
  type SchedulerCheckpointCleanupStateV1,
} from "./schedulerCheckpointRunMechanicsV1";

export type TaskRepairSchedulerAcquireResultV1<Run> =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{
      readonly kind: "acquired";
      readonly run: Run;
      readonly claimExpiresAt: Date;
      readonly continuation: EncodedTaskRepairSweepContinuationV1 | null;
    }>;

export interface TaskRepairSchedulerCheckpointResultV1 {
  readonly kind: "checkpointed";
  readonly checkpointSequence: bigint;
}

export interface TaskRepairSchedulerReleaseResultV1 {
  readonly kind: "released";
  readonly nextRunAt: Date;
}

export interface TaskRepairSchedulerCheckpointPortV1<
  Run,
  ConfigurationError,
  AcquireError,
  CheckpointError,
  ReleaseError,
  AcquireRollback extends AcquireError,
  CheckpointRollback extends CheckpointError,
  ReleaseRollback extends ReleaseError,
> {
  readonly configuration: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    ConfigurationError
  >;
  readonly acquireEffect: () => Effect.Effect<
    TaskRepairSchedulerAcquireResultV1<Run>,
    AcquireError
  >;
  readonly checkpointEffect: (
    run: Run,
    continuation: EncodedTaskRepairSweepContinuationV1 | null,
  ) => Effect.Effect<TaskRepairSchedulerCheckpointResultV1, CheckpointError>;
  readonly releaseEffect: (
    run: Run,
  ) => Effect.Effect<TaskRepairSchedulerReleaseResultV1, ReleaseError>;
  readonly isAcquireConfirmedRollback: (
    error: AcquireError,
  ) => error is AcquireRollback;
  readonly isCheckpointConfirmedRollback: (
    error: CheckpointError,
  ) => error is CheckpointRollback;
  readonly isReleaseConfirmedRollback: (
    error: ReleaseError,
  ) => error is ReleaseRollback;
}

export class TaskRepairSchedulerRunConfigurationV1Error
  extends Data.TaggedError("TaskRepairSchedulerRunConfigurationV1Error")<{
    readonly reason: "invalid_policy";
  }> {}

export class TaskRepairSchedulerRunTimeBudgetV1Error
  extends Data.TaggedError("TaskRepairSchedulerRunTimeBudgetV1Error")<{
    readonly operation: "checkpoint";
  }> {}

export type TaskRepairSchedulerRunResultV1 =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{
      readonly kind: "completed";
      readonly reason: "sweep_completed" | "no_time_to_start";
      readonly sweep: TaskRepairSweepReceiptV1 | null;
      readonly nextRunAt: Date;
    }>;

type TaskRepairSchedulerRunFailureV1<
  DirectoryFailure,
  AcquireError,
  CheckpointError,
  ReleaseError,
> =
  | TaskRepairSweepErrorV1<DirectoryFailure>
  | TaskRepairSweepContinuationCodecV1Error
  | TaskRepairSchedulerRunTimeBudgetV1Error
  | AcquireError
  | CheckpointError
  | ReleaseError;

export interface TaskRepairSchedulerRunV1<Failure> {
  readonly runEffect: () => Effect.Effect<
    TaskRepairSchedulerRunResultV1,
    Failure
  >;
}

interface CapturedPolicyV1 {
  readonly claimDurationNanoseconds: bigint;
  readonly maximumSweepNanoseconds: bigint;
  readonly settlementReserveNanoseconds: bigint;
}

interface AcquiredStateV1<Run>
  extends SchedulerCheckpointCleanupStateV1<Run> {
  readonly leaseDeadline: bigint;
}

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

/**
 * Connects the durable singleton checkpoint to exactly one canonical repair
 * sweep. Host scheduling remains outside this private operation-local runner.
 */
export function createTaskRepairSchedulerRunV1<
  Run,
  DirectoryFailure,
  ConfigurationError,
  AcquireError,
  CheckpointError,
  ReleaseError,
  AcquireRollback extends AcquireError,
  CheckpointRollback extends CheckpointError,
  ReleaseRollback extends ReleaseError,
>(
  checkpoint: TaskRepairSchedulerCheckpointPortV1<
    Run,
    ConfigurationError,
    AcquireError,
    CheckpointError,
    ReleaseError,
    AcquireRollback,
    CheckpointRollback,
    ReleaseRollback
  >,
  sweep: TaskRepairSweepV1<DirectoryFailure>,
): Result.Result<
  TaskRepairSchedulerRunV1<
    TaskRepairSchedulerRunFailureV1<
      DirectoryFailure,
      AcquireError,
      CheckpointError,
      ReleaseError
    >
  >,
  ConfigurationError | TaskRepairSchedulerRunConfigurationV1Error
> {
  return Result.gen(function* () {
    const checkpointConfiguration = yield* checkpoint.configuration;
    const policy = yield* capturePolicy(
      checkpointConfiguration.claimDurationMilliseconds,
      sweep.configuration,
    );
    const checkpointOwner = checkpoint;
    const acquireMethod = checkpointOwner.acquireEffect;
    const checkpointMethod = checkpointOwner.checkpointEffect;
    const releaseMethod = checkpointOwner.releaseEffect;
    const acquireRollbackMethod =
      checkpointOwner.isAcquireConfirmedRollback;
    const checkpointRollbackMethod =
      checkpointOwner.isCheckpointConfirmedRollback;
    const releaseRollbackMethod =
      checkpointOwner.isReleaseConfirmedRollback;
    const sweepOwner = sweep;
    const sweepMethod = sweepOwner.runEffect;

    const acquireEffect = () => acquireMethod.call(checkpointOwner);
    const checkpointEffect = (
      run: Run,
      continuation: EncodedTaskRepairSweepContinuationV1 | null,
    ) => checkpointMethod.call(checkpointOwner, run, continuation);
    const releaseEffect = (run: Run) =>
      releaseMethod.call(checkpointOwner, run);
    const runSweep = (
      continuation: Parameters<typeof sweepMethod>[0],
    ) => sweepMethod.call(sweepOwner, continuation);
    const isAcquireConfirmedRollback = (
      error: AcquireError,
    ): error is AcquireRollback =>
      acquireRollbackMethod.call(checkpointOwner, error);
    const isCheckpointConfirmedRollback = (
      error: CheckpointError,
    ): error is CheckpointRollback =>
      checkpointRollbackMethod.call(checkpointOwner, error);
    const isReleaseConfirmedRollback = (
      error: ReleaseError,
    ): error is ReleaseRollback =>
      releaseRollbackMethod.call(checkpointOwner, error);

    const runEffect = Effect.fn("TaskRepairSchedulerRun.run")(function* () {
      const acquisitionStartedAt = yield* Clock.currentTimeNanos;
      const acquired = yield*
        retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
          acquireEffect,
          isAcquireConfirmedRollback,
          () => Effect.succeed(true),
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

      const state: AcquiredStateV1<Run> = {
        run: acquired.run,
        leaseDeadline: acquisitionStartedAt + policy.claimDurationNanoseconds,
        cleanupAllowed: true,
      };
      return yield* runWithSchedulerCheckpointCleanupV1(
        state,
        Effect.gen(function* () {
          const continuation = acquired.continuation === null
            ? null
            : yield* decodeTaskRepairSweepContinuationV1(
              acquired.continuation,
            );
          if (!(yield* sweepAdmissionEffect(state.leaseDeadline, policy))) {
            const released = yield* releaseKnownRun(
              releaseEffect,
              isReleaseConfirmedRollback,
              state,
              policy,
            );
            return completed("no_time_to_start", null, released.nextRunAt);
          }
          const receipt = yield* runSweep(continuation);
          const encoded = receipt.continuation === null
            ? null
            : yield* encodeTaskRepairSweepContinuationV1(
              receipt.continuation,
            );
          if (!(yield* settlementAdmissionEffect(
            state.leaseDeadline,
            policy,
          ))) {
            return yield* new TaskRepairSchedulerRunTimeBudgetV1Error({
              operation: "checkpoint",
            });
          }

          state.cleanupAllowed = false;
          yield* retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
            () => checkpointEffect(state.run, encoded),
            isCheckpointConfirmedRollback,
            () => settlementAdmissionEffect(state.leaseDeadline, policy),
          );
          state.cleanupAllowed = true;

          const released = yield* releaseKnownRun(
            releaseEffect,
            isReleaseConfirmedRollback,
            state,
            policy,
          );
          return completed("sweep_completed", receipt, released.nextRunAt);
        }),
        releaseEffect,
      );
    });

    return Object.freeze({ runEffect });
  });
}

function capturePolicy(
  claimDurationMilliseconds: number,
  sweep: TaskRepairSweepV1<unknown>["configuration"],
): Result.Result<CapturedPolicyV1, TaskRepairSchedulerRunConfigurationV1Error> {
  const requiredMilliseconds = sweep.maximumRunMilliseconds +
    sweep.settlementReserveMilliseconds;
  if (
    !isPositiveSafeInteger(claimDurationMilliseconds) ||
    !isPositiveSafeInteger(sweep.maximumRunMilliseconds) ||
    !isPositiveSafeInteger(sweep.settlementReserveMilliseconds) ||
    !Number.isSafeInteger(requiredMilliseconds) ||
    requiredMilliseconds > claimDurationMilliseconds
  ) {
    return Result.fail(new TaskRepairSchedulerRunConfigurationV1Error({
      reason: "invalid_policy",
    }));
  }

  return Result.succeed(Object.freeze({
    claimDurationNanoseconds: millisecondsToNanoseconds(
      claimDurationMilliseconds,
    ),
    maximumSweepNanoseconds: millisecondsToNanoseconds(
      sweep.maximumRunMilliseconds,
    ),
    settlementReserveNanoseconds: millisecondsToNanoseconds(
      sweep.settlementReserveMilliseconds,
    ),
  }));
}

function releaseKnownRun<
  Run,
  ReleaseError,
  ReleaseRollback extends ReleaseError,
>(
  releaseEffect: (run: Run) => Effect.Effect<
    TaskRepairSchedulerReleaseResultV1,
    ReleaseError
  >,
  isReleaseConfirmedRollback: (
    error: ReleaseError,
  ) => error is ReleaseRollback,
  state: AcquiredStateV1<Run>,
  policy: CapturedPolicyV1,
): Effect.Effect<TaskRepairSchedulerReleaseResultV1, ReleaseError> {
  state.cleanupAllowed = false;
  return retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
    () => releaseEffect(state.run),
    isReleaseConfirmedRollback,
    () => settlementAdmissionEffect(state.leaseDeadline, policy),
  );
}

function sweepAdmissionEffect(
  leaseDeadline: bigint,
  policy: CapturedPolicyV1,
): Effect.Effect<boolean> {
  return Clock.currentTimeNanos.pipe(Effect.map((now) =>
    now + policy.maximumSweepNanoseconds +
        policy.settlementReserveNanoseconds <= leaseDeadline
  ));
}

function settlementAdmissionEffect(
  leaseDeadline: bigint,
  policy: CapturedPolicyV1,
): Effect.Effect<boolean> {
  return Clock.currentTimeNanos.pipe(Effect.map((now) =>
    now + policy.settlementReserveNanoseconds <= leaseDeadline
  ));
}

function completed(
  reason: "sweep_completed" | "no_time_to_start",
  sweep: TaskRepairSweepReceiptV1 | null,
  nextRunAt: Date,
): Extract<TaskRepairSchedulerRunResultV1, { readonly kind: "completed" }> {
  return Object.freeze({
    kind: "completed",
    reason,
    sweep,
    nextRunAt: copyDate(nextRunAt),
  });
}

function millisecondsToNanoseconds(milliseconds: number): bigint {
  return BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
}

function copyDate(input: Date): Date {
  return new Date(input.getTime());
}

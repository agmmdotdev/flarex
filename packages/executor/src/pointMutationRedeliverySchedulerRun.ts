import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  Clock,
  Data,
  Duration,
  Effect,
  Result,
} from "effect";

import {
  type PointMutationMultiScopeRedeliveryContinuationV1,
  type PointMutationMultiScopeRedeliveryResultV1,
  type PointMutationMultiScopeRedeliveryV1,
  type PointMutationMultiScopeRedeliveryV1Error,
} from "./pointMutationMultiScopeRedelivery";
import {
  type EncodedPointMutationMultiScopeRedeliveryContinuationV1,
  PointMutationMultiScopeRedeliveryContinuationCodecV1Error,
  decodePointMutationMultiScopeRedeliveryContinuationV1,
  encodePointMutationMultiScopeRedeliveryContinuationV1,
} from "./pointMutationMultiScopeRedeliveryContinuationCodec";
import type {
  PointMutationRedeliverySchedulerHostRunV1,
} from "./pointMutationRedeliverySchedulerHostContract";
import {
  retrySchedulerCheckpointOnceOnConfirmedRollbackV1,
  runWithSchedulerCheckpointCleanupV1,
  type SchedulerCheckpointCleanupStateV1,
} from "./schedulerCheckpointRunMechanicsV1";

export interface PointMutationRedeliverySchedulerAcquireNotDueV1 {
  readonly kind: "notDue";
  readonly nextRunAt: Date;
}

export interface PointMutationRedeliverySchedulerAcquireBusyV1 {
  readonly kind: "busy";
  readonly claimExpiresAt: Date;
}

export interface PointMutationRedeliverySchedulerAcquireGrantedV1<Run> {
  readonly kind: "acquired";
  readonly run: Run;
  readonly claimExpiresAt: Date;
  readonly continuation:
    | EncodedPointMutationMultiScopeRedeliveryContinuationV1
    | null;
}

export type PointMutationRedeliverySchedulerAcquireResultV1<Run> =
  | PointMutationRedeliverySchedulerAcquireNotDueV1
  | PointMutationRedeliverySchedulerAcquireBusyV1
  | PointMutationRedeliverySchedulerAcquireGrantedV1<Run>;

export interface PointMutationRedeliverySchedulerRenewResultV1 {
  readonly kind: "renewed";
  readonly claimExpiresAt: Date;
}

export interface PointMutationRedeliverySchedulerCheckpointResultV1 {
  readonly kind: "checkpointed";
  readonly checkpointSequence: bigint;
}

export interface PointMutationRedeliverySchedulerReleaseResultV1 {
  readonly kind: "released";
  readonly nextRunAt: Date;
}

export interface PointMutationRedeliverySchedulerCheckpointPortV1<
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
    PointMutationRedeliverySchedulerAcquireResultV1<Run>,
    AcquireError,
    never
  >;
  readonly renewEffect: (
    run: Run,
  ) => Effect.Effect<
    PointMutationRedeliverySchedulerRenewResultV1,
    RenewError,
    never
  >;
  readonly checkpointEffect: (
    run: Run,
    continuation:
      | EncodedPointMutationMultiScopeRedeliveryContinuationV1
      | null,
  ) => Effect.Effect<
    PointMutationRedeliverySchedulerCheckpointResultV1,
    CheckpointError,
    never
  >;
  readonly releaseEffect: (
    run: Run,
  ) => Effect.Effect<
    PointMutationRedeliverySchedulerReleaseResultV1,
    ReleaseError,
    never
  >;
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

export interface PointMutationRedeliverySchedulerRunOptionsV1 {
  readonly maximumInvocations: number;
  readonly maximumAttemptPages: number;
  readonly maximumCandidateAttempts: number;
  readonly scopeLimitPerInvocation: number;
  readonly maximumRunMilliseconds: number;
  readonly maximumInvocationMilliseconds: number;
  readonly settlementReserveMilliseconds: number;
}

export class PointMutationRedeliverySchedulerRunConfigurationV1Error
  extends Data.TaggedError(
    "PointMutationRedeliverySchedulerRunConfigurationV1Error",
  )<{
    readonly reason: "invalidPolicy";
  }> {}

export class PointMutationRedeliverySchedulerInvocationTimeoutV1Error
  extends Data.TaggedError(
    "PointMutationRedeliverySchedulerInvocationTimeoutV1Error",
  )<{
    readonly invocation: number;
    readonly budgetNanoseconds: bigint;
  }> {}

export type PointMutationRedeliverySchedulerRunStopReasonV1 =
  | "continuationExhausted"
  | "countBudget"
  | "noTimeToStart"
  | "timeBudget";

export type PointMutationRedeliverySchedulerRunResultV1 =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{
      readonly kind: "completed";
      readonly reason: PointMutationRedeliverySchedulerRunStopReasonV1;
      readonly invocations: number;
      readonly attemptPagesCharged: number;
      readonly candidateAttemptsCharged: number;
      readonly batches: ReadonlyArray<PointMutationMultiScopeRedeliveryResultV1>;
      readonly nextRunAt: Date;
    }>;

export interface PointMutationRedeliverySchedulerRunV1<Failure>
  extends PointMutationRedeliverySchedulerHostRunV1<Failure> {
  readonly runEffect: () => Effect.Effect<
    PointMutationRedeliverySchedulerRunResultV1,
    Failure,
    never
  >;
}

type SchedulerRunFailureV1<
  AcquireError,
  RenewError,
  CheckpointError,
  ReleaseError,
> =
  | AcquireError
  | RenewError
  | CheckpointError
  | ReleaseError
  | PointMutationMultiScopeRedeliveryV1Error
  | PointMutationMultiScopeRedeliveryContinuationCodecV1Error
  | PointMutationRedeliverySchedulerInvocationTimeoutV1Error;

interface CapturedRunPolicyV1 extends PointMutationRedeliverySchedulerRunOptionsV1 {
  readonly claimDurationMilliseconds: number;
  readonly claimDurationNanoseconds: bigint;
  readonly maximumRunNanoseconds: bigint;
  readonly maximumInvocationNanoseconds: bigint;
  readonly settlementReserveNanoseconds: bigint;
}

interface AcquiredLifecycleStateV1<Run>
  extends SchedulerCheckpointCleanupStateV1<Run> {
  leaseDeadline: bigint;
}

const MAX_RUN_COUNT_V1 = 100;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

export function createPointMutationRedeliverySchedulerRunV1<
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
  checkpoint: PointMutationRedeliverySchedulerCheckpointPortV1<
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
  multiScope: Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect">,
  options: PointMutationRedeliverySchedulerRunOptionsV1,
): Result.Result<
  PointMutationRedeliverySchedulerRunV1<
    SchedulerRunFailureV1<
      AcquireError,
      RenewError,
      CheckpointError,
      ReleaseError
    >
  >,
  ConfigurationError | PointMutationRedeliverySchedulerRunConfigurationV1Error
> {
  return Result.gen(function* () {
    const checkpointConfiguration = yield* checkpoint.configuration;
    const policy = yield* capturePolicy(
      options,
      checkpointConfiguration.claimDurationMilliseconds,
    );

    const runEffect = Effect.fn(
      "PointMutationRedeliverySchedulerRun.run",
    )(function* () {
      const startedAt = yield* Clock.currentTimeNanos;
      const deadline = startedAt + policy.maximumRunNanoseconds;
      const acquired = yield* retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
        checkpoint.acquireEffect,
        checkpoint.isAcquireConfirmedRollback,
        () => retryAdmissionEffect(deadline, policy),
      );

      switch (acquired.kind) {
        case "notDue":
          return Object.freeze({
            kind: "notDue" as const,
            nextRunAt: copyDate(acquired.nextRunAt),
          });
        case "busy":
          return Object.freeze({
            kind: "busy" as const,
            claimExpiresAt: copyDate(acquired.claimExpiresAt),
          });
        case "acquired": {
          const state: AcquiredLifecycleStateV1<Run> = {
            run: acquired.run,
            leaseDeadline: startedAt + policy.claimDurationNanoseconds,
            cleanupAllowed: true,
          };
          return yield* runAcquiredWithCleanup(
            checkpoint,
            multiScope,
            policy,
            deadline,
            state,
            acquired.continuation,
          );
        }
      }
    });

    return Object.freeze({ runEffect });
  });
}

function capturePolicy(
  options: PointMutationRedeliverySchedulerRunOptionsV1,
  claimDurationMilliseconds: number,
): Result.Result<
  CapturedRunPolicyV1,
  PointMutationRedeliverySchedulerRunConfigurationV1Error
> {
  const invocationAndReserve = options.maximumInvocationMilliseconds +
    options.settlementReserveMilliseconds;
  if (
    !isBoundedCount(options.maximumInvocations) ||
    !isBoundedCount(options.maximumAttemptPages) ||
    !isBoundedCount(options.maximumCandidateAttempts) ||
    options.maximumCandidateAttempts > options.maximumAttemptPages ||
    !isBoundedCount(options.scopeLimitPerInvocation) ||
    !isPositiveSafeInteger(options.maximumRunMilliseconds) ||
    !isPositiveSafeInteger(options.maximumInvocationMilliseconds) ||
    !isPositiveSafeInteger(options.settlementReserveMilliseconds) ||
    !isPositiveSafeInteger(claimDurationMilliseconds) ||
    !Number.isSafeInteger(invocationAndReserve) ||
    invocationAndReserve > options.maximumRunMilliseconds ||
    invocationAndReserve > claimDurationMilliseconds
  ) {
    return Result.fail(
      new PointMutationRedeliverySchedulerRunConfigurationV1Error({
        reason: "invalidPolicy",
      }),
    );
  }

  return Result.succeed(Object.freeze({
    ...options,
    claimDurationMilliseconds,
    claimDurationNanoseconds: millisecondsToNanoseconds(
      claimDurationMilliseconds,
    ),
    maximumRunNanoseconds: millisecondsToNanoseconds(
      options.maximumRunMilliseconds,
    ),
    maximumInvocationNanoseconds: millisecondsToNanoseconds(
      options.maximumInvocationMilliseconds,
    ),
    settlementReserveNanoseconds: millisecondsToNanoseconds(
      options.settlementReserveMilliseconds,
    ),
  }));
}

function isBoundedCount(value: number): boolean {
  return isPositiveSafeInteger(value) && value <= MAX_RUN_COUNT_V1;
}

function millisecondsToNanoseconds(milliseconds: number): bigint {
  return BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
}

function runAcquiredWithCleanup<
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
  checkpoint: PointMutationRedeliverySchedulerCheckpointPortV1<
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
  multiScope: Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect">,
  policy: CapturedRunPolicyV1,
  deadline: bigint,
  state: AcquiredLifecycleStateV1<Run>,
  persistedContinuation:
    | EncodedPointMutationMultiScopeRedeliveryContinuationV1
    | null,
): Effect.Effect<
  PointMutationRedeliverySchedulerRunResultV1,
  SchedulerRunFailureV1<
    AcquireError,
    RenewError,
    CheckpointError,
    ReleaseError
  >,
  never
> {
  return runWithSchedulerCheckpointCleanupV1(
    state,
    runAcquired(
      checkpoint,
      multiScope,
      policy,
      deadline,
      state,
      persistedContinuation,
    ),
    (run) => checkpoint.releaseEffect(run),
  );
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
  checkpoint: PointMutationRedeliverySchedulerCheckpointPortV1<
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
  multiScope: Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect">,
  policy: CapturedRunPolicyV1,
  deadline: bigint,
  state: AcquiredLifecycleStateV1<Run>,
  persistedContinuation:
    | EncodedPointMutationMultiScopeRedeliveryContinuationV1
    | null,
): Effect.Effect<
  PointMutationRedeliverySchedulerRunResultV1,
  | RenewError
  | CheckpointError
  | ReleaseError
  | PointMutationMultiScopeRedeliveryV1Error
  | PointMutationMultiScopeRedeliveryContinuationCodecV1Error
  | PointMutationRedeliverySchedulerInvocationTimeoutV1Error,
  never
> {
  return Effect.gen(function* () {
    let continuation: PointMutationMultiScopeRedeliveryContinuationV1 | undefined =
      persistedContinuation === null
        ? undefined
        : yield* decodePointMutationMultiScopeRedeliveryContinuationV1(
          persistedContinuation,
        );
    const batches: PointMutationMultiScopeRedeliveryResultV1[] = [];
    let invocations = 0;
    let attemptPagesCharged = 0;
    let candidateAttemptsCharged = 0;

    while (true) {
      const invocationBudget = yield* invocationBudgetEffect(
        deadline,
        policy,
        state.leaseDeadline,
      );
      if (invocationBudget === null) {
        const reason = invocations === 0 ? "noTimeToStart" : "timeBudget";
        const released = yield* releaseKnownRun(
          checkpoint,
          policy,
          deadline,
          state,
        );
        return completed(
          reason,
          invocations,
          attemptPagesCharged,
          candidateAttemptsCharged,
          batches,
          released.nextRunAt,
        );
      }

      const remainingAttemptPages = policy.maximumAttemptPages -
        attemptPagesCharged;
      const remainingCandidateAttempts = policy.maximumCandidateAttempts -
        candidateAttemptsCharged;
      if (
        invocations >= policy.maximumInvocations ||
        remainingAttemptPages <= 0 ||
        remainingCandidateAttempts <= 0
      ) {
        const released = yield* releaseKnownRun(
          checkpoint,
          policy,
          deadline,
          state,
        );
        return completed(
          "countBudget",
          invocations,
          attemptPagesCharged,
          candidateAttemptsCharged,
          batches,
          released.nextRunAt,
        );
      }

      const batch = yield* multiScope.sweepEffect({
        scopeLimit: policy.scopeLimitPerInvocation,
        maxAttemptPages: remainingAttemptPages,
        maxCandidateAttempts: remainingCandidateAttempts,
        ...(continuation === undefined ? {} : { continuation }),
      }).pipe(Effect.timeoutOrElse({
        duration: Duration.nanos(invocationBudget),
        orElse: () => Effect.fail(
          new PointMutationRedeliverySchedulerInvocationTimeoutV1Error({
            invocation: invocations + 1,
            budgetNanoseconds: invocationBudget,
          }),
        ),
      }));
      batches.push(batch);
      invocations += 1;
      attemptPagesCharged += batch.attemptPagesCharged;
      candidateAttemptsCharged += batch.candidateAttemptsCharged;

      const encoded = batch.continuation === null
        ? null
        : yield* encodePointMutationMultiScopeRedeliveryContinuationV1(
          batch.continuation,
        );
      state.cleanupAllowed = false;
      yield* retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
        () => checkpoint.checkpointEffect(state.run, encoded),
        checkpoint.isCheckpointConfirmedRollback,
        () => retryAdmissionEffect(deadline, policy, state.leaseDeadline),
      );
      state.cleanupAllowed = true;

      if (batch.continuation === null) {
        const released = yield* releaseKnownRun(
          checkpoint,
          policy,
          deadline,
          state,
        );
        return completed(
          "continuationExhausted",
          invocations,
          attemptPagesCharged,
          candidateAttemptsCharged,
          batches,
          released.nextRunAt,
        );
      }
      continuation = batch.continuation;

      if (
        invocations >= policy.maximumInvocations ||
        attemptPagesCharged >= policy.maximumAttemptPages ||
        candidateAttemptsCharged >= policy.maximumCandidateAttempts
      ) {
        const released = yield* releaseKnownRun(
          checkpoint,
          policy,
          deadline,
          state,
        );
        return completed(
          "countBudget",
          invocations,
          attemptPagesCharged,
          candidateAttemptsCharged,
          batches,
          released.nextRunAt,
        );
      }

      if (!(yield* retryAdmissionEffect(
        deadline,
        policy,
        state.leaseDeadline,
      ))) {
        const released = yield* releaseKnownRun(
          checkpoint,
          policy,
          deadline,
          state,
        );
        return completed(
          "timeBudget",
          invocations,
          attemptPagesCharged,
          candidateAttemptsCharged,
          batches,
          released.nextRunAt,
        );
      }

      const renewalStartedAt = yield* Clock.currentTimeNanos;
      state.cleanupAllowed = false;
      yield* retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
        () => checkpoint.renewEffect(state.run),
        checkpoint.isRenewConfirmedRollback,
        () => retryAdmissionEffect(deadline, policy, state.leaseDeadline),
      );
      state.leaseDeadline = renewalStartedAt +
        policy.claimDurationNanoseconds;
      state.cleanupAllowed = true;
      if ((yield* invocationBudgetEffect(
        deadline,
        policy,
        state.leaseDeadline,
      )) === null) {
        const released = yield* releaseKnownRun(
          checkpoint,
          policy,
          deadline,
          state,
        );
        return completed(
          "timeBudget",
          invocations,
          attemptPagesCharged,
          candidateAttemptsCharged,
          batches,
          released.nextRunAt,
        );
      }
    }
  });
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
  checkpoint: PointMutationRedeliverySchedulerCheckpointPortV1<
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
  policy: CapturedRunPolicyV1,
  deadline: bigint,
  state: AcquiredLifecycleStateV1<Run>,
): Effect.Effect<
  PointMutationRedeliverySchedulerReleaseResultV1,
  ReleaseError,
  never
> {
  state.cleanupAllowed = false;
  return retrySchedulerCheckpointOnceOnConfirmedRollbackV1(
    () => checkpoint.releaseEffect(state.run),
    checkpoint.isReleaseConfirmedRollback,
    () => retryAdmissionEffect(deadline, policy, state.leaseDeadline),
  );
}

function invocationBudgetEffect(
  deadline: bigint,
  policy: CapturedRunPolicyV1,
  leaseDeadline: bigint = deadline,
): Effect.Effect<bigint | null> {
  return Clock.currentTimeNanos.pipe(Effect.map((now) => {
    const effectiveDeadline = leaseDeadline < deadline
      ? leaseDeadline
      : deadline;
    const remaining = effectiveDeadline - now -
      policy.settlementReserveNanoseconds;
    if (remaining <= 0n) return null;
    return remaining < policy.maximumInvocationNanoseconds
      ? remaining
      : policy.maximumInvocationNanoseconds;
  }));
}

function retryAdmissionEffect(
  deadline: bigint,
  policy: CapturedRunPolicyV1,
  leaseDeadline: bigint = deadline,
): Effect.Effect<boolean> {
  return invocationBudgetEffect(deadline, policy, leaseDeadline).pipe(
    Effect.map((budget) => budget !== null),
  );
}

function completed(
  reason: PointMutationRedeliverySchedulerRunStopReasonV1,
  invocations: number,
  attemptPagesCharged: number,
  candidateAttemptsCharged: number,
  batches: ReadonlyArray<PointMutationMultiScopeRedeliveryResultV1>,
  nextRunAt: Date,
): Extract<PointMutationRedeliverySchedulerRunResultV1, { kind: "completed" }> {
  return Object.freeze({
    kind: "completed",
    reason,
    invocations,
    attemptPagesCharged,
    candidateAttemptsCharged,
    batches: Object.freeze([...batches]),
    nextRunAt: copyDate(nextRunAt),
  });
}

function copyDate(input: Date): Date {
  return new Date(input.getTime());
}

import { Clock, Duration, Effect } from "effect";

import type {
  QuerySyncStateIntegrationError,
  QuerySyncStateOperation,
} from "../state/Errors.js";

const NANOS_PER_MILLISECOND = 1_000_000n;

type TaggedFailure = Readonly<{ readonly _tag: string }>;

export interface RetryDelayPolicy {
  readonly retryDelayMilliseconds: readonly [number, number];
}

export interface StateOperationRetryPolicy extends RetryDelayPolicy {
  readonly stateAttemptsPerOperation: number;
}

export interface TurnWindow {
  readonly admissionCutoffNanos: bigint;
  readonly settlementCutoffNanos: bigint;
}

export function makeTurnWindow(
  startNanos: bigint,
  newWorkWindowMilliseconds: number,
  settlementReserveMilliseconds: number,
): TurnWindow {
  const settlementCutoffNanos = startNanos
    + BigInt(newWorkWindowMilliseconds) * NANOS_PER_MILLISECOND;
  return {
    admissionCutoffNanos: settlementCutoffNanos
      - BigInt(settlementReserveMilliseconds) * NANOS_PER_MILLISECOND,
    settlementCutoffNanos,
  };
}

export function remainingAdmissionMilliseconds(
  cutoffNanos: bigint,
  nowNanos: bigint,
): number {
  if (nowNanos >= cutoffNanos) return 0;
  return Number((cutoffNanos - nowNanos) / NANOS_PER_MILLISECOND);
}

export const canStartBefore = Effect.fn(
  "QuerySync.Orchestration.canStartBefore",
)(function*(cutoffNanos: bigint): Effect.fn.Return<boolean> {
  const nowNanos = yield* Clock.currentTimeNanos;
  return nowNanos < cutoffNanos;
});

export const awaitRetryDelay = Effect.fn(
  "QuerySync.Orchestration.awaitRetryDelay",
)(function*(
  delayMilliseconds: number,
  cutoffNanos: bigint,
): Effect.fn.Return<boolean> {
  const beforeDelay = yield* Clock.currentTimeNanos;
  const delayNanos = BigInt(delayMilliseconds) * NANOS_PER_MILLISECOND;
  if (beforeDelay + delayNanos >= cutoffNanos) return false;
  if (delayMilliseconds > 0) {
    yield* Effect.sleep(Duration.millis(delayMilliseconds));
  }
  const afterDelay = yield* Clock.currentTimeNanos;
  return afterDelay < cutoffNanos;
});

export function retryDelayForAttempt(
  policy: RetryDelayPolicy,
  completedAttempt: number,
): number {
  return policy.retryDelayMilliseconds[completedAttempt - 1] ?? 0;
}

export function runStateOperationWithRetry<
  A,
  Operation extends QuerySyncStateOperation,
  DomainError extends TaggedFailure,
>(input: {
  readonly operation: Operation;
  readonly invoke: () => Effect.Effect<
    A,
    DomainError | QuerySyncStateIntegrationError<Operation>,
    never
  >;
  readonly policy: StateOperationRetryPolicy;
  readonly cutoffNanos: bigint;
  readonly replayUnknown: boolean;
}): Effect.Effect<
  A,
  DomainError | QuerySyncStateIntegrationError<Operation>,
  never
> {
  const runAttempt = (
    attemptNumber: number,
  ): Effect.Effect<
    A,
    DomainError | QuerySyncStateIntegrationError<Operation>,
    never
  > => {
    const retry = <Failure extends
      DomainError | QuerySyncStateIntegrationError<Operation>>(
      error: Failure,
    ): Effect.Effect<
      A,
      DomainError | QuerySyncStateIntegrationError<Operation>,
      never
    > => {
      if (attemptNumber >= input.policy.stateAttemptsPerOperation) {
        return Effect.fail(error);
      }
      const delay = retryDelayForAttempt(input.policy, attemptNumber);
      return awaitRetryDelay(delay, input.cutoffNanos).pipe(
        Effect.flatMap((allowed) => (
          allowed ? runAttempt(attemptNumber + 1) : Effect.fail(error)
        )),
      );
    };

    return input.invoke().pipe(Effect.catchIf(
      (error) =>
        error._tag === "QuerySyncStateUnavailableError"
        || error._tag === "QuerySyncStateContentionError"
        || error._tag === "QuerySyncStateCommitOutcomeUnknownError",
      (error) =>
        error._tag === "QuerySyncStateCommitOutcomeUnknownError"
          && !input.replayUnknown
          ? Effect.fail(error)
          : retry(error),
    ));
  };
  return runAttempt(1);
}

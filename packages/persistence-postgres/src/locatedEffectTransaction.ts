import { Cause, Effect, Exit } from "effect";

import type { AppRowTransaction } from "./appRows";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

interface StartedTransaction<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

/** Owns the shared Drizzle Promise-to-Effect boundary for located operations. */
export function runLocatedEffectQuery<Row, IntegrationFailure>(
  queryValue: PromiseLike<ReadonlyArray<Row>>,
  operation: string,
  integrationFailure: (
    operation: string,
    cause: unknown,
  ) => IntegrationFailure,
): Effect.Effect<ReadonlyArray<Row>, IntegrationFailure> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: () => queryValue,
    catch: cause => integrationFailure(operation, cause),
  }));
}

/**
 * Owns the single Effect runtime bridge needed by the Drizzle transaction
 * callback and preserves typed callback failure, rollback, and cleanup causes.
 */
export const runLocatedEffectTransaction = Effect.fn(
  "LocatedEffectTransaction.run",
)(function* <Value, Failure, IntegrationFailure>(
  target: LocatedReadCommittedAttemptTargetV1,
  operation: string,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
  integrationFailure: (
    operation: string,
    cause: unknown,
  ) => IntegrationFailure,
  rollbackMessage: string,
): Effect.fn.Return<Value, Failure | IntegrationFailure> {
  return yield* Effect.uninterruptibleMask(() => Effect.gen(function* () {
    const started = startLocatedEffectTransaction(
      target,
      work,
      rollbackMessage,
    );
    const settled = yield* Effect.tryPromise({
      try: () => started.promise,
      catch: cause => cause,
    }).pipe(Effect.exit);
    if (Exit.isSuccess(settled)) return settled.value;
    const error = Cause.findErrorOption(settled.cause);
    if (error._tag === "None") {
      return yield* Effect.failCause(Cause.map(
        settled.cause,
        cause => integrationFailure(operation, cause),
      ));
    }
    const cause = error.value;
    const callbackCause = started.callbackCause();
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackRolledBack" &&
      cause.issue.callbackCause === started.rollbackSignal &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(callbackCause);
    }
    if (
      cause instanceof LocatedReadCommittedTransactionFailureV1 &&
      cause.issue.kind === "callbackCleanupFailed" &&
      callbackCause !== undefined
    ) {
      return yield* Effect.failCause(Cause.combine(
        callbackCause,
        Cause.die(integrationFailure(operation, cause)),
      ));
    }
    return yield* Effect.fail(integrationFailure(operation, cause));
  }));
});

function startLocatedEffectTransaction<Value, Failure>(
  target: LocatedReadCommittedAttemptTargetV1,
  work: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
  rollbackMessage: string,
): StartedTransaction<Value, Failure> {
  let callbackCause: Cause.Cause<Failure> | undefined;
  const rollbackSignal = new Error(rollbackMessage);
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const exit = await Effect.runPromise(Effect.exit(work(tx)));
    if (Exit.isFailure(exit)) {
      callbackCause = exit.cause;
      throw rollbackSignal;
    }
    return exit.value;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => callbackCause,
  });
}

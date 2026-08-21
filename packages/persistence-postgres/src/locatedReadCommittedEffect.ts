import { Cause, Effect, Exit } from "effect";

import type { AppRowTransaction } from "./appRows";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";

export interface LocatedReadCommittedEffectOptions {
  readonly rollbackMessage: string;
  readonly cleanupDefect: (
    failure: LocatedReadCommittedTransactionFailureV1,
  ) => unknown;
}

interface StartedRead<Value, Failure> {
  readonly promise: Promise<Value>;
  readonly rollbackSignal: Error;
  readonly callbackCause: () => Cause.Cause<Failure> | undefined;
}

/**
 * Persistence-owned bridge for Effect callbacks executed by the located
 * read-committed Promise transaction contract. Domain failures stay in their
 * original Cause; transaction resource failures keep the kernel's typed error.
 */
export const runLocatedReadCommittedEffect = Effect.fn(
  "LocatedReadCommitted.runEffect",
)(function <Value, Failure>(
  target: LocatedReadCommittedAttemptTargetV1,
  options: LocatedReadCommittedEffectOptions,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.Effect<
  Value,
  Failure | LocatedReadCommittedTransactionFailureV1
> {
  return Effect.suspend((): Effect.Effect<
    Value,
    Failure | LocatedReadCommittedTransactionFailureV1
  > => {
    const started = startLocatedRead(target, options.rollbackMessage, body);
    const settled = Effect.uninterruptible(Effect.exit(Effect.tryPromise({
      try: () => started.promise,
      catch: (cause): unknown => cause,
    })));
    return settled.pipe(Effect.flatMap((exit): Effect.Effect<
      Value,
      Failure | LocatedReadCommittedTransactionFailureV1
    > => {
      if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
      const error = Cause.findErrorOption(exit.cause);
      if (error._tag === "None") {
        // SAFETY: exit.cause is the original failure channel of the wrapped
        // body, which this effect already declares as its failure type.
        return Effect.failCause(exit.cause as Cause.Cause<
          Failure | LocatedReadCommittedTransactionFailureV1
        >);
      }
      const cause = error.value;
      if (
        cause instanceof LocatedReadCommittedTransactionFailureV1 &&
        cause.issue.kind === "callbackRolledBack" &&
        cause.issue.callbackCause === started.rollbackSignal
      ) {
        const callbackCause = started.callbackCause();
        return callbackCause === undefined
          ? Effect.die(cause)
          : Effect.failCause(callbackCause);
      }
      if (
        cause instanceof LocatedReadCommittedTransactionFailureV1 &&
        cause.issue.kind === "callbackCleanupFailed" &&
        cause.issue.callbackCause === started.rollbackSignal
      ) {
        const callbackCause = started.callbackCause();
        return callbackCause === undefined
          ? Effect.die(cause)
          : Effect.failCause(Cause.combine(
              callbackCause,
              Cause.die(options.cleanupDefect(cause)),
            ));
      }
      return cause instanceof LocatedReadCommittedTransactionFailureV1
        ? Effect.fail(cause)
        : Effect.die(cause);
    }));
  });
});

function startLocatedRead<Value, Failure>(
  target: LocatedReadCommittedAttemptTargetV1,
  rollbackMessage: string,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): StartedRead<Value, Failure> {
  const rollbackSignal = new Error(rollbackMessage);
  let callbackCause: Cause.Cause<Failure> | undefined;
  const promise = target[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
    const exit = await Effect.runPromiseExit(body(tx));
    if (Exit.isSuccess(exit)) return exit.value;
    callbackCause = exit.cause;
    throw rollbackSignal;
  });
  return Object.freeze({
    promise,
    rollbackSignal,
    callbackCause: () => callbackCause,
  });
}

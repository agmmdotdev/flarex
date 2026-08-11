import { Cause, Effect, Exit } from "effect";

/** Shared lifecycle bridge for Effect work owned by a Promise transaction. */
export function runEffectTransaction<Value, Failure, SettlementFailure, Tx>(
  start: (callback: (tx: Tx) => Promise<Value>) => Promise<Value>,
  rollbackMessage: string,
  body: (tx: Tx) => Effect.Effect<Value, Failure>,
  settlementFailure: (cause: unknown) => SettlementFailure,
): Effect.Effect<Value, Failure | SettlementFailure> {
  return Effect.suspend(() => {
    let callbackCause: Cause.Cause<Failure> | undefined;
    const rollback = new Error(rollbackMessage);
    const transaction = start(async tx => {
      const exit = await Effect.runPromiseExit(body(tx));
      if (Exit.isFailure(exit)) {
        callbackCause = exit.cause;
        throw rollback;
      }
      return exit.value;
    });
    return awaitSettlement(
      transaction,
      cause => callbackCause !== undefined && cause === rollback,
    ).pipe(Effect.catch(cause => {
      if (callbackCause !== undefined && cause === rollback) {
        return Effect.failCause(callbackCause);
      }
      const resource = settlementFailure(cause);
      return callbackCause === undefined
        ? Effect.fail(resource)
        : Effect.failCause(Cause.combine(callbackCause, Cause.fail(resource)));
    }));
  });
}

function awaitSettlement<Value>(
  promise: Promise<Value>,
  isExpectedInterruptedRejection: (cause: unknown) => boolean,
): Effect.Effect<Value, unknown> {
  return Effect.uninterruptibleMask(restore =>
    restore(Effect.tryPromise({
      try: () => promise,
      catch: cause => cause,
    })).pipe(Effect.onInterrupt(interruptors =>
      Effect.tryPromise({
        try: () => promise.then(() => undefined),
        catch: cause => cause,
      }).pipe(Effect.catch(cause => isExpectedInterruptedRejection(cause)
        ? Effect.void
        : Effect.failCause(interruptedSettlementCause(interruptors, cause))))
    ))
  );
}

function interruptedSettlementCause(
  interruptors: ReadonlySet<number>,
  defect: unknown,
): Cause.Cause<never> {
  let combined = Cause.die(defect);
  for (const interruptor of interruptors) {
    combined = Cause.combine(Cause.interrupt(interruptor), combined);
  }
  return combined;
}

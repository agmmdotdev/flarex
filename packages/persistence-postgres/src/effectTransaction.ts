import { Cause, Context, Effect, Exit, Tracer } from "effect";
import { acquireInstallationAdmission, closeInstallationAdmission, lockInstallationForCurrentTransaction,
  type PreparedInstallation } from "./installationLifecycle";
import type { FlarexMetadataDatabase } from "./deployments";
import type { FlarexMetadataTransaction } from "./metadataTransaction";

/** Raw-database owner: admission precedes body locks and ends with this callback. */
export function runEffectTransaction<Value, Failure, SettlementFailure, Tx extends FlarexMetadataTransaction>(
  start: (callback: (tx: Tx) => Promise<Value>) => Promise<Value>,
  rollbackMessage: string,
  body: (tx: Tx) => Effect.Effect<Value, Failure>,
  settlementFailure: (cause: unknown) => SettlementFailure,
  installation?: Readonly<{ token: PreparedInstallation; database: FlarexMetadataDatabase }>,
): Effect.Effect<Value, Failure | SettlementFailure> {
  return runEffectTransactionSettlement(start, rollbackMessage, tx =>
    (installation === undefined ? lockInstallationForCurrentTransaction(tx)
      : acquireInstallationAdmission(installation.token, installation.database, tx)).pipe(
      Effect.mapError(settlementFailure),
      Effect.andThen(() => body(tx)),
      Effect.ensuring(Effect.sync(() => closeInstallationAdmission(tx))),
    ), settlementFailure);
}

/** Shared Exit/Cause bridge. The supplied transaction owner retains admission,
 * postconditions, COMMIT and cleanup through settlement. */
export function runEffectTransactionSettlement<Value, Failure, SettlementFailure, Tx extends FlarexMetadataTransaction>(
  start: (callback: (tx: Tx) => Promise<Value>) => Promise<Value>,
  rollbackMessage: string,
  body: (tx: Tx) => Effect.Effect<Value, Failure>,
  settlementFailure: (cause: unknown) => SettlementFailure,
): Effect.Effect<Value, Failure | SettlementFailure> {
  return Effect.withFiber(fiber => {
    const tracerContext = Context.make(Tracer.Tracer, Context.get(fiber.context, Tracer.Tracer));
    const tracingContext = fiber.currentSpan === undefined ? tracerContext
      : Context.add(tracerContext, Tracer.ParentSpan, fiber.currentSpan);
    const runPromiseExit = Effect.runPromiseExitWith(tracingContext);
    let callbackCause: Cause.Cause<Failure | SettlementFailure> | undefined;
    const rollback = new Error(rollbackMessage);
    const transaction = start(async tx => {
      const exit = await runPromiseExit(Effect.suspend(() => body(tx)));
      if (Exit.isFailure(exit)) {
        callbackCause = exit.cause;
        throw rollback;
      }
      return exit.value;
    });
    return awaitEffectTransactionSettlement(
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

export function awaitEffectTransactionSettlement<Value>(
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

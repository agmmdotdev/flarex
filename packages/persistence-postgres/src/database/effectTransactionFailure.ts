import { Cause, Effect } from "effect";

/**
 * Reconcile an Effect callback Cause with the failure reported by a
 * Promise-only transaction owner after it attempts rollback or cleanup.
 *
 * Domain transaction runners retain their own error types and rollback
 * sentinels; this helper owns only the shared full-Cause preservation policy.
 */
export function reconcileEffectTransactionFailure<
  Failure,
  TransactionFailure extends Readonly<{ cause: unknown }>,
>(
  transactionFailure: TransactionFailure,
  callbackCause: Cause.Cause<Failure> | undefined,
  rollbackSignal: unknown,
): Effect.Effect<never, Failure | TransactionFailure> {
  if (
    callbackCause !== undefined
    && transactionFailure.cause === rollbackSignal
  ) {
    return Effect.failCause(callbackCause);
  }
  if (
    callbackCause !== undefined
    && (Cause.hasDies(callbackCause) || Cause.hasInterrupts(callbackCause))
  ) {
    return Effect.failCause(Cause.combine(
      callbackCause,
      Cause.die(transactionFailure),
    ));
  }
  return Effect.fail(transactionFailure);
}

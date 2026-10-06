import { Cause, Effect, Exit, Result } from "effect";
import { LocatedReadCommittedTransactionFailureV1 } from "./transactionSessionAttemptKernel";

/** The single audited Effect runtime bridge for the Promise transaction. */
export async function runPointCommitInTransactionEffect<Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
): Promise<Result.Result<Value, Failure>> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return Result.succeed(exit.value);
  const reason = exit.cause.reasons[0];
  if (exit.cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason))
    return Result.fail(reason.error);
  throw exit.cause;
}

/** Reenter the owned Promise kernel without treating a full Cause as one
 * scalar error. Settlement uncertainty and cleanup failures retain their owner. */
export function runPointCommitPromiseEffect<Value, Failure>(
  work: () => PromiseLike<Value>,
  mapFailure: (cause: unknown) => Failure,
): Effect.Effect<Value, Failure> {
  return Effect.tryPromise({
    try: work,
    catch: cause => {
      const callback = cause instanceof LocatedReadCommittedTransactionFailureV1 && cause.issue.kind === "callbackRolledBack"
        ? cause.issue.callbackCause : cause;
      return Cause.isCause(callback) ? callback : cause;
    },
  }).pipe(
    Effect.catchIf(Cause.isCause,
      cause => Effect.failCause(Cause.map(cause, mapFailure)),
      cause => Effect.failSync(() => mapFailure(cause))),
  );
}

/**
 * Temporary projection owned by Drizzle 0.45's Promise transaction callback.
 * Delete it when the point-commit mutation graph owns an Effect transaction
 * client and can yield these Result failures directly.
 */
export function projectPointCommitTransactionResult<A, E>(
  result: Result.Result<A, E>,
): A {
  // oxlint-disable-next-line flarex/no-result-get-or-throw-without-boundary -- REVIEW: compatibility - located native Drizzle transaction callbacks require rejection with the exact typed failure; CMS maps this same Promise kernel at its participant boundary
  return Result.getOrThrow(result);
}

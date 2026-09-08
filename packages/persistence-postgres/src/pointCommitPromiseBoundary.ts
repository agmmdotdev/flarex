import { Effect, Result } from "effect";

/** The single audited Effect runtime bridge for the Promise transaction. */
export function runPointCommitInTransactionEffect<Value, Failure>(
  effect: Effect.Effect<Value, Failure>,
) {
  return Effect.runPromise(Effect.result(effect));
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

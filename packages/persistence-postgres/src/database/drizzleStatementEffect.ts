import { Effect } from "effect";

/**
 * Persistence-owned boundary for lazily awaiting one Drizzle statement while
 * leaving domain failure identity and retry classification with the caller.
 */
export function runDrizzleStatementEffect<Value, Failure>(
  statement: PromiseLike<Value>,
  mapFailure: (cause: unknown) => Failure,
): Effect.Effect<Value, Failure> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: mapFailure,
  });
}

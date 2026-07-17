import { Effect } from "effect";

/** One explicit Promise bridge for Effect-based persistence tests. */
export function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

import { Effect } from "effect";

/** Explicit Promise boundary shared by executor tests for Effect-native ports. */
export function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

export function runEffectFailure<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

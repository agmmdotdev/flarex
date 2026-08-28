import { Effect } from "effect";

export function runEffect<A, E>(
  effect: Effect.Effect<A, E, never>,
): Promise<A> {
  return Effect.runPromise(effect);
}

export function runEffectFailure<E>(
  effect: Effect.Effect<unknown, E, never>,
): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

import { Effect } from "effect";

/** Explicit Promise bridge for test-owned integration composition. */
export function runSystemTestEffectV1<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<A> {
  return Effect.runPromise(effect);
}

/** Explicit Promise bridge for asserting a typed integration failure. */
export function runSystemTestEffectFailureV1<A, E>(
  effect: Effect.Effect<A, E>,
): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}

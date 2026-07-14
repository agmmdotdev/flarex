import { Effect } from "effect";

export function runEffectTest<A, E>(
  effect: Effect.Effect<A, E, never>,
): Promise<A> {
  return Effect.runPromise(effect);
}

export function runEffectTestSync<A, E>(
  effect: Effect.Effect<A, E, never>,
): A {
  return Effect.runSync(effect);
}

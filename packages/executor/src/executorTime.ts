import { Clock as EffectClock, Effect } from "effect";

import type { Clock } from "./types";

export function makeExecutorTimeEffect<E>(
  clock: Clock | undefined,
  onConfiguredClockFailure: (cause: unknown) => E,
): Effect.Effect<Date, E> {
  if (clock !== undefined) {
    return Effect.try({
      try: () => clock.now(),
      catch: onConfiguredClockFailure,
    });
  }

  return EffectClock.currentTimeMillis.pipe(
    Effect.map((currentTimeMillis) => new Date(currentTimeMillis)),
  );
}

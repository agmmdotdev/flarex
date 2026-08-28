import { Clock as EffectClock, Data, Effect } from "effect";

import type {
  Clock,
  FlarexExecutorDependencyHealth,
  FlarexExecutorControlPersistence,
  FlarexHealth,
} from "./types";

export const defaultClock: Clock = {
  now: () => new Date(),
};

class ExecutorHealthPersistenceCheckError extends Data.TaggedError(
  "ExecutorHealthPersistenceCheckError",
)<{
  readonly cause: unknown;
}> {}

export const getExecutorHealthEffect = Effect.fn("Executor.health")(
  function* (
    persistence: FlarexExecutorControlPersistence,
    readTimeEffect: Effect.Effect<string> = nativeHealthTimeEffect,
  ): Effect.fn.Return<FlarexHealth> {
    const persistenceHealth = yield* checkPersistenceEffect(persistence);
    const time = yield* readTimeEffect;

    return {
      service: "executor",
      status: persistenceHealth.status === "ok" ? "ok" : "degraded",
      persistence: persistenceHealth,
      time,
    };
  },
);

export function getExecutorHealth(
  persistence: FlarexExecutorControlPersistence,
  clock: Clock | undefined,
): Promise<FlarexHealth> {
  return Effect.runPromise(
    clock === undefined
      ? getExecutorHealthEffect(persistence)
      : getExecutorHealthEffect(
        persistence,
        Effect.sync(() => clock.now().toISOString()),
      ),
  );
}

const nativeHealthTimeEffect = EffectClock.currentTimeMillis.pipe(
  Effect.map((currentTimeMillis) =>
    new Date(currentTimeMillis).toISOString()
  ),
);

const checkPersistenceEffect = Effect.fn(
  "Executor.health.checkPersistence",
)((
  persistence: FlarexExecutorControlPersistence,
): Effect.Effect<FlarexExecutorDependencyHealth> =>
  Effect.tryPromise({
    try: () => persistence.check(),
    catch: (cause) => new ExecutorHealthPersistenceCheckError({ cause }),
  }).pipe(Effect.match({
    onFailure: ({ cause }) => ({
      status: "error" as const,
      message: cause instanceof Error
        ? cause.message
        : "Unknown persistence error",
    }),
    onSuccess: () => ({ status: "ok" as const }),
  })));

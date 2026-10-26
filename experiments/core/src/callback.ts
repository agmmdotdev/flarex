import { Cause, Effect, Exit, Fiber, type Scope } from "effect";

/** Known locally completing foreign callbacks: revoke use, signal, then drain.
 * This is not a sandbox or support for arbitrary nonterminating/remote work. */
export const runCallback = Effect.fn("ExperimentCallback.run")(<A, E>(work: (signal: AbortSignal) => Promise<A>, failure: (cause: unknown) => E) =>
  Effect.uninterruptibleMask(restore => {
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => work(controller.signal));
    const wait = Effect.tryPromise({ try: () => promise, catch: failure });
    return restore(wait).pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort()).pipe(Effect.andThen(wait))));
  }));

/** Bind request work to its host and retain child cleanup failures on cancel. */
export const supervise = Effect.fn("ExperimentCallback.supervise")(function* <A, E>(scope: Scope.Scope, work: Effect.Effect<A, E>) {
  const child = yield* Effect.forkIn(scope)(work);
  return yield* Fiber.join(child).pipe(Effect.onInterrupt(() => Effect.gen(function* () {
    yield* Fiber.interrupt(child);
    const exit = yield* Fiber.await(child);
    if (Exit.isFailure(exit)) {
      const remaining = exit.cause.reasons.filter(reason => !Cause.isInterruptReason(reason));
      if (remaining.length !== 0) return yield* Effect.failCause(Cause.fromReasons(remaining));
    }
  })));
});

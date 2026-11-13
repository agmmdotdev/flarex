import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";

describe("Effect cancellation Cause compatibility", () => {
  it.each(["catchCause", "mapError"] as const)("retains typed cleanup evidence while skipping %s", async operator => {
    const started = await Effect.runPromise(Deferred.make<void>());
    const rejection = { reason: "late native rejection" };
    let cleanup = 0;
    let recovered = false;
    const body = Effect.uninterruptibleMask(restore =>
      restore(Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))).pipe(
        Effect.onInterrupt(() => Effect.sync(() => { cleanup++; }).pipe(Effect.andThen(Effect.fail(rejection)))),
      ));
    const mapped = operator === "catchCause" ? body.pipe(Effect.catchCause(cause => {
      recovered = true;
      return Effect.failCause(cause);
    })) : body.pipe(Effect.mapError(error => {
      recovered = true;
      return error;
    }));
    const controller = new AbortController();
    const fiber = Effect.runFork(mapped, { signal: controller.signal });
    await Effect.runPromise(Deferred.await(started));
    controller.abort();
    const outcome = await Effect.runPromise(Fiber.await(fiber));
    expect(cleanup).toBe(1);
    expect(recovered).toBe(false);
    expect(Exit.isFailure(outcome)).toBe(true);
    if (Exit.isFailure(outcome)) {
      expect(Cause.hasInterrupts(outcome.cause)).toBe(true);
      const reasons = outcome.cause.reasons.filter(Cause.isFailReason);
      expect(reasons).toHaveLength(1);
      expect(reasons[0]?.error).toBe(rejection);
    }
  });
});

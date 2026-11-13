import { Cause, Context, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { CoreTransactionError } from "../../../src/core/api";
import { CmsTransactionError } from "../../../src/frameworks/cmsTransaction/model";
import { nativeResult } from "../../../src/frameworks/cmsTransaction/nativeFailure";

describe("native CMS completion projection", () => {
  it("projects a late Core cleanup failure while work remains interruptible", async () => {
    const entered = await Effect.runPromise(Deferred.make<void>());
    const original = new CoreTransactionError({ reason: "closed" });
    let cleaned = 0;
    const work = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Effect.sync(() => { cleaned++; }).pipe(Effect.andThen(Effect.fail(original)))));
    const controller = new AbortController();
    const fiber = Effect.runFork(nativeResult(work), { signal: controller.signal });
    await Effect.runPromise(Deferred.await(entered));
    controller.abort();
    const outcome = await Effect.runPromise(Fiber.await(fiber));
    expect(cleaned).toBe(1);
    expect(Exit.isFailure(outcome)).toBe(true);
    if (Exit.isFailure(outcome)) {
      expect(Cause.hasInterrupts(outcome.cause)).toBe(true);
      const failures = outcome.cause.reasons.filter(Cause.isFailReason);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.error).toBeInstanceOf(CmsTransactionError);
      expect(failures[0]?.error.reason).toBe("closed");
      expect(failures[0]?.error.cause).toBe(original);
    }
  });

  it("preserves the complete mixed Cause and annotations while projecting typed reasons", async () => {
    const original = new CoreTransactionError({ reason: "closed" });
    const defect = new Error("cleanup defect");
    const Marker = Context.Service<object>("test/CmsProjection");
    const marker = {};
    const complete = Cause.combine(Cause.annotate(Cause.fail(original), Context.make(Marker, marker)),
      Cause.combine(Cause.die(defect), Cause.interrupt(123)));
    const outcome = await Effect.runPromiseExit(nativeResult(Effect.failCause(complete)));
    expect(Exit.isFailure(outcome)).toBe(true);
    if (Exit.isFailure(outcome)) {
      expect(outcome.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Die", "Interrupt"]);
      const failure = outcome.cause.reasons.find(Cause.isFailReason);
      expect(failure?.error).toBeInstanceOf(CmsTransactionError);
      expect(failure?.error.cause).toBe(original);
      expect(failure?.annotations.get(Marker.key)).toBe(marker);
      expect(outcome.cause.reasons.find(Cause.isDieReason)?.defect).toBe(defect);
    }
  });
});

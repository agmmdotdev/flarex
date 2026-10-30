import { Cause, Context, Deferred, Effect, Exit, Fiber, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import { makeCoreApplicationAdmission, type CoreApplicationAdmissionConfiguration } from "../src/CoreApplicationAdmission";

class RetainedCauseAnnotation extends Context.Service<RetainedCauseAnnotation, string>()("application-test") {}

const configuration: CoreApplicationAdmissionConfiguration = {
  query: { maxActive: 1, maxQueued: 1, waitMilliseconds: 100 },
  mutation: { maxActive: 1, maxQueued: 0, waitMilliseconds: 100 },
  maxPendingCallbacks: 2, maxOpenQueries: 2,
};

describe("Core Application function admission", () => {
  it("bounds each function type separately and promotes queued roots in order", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const admission = yield* makeCoreApplicationAdmission(configuration);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const events: string[] = [];
    const first = yield* Effect.forkChild(admission.withPermit("query", Effect.gen(function* () {
      events.push("first");
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    })));
    yield* Deferred.await(entered);
    const queued = yield* Effect.forkChild(admission.withPermit("query", Effect.sync(() => { events.push("queued"); })));
    yield* Effect.yieldNow;
    const overflow = yield* Effect.result(admission.withPermit("query", Effect.die("Overflow body ran")));
    expect(Result.getFailure(overflow)).toEqual(Option.some(expect.objectContaining({ reason: "overloaded", kind: "query" })));
    yield* admission.withPermit("mutation", Effect.sync(() => { events.push("mutation"); }));
    expect(events).toEqual(["first", "mutation"]);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(queued);
    expect(events).toEqual(["first", "mutation", "queued"]);
  }))));

  it("expires only waiting roots and frees their exact queue slot", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const admission = yield* makeCoreApplicationAdmission(configuration);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(admission.withPermit("query", Effect.gen(function* () {
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    })));
    yield* Deferred.await(entered);
    const queued = yield* Effect.forkChild(Effect.result(admission.withPermit("query", Effect.die("Expired body ran"))));
    yield* TestClock.adjust("100 millis");
    expect(Result.getFailure(yield* Fiber.join(queued))).toEqual(Option.some(expect.objectContaining({ reason: "waitExpired" })));
    const replacement = yield* Effect.forkChild(admission.withPermit("query", Effect.succeed("replacement")));
    yield* Effect.yieldNow;
    yield* TestClock.adjust("50 millis");
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    expect(yield* Fiber.join(replacement)).toBe("replacement");
  })).pipe(Effect.provide(TestClock.layer()))));

  it("releases queued and active reservations on interruption and preserves full body Causes", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const admission = yield* makeCoreApplicationAdmission(configuration);
    const entered = yield* Deferred.make<void>();
    const active = yield* Effect.forkChild(admission.withPermit("query", Effect.gen(function* () {
      yield* Deferred.succeed(entered, undefined);
      yield* Effect.never;
    })));
    yield* Deferred.await(entered);
    const queued = yield* Effect.forkChild(admission.withPermit("query", Effect.die("Cancelled body ran")));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(queued);
    const replacement = yield* Effect.forkChild(admission.withPermit("query", Effect.succeed("replacement")));
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(active);
    expect(yield* Fiber.join(replacement)).toBe("replacement");
    const original = Cause.annotate(Cause.combine(Cause.fail("setup failed"),
      Cause.combine(Cause.die("body defect"), Cause.interrupt(913))), Context.make(RetainedCauseAnnotation, "retained"));
    const failed = yield* Effect.exit(admission.withPermit("mutation", Effect.failCause(original)));
    expect(Exit.isFailure(failed) && failed.cause.reasons.map(({ annotations, ...reason }) => reason))
      .toEqual(original.reasons.map(({ annotations, ...reason }) => reason));
    if (Exit.isFailure(failed)) for (const reason of failed.cause.reasons) {
      expect(reason.annotations.get("application-test")).toBe("retained");
      expect(reason.annotations.get("effect/Cause/StackTrace")).toMatchObject({ name: "CoreApplicationAdmission.withPermit" });
    }
    expect(yield* admission.withPermit("mutation", Effect.succeed("after failure"))).toBe("after failure");
  }))));

  it("closes queued admission and drains active ownership before completing close", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const admission = yield* makeCoreApplicationAdmission(configuration);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let closed = false;
    const active = yield* Effect.forkChild(admission.withPermit("query", Effect.gen(function* () {
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    })));
    yield* Deferred.await(entered);
    const queued = yield* Effect.forkChild(Effect.result(admission.withPermit("query", Effect.die("Closed body ran"))));
    yield* Effect.yieldNow;
    const closing = yield* Effect.forkChild(admission.close.pipe(Effect.tap(() => Effect.sync(() => { closed = true; }))));
    expect(Result.getFailure(yield* Fiber.join(queued))).toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
    expect(closed).toBe(false);
    expect(Result.getFailure(yield* Effect.result(admission.withPermit("mutation", Effect.void))))
      .toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(active);
    yield* Fiber.join(closing);
    expect(closed).toBe(true);
  }))));

  it("keeps nested body work inside the root permit at capacity", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const admission = yield* makeCoreApplicationAdmission({ ...configuration, query: { ...configuration.query, maxQueued: 0 } });
    const nested = Effect.succeed("nested result");
    expect(yield* admission.withPermit("query", Effect.gen(function* () {
      const deniedNewRoot = yield* Effect.result(admission.withPermit("query", Effect.void));
      expect(Result.getFailure(deniedNewRoot)).toEqual(Option.some(expect.objectContaining({ reason: "overloaded" })));
      return yield* nested;
    }))).toBe("nested result");
  }))));

  it("interrupts a queued root without advancing its long admission timeout", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const admission = yield* makeCoreApplicationAdmission({ ...configuration,
      query: { ...configuration.query, waitMilliseconds: 3_600_000 } });
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const cancelled = yield* Deferred.make<void>();
    const active = yield* Effect.forkChild(admission.withPermit("query", Effect.gen(function* () {
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
    })));
    yield* Deferred.await(entered);
    return yield* Effect.gen(function* () {
      const queued = yield* Effect.forkChild(admission.withPermit("query", Effect.die("Cancelled queue body ran")));
      yield* Effect.yieldNow;
      const cancelling = yield* Effect.forkChild(Fiber.interrupt(queued).pipe(Effect.andThen(Deferred.succeed(cancelled, undefined))));
      yield* Effect.yieldNow;
      expect(yield* Deferred.isDone(cancelled)).toBe(true);
      yield* Fiber.join(cancelling);
      const replacement = yield* Effect.forkChild(admission.withPermit("query", Effect.succeed("replacement")));
      yield* Effect.yieldNow;
      expect(replacement.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(replacement)).toBe("replacement");
    }).pipe(Effect.ensuring(Deferred.succeed(release, undefined).pipe(Effect.andThen(Fiber.join(active).pipe(Effect.orDie)))));
  })).pipe(Effect.provide(TestClock.layer()))));

  it("keeps a promoted permit until interrupted foreign work has actually drained", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const admission = yield* makeCoreApplicationAdmission({ ...configuration,
      query: { ...configuration.query, waitMilliseconds: 3_600_000 } });
    const firstEntered = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const promotedEntered = yield* Deferred.make<void>();
    const releasePromoted = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const first = yield* Effect.forkChild(admission.withPermit("query", Effect.gen(function* () {
      yield* Deferred.succeed(firstEntered, undefined);
      yield* Deferred.await(releaseFirst);
    })));
    yield* Deferred.await(firstEntered);
    const promoted = yield* Effect.forkChild(admission.withPermit("query", Effect.uninterruptible(Effect.gen(function* () {
      yield* Deferred.succeed(promotedEntered, undefined);
      yield* Deferred.await(releasePromoted);
    }))));
    yield* Effect.yieldNow;
    return yield* Effect.gen(function* () {
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Deferred.await(promotedEntered);
      const cancelling = yield* Effect.forkChild(Fiber.interrupt(promoted).pipe(Effect.andThen(Deferred.succeed(interrupted, undefined))));
      yield* Effect.yieldNow;
      expect(yield* Deferred.isDone(interrupted)).toBe(false);
      const next = yield* Effect.forkChild(admission.withPermit("query", Effect.succeed("after drain")));
      yield* Effect.yieldNow;
      expect(next.pollUnsafe()).toBeUndefined();
      expect(Result.getFailure(yield* Effect.result(admission.withPermit("query", Effect.void))))
        .toEqual(Option.some(expect.objectContaining({ reason: "overloaded" })));
      yield* Deferred.succeed(releasePromoted, undefined);
      yield* Fiber.join(cancelling);
      expect(yield* Fiber.join(next)).toBe("after drain");
    }).pipe(Effect.ensuring(Deferred.succeed(releaseFirst, undefined).pipe(
      Effect.andThen(Deferred.succeed(releasePromoted, undefined)), Effect.andThen(Fiber.join(first).pipe(Effect.orDie)))));
  })).pipe(Effect.provide(TestClock.layer()))));

  it("refuses invalid private configuration before acquiring resources", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const result = yield* Effect.result(makeCoreApplicationAdmission({ ...configuration,
      query: { ...configuration.query, maxActive: 0 } }));
    expect(Result.getFailure(result)).toEqual(Option.some(expect.objectContaining({ reason: "invalidConfiguration" })));
  }))));
});

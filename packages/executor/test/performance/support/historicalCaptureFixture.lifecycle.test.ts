import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { runHistoricalCaptureInvocation } from "./historicalCaptureFixture";

const makeLifetime = () => makeBoundedRequestLifetime(commerceError,
  { calls: 32, commandBytes: 1024, commandMs: 10 }, {}, {}, "historical-capture", "write");

describe("historical capture borrowed invocation lifecycle", () => {
  it("retains the real seal refusal for the predecessor's nested-close topology", () => Effect.runPromise(Effect.gen(function* () {
    const lifetime = yield* makeLifetime();
    const exit = yield* Effect.exit(lifetime.withinDeadline(lifetime.seal));
    if (Exit.isSuccess(exit)) throw new Error("Expected real active-call seal refusal");
    const reasons = exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason);
    expect(reasons).toEqual(["rollbackOnly", "overlappingOperation"]);
    expect(lifetime.isClosing()).toBe(false);
    yield* lifetime.close;
  }).pipe(Effect.provide(TestClock.layer()))));

  it("finishes both nine-read passes and native validation before checking and sealing once", () => Effect.runPromise(Effect.gen(function* () {
    const lifetime = yield* makeLifetime();
    const id = yield* lifetime.begin(lifetime.context);
    const initialCalls = lifetime.usedCalls();
    const events: string[] = [];
    let seals = 0;
    const borrowed = {
      withinDeadline: lifetime.withinDeadline,
      checkAfterNative: lifetime.withinDeadline(lifetime.checkpoint(lifetime.context)).pipe(
        Effect.tap(() => Effect.sync(() => { events.push("check"); }))),
      close: lifetime.seal.pipe(Effect.tap(() => Effect.sync(() => {
        seals++;
        expect(lifetime.isClosing()).toBe(true);
        events.push("close");
      })), Effect.as("sealed"), Effect.ensuring(lifetime.close)),
    };
    const readPasses = Effect.gen(function* () {
      for (let pass = 1; pass <= 2; pass++) {
        for (let ordinal = 1; ordinal <= 9; ordinal++) {
          yield* lifetime.operation(lifetime.context, id, "read", Effect.sync(() => { events.push(`${pass}:${ordinal}`); }));
        }
      }
      yield* lifetime.checkpoint(lifetime.context);
      events.push("native validation");
      return { captures: 18 };
    });
    const completed = yield* runHistoricalCaptureInvocation(borrowed, readPasses).pipe(Effect.ensuring(lifetime.close));
    expect(completed).toEqual({ result: { captures: 18 }, closed: "sealed" });
    expect(events).toEqual([
      "1:1", "1:2", "1:3", "1:4", "1:5", "1:6", "1:7", "1:8", "1:9",
      "2:1", "2:2", "2:3", "2:4", "2:5", "2:6", "2:7", "2:8", "2:9",
      "native validation", "check", "close",
    ]);
    expect(seals).toBe(1);
    expect(lifetime.usedCalls() - initialCalls).toBe(18);
    expect((yield* Effect.flip(lifetime.begin(lifetime.context))).reason).toBe("invalidAuthority");
  }).pipe(Effect.provide(TestClock.layer()))));

  it("preserves complete core and abort Causes and skips checking and sealing after failure", () => Effect.runPromise(Effect.gen(function* () {
    const lifetime = yield* makeLifetime();
    const expected = commerceError("statementFailure");
    const defect = new Error("capture defect");
    const abortDefect = new Error("abort defect");
    const original = Cause.combine(Cause.combine(Cause.fail(expected), Cause.die(defect)), Cause.interrupt(123));
    const events: string[] = [];
    const borrowed = {
      withinDeadline: lifetime.withinDeadline,
      checkAfterNative: Effect.sync(() => { events.push("check"); }).pipe(Effect.andThen(lifetime.checkpoint(lifetime.context))),
      close: Effect.sync(() => { events.push("close"); }).pipe(Effect.andThen(lifetime.seal)),
    };
    const exit = yield* Effect.exit(runHistoricalCaptureInvocation(borrowed, Effect.failCause(original)).pipe(
      Effect.ensuring(lifetime.close.pipe(Effect.andThen(Effect.die(abortDefect))))));
    if (Exit.isSuccess(exit)) throw new Error("Expected original capture and abort Causes");
    expect(events).toEqual([]);
    expect(exit.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Die", "Interrupt", "Die"]);
    expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === expected)).toBe(true);
    const defects = exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect);
    expect(defects[0]).toBe(defect);
    expect(defects[1]).toBe(abortDefect);
    expect((yield* Effect.flip(lifetime.begin(lifetime.context))).reason).toBe("invalidAuthority");
  }).pipe(Effect.provide(TestClock.layer()))));

  it("interrupts and drains deadline-expired read work before the outer abort closes the lifetime", () => Effect.runPromise(Effect.gen(function* () {
    const lifetime = yield* makeLifetime();
    const started = yield* Deferred.make<void>();
    const events: string[] = [];
    const borrowed = {
      withinDeadline: lifetime.withinDeadline,
      checkAfterNative: Effect.sync(() => { events.push("check"); }).pipe(Effect.andThen(lifetime.checkpoint(lifetime.context))),
      close: Effect.sync(() => { events.push("close"); }).pipe(Effect.andThen(lifetime.seal)),
    };
    const readPasses = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never),
      Effect.ensuring(Effect.sync(() => { events.push("read cleanup"); })));
    const fiber = yield* Effect.forkChild(runHistoricalCaptureInvocation(borrowed, readPasses).pipe(
      Effect.ensuring(lifetime.close.pipe(Effect.andThen(Effect.sync(() => { events.push("abort"); }))))));
    yield* Deferred.await(started);
    yield* TestClock.adjust("10 millis");
    const exit = yield* Fiber.await(fiber);
    if (Exit.isSuccess(exit)) throw new Error("Expected bounded deadline failure");
    expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "deadlineExceeded")).toBe(true);
    expect(events).toEqual(["read cleanup", "abort"]);
    expect((yield* Effect.flip(lifetime.begin(lifetime.context))).reason).toBe("invalidAuthority");
  }).pipe(Effect.provide(TestClock.layer()))));
});

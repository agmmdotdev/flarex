import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";
import { makeBoundedRequestLifetime } from "../src/boundedRequestLifetime";
import { commerceError } from "../src/commerceTransaction/model";
import { runEffect } from "./effectTestRuntime";

const make = () => makeBoundedRequestLifetime(commerceError,
  { calls: 16, commandBytes: 100, commandMs: 10000 }, {}, {}, "request", "write");

it("requires an owned ID for borrowed reads while retaining the default standalone read policy", () => runEffect(Effect.gen(function* () {
  const borrowed = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10000 }, {}, {}, "request", "write", "require");
  let entered = false;
  const refused = yield* Effect.exit(borrowed.operation(borrowed.context, undefined, "read",
    Effect.sync(() => { entered = true; })));
  expect(Exit.isFailure(refused)).toBe(true);
  expect(entered).toBe(false);
  expect(Exit.isFailure(yield* Effect.exit(borrowed.seal))).toBe(true);
  yield* borrowed.close;

  const standalone = yield* make();
  expect(yield* standalone.operation(standalone.context, undefined, "read", Effect.succeed("snapshot")))
    .toBe("snapshot");
  yield* standalone.seal;
  yield* standalone.close;
})));

it("retains the first statement cause through repeated rollback-only refusals", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const statement = commerceError("statementFailure", { code: "57014" });
  const first = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.fail(statement)));
  if (!Exit.isFailure(first)) throw new Error("Expected statement failure");
  let ran = false;
  for (let index = 0; index < 2; index++) {
    const refusal = yield* Effect.flip(lifetime.operation(lifetime.context, "request", "read",
      Effect.sync(() => { ran = true; })));
    expect(refusal.reason).toBe("rollbackOnly");
    expect(refusal.cause).toEqual(first.cause);
    if (!Cause.isCause(refusal.cause)) throw new Error("Expected retained cause");
    const reason = refusal.cause.reasons[0];
    if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected statement reason");
    expect(reason.error).toBe(statement);
  }
  expect(ran).toBe(false);
  expect(lifetime.isClosing()).toBe(false);
  const sealed = yield* Effect.exit(lifetime.seal);
  if (!Exit.isFailure(sealed)) throw new Error("Expected rollback-only seal");
  expect(sealed.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === statement)).toBe(true);
  yield* lifetime.close;
})));

it("retains complete defect causes without reclassifying them as typed failures", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const defect = new Error("driver defect");
  const first = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.die(defect)));
  if (!Exit.isFailure(first)) throw new Error("Expected defect");
  const refusal = yield* Effect.flip(lifetime.begin(lifetime.context));
  expect(refusal.reason).toBe("rollbackOnly");
  expect(refusal.cause).toEqual(first.cause);
  expect(first.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
  yield* lifetime.close;
})));

it("does not disclose latched causes to foreign, revoked or closed contexts", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const foreign = yield* make();
  const child = yield* lifetime.nested(lifetime.context, "request", Effect.succeed);
  yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.fail(commerceError("statementFailure"))));
  for (const context of [foreign.context, child]) {
    const refusal = yield* Effect.flip(lifetime.begin(context));
    expect(refusal.reason).toBe("invalidAuthority");
    expect(refusal.cause).toBeUndefined();
  }
  yield* lifetime.close;
  const closed = yield* Effect.flip(lifetime.begin(lifetime.context));
  expect(closed.reason).toBe("invalidAuthority");
  expect(closed.cause).toBeUndefined();
  yield* foreign.close;
})));

it("refuses already elapsed native work and retains the deadline at seal", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  yield* TestClock.adjust("10 millis");
  let entered = false;
  const outcome = yield* Effect.exit(lifetime.withinDeadline(Effect.sync(() => { entered = true; })));
  expect(entered).toBe(false);
  expect(Exit.isFailure(outcome)).toBe(true);
  if (Exit.isFailure(outcome)) expect(outcome.cause.reasons.some(reason =>
    Cause.isFailReason(reason) && reason.error.reason === "deadlineExceeded")).toBe(true);
  const sealed = yield* Effect.exit(lifetime.seal);
  expect(Exit.isFailure(sealed)).toBe(true);
  if (Exit.isFailure(sealed)) expect(sealed.cause.reasons.some(reason =>
    Cause.isFailReason(reason) && reason.error.reason === "deadlineExceeded")).toBe(true);
  yield* lifetime.close;
}).pipe(Effect.provide(TestClock.layer()))));

it("allows native completion before the deadline without latching the timer branch", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  expect(yield* lifetime.withinDeadline(Effect.succeed("completed"))).toBe("completed");
  yield* lifetime.seal;
  yield* lifetime.close;
}).pipe(Effect.provide(TestClock.layer()))));

it("interrupts unresolved native work at the original request deadline", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  yield* lifetime.withinDeadline(Effect.void);
  yield* TestClock.adjust("9 millis");
  const started = yield* Deferred.make<void>();
  let interrupted = false;
  const native = Effect.gen(function* () {
    yield* Deferred.succeed(started, undefined);
    return yield* Effect.never;
  }).pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; })));
  const fiber = yield* Effect.forkChild(lifetime.withinDeadline(native));
  yield* Deferred.await(started);
  yield* TestClock.adjust("1 millis");
  const outcome = yield* Fiber.await(fiber);
  expect(interrupted).toBe(true);
  expect(Exit.isFailure(outcome)).toBe(true);
  if (Exit.isFailure(outcome)) expect(outcome.cause.reasons.some(reason =>
    Cause.isFailReason(reason) && reason.error.reason === "deadlineExceeded")).toBe(true);
  const refusal = yield* Effect.flip(lifetime.begin(lifetime.context));
  expect(refusal.reason).toBe("rollbackOnly");
  yield* lifetime.close;
}).pipe(Effect.provide(TestClock.layer()))));

it("latches the deadline before interrupting a nested observed operation", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  const started = yield* Deferred.make<void>();
  const native = lifetime.operation(lifetime.context, "request", "write", Effect.gen(function* () {
    yield* Deferred.succeed(started, undefined);
    return yield* Effect.never;
  }));
  const fiber = yield* Effect.forkChild(lifetime.withinDeadline(native));
  yield* Deferred.await(started);
  yield* TestClock.adjust("10 millis");
  const outcome = yield* Fiber.await(fiber);
  expect(Exit.isFailure(outcome)).toBe(true);
  if (Exit.isFailure(outcome)) expect(outcome.cause.reasons.some(reason =>
    Cause.isFailReason(reason) && reason.error.reason === "deadlineExceeded")).toBe(true);
  const refusal = yield* Effect.flip(lifetime.begin(lifetime.context));
  expect(refusal.reason).toBe("rollbackOnly");
  if (!Cause.isCause(refusal.cause)) throw new Error("Expected retained deadline cause");
  expect(refusal.cause.reasons.some(reason =>
    Cause.isFailReason(reason) && typeof reason.error === "object" && reason.error !== null &&
    "reason" in reason.error && reason.error.reason === "deadlineExceeded")).toBe(true);
  yield* lifetime.close;
}).pipe(Effect.provide(TestClock.layer()))));

it("retains external interruption without replacing it with a deadline", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  const started = yield* Deferred.make<void>();
  const native = lifetime.operation(lifetime.context, "request", "write", Effect.gen(function* () {
    yield* Deferred.succeed(started, undefined);
    return yield* Effect.never;
  }));
  const fiber = yield* Effect.forkChild(lifetime.withinDeadline(native));
  yield* Deferred.await(started);
  yield* Fiber.interrupt(fiber);
  const interrupted = yield* Fiber.await(fiber);
  expect(Exit.isFailure(interrupted)).toBe(true);
  const sealed = yield* Effect.exit(lifetime.seal);
  expect(Exit.isFailure(sealed)).toBe(true);
  if (Exit.isFailure(sealed)) {
    expect(sealed.cause.reasons.some(reason => Cause.isInterruptReason(reason))).toBe(true);
    expect(sealed.cause.reasons.some(reason => Cause.isFailReason(reason) &&
      reason.error.reason === "deadlineExceeded")).toBe(false);
  }
  yield* lifetime.close;
}).pipe(Effect.provide(TestClock.layer()))));

it("preserves a native defect as the first lifetime cause", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  const defect = new Error("native defect");
  const outcome = yield* Effect.exit(lifetime.withinDeadline(Effect.die(defect)));
  expect(Exit.isFailure(outcome)).toBe(true);
  yield* TestClock.adjust("10 millis");
  const sealed = yield* Effect.exit(lifetime.seal);
  expect(Exit.isFailure(sealed)).toBe(true);
  if (Exit.isFailure(sealed)) expect(sealed.cause.reasons.some(reason =>
    Cause.isDieReason(reason) && reason.defect === defect), Cause.pretty(sealed.cause)).toBe(true);
  yield* lifetime.close;
}).pipe(Effect.provide(TestClock.layer()))));

it("preserves a native typed failure before later deadline expiry", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  const nativeFailure = commerceError("statementFailure", { code: "native" });
  const outcome = yield* Effect.exit(lifetime.withinDeadline(Effect.fail(nativeFailure)));
  expect(Exit.isFailure(outcome)).toBe(true);
  yield* TestClock.adjust("10 millis");
  const sealed = yield* Effect.exit(lifetime.seal);
  expect(Exit.isFailure(sealed)).toBe(true);
  if (Exit.isFailure(sealed)) expect(sealed.cause.reasons.some(reason =>
    Cause.isFailReason(reason) && reason.error === nativeFailure), Cause.pretty(sealed.cause)).toBe(true);
  yield* lifetime.close;
}).pipe(Effect.provide(TestClock.layer()))));

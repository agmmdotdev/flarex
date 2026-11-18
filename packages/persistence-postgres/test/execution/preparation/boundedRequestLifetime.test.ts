import { Cause, Clock, Context, Deferred, Effect, Equal, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";
import { ExecutionDiagnostics } from "../../../src/execution/diagnostics/operation";
import { makeBoundedRequestLifetime, projectBoundedRequestLifetime, reclassifyBoundedRequestReason, type PresentedTransactionId } from "../../../src/execution/preparation/boundedRequestLifetime";
import { commerceError, type CommerceTransactionError } from "../../../src/frameworks/commerceTransaction/model";
import { runEffect } from "../../support/effectTestRuntime";

const make = () => makeBoundedRequestLifetime(commerceError,
  { calls: 16, commandBytes: 100, commandMs: 10000 }, {}, {}, "request", "write");

it.each(["direct", "projected"] as const)("retains three independently owned equal failures through %s propagation and seal", mode => runEffect(Effect.scoped(Effect.gen(function* () {
  const root = yield* Effect.acquireRelease(make(), lifetime => lifetime.close);
  const foreign = yield* Effect.acquireRelease(make(), lifetime => lifetime.close);
  const lifetime = mode === "direct" ? root : projectBoundedRequestLifetime(root, error => error);
  const revoked = yield* lifetime.nested(lifetime.context, "request", Effect.succeed);
  const reused = commerceError("invalidInput"), sameCode = commerceError("invalidInput");
  const Annotation = Context.Service<string>("test/owned-occurrence-note");
  const calls = lifetime.usedCalls(), bytes = lifetime.remainingBytes();
  // Each occurrence receives its real private origin before any Cause union.
  const first = Result.getOrThrow(lifetime.recordFailure(lifetime.context, Cause.fail(reused)));
  const second = Result.getOrThrow(lifetime.recordFailure(lifetime.context, Cause.fail(reused)));
  const third = Result.getOrThrow(lifetime.recordFailure(lifetime.context, Cause.fail(sameCode)));
  const tokens = [first, second, third].map(cause => cause.reasons[0]?.annotations.get("Flarex/BoundedRequestFailureOrigin"));
  expect(tokens.every(token => typeof token === "object" && token !== null && Object.isFrozen(token))).toBe(true);
  for (const token of tokens) {
    expect(Equal.equals(token, token)).toBe(true);
    expect(Object.keys(token ?? {})).toEqual([]);
    for (const other of tokens) if (other !== token) expect(Equal.equals(token, other)).toBe(false);
  }
  expect(new Set(tokens).size).toBe(3);
  const complete = Cause.combine(Cause.combine(first, second), third);
  expect(complete.reasons).toHaveLength(3);
  const annotated = Cause.annotate(complete, Context.make(Annotation, "retained"));
  const owned = Result.getOrThrow(lifetime.recordFailure(lifetime.context, annotated));
  const named = Effect.fn("Lifetime.rethrowIndependentOwnedOccurrences")(function* () { return yield* Effect.failCause(owned); });
  const rethrown = yield* Effect.exit(named());
  if (Exit.isSuccess(rethrown)) throw new Error("Expected the complete owned occurrence chain");
  const repeated = Result.getOrThrow(lifetime.recordFailure(lifetime.context, Cause.combine(owned, rethrown.cause)));
  expect(repeated.reasons).toHaveLength(3);
  expect(repeated.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([reused, reused, sameCode]);
  expect(repeated.reasons.map(reason => reason.annotations.get("Flarex/BoundedRequestFailureOrigin"))).toEqual(tokens);
  expect(repeated.reasons.every(reason => reason.annotations.get(Annotation.key) === "retained")).toBe(true);
  expect(Result.isFailure(lifetime.recordFailure(foreign.context, complete))).toBe(true);
  expect(Result.isFailure(lifetime.recordFailure(revoked, complete))).toBe(true);
  expect(lifetime.usedCalls()).toBe(calls);
  expect(lifetime.remainingBytes()).toBe(bytes);
  yield* foreign.seal;
  expect(foreign.isClosing()).toBe(true);
  const sealed = yield* Effect.exit(root.seal);
  if (Exit.isSuccess(sealed)) throw new Error("Expected the three owned failures and the seal marker");
  expect(sealed.cause.reasons).toHaveLength(4);
  expect(sealed.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason)).toEqual([
    "rollbackOnly", "invalidInput", "invalidInput", "invalidInput",
  ]);
  const originals = sealed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidInput");
  expect(originals.map(reason => reason.annotations.get("Flarex/BoundedRequestFailureOrigin"))).toEqual(tokens);
  expect(originals.every(reason => reason.annotations.get(Annotation.key) === "retained")).toBe(true);
}))));

it("retires only changed classification origins across installed Error annotation cloning", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const original = commerceError("statementFailure"), native = commerceError("invalidInput");
  const Marker = Context.Service<object>("test/native-error-classification");
  const marker = Object.freeze({ native: true });
  const captured = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "read",
    Effect.fail(original).pipe(Effect.annotateLogs("classification", "native"))));
  if (Exit.isSuccess(captured)) throw new Error("Expected the original owned failure");
  const origin = captured.cause.reasons.find(Cause.isFailReason);
  if (origin === undefined) throw new Error("Expected an owned failure reason");
  const originalToken = origin.annotations.get("Flarex/BoundedRequestFailureOrigin");
  expect(originalToken).toBeTypeOf("object");
  const same = Cause.map(Cause.fromReasons([origin]), value => value).reasons[0];
  if (same === undefined) throw new Error("Expected an unchanged mapped reason");
  expect(reclassifyBoundedRequestReason(origin, same)).toBe(same);
  expect(same.annotations.get("Flarex/BoundedRequestFailureOrigin")).toBe(originalToken);
  const changed = Cause.map(Cause.fromReasons([origin]), () => native).reasons[0];
  if (changed === undefined) throw new Error("Expected a native classification");
  const retired = reclassifyBoundedRequestReason(origin, changed.annotate(Context.make(Marker, marker)));
  const retiredAgain = reclassifyBoundedRequestReason(origin, changed);
  const retiredToken = retired.annotations.get("Flarex/BoundedRequestFailureOrigin");
  const retiredAgainToken = retiredAgain.annotations.get("Flarex/BoundedRequestFailureOrigin");
  expect(Object.isFrozen(originalToken)).toBe(true);
  expect(Object.isFrozen(retiredToken)).toBe(true);
  expect(Object.isFrozen(retiredAgainToken)).toBe(true);
  expect(Equal.equals(originalToken, originalToken)).toBe(true);
  expect(Equal.equals(retiredToken, retiredToken)).toBe(true);
  expect(Equal.equals(originalToken, retiredToken)).toBe(false);
  expect(Equal.equals(retiredToken, retiredAgainToken)).toBe(false);
  const observedRetired = Result.getOrThrow(lifetime.recordFailure(lifetime.context, Cause.fromReasons([retired])));
  expect(observedRetired.reasons[0]?.annotations.get("Flarex/BoundedRequestFailureOrigin")).not.toBe(retiredToken);
  const cloned = Cause.map(Cause.fromReasons([retired]), value => value).reasons[0];
  if (cloned === undefined || !Cause.isFailReason(cloned)) throw new Error("Expected the retained native failure");
  expect(cloned.error).toBe(native);
  expect(cloned.annotations.get(Marker.key)).toBe(marker);
  expect(cloned.annotations.get("Flarex/BoundedRequestFailureOrigin")).not.toBe(originalToken);
  const sealed = yield* Effect.exit(lifetime.seal);
  if (Exit.isSuccess(sealed)) throw new Error("Reclassification must not clear the original failure latch");
  expect(sealed.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
  yield* lifetime.close;
})));

it("owns a reused foreign failure once before the deadline race clones its Cause", () => runEffect(Effect.gen(function* () {
  const original = commerceError("invalidInput");
  const prior = yield* make();
  const captured = yield* Effect.exit(prior.operation(prior.context, "request", "read", Effect.fail(original)));
  if (Exit.isSuccess(captured)) throw new Error("Expected the first request's failure");
  yield* prior.close;
  const lifetime = yield* make();
  const outcome = yield* Effect.exit(lifetime.withinDeadline(Effect.failCause(Cause.map(captured.cause, value => value))));
  if (Exit.isSuccess(outcome)) throw new Error("Expected the reused foreign failure");
  expect(outcome.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
  yield* lifetime.close;
})));

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

it("retains the complete first cause when byte capture resumes after the lifetime becomes rollback-only", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const statement = commerceError("unsupportedProfile"), defect = new Error("native defect");
  const first = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write",
    Effect.failCause(Cause.combine(Cause.fail(statement), Cause.die(defect)))));
  if (Exit.isSuccess(first)) throw new Error("Expected the initiating failure");
  const captured = lifetime.charge(1);
  if (Result.isSuccess(captured)) throw new Error("A poisoned lifetime cannot charge another value");
  expect(captured.failure.reason).toBe("rollbackOnly");
  expect(captured.failure.cause).toEqual(first.cause);
  expect(lifetime.remainingBytes()).toBe(100);
  yield* lifetime.close;
  const closed = lifetime.charge(1);
  if (Result.isSuccess(closed)) throw new Error("A closed lifetime cannot charge another value");
  expect(closed.failure.reason).toBe("closed");
  expect(closed.failure.cause).toBeUndefined();
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

it("drains the deadline loser and retains each completed typed failure and defect once", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  const started = yield* Deferred.make<void>();
  const release = yield* Deferred.make<void>();
  const statement = commerceError("statementFailure"), defect = new Error("late native cleanup");
  const native = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never),
    Effect.onInterrupt(() => Deferred.await(release).pipe(Effect.andThen(
      Effect.failCause(Cause.combine(Cause.fail(statement), Cause.die(defect)))))));
  const fiber = yield* Effect.forkChild(lifetime.withinDeadline(native));
  yield* Deferred.await(started);
  yield* TestClock.adjust("10 millis");
  expect(fiber.pollUnsafe()).toBeUndefined();
  yield* Deferred.succeed(release, undefined);
  const outcome = yield* Fiber.await(fiber);
  if (Exit.isSuccess(outcome)) throw new Error("Expected deadline with native completion failures");
  expect(Cause.hasInterrupts(outcome.cause)).toBe(false);
  expect(outcome.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error.reason === "deadlineExceeded")).toHaveLength(1);
  expect(outcome.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === statement)).toHaveLength(1);
  expect(outcome.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === defect)).toHaveLength(1);
  const sealed = yield* Effect.exit(lifetime.seal);
  if (Exit.isSuccess(sealed)) throw new Error("Expected rollback-only completion");
  expect(sealed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === statement)).toHaveLength(1);
  expect(sealed.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === defect)).toHaveLength(1);
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

it("records a live parent's full Cause during its borrowed child without a call or SQL grant", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const original = commerceError("invalidInput"), cleanup = new TypeError("native cleanup");
  const first = Cause.combine(Cause.fail(original), Cause.die(cleanup));
  let childToken = lifetime.context;
  yield* lifetime.nested(lifetime.context, "request", child => Effect.sync(() => {
    childToken = child;
    const calls = lifetime.usedCalls(), bytes = lifetime.remainingBytes();
    expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, first))).toBe(true);
    expect(Result.isSuccess(lifetime.recordFailure(child, Cause.die("later")))).toBe(true);
    expect(lifetime.usedCalls()).toBe(calls);
    expect(lifetime.remainingBytes()).toBe(bytes);
  }));
  expect(Result.isFailure(lifetime.recordFailure(childToken, Cause.die("revoked child")))).toBe(true);
  const sealed = yield* Effect.exit(lifetime.seal);
  if (Exit.isSuccess(sealed)) throw new Error("Expected rollback-only");
  expect(sealed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
  expect(sealed.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === cleanup)).toHaveLength(1);
  expect(sealed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === "later")).toBe(false);
  yield* lifetime.close;
})));

it("rejects observation after the successful seal fence without changing settlement eligibility", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  yield* lifetime.seal;
  expect(lifetime.isClosing()).toBe(true);
  const calls = lifetime.usedCalls(), bytes = lifetime.remainingBytes();
  const finalizer = new TypeError("closing finalizer");
  expect(Result.isFailure(lifetime.recordFailure(lifetime.context, Cause.die(finalizer)))).toBe(true);
  expect(lifetime.isClosing()).toBe(true);
  expect(lifetime.usedCalls()).toBe(calls);
  expect(lifetime.remainingBytes()).toBe(bytes);
  let ran = false;
  const operation = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "read", Effect.sync(() => { ran = true; })));
  expect(Exit.isFailure(operation)).toBe(true);
  expect(ran).toBe(false);
  yield* lifetime.close;
  expect(Result.isFailure(lifetime.recordFailure(lifetime.context, Cause.die("after close")))).toBe(true);
})));

it("does not mutate either request through a foreign failure-observation context", () => runEffect(Effect.gen(function* () {
  const left = yield* make(), right = yield* make();
  expect(Result.isFailure(left.recordFailure(right.context, Cause.die("foreign")))).toBe(true);
  expect(Result.isFailure(right.recordFailure(left.context, Cause.die("foreign")))).toBe(true);
  yield* left.seal;
  yield* right.seal;
  expect(left.isClosing()).toBe(true);
  expect(right.isClosing()).toBe(true);
  yield* left.close;
  yield* right.close;
})));


it.each(["direct", "projected"] as const)("enriches the first failure only with its completed original chain: %s", mode => runEffect(Effect.gen(function* () {
  const root = yield* make();
  const lifetime = mode === "direct" ? root : projectBoundedRequestLifetime(root, error => error);
  const original = commerceError("invalidInput"), cleanup = new TypeError("outer finalizer");
  const exit = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.fail(original))
    .pipe(Effect.ensuring(Effect.die(cleanup))));
  if (Exit.isSuccess(exit)) throw new Error("Expected compound completion");
  const observedFailure = exit.cause.reasons.find(Cause.isFailReason);
  if (observedFailure === undefined) throw new Error("Expected original typed failure");
  expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, Cause.combine(
    Cause.fail(observedFailure.error), Cause.die("unissued copied failure chain"))))).toBe(true);
  expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, exit.cause))).toBe(true);
  expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, Cause.die("unrelated later failure")))).toBe(true);
  const sealed = yield* Effect.exit(root.seal);
  if (Exit.isSuccess(sealed)) throw new Error("Expected sticky original failure");
  expect(sealed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
  expect(sealed.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === cleanup)).toHaveLength(1);
  expect(sealed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === "unrelated later failure")).toBe(false);
  expect(sealed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === "unissued copied failure chain")).toBe(false);
  yield* root.close;
})));


it("retains projection-issued Reason identity across repeated rethrows and root seals", () => runEffect(Effect.gen(function* () {
  const root = yield* make();
  const lifetime = projectBoundedRequestLifetime(root, error => commerceError(error.reason, error));
  const original = commerceError("invalidInput");
  const first = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.fail(original)));
  if (Exit.isSuccess(first)) throw new Error("Expected source failure");
  const failure = first.cause.reasons.find(Cause.isFailReason);
  if (failure === undefined) throw new Error("Expected projected failure");
  expect(failure.error).not.toBe(original);
  expect(failure.error.cause).toBe(original);
  for (let index = 0; index < 2; index++) {
    const sealed = yield* Effect.exit(lifetime.seal);
    if (Exit.isSuccess(sealed)) throw new Error("Expected retained root failure");
    expect(sealed.cause.reasons.find(reason => Cause.isFailReason(reason) && reason.error.cause === original)).toBe(failure);
  }
  yield* root.close;
})));


it("authenticates Effect.fn Reason clones and retains later annotations without matching error values", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  const original = commerceError("invalidInput"), cleanup = new TypeError("named finalizer");
  const Annotation = Context.Service<string>("test/retained-failure-note");
  const named = Effect.fn("Lifetime.namedFailureClone")(function* () {
    const completed = yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.fail(original))
      .pipe(Effect.ensuring(Effect.die(cleanup))));
    if (Exit.isSuccess(completed)) throw new Error("Expected named completion");
    const recorded = Result.getOrThrow(lifetime.recordFailure(lifetime.context, completed.cause));
    const cloned = yield* Effect.exit(Effect.suspend(() => Effect.failCause(recorded)));
    if (Exit.isSuccess(cloned)) throw new Error("Expected cloned propagation");
    expect(cloned.cause.reasons[0]).not.toBe(recorded.reasons[0]);
    const annotated = Cause.fromReasons(cloned.cause.reasons.map(reason => reason.annotate(Context.make(Annotation, "retained"))));
    const observed = Result.getOrThrow(lifetime.recordFailure(lifetime.context, annotated));
    expect(observed.reasons.every(reason => reason.annotations.get(Annotation.key) === "retained")).toBe(true);
  });
  yield* named();
  const sealed = yield* Effect.exit(lifetime.seal);
  if (Exit.isSuccess(sealed)) throw new Error("Expected sticky named failure");
  expect(sealed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
  expect(sealed.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === cleanup)).toHaveLength(1);
  expect(sealed.cause.reasons.filter(reason => (Cause.isFailReason(reason) && reason.error === original) || Cause.isDieReason(reason))
    .every(reason => reason.annotations.get(Annotation.key) === "retained")).toBe(true);
  yield* lifetime.close;
})));

it.each(["direct", "projected"] as const)("retains a finalizer after the external charge Result conversion is caught: %s", mode => runEffect(Effect.gen(function* () {
  const root = yield* make();
  const lifetime = mode === "direct" ? root : projectBoundedRequestLifetime(root, error => commerceError(error.reason, error));
  const cleanup = new TypeError("charge conversion finalizer");
  const charged = lifetime.charge(101);
  if (Result.isSuccess(charged)) throw new Error("Expected real byte-limit overflow");
  const prepared = Result.gen(function* () {
    yield* charged.pipe(Result.map(() => "unreachable"));
    return "unreachable";
  });
  expect(prepared).toBe(charged);
  const reboxed = charged.pipe(Result.flatMap(() => Result.succeed("unreachable")));
  expect(reboxed).not.toBe(charged);
  if (Result.isSuccess(reboxed)) throw new Error("Expected reboxed charge failure");
  expect(reboxed.failure).toBe(charged.failure);
  const reboxedCompletion = yield* Effect.exit(lifetime.fromResult(reboxed)
    .pipe(Effect.ensuring(Effect.die("reboxed charge finalizer"))));
  if (Exit.isSuccess(reboxedCompletion)) throw new Error("Expected reboxed failure");
  expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, reboxedCompletion.cause))).toBe(true);
  const copied = yield* Effect.exit(lifetime.fromResult(Result.fail(charged.failure))
    .pipe(Effect.ensuring(Effect.die("forged charge finalizer"))));
  if (Exit.isSuccess(copied)) throw new Error("Expected copied failure");
  expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, copied.cause))).toBe(true);
  const completed = yield* Effect.exit(lifetime.fromResult(prepared).pipe(Effect.ensuring(Effect.die(cleanup))));
  if (Exit.isSuccess(completed)) throw new Error("Expected charge and finalizer failure");
  expect(completed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === charged.failure)).toHaveLength(1);
  expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, completed.cause))).toBe(true);
  // A trusted caller catches the outcome; the root must retain this same chain.
  const sealed = yield* Effect.exit(lifetime.seal);
  if (Exit.isSuccess(sealed)) throw new Error("Expected sticky charge failure");
  expect(sealed.cause.reasons.filter(reason => Cause.isFailReason(reason) && (mode === "direct"
    ? reason.error === charged.failure : reason.error.reason === charged.failure.reason))).toHaveLength(1);
  expect(sealed.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === cleanup)).toHaveLength(1);
  expect(sealed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === "forged charge finalizer")).toBe(false);
  expect(sealed.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === "reboxed charge finalizer")).toBe(false);
  yield* lifetime.close;
})));

it("keeps a projected charge receipt's error after failed seals populate the ordinary projection cache", () => runEffect(Effect.gen(function* () {
  const root = yield* make();
  const lifetime = projectBoundedRequestLifetime(root, error => commerceError(error.reason, error));
  const charged = lifetime.charge(101), cleanup = new TypeError("receipt after projected seal");
  if (Result.isSuccess(charged)) throw new Error("Expected actual charge overflow");
  const firstSeal = yield* Effect.exit(lifetime.seal);
  const secondSeal = yield* Effect.exit(lifetime.seal);
  if (Exit.isSuccess(firstSeal) || Exit.isSuccess(secondSeal)) throw new Error("Expected charge refusal");
  const firstFailure = firstSeal.cause.reasons.find(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded");
  const secondFailure = secondSeal.cause.reasons.find(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded");
  expect(firstFailure).toBe(secondFailure);
  const completed = yield* Effect.exit(lifetime.fromResult(charged).pipe(Effect.ensuring(Effect.die(cleanup))));
  if (Exit.isSuccess(completed)) throw new Error("Expected original receipt failure");
  expect(completed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === charged.failure)).toHaveLength(1);
  expect(Result.isSuccess(lifetime.recordFailure(lifetime.context, completed.cause))).toBe(true);
  const sealed = yield* Effect.exit(root.seal);
  if (Exit.isSuccess(sealed)) throw new Error("Expected retained completed charge chain");
  expect(sealed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error.reason === "limitExceeded")).toHaveLength(1);
  expect(sealed.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === cleanup)).toHaveLength(1);
  yield* lifetime.close;
})));

// A plain ID is admitted in one interpreter step; SDK observation and pending
// IDs keep one step per rule. Every mode must reach the same verdicts.
const admissionModes = ["plain", "observed", "pendingId"] as const;
const admission = (mode: typeof admissionModes[number]) => {
  let now = 0, reads = 0, expiringRead = Number.POSITIVE_INFINITY;
  const observed: string[] = [];
  const live = Context.get(Context.empty(), Clock.Clock);
  const read = () => { reads += 1; return reads >= expiringRead ? now + 10 : now; };
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: read, currentTimeMillis: Effect.sync(read),
    currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n, currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(), monotonicTimeNanos: live.monotonicTimeNanos,
    sleep: duration => live.sleep(duration),
  };
  return {
    observed,
    reads: () => reads,
    expire: () => { now += 10; },
    expireAtRead: (count: number) => { expiringRead = reads + count; },
    id: (value: string): PresentedTransactionId => mode === "pendingId" ? Promise.resolve(value) : value,
    lifetime: (calls = 16, failure: typeof commerceError = commerceError) => makeBoundedRequestLifetime(failure,
      { calls, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write"),
    run: <Value, Failure>(work: Effect.Effect<Value, Failure>) => runEffect(mode === "observed"
      ? work.pipe(Effect.provideService(Clock.Clock, clock), Effect.provideService(ExecutionDiagnostics, {
        observe: (name, observedWork) => Effect.suspend(() => { observed.push(name); return observedWork; }) }))
      : work.pipe(Effect.provideService(Clock.Clock, clock))),
  };
};
const reasonOf = (work: Effect.Effect<unknown, CommerceTransactionError>) => work.pipe(Effect.matchEffect({
  onFailure: error => Effect.succeed(error.reason),
  onSuccess: () => Effect.die(new Error("Expected a refusal")),
}));
const sealReasons = (lifetime: { readonly seal: Effect.Effect<void, CommerceTransactionError> }) => Effect.exit(lifetime.seal).pipe(
  Effect.map(exit => Exit.isFailure(exit) ? exit.cause.reasons.flatMap(reason => Cause.isFailReason(reason) ? [reason.error.reason] : ["defect"]) : []));

it.each(admissionModes)("refuses authority, phase, deadline and overlap before charging a call: %s", mode => {
  const fixture = admission(mode);
  return fixture.run(Effect.gen(function* () {
    let ran = 0;
    const work = Effect.sync(() => { ran += 1; });

    // Authority precedes every other rule, including a wrong ID and an elapsed deadline.
    const foreign = yield* fixture.lifetime(), guarded = yield* fixture.lifetime();
    expect(yield* reasonOf(guarded.operation(foreign.context, fixture.id("other"), "write", work))).toBe("invalidAuthority");
    expect(guarded.usedCalls()).toBe(1);
    expect(yield* sealReasons(guarded)).toEqual(["rollbackOnly", "invalidAuthority"]);
    const revoking = yield* fixture.lifetime();
    const revoked = yield* revoking.nested(revoking.context, fixture.id("request"), Effect.succeed);
    expect(yield* reasonOf(revoking.operation(revoked, fixture.id("request"), "write", work))).toBe("invalidAuthority");
    expect(revoking.usedCalls()).toBe(2);
    const closed = yield* fixture.lifetime();
    yield* closed.close;
    expect(yield* reasonOf(closed.operation(closed.context, fixture.id("request"), "write", work))).toBe("invalidAuthority");
    expect(closed.usedCalls()).toBe(1);

    // A sealed request reports closure; the observed refusal ends settlement eligibility.
    const sealed = yield* fixture.lifetime();
    yield* sealed.seal;
    expect(yield* reasonOf(sealed.operation(sealed.context, fixture.id("other"), "write", work))).toBe("closed");
    expect(sealed.usedCalls()).toBe(1);
    expect(sealed.isClosing()).toBe(false);

    // Overlap is refused without a call charge, even at the call limit.
    const overlapping = yield* fixture.lifetime(2);
    expect(yield* overlapping.nested(overlapping.context, fixture.id("request"), () =>
      reasonOf(overlapping.operation(overlapping.context, fixture.id("other"), "write", work)))).toBe("overlappingOperation");
    expect(overlapping.usedCalls()).toBe(2);
    expect(yield* sealReasons(overlapping)).toEqual(["rollbackOnly", "overlappingOperation"]);

    // The sticky failure precedes the deadline; the deadline precedes overlap.
    const sticky = yield* fixture.lifetime(), expiring = yield* fixture.lifetime();
    const statement = commerceError("statementFailure");
    const first = yield* Effect.exit(sticky.operation(sticky.context, fixture.id("request"), "write", Effect.fail(statement)));
    if (!Exit.isFailure(first)) throw new Error("Expected statement failure");
    const deadline = yield* expiring.nested(expiring.context, fixture.id("request"), () => Effect.gen(function* () {
      fixture.expire();
      return yield* reasonOf(expiring.operation(expiring.context, fixture.id("other"), "write", work));
    }));
    expect(deadline).toBe("deadlineExceeded");
    expect(expiring.usedCalls()).toBe(2);
    expect(yield* sealReasons(expiring)).toEqual(["rollbackOnly", "deadlineExceeded"]);
    for (let attempt = 0; attempt < 2; attempt++) {
      const refusal = yield* Effect.flip(sticky.operation(sticky.context, fixture.id("other"), "write", work));
      expect(refusal.reason).toBe("rollbackOnly");
      expect(refusal.cause).toEqual(first.cause);
    }
    expect(sticky.usedCalls()).toBe(2);
    expect(yield* sealReasons(sticky)).toEqual(["rollbackOnly", "statementFailure"]);
    expect(ran).toBe(0);
    expect(fixture.observed.includes("BoundedRequest.checkContext")).toBe(mode === "observed");
  }));
});

it.each(admissionModes)("charges the call before the limit, ID, mode and busy rules: %s", mode => {
  const fixture = admission(mode);
  return fixture.run(Effect.gen(function* () {
    let ran = 0;
    const work = Effect.sync(() => { ran += 1; });

    // The limit precedes ID validation and retains the over-limit charge.
    const limited = yield* fixture.lifetime(2);
    yield* limited.operation(limited.context, fixture.id("request"), "write", work);
    expect(yield* reasonOf(limited.operation(limited.context, fixture.id("other"), "write", work))).toBe("limitExceeded");
    expect(limited.usedCalls()).toBe(3);
    expect(yield* sealReasons(limited)).toEqual(["rollbackOnly", "limitExceeded"]);
    expect(ran).toBe(1);

    for (const presented of [fixture.id("other"), fixture.id(""), undefined, null]) {
      const wrong = yield* fixture.lifetime();
      expect(yield* reasonOf(wrong.operation(wrong.context, presented, "write", work))).toBe("invalidAuthority");
      expect(wrong.usedCalls()).toBe(2);
      expect(yield* sealReasons(wrong)).toEqual(["rollbackOnly", "invalidAuthority"]);
    }
    const standalone = yield* fixture.lifetime();
    yield* standalone.operation(standalone.context, undefined, "read", work);
    expect(standalone.usedCalls()).toBe(2);

    // A read-only child refuses a write before the busy rule and before the work.
    const reading = yield* fixture.lifetime();
    expect(yield* reading.nested(reading.context, fixture.id("request"), child =>
      reasonOf(reading.operation(child, fixture.id("request"), "write", work)), "read")).toBe("invalidAuthority");
    expect(reading.usedCalls()).toBe(3);

    const busy = yield* fixture.lifetime();
    let inner: string | undefined;
    const outer = yield* Effect.exit(busy.operation(busy.context, fixture.id("request"), "write", Effect.gen(function* () {
      inner = yield* reasonOf(busy.operation(busy.context, fixture.id("request"), "read", work));
      return "outer";
    })));
    expect(inner).toBe("overlappingOperation");
    expect(outer).toEqual(Exit.succeed("outer"));
    expect(busy.usedCalls()).toBe(3);
    expect(yield* sealReasons(busy)).toEqual(["rollbackOnly", "overlappingOperation"]);
    expect(ran).toBe(2);
  }));
});

it.each(admissionModes)("reads the fiber clock once per context check and rechecks the deadline after the ID: %s", mode => {
  const fixture = admission(mode);
  return fixture.run(Effect.gen(function* () {
    const lifetime = yield* fixture.lifetime();
    // Effect.cached stamps each newly presented pending ID with one more read.
    const before = fixture.reads(), entryReads = mode === "pendingId" ? 3 : 2;
    expect(yield* lifetime.operation(lifetime.context, fixture.id("request"), "write", Effect.succeed("ran"))).toBe("ran");
    expect(fixture.reads() - before).toBe(entryReads);
    yield* lifetime.checkpoint(lifetime.context);
    expect(fixture.reads() - before).toBe(entryReads + 1);

    let ran = false;
    fixture.expireAtRead(entryReads);
    expect(yield* reasonOf(lifetime.operation(lifetime.context, fixture.id("request"), "write",
      Effect.sync(() => { ran = true; })))).toBe("deadlineExceeded");
    expect(ran).toBe(false);
    expect(lifetime.usedCalls()).toBe(3);
    expect(yield* sealReasons(lifetime)).toEqual(["rollbackOnly", "deadlineExceeded"]);
  }));
});

it.each(admissionModes)("retains a synchronous throw as the request's first defect and releases the operation: %s", mode => {
  const fixture = admission(mode);
  return fixture.run(Effect.gen(function* () {
    const lifetime = yield* fixture.lifetime();
    const defect = new Error("synchronous throw");
    const thrown = yield* Effect.exit(lifetime.operation(lifetime.context, fixture.id("request"), "write",
      Effect.sync((): string => { throw defect; })));
    if (!Exit.isFailure(thrown)) throw new Error("Expected the thrown defect");
    expect(thrown.cause.reasons.map(reason => Cause.isDieReason(reason) && reason.defect)).toEqual([defect]);
    const refusal = yield* Effect.flip(lifetime.operation(lifetime.context, fixture.id("request"), "read", Effect.void));
    expect(refusal.reason).toBe("rollbackOnly");
    expect(refusal.cause).toEqual(thrown.cause);
    expect(lifetime.usedCalls()).toBe(2);
    // Neither the busy flag nor the active call outlives the throw.
    expect(yield* sealReasons(lifetime)).toEqual(["rollbackOnly", "defect"]);

    // A throwing refusal factory is a defect of the entry itself.
    const factoryDefect = new Error("refusal factory");
    const throwing = yield* fixture.lifetime(16, (reason, cause) => {
      if (reason === "invalidAuthority") throw factoryDefect;
      return commerceError(reason, cause);
    });
    let ran = false;
    const entry = yield* Effect.exit(throwing.operation(throwing.context, fixture.id("other"), "write",
      Effect.sync(() => { ran = true; })));
    if (!Exit.isFailure(entry)) throw new Error("Expected the factory defect");
    expect(entry.cause.reasons.map(reason => Cause.isDieReason(reason) && reason.defect)).toEqual([factoryDefect]);
    expect(ran).toBe(false);
    expect(yield* sealReasons(throwing)).toEqual(["rollbackOnly", "defect"]);
  }));
});

it.each(admissionModes)("latches interruption of running work and releases the operation: %s", mode => {
  const fixture = admission(mode);
  return fixture.run(Effect.gen(function* () {
    const lifetime = yield* fixture.lifetime();
    const started = yield* Deferred.make<void>();
    const running = yield* Effect.forkChild(lifetime.operation(lifetime.context, fixture.id("request"), "write",
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))));
    yield* Deferred.await(started);
    const interrupted = yield* Fiber.interrupt(running).pipe(Effect.andThen(Fiber.await(running)));
    expect(Exit.isFailure(interrupted) && Cause.hasInterruptsOnly(interrupted.cause)).toBe(true);
    const refusal = yield* Effect.flip(lifetime.operation(lifetime.context, fixture.id("request"), "read", Effect.void));
    expect(refusal.reason).toBe("rollbackOnly");
    expect(Cause.isCause(refusal.cause) && Cause.hasInterruptsOnly(refusal.cause)).toBe(true);
    expect(lifetime.usedCalls()).toBe(2);
  }));
});

it("resolves a pending ID once, admits its owner and refuses a rejected or foreign ID", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* make();
  let resolve: (value: string) => void = () => undefined, thens = 0;
  const pending = new Promise<string>(settle => { resolve = settle; });
  const then = pending.then.bind(pending);
  pending.then = ((...handlers: Parameters<typeof then>) => { thens += 1; return then(...handlers); }) as typeof pending.then;
  const waiting = yield* Effect.forkChild(lifetime.operation(lifetime.context, pending, "write", Effect.succeed("first")));
  yield* Effect.yieldNow;
  expect(lifetime.usedCalls()).toBe(2);
  resolve("request");
  expect(yield* Fiber.join(waiting)).toBe("first");
  expect(yield* lifetime.operation(lifetime.context, pending, "read", Effect.succeed("second"))).toBe("second");
  expect(thens).toBe(1);
  yield* lifetime.seal;
  yield* lifetime.close;

  const rejection = new Error("pending ID rejected");
  const rejected = yield* make();
  let ran = false;
  const refusal = yield* Effect.flip(rejected.operation(rejected.context, Promise.reject(rejection), "write",
    Effect.sync(() => { ran = true; })));
  expect(refusal.reason).toBe("invalidAuthority");
  expect(refusal.cause).toBe(rejection);
  expect(ran).toBe(false);
  yield* rejected.close;
})));

it("takes the deadline of a plain entry from the fiber's TestClock", () => runEffect(Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10 }, {}, {}, "request", "write");
  yield* TestClock.adjust("9 millis");
  expect(yield* lifetime.operation(lifetime.context, "request", "write", Effect.succeed("ran"))).toBe("ran");
  yield* TestClock.adjust("1 millis");
  expect(yield* Effect.flip(lifetime.operation(lifetime.context, "request", "write", Effect.succeed("late"))))
    .toMatchObject({ reason: "deadlineExceeded" });
  expect(lifetime.usedCalls()).toBe(2);
  yield* lifetime.close;
}).pipe(Effect.provide(TestClock.layer()))));

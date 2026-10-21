import { Cause, Context, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";
import { makeBoundedRequestLifetime, projectBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { runEffect } from "../../support/effectTestRuntime";

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

import { Cause, Context, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { expect, it } from "vitest";
import { makeBoundedRequestLifetime, type BoundedRequestLifetime, type RequestLimits } from "../src/execution/preparation/boundedRequestLifetime";
import { makeAtomicCommerceOperations, type AtomicCommerceOperations } from "../src/frameworks/atomicCommerce/operations";
import { commerceError, type CommerceTransactionError } from "../src/frameworks/commerceTransaction/model";
import { captureCommerceJsonData } from "../src/frameworks/commerceTransaction/request";
import { runEffect } from "./support/effectTestRuntime";

const withOperations = <Value>(
  body: (lifetime: BoundedRequestLifetime<CommerceTransactionError>, operations: AtomicCommerceOperations) => Effect.Effect<Value, CommerceTransactionError>,
  limits: Partial<RequestLimits> = {}, callLimit = 16,
) => Effect.gen(function* () {
  const lifetime = yield* makeBoundedRequestLifetime(commerceError,
    { calls: 128, commandBytes: 4096, commandMs: 10_000, ...limits }, {}, {}, "request", "write");
  const operations = yield* makeAtomicCommerceOperations(lifetime, callLimit);
  return yield* body(lifetime, operations).pipe(Effect.ensuring(operations.close.pipe(Effect.andThen(lifetime.close))));
});
const failure = <Value>(exit: Exit.Exit<Value, CommerceTransactionError>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected failed operation");
  return exit.cause;
};
const hasReason = (cause: Cause.Cause<CommerceTransactionError>, expected: CommerceTransactionError["reason"]) =>
  cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === expected);
class NativeFailureMarker extends Context.Service<NativeFailureMarker, string>()("test/NativeFailureMarker") {}

it("serializes complete same-context calls in FIFO order and snapshots/charges before waiting", () => runEffect(withOperations((lifetime, operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>(), nativeRelease = yield* Deferred.make<void>(), receiptStarted = yield* Deferred.make<void>(), receiptRelease = yield* Deferred.make<void>();
  const secondPrepared = Deferred.makeUnsafe<void>(), thirdPrepared = Deferred.makeUnsafe<void>();
  const trace: string[] = [];
  const first = yield* Effect.forkChild(operations.submit(() => Result.succeed(undefined), () =>
    lifetime.nested(lifetime.context, "request", child => lifetime.operation(child, "request", "write", Effect.gen(function* () {
      trace.push("first native"); yield* Deferred.succeed(started, undefined); yield* Deferred.await(nativeRelease);
    }))).pipe(Effect.andThen(Effect.gen(function* () {
      trace.push("first receipt"); yield* Deferred.succeed(receiptStarted, undefined); yield* Deferred.await(receiptRelease);
    })))));
  yield* Deferred.await(started);
  const input = { value: "before" }, bytesBefore = lifetime.remainingBytes();
  const second = yield* Effect.forkChild(operations.submit(() => captureCommerceJsonData(input, lifetime.remainingBytes()).pipe(Result.flatMap(captured =>
    lifetime.charge(captured.bytes).pipe(Result.map(() => {
      Deferred.doneUnsafe(secondPrepared, Effect.void); return captured.value;
    })))), captured => lifetime.nested(lifetime.context, "request", child => lifetime.operation(child, "request", "write",
      Effect.sync(() => { trace.push("second"); return captured; })))));
  yield* Deferred.await(secondPrepared);
  input.value = "after";
  expect(lifetime.remainingBytes()).toBeLessThan(bytesBefore);
  const third = yield* Effect.forkChild(operations.submit(() => {
    Deferred.doneUnsafe(thirdPrepared, Effect.void); return Result.succeed(undefined);
  }, () => lifetime.nested(lifetime.context, "request", () => Effect.sync(() => { trace.push("third"); }))));
  yield* Deferred.await(thirdPrepared);
  expect(trace).toEqual(["first native"]);
  yield* Deferred.succeed(nativeRelease, undefined); yield* Deferred.await(receiptStarted);
  expect(trace).toEqual(["first native", "first receipt"]);
  yield* Deferred.succeed(receiptRelease, undefined);
  yield* Fiber.join(first);
  expect(yield* Fiber.join(second)).toEqual({ value: "before" });
  yield* Fiber.join(third);
  expect(trace).toEqual(["first native", "first receipt", "second", "third"]);
  yield* operations.seal; yield* lifetime.seal;
}))));

it("latches a caught prequeue refusal before aborting active work and refuses later preparation", () => runEffect(withOperations((lifetime, operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>();
  let drained = false, preparedAgain = false;
  const first = yield* Effect.forkChild(operations.submit(() => Result.succeed(undefined), () =>
    lifetime.nested(lifetime.context, "request", () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)))
      .pipe(Effect.ensuring(Effect.sync(() => { drained = true; })))));
  yield* Deferred.await(started);
  const original = commerceError("invalidInput", "capture refused");
  const refused = yield* Effect.exit(operations.submit(() => Result.fail(original), () => Effect.void));
  const originalCause = failure(refused);
  expect(originalCause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
  expect(drained).toBe(true);
  yield* Fiber.await(first);
  const later = yield* Effect.exit(operations.submit(() => { preparedAgain = true; return Result.succeed(undefined); }, () => Effect.void));
  expect(preparedAgain).toBe(false);
  expect(failure(later)).toEqual(originalCause);
  expect(failure(yield* Effect.exit(operations.seal))).toEqual(originalCause);
}))));

it("preserves the first complete queued failure cause after callers catch all failures", () => runEffect(withOperations((_lifetime, operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), queued = Deferred.makeUnsafe<void>(), lastQueued = Deferred.makeUnsafe<void>();
  let lastRan = false;
  const first = yield* Effect.forkChild(operations.submit(() => Result.succeed(undefined), () =>
    Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))));
  yield* Deferred.await(started);
  const statement = commerceError("statementFailure"), defect = new Error("native defect");
  const original = Cause.annotate(Cause.combine(Cause.fail(statement), Cause.die(defect)), Context.make(NativeFailureMarker, "original"));
  const assertOriginal = (cause: Cause.Cause<CommerceTransactionError>) => {
    expect(cause.reasons).toHaveLength(2);
    const [typed, died] = cause.reasons;
    if (typed === undefined || !Cause.isFailReason(typed) || died === undefined || !Cause.isDieReason(died))
      throw new Error("Expected the complete original Fail and Die cause");
    expect(typed.error).toBe(statement); expect(died.defect).toBe(defect);
    for (const reason of cause.reasons) expect(Context.getOrUndefined(Cause.reasonAnnotations(reason), NativeFailureMarker)).toBe("original");
  };
  const second = yield* Effect.forkChild(operations.submit(() => {
    Deferred.doneUnsafe(queued, Effect.void); return Result.succeed(undefined);
  }, () => Effect.failCause(original)));
  yield* Deferred.await(queued); yield* Effect.yieldNow;
  const third = yield* Effect.forkChild(operations.submit(() => {
    Deferred.doneUnsafe(lastQueued, Effect.void); return Result.succeed(undefined);
  }, () => Effect.sync(() => { lastRan = true; })));
  yield* Deferred.await(lastQueued); yield* Effect.yieldNow; yield* Deferred.succeed(release, undefined);
  yield* Fiber.join(first);
  assertOriginal(failure(yield* Fiber.await(second)));
  assertOriginal(failure(yield* Fiber.await(third)));
  expect(lastRan).toBe(false);
  assertOriginal(failure(yield* Effect.exit(operations.seal)));
  yield* operations.close;
  assertOriginal(failure(yield* Effect.exit(operations.submit(() => Result.succeed(undefined), () => Effect.void))));
}))));

it("retains a preparation defect without converting it to a typed error", () => runEffect(withOperations((_lifetime, operations) => Effect.gen(function* () {
  const defect = new Error("capture defect");
  const exit = yield* Effect.exit(operations.submit(() => { throw defect; }, () => Effect.void));
  const cause = failure(exit);
  expect(cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
  expect(failure(yield* Effect.exit(operations.seal))).toEqual(cause);
}))));

it("uses the original deadline for queued work and never starts the waiting job", () => runEffect(withOperations((_lifetime, operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>(), queued = Deferred.makeUnsafe<void>();
  let waitingRan = false;
  const first = yield* Effect.forkChild(operations.submit(() => Result.succeed(undefined), () =>
    Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))));
  yield* Deferred.await(started);
  yield* TestClock.adjust("9 millis");
  const second = yield* Effect.forkChild(operations.submit(() => {
    Deferred.doneUnsafe(queued, Effect.void); return Result.succeed(undefined);
  }, () => Effect.sync(() => { waitingRan = true; })));
  yield* Deferred.await(queued); yield* Effect.yieldNow; yield* TestClock.adjust("1 millis");
  expect(hasReason(failure(yield* Fiber.await(first)), "deadlineExceeded")).toBe(true);
  expect(hasReason(failure(yield* Fiber.await(second)), "deadlineExceeded")).toBe(true);
  expect(waitingRan).toBe(false);
  expect(hasReason(failure(yield* Effect.exit(operations.seal)), "deadlineExceeded")).toBe(true);
}), { commandMs: 10 }).pipe(Effect.provide(TestClock.layer()))));

it("checks deadline and lifetime phase before running preparation", () => runEffect(withOperations((lifetime, operations) => Effect.gen(function* () {
  yield* TestClock.adjust("10 millis");
  let prepared = false;
  const expired = yield* Effect.exit(operations.submit(() => { prepared = true; return Result.succeed(undefined); }, () => Effect.void));
  expect(prepared).toBe(false);
  expect(hasReason(failure(expired), "deadlineExceeded")).toBe(true);
  expect(lifetime.remainingBytes()).toBe(4096);
}), { commandMs: 10 }).pipe(Effect.provide(TestClock.layer()))));

it("accounts for a canceled waiter, drains active work and rejects late queued work", () => runEffect(withOperations((_lifetime, operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>(), queued = Deferred.makeUnsafe<void>();
  let drained = false, waitingRan = false;
  const first = yield* Effect.forkChild(operations.submit(() => Result.succeed(undefined), () =>
    Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never), Effect.ensuring(Effect.sync(() => { drained = true; })))));
  yield* Deferred.await(started);
  const second = yield* Effect.forkChild(operations.submit(() => {
    Deferred.doneUnsafe(queued, Effect.void); return Result.succeed(undefined);
  }, () => Effect.sync(() => { waitingRan = true; })));
  yield* Deferred.await(queued); yield* Fiber.interrupt(second);
  expect(drained).toBe(true);
  expect(Cause.hasInterrupts(failure(yield* Fiber.await(first)))).toBe(true);
  expect(waitingRan).toBe(false);
  expect(Cause.hasInterrupts(failure(yield* Effect.exit(operations.seal)))).toBe(true);
}))));

it("refuses preparation when the underlying lifetime is already rollback-only", () => runEffect(withOperations((lifetime, operations) => Effect.gen(function* () {
  const original = commerceError("statementFailure");
  yield* Effect.exit(lifetime.operation(lifetime.context, "request", "write", Effect.fail(original)));
  let prepared = false;
  const refused = failure(yield* Effect.exit(operations.submit(() => { prepared = true; return Result.succeed(undefined); }, () => Effect.void)));
  expect(prepared).toBe(false); expect(hasReason(refused, "rollbackOnly")).toBe(true);
  const sealed = failure(yield* Effect.exit(lifetime.seal));
  expect(sealed.reasons.some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
}))));

it("revokes before close and joins active cleanup before returning", () => runEffect(withOperations((_lifetime, operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>(), cleanupStarted = yield* Deferred.make<void>(), cleanupRelease = yield* Deferred.make<void>(), queued = Deferred.makeUnsafe<void>();
  let closed = false, lateRan = false, preparedAfterClose = false;
  const first = yield* Effect.forkChild(operations.submit(() => Result.succeed(undefined), () =>
    Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never), Effect.ensuring(
      Deferred.succeed(cleanupStarted, undefined).pipe(Effect.andThen(Deferred.await(cleanupRelease)))))));
  yield* Deferred.await(started);
  const second = yield* Effect.forkChild(operations.submit(() => {
    Deferred.doneUnsafe(queued, Effect.void); return Result.succeed(undefined);
  }, () => Effect.sync(() => { lateRan = true; })));
  yield* Deferred.await(queued);
  const closing = yield* Effect.forkChild(operations.close.pipe(Effect.andThen(Effect.sync(() => { closed = true; }))));
  yield* Deferred.await(cleanupStarted); expect(closed).toBe(false);
  const late = yield* Effect.exit(operations.submit(() => { preparedAfterClose = true; return Result.succeed(undefined); }, () => Effect.void));
  expect(hasReason(failure(late), "closed")).toBe(true); expect(preparedAfterClose).toBe(false);
  yield* Deferred.succeed(cleanupRelease, undefined); yield* Fiber.join(closing);
  expect(closed).toBe(true); expect(lateRan).toBe(false);
  yield* Fiber.await(first); yield* Fiber.await(second);
}))));

it("fails seal when active or pending jobs escape and keeps the refusal sticky", () => runEffect(withOperations((_lifetime, operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>();
  const first = yield* Effect.forkChild(operations.submit(() => Result.succeed(undefined), () =>
    Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))));
  yield* Deferred.await(started);
  const sealed = failure(yield* Effect.exit(operations.seal));
  expect(hasReason(sealed, "overlappingOperation")).toBe(true);
  yield* operations.close;
  expect(failure(yield* Fiber.await(first))).toEqual(sealed);
}))));

it("bounds total accepted root jobs before calling another prepare hook", () => runEffect(withOperations((lifetime, operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>(), queued = Deferred.makeUnsafe<void>(), lastQueued = Deferred.makeUnsafe<void>();
  let extraPrepared = false, queuedRan = false;
  const first = yield* Effect.forkChild(operations.submit(() => Result.succeed(undefined), () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))));
  yield* Deferred.await(started);
  const second = yield* Effect.forkChild(operations.submit(() => {
    Deferred.doneUnsafe(queued, Effect.void); return Result.succeed(undefined);
  }, () => Effect.sync(() => { queuedRan = true; })));
  yield* Deferred.await(queued); yield* Effect.yieldNow;
  const third = yield* Effect.forkChild(operations.submit(() => {
    Deferred.doneUnsafe(lastQueued, Effect.void); return Result.succeed(undefined);
  }, () => Effect.sync(() => { queuedRan = true; })));
  yield* Deferred.await(lastQueued); yield* Effect.yieldNow;
  expect(lifetime.usedCalls()).toBe(1);
  const refused = failure(yield* Effect.exit(operations.submit(() => { extraPrepared = true; return Result.succeed(undefined); }, () => Effect.void)));
  expect(hasReason(refused, "limitExceeded")).toBe(true); expect(extraPrepared).toBe(false); expect(queuedRan).toBe(false);
  expect(failure(yield* Fiber.await(first))).toEqual(refused); expect(failure(yield* Fiber.await(second))).toEqual(refused);
  expect(failure(yield* Fiber.await(third))).toEqual(refused);
}), {}, 3)));

it("preserves the default low-level refusal of concurrent borrowed contexts", () => runEffect(withOperations((lifetime, _operations) => Effect.gen(function* () {
  const started = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
  const first = yield* Effect.forkChild(lifetime.nested(lifetime.context, "request", () =>
    Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(release)))));
  yield* Deferred.await(started);
  const refused = failure(yield* Effect.exit(lifetime.nested(lifetime.context, "request", () => Effect.void)));
  expect(hasReason(refused, "overlappingOperation")).toBe(true);
  yield* Deferred.succeed(release, undefined); yield* Fiber.join(first);
  expect(hasReason(failure(yield* Effect.exit(lifetime.seal)), "overlappingOperation")).toBe(true);
}))));

it("rejects an exhausted underlying call budget before another capture hook runs", () => runEffect(withOperations((lifetime, operations) => Effect.gen(function* () {
  for (let index = 0; index < 2; index++) yield* operations.submit(() => Result.succeed(undefined), () =>
    lifetime.operation(lifetime.context, "request", "read", Effect.void));
  expect(lifetime.usedCalls()).toBe(3);
  let captured = false;
  const refused = failure(yield* Effect.exit(operations.submit(() => { captured = true; return Result.succeed(undefined); }, () => Effect.void)));
  expect(captured).toBe(false); expect(hasReason(refused, "limitExceeded")).toBe(true);
  expect(lifetime.remainingBytes()).toBe(4096);
  expect(failure(yield* Effect.exit(operations.seal))).toEqual(refused);
}), { calls: 3 }, 3)));

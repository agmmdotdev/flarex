import { Cause, Context, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { expect, it } from "vitest";
import { makeBoundedRequestLifetime, type BoundedRequestLifetime } from "../src/execution/preparation/boundedRequestLifetime";
import { withCommerceCommandContext } from "../src/frameworks/commerceTransaction/context";
import type { CommerceCommandContext } from "../src/frameworks/commerceTransaction/commands";
import { commerceError, type CommerceTransactionError } from "../src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../src/frameworks/commerceTransaction/resources";
import { runEffect } from "./support/effectTestRuntime";

// No storage is used: these regressions exercise the genuine borrowed lifetime,
// queue and command finalizer. An unexpected store access fails immediately.
const unused = () => Effect.fail(commerceError("unsupportedProfile"));
const store: CommerceCommandContext["store"] = {
  prepareRead: () => ({ find: unused, findPage: unused, count: unused }),
  aggregate: unused, find: unused, findPage: unused, count: unused,
  write: unused, delete: unused, lifecycle: unused,
};
const withLifetime = <Value>(work: (lifetime: BoundedRequestLifetime<CommerceTransactionError>) => Effect.Effect<Value, CommerceTransactionError>) =>
  Effect.acquireUseRelease(makeBoundedRequestLifetime(commerceError,
    { calls: 128, commandBytes: 4096, commandMs: 10_000 }, {}, {}, "request", "write"), work, lifetime => lifetime.close);
const borrowed = <Value>(lifetime: BoundedRequestLifetime<CommerceTransactionError>,
  work: (context: CommerceCommandContext) => Effect.Effect<Value, CommerceTransactionError>) =>
  lifetime.nested(lifetime.context, "request", manager => withCommerceCommandContext(lifetime,
    { store, resources: defaultCommerceResources, table: unused }, "request", manager, unused, unused, 16, work));
const failure = <Value>(exit: Exit.Exit<Value, CommerceTransactionError>) => {
  if (!Exit.isFailure(exit)) throw new Error("Expected a failed callback completion");
  return exit.cause;
};
const reasons = (cause: Cause.Cause<CommerceTransactionError>) => cause.reasons.filter(Cause.isFailReason).map(reason => reason.error.reason);

it("keeps a flush failure outside an otherwise successful FIFO as its sole original failure", () => runEffect(withLifetime(lifetime => Effect.gen(function* () {
  const original = commerceError("invalidInput");
  const exit = yield* Effect.exit(borrowed(lifetime, context => Effect.gen(function* () {
    if (context.enqueue === undefined) throw new Error("Missing authentic borrowed queue");
    yield* context.enqueue(() => Result.succeed({}), () => Effect.void);
    return yield* lifetime.operation(context.manager, "request", "write", Effect.fail(original));
  })));
  const cause = failure(exit);
  expect(cause.reasons).toHaveLength(1);
  expect(cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([original]);
  expect(reasons(cause)).not.toContain("rollbackOnly");
  // Failure completion does not reopen a poisoned lifetime to later DAL work.
  expect(reasons(failure(yield* Effect.exit(lifetime.operation(lifetime.context, "request", "read", Effect.void)))))
    .toContain("rollbackOnly");
}))));

it("keeps a swallowed queued failure when the callback reports success", () => runEffect(withLifetime(lifetime => Effect.gen(function* () {
  const original = commerceError("invalidInput");
  const exit = yield* Effect.exit(borrowed(lifetime, context => Effect.gen(function* () {
    if (context.enqueue === undefined) throw new Error("Missing authentic borrowed queue");
    yield* Effect.exit(context.enqueue(() => Result.succeed({}), () => Effect.fail(original)));
    return "caught by callback";
  })));
  const cause = failure(exit);
  expect(cause.reasons).toHaveLength(1);
  expect(cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([original]);
}))));

it.each(["defect", "interruption"] as const)("preserves every reason of callback Fail plus %s", kind => runEffect(withLifetime(lifetime => Effect.gen(function* () {
  const original = commerceError("invalidInput"), defect = new TypeError("native callback defect");
  const cause = Cause.combine(Cause.fail(original), kind === "defect" ? Cause.die(defect) : Cause.interrupt(712));
  const complete = failure(yield* Effect.exit(borrowed(lifetime, context =>
    lifetime.operation(context.manager, "request", "write", Effect.failCause(cause)))));
  expect(complete.reasons).toHaveLength(2);
  expect(complete.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([original]);
  if (kind === "defect") expect(complete.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
  else expect(Cause.hasInterrupts(complete)).toBe(true);
  expect(reasons(complete)).not.toContain("rollbackOnly");
}))));

it("retains distinct queued and later callback failures without replacing either", () => runEffect(withLifetime(lifetime => Effect.gen(function* () {
  const queued = commerceError("invalidInput"), callback = new Error("later callback defect");
  const exit = yield* Effect.exit(borrowed(lifetime, context => Effect.gen(function* () {
    if (context.enqueue === undefined) throw new Error("Missing authentic borrowed queue");
    yield* Effect.exit(context.enqueue(() => Result.succeed({}), () => Effect.fail(queued)));
    return yield* Effect.die(callback);
  })));
  const cause = failure(exit);
  expect(cause.reasons).toHaveLength(2);
  expect(cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([queued]);
  expect(cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([callback]);
}))));

it("retains escaped-work refusal beside a failed callback and joins worker cleanup", () => runEffect(withLifetime(lifetime => Effect.gen(function* () {
  const started = yield* Deferred.make<void>(), original = commerceError("invalidInput");
  let cleaned = false;
  let escaped: Fiber.Fiber<void, CommerceTransactionError> | undefined;
  const exit = yield* Effect.exit(borrowed(lifetime, context => Effect.gen(function* () {
    if (context.enqueue === undefined) throw new Error("Missing authentic borrowed queue");
    const submission = context.enqueue(() => Result.succeed({}), () =>
      Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never),
        Effect.ensuring(Effect.sync(() => { cleaned = true; }))));
    escaped = yield* Effect.forkChild(submission);
    yield* Deferred.await(started);
    return yield* Effect.fail(original);
  })));
  const cause = failure(exit);
  expect(reasons(cause)).toEqual(["invalidInput", "overlappingOperation"]);
  expect(cause.reasons.filter(Cause.isFailReason).some(reason => reason.error === original)).toBe(true);
  expect(cleaned).toBe(true);
  if (escaped === undefined) throw new Error("Missing escaped submission");
  const pending = failure(yield* Fiber.await(escaped));
  expect(reasons(pending)).toContain("overlappingOperation");
  expect(reasons(pending)).toContain("invalidInput");
}))));

it("runs the successful-completion checkpoint once when it refuses a swallowed external failure", () => runEffect(withLifetime(lifetime => Effect.gen(function* () {
  const original = commerceError("invalidInput");
  let checkpoints = 0;
  const observed = { ...lifetime, checkpoint: (context: Parameters<typeof lifetime.checkpoint>[0]) =>
    Effect.sync(() => { checkpoints++; }).pipe(Effect.andThen(lifetime.checkpoint(context))) };
  const exit = yield* Effect.exit(borrowed(observed, context => Effect.gen(function* () {
    yield* Effect.fromResult(lifetime.recordFailure(context.manager, Cause.fail(original)));
    return "swallowed external failure";
  })));
  expect(checkpoints).toBe(1);
  expect(reasons(failure(exit))).toEqual(["rollbackOnly"]);
  expect(reasons(failure(exit))).not.toContain("closed");
}))));
class CompletionDiagnostic extends Context.Service<CompletionDiagnostic, string>()("test/CompletionDiagnostic") {}

it("recognizes one originating queued failure across callback stack annotations", () => runEffect(withLifetime(lifetime => Effect.gen(function* () {
  const original = commerceError("invalidInput");
  const annotated = Cause.annotate(Cause.fail(original), Context.make(CompletionDiagnostic, "native"));
  const exit = yield* Effect.exit(borrowed(lifetime, context => Effect.gen(function* () {
    if (context.enqueue === undefined) throw new Error("Missing authentic borrowed queue");
    return yield* context.enqueue(() => Result.succeed({}), () => Effect.failCause(annotated));
  })));
  const cause = failure(exit);
  expect(cause.reasons).toHaveLength(1);
  expect(cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([original]);
  for (const reason of cause.reasons)
    expect(Context.getOrUndefined(Cause.reasonAnnotations(reason), CompletionDiagnostic)).toBe("native");
}))));

import { Cause, Clock, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { makeCmsRequestLifetime } from "../src/cmsTransaction/lifetime";
import { cmsError, cmsLimits, type CmsPresentedTransactionId, type CmsRequestContext } from "../src/cmsTransaction/model";
import { runEffect } from "./effectTestRuntime";

const make = () => makeCmsRequestLifetime({ hostId: Symbol() }, { requestId: Symbol() }, "request-id", "write");

describe("private CMS request lifetime", () => {
  it("joins pending IDs, borrows a child, seals once and revokes escaped contexts", () => runEffect(Effect.gen(function* () {
    const request = yield* make();
    const id = yield* request.begin(request.context);
    const pending = Promise.resolve(id);
    expect(yield* request.begin(request.context, pending)).toBe(id);
    const child = yield* request.nested(request.context, pending, child => request.operation(child, id, "write", Effect.succeed(child)));
    expect(yield* request.operation(request.context, undefined, "read", Effect.succeed("pending view"))).toBe("pending view");
    yield* request.seal;
    expect(request.isClosing()).toBe(true);
    expect(Result.isFailure(yield* Effect.result(request.seal))).toBe(true);
    yield* request.close;
    expect(yield* Effect.result(request.begin(child, id))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(request.isClosing()).toBe(false);
  })));

  it.each(["", "foreign", null, undefined, 0])("refuses missing/invalid mutation IDs (%s) before work and latches failure", value => runEffect(Effect.gen(function* () {
    const request = yield* make();
    let entered = false;
    // SAFETY: deliberately supply a runtime-invalid adapter ID to the typed boundary.
    const id = value as CmsPresentedTransactionId;
    expect(Result.isFailure(yield* Effect.result(request.operation(request.context, id, "write", Effect.sync(() => { entered = true; }))))).toBe(true);
    expect(entered).toBe(false);
    expect(Exit.isFailure(yield* Effect.exit(request.seal))).toBe(true);
    yield* request.close;
  })));

  it("refuses foreign and forged contexts and poisons the receiving request", () => runEffect(Effect.gen(function* () {
    const first = yield* make();
    const second = yield* make();
    expect(yield* Effect.result(first.begin(second.context, "request-id"))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(Exit.isFailure(yield* Effect.exit(first.seal))).toBe(true);
    // SAFETY: an object copy must not acquire registry authority.
    const forged = Object.freeze({ ...second.context }) as CmsRequestContext;
    expect(Result.isFailure(yield* Effect.result(second.begin(forged)))).toBe(true);
    yield* first.close;
    yield* second.close;
  })));

  it("retains a caught child's original failure and refuses adapter settlement", () => runEffect(Effect.gen(function* () {
    const request = yield* make();
    const failure = cmsError("documentInvalid");
    yield* request.nested(request.context, "request-id", () => Effect.fail(failure)).pipe(Effect.result);
    const sealed = yield* Effect.exit(request.seal);
    expect(Exit.isFailure(sealed)).toBe(true);
    if (Exit.isFailure(sealed)) expect(Cause.pretty(sealed.cause)).toContain("CmsTransactionError");
    yield* request.close;
    const borrowed = yield* make();
    expect(yield* Effect.result(borrowed.adapterCommit(borrowed.context, "request-id"))).toMatchObject({ _tag: "Failure", failure: { reason: "borrowedSettlement" } });
    expect(Exit.isFailure(yield* Effect.exit(borrowed.seal))).toBe(true);
    yield* borrowed.close;
  })));

  it("rejects overlapping work and active children at closure without reopening", () => runEffect(Effect.gen(function* () {
    const request = yield* make();
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const child = yield* Effect.forkChild(request.nested(request.context, "request-id", context =>
      request.operation(context, "request-id", "write", Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))))));
    yield* Deferred.await(entered);
    expect(Result.isFailure(yield* Effect.result(request.operation(request.context, "request-id", "read", Effect.void)))).toBe(true);
    expect(Exit.isFailure(yield* Effect.exit(request.seal))).toBe(true);
    yield* request.close;
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(child);
    expect(request.isClosing()).toBe(false);
  })));

  it("rechecks closure after a pending ID settles", () => runEffect(Effect.gen(function* () {
    const request = yield* make();
    let resolve: (id: string) => void = () => { throw new Error("Promise resolver not initialized"); };
    const pending = new Promise<string>(done => { resolve = done; });
    let entered = false;
    const operation = yield* Effect.forkChild(request.operation(request.context, pending, "write", Effect.sync(() => { entered = true; })).pipe(Effect.exit));
    yield* Effect.yieldNow;
    expect(Exit.isFailure(yield* Effect.exit(request.seal))).toBe(true);
    expect(request.isClosing()).toBe(false);
    yield* request.close;
    resolve("request-id");
    expect(Exit.isFailure(yield* Fiber.join(operation))).toBe(true);
    expect(entered).toBe(false);
  })));

  it("enforces call, byte, read-only and clock budgets", async () => {
    let now = 0;
    const clock: Clock.Clock = {
      currentTimeMillisUnsafe: () => now, currentTimeMillis: Effect.sync(() => now),
      currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n), sleep: () => Effect.void,
    };
    await runEffect(Effect.gen(function* () {
      const calls = yield* make();
      for (let index = 1; index < cmsLimits.calls; index++) yield* calls.begin(calls.context);
      expect(yield* Effect.result(calls.begin(calls.context))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      yield* calls.close;
      const bytes = yield* make();
      expect(Result.isSuccess(bytes.charge(cmsLimits.commandBytes))).toBe(true);
      expect(Result.isFailure(bytes.charge(1))).toBe(true);
      expect(Exit.isFailure(yield* Effect.exit(bytes.seal))).toBe(true);
      yield* bytes.close;
      const read = yield* makeCmsRequestLifetime({ hostId: Symbol() }, { requestId: Symbol() }, "read-id", "read");
      expect(Result.isFailure(yield* Effect.result(read.operation(read.context, "read-id", "write", Effect.void)))).toBe(true);
      yield* read.close;
      const expired = yield* make();
      now += cmsLimits.commandMs;
      expect(yield* Effect.result(expired.begin(expired.context))).toMatchObject({ _tag: "Failure", failure: { reason: "deadlineExceeded" } });
      yield* expired.close;
    }).pipe(Effect.provideService(Clock.Clock, clock)));
  });
});

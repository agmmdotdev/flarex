import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { isJsonObject } from "flarex-protocol/json";
import { defineAtomicCommerceCommand } from "../src/frameworks/atomicCommerce/commands";
import { commerceError } from "../src/frameworks/commerceTransaction/model";
import { captureCommerceJsonData } from "../src/frameworks/commerceTransaction/json";
import { bindAtomicCommerceNativeRequest, captureAtomicCommerceNativeRequest, joinAtomicCommerceNativeRequest,
  readAtomicCommerceNativeRequest, type AtomicCommerceNativeCorrelation } from "../src/frameworks/atomicCommerce/nativeRequest";

const identity = (key = "commerce/atomic/neutral", requestHash = "a".repeat(64), rootHash = "b".repeat(64)): AtomicCommerceNativeCorrelation =>
  ({ kind: "nativeRoot", key, requestHash, root: { definitionHash: rootHash } });

describe("current native atomic request correlation", () => {
  it("captures arguments before suspension and refuses unissued or rebound request tokens", () => {
    const args = { nested: { value: "original" } };
    const command = defineAtomicCommerceCommand("neutral", (_context, input) => Effect.succeed(input));
    const request = captureAtomicCommerceNativeRequest("commerce/atomic/neutral", command, args, 1024);
    args.nested.value = "mutated";
    const data = readAtomicCommerceNativeRequest(request);
    expect(data).toBeDefined();
    if (data === undefined) throw new Error("Missing issued request");
    expect(Result.getOrThrow(data.arguments).value).toEqual({ nested: { value: "original" } });
    expect(readAtomicCommerceNativeRequest(new Proxy(request, {}))).toBeUndefined();
    expect(Result.isSuccess(bindAtomicCommerceNativeRequest(request, identity(), 10))).toBe(true);
    expect(Result.isFailure(bindAtomicCommerceNativeRequest(request, identity(undefined, "c".repeat(64)), 10))).toBe(true);
    expect(Object.keys(request)).toEqual([]);
  });

  it("shares one current success, freezes its complete value, and retains no completed receipt", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const owner = { close: Effect.void }, entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      let calls = 0;
      const owned = yield* Effect.fromResult(captureCommerceJsonData({ complete: { values: ["original"] } }, 1024));
      const work = Effect.gen(function* () { calls++; yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release);
        return owned.value; });
      const leader = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), work));
      yield* Deferred.await(entered);
      const follower = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), work));
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, undefined);
      const first = yield* Fiber.join(leader), second = yield* Fiber.join(follower);
      expect(first).toEqual(second); expect(calls).toBe(1);
      expect(Object.isFrozen(first)).toBe(true);
      if (!isJsonObject(first)) throw new Error("Expected owned DTO");
      expect(Object.isFrozen(first.complete)).toBe(true);
      yield* joinAtomicCommerceNativeRequest(owner, identity(), Effect.sync(() => { calls++; return null; }));
      expect(calls).toBe(2);
    })));
  });

  it("refuses changed arguments or root profile under the same key and leaves other keys/owners parallel", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const owner = { close: Effect.void }, entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      const leader = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), Effect.gen(function* () {
        yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); return null;
      })));
      yield* Deferred.await(entered);
      for (const changed of [identity(undefined, "c".repeat(64)), identity(undefined, undefined, "d".repeat(64))]) {
        const denied = yield* Effect.exit(joinAtomicCommerceNativeRequest(owner, changed, Effect.die("must not run")));
        expect(Exit.isFailure(denied) && denied.cause.reasons.some(reason => Cause.isFailReason(reason)
          && reason.error.reason === "requestConflict")).toBe(true);
      }
      expect(yield* joinAtomicCommerceNativeRequest(owner, identity("commerce/atomic/other"), Effect.succeed("other-key"))).toBe("other-key");
      expect(yield* joinAtomicCommerceNativeRequest({ close: Effect.void }, identity(), Effect.succeed("other-owner"))).toBe("other-owner");
      yield* Deferred.succeed(release, undefined); yield* Fiber.join(leader);
    })));
  });

  it("detaches an interrupted follower without canceling or promoting the leader", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const owner = { close: Effect.void }, entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      let calls = 0;
      const work = Effect.gen(function* () { calls++; yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); return "complete"; });
      const leader = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), work));
      yield* Deferred.await(entered);
      const follower = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), work));
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(follower);
      expect(Exit.isFailure(yield* Fiber.await(follower))).toBe(true);
      const pending = yield* Effect.sync(() => leader.pollUnsafe());
      yield* Deferred.succeed(release, undefined);
      expect(pending).toBeUndefined();
      expect(yield* Fiber.join(leader)).toBe("complete"); expect(calls).toBe(1);
    })));
  });

  it("shares the complete failed leader Cause without executing a follower body", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const owner = { close: Effect.void }, entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      const refused = commerceError("receiptMismatch"), defect = new Error("native defect");
      const complete = Cause.combine(Cause.fail(refused), Cause.die(defect));
      const work = Effect.gen(function* () { yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release);
        return yield* Effect.failCause(complete); });
      const leader = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), work));
      yield* Deferred.await(entered);
      const follower = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), Effect.die("follower must not run")));
      yield* Effect.yieldNow; yield* Deferred.succeed(release, undefined);
      const first = yield* Effect.exit(Fiber.join(leader)), second = yield* Effect.exit(Fiber.join(follower));
      expect(Exit.isFailure(first)).toBe(true); expect(Exit.isFailure(second)).toBe(true);
      if (Exit.isFailure(first) && Exit.isFailure(second)) {
        for (const cause of [first.cause, second.cause]) {
          expect(cause.reasons).toHaveLength(2);
          expect(cause.reasons.flatMap(reason => Cause.isFailReason(reason) ? [reason.error] : [])).toEqual([refused]);
          expect(cause.reasons.flatMap(reason => Cause.isDieReason(reason) ? [reason.defect] : [])).toEqual([defect]);
        }
      }
    })));
  });

  it("keeps followers pending until interrupted leader cleanup has drained", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const owner = { close: Effect.void }, entered = yield* Deferred.make<void>(), draining = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      const leader = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), Effect.acquireUseRelease(Effect.void,
        () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        () => Deferred.succeed(draining, undefined).pipe(Effect.andThen(Deferred.await(release))))));
      yield* Deferred.await(entered);
      const follower = yield* Effect.forkChild(joinAtomicCommerceNativeRequest(owner, identity(), Effect.die("follower must not run")));
      yield* Effect.yieldNow;
      const interrupting = yield* Effect.forkChild(Fiber.interrupt(leader));
      yield* Deferred.await(draining);
      const pending = yield* Effect.sync(() => follower.pollUnsafe());
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(interrupting);
      const first = yield* Fiber.await(leader), second = yield* Fiber.await(follower);
      expect(pending).toBeUndefined();
      expect(Exit.isFailure(first) && Cause.hasInterrupts(first.cause)).toBe(true);
      expect(Exit.isFailure(second) && Cause.hasInterrupts(second.cause)).toBe(true);
      expect(yield* joinAtomicCommerceNativeRequest(owner, identity(), Effect.succeed("explicit-later-call"))).toBe("explicit-later-call");
    })));
  });
});

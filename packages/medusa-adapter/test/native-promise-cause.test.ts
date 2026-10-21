import { promiseFailureObserver } from "./support/promise-failure-observer";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { MedusaError } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeCommercePromiseOwner, type CommercePromiseOwner } from "../src/module/promise-owner";
import { withCommerceService } from "../src/module/service-bridge";
import { commerceRepositoryContext } from "../src/repository/context";
import { checkedCommerceValue } from "../src/value/checked";

const throughBridge = (work: (owner: CommercePromiseOwner, ctx: CommerceCommandContext) => Promise<unknown>) =>
  Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
      commerceLimits, {}, {}, "native-cause-owner", "read"), lifetime => lifetime.close);
    const unused = () => Effect.fail(commerceError("unsupportedProfile"));
    const store: CommerceCommandContext["store"] = { prepareRead: () => ({ find: unused, findPage: unused, count: unused }), findPage: unused,
      aggregate: unused, find: unused, count: unused, write: unused, delete: unused, lifecycle: unused };
    const ctx = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources, table: unused },
      "native-cause-owner", lifetime.context, unused, unused);
    const value = yield* withCommerceService(ctx, owner => owner, owner => work(owner, ctx));
    yield* lifetime.seal;
    return value;
  })));
function reasons<Value>(exit: Exit.Exit<Value, CommerceTransactionError>) {
  if (Exit.isSuccess(exit)) throw new Error("Expected a failed owner outcome");
  return exit.cause.reasons;
}

describe("native Promise complete Cause ownership", () => {
  it("keeps native domain error identity, type and message in its typed failure", async () => {
    const original = new MedusaError(MedusaError.Types.INVALID_DATA, "native required currency");
    const cause = reasons(await throughBridge(async () => { throw original; }));
    expect(cause).toHaveLength(1);
    const failure = cause[0];
    if (!failure || !Cause.isFailReason(failure)) throw new Error("Expected domain failure");
    expect(failure.error.reason).toBe("adapterFailure");
    expect(failure.error.cause).toBe(original);
    expect(original.type).toBe(MedusaError.Types.INVALID_DATA);
    expect(original.message).toBe("native required currency");
  });

  it.each([new TypeError("native price dereference"), Cause.fail(commerceError("invalidInput")),
    { _tag: "Cause", reasons: [{ _tag: "Fail", error: commerceError("invalidInput") }] },
    Object.assign(new Error("not cancellation"), { name: "AbortError" })])("keeps unauthenticated foreign rejection as one defect: %s", async original => {
    const cause = reasons(await throughBridge(async () => { throw original; }));
    expect(cause).toHaveLength(1);
    const defect = cause[0];
    if (!defect || !Cause.isDieReason(defect)) throw new Error("Expected foreign defect");
    expect(defect.defect).toBe(original);
  });

  it("keeps a foreign rejection that refuses prototype inspection as the original defect", async () => {
    const original = new Proxy({}, { getPrototypeOf: () => { throw new TypeError("foreign reflection refused"); } });
    const cause = reasons(await throughBridge(async () => { throw original; }));
    expect(cause).toHaveLength(1);
    const reason = cause[0];
    if (!reason || !Cause.isDieReason(reason)) throw new Error("Expected original foreign defect");
    expect(reason.defect).toBe(original);
  });

  it.each([false, true])("restores a compound owned Cause across service/repository transaction, nested=%s", async nested => {
    const original = commerceError("invalidInput"), defect = new TypeError("DAL finalizer defect");
    const cause = reasons(await throughBridge((owner, ctx) => {
      const work = () => owner.run(Effect.fail(original).pipe(Effect.ensuring(Effect.die(defect))));
      return nested ? commerceRepositoryContext(ctx, owner).transaction(work) : work();
    }));
    expect(cause.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
    expect(cause.filter(reason => Cause.isDieReason(reason) && reason.defect === defect)).toHaveLength(1);
    expect(cause).toHaveLength(2);
  });

  it("keeps concurrent annotated Causes distinct when both reuse one error object", async () => {
    const original = commerceError("invalidInput");
    const ReceiptAnnotation = Context.Service<string>("receipt");
    const left = Cause.fromReasons([Cause.makeFailReason(original).annotate(Context.make(ReceiptAnnotation, "left"))]);
    const right = Cause.fromReasons([Cause.makeFailReason(original).annotate(Context.make(ReceiptAnnotation, "right"))]);
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    const results = await Effect.runPromise(owner.withClose(Effect.all([left, right].map(cause =>
      Effect.exit(owner.invoke(() => owner.run(Effect.failCause(cause))))), { concurrency: "unbounded" })));
    expect(results.map(exit => {
      const reason = reasons(exit)[0];
      if (!reason || !Cause.isFailReason(reason)) throw new Error("Expected restored annotated failure");
      expect(reason.error).toBe(original);
      return reason.annotations.get("receipt");
    })).toEqual(["left", "right"]);
  });

  it("does not trust another owner's compound transport identity", async () => {
    const foreign = await Effect.runPromise(makeCommercePromiseOwner());
    let receipt: unknown;
    try { await foreign.run(Effect.fail(commerceError("invalidInput")).pipe(Effect.ensuring(Effect.die("foreign finalizer")))); }
    catch (error) { receipt = error; }
    finally { await Effect.runPromise(foreign.close); }
    const cause = reasons(await throughBridge(async () => { throw receipt; }));
    expect(cause).toHaveLength(1);
    const defect = cause[0];
    if (!defect || !Cause.isDieReason(defect)) throw new Error("Expected foreign receipt defect");
    expect(defect.defect).toBe(receipt);
  });

  it("latches before a caught rejection and revokes subsequent escaped work", async () => {
    const original = commerceError("invalidInput");
    let lateStarts = 0;
    const cause = reasons(await throughBridge(async (owner, ctx) => {
      try { await owner.run(Effect.fail(original)); } catch { /* Native code catches rejection. */ }
      try { await owner.run(ctx.borrow(() => Effect.sync(() => { lateStarts++; return null; }))); } catch { /* Still refuses. */ }
      return null;
    }));
    expect(lateStarts).toBe(0);
    expect(cause.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
  });

  it("retains a cancelled sibling finalizer beside its initiating failure exactly once", async () => {
    const original = commerceError("invalidInput"), defect = new TypeError("cancelled sibling cleanup");
    const exit = await Effect.runPromiseExit(Effect.gen(function* () {
      const owner = yield* makeCommercePromiseOwner();
      const entered = yield* Deferred.make<void>();
      const work = owner.invoke(() => owner.run(Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never), Effect.ensuring(Effect.die(defect)))));
      const failed = Deferred.await(entered).pipe(Effect.andThen(owner.invoke(async () => { throw original; })));
      return yield* owner.withClose(Effect.all([work, failed], { concurrency: "unbounded" }));
    }));
    const cause = reasons(exit);
    expect(cause.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
    expect(cause.filter(reason => Cause.isDieReason(reason) && reason.defect === defect)).toHaveLength(1);
    expect(cause.some(Cause.isInterruptReason)).toBe(true);
  });

  it("retains a cancelled sibling finalizer at seal when a trusted caller catches withClose", async () => {
    const original = commerceError("invalidInput"), defect = new TypeError("caught sibling cleanup");
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
        commerceLimits, {}, {}, "caught-with-close", "read"), lifetime => lifetime.close);
      const owner = yield* makeCommercePromiseOwner(cause => lifetime.recordFailure(lifetime.context, cause));
      const entered = yield* Deferred.make<void>();
      const active = owner.invoke(() => owner.run(Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Effect.never), Effect.ensuring(Effect.die(defect)))));
      const failed = Deferred.await(entered).pipe(Effect.andThen(owner.invoke(() => Promise.reject(original))));
      const observed = yield* Effect.exit(owner.withClose(Effect.all([active, failed], { concurrency: "unbounded" })));
      const complete = reasons(observed);
      expect(complete.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
      expect(complete.filter(reason => Cause.isDieReason(reason) && reason.defect === defect)).toHaveLength(1);
      const sealed = reasons(yield* Effect.exit(lifetime.seal));
      expect(sealed.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
      expect(sealed.filter(reason => Cause.isDieReason(reason) && reason.defect === defect)).toHaveLength(1);
      expect(sealed.some(Cause.isInterruptReason)).toBe(true);
    })));
  });

  it("preserves unobserved work interruption even when native code catches its rejection", async () => {
    const exit = await throughBridge(async owner => {
      try { await owner.run(Effect.interrupt); } catch { /* Native catch does not discharge interruption. */ }
      return null;
    });
    expect(reasons(exit).some(Cause.isInterruptReason)).toBe(true);
  });

  it("does not register a foreign completion after its bounded Promise owner has closed", async () => {
    const recordFailure = promiseFailureObserver();
    const owner = await Effect.runPromise(makeCommercePromiseOwner(recordFailure));
    const started = Deferred.makeUnsafe<void>();
    let rejectLate: ((reason: unknown) => void) | undefined;
    const pending = new Promise<never>((_resolve, reject) => { rejectLate = reject; });
    const fiber = Effect.runFork(owner.invoke(async () => {
      Deferred.doneUnsafe(started, Effect.void);
      return await pending;
    }));
    await Effect.runPromise(Deferred.await(started));
    await Effect.runPromise(Fiber.interrupt(fiber));
    await Effect.runPromise(owner.close);
    if (!rejectLate) throw new Error("Native callback never started");
    rejectLate(new TypeError("late native completion"));
    await pending.catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("keeps a caught decoder defect in the authoritative seal after the whole service outcome is observed", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
        commerceLimits, {}, {}, "checked-native-cause", "read"), lifetime => lifetime.close);
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const store: CommerceCommandContext["store"] = { prepareRead: () => ({ find: unused, findPage: unused, count: unused }), findPage: unused,
        aggregate: unused, find: unused, count: unused, write: unused, delete: unused, lifecycle: unused };
      const ctx = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources, table: unused },
        "checked-native-cause", lifetime.context, unused, unused);
      const original = new TypeError("native selected decoder defect");
      const observed = yield* Effect.exit(withCommerceService(ctx, owner => owner, async owner => {
        try { await owner.run(checkedCommerceValue(ctx, () => { throw original; })); }
        catch { return null; }
      }));
      expect(reasons(observed).filter(reason => Cause.isDieReason(reason) && reason.defect === original)).toHaveLength(1);
      const sealed = yield* Effect.exit(lifetime.seal);
      const retained = reasons(sealed);
      expect(retained.filter(reason => Cause.isDieReason(reason) && reason.defect === original)).toHaveLength(1);
      expect(retained.some(reason => Cause.isFailReason(reason) && reason.error.reason === "adapterFailure")).toBe(false);
    })));
  });

  it("does not create rollback-only state from a foreign or revoked observer", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const left = yield* makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "left", "read");
      const right = yield* makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "right", "read");
      expect(Result.isFailure(left.recordFailure(right.context, Cause.die("foreign")))).toBe(true);
      yield* left.seal;
      yield* right.seal;
      yield* left.close;
      yield* right.close;
      expect(Result.isFailure(left.recordFailure(left.context, Cause.die("late")))).toBe(true);
    }));
  });
});

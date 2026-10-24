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
  it("presents a native error while restoring the original registered failure on re-entry", async () => {
    const original = commerceError("invalidInput");
    const native = new MedusaError(MedusaError.Types.NOT_FOUND, "native relationship missing");
    let presented: unknown;
    const cause = reasons(await throughBridge(async owner => {
      try {
        return await owner.run(Effect.fail(original), failure => {
          expect(failure).toBe(original);
          return native;
        });
      } catch (error) {
        presented = error;
        throw error;
      }
    }));
    expect(presented).toBe(native);
    expect(native.type).toBe(MedusaError.Types.NOT_FOUND);
    expect(cause).toHaveLength(1);
    const reason = cause[0];
    if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Missing original failure");
    expect(reason.error).toBe(original);
  });

  it("retains a caught presentation at cleanup and refuses subsequent borrowed work", async () => {
    const original = commerceError("invalidInput");
    const native = new MedusaError(MedusaError.Types.NOT_FOUND, "native relationship missing");
    let lateStarts = 0;
    const cause = reasons(await throughBridge(async (owner, ctx) => {
      try { await owner.run(Effect.fail(original), () => native); }
      catch (error) { expect(error).toBe(native); }
      try { await owner.run(ctx.borrow(() => Effect.sync(() => { lateStarts++; return null; }))); }
      catch { /* Catching the native view does not rescue this request. */ }
      return null;
    }));
    expect(lateStarts).toBe(0);
    expect(cause.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
    expect(cause.some(reason => Cause.isFailReason(reason) && reason.error.reason === "adapterFailure")).toBe(false);
  });

  it.each(["defect", "interruption", "compound"] as const)("does not project a registered %s Cause", async kind => {
    const original = commerceError("invalidInput"), defect = new TypeError("native finalizer defect");
    let projections = 0;
    const work = kind === "defect" ? Effect.die(defect) : kind === "interruption" ? Effect.interrupt
      : Effect.fail(original).pipe(Effect.ensuring(Effect.die(defect)));
    const cause = reasons(await throughBridge(owner => owner.run(work, () => {
      projections++;
      return new MedusaError(MedusaError.Types.NOT_FOUND, "must not replace Cause");
    })));
    expect(projections).toBe(0);
    if (kind === "interruption") expect(cause.some(Cause.isInterruptReason)).toBe(true);
    else expect(cause.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
    if (kind === "compound") expect(cause.some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
  });

  it("preserves a throwing presenter as a defect beside the original failure", async () => {
    const original = commerceError("invalidInput"), defect = new TypeError("native formatter defect");
    const cause = reasons(await throughBridge(owner => owner.run(Effect.fail(original), () => { throw defect; })));
    expect(cause.filter(reason => Cause.isFailReason(reason) && reason.error === original)).toHaveLength(1);
    expect(cause.filter(reason => Cause.isDieReason(reason) && reason.defect === defect)).toHaveLength(1);
    expect(cause).toHaveLength(2);
  });

  it("does not hide a revoked observer refusal behind a native presentation", async () => {
    const lifetime = await Effect.runPromise(makeBoundedRequestLifetime(commerceError,
      commerceLimits, {}, {}, "native-projection-closed", "read"));
    const owner = await Effect.runPromise(makeCommercePromiseOwner(cause => lifetime.recordFailure(lifetime.context, cause)));
    await Effect.runPromise(lifetime.close);
    const original = commerceError("invalidInput");
    let projections = 0;
    const cause = reasons(await Effect.runPromiseExit(owner.withClose(owner.invoke(() => owner.run(Effect.fail(original), () => {
      projections++;
      return new MedusaError(MedusaError.Types.NOT_FOUND, "must not hide observer refusal");
    })))));
    expect(projections).toBe(0);
    expect(cause.some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
    expect(cause.some(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidAuthority")).toBe(true);
  });

  it.each([MedusaError.Types.NOT_FOUND, MedusaError.Types.INVALID_DATA])("presents a preflush native %s failure through a repository transaction", async type => {
    const original = new MedusaError(type, "native relationship validation");
    let presented: unknown;
    let flushes = 0;
    const cause = reasons(await throughBridge(async (owner, ctx) => {
      const repository = commerceRepositoryContext(ctx, owner, {
        flush: () => Effect.sync(() => { flushes++; }),
        presentExpectedFailure: () => undefined,
      });
      try { return await repository.transaction(async () => { throw original; }); }
      catch (error) { presented = error; throw error; }
    }));
    expect(presented).toBe(original);
    expect(flushes).toBe(0);
    expect(cause).toHaveLength(1);
    const failure = cause[0];
    if (!failure || !Cause.isFailReason(failure)) throw new Error("Expected classified native failure");
    expect(failure.error.reason).toBe("adapterFailure");
    expect(failure.error.cause).toBe(original);
  });

  it("presents a native failure without a method-specific presenter", async () => {
    const original = new MedusaError(MedusaError.Types.NOT_FOUND, "another native method");
    let presented: unknown;
    const cause = reasons(await throughBridge(async (owner, ctx) => {
      try { return await commerceRepositoryContext(ctx, owner).transaction(async () => { throw original; }); }
      catch (error) { presented = error; throw error; }
    }));
    expect(presented).toBe(original);
    expect(cause).toHaveLength(1);
    const failure = cause[0];
    if (!failure || !Cause.isFailReason(failure)) throw new Error("Expected classified native failure");
    expect(failure.error.reason).toBe("adapterFailure");
    expect(failure.error.cause).toBe(original);
  });

  it("keeps an explicit trusted presentation ahead of the classified native view", async () => {
    const original = new MedusaError(MedusaError.Types.INVALID_DATA, "native input failure");
    const presentation = new MedusaError(MedusaError.Types.NOT_FOUND, "trusted method presentation");
    let presented: unknown;
    const cause = reasons(await throughBridge(async (owner, ctx) => {
      const repository = commerceRepositoryContext(ctx, owner, { presentExpectedFailure: failure => {
        expect(failure.reason).toBe("adapterFailure");
        expect(failure.cause).toBe(original);
        return presentation;
      } });
      try { return await repository.transaction(async () => { throw original; }); }
      catch (error) { presented = error; throw error; }
    }));
    expect(presented).toBe(presentation);
    expect(cause).toHaveLength(1);
    const failure = cause[0];
    if (!failure || !Cause.isFailReason(failure)) throw new Error("Expected classified native failure");
    expect(failure.error.cause).toBe(original);
  });

  it("retains a caught preflush native failure and refuses subsequent borrowed work", async () => {
    const original = new MedusaError(MedusaError.Types.INVALID_DATA, "native validation before flush");
    let lateStarts = 0;
    const cause = reasons(await throughBridge(async (owner, ctx) => {
      try { await commerceRepositoryContext(ctx, owner).transaction(async () => { throw original; }); }
      catch (error) { expect(error).toBe(original); }
      try { await owner.run(ctx.borrow(() => Effect.sync(() => { lateStarts++; return null; }))); }
      catch { /* A caught native view cannot discharge the registered failure. */ }
      return null;
    }));
    expect(lateStarts).toBe(0);
    expect(cause.filter(reason => Cause.isFailReason(reason) && reason.error.reason === "adapterFailure" && reason.error.cause === original)).toHaveLength(1);
  });

  it("does not unwrap an arbitrary adapter failure carrying a native cause", async () => {
    const native = new MedusaError(MedusaError.Types.INVALID_DATA, "not classified by this owner");
    const original = commerceError("adapterFailure", native);
    let presented: unknown;
    const cause = reasons(await throughBridge(async owner => {
      try { return await owner.run(Effect.fail(original)); }
      catch (error) { presented = error; throw error; }
    }));
    expect(presented).toBe(original);
    expect(cause).toHaveLength(1);
    const failure = cause[0];
    if (!failure || !Cause.isFailReason(failure)) throw new Error("Expected original typed failure");
    expect(failure.error).toBe(original);
  });

  it.each(["defect", "interruption", "refusal"] as const)("does not project a classified native failure beside a %s", async kind => {
    const native = new MedusaError(MedusaError.Types.INVALID_DATA, "native classified failure");
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    const classified = reasons(await Effect.runPromiseExit(owner.invoke(async () => { throw native; })));
    const original = classified[0];
    if (!original || !Cause.isFailReason(original)) throw new Error("Expected classified native failure");
    const defect = new TypeError("native finalizer defect");
    const refusal = commerceError("invalidAuthority");
    const extra = kind === "defect" ? Cause.die(defect) : kind === "interruption" ? Cause.interrupt() : Cause.fail(refusal);
    const complete = Cause.combine(Cause.fromReasons(classified), extra);
    let presented: unknown;
    let projections = 0;
    const cause = reasons(await Effect.runPromiseExit(owner.withClose(owner.invoke(async () => {
      try { return await owner.run(Effect.failCause(complete), () => { projections++; return native; }); }
      catch (error) { presented = error; throw error; }
    }))));
    expect(presented).not.toBe(native);
    expect(projections).toBe(0);
    expect(cause.filter(reason => Cause.isFailReason(reason) && reason.error === original.error)).toHaveLength(1);
    expect(cause).toHaveLength(2);
    if (kind === "defect") expect(cause.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
    if (kind === "interruption") expect(cause.some(Cause.isInterruptReason)).toBe(true);
    if (kind === "refusal") expect(cause.some(reason => Cause.isFailReason(reason) && reason.error === refusal)).toBe(true);
  });

  it("does not hide an observer-added refusal behind a classified native view", async () => {
    const refusal = commerceError("invalidAuthority");
    const owner = await Effect.runPromise(makeCommercePromiseOwner(() => Result.fail(refusal)));
    const native = new MedusaError(MedusaError.Types.INVALID_DATA, "native validation failure");
    let presented: unknown;
    const cause = reasons(await Effect.runPromiseExit(owner.withClose(owner.invoke(async () => {
      try { return await owner.run(owner.invoke(async () => { throw native; })); }
      catch (error) { presented = error; throw error; }
    }))));
    expect(presented).not.toBe(native);
    expect(cause.some(reason => Cause.isFailReason(reason) && reason.error.reason === "adapterFailure" && reason.error.cause === native)).toBe(true);
    expect(cause.some(reason => Cause.isFailReason(reason) && reason.error === refusal)).toBe(true);
  });

  it("keeps concurrent annotated Causes distinct when reusing a classified native presentation", async () => {
    const native = new MedusaError(MedusaError.Types.INVALID_DATA, "shared native presentation");
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    const classified = reasons(await Effect.runPromiseExit(owner.invoke(async () => { throw native; })));
    const original = classified[0];
    if (!original || !Cause.isFailReason(original)) throw new Error("Expected classified native failure");
    const ReceiptAnnotation = Context.Service<string>("native-receipt");
    const causes = ["left", "right"].map(label => Cause.fromReasons([
      Cause.makeFailReason(original.error).annotate(Context.make(ReceiptAnnotation, label)),
    ]));
    const presentations: unknown[] = [];
    const results = await Effect.runPromise(owner.withClose(Effect.all(causes.map(cause =>
      Effect.exit(owner.invoke(async () => {
        try { return await owner.run(Effect.failCause(cause)); }
        catch (error) { presentations.push(error); throw error; }
      }))), { concurrency: "unbounded" })));
    expect(presentations.filter(error => error === native)).toHaveLength(1);
    expect(results.map(exit => {
      const reason = reasons(exit)[0];
      if (!reason || !Cause.isFailReason(reason)) throw new Error("Expected restored native failure");
      expect(reason.error).toBe(original.error);
      expect(reason.error.cause).toBe(native);
      return reason.annotations.get("native-receipt");
    })).toEqual(["left", "right"]);
  });

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

  it.each([false, true])("keeps concurrent annotated Causes distinct when reusing one error, projected=%s", async projected => {
    const original = commerceError("invalidInput");
    const ReceiptAnnotation = Context.Service<string>("receipt");
    const left = Cause.fromReasons([Cause.makeFailReason(original).annotate(Context.make(ReceiptAnnotation, "left"))]);
    const right = Cause.fromReasons([Cause.makeFailReason(original).annotate(Context.make(ReceiptAnnotation, "right"))]);
    const presentation = new MedusaError(MedusaError.Types.NOT_FOUND, "shared presentation identity");
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    const results = await Effect.runPromise(owner.withClose(Effect.all([left, right].map(cause =>
      Effect.exit(owner.invoke(() => owner.run(Effect.failCause(cause), projected ? () => presentation : undefined)))), { concurrency: "unbounded" })));
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

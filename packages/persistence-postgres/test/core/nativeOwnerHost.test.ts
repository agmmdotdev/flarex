import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { CoreTransactionError } from "../../src/core/api";
import type { CoreApplicationOwner } from "../../src/core/applicationOwner";
import { makePreparedHostRuntime } from "../../src/execution/preparation/preparedHostRuntime";
import { defineCommerceCommand, type CommerceHost } from "../../src/frameworks/commerceTransaction/commands";
import { commerceError, CommerceTransactionError } from "../../src/frameworks/commerceTransaction/model";
import { projectCoreCommerceFailure } from "../../src/frameworks/commerceTransaction/nativeFailure";
import { makeNativeOwnerHost } from "../../src/frameworks/commerceTransaction/nativeOwnerHost";

const command = defineCommerceCommand("ownerBridgeProbe", "write", () => Effect.succeed(null));
const project = (failure: Parameters<typeof projectCoreCommerceFailure>[0] | CommerceTransactionError) =>
  failure instanceof CommerceTransactionError ? failure : projectCoreCommerceFailure(failure);

/** Composition ports only: shared owner scenarios prove actual Core recovery. */
function ownerPort(selected: () => CommerceHost, recover: Effect.Effect<void, CoreTransactionError>, onClose: () => void = () => {}) {
  return { recover, close: Effect.sync(onClose),
    use: run => Effect.scoped(Effect.suspend(() => run(selected()))),
    useDatabase: () => Effect.die(new Error("Framework bridge must not borrow raw database")),
  } satisfies CoreApplicationOwner<CommerceHost>;
}
function profile(value: string, onRun: () => void, close: Effect.Effect<void> = Effect.void): CommerceHost {
  return { close, newRequestKey: () => "unused", initialize: () => Effect.succeed(null),
    read: () => Effect.succeed(value), run: () => Effect.sync(() => { onRun(); return value; }) };
}

describe("native host borrowing a shared app owner", () => {
  it("selects the current profile once and preserves a typed callback refusal without replay", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    let firstCalls = 0, secondCalls = 0, selections = 0, recoveries = 0;
    const refusal = commerceError("invalidInput", { original: "native refusal" });
    let current: CommerceHost = { ...profile("first", () => {}), run: () => Effect.sync(() => { firstCalls++; }).pipe(Effect.andThen(Effect.fail(refusal))) };
    const owner = ownerPort(() => current, Effect.sync(() => { recoveries++; }));
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 2, maximumPreparedBytes: 1024 });
    const host = yield* makeNativeOwnerHost({ owner, hostRuntime: runtime,
      select: selected => Effect.sync(() => { selections++; return selected; }), projectOwnerFailure: project });
    const failed = yield* Effect.exit(host.run(host.newRequestKey(), command, null));
    expect(Exit.isFailure(failed) && Cause.squash(failed.cause)).toBe(refusal);
    expect(firstCalls).toBe(1);
    current = profile("second", () => { secondCalls++; });
    expect(yield* host.run(host.newRequestKey(), command, null)).toBe("second");
    expect({ firstCalls, secondCalls, selections, recoveries }).toEqual({ firstCalls: 1, secondCalls: 1, selections: 2, recoveries: 2 });
    yield* host.close;
  }))));

  it("drains only its own active borrow and closes while shared admission is unavailable", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), closeStarted = yield* Deferred.make<void>();
    let unavailable = false, appClosed = 0, selectedClosed = 0, unrelatedClosed = 0, closeDone = false, recoveries = 0;
    const selected: CommerceHost = { ...profile("selected", () => {}, Effect.sync(() => { selectedClosed++; })),
      run: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)), Effect.as("completed")) };
    const unrelated = profile("unrelated", () => {}, Effect.sync(() => { unrelatedClosed++; }));
    const owner = ownerPort(() => selected, Effect.suspend(() => {
      recoveries++;
      return unavailable ? Effect.fail(new CoreTransactionError({ reason: "unavailable" })) : Effect.void;
    }), () => { appClosed++; });
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 2, maximumPreparedBytes: 1024 });
    const host = yield* makeNativeOwnerHost({ owner, hostRuntime: runtime, select: Effect.succeed, projectOwnerFailure: project });
    const request = yield* Effect.forkChild(host.run(host.newRequestKey(), command, null));
    yield* Deferred.await(entered);
    unavailable = true;
    const closing = yield* Effect.forkChild(Deferred.succeed(closeStarted, undefined).pipe(Effect.andThen(host.close),
      Effect.tap(() => Effect.sync(() => { closeDone = true; }))));
    yield* Deferred.await(closeStarted);
    yield* Effect.yieldNow;
    expect(closeDone).toBe(false);
    expect(yield* Effect.result(host.read(command, null))).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    expect(recoveries).toBe(1);
    yield* Deferred.succeed(release, undefined);
    expect(yield* Fiber.join(request)).toBe("completed");
    yield* Fiber.join(closing);
    expect({ selectedClosed, appClosed, unrelatedClosed }).toEqual({ selectedClosed: 1, appClosed: 0, unrelatedClosed: 0 });
    expect(yield* unrelated.read(command, null)).toBe("unrelated");
    yield* host.close;
    expect(selectedClosed).toBe(1);
  }))));

  it("projects the typed owner failure once while retaining its defect and interruption", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const original = new CoreTransactionError({ reason: "unavailable" }), defect = new Error("owner defect");
    const cause = Cause.combine(Cause.combine(Cause.fail(original), Cause.die(defect)), Cause.interrupt(712));
    let callbacks = 0, projected = 0;
    const owner = ownerPort(() => profile("unexpected", () => { callbacks++; }), Effect.failCause(cause));
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1024 });
    const host = yield* makeNativeOwnerHost({ owner, hostRuntime: runtime, select: Effect.succeed,
      projectOwnerFailure: failure => { projected++; return project(failure); } });
    const result = yield* Effect.exit(host.run(host.newRequestKey(), command, null));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Owner failure escaped"));
    expect(result.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toMatchObject([{ reason: "resourceFailure", cause: original }]);
    expect(result.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toContain(defect);
    expect(Cause.hasInterrupts(result.cause)).toBe(true);
    expect({ callbacks, projected }).toEqual({ callbacks: 0, projected: 1 });
    yield* host.close;
  }))));

  it("retains one failed profile close for concurrent and later callers", () => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
    const original = new Error("selected native host cleanup failed");
    const failure = Cause.combine(Cause.die(original), Cause.interrupt(481));
    let closes = 0;
    const selected = profile("selected", () => {}, Effect.gen(function* () {
      closes++;
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
      return yield* Effect.failCause(failure);
    }));
    const owner = ownerPort(() => selected, Effect.void);
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1024 });
    const host = yield* makeNativeOwnerHost({ owner, hostRuntime: runtime, select: Effect.succeed, projectOwnerFailure: project });
    yield* host.read(command, null);
    const first = yield* Effect.forkChild(Effect.exit(host.close));
    yield* Deferred.await(entered);
    const concurrent = yield* Effect.forkChild(Effect.exit(host.close));
    yield* Deferred.succeed(release, undefined);
    const results = [yield* Fiber.join(first), yield* Fiber.join(concurrent), yield* Effect.exit(host.close)];
    for (const result of results) {
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Failed cleanup became a successful close"));
      expect(result.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([original]);
      expect(Cause.hasInterrupts(result.cause)).toBe(true);
      expect(result.cause).toEqual(failure);
    }
    expect(closes).toBe(1);
    expect(yield* Effect.result(host.read(command, null))).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
  }))));
});

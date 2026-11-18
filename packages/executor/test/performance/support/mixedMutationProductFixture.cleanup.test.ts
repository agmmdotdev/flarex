import { Cause, Effect, Exit, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { closeMixedMutationFixture, closeMixedMutationPayloadScopes } from "./mixedMutationProductFixture";

describe("mixed fixture shutdown ownership", () => {
  it("attempts every release in owner order and retains each original failure", async () => {
    const released: string[] = [];
    const signalFailure = new Error("signal failed");
    const joinFailure = new Error("initial continuation failed");
    const syscallFailure = new Error("syscall scope failed");
    const payloadFailure = new Error("payload scopes failed");
    const observerFailure = new Error("observer detach failed");
    const poolFailure = new Error("managed control pool failed");
    const release = (name: string, failure?: Error) => async () => {
      released.push(name);
      if (failure !== undefined) throw failure;
    };
    const resources = [release("setup pool"), release("managed control pool", poolFailure), release("target pool")];
    const before = [...resources];
    const failure = await closeMixedMutationFixture({
      signalInitial: release("signal", signalFailure), joinInitial: release("join", joinFailure),
      closeSyscallScope: release("syscall", syscallFailure), closePayloadScopes: release("payload", payloadFailure),
      ownsContext: true, context: { resources, detachSqlObserver: () => {
        released.push("observer"); throw observerFailure;
      } },
    }).then(() => { throw new Error("Expected aggregated fixture shutdown failure"); }, (cause: unknown) => cause);
    if (!(failure instanceof AggregateError)) throw new Error("Expected complete cleanup failure aggregate");
    expect(failure.errors).toEqual([signalFailure, joinFailure, syscallFailure, payloadFailure, observerFailure, poolFailure]);
    for (const [index, original] of [signalFailure, joinFailure, syscallFailure, payloadFailure, observerFailure, poolFailure].entries())
      expect(failure.errors[index]).toBe(original);
    expect(released).toEqual(["signal", "join", "syscall", "payload", "observer", "target pool", "managed control pool", "setup pool"]);
    expect(resources).toEqual(before);
  });

  it("drains the borrowed attempt and its scopes while leaving the shared context owned by its parent", async () => {
    const released: string[] = [];
    const release = (name: string) => async () => { released.push(name); };
    await closeMixedMutationFixture({ signalInitial: release("signal"), joinInitial: release("join"),
      closeSyscallScope: release("syscall"), closePayloadScopes: release("payload"), ownsContext: false,
      context: { detachSqlObserver: () => { released.push("observer"); }, resources: [release("shared pool")] },
    });
    expect(released).toEqual(["signal", "join", "syscall", "payload"]);
  });

  it("closes every actual payload scope and retains full defects and interruption Causes", async () => {
    const released: string[] = [];
    const firstDefect = new Error("first finalizer failed");
    const lastDefect = new Error("last finalizer failed");
    const firstCause = Cause.combine(Cause.die(firstDefect), Cause.interrupt(123));
    const scopes = await Effect.runPromise(Effect.gen(function* () {
      const first = yield* Scope.make();
      const middle = yield* Scope.make();
      const last = yield* Scope.make();
      yield* Scope.addFinalizer(first, Effect.sync(() => { released.push("first"); }).pipe(Effect.andThen(Effect.failCause(firstCause))));
      yield* Scope.addFinalizer(middle, Effect.sync(() => { released.push("middle"); }));
      yield* Scope.addFinalizer(last, Effect.sync(() => { released.push("last"); }).pipe(Effect.andThen(Effect.die(lastDefect))));
      return new Set([first, middle, last]);
    }));
    const exit = await Effect.runPromiseExit(closeMixedMutationPayloadScopes(scopes));
    if (Exit.isSuccess(exit)) throw new Error("Expected retained finalizer Causes");
    expect(released).toEqual(["first", "middle", "last"]);
    expect(scopes.size).toBe(0);
    expect(exit.cause.reasons.map(reason => reason._tag)).toEqual(["Die", "Interrupt", "Die"]);
    const defects = exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect);
    expect(defects[0]).toBe(firstDefect);
    expect(defects[1]).toBe(lastDefect);
    await Effect.runPromise(closeMixedMutationPayloadScopes(scopes));
    expect(released).toHaveLength(3);
  });
});

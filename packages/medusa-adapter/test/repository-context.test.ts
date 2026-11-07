import { Cause, Context, Effect, Exit, Result, type Scope } from "effect";
import { describe, expect, it } from "vitest";
import { commerceError, defaultCommerceResources, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeBoundedRequestLifetime, type BoundedRequestContext } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext, withCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { commerceRepositoryContext } from "../src/repository/context";

const Annotation = Context.Service<string>("RepositoryContextTest/Annotation");
const originKey = "Flarex/BoundedRequestFailureOrigin";
const failure = <Value>(exit: Exit.Exit<Value, CommerceTransactionError>) => {
  if (Exit.isSuccess(exit)) throw new Error("Expected a failed repository completion");
  return exit.cause;
};
const errors = (cause: Cause.Cause<CommerceTransactionError>) => cause.reasons.filter(Cause.isFailReason).map(reason => reason.error);
const origin = (reason: Cause.Reason<CommerceTransactionError>) => reason.annotations.get(originKey);
const run = <Value, Failure>(work: Effect.Effect<Value, Failure, Scope.Scope>) => Effect.runPromise(Effect.scoped(work));

/** Match the existing Commerce finalization tests: no store operation belongs to
 * failure observation. Unexpected storage access fails at that unused boundary;
 * contexts, borrowing, budgets, origins and the latch are production factories. */
const fixture = Effect.fn("RepositoryContextTest.fixture")(function* () {
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
    { calls: 16, commandBytes: 100, commandMs: 10_000 }, {}, {}, "request", "write"), lifetime => lifetime.close);
  let storageCalls = 0;
  const unused = () => Effect.suspend(() => {
    storageCalls++;
    return Effect.die(new Error("Repository failure observation attempted storage"));
  });
  const store: CommerceCommandContext["store"] = {
    prepareRead: () => ({ find: unused, findPage: unused, count: unused }),
    aggregate: unused, find: unused, findPage: unused, count: unused, write: unused, delete: unused, lifecycle: unused,
  };
  const working = { store, resources: defaultCommerceResources, table: unused };
  const context = (manager: BoundedRequestContext) => makeCommerceCommandContext(lifetime,
    working, "request", manager, unused, unused);
  const root = context(lifetime.context);
  const owner = yield* Effect.acquireRelease(makeCommercePromiseOwner(root.recordFailure), owner => owner.close);
  const queued = <Value>(work: (ctx: CommerceCommandContext) => Effect.Effect<Value, CommerceTransactionError>) =>
    withCommerceCommandContext(lifetime, working, "request", lifetime.context, unused, unused, 16, work);
  return { lifetime, root, owner, bridge: commerceRepositoryContext(root, owner), context, queued, storageCalls: () => storageCalls };
});

describe("repository checked completion over an authentic Commerce lifetime", () => {
  it("preserves successful values and Effect requirements without changing the lifetime", () => run(Effect.gen(function* () {
    const test = yield* fixture();
    const work = test.bridge.checked(test.root, Effect.map(Annotation, marker => ({ marker })));
    expect(yield* work.pipe(Effect.provideService(Annotation, "required-service"))).toEqual({ marker: "required-service" });
    expect(test.lifetime.usedCalls()).toBe(1);
    expect(test.lifetime.remainingBytes()).toBe(100);
    expect(test.storageCalls()).toBe(0);
    yield* test.lifetime.seal;
    expect(test.lifetime.isClosing()).toBe(true);
  })));

  it("rethrows an already-latched failure with its original origin and no operation, admission or resource charge", () => {
    const observed: string[] = [];
    return run(Effect.gen(function* () {
      const test = yield* fixture();
      Result.getOrThrow(test.lifetime.charge(7));
      const original = commerceError("statementFailure", { code: "57014" });
      const first = failure(yield* Effect.exit(test.lifetime.operation(test.root.manager, "request", "read", Effect.fail(original))));
      expect(first.reasons).toHaveLength(1);
      const firstReason = first.reasons[0];
      if (firstReason === undefined) throw new Error("Missing originating reason");
      const token = origin(firstReason);
      expect(token).toBeTypeOf("object");
      const calls = test.lifetime.usedCalls(), bytes = test.lifetime.remainingBytes();
      observed.length = 0;
      const propagated = failure(yield* Effect.exit(test.bridge.checked(test.root, Effect.failCause(first))));
      expect(propagated.reasons).toHaveLength(1);
      expect(errors(propagated)).toEqual([original]);
      expect(errors(propagated)[0]).toBe(original);
      expect(propagated.reasons.map(origin)).toEqual([token]);
      expect(test.lifetime.usedCalls()).toBe(calls);
      expect(test.lifetime.remainingBytes()).toBe(bytes);
      expect(observed).toEqual([]);
      expect(test.storageCalls()).toBe(0);
      const sealed = failure(yield* Effect.exit(test.lifetime.seal));
      expect(sealed.reasons).toHaveLength(2);
      expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "statementFailure"]);
      expect(sealed.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === original).map(origin)).toEqual([token]);
    }).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { observed.push(name); }).pipe(Effect.andThen(work)),
    })));
  });

  it("keeps fresh pre-database validation sticky through the genuine native Promise owner", () => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("invalidInput", { field: "native-input" });
    const calls = test.lifetime.usedCalls(), bytes = test.lifetime.remainingBytes();
    const completed = failure(yield* Effect.exit(test.owner.invoke(() => test.bridge.execute({ manager: test.root.manager }, ctx =>
      test.bridge.checked(ctx, Effect.fromResult(Result.fail(original)))))));
    expect(completed.reasons).toHaveLength(1);
    expect(errors(completed)).toEqual([original]);
    expect(errors(completed)[0]).toBe(original);
    expect(test.lifetime.usedCalls()).toBe(calls);
    expect(test.lifetime.remainingBytes()).toBe(bytes);
    expect(test.storageCalls()).toBe(0);
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(2);
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "invalidInput"]);
    expect(errors(sealed)[1]).toBe(original);
  })));

  it("retains typed failure, defect, interruption and annotations through repository propagation and seal", () => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("invalidInput"), defect = new TypeError("native validation defect");
    const mixed = Cause.annotate(Cause.combine(Cause.combine(Cause.fail(original), Cause.die(defect)), Cause.interrupt(712)),
      Context.make(Annotation, "complete-native-cause"));
    const first = failure(yield* Effect.exit(test.lifetime.operation(test.root.manager, "request", "write", Effect.failCause(mixed))));
    const propagated = failure(yield* Effect.exit(test.bridge.checked(test.root, Effect.failCause(first))));
    expect(propagated.reasons).toHaveLength(3);
    expect(errors(propagated)).toEqual([original]);
    expect(propagated.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(propagated.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId)).toEqual([712]);
    expect(propagated.reasons.map(origin)).toEqual(first.reasons.map(origin));
    for (const reason of propagated.reasons) expect(reason.annotations.get(Annotation.key)).toBe("complete-native-cause");
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(4);
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "invalidInput"]);
    expect(sealed.reasons.filter(reason => !Cause.isFailReason(reason) || reason.error === original).map(origin))
      .toEqual(propagated.reasons.map(origin));
    for (const reason of sealed.reasons.filter(reason => !Cause.isFailReason(reason) || reason.error === original))
      expect(reason.annotations.get(Annotation.key)).toBe("complete-native-cause");
  })));

  it("recognizes repeated propagation of one owned origin and retains later diagnostic annotations", () => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("invalidInput");
    let completed = failure(yield* Effect.exit(test.bridge.checked(test.root, Effect.fail(original))));
    const token = completed.reasons.map(origin);
    expect(token).toHaveLength(1);
    for (let index = 0; index < 3; index++) {
      const annotated = Cause.annotate(completed, Context.make(Annotation, "later-native-frame"));
      completed = failure(yield* Effect.exit(test.bridge.checked(test.root, Effect.failCause(annotated))));
      expect(completed.reasons).toHaveLength(1);
      expect(errors(completed)).toEqual([original]);
      expect(completed.reasons.map(origin)).toEqual(token);
      expect(completed.reasons[0]?.annotations.get(Annotation.key)).toBe("later-native-frame");
    }
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(2);
    expect(sealed.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === original).map(origin)).toEqual(token);
    expect(sealed.reasons.find(reason => Cause.isFailReason(reason) && reason.error === original)?.annotations.get(Annotation.key)).toBe("later-native-frame");
  })));

  it("retains independent occurrences even when they reuse the same Error object or refusal code", () => run(Effect.gen(function* () {
    const test = yield* fixture(), reused = commerceError("invalidInput"), sameCode = commerceError("invalidInput");
    const independent = Cause.fromReasons([Cause.makeFailReason(reused), Cause.makeFailReason(reused), Cause.makeFailReason(sameCode)]);
    const completed = failure(yield* Effect.exit(test.bridge.checked(test.root, Effect.failCause(independent))));
    expect(completed.reasons).toHaveLength(3);
    expect(errors(completed)).toEqual([reused, reused, sameCode]);
    expect(errors(completed)[0]).toBe(errors(completed)[1]);
    expect(errors(completed)[2]).not.toBe(reused);
    const tokens = completed.reasons.map(origin);
    expect(tokens.every(token => token !== undefined)).toBe(true);
    expect(new Set(tokens).size).toBe(3);
    const repeated = failure(yield* Effect.exit(test.bridge.checked(test.root, Effect.failCause(completed))));
    expect(repeated.reasons).toHaveLength(3);
    expect(repeated.reasons.map(origin)).toEqual(tokens);
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(4);
    expect(sealed.reasons.filter(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidInput").map(origin)).toEqual(tokens);
  })));

  it("observes a live borrowed Commerce context without adding another operation", () => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("unsupportedProfile");
    let childCalls = 0, childBytes = 0;
    const completed = failure(yield* Effect.exit(test.root.borrow(child => Effect.gen(function* () {
      expect(child.manager).not.toBe(test.root.manager);
      childCalls = test.lifetime.usedCalls(); childBytes = test.lifetime.remainingBytes();
      return yield* test.bridge.checked(child, Effect.fail(original)).pipe(Effect.onExit(() => Effect.sync(() => {
        expect(test.lifetime.usedCalls()).toBe(childCalls);
        expect(test.lifetime.remainingBytes()).toBe(childBytes);
      })));
    }))));
    expect(completed.reasons).toHaveLength(1);
    expect(errors(completed)).toEqual([original]);
    expect(childCalls).toBe(2);
    expect(childBytes).toBe(100);
    expect(test.storageCalls()).toBe(0);
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "unsupportedProfile"]);
  })));

  it.each(["foreign", "revoked", "closing", "closed"] as const)("combines %s observation refusal with the original Cause without poisoning another lifetime", mode => run(Effect.gen(function* () {
    const left = yield* fixture(), right = yield* fixture();
    let context = left.root;
    if (mode === "foreign") context = left.context(right.root.manager);
    else if (mode === "revoked") context = yield* left.root.borrow(child => Effect.succeed(child));
    else {
      yield* left.lifetime.seal;
      expect(left.lifetime.isClosing()).toBe(true);
      if (mode === "closed") yield* left.lifetime.close;
    }
    const original = commerceError("invalidInput"), defect = new Error("original foreign completion");
    const originalCause = Cause.annotate(Cause.combine(Cause.fail(original), Cause.die(defect)), Context.make(Annotation, "original"));
    const leftCalls = left.lifetime.usedCalls(), leftBytes = left.lifetime.remainingBytes();
    const rightCalls = right.lifetime.usedCalls(), rightBytes = right.lifetime.remainingBytes();
    const refused = failure(yield* Effect.exit(left.bridge.checked(context, Effect.failCause(originalCause))));
    expect(refused.reasons).toHaveLength(3);
    expect(errors(refused).map(error => error.reason)).toEqual(["invalidInput", mode === "closing" ? "closed" : "invalidAuthority"]);
    expect(errors(refused)[0]).toBe(original);
    expect(errors(refused)[1]?.cause).toBeUndefined();
    expect(refused.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    for (const reason of refused.reasons.filter(reason => !Cause.isFailReason(reason) || reason.error === original))
      expect(reason.annotations.get(Annotation.key)).toBe("original");
    expect(left.lifetime.usedCalls()).toBe(leftCalls);
    expect(left.lifetime.remainingBytes()).toBe(leftBytes);
    expect(right.lifetime.usedCalls()).toBe(rightCalls);
    expect(right.lifetime.remainingBytes()).toBe(rightBytes);
    if (mode === "foreign" || mode === "revoked") yield* left.lifetime.seal;
    if (mode !== "closed") expect(left.lifetime.isClosing()).toBe(true);
    yield* right.lifetime.seal;
    expect(right.lifetime.isClosing()).toBe(true);
    expect(left.storageCalls()).toBe(0);
    expect(right.storageCalls()).toBe(0);
  })));

  it("still rejects a genuine subsequent operation after a checked failure was caught", () => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("invalidInput");
    const first = failure(yield* Effect.exit(test.bridge.checked(test.root, Effect.fail(original))));
    let entered = false;
    const later = failure(yield* Effect.exit(test.lifetime.operation(test.root.manager, "request", "write", Effect.sync(() => { entered = true; }))));
    expect(entered).toBe(false);
    expect(later.reasons).toHaveLength(1);
    expect(errors(later).map(error => error.reason)).toEqual(["rollbackOnly"]);
    expect(errors(later)[0]?.cause).toEqual(first);
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(2);
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "invalidInput"]);
    expect(errors(sealed)[1]).toBe(original);
    expect(test.storageCalls()).toBe(0);
  })));

  it.each(["execute", "executeInput", "queued", "borrowed"] as const)(
    "presents an expected %s rejection while restoring its identical owned Cause", route => run(Effect.gen(function* () {
      const test = yield* fixture(), original = commerceError("invalidInput", { field: "declared-reference" });
      const presentedError = new Error("Native relationship does not exist");
      const annotated = Cause.annotate(Cause.fail(original), Context.make(Annotation, "configured-native-presentation"));
      let presented: unknown, formatted = 0, owned: Cause.Cause<CommerceTransactionError> | undefined;
      const invoke = (ctx: CommerceCommandContext) => {
        const bridge = commerceRepositoryContext(ctx, test.owner, { presentExpectedFailure: error => {
          formatted++;
          return error === original ? presentedError : undefined;
        } });
        const work = (selected: CommerceCommandContext) => bridge.checked(selected, Effect.failCause(annotated))
          .pipe(Effect.onExit(exit => Effect.sync(() => { if (Exit.isFailure(exit)) owned = exit.cause; })));
        return test.owner.invoke(async () => {
          try {
            return await (route === "execute" ? bridge.execute({ transactionManager: ctx.manager }, work)
              : bridge.executeInput({ transactionManager: ctx.manager }, null, (selected, captured) => {
                expect(captured).toBeNull();
                return work(selected);
              }));
          } catch (error) { presented = error; throw error; }
        });
      };
      const completed = failure(yield* Effect.exit(route === "queued" ? test.queued(invoke)
        : route === "borrowed" ? test.root.borrow(invoke) : invoke(test.root)));
      expect(presented).toBe(presentedError);
      expect(formatted).toBe(1);
      if (owned === undefined) throw new Error("Expected the genuine repository failure observation");
      expect(owned.reasons).toHaveLength(1);
      expect(completed.reasons).toHaveLength(1);
      expect(errors(completed)).toEqual([original]);
      expect(errors(completed)[0]).toBe(original);
      expect(completed.reasons.map(origin)).toEqual(owned.reasons.map(origin));
      expect(completed.reasons.every(reason => origin(reason) !== undefined)).toBe(true);
      expect(completed.reasons[0]?.annotations.get(Annotation.key)).toBe("configured-native-presentation");
      expect(test.lifetime.usedCalls()).toBe(route === "borrowed" ? 2 : 1);
      expect(test.lifetime.remainingBytes()).toBe(route === "queued" ? 96 : 100);
      expect(test.storageCalls()).toBe(0);
      let entered = false;
      const later = failure(yield* Effect.exit(test.lifetime.operation(test.root.manager, "request", "write",
        Effect.sync(() => { entered = true; }))));
      expect(entered).toBe(false);
      expect(errors(later).map(error => error.reason)).toEqual(["rollbackOnly"]);
      const sealed = failure(yield* Effect.exit(test.lifetime.seal));
      expect(sealed.reasons).toHaveLength(2);
      expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "invalidInput"]);
      expect(errors(sealed)[1]).toBe(original);
      expect(sealed.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === original).map(origin))
        .toEqual(owned.reasons.map(origin));
      expect(test.storageCalls()).toBe(0);
    })),
  );

  it("keeps a caught presented rejection sticky even when the native callback returns success", () => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("invalidInput");
    const presentedError = new Error("Native expected failure");
    const bridge = commerceRepositoryContext(test.root, test.owner, {
      presentExpectedFailure: error => error === original ? presentedError : undefined,
    });
    let caught: unknown;
    const returned = yield* test.owner.invoke(async () => {
      try { await bridge.executeInput({ manager: test.root.manager }, null, ctx => bridge.checked(ctx, Effect.fail(original))); }
      catch (error) { caught = error; }
      return "native callback continued";
    });
    expect(returned).toBe("native callback continued");
    expect(caught).toBe(presentedError);
    const completed = failure(yield* Effect.exit(test.owner.withClose(Effect.succeed("outer callback continued"))));
    expect(completed.reasons).toHaveLength(1);
    expect(errors(completed)[0]).toBe(original);
    expect(test.owner.hasPending()).toBe(false);
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(2);
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "invalidInput"]);
    expect(errors(sealed)[1]).toBe(original);
    expect(sealed.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === original).map(origin))
      .toEqual(completed.reasons.map(origin));
    expect(test.lifetime.usedCalls()).toBe(1);
    expect(test.lifetime.remainingBytes()).toBe(100);
    expect(test.storageCalls()).toBe(0);
  })));

  it.each(["execute", "executeInput"] as const)("does not present a mixed %s Cause or lose its originating reasons", method => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("invalidInput"), defect = new TypeError("independent native defect");
    const mixed = Cause.annotate(Cause.combine(Cause.combine(Cause.fail(original), Cause.die(defect)), Cause.interrupt(713)),
      Context.make(Annotation, "mixed-presentation-boundary"));
    let formatted = 0, owned: Cause.Cause<CommerceTransactionError> | undefined;
    const bridge = commerceRepositoryContext(test.root, test.owner, { presentExpectedFailure: () => {
      formatted++; return new Error("Must not present a mixed Cause");
    } });
    const work = (ctx: CommerceCommandContext) => bridge.checked(ctx, Effect.failCause(mixed))
      .pipe(Effect.onExit(exit => Effect.sync(() => { if (Exit.isFailure(exit)) owned = exit.cause; })));
    const completed = failure(yield* Effect.exit(test.owner.invoke(() => method === "execute"
      ? bridge.execute({ manager: test.root.manager }, work)
      : bridge.executeInput({ manager: test.root.manager }, null, ctx => work(ctx)))));
    expect(formatted).toBe(0);
    if (owned === undefined) throw new Error("Expected the genuine mixed failure observation");
    expect(completed.reasons).toHaveLength(3);
    expect(errors(completed)).toEqual([original]);
    expect(errors(completed)[0]).toBe(original);
    expect(completed.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(completed.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId)).toEqual([713]);
    expect(completed.reasons.map(origin)).toEqual(owned.reasons.map(origin));
    for (const reason of completed.reasons) expect(reason.annotations.get(Annotation.key)).toBe("mixed-presentation-boundary");
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(4);
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "invalidInput"]);
    expect(sealed.reasons.filter(reason => !Cause.isFailReason(reason) || reason.error === original).map(origin))
      .toEqual(owned.reasons.map(origin));
    expect(test.lifetime.usedCalls()).toBe(1);
    expect(test.lifetime.remainingBytes()).toBe(100);
    expect(test.storageCalls()).toBe(0);
  })));

  it("retains an unmatched expected failure when its configured presenter returns undefined", () => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("invalidInput");
    let formatted = 0, presented: unknown;
    const bridge = commerceRepositoryContext(test.root, test.owner, { presentExpectedFailure: () => { formatted++; return undefined; } });
    const completed = failure(yield* Effect.exit(test.owner.invoke(async () => {
      try { return await bridge.execute({ manager: test.root.manager }, ctx => bridge.checked(ctx, Effect.fail(original))); }
      catch (error) { presented = error; throw error; }
    })));
    expect(formatted).toBe(1);
    expect(presented).toBe(original);
    expect(completed.reasons).toHaveLength(1);
    expect(errors(completed)[0]).toBe(original);
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "invalidInput"]);
    expect(sealed.reasons).toHaveLength(2);
    expect(test.lifetime.usedCalls()).toBe(1);
    expect(test.lifetime.remainingBytes()).toBe(100);
    expect(test.storageCalls()).toBe(0);
  })));

  it("adds a formatter defect to the original failure without replacing its owned reason", () => run(Effect.gen(function* () {
    const test = yield* fixture(), original = commerceError("invalidInput"), defect = new TypeError("Broken native formatter");
    let formatted = 0, owned: Cause.Cause<CommerceTransactionError> | undefined;
    const bridge = commerceRepositoryContext(test.root, test.owner, { presentExpectedFailure: () => { formatted++; throw defect; } });
    const completed = failure(yield* Effect.exit(test.owner.invoke(() => bridge.executeInput({ manager: test.root.manager }, null,
      ctx => bridge.checked(ctx, Effect.fail(original)).pipe(Effect.onExit(exit => Effect.sync(() => {
        if (Exit.isFailure(exit)) owned = exit.cause;
      })))))));
    expect(formatted).toBe(1);
    if (owned === undefined) throw new Error("Expected the genuine original failure observation");
    expect(completed.reasons).toHaveLength(2);
    expect(errors(completed)).toEqual([original]);
    expect(errors(completed)[0]).toBe(original);
    expect(completed.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(completed.reasons.filter(Cause.isFailReason).map(origin)).toEqual(owned.reasons.map(origin));
    const sealed = failure(yield* Effect.exit(test.lifetime.seal));
    expect(sealed.reasons).toHaveLength(3);
    expect(errors(sealed).map(error => error.reason)).toEqual(["rollbackOnly", "invalidInput"]);
    expect(sealed.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(test.lifetime.usedCalls()).toBe(1);
    expect(test.lifetime.remainingBytes()).toBe(100);
    expect(test.storageCalls()).toBe(0);
  })));
});

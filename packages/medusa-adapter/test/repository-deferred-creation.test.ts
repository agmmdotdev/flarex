import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeCommercePromiseOwner, type CommercePromiseOwner } from "../src/module/promise-owner";
import { withCommerceService } from "../src/module/service-bridge";
import { commerceRepositoryContext } from "../src/repository/context";
import { prepareScalarRepository, type ScalarCreationPlan } from "../src/repository/scalar";
import { scalarIdWhere } from "../src/repository/scalar-id-read";
import { decodeCompiledDml } from "../src/schema/compiled";
import { mockRelationalRead } from "./mock-relational-read";

type CreationStage = NonNullable<Parameters<Result.Result.Success<ReturnType<typeof prepareScalarRepository>>["bind"]>[4]>;
type Accept = Parameters<CreationStage["stage"]>[2];
const unused = () => Effect.fail(commerceError("unsupportedProfile"));
const emptyStore: CommerceCommandContext["store"] = { prepareRead: () => ({ find: unused, findPage: unused, count: unused }),
  findPage: unused, aggregate: unused, find: unused, count: unused, write: unused, delete: unused, lifecycle: unused };

const throughTransaction = (work: (owner: CommercePromiseOwner, root: CommerceCommandContext) => Promise<unknown>) =>
  Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits,
      {}, {}, "repository-deferred-transaction", "write"), current => current.close);
    const root = makeCommerceCommandContext(lifetime, { store: emptyStore, resources: defaultCommerceResources, table: unused },
      "repository-deferred-transaction", lifetime.context, unused, unused);
    const result = yield* withCommerceService(root, owner => owner, owner => work(owner, root));
    yield* lifetime.seal;
    return result;
  })));

function failureReasons<Value>(exit: Exit.Exit<Value, CommerceTransactionError>) {
  if (Exit.isSuccess(exit)) throw new Error("Expected the bounded owner to fail");
  return exit.cause.reasons;
}

const scalarFixture = Effect.fn("DeferredScalar.fixture")(function* (selected: boolean) {
  const table = (yield* decodeCompiledDml({ tables: [{ name: "neutral_deferred", columns: [
    { name: "id", type: "id", nullable: false, primaryKey: true },
    { name: "code", type: "text", nullable: false, primaryKey: false },
    ...["created_at", "updated_at", "deleted_at"].map(name => ({ name, type: "dateTime", nullable: name === "deleted_at", primaryKey: false })),
  ], indexes: [], checks: [], foreignKeys: [], relationships: [], cascades: { delete: [], detach: [] } }] })).tables[0];
  if (table === undefined) return yield* Effect.die(new Error("Missing neutral scalar metadata"));
  const prepared = yield* Effect.fromResult(prepareScalarRepository(table, "NeutralDeferred", scalarIdWhere));
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits,
    {}, {}, "repository-deferred-scalar", "write"), current => current.close);
  const writes: unknown[] = [], eventRows: unknown[] = [], order: string[] = [];
  const stored: JsonObject[] = [{ id: "a", code: "submitted", created_at: "2026-10-24T00:00:00.000Z",
    updated_at: "2026-10-24T00:00:00.000Z", deleted_at: null }];
  // Scripted complete output observes the adapter boundary only. It does not
  // implement defaults, required-field validation or transaction settlement.
  const store = { prepareRead(query: unknown) { return mockRelationalRead(this, query); }, find: unused, findPage: unused,
    count: unused, aggregate: unused, delete: unused, lifecycle: unused,
    write: (_manager: unknown, mode: unknown, rows: unknown) => Effect.sync(() => {
      expect(mode).toBe("insert"); writes.push(structuredClone(rows)); order.push("write"); return structuredClone(stored);
    }) };
  const root = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources, store, table: () => Effect.succeed(store) },
    "repository-deferred-scalar", lifetime.context, unused, unused);
  const owner = yield* Effect.acquireRelease(makeCommercePromiseOwner(root.recordFailure), current => current.close);
  let plan: ScalarCreationPlan | undefined, accept: Accept | undefined;
  const creation: CreationStage = { stage: (ctx, issued, acceptCreated) => Effect.sync(() => {
    expect(ctx).toBe(root); plan = issued; accept = acceptCreated; order.push("stage"); return issued.created;
  }) };
  const bound = prepared.bind(root, owner, undefined, undefined, selected ? creation : undefined);
  const shared = { manager: root.manager };
  bound.events.registerSubscriber(shared, bound.events.createSubscriber(["NeutralDeferred"], {
    interceptEntityMutationEvents: (_event, args) => { order.push("event"); eventRows.push(structuredClone(args.entity)); },
  }));
  return { root, lifetime, owner, bound, shared, writes, eventRows, order, stored, plan: () => plan,
    accept: () => { if (accept === undefined) throw new Error("No issued acceptance callback"); return accept; } };
});

describe("optional repository transaction flush", () => {
  it("awaits the task then flushes on the same live child before returning and revoking", async () => {
    const order: string[] = [];
    const exit = await throughTransaction(async (owner, root) => {
      let manager: unknown;
      const bridge = commerceRepositoryContext(root, owner, { flush: child => Effect.gen(function* () {
        expect(child.manager).toBe(manager); expect(bridge.current()).toBe(child);
        expect(yield* bridge.select({ manager })).toBe(child);
        yield* child.borrow(() => Effect.sync(() => { order.push("flush"); }));
      }) });
      const result = await bridge.transaction(async child => { manager = child; expect(child).not.toBe(root.manager); order.push("task"); return { accepted: true }; });
      expect(bridge.current()).toBe(root); order.push("returned");
      expect(order).toEqual(["task", "flush", "returned"]);
      return result;
    });
    expect(exit).toEqual(Exit.succeed({ accepted: true }));
  });

  it("skips flush on task failure and restores the parent manager", async () => {
    const original = commerceError("invalidInput"); let flushed = 0, restored = false;
    const reasons = failureReasons(await throughTransaction(async (owner, root) => {
      const bridge = commerceRepositoryContext(root, owner, { flush: () => Effect.sync(() => { flushed++; }) });
      try { return await bridge.transaction(async () => { throw original; }); }
      finally { restored = bridge.current() === root; }
    }));
    expect(flushed).toBe(0); expect(restored).toBe(true);
    expect(reasons.some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
  });

  it("presents only the transaction Promise failure and retains sticky original ownership", async () => {
    const original = commerceError("invalidInput"), presentation = new Error("portable required field");
    let presented: unknown, rescueStarts = 0, restored = false;
    const reasons = failureReasons(await throughTransaction(async (owner, root) => {
      const bridge = commerceRepositoryContext(root, owner, { flush: child => child.refuse(original),
        presentExpectedFailure: error => { expect(error).toBe(original); return presentation; } });
      try { await bridge.transaction(async () => null); }
      catch (error) {
        presented = error; restored = bridge.current() === root;
        try { await owner.run(root.borrow(() => Effect.sync(() => { rescueStarts++; }))); }
        catch (refusal) { expect(refusal).toMatchObject({ reason: "rollbackOnly" }); }
        throw error;
      }
      return null;
    }));
    expect(presented).toBe(presentation); expect(restored).toBe(true); expect(rescueStarts).toBe(0);
    expect(reasons.some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
  });

  it("refuses an escaped flushed child through the existing manager owner", async () => {
    const reasons = failureReasons(await throughTransaction(async (owner, root) => {
      let manager: unknown;
      const bridge = commerceRepositoryContext(root, owner, { flush: child => Effect.sync(() => { manager = child.manager; }) });
      await bridge.transaction(async () => null);
      return await bridge.execute({ manager }, () => Effect.succeed(null));
    }));
    expect(reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidAuthority")).toBe(true);
  });
});

describe("optional scalar deferred acceptance", () => {
  it("stages the genuine canonical native plan without writing, then accepts before creation events", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* scalarFixture(true), input = [{ id: "a", code: "submitted" }, { id: "a", code: "ignored" }];
      const staged = yield* fixture.bound.createRows(fixture.root, input, fixture.shared);
      expect(fixture.writes).toEqual([]); expect(fixture.eventRows).toEqual([]);
      expect(staged).toEqual([{ id: "a", code: "submitted" }, { id: "a", code: "submitted" }]);
      expect(staged[0]).toBe(staged[1]);
      expect(fixture.plan()?.entities).toHaveLength(1); expect(fixture.plan()?.positions).toEqual([0, 0]);
      const accepted = yield* fixture.accept()(Effect.sync(() => { expect(fixture.writes).toHaveLength(1); fixture.order.push("checkpoint"); }));
      expect(accepted).toEqual([fixture.stored[0], fixture.stored[0]]);
      expect(fixture.eventRows).toEqual(fixture.stored); expect(fixture.order).toEqual(["stage", "write", "checkpoint", "event"]);
      yield* fixture.lifetime.seal;
    })));
  });

  it("refuses repeated acceptance before a second write or event", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* scalarFixture(true);
      yield* fixture.bound.createRows(fixture.root, [{ id: "a", code: "submitted" }], fixture.shared);
      const accept = fixture.accept(); yield* accept();
      const rejected = yield* Effect.exit(accept());
      expect(failureReasons(rejected).some(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidAuthority")).toBe(true);
      expect(fixture.writes).toHaveLength(1); expect(fixture.eventRows).toHaveLength(1);
      expect(Exit.isFailure(yield* Effect.exit(fixture.lifetime.seal))).toBe(true);
    })));
  });

  it("retains after-write failure before events and poisons the existing lifetime", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fixture = yield* scalarFixture(true), original = commerceError("invalidInput");
      yield* fixture.bound.createRows(fixture.root, [{ id: "a", code: "submitted" }], fixture.shared);
      const rejected = yield* Effect.exit(fixture.accept()(fixture.root.refuse(original)));
      expect(failureReasons(rejected).some(reason => Cause.isFailReason(reason) && reason.error === original)).toBe(true);
      expect(fixture.writes).toHaveLength(1); expect(fixture.eventRows).toEqual([]);
      expect(Exit.isFailure(yield* Effect.exit(fixture.lifetime.seal))).toBe(true);
    })));
  });

  it("keeps ordinary creation eager and validates unsupported fields before staging", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const ordinary = yield* scalarFixture(false);
      expect(yield* ordinary.bound.createRows(ordinary.root, [{ id: "a", code: "submitted" }], ordinary.shared)).toEqual(ordinary.stored);
      expect(ordinary.order).toEqual(["write", "event"]); yield* ordinary.lifetime.seal;
      const staged = yield* scalarFixture(true);
      const rejected = yield* Effect.exit(staged.bound.createRows(staged.root, [{ id: "a", code: "submitted", unknown: true }], staged.shared));
      expect(failureReasons(rejected).some(Cause.isFailReason)).toBe(true);
      expect(staged.plan()).toBeUndefined(); expect(staged.writes).toEqual([]); expect(staged.eventRows).toEqual([]);
    })));
  });
});

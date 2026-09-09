import { describe, expect, it } from "vitest";
import { Deferred, Effect, Result } from "effect";
import type { Context, IMessageAggregator, ModulePersistenceMutationEventArgs, ModulePersistenceMutationService } from "@medusajs/types";
import { dispatchPerformedActions, suppressMutationEventDispatch } from "@medusajs/drizzle/mutation-events";
import { commerceError, commerceLimits, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceMutationEvents } from "../src/commerce-mutation-events";
import { makeCommercePromiseOwner } from "../src/commerce-promise-owner";
import { productRepository } from "../src/product-repository";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/commerceTransaction/context";

const fixture = Effect.gen(function* () {
  const owner = yield* Effect.acquireRelease(Effect.sync(makeCommercePromiseOwner), owner => owner.close);
  return { owner, events: commerceMutationEvents(owner) };
});
type Receipt = { event: Parameters<ModulePersistenceMutationService["interceptEntityMutationEvents"]>[0]; args: ModulePersistenceMutationEventArgs; context: Context };
const collector = (receipts: Receipt[]): ModulePersistenceMutationService => ({
  interceptEntityMutationEvents: (event, args, context) => { receipts.push({ event, args, context }); },
});

describe("shared request-owned Medusa mutation dispatch", () => {
  it("keeps subscriber and context registration local to a repository family", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { events, owner } = yield* fixture;
      const other = commerceMutationEvents(owner);
      const receipts: Receipt[] = [];
      const subscriber = events.createSubscriber(["Publication", "Edition"], collector(receipts));
      const context: Context = {};
      expect(subscriber.name).toBe("Publication,Edition");
      expect(events.ownsSubscriber(subscriber)).toBe(true);
      expect(other.ownsSubscriber(subscriber)).toBe(false);
      expect(events.isSubscribed(context)).toBe(false);
      events.registerSubscriber(context, subscriber);
      expect(events.isSubscribed(context)).toBe(true);
      expect(other.isSubscribed(context)).toBe(false);
      const args = { entity: { id: "volume" }, meta: { className: "Publication" } };
      const work = events.dispatch("afterCreate", args, context);
      expect(receipts).toEqual([]);
      yield* work;
      expect(receipts).toEqual([{ event: "afterCreate", args, context }]);
      expect(receipts[0]?.args).toBe(args);
      expect(receipts[0]?.context).toBe(context);
    })));
  });

  it("preserves row order, renamed keys, empty dispatches and lifecycle change sets", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { events } = yield* fixture;
      const receipts: Receipt[] = [];
      const context: Context = {};
      events.registerSubscriber(context, events.createSubscriber(["Publication", "Edition"], collector(receipts)));
      const book = { isbn: "book", title: "Original" }, edition = { serial: "edition" };
      yield* events.created([{ modelName: "Publication", entity: book }, { modelName: "Edition", entity: edition }], context);
      yield* events.rows("afterUpdate", "Publication", [book], context);
      yield* events.created([], context);
      yield* events.rows("afterUpdate", "Publication", [], context);
      const changed = { entity: { deleted_at: null }, originalEntity: { deleted_at: "previous" } };
      yield* events.cascades({ Edition: [edition], Publication: [book] }, context, () => changed);
      expect(receipts.map(value => [value.event, value.args.meta.className])).toEqual([
        ["afterCreate", "Publication"], ["afterCreate", "Edition"], ["afterUpdate", "Publication"],
        ["afterUpdate", "Edition"], ["afterUpdate", "Publication"],
      ]);
      expect(receipts[0]?.args.entity).toBe(book);
      expect(receipts[1]?.args.entity).toBe(edition);
      expect(receipts[3]?.args.changeSet).toBe(changed);
      expect(receipts[4]?.args.changeSet).toBe(changed);
      expect(book).toEqual({ isbn: "book", title: "Original" });
    })));
  });

  it("leaves explicit subscriber precedence, suppression and duplicate consumption to Medusa", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { events, owner } = yield* fixture;
      const registered: Receipt[] = [], explicit: Receipt[] = [];
      const context: Context = {};
      events.registerSubscriber(context, events.createSubscriber(["Publication"], collector(registered)));
      const override = events.createSubscriber(["Publication"], collector(explicit));
      const args = { entity: { id: "book" }, meta: { className: "Publication" } };
      yield* events.dispatch("afterUpdate", args, context, override);
      expect(explicit).toHaveLength(1);
      expect(registered).toEqual([]);
      yield* events.dispatch("afterCreate", args, suppressMutationEventDispatch(context));
      expect(registered).toEqual([]);
      // The original framework action dispatcher records one duplicate token.
      yield* Effect.promise(signal => owner.callback(() => dispatchPerformedActions({
        created: { Publication: [{ id: "book" }] }, updated: {}, deleted: {},
      }, context), signal));
      yield* events.dispatch("afterCreate", args, context);
      expect(registered).toHaveLength(1);
      yield* events.dispatch("afterCreate", args, context);
      expect(registered).toHaveLength(2);
    })));
  });

  it("preserves the conventional aggregator path used by restore without a subscriber", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { events } = yield* fixture;
      const received: unknown[] = [];
      const aggregator: IMessageAggregator = {
        saveRawMessageData(messages) { expect(this).toBe(aggregator); received.push(...(Array.isArray(messages) ? messages : [messages])); },
        save: () => { throw new Error("Unexpected normalized aggregator path"); },
        getMessages: () => ({}), clearMessages: () => {},
      };
      const context = { messageAggregator: aggregator };
      yield* events.cascades({ Publication: [{ id: "book", deleted_at: null }] }, context,
        row => ({ entity: row, originalEntity: { deleted_at: "previous" } }));
      expect(events.isSubscribed(context)).toBe(false);
      expect(received).toEqual([{ source: "publication", action: "restored", context,
        data: { id: "book" }, eventName: "publication.publication.restored", object: "publication" }]);
    })));
  });

  it.each([new Error("foreign callback"), commerceError("unadmittedEvent")])("retains the existing foreign failure envelope %#", async error => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { events } = yield* fixture;
      const context: Context = {};
      events.registerSubscriber(context, events.createSubscriber(["Publication"], { interceptEntityMutationEvents: () => { throw error; } }));
      const result = yield* events.rows("afterUpdate", "Publication", [{ id: "book" }], context).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure" } });
      if (Result.isFailure(result)) expect(result.failure.cause).toBe(error);
    })));
  });

  it("joins started asynchronous subscribers on close and prevents late callback starts", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { events, owner } = yield* fixture;
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let finished = false;
      class Subscriber {
        afterCreate() {
          // The fake foreign subscriber has Medusa's Promise signature; its
          // runner is joined through the callback owner under test.
          return Effect.runPromise(Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)), Effect.andThen(Effect.sync(() => { finished = true; })),
          ));
        }
      }
      const context: Context = {};
      events.registerSubscriber(context, Subscriber);
      const pending = owner.run(events.dispatch("afterCreate", { entity: { id: "book" }, meta: { className: "Publication" } }, context));
      // Observe rejection before closing can interrupt the owned runner.
      const outcome = Promise.allSettled([pending]);
      yield* Deferred.await(entered);
      yield* Deferred.succeed(release, undefined);
      yield* owner.close;
      expect(finished).toBe(true);
      yield* Effect.promise(() => outcome);
      const receipts: Receipt[] = [];
      const late = events.createSubscriber(["Publication"], collector(receipts));
      const result = yield* events.dispatch("afterCreate", { entity: { id: "late" }, meta: { className: "Publication" } }, {}, late).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "adapterFailure", cause: { reason: "closed" } } });
      expect(receipts).toEqual([]);
    })));
  });

  it.each(["foreignSubscriber", "unregistered", "afterUpsert", "foreignManager"] as const)("retains Product dispatch admission for %s", async scenario => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { owner } = yield* fixture;
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits, {}, {}, "event-admission", "write"), lifetime => lifetime.close);
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const root = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources,
        store: { find: unused, count: unused, write: unused, delete: unused, lifecycle: unused }, table: unused,
      }, "event-admission", lifetime.context, unused, unused);
      const metadata = yield* captureProductSchema("event-admission").pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame)));
      const { mutationPersistence: persistence } = productRepository(root, owner, metadata);
      const receipts: Receipt[] = [];
      const subscriber = persistence.createEventSubscriber?.(["Product"], collector(receipts));
      const foreign = commerceMutationEvents(owner).createSubscriber(["Product"], collector(receipts));
      const context = { manager: scenario === "foreignManager" ? {} : root.manager };
      const result = yield* Effect.tryPromise({ try: async () => persistence.dispatchMutationEvent?.(
        scenario === "afterUpsert" ? "afterUpsert" : "afterCreate",
        { entity: { id: "product" }, meta: { className: "Product" } }, context,
        scenario === "foreignSubscriber" ? foreign : scenario === "unregistered" ? undefined : subscriber,
      ), catch: error => error }).pipe(Effect.result);
      expect(result).toMatchObject({ _tag: "Failure", failure: { reason: scenario === "foreignManager" ? "invalidAuthority" : "rollbackOnly" } });
      // Re-entering checked refusal reports rollbackOnly, while the outer
      // lifetime preserves the first rejection for its settlement owner.
      const sealed = yield* lifetime.seal.pipe(Effect.exit);
      expect(sealed).toMatchObject({ _tag: "Failure", cause: { reasons: expect.arrayContaining([
        expect.objectContaining({ _tag: "Fail", error: expect.objectContaining({ reason: scenario === "foreignManager" ? "invalidAuthority" : "unadmittedEvent" }) }),
      ]) } });
      expect(receipts).toEqual([]);
    })));
  });
});

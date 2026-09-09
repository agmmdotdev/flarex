import { describe, expect, it } from "vitest";
import { Effect, Option } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { model } from "@medusajs/utils/dml/model";
import { commerceError, commerceLimits, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareCommerceModule, commerceInternalService } from "../src/commerce-module";
import { makeCommercePromiseOwner } from "../src/commerce-promise-owner";
import { commerceRepositoryContext } from "../src/commerce-repository-context";
import { withCommerceService } from "../src/commerce-service-bridge";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/commerceTransaction/context";

const Volume = model.define("Volume", { isbn: model.text().primaryKey(), title: model.text() });
const Edition = model.define("Edition", { serial: model.text().primaryKey() });
const fixture = Effect.gen(function* () {
  const owner = yield* Effect.acquireRelease(Effect.sync(makeCommercePromiseOwner), owner => owner.close);
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits, {}, {}, "module-construction", "read"), lifetime => lifetime.close);
  const unused = () => Effect.fail(commerceError("unsupportedProfile"));
  const root = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources,
    store: { find: unused, count: unused, write: unused, delete: unused, lifecycle: unused }, table: unused,
  }, "module-construction", lifetime.context, unused, unused);
  const calls: { input: unknown; manager: unknown }[] = [];
  const bridge = commerceRepositoryContext(root, owner);
  const refuse = () => owner.reject(commerceError("unsupportedProfile"));
  const repository: DAL.RepositoryService = {
    getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
    serialize: refuse, findAndCount: refuse, create: refuse, update: refuse, delete: refuse,
    softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse,
    find(input, shared) {
      expect(this).toBe(repository);
      return bridge.execute(shared, ctx => Effect.sync(() => {
        calls.push({ input, manager: ctx.manager });
        return [{ isbn: "book", title: "Title" }];
      }));
    },
  };
  const registration = { name: "library", baseRepository: repository,
    models: [{ model: Volume, repository }, { model: Edition, repository }] };
  return { owner, root, repository, calls, registration };
});

describe("shared module preparation and repository construction", () => {
  it("preserves admitted DML identity and caller order without aliasing the input array", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { owner, registration } = yield* fixture;
      const { persistence } = prepareCommerceModule(owner, registration);
      const input = [Edition, Volume];
      const prepared = persistence.prepareModels(input);
      expect(prepared).toEqual(input);
      expect(prepared).not.toBe(input);
      expect(prepared[0]).toBe(Edition);
      expect(prepared[1]).toBe(Volume);
      input.pop();
      expect(prepared).toHaveLength(2);
      expect(persistence.createEventSubscriber).toBeUndefined();
      expect(persistence.registerEventSubscriber).toBeUndefined();
      expect(persistence.dispatchMutationEvent).toBeUndefined();
    })));
  });

  it.each(["missing", "duplicate", "foreign", "sameName"] as const)("refuses %s model sets and latches the refusal", async scenario => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { owner, registration } = yield* fixture;
      const { persistence } = prepareCommerceModule(owner, registration);
      const input = scenario === "missing" ? [Volume] : scenario === "duplicate" ? [Volume, Volume]
        : [Volume, { name: scenario === "sameName" ? "Edition" : "Other" }];
      expect(() => persistence.prepareModels(input)).toThrowError(expect.objectContaining({ reason: "unsupportedProfile" }));
      expect(owner.refusal()).toMatchObject({ _tag: "Some", value: { reason: "unsupportedProfile" } });
    })));
  });

  it.each(["sameObject", "sameName", "injectionKey", "emptyName"] as const)("refuses ambiguous %s registrations", async scenario => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { owner, repository } = yield* fixture;
      const first = { name: "Volume" };
      const second = scenario === "sameObject" ? first : { name: scenario === "sameName" ? "Volume" : scenario === "injectionKey" ? "volume" : "" };
      expect(() => prepareCommerceModule(owner, { name: "ambiguous", baseRepository: repository,
        models: [{ model: first, repository }, { model: second, repository }] })).toThrowError(expect.objectContaining({ reason: "unsupportedProfile" }));
    })));
  });

  it("rejects foreign and renamed models at repository construction", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { owner, repository } = yield* fixture;
      const admitted = { name: "Volume" };
      const { persistence } = prepareCommerceModule(owner, { name: "mutable-fixture", baseRepository: repository, models: [{ model: admitted, repository }] });
      expect(() => persistence.createRepository({ name: "Volume" })).toThrowError();
      admitted.name = "Edition";
      expect(() => persistence.createRepository(admitted)).toThrowError();
    })));
  });

  it("constructs renamed internal services with the DML primary key and bound repository receiver", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { owner, root, calls, registration } = yield* fixture;
      const module = prepareCommerceModule(owner, registration);
      const service = module.internalService(Volume);
      const context = { manager: root.manager, transactionManager: root.manager };
      const rows = yield* Effect.promise(() => service.list({}, {}, context));
      expect(rows).toEqual([{ isbn: "book", title: "Title" }]);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ input: { options: { orderBy: { isbn: "ASC" } } }, manager: root.manager });
      expect(module.baseRepository.getFreshManager()).toBe(root.manager);
      expect(module.baseRepository.getActiveManager()).toBe(root.manager);
      expect(Option.isNone(owner.refusal())).toBe(true);
    })));
  });

  it("isolates same-model factories between requests and cannot reopen a closed owner", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const first = yield* fixture, second = yield* fixture;
      const a = prepareCommerceModule(first.owner, first.registration), b = prepareCommerceModule(second.owner, second.registration);
      const A = a.persistence.createRepository(Volume), B = b.persistence.createRepository(Volume);
      expect(A).not.toBe(B);
      expect(new A().getFreshManager()).toBe(first.root.manager);
      expect(new B().getFreshManager()).toBe(second.root.manager);
      yield* first.owner.close;
      yield* Effect.promise(() => expect(new A().find({ where: {} }, { manager: first.root.manager })).rejects.toMatchObject({ reason: "closed" }));
      yield* Effect.promise(() => new B().find({ where: {} }, { manager: second.root.manager }));
      expect(first.calls).toEqual([]);
      expect(second.calls).toHaveLength(1);
    })));
  });

  it("keeps an explicit restricted alias distinct from the normal model repository", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { owner, root, repository, registration, calls } = yield* fixture;
      const module = prepareCommerceModule(owner, registration);
      const alias = commerceInternalService(Volume, { ...repository, find: () => owner.run(Effect.fail(commerceError("unsupportedProfile"))) }, module.persistence);
      const context = { manager: root.manager, transactionManager: root.manager };
      yield* Effect.promise(() => expect(alias.list({}, {}, context)).rejects.toMatchObject({ reason: "unsupportedProfile" }));
      yield* Effect.promise(() => module.internalService(Volume).list({}, {}, context));
      expect(calls).toHaveLength(1);
    })));
  });

  it.each(["connection", "customRepository"] as const)("cannot hide a caught %s refusal from the outer service owner", async operation => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const { root, registration } = yield* fixture;
      const result = yield* withCommerceService(root, owner => prepareCommerceModule(owner, registration), async module => {
        try {
          if (operation === "connection") module.persistence.createConnectionLoader();
          else module.persistence.createCustomRepository();
        } catch { /* A foreign framework may catch the synchronous rejection. */ }
        return { caught: true };
      }).pipe(Effect.exit);
      expect(result).toMatchObject({ _tag: "Failure" });
    })));
  });
});

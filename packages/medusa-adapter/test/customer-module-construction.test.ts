import { Effect, Result } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { DAL, InferEntityType, ModulesSdkTypes } from "@medusajs/framework/types";
import { Customer } from "@medusajs/customer/models";
import { customerModuleModels } from "@medusajs/customer/static-manifest";
import { CustomerModuleService } from "@medusajs/customer/services";
import { commerceError, commerceLimits, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { commerceModuleEventBus } from "../src/module/events";
import type { CommerceInternalService } from "../src/module/persistence";
import { defineCustomerPersistenceModule } from "../src/modules/customer/module";
import { commerceRepositoryContext } from "../src/repository/context";
import { deniedCommerceRepository } from "../src/repository/denied";
import { mockRelationalRead } from "./mock-relational-read";
import { expectNativePromiseDefect } from "./support/promise-failure-observer";

const fixture = Effect.gen(function* () {
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits,
    {}, {}, "customer-construction", "read"), lifetime => lifetime.close);
  const unused = () => Effect.fail(commerceError("unsupportedProfile"));
  return makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources,
    store: { prepareRead(query: unknown) { return mockRelationalRead(this, query); }, findPage: unused, aggregate: unused,
      find: unused, count: unused, write: unused, delete: unused, lifecycle: unused }, table: unused,
  }, "customer-construction", lifetime.context, unused, unused);
});

describe("native Customer module construction", () => {
  it("uses the native inferred entity contract for Customer internal service results", () => {
    expectTypeOf<CommerceInternalService<typeof Customer>>()
      .toEqualTypeOf<ModulesSdkTypes.IMedusaInternalService<InferEntityType<typeof Customer>>>();
  });

  it("constructs all four native internal services and reaches empty Address serialization with every child write denied", async () => {
    const serializationBoundary = new Error("observed native empty Address serialization");
    const selected: unknown[] = [], serialized: { input: unknown; options: unknown }[] = [];
    let constructions = 0;
    const module = Result.getOrThrow(defineCustomerPersistenceModule({ name: "customer-construction",
      profile: "customer-selection-construction", bind: (ctx, owner) => {
        const bridge = commerceRepositoryContext(ctx, owner);
        const refuse = () => owner.reject(commerceError("unsupportedProfile"));
        const unavailable: DAL.RepositoryService = {
          getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
          serialize: refuse, find: refuse, findAndCount: refuse, create: refuse, update: refuse, delete: refuse,
          softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse,
        };
        const denied = deniedCommerceRepository(unavailable, refuse);
        const baseRepository: DAL.RepositoryService = { ...unavailable, serialize: async (input: unknown, options?: unknown) => {
          serialized.push({ input, options });
          // Stop at the real serializer boundary without inventing DTO or
          // relation behavior. The connected workflow fixture owns success.
          throw serializationBoundary;
        } };
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources, check: work => work,
          capture: () => ctx.refuse(commerceError("unadmittedEvent")), refuse });
        return { baseRepository, repository: (model: typeof customerModuleModels[number]) => { selected.push(model); return denied; }, eventBus };
      }, service: native => {
        constructions++;
        expect(native).toBeInstanceOf(CustomerModuleService);
        return native;
      },
    }));
    expect(constructions).toBe(0);
    expect(module.description.models.map(model => model.name)).toEqual(customerModuleModels.map(model => model.name));
    await expectNativePromiseDefect(Effect.scoped(Effect.gen(function* () {
      const root = yield* fixture;
      return yield* module.use(root, async ({ service, context }) => {
        expect(context).toEqual({ manager: root.manager, transactionManager: root.manager });
        return service.createCustomerAddresses([], context);
      });
    })), serializationBoundary);
    expect(constructions).toBe(1);
    expect(selected).toEqual(customerModuleModels);
    expect(selected.every((model, index) => model === customerModuleModels[index])).toBe(true);
    expect(serialized).toEqual([{ input: [], options: { populate: true } }]);
  });
});

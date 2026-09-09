import { describe, expect, expectTypeOf, it } from "vitest";
import { Effect, Result } from "effect";
import type { DAL } from "@medusajs/framework/types";
import { model } from "@medusajs/utils/dml/model";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/commerceTransaction/context";
import { defineCommerceModule, type CommerceModuleExtension } from "../src/module-definition";
import { commerceRepositoryContext } from "../src/commerce-repository-context";
import { makeCommercePromiseOwner, type CommercePromiseOwner } from "../src/commerce-promise-owner";
import { commerceInternalService } from "../src/commerce-module";
import { productImageAliasRepository } from "../src/product-module";

const Volume = model.define("Volume", { isbn: model.text().primaryKey(), title: model.text() });
const Edition = model.define("Edition", { serial: model.text().primaryKey() });
const fixture = Effect.gen(function* () {
  const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits, {}, {}, "module-use", "read"), lifetime => lifetime.close);
  const unused = () => Effect.fail(commerceError("unsupportedProfile"));
  const root = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources,
    store: { find: unused, count: unused, write: unused, delete: unused, lifecycle: unused }, table: unused,
  }, "module-use", lifetime.context, unused, unused);
  return root;
});

function libraryProfile() {
  const calls: { manager: unknown; input: unknown }[] = [];
  let bindings = 0;
  const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
    bindings++;
    const bridge = commerceRepositoryContext(ctx, owner);
    const refuse = () => owner.reject(commerceError("unsupportedProfile"));
    const repository: DAL.RepositoryService = {
      getFreshManager: bridge.getFreshManager, getActiveManager: bridge.getActiveManager, transaction: bridge.transaction,
      serialize: refuse, findAndCount: refuse, create: refuse, update: refuse, delete: refuse,
      softDelete: refuse, restore: refuse, upsert: refuse, upsertWithReplace: refuse,
      find(input, shared) {
        expect(this).toBe(repository);
        return bridge.execute(shared, selected => Effect.sync(() => {
          calls.push({ manager: selected.manager, input });
          return [{ isbn: "book", title: "Title" }];
        }));
      },
    };
    return { baseRepository: repository, repository: () => repository };
  };
  return { profile: { name: "library", capabilities: ["lookup"], bind }, calls, bindings: () => bindings };
}

describe("prepared commerce module definitions", () => {
  it("derives typed services once per use and retains a natural primary key", async () => {
    const source = libraryProfile();
    const module = Result.getOrThrow(defineCommerceModule({ name: "library", models: [Volume, Edition], profile: source.profile,
      extensions: {}, service: input => input,
    }));
    expect(source.bindings()).toBe(0);
    expect(module.description.models).toEqual([
      { name: "Volume", repository: "volumeRepository", service: "volumeService" },
      { name: "Edition", repository: "editionRepository", service: "editionService" },
    ]);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const root = yield* fixture;
      const rows = yield* module.use(root, ({ services, context }) => {
        expectTypeOf(services.volumeService).toEqualTypeOf<ReturnType<typeof commerceInternalService<typeof Volume>>>();
        expectTypeOf(services.editionService).toEqualTypeOf<ReturnType<typeof commerceInternalService<typeof Edition>>>();
        // @ts-expect-error No service exists for an unregistered model.
        void services.currencyService;
        return services.volumeService.list({}, {}, context);
      });
      expect(rows).toEqual([{ isbn: "book", title: "Title" }]);
      expect(source.calls).toEqual([{ manager: root.manager, input: expect.objectContaining({ options: expect.objectContaining({ orderBy: { isbn: "ASC" } }) }) }]);
    })));
    expect(source.bindings()).toBe(1);
  });

  it.each([
    { models: [Volume, Volume], extensions: {}, reason: "duplicateModel" },
    { models: [Volume, { name: "volume" }], extensions: {}, reason: "duplicateModel" },
    { models: [Volume], extensions: { volumeService: { mode: "add", create: () => ({}) } }, reason: "serviceConflict" },
    { models: [Volume], extensions: { otherService: { mode: "replace", create: () => ({}) } }, reason: "unknownReplacement" },
    { models: [Volume], extensions: { tree: { mode: "add", requires: ["tree"], create: () => ({}) } }, reason: "missingCapability" },
  ] satisfies { models: { name: string }[]; extensions: Record<string, CommerceModuleExtension<unknown>>; reason: string }[])("refuses $reason before binding", input => {
    const source = libraryProfile();
    const result = defineCommerceModule({ name: "library", models: input.models, profile: source.profile, extensions: input.extensions, service: value => value });
    expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "CommerceModuleDefinitionError", reason: input.reason } });
    expect(source.bindings()).toBe(0);
  });

  it("captures declarations and callback selection, and requires explicit typed replacement", async () => {
    const source = libraryProfile();
    const models = [Volume];
    const extensions = {
      volumeService: { mode: "replace", requires: ["lookup"], create: () => ({ label: () => "special" }) },
      editionLookup: { mode: "add", create: () => ({ count: () => 7 }) },
    } satisfies Record<string, CommerceModuleExtension<unknown>>;
    const definition = { name: "library", models, profile: source.profile, extensions, service: (value: { services: {
      volumeService: { label: () => string }; editionLookup: { count: () => number };
    } }) => value.services };
    const module = Result.getOrThrow(defineCommerceModule(definition));
    models.length = 0;
    source.profile.capabilities.length = 0;
    extensions.volumeService.requires.push("unavailable");
    extensions.volumeService.create = () => ({ label: () => "mutated" });
    expect(Object.isFrozen(module.description.extensions[0]?.requires)).toBe(true);
    expect(module.description.capabilities).toEqual(["lookup"]);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const root = yield* fixture;
      const value = yield* module.use(root, async services => {
        expectTypeOf(services.editionLookup.count()).toEqualTypeOf<number>();
        // @ts-expect-error Replacement does not falsely retain the default methods.
        void services.volumeService.list;
        return { label: services.volumeService.label(), count: services.editionLookup.count() };
      });
      expect(value).toEqual({ label: "special", count: 7 });
    })));
  });

  it("keeps concurrent command instances separate and refuses escaped services", async () => {
    const source = libraryProfile();
    const module = Result.getOrThrow(defineCommerceModule({ name: "library", models: [Volume], profile: source.profile,
      extensions: {}, service: input => input,
    }));
    const lateCalls: (() => Promise<unknown>)[] = [];
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const first = yield* fixture, second = yield* fixture;
      yield* Effect.all([first, second].map(root => module.use(root, async ({ services, context }) => {
        lateCalls.push(() => services.volumeService.list({}, {}, context));
        return services.volumeService.list({}, {}, context);
      })), { concurrency: 2 });
      expect(new Set(source.calls.map(call => call.manager))).toEqual(new Set([first.manager, second.manager]));
      for (const late of lateCalls) yield* Effect.promise(() => expect(late()).rejects.toMatchObject({ reason: "closed" }));
      expect(source.calls).toHaveLength(2);
    })));
  });

  it("keeps runtime-selected arrays and union-selected tuple members optional", async () => {
    const source = libraryProfile();
    const prepareArray = (models: readonly (typeof Volume | typeof Edition)[]) => defineCommerceModule({
      name: "dynamic", models, profile: source.profile, extensions: {}, service: input => {
        expectTypeOf(input.services.editionService).toEqualTypeOf<ReturnType<typeof commerceInternalService<typeof Edition>> | undefined>();
        const typeProof = () => {
          // @ts-expect-error A dynamic array does not guarantee this registration.
          void input.services.editionService.list;
        };
        void typeProof;
        return input;
      },
    });
    const prepareUnion = (selected: typeof Volume | typeof Edition) => defineCommerceModule({
      name: "union", models: [selected], profile: source.profile, extensions: {}, service: input => {
        expectTypeOf(input.services.volumeService).toEqualTypeOf<ReturnType<typeof commerceInternalService<typeof Volume>> | undefined>();
        const typeProof = () => {
          // @ts-expect-error A union-selected tuple entry does not guarantee both models.
          void input.services.volumeService.list;
        };
        void typeProof;
        return input;
      },
    });
    const array = Result.getOrThrow(prepareArray([Volume]));
    const tuple = Result.getOrThrow(prepareUnion(Edition));
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const root = yield* fixture;
      yield* array.use(root, async input => { expect(Object.keys(input.services)).toEqual(["volumeService"]); return null; });
      yield* tuple.use(root, async input => { expect(Object.keys(input.services)).toEqual(["editionService"]); return null; });
    })));
  });

  it("retains receivers for method-based profile, extension and main-service factories", async () => {
    const source = libraryProfile();
    const profile = { ...source.profile, label: "profile", bind(ctx: CommerceCommandContext, owner: CommercePromiseOwner) {
      expect(this.label).toBe("profile");
      return source.profile.bind(ctx, owner);
    } };
    const extension = { mode: "add", label: "extension", create() { return { label: this.label }; } } satisfies
      CommerceModuleExtension<unknown> & { label: string };
    const definition = { name: "methods", models: [Volume], profile, extensions: { custom: extension },
      service(input: { services: { custom: { label: string } } }) { return { name: this.name, label: input.services.custom.label }; },
    };
    const module = Result.getOrThrow(defineCommerceModule(definition));
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const root = yield* fixture;
      expect(yield* module.use(root, async value => value)).toEqual({ name: "methods", label: "extension" });
    })));
  });

  it.each(["symbol", "hidden", "accessor", "inherited"] as const)("refuses unsupported %s extension registration", kind => {
    const extension = { mode: "add", create: () => ({ label: "extension" }) } satisfies CommerceModuleExtension<unknown>;
    const extensions = kind === "symbol" ? { [Symbol("extension")]: extension } : { custom: extension };
    if (kind === "hidden") Object.defineProperty(extensions, "custom", { enumerable: false });
    if (kind === "accessor") Object.defineProperty(extensions, "custom", { get: () => { throw new Error("must not read accessor"); } });
    if (kind === "inherited") Object.setPrototypeOf(extensions, { inherited: extension });
    const result = defineCommerceModule({ name: "library", models: [Volume], profile: libraryProfile().profile,
      extensions, service: input => input,
    });
    expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidName" } });
  });

  it("rejects model renaming before constructing repositories", async () => {
    const source = libraryProfile();
    const mutable = { name: "Volume" };
    const module = Result.getOrThrow(defineCommerceModule({ name: "library", models: [mutable], profile: source.profile,
      extensions: {}, service: input => input,
    }));
    mutable.name = "Renamed";
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const root = yield* fixture;
      const outcome = yield* module.use(root, async () => null).pipe(Effect.exit);
      expect(outcome).toMatchObject({ _tag: "Failure" });
    })));
    expect(source.bindings()).toBe(0);
  });

  it("does not turn a caught repository refusal into successful work", async () => {
    const source = libraryProfile();
    const module = Result.getOrThrow(defineCommerceModule({ name: "library", models: [Volume], profile: source.profile,
      extensions: {}, service: input => input,
    }));
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const root = yield* fixture;
      const outcome = yield* module.use(root, async ({ binding }) => {
        try { await binding.baseRepository.create([]); } catch { /* Simulate framework recovery. */ }
        return null;
      }).pipe(Effect.exit);
      expect(outcome).toMatchObject({ _tag: "Failure" });
    })));
  });

  it("keeps the image alias allowed operations explicit and preserves receivers", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const root = yield* fixture;
      const owner = yield* Effect.acquireRelease(Effect.sync(makeCommercePromiseOwner), owner => owner.close);
      const repository = libraryProfile().profile.bind(root, owner).baseRepository;
      repository.upsert = async function () {
        expect(this).toBe(repository);
        return [{ isbn: "changed" }];
      };
      const refuse = () => Promise.reject(commerceError("unsupportedProfile"));
      const alias = productImageAliasRepository(repository, refuse);
      expect(alias.getFreshManager()).toBe(root.manager);
      expect(yield* Effect.promise(() => alias.upsert([]))).toEqual([{ isbn: "changed" }]);
      for (const name of ["find", "findAndCount", "create", "delete", "softDelete", "restore"] as const) expect(alias[name]).toBe(refuse);
    })));
  });
});

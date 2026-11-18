import { Effect, Result } from "effect";
import { Store, StoreCurrency, StoreLocale } from "@medusajs/store/models";
import { storeStaticResources } from "@medusajs/store/static-manifest";
import { Modules } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceModuleEventBus } from "../../module/events";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { moduleAliases, scalarGraphDefinition } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { defineStorePersistenceModule } from "./module";
import { captureStoreMetadata } from "./schema";
import { decodeStoreCartRead, decodeStoreCartReadArguments } from "./cart-read-input";
import { prepareStoreCartReadRepository } from "./cart-read-repository";
import { storeCartReadPolicy } from "./cart-read-receipt";

/** Native Cart's Store defaults and Store scalar graph branch. The independent
 * Store deletion guard retains its original profile and admitted selector. */
export const makeStoreCartReadCommands = Effect.fn("StoreAdapter.cartReadCommands")(function* () {
  const metadata = yield* captureStoreMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareStoreCartReadRepository(metadata.frame), policy = storeCartReadPolicy(prepared);
    const module = yield* defineStorePersistenceModule({ name: "flarex-store-cart-context-read", profile: "store.cart-context-read",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources, capture: policy.capture,
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: typeof Store | typeof StoreCurrency | typeof StoreLocale) => model === Store ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ listStores: native.listStores.bind(native), listAndCountStores: native.listAndCountStores.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("StoreCartRead.prepare")(decodeStoreCartRead);
    const list = commands.read("storeListForCartContext", prepare, ({ service, context }, input) => {
      const { select, relations, ...config } = input.config ?? {};
      return service.listStores(input.filters ?? {}, { ...config,
        ...(select === undefined ? {} : { select: [...select] }), ...(relations === undefined ? {} : { relations: [...relations] }),
      }, context);
    });
    const count = commands.read("storeCountForCartContext", prepare, ({ service, context }, input) => {
      const { select, relations, ...config } = input.config ?? {};
      return service.listAndCountStores(input.filters ?? {}, { ...config,
        ...(select === undefined ? {} : { select: [...select] }), ...(relations === undefined ? {} : { relations: [...relations] }),
      }, context);
    });
    const listStores = yield* defineWorkflowMethod({ command: list, arguments: decodeStoreCartReadArguments,
      encode: ([filters, config]) => ({ ...(filters === undefined ? {} : { filters }), ...(config === undefined ? {} : { config }) }), output: prepared.contracts.decodeRows });
    const listAndCountStores = yield* defineWorkflowMethod({ command: count, arguments: decodeStoreCartReadArguments,
      encode: ([filters, config]) => ({ ...(filters === undefined ? {} : { filters }), ...(config === undefined ? {} : { config }) }), output: decodeGraphCount });
    const joiner = storeStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph = yield* scalarGraphDefinition(yield* moduleAliases({ ...joiner,
      alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => alias.entity === "Store") }), "Store", count, prepared.table);
    const nativeGraph = { ...graph, services: [{ name: "nativeStore", model: "Store" }] };
    const admitted = [list, count];
    const workflow = yield* defineWorkflowModule({ name: Modules.STORE, source: module.description,
      methods: { listStores, listAndCountStores }, graph: nativeGraph, logical: { ...policy, commands: admitted } });
    return { list, count, commands: admitted, workflow, graph: nativeGraph, withService: module.use, contracts: prepared.contracts,
      logicalEventPolicy: () => policy };
  }));
});

import { Effect, Result, Schema } from "effect";
import { Price, PriceSet, PriceRule, PriceList, PriceListRule, PricePreference } from "@medusajs/pricing/models";
import { PricingModuleService } from "@medusajs/pricing/services";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreatePriceSetDTO, PriceSetDTO, FilterablePriceSetProps, FindConfig, IEventBusModuleService, IPricingModuleService, PricingRepositoryService } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "./pricing-schema";
import { preparePricingRepository } from "./pricing-repository";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { defineCommerceModule } from "./module-definition";
import { commerceServiceCommands } from "./service-commands";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { decodeLocalEventBatch, decodeLocalEventOptions } from "./module-event-input";
import { defineWorkflowModule, defineWorkflowMethod } from "./workflow/module";
import { moduleAliases } from "./local-graph/module";
import { decodeGraphCount } from "./local-graph/query";
import type { GraphModuleDefinition } from "./local-graph/model";
import { PriceSetsInput, PricingId, decodePriceSetCreate, decodePriceSetRead, decodePriceSetRetrieve } from "./pricing-input";
import { pricingEventPolicy } from "./pricing-events";
const decodeCreateArguments = commerceDecoder(Schema.Tuple([PriceSetsInput]), "invalidInput");

export const makeLocalPricingCommands = Effect.fn("PricingAdapter.commands")(function* () {
  const metadata = yield* capturePricingMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* preparePricingRepository(metadata.frame);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const eventBus: IEventBusModuleService = {
        emit: (input, options) => owner.run(bound.bridge.checked(ctx, Effect.gen(function* () {
          yield* Effect.fromResult(decodeLocalEventOptions(yield* Effect.fromResult(captureCommerceInput(options))));
          const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
          for (const message of yield* Effect.fromResult(decodeLocalEventBatch(captured))) yield* bound.bridge.current().captureLocalEvent(message);
        }))),
        subscribe: () => owner.reject(commerceError("unsupportedProfile")), unsubscribe: () => owner.reject(commerceError("unsupportedProfile")), releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse,
      };
      return { baseRepository: bound.repository, repository: (model: typeof Price | typeof PriceSet | typeof PriceRule | typeof PriceList | typeof PriceListRule | typeof PricePreference) =>
        model === PriceSet ? bound.repository : bound.denied,
      events: bound.mutationEvents, eventBus, refuse: bound.refuse };
    };
    const module = yield* defineCommerceModule({ name: "flarex-pricing-local",
      models: [PriceSet, Price, PriceRule, PriceList, PriceListRule, PricePreference],
      profile: { name: "pricing-base-prices", capabilities: [], bind },
      extensions: { pricingRepository: { mode: "add", create: ({ binding }) => ({ calculatePrices: binding.refuse } satisfies PricingRepositoryService) } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new PricingModuleService(container, { scope: "internal" });
        return { service: { createPriceSets: native.createPriceSets.bind(native), listPriceSets: native.listPriceSets.bind(native),
          retrievePriceSet: native.retrievePriceSet.bind(native), listAndCountPriceSets: native.listAndCountPriceSets.bind(native) }, context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const prepare = <Value>(decode: (input: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) =>
      Effect.fn("PricingCommand.prepare")((ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decode(input)).pipe(
        Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
    // SAFETY: public inputs are checked above; native DTOs admit a wider numeric
    // and rule grammar. The selected DAL validates normalized graph inputs.
    const create = commands.write("pricingCreate", prepare(decodePriceSetCreate), ({ service, context }, data) =>
      Array.isArray(data) ? service.createPriceSets(data as CreatePriceSetDTO[], context) : service.createPriceSets(data as CreatePriceSetDTO, context));
    const list = commands.read("pricingList", prepare(decodePriceSetRead), ({ service, context }, args) => service.listPriceSets(args.filters as FilterablePriceSetProps | undefined, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const count = commands.read("pricingCount", prepare(decodePriceSetRead), ({ service, context }, args) => service.listAndCountPriceSets(args.filters as FilterablePriceSetProps | undefined, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const retrieve = commands.read("pricingRetrieve", prepare(decodePriceSetRetrieve), ({ service, context }, args) => service.retrievePriceSet(args.id, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const joiner = pricingStaticResources.joinerConfig;
    if (!joiner) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = { aliases: yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : joiner.alias === undefined ? [] : [joiner.alias]).filter(alias => alias.entity === "PriceSet") }),
      reads: [{ model: "PriceSet", command: count, table: prepared.table, paths: prepared.paths, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }],
    };
    const createPriceSets = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments, encode: ([sets]) => sets,
      output: commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "storedCorruption"),
      moduleEvents: ["price_set", "price", "price_rule"].map(objectName => buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "created" })),
    });
    const workflow = yield* defineWorkflowModule({ name: Modules.PRICING, source: module.description, methods: { createPriceSets }, graph,
      refusedMethods: pricingRefusedMethods,
    });
    return { create, list, count, retrieve, commands: [create, list, count, retrieve], graph, workflow, withService: module.use, eventPolicy: pricingEventPolicy };
  }));
});

/** Checked against the pinned public module interface; unsupported calls remain
 * fatal even if native callback code catches their rejected promises. */
export const pricingRefusedMethods = [
  "calculatePrices",
  "retrievePriceSet",
  "listPriceSets",
  "listAndCountPriceSets",
  "upsertPriceSets",
  "updatePriceSets",
  "deletePriceSets",
  "addPrices",
  "listPrices",
  "softDeletePrices",
  "restorePrices",
  "listAndCountPrices",
  "retrievePriceRule",
  "listPriceRules",
  "listAndCountPriceRules",
  "createPriceRules",
  "updatePriceRules",
  "deletePriceRules",
  "retrievePriceList",
  "listPriceLists",
  "listAndCountPriceLists",
  "createPriceLists",
  "updatePriceLists",
  "deletePriceLists",
  "softDeletePriceLists",
  "restorePriceLists",
  "retrievePriceListRule",
  "listPriceListRules",
  "listAndCountPriceListRules",
  "deletePriceListRules",
  "addPriceListPrices",
  "updatePriceListPrices",
  "setPriceListRules",
  "removePriceListRules",
  "removePrices",
  "retrievePricePreference",
  "listPricePreferences",
  "createPricePreferences",
  "upsertPricePreferences",
  "updatePricePreferences",
  "softDeletePricePreferences",
  "restorePricePreferences",
  "deletePricePreferences"
] satisfies (keyof IPricingModuleService)[];

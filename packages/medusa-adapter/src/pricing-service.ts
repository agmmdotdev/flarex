import { Effect, Result, Schema } from "effect";
import { Price, PriceSet, PriceRule, PriceList, PriceListRule, PricePreference } from "@medusajs/pricing/models";
import { PricingModuleService } from "@medusajs/pricing/services";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreatePriceSetDTO, PriceSetDTO, FilterablePriceSetProps, FindConfig, IEventBusModuleService, PricingRepositoryService, PricingTypes } from "@medusajs/framework/types";
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
import { PriceSetsInput, PriceListsInput, PricePreferencesInput, PricingId, decodePriceSetCreate, decodePriceListCreate, decodePricePreferenceCreate, decodePriceSetRead, decodePriceSetRetrieve } from "./pricing-input";
import { decodePricingCalculation } from "./pricing-calculation";
import { pricingLogicalCreateEventPolicy } from "./pricing-events";
const decodeCreateArguments = commerceDecoder(Schema.Tuple([PriceSetsInput]), "invalidInput");
const decodeCreateListArguments = commerceDecoder(Schema.Tuple([PriceListsInput]), "invalidInput");
const decodeCreatePreferenceArguments = commerceDecoder(Schema.Tuple([PricePreferencesInput]), "invalidInput");

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
        model === PriceSet ? bound.repository : model === PriceList ? bound.listRepository : model === PriceRule ? bound.ruleRepository :
          model === PricePreference ? bound.preferenceRepository : bound.denied,
      events: bound.mutationEvents, eventBus, refuse: bound.refuse, calculatePrices: bound.calculatePrices };
    };
    const module = yield* defineCommerceModule({ name: "flarex-pricing-local",
      models: [PriceSet, Price, PriceRule, PriceList, PriceListRule, PricePreference],
      profile: { name: "pricing-base-prices", capabilities: [], bind },
      extensions: { pricingRepository: { mode: "add", create: ({ binding }) => ({ calculatePrices: binding.calculatePrices } satisfies PricingRepositoryService) } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new PricingModuleService(container, { scope: "internal" });
        return { service: { createPriceSets: native.createPriceSets.bind(native), createPriceLists: native.createPriceLists.bind(native),
          createPricePreferences: native.createPricePreferences.bind(native),
          listPriceSets: native.listPriceSets.bind(native),
          retrievePriceSet: native.retrievePriceSet.bind(native), listAndCountPriceSets: native.listAndCountPriceSets.bind(native),
          calculatePrices: native.calculatePrices.bind(native) }, context };
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
    const createList = commands.write("pricingCreateList", prepare(decodePriceListCreate), ({ service, context }, data) =>
      service.createPriceLists(data.map(list => {
        const { prices, rules, ...fields } = list;
        return { ...fields, prices: prices.map(price => ({ ...price })),
          ...(rules === undefined ? {} : { rules: { region_id: [...rules.region_id] } }) };
      }) as PricingTypes.CreatePriceListDTO[], context));
    const createPreference = commands.write("pricingCreatePreference", prepare(decodePricePreferenceCreate),
      ({ service, context }, data) => service.createPricePreferences(data.map(preference => ({ ...preference })), context));
    const list = commands.read("pricingList", prepare(decodePriceSetRead), ({ service, context }, args) => service.listPriceSets(args.filters as FilterablePriceSetProps | undefined, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const count = commands.read("pricingCount", prepare(decodePriceSetRead), ({ service, context }, args) => service.listAndCountPriceSets(args.filters as FilterablePriceSetProps | undefined, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const retrieve = commands.read("pricingRetrieve", prepare(decodePriceSetRetrieve), ({ service, context }, args) => service.retrievePriceSet(args.id, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const calculate = commands.read("pricingCalculate", prepare(decodePricingCalculation), ({ service, context }, args) =>
      service.calculatePrices({ id: [...args.filters.id] }, args.pricingContext, context));
    const joiner = pricingStaticResources.joinerConfig;
    if (!joiner) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = { aliases: yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : joiner.alias === undefined ? [] : [joiner.alias]).filter(alias => alias.entity === "PriceSet") }),
      reads: [{ model: "PriceSet", command: count, table: prepared.table, paths: prepared.paths, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }],
    };
    const createPriceSets = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments, encode: ([sets]) => sets,
      output: commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "storedCorruption"),
      moduleEvents: ["price_set", "price", "price_rule"].map(objectName => buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "created" })),
    });
    const createPriceLists = yield* defineWorkflowMethod({ command: createList, arguments: decodeCreateListArguments,
      encode: ([lists]) => lists,
      output: commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }),
        [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isLengthBetween(1, 4)), "storedCorruption"),
      moduleEvents: ["price_list", "price", "price_list_rule"].map(objectName =>
        buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "created" })),
    });
    const createPricePreferences = yield* defineWorkflowMethod({ command: createPreference,
      arguments: decodeCreatePreferenceArguments, encode: ([preferences]) => preferences,
      output: commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }),
        [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isLengthBetween(1, 4)), "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PRICING,
        objectName: "price_preference", action: "created" })],
    });
    const workflow = yield* defineWorkflowModule({ name: Modules.PRICING, source: module.description,
      methods: { createPriceSets, createPriceLists, createPricePreferences }, graph,
      logical: { ...pricingLogicalCreateEventPolicy(), commands: [create, createList, createPreference, list, count, retrieve, calculate] },
    });
    return { create, createList, createPreference, list, count, retrieve, calculate,
      commands: [create, createList, createPreference, list, count, retrieve, calculate], graph, workflow, withService: module.use };
  }));
});

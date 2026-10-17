import { Effect, Result, Schema } from "effect";
import { Price, PriceSet, PriceRule, PriceList, PriceListRule, PricePreference } from "@medusajs/pricing/models";
import { PricingModuleService } from "@medusajs/pricing/services";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreatePriceSetDTO, PriceSetDTO, FilterablePriceSetProps, FindConfig, PricingRepositoryService, PricingTypes } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "./schema";
import { preparePricingRepository } from "./repository";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";

import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { PriceSetsInput, PriceListsInput, PricePreferencesInput, PricingId, decodePriceSetCreate, decodePriceListCreate, decodePricePreferenceCreate, decodePriceSetRead, decodePriceSetRetrieve,
  PriceSetsUpsertInput, PriceSetsUpdateInput, PriceSetFilters, decodePriceSetUpsert, decodePriceSetUpdate,
  ProductUpdatePriceListsInput, decodeProductUpdatePriceListCreate } from "./input";
import { decodePricingCalculation } from "./calculation";
import { pricingLogicalCreateEventPolicy } from "./events";
import { pricingLogicalMutationEventPolicy } from "./mutation-events";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { PricingLifecycleSelection, PricingLifecycleConfig, decodePricingLifecycleInput } from "./lifecycle";
import { pricingLogicalProductUpdateEventPolicy } from "./lifecycle-events";
import { StorePreferenceFilters, StorePreferenceUpserts, StorePreferenceIds, decodeStorePreferenceFilters,
  decodeStorePreferenceIds, compileStorePreferenceContracts } from "./preference-input";
import { pricingStorePreferencePolicy } from "./preference-receipt";
const decodeCreateArguments = commerceDecoder(Schema.Tuple([PriceSetsInput]), "invalidInput");
const decodeCreatePreferenceArguments = commerceDecoder(Schema.Tuple([PricePreferencesInput]), "invalidInput");
const decodeStorePreferenceListArguments = commerceDecoder(Schema.Tuple([StorePreferenceFilters]), "invalidInput");
const decodeStorePreferenceUpsertArguments = commerceDecoder(Schema.Tuple([StorePreferenceUpserts]), "invalidInput");
const decodeStorePreferenceDeleteArguments = commerceDecoder(Schema.Tuple([StorePreferenceIds]), "invalidInput");
const decodeUpsertArguments = commerceDecoder(Schema.Tuple([PriceSetsUpsertInput]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([PriceSetsUpdateInput.fields.selector, PriceSetsUpdateInput.fields.update]), "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Union([Schema.Tuple([PriceSetFilters]), Schema.Tuple([PriceSetFilters, NativePreimageConfig])]), "invalidInput");
const decodeSoftDeleteArguments = commerceDecoder(Schema.Union([Schema.Tuple([PricingLifecycleSelection]),
  Schema.Tuple([PricingLifecycleSelection, PricingLifecycleConfig])]), "invalidInput");

export const makeLocalPricingCommands = Effect.fn("PricingAdapter.commands")(function* (admission: "create" | "variant-updates" | "product-updates" | "store-preferences" = "create") {
  if (admission !== "create" && admission !== "variant-updates" && admission !== "product-updates" && admission !== "store-preferences") return yield* Effect.fail(commerceError("unsupportedProfile"));
  const mutable = admission === "variant-updates" || admission === "product-updates", lifecycle = admission === "product-updates";
  const preferences = admission === "store-preferences";
  const metadata = yield* capturePricingMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* preparePricingRepository(metadata.frame, mutable, lifecycle, preferences);
    const preferenceContracts = yield* compileStorePreferenceContracts(metadata.frame);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse,
        });
      return { baseRepository: bound.repository, repository: (model: typeof Price | typeof PriceSet | typeof PriceRule | typeof PriceList | typeof PriceListRule | typeof PricePreference) =>
        preferences ? model === PricePreference ? bound.preferenceRepository : bound.denied :
        model === PriceSet ? bound.repository : model === Price ? bound.priceRepository : model === PriceList ? bound.listRepository : model === PriceRule ? bound.ruleRepository :
          model === PricePreference ? bound.preferenceRepository : bound.denied,
      events: bound.mutationEvents, eventBus, refuse: bound.refuse, calculatePrices: bound.calculatePrices };
    };
    const module = yield* defineCommerceModule({ name: "flarex-pricing-local",
      models: [PriceSet, Price, PriceRule, PriceList, PriceListRule, PricePreference],
      profile: { name: preferences ? "pricing-store-preferences" : lifecycle ? "pricing-product-updates" : mutable ? "pricing-variant-updates" : "pricing-base-prices", capabilities: [], bind },
      extensions: { pricingRepository: { mode: "add", create: ({ binding }) => ({ calculatePrices: binding.calculatePrices } satisfies PricingRepositoryService) } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new PricingModuleService(container, { scope: "internal" });
        return { service: { createPriceSets: preferences ? binding.refuse : native.createPriceSets.bind(native), createPriceLists: preferences ? binding.refuse : native.createPriceLists.bind(native),
          createPricePreferences: preferences ? binding.refuse : native.createPricePreferences.bind(native),
          listPriceSets: preferences ? binding.refuse : native.listPriceSets.bind(native),
          retrievePriceSet: preferences ? binding.refuse : native.retrievePriceSet.bind(native), listAndCountPriceSets: preferences ? binding.refuse : native.listAndCountPriceSets.bind(native),
          calculatePrices: preferences ? binding.refuse : native.calculatePrices.bind(native), upsertPriceSets: mutable ? native.upsertPriceSets.bind(native) : binding.refuse,
          updatePriceSets: mutable ? native.updatePriceSets.bind(native) : binding.refuse,
          softDeletePriceSets: lifecycle ? native.softDeletePriceSets.bind(native) : binding.refuse,
          listPricePreferences: preferences ? native.listPricePreferences.bind(native) : binding.refuse,
          upsertPricePreferences: preferences ? native.upsertPricePreferences.bind(native) : binding.refuse,
          deletePricePreferences: preferences ? native.deletePricePreferences.bind(native) : binding.refuse }, context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const prepare = commerceCommandPreparation("PricingCommand.prepare");
    const decodeCreateListArguments = commerceDecoder(Schema.Tuple([lifecycle ? ProductUpdatePriceListsInput : PriceListsInput]), "invalidInput");
    const softDeletePriceSetsCommand = commands.write("pricingSoftDeletePriceSets", prepare(decodePricingLifecycleInput), ({ service, context }, data) =>
      service.softDeletePriceSets(structuredClone(data.selector),
        data.config.returnLinkableKeys === undefined ? {} : { returnLinkableKeys: [...data.config.returnLinkableKeys] }, context));
    const upsert = commands.write("pricingUpsert", prepare(decodePriceSetUpsert), ({ service, context }, data) =>
      service.upsertPriceSets(data.map(set => ({ ...set, prices: set.prices.map(price => ({ ...price })) })) as PricingTypes.UpsertPriceSetDTO[], context));
    const update = commands.write("pricingUpdate", prepare(decodePriceSetUpdate), ({ service, context }, data) =>
      service.updatePriceSets({ id: typeof data.selector.id === "string" ? [data.selector.id] : [...data.selector.id] },
        { prices: data.update.prices.map(price => ({ ...price })) } as PricingTypes.UpdatePriceSetDTO, context));
    // SAFETY: public inputs are checked above; native DTOs admit a wider numeric
    // and rule grammar. The selected DAL validates normalized graph inputs.
    const create = commands.write("pricingCreate", prepare(decodePriceSetCreate), ({ service, context }, data) =>
      Array.isArray(data) ? service.createPriceSets(data as CreatePriceSetDTO[], context) : service.createPriceSets(data as CreatePriceSetDTO, context));
    const createList = commands.write("pricingCreateList", prepare(lifecycle ? decodeProductUpdatePriceListCreate : decodePriceListCreate), ({ service, context }, data) =>
      service.createPriceLists(data.map(list => {
        const { prices, rules, ...fields } = list;
        return { ...fields, prices: prices.map(price => ({ ...price })),
          ...(rules === undefined ? {} : { rules: { region_id: [...rules.region_id] } }) };
      }) as PricingTypes.CreatePriceListDTO[], context));
    const createPreference = commands.write("pricingCreatePreference", prepare(decodePricePreferenceCreate),
      ({ service, context }, data) => service.createPricePreferences(data.map(preference => ({ ...preference })), context));
    const preferenceList = commands.read("pricingStorePreferenceList", prepare(decodeStorePreferenceFilters),
      ({ service, context }, filters) => service.listPricePreferences({ $or: filters.$or.map(pair => ({ ...pair })) }, {}, context));
    const preferenceUpsert = commands.write("pricingStorePreferenceUpsert", prepare(preferenceContracts.decodeUpsert),
      ({ service, context }, data) => service.upsertPricePreferences(data.map(row => ({ ...row })), context));
    const preferenceDelete = commands.write("pricingStorePreferenceDelete", prepare(decodeStorePreferenceIds), async ({ service, context }, ids) => {
      const result = await service.deletePricePreferences([...ids], context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const list = commands.read("pricingList", prepare(decodePriceSetRead), ({ service, context }, args) => service.listPriceSets(args.filters as FilterablePriceSetProps | undefined, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const count = commands.read("pricingCount", prepare(decodePriceSetRead), ({ service, context }, args) => service.listAndCountPriceSets(args.filters as FilterablePriceSetProps | undefined, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const retrieve = commands.read("pricingRetrieve", prepare(decodePriceSetRetrieve), ({ service, context }, args) => service.retrievePriceSet(args.id, args.config as FindConfig<PriceSetDTO> | undefined, context));
    const calculate = commands.read("pricingCalculate", prepare(decodePricingCalculation), ({ service, context }, args) =>
      service.calculatePrices({ id: [...args.filters.id] }, args.pricingContext, context));
    const joiner = pricingStaticResources.joinerConfig;
    if (!joiner) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = preferences ? { aliases: [], reads: [] } : { aliases: yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : joiner.alias === undefined ? [] : [joiner.alias]).filter(alias => alias.entity === "PriceSet") }),
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
      moduleEvents: ["price_list", "price", "price_list_rule", ...(lifecycle ? ["price_rule"] : [])].map(objectName =>
        buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "created" })),
    });
    const createPricePreferences = yield* defineWorkflowMethod({ command: createPreference,
      arguments: decodeCreatePreferenceArguments, encode: ([preferences]) => preferences,
      output: commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }),
        [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isLengthBetween(1, 4)), "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PRICING,
        objectName: "price_preference", action: "created" })],
    });
    const decodeOutput = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId,
      prices: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)) }), [Schema.Record(Schema.String, Schema.Json)]))
      .check(Schema.isMaxLength(4)), "storedCorruption");
    const mutationEvents = ["price", "price_rule"].flatMap(objectName => ["created", "updated", "deleted"].map(action =>
      buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action })));
    const upsertPriceSets = yield* defineWorkflowMethod({ command: upsert,
      arguments: decodeUpsertArguments, encode: ([sets]) => sets,
      output: decodeOutput, moduleEvents: mutationEvents });
    const updatePriceSets = yield* defineWorkflowMethod({ command: update,
      arguments: decodeUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: decodeOutput, moduleEvents: mutationEvents });
    const softDeletePriceSets = yield* defineWorkflowMethod({ command: softDeletePriceSetsCommand, arguments: decodeSoftDeleteArguments,
      encode: args => ({ selector: args[0], config: args[1] ?? {} }),
      output: commerceDecoder(Schema.Record(Schema.String, Schema.Array(PricingId).check(Schema.isMaxLength(16))), "storedCorruption"),
      moduleEvents: ["price_set", "price", "price_rule"].map(objectName => buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "deleted" })),
    });
    const listPricePreferences = yield* defineWorkflowMethod({ command: preferenceList,
      arguments: decodeStorePreferenceListArguments, encode: ([filters]) => filters,
      output: preferenceContracts.decodeOutput });
    const upsertPricePreferences = yield* defineWorkflowMethod({ command: preferenceUpsert,
      arguments: decodeStorePreferenceUpsertArguments, encode: ([rows]) => rows,
      output: preferenceContracts.decodeOutput, moduleEvents: ["created", "updated"].map(action =>
        buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_preference", action })) });
    const deletePricePreferences = yield* defineWorkflowMethod({ command: preferenceDelete,
      arguments: decodeStorePreferenceDeleteArguments, encode: ([ids]) => ids,
      output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PRICING,
        objectName: "price_preference", action: "deleted" })] });
    const admitted = preferences ? [preferenceList, preferenceUpsert, preferenceDelete]
      : [create, createList, createPreference, list, count, retrieve, calculate, ...(mutable ? [upsert, update] : []), ...(lifecycle ? [softDeletePriceSetsCommand] : [])];
    const listPriceSets = yield* defineWorkflowMethod({ command: list, arguments: decodeListArguments,
      encode: args => ({ filters: args[0], ...(args.length === 1 ? {} : { config: nativePreimageSelection(args[1], graph.reads[0]!) }) }),
      output: commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption") });
    const workflow = yield* defineWorkflowModule({ name: Modules.PRICING, source: module.description,
      methods: { ...(preferences ? { listPricePreferences, upsertPricePreferences, deletePricePreferences } : {}),
        ...(!preferences ? { createPriceSets, createPriceLists, createPricePreferences, ...(mutable ? { upsertPriceSets, updatePriceSets, listPriceSets } : {}), ...(lifecycle ? { softDeletePriceSets } : {}) } : {}) }, graph,
      logical: { ...(preferences ? pricingStorePreferencePolicy(preferenceContracts) : lifecycle ? pricingLogicalProductUpdateEventPolicy() : mutable ? pricingLogicalMutationEventPolicy() : pricingLogicalCreateEventPolicy()), commands: admitted },
    });
    return { create, createList, createPreference, preferenceList, preferenceUpsert, preferenceDelete, list, count, retrieve, calculate, ...(mutable ? { upsert, update } : {}),
      ...(lifecycle ? { softDeletePriceSets: softDeletePriceSetsCommand } : {}), commands: admitted, graph, workflow, withService: module.use };
  }));
});

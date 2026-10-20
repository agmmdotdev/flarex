import { Effect, Result, Schema } from "effect";
import { Price, PriceSet, PriceRule, PriceList, PriceListRule, PricePreference } from "@medusajs/pricing/models";
import { PricingModuleService } from "@medusajs/pricing/services";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreatePriceSetDTO, PriceSetDTO, FilterablePriceSetProps, FindConfig, PricingRepositoryService, PricingTypes } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { capturePricingMetadata } from "./schema";
import { preparePricingRepository, type PricingRepositoryAdmission } from "./repository";
import type { CommercePromiseOwner } from "../../module/promise-owner";
import { defineCommerceModule } from "../../module/definition";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceDecoder } from "../../value/decoder";

import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod, type WorkflowMethod } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { PriceSetsInput, PriceListsInput, PricePreferencesInput, PricingId, decodePriceSetCreate, decodePriceListCreate, decodePricePreferenceCreate, decodePriceSetRead, decodePriceSetRetrieve,
  PriceSetsUpsertInput, PriceSetsUpdateInput, PriceSetFilters, decodePriceSetUpsert, decodePriceSetUpdate,
} from "./input";
import { compilePriceListCreationContracts, decodePriceListDeletionIds, decodePriceListDeletionArguments } from "./list-input";
import { pricingListCreationPolicy } from "./list-creation-receipt";
import { decodePricingCalculation } from "./calculation";
import { pricingLogicalCreateEventPolicy } from "./events";
import { pricingLogicalMutationEventPolicy } from "./mutation-events";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { PricingLifecycleSelection, PricingLifecycleConfig, decodePricingLifecycleInput } from "./lifecycle";
import { pricingLogicalProductUpdateEventPolicy } from "./lifecycle-events";
import { StorePreferenceFilters, StorePreferenceUpserts, PricePreferenceIds, decodeStorePreferenceFilters,
  decodePricePreferenceIds, compilePricePreferenceContracts, PricePreferenceUpdateSelector, PricePreferenceUpdateData,
  PricePreferenceUpdateUpserts, decodePricePreferenceUpdate, decodePricePreferenceUpdateList,
  decodePricePreferenceUpdateUpserts, decodePricePreferenceDeletionIds, decodePricePreferenceDeletionArguments,
  decodePricePreferenceDeletionOutput } from "./preference-input";
import { pricingPreferencePolicy } from "./preference-receipt";
import { ShippingPriceSetsInput, ShippingPricingSelection, ShippingPriceSetDeletionIds, decodeShippingPriceSetCreate,
  decodeShippingPriceSetDeletionIds, decodeShippingPricingLifecycle, compileShippingPricingOutput, compileShippingPricingMutationContracts,
  ShippingPricingIdConfig, ShippingPriceReadInput, decodeShippingPriceRead, decodeShippingRuleRead } from "./shipping-input";
import { pricingShippingOptionPolicy } from "./shipping-receipt";
const decodeCreateArguments = commerceDecoder(Schema.Tuple([PriceSetsInput]), "invalidInput");
const decodeCreatePreferenceArguments = commerceDecoder(Schema.Tuple([PricePreferencesInput]), "invalidInput");
const decodeStorePreferenceListArguments = commerceDecoder(Schema.Tuple([StorePreferenceFilters]), "invalidInput");
const decodeStorePreferenceUpsertArguments = commerceDecoder(Schema.Tuple([StorePreferenceUpserts]), "invalidInput");
const decodeUpdatePreferenceUpsertArguments = commerceDecoder(Schema.Tuple([PricePreferenceUpdateUpserts]), "invalidInput");
const decodePreferenceDeleteArguments = commerceDecoder(Schema.Tuple([PricePreferenceIds]), "invalidInput");
const decodeUpsertArguments = commerceDecoder(Schema.Tuple([PriceSetsUpsertInput]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([PriceSetsUpdateInput.fields.selector, PriceSetsUpdateInput.fields.update]), "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Union([Schema.Tuple([PriceSetFilters]), Schema.Tuple([PriceSetFilters, NativePreimageConfig])]), "invalidInput");
const decodeSoftDeleteArguments = commerceDecoder(Schema.Union([Schema.Tuple([PricingLifecycleSelection]),
  Schema.Tuple([PricingLifecycleSelection, PricingLifecycleConfig])]), "invalidInput");
const nativePricingRouting = { __joinerConfig: PricingModuleService.prototype.__joinerConfig(),
  __definition: { key: Modules.PRICING, defaultPackage: "@medusajs/pricing", label: "Pricing", isQueryable: true,
    defaultModuleDeclaration: { scope: "internal" as const } } };
const shippingLifecycleServices = new WeakMap<object, { readonly routing: typeof nativePricingRouting;
  readonly softDelete: WorkflowMethod; readonly restore: WorkflowMethod }>();
/** Only the selected Shipping profile supplies native Pricing lifecycle calls
 * to installed Link cascades. Keep the full native linkable-key metadata. */
export function shippingPricingLifecycleServiceDefinition(input: unknown) {
  const definition = typeof input === "object" && input !== null ? shippingLifecycleServices.get(input) : undefined;
  return definition === undefined ? undefined : { ...definition, routing: structuredClone(definition.routing) };
}

export const makeLocalPricingCommands = Effect.fn("PricingAdapter.commands")(function* (admission: PricingRepositoryAdmission = "create") {
  if (admission !== "create" && admission !== "variant-updates" && admission !== "product-updates" && admission !== "price-preferences" && admission !== "price-preference-updates" && admission !== "price-preference-deletions" && admission !== "price-list-creations" && admission !== "shipping-options" && admission !== "shipping-option-updates") return yield* Effect.fail(commerceError("unsupportedProfile"));
  const mutable = admission === "variant-updates" || admission === "product-updates", lifecycle = admission === "product-updates";
  const preferenceUpdates = admission === "price-preference-updates";
  const preferenceDeletions = admission === "price-preference-deletions";
  const preferences = admission === "price-preferences" || preferenceUpdates || preferenceDeletions;
  const shippingUpdates = admission === "shipping-option-updates";
  const shipping = admission === "shipping-options" || shippingUpdates;
  const listCreations = admission === "price-list-creations";
  const metadata = yield* capturePricingMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* preparePricingRepository(metadata.frame, admission);
    const listContracts = yield* compilePriceListCreationContracts(metadata.frame);
    const preferenceContracts = yield* compilePricePreferenceContracts(metadata.frame);
    const preferencePolicy = pricingPreferencePolicy(preferenceContracts);
    const shippingOutput = yield* compileShippingPricingOutput(metadata.frame);
    const shippingMutation = yield* compileShippingPricingMutationContracts(metadata.frame);
    const bind = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
      const bound = prepared.bind(ctx, owner);
      const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse,
        });
      return { baseRepository: bound.repository, repository: (model: typeof Price | typeof PriceSet | typeof PriceRule | typeof PriceList | typeof PriceListRule | typeof PricePreference) =>
        preferences ? model === PricePreference ? bound.preferenceRepository : bound.denied :
        listCreations ? model === PriceList ? bound.listRepository : bound.denied :
        model === PriceSet ? bound.repository : model === Price ? bound.priceRepository : model === PriceList ? bound.listRepository : model === PriceRule ? bound.ruleRepository :
          model === PricePreference ? bound.preferenceRepository : bound.denied,
      events: bound.mutationEvents, eventBus, refuse: bound.refuse, calculatePrices: bound.calculatePrices };
    };
    const module = yield* defineCommerceModule({ name: "flarex-pricing-local",
      models: [PriceSet, Price, PriceRule, PriceList, PriceListRule, PricePreference],
      profile: { name: listCreations ? "pricing-price-list-creations" : shippingUpdates ? "pricing-shipping-option-updates" : shipping ? "pricing-shipping-options" : preferenceDeletions ? "pricing-price-preference-deletions" : preferenceUpdates ? "pricing-price-preference-updates" : preferences ? "pricing-price-preferences" : lifecycle ? "pricing-product-updates" : mutable ? "pricing-variant-updates" : "pricing-base-prices", capabilities: [], bind },
      extensions: { pricingRepository: { mode: "add", create: ({ binding }) => ({ calculatePrices: binding.calculatePrices } satisfies PricingRepositoryService) } },
      service: ({ binding, dependencies, context }) => {
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new PricingModuleService(container, { scope: "internal" });
        return { service: { createPriceSets: preferences || listCreations ? binding.refuse : native.createPriceSets.bind(native), createPriceLists: preferences || shipping ? binding.refuse : native.createPriceLists.bind(native),
          deletePriceLists: listCreations ? native.deletePriceLists.bind(native) : binding.refuse,
          createPricePreferences: shipping || preferenceUpdates || preferenceDeletions || listCreations ? binding.refuse : native.createPricePreferences.bind(native),
          listPriceSets: preferences || listCreations ? binding.refuse : native.listPriceSets.bind(native),
          retrievePriceSet: preferences || listCreations ? binding.refuse : native.retrievePriceSet.bind(native), listAndCountPriceSets: preferences || listCreations ? binding.refuse : native.listAndCountPriceSets.bind(native),
          calculatePrices: preferences || shipping || listCreations ? binding.refuse : native.calculatePrices.bind(native), upsertPriceSets: mutable ? native.upsertPriceSets.bind(native) : binding.refuse,
          updatePriceSets: mutable || shippingUpdates ? native.updatePriceSets.bind(native) : binding.refuse,
          listPrices: shippingUpdates ? native.listPrices.bind(native) : binding.refuse,
          listPriceRules: shippingUpdates ? native.listPriceRules.bind(native) : binding.refuse,
          createPriceRules: shippingUpdates ? native.createPriceRules.bind(native) : binding.refuse,
          softDeletePriceSets: lifecycle || shipping ? native.softDeletePriceSets.bind(native) : binding.refuse,
          restorePriceSets: shipping ? native.restorePriceSets.bind(native) : binding.refuse,
          deletePriceSets: shipping ? native.deletePriceSets.bind(native) : binding.refuse,
          listPricePreferences: preferences && !preferenceDeletions ? native.listPricePreferences.bind(native) : binding.refuse,
          updatePricePreferences: preferenceUpdates ? native.updatePricePreferences.bind(native) : binding.refuse,
          upsertPricePreferences: preferences && !preferenceDeletions ? native.upsertPricePreferences.bind(native) : binding.refuse,
          deletePricePreferences: preferences && !preferenceUpdates && !preferenceDeletions ? native.deletePricePreferences.bind(native) : binding.refuse,
          softDeletePricePreferences: preferenceDeletions ? native.softDeletePricePreferences.bind(native) : binding.refuse,
          restorePricePreferences: preferenceDeletions ? native.restorePricePreferences.bind(native) : binding.refuse }, context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const prepare = commerceCommandPreparation("PricingCommand.prepare");
    const decodeCreateListArguments = commerceDecoder(Schema.Tuple([PriceListsInput]), "invalidInput");
    const softDeletePriceSetsCommand = commands.write("pricingSoftDeletePriceSets", prepare(shipping ? decodeShippingPricingLifecycle : decodePricingLifecycleInput), ({ service, context }, data) =>
      service.softDeletePriceSets(structuredClone(data.selector),
        data.config.returnLinkableKeys === undefined ? {} : { returnLinkableKeys: [...data.config.returnLinkableKeys] }, context));
    const restorePriceSetsCommand = commands.write("pricingRestorePriceSets", prepare(decodeShippingPricingLifecycle), ({ service, context }, data) =>
      service.restorePriceSets(structuredClone(data.selector),
        data.config.returnLinkableKeys === undefined ? {} : { returnLinkableKeys: [...data.config.returnLinkableKeys] }, context));
    const deletePriceSetsCommand = commands.write("pricingDeletePriceSets", prepare(decodeShippingPriceSetDeletionIds), async ({ service, context }, ids) => {
      const result = await service.deletePriceSets([...ids], context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const upsert = commands.write("pricingUpsert", prepare(decodePriceSetUpsert), ({ service, context }, data) =>
      service.upsertPriceSets(data.map(set => ({ ...set, prices: set.prices.map(price => ({ ...price })) })) as PricingTypes.UpsertPriceSetDTO[], context));
    const update = commands.write("pricingUpdate", prepare(decodePriceSetUpdate), ({ service, context }, data) =>
      service.updatePriceSets({ id: typeof data.selector.id === "string" ? [data.selector.id] : [...data.selector.id] },
        { prices: data.update.prices.map(price => ({ ...price })) } as PricingTypes.UpdatePriceSetDTO, context));
    const shippingUpdate = commands.write("pricingUpdate", prepare(shippingMutation.decodeUpdate), async ({ service, context }, data) => {
      // The pinned UpdatePriceSetDTO incorrectly requires creation fields, while
      // its executing native method accepts witnessed partial {id}/{id,amount}.
      // Keep those checked omissions at this single foreign callable boundary;
      // complete command/result contracts still authenticate every actual row.
      const result: unknown = await Reflect.apply(service.updatePriceSets, service,
        [data.selector, { prices: data.update.prices.map(price => ({ ...price })) }, context]);
      return result;
    });
    const ids = Schema.Array(PricingId).check(Schema.isMaxLength(8));
    const shippingListPrices = commands.read("pricingShippingListPrices", prepare(decodeShippingPriceRead), ({ service, context }, data) =>
      service.listPrices({ id: [...data.filters.id] }, { select: [...data.config.select] }, context));
    const shippingListRules = commands.read("pricingShippingListPriceRules", prepare(decodeShippingRuleRead), ({ service, context }, data) =>
      service.listPriceRules("id" in data.filters ? { id: [...data.filters.id] } : { price_id: [...data.filters.price_id] },
        "select" in data.config ? { select: [...data.config.select] } : {}, context));
    const shippingCreateRules = commands.write("pricingShippingCreatePriceRules", prepare(shippingMutation.decodeRuleRows), ({ service, context }, data) =>
      service.createPriceRules(data.map(rule => ({ ...rule })), context));
    // SAFETY: public inputs are checked above; native DTOs admit a wider numeric
    // and rule grammar. The selected DAL validates normalized graph inputs.
    const create = commands.write("pricingCreate", prepare(shipping ? decodeShippingPriceSetCreate : decodePriceSetCreate), ({ service, context }, data) =>
      Array.isArray(data) ? service.createPriceSets(data as CreatePriceSetDTO[], context) : service.createPriceSets(data as CreatePriceSetDTO, context));
    // The existing module command also admits exact numeric strings. Native
    // workflow inputs stay numeric; preserve those checked module omissions at
    // this single foreign callable boundary without reimplementing defaults.
    const createList = commands.write("pricingCreateList", prepare(decodePriceListCreate),
      ({ service, context }, data): Promise<unknown> => Reflect.apply(service.createPriceLists, service, [structuredClone(data), context]));
    const deleteList = commands.write("pricingDeleteList", prepare(decodePriceListDeletionIds), async ({ service, context }, ids) => {
      const result = await service.deletePriceLists([...ids], context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    // The pinned DTO omits null although native DML accepts a nullable value
    // and native creation normalizes a null tax flag. The checked command input
    // crosses that foreign typing discrepancy once; complete DML output and
    // receipt validation retain the runtime contract.
    const createPreference = commands.write("pricingCreatePreference", prepare(decodePricePreferenceCreate),
      ({ service, context }, data): Promise<unknown> => Reflect.apply(service.createPricePreferences, service,
        [data.map(preference => ({ ...preference })), context]));
    const preferenceList = commands.read("pricingStorePreferenceList", prepare(decodeStorePreferenceFilters),
      ({ service, context }, filters) => service.listPricePreferences({ $or: filters.$or.map(pair => ({ ...pair })) }, {}, context));
    const preferenceUpsert = commands.write("pricingStorePreferenceUpsert", prepare(preferenceContracts.decodeUpsert),
      ({ service, context }, data) => service.upsertPricePreferences(data.map(row => ({ ...row })), context));
    const preferenceUpdateList = commands.read("pricingPreferenceUpdateList", prepare(decodePricePreferenceUpdateList),
      ({ service, context }, data): Promise<unknown> => Reflect.apply(service.listPricePreferences, service,
        [structuredClone(data.filters), structuredClone(data.config), context]));
    const preferenceUpdate = commands.write("pricingPreferenceUpdate", prepare(decodePricePreferenceUpdate),
      ({ service, context }, data): Promise<unknown> => Reflect.apply(service.updatePricePreferences, service,
        [structuredClone(data.selector), structuredClone(data.update), context]));
    const preferenceUpdateUpsert = commands.write("pricingPreferenceUpdateUpsert", prepare(decodePricePreferenceUpdateUpserts),
      ({ service, context }, data): Promise<unknown> => Reflect.apply(service.upsertPricePreferences, service,
        [data.map(row => ({ ...row })), context]));
    const preferenceSoftDelete = commands.write("pricingPreferenceSoftDeleteForWorkflow", prepare(decodePricePreferenceDeletionIds),
      ({ service, context }, ids) => service.softDeletePricePreferences([...ids], {}, context));
    const preferenceRestore = commands.write("pricingPreferenceRestoreForWorkflow", prepare(decodePricePreferenceDeletionIds),
      ({ service, context }, ids) => service.restorePricePreferences([...ids], {}, context));
    const preferenceDelete = commands.write("pricingPreferenceDelete", prepare(decodePricePreferenceIds), async ({ service, context }, ids) => {
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
    const graph: GraphModuleDefinition = preferences || listCreations ? { aliases: [], reads: [] } : { aliases: yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : joiner.alias === undefined ? [] : [joiner.alias]).filter(alias => alias.entity === "PriceSet") }),
      reads: [{ model: "PriceSet", command: count, table: prepared.table, paths: prepared.paths, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }],
    };
    const decodeShippingCreateArguments = commerceDecoder(Schema.Tuple([ShippingPriceSetsInput]), "invalidInput");
    const decodeSelectedCreateArguments = (value: unknown): Result.Result<readonly [typeof ShippingPriceSetsInput.Type], CommerceTransactionError> =>
      shipping ? decodeShippingCreateArguments(value) : decodeCreateArguments(value);
    const createPriceSets = yield* defineWorkflowMethod({ command: create,
      arguments: decodeSelectedCreateArguments, encode: ([sets]) => sets,
      output: shipping ? shippingOutput : commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "storedCorruption"),
      moduleEvents: ["price_set", "price", "price_rule"].map(objectName => buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "created" })),
    });
    const createPriceLists = yield* defineWorkflowMethod({ command: createList, arguments: decodeCreateListArguments,
      encode: ([lists]) => lists,
      output: listContracts.decodeOutput,
      moduleEvents: ["price_list", "price", "price_list_rule", "price_rule"].map(objectName =>
        buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "created" })),
    });
    const deletePriceLists = yield* defineWorkflowMethod({ command: deleteList, arguments: decodePriceListDeletionArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_list", action: "deleted" })] });
    const createPricePreferences = yield* defineWorkflowMethod({ command: createPreference,
      arguments: decodeCreatePreferenceArguments, encode: ([preferences]) => preferences,
      output: preferenceContracts.decodeOutput,
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
    const updateShippingPriceSets = yield* defineWorkflowMethod({ command: shippingUpdate,
      arguments: shippingMutation.decodeArguments, encode: ([selector, update]) => ({ selector, update }),
      output: shippingMutation.decodeOutput, moduleEvents: mutationEvents });
    const decodeSelectedPriceIds = commerceDecoder(Schema.Array(Schema.Struct({ id: PricingId })).check(Schema.isMaxLength(8)), "storedCorruption");
    const shippingPriceArguments = commerceDecoder(Schema.Tuple([ShippingPriceReadInput.fields.filters, ShippingPricingIdConfig]), "invalidInput");
    const listShippingPrices = yield* defineWorkflowMethod({ command: shippingListPrices,
      arguments: shippingPriceArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeSelectedPriceIds });
    const shippingRuleArguments = commerceDecoder(Schema.Union([
        Schema.Tuple([Schema.Struct({ id: Schema.Array(PricingId).check(Schema.isMaxLength(24)) }), ShippingPricingIdConfig]),
        Schema.Tuple([Schema.Struct({ price_id: ids })]), Schema.Tuple([Schema.Struct({ price_id: ids }), Schema.Struct({})]),
      ]), "invalidInput");
    const listShippingPriceRules = yield* defineWorkflowMethod({ command: shippingListRules,
      arguments: shippingRuleArguments, encode: args => ({ filters: args[0], config: args[1] ?? {} }),
      output: shippingMutation.decodeRuleReadOutput });
    const createShippingPriceRules = yield* defineWorkflowMethod({ command: shippingCreateRules,
      arguments: (input: unknown) => commerceDecoder(Schema.Tuple([Schema.Unknown]), "invalidInput")(input).pipe(
        Result.flatMap(([rows]) => shippingMutation.decodeRuleRows(rows).pipe(Result.map(rows => [rows] as const)))),
      encode: ([rows]) => rows, output: shippingMutation.decodeRuleRows,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_rule", action: "created" })] });
    const shippingLifecycleArguments = commerceDecoder(Schema.Union([Schema.Tuple([ShippingPricingSelection]), Schema.Tuple([ShippingPricingSelection, PricingLifecycleConfig])]), "invalidInput");
    const lifecycleOutput = commerceDecoder(Schema.Record(Schema.String, Schema.Array(PricingId).check(Schema.isMaxLength(shipping ? 48 : 16))), "storedCorruption");
    const softDeletePriceSets = yield* defineWorkflowMethod({ command: softDeletePriceSetsCommand, arguments: shipping ? shippingLifecycleArguments : decodeSoftDeleteArguments,
      encode: args => ({ selector: args[0], config: args[1] ?? {} }),
      output: lifecycleOutput,
      moduleEvents: ["price_set", "price", "price_rule"].map(objectName => buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "deleted" })),
    });
    const restorePriceSets = yield* defineWorkflowMethod({ command: restorePriceSetsCommand, arguments: shippingLifecycleArguments,
      encode: args => ({ selector: args[0], config: args[1] ?? {} }), output: lifecycleOutput,
      moduleEvents: ["price_set", "price", "price_rule"].map(objectName => buildModuleResourceEventName({ prefix: Modules.PRICING, objectName, action: "restored" })),
    });
    const deletePriceSets = yield* defineWorkflowMethod({ command: deletePriceSetsCommand,
      arguments: commerceDecoder(Schema.Tuple([ShippingPriceSetDeletionIds]), "invalidInput"), encode: ([ids]: readonly [typeof ShippingPriceSetDeletionIds.Type]) => ids,
      output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_set", action: "deleted" })] });
    const listPricePreferences = yield* defineWorkflowMethod({ command: preferenceList,
      arguments: decodeStorePreferenceListArguments, encode: ([filters]) => filters,
      output: preferenceContracts.decodeOutput });
    const upsertPricePreferences = yield* defineWorkflowMethod({ command: preferenceUpsert,
      arguments: decodeStorePreferenceUpsertArguments, encode: ([rows]) => rows,
      output: preferenceContracts.decodeOutput, moduleEvents: ["created", "updated"].map(action =>
        buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_preference", action })) });
    const preferenceUpdateListArguments = commerceDecoder(Schema.Tuple([PricePreferenceUpdateSelector, NativePreimageConfig]), "invalidInput");
    const listUpdatePricePreferences = yield* defineWorkflowMethod({ command: preferenceUpdateList,
      arguments: preferenceUpdateListArguments, encode: ([filters, config]) => ({ filters,
        config: nativePreimageSelection(config, { table: prepared.table, paths: [] }) }),
      output: preferenceContracts.decodeUpdateListOutput });
    const updatePreferenceArguments = commerceDecoder(Schema.Tuple([PricePreferenceUpdateSelector, PricePreferenceUpdateData]), "invalidInput");
    const preferenceUpdateEvents = [buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_preference", action: "updated" })];
    const updatePricePreferences = yield* defineWorkflowMethod({ command: preferenceUpdate,
      arguments: updatePreferenceArguments, encode: ([selector, update]) => ({ selector, update }),
      output: preferenceContracts.decodeOutput, moduleEvents: preferenceUpdateEvents });
    const upsertUpdatePricePreferences = yield* defineWorkflowMethod({ command: preferenceUpdateUpsert,
      arguments: decodeUpdatePreferenceUpsertArguments, encode: ([rows]) => rows,
      output: preferenceContracts.decodeOutput, moduleEvents: preferenceUpdateEvents });
    const deletePricePreferences = yield* defineWorkflowMethod({ command: preferenceDelete,
      arguments: decodePreferenceDeleteArguments, encode: ([ids]) => ids,
      output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PRICING,
        objectName: "price_preference", action: "deleted" })] });
    const softDeletePricePreferences = yield* defineWorkflowMethod({ command: preferenceSoftDelete,
      arguments: decodePricePreferenceDeletionArguments, encode: ([ids]) => ids, output: decodePricePreferenceDeletionOutput,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.PRICING, objectName: "price_preference", action: "deleted" })] });
    const restorePricePreferences = yield* defineWorkflowMethod({ command: preferenceRestore,
      arguments: decodePricePreferenceDeletionArguments, encode: ([ids]) => ids, output: decodePricePreferenceDeletionOutput });
    const admitted = listCreations ? [createList, deleteList] : preferenceDeletions ? [preferenceSoftDelete, preferenceRestore] : preferenceUpdates ? [preferenceUpdateList, preferenceUpdate, preferenceUpdateUpsert] : shippingUpdates ? [shippingUpdate, shippingListPrices, shippingListRules, shippingCreateRules, list, count, retrieve] : shipping ? [create, list, count, retrieve, softDeletePriceSetsCommand, restorePriceSetsCommand, deletePriceSetsCommand] : preferences ? [createPreference, preferenceList, preferenceUpsert, preferenceDelete]
      : [create, createList, createPreference, list, count, retrieve, calculate, ...(mutable ? [upsert, update] : []), ...(lifecycle ? [softDeletePriceSetsCommand] : [])];
    const listPriceSets = yield* defineWorkflowMethod({ command: list, arguments: decodeListArguments,
      encode: args => ({ filters: args[0], ...(args.length === 1 ? {} : { config: nativePreimageSelection(args[1], graph.reads[0]!) }) }),
      output: commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption") });
    const existingPolicy = shipping ? pricingShippingOptionPolicy(preferencePolicy, shippingOutput, shippingUpdates ? shippingMutation : undefined, shippingUpdates ? prepared : undefined) : preferences ? preferencePolicy : lifecycle ? pricingLogicalProductUpdateEventPolicy(preferencePolicy) : mutable ? pricingLogicalMutationEventPolicy(preferencePolicy) : pricingLogicalCreateEventPolicy(preferencePolicy);
    const policy = listCreations ? pricingListCreationPolicy(listContracts) : !preferences && !shipping
      ? pricingListCreationPolicy(listContracts, existingPolicy) : existingPolicy;
    const workflow = yield* defineWorkflowModule({ name: Modules.PRICING, source: module.description,
      methods: { ...(listCreations ? { createPriceLists, deletePriceLists } : {}), ...(shippingUpdates ? { updatePriceSets: updateShippingPriceSets, listPrices: listShippingPrices,
        listPriceRules: listShippingPriceRules, createPriceRules: createShippingPriceRules } : {}),
        ...(preferences && !preferenceUpdates && !preferenceDeletions ? { createPricePreferences, listPricePreferences, upsertPricePreferences, deletePricePreferences } : {}),
        ...(preferenceUpdates ? { listPricePreferences: listUpdatePricePreferences, updatePricePreferences, upsertPricePreferences: upsertUpdatePricePreferences } : {}),
        ...(preferenceDeletions ? { softDeletePricePreferences, restorePricePreferences } : {}),
        ...(!preferences && !shippingUpdates && !listCreations ? { createPriceSets, ...(!shipping ? { createPriceLists, createPricePreferences } : {}), ...(mutable ? { upsertPriceSets, updatePriceSets, listPriceSets } : {}), ...(lifecycle || shipping ? { softDeletePriceSets } : {}), ...(shipping ? { restorePriceSets, deletePriceSets } : {}) } : {}) }, graph,
      logical: { ...policy, commands: admitted },
    });
    if (shipping && !shippingUpdates) shippingLifecycleServices.set(workflow, { routing: nativePricingRouting, softDelete: softDeletePriceSets, restore: restorePriceSets });
    return { create, createList, deleteList, createPreference, preferenceList, preferenceUpsert, preferenceDelete,
      preferenceUpdateList, preferenceUpdate, preferenceUpdateUpsert, list, count, retrieve, calculate, ...(mutable ? { upsert, update } : {}),
      preferenceSoftDelete, preferenceRestore,
      ...(shippingUpdates ? { shippingUpdate, shippingListPrices, shippingListRules, shippingCreateRules } : {}),
      ...(lifecycle || shipping && !shippingUpdates ? { softDeletePriceSets: softDeletePriceSetsCommand } : {}), ...(shipping && !shippingUpdates ? { restorePriceSets: restorePriceSetsCommand, deletePriceSets: deletePriceSetsCommand } : {}), commands: admitted, graph, workflow, withService: module.use };
  }));
});

import { Effect, Result, Schema } from "effect";
import { ShippingOption, ServiceZone, FulfillmentSet, FulfillmentProvider } from "@medusajs/fulfillment/models";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { coerceFilterValue } from "@medusajs/drizzle/filter-value";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { Context, CreateShippingOptionDTO, FindConfig, ShippingOptionDTO, ServiceZoneDTO, FulfillmentSetDTO, FulfillmentProviderDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { commerceDecoder } from "../../value/decoder";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import type { PreparedCommerceModule } from "../../module/definition";
import type { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import type { FulfillmentPhysicalProfile } from "./fulfillment-graph-contracts";
import { captureFulfillmentCreationMetadata, captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { ShippingOptionCreates, ShippingOptionPhysicalIds, decodeShippingOptionCreates, decodeShippingOptionPhysicalIds } from "./shipping-option-create-input";
import { ShippingOptionReadFilters, ShippingProviderReadFilters, ShippingOptionReadConfig, decodeShippingOptionReadInput, decodeShippingProviderReadInput } from "./shipping-option-create-query";
import { prepareShippingOptionCreationRepository } from "./shipping-option-create-repository";
import { shippingOptionCreationPolicy } from "./shipping-option-create-receipt";

const createArguments = commerceDecoder(Schema.Tuple([ShippingOptionCreates]), "invalidInput");
const deleteArguments = commerceDecoder(Schema.Tuple([ShippingOptionPhysicalIds]), "invalidInput");
const readArguments = commerceDecoder(Schema.Union([Schema.Tuple([]), Schema.Tuple([ShippingOptionReadFilters]),
  Schema.Tuple([ShippingOptionReadFilters, Schema.Union([ShippingOptionReadConfig, Schema.Undefined])])]), "invalidInput");
const rawOptionReadArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([Schema.Struct({ id: Schema.Array(Schema.Union([Schema.String.check(Schema.isMaxLength(256)), Schema.Undefined])).check(Schema.isMaxLength(4)) })]),
  Schema.Tuple([Schema.Struct({ id: Schema.Array(Schema.Union([Schema.String.check(Schema.isMaxLength(256)), Schema.Undefined])).check(Schema.isMaxLength(4)) }), Schema.Union([ShippingOptionReadConfig, Schema.Undefined])]),
]), "invalidInput");
const providerReadArguments = commerceDecoder(Schema.Union([Schema.Tuple([ShippingProviderReadFilters]),
  Schema.Tuple([ShippingProviderReadFilters, Schema.Union([ShippingOptionReadConfig, Schema.Undefined])])]), "invalidInput");

/** Preserve native ID-array undefined coercion only at the selected Option
 * method boundary. JSON writes and every other filter remain strict. */
export function decodeShippingOptionListArguments(input: unknown) {
  return Result.gen(function* () {
    const args = yield* rawOptionReadArguments(input);
    return yield* readArguments([{ id: args[0].id.map(value => coerceFilterValue("id", value)) }, ...(args.length === 2 ? [args[1]] : [])]);
  });
}

/** Genuine native Option upsert's create branch, local Manual validation,
 * selected graph reads and retained physical inverse share one outer owner. */
const makeLocalShippingOptionCreationForProfile = Effect.fn("ShippingOptionAdapter.createCommands")(function* (profile: FulfillmentPhysicalProfile) {
  const metadata = yield* (profile === "reference-detachment" ? captureFulfillmentCreationMetadata() : captureServiceZoneCreationMetadata());
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingOptionCreationRepository(metadata.frame, profile);
    const module = yield* defineFulfillmentPersistenceModule({ name: profile === "reference-detachment" ? "flarex-shipping-option-create-reference-detachment" : "flarex-shipping-option-create",
      profile: profile === "reference-detachment" ? "shipping-option-create-reference-detachment" : "shipping-option-create", providers: "manual",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: FulfillmentPersistenceModel) => model === ShippingOption ? bound.repository
          : model === ServiceZone ? bound.zoneRepository : model === FulfillmentSet ? bound.setRepository : model === FulfillmentProvider ? bound.providerRepository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: bindShippingOptionCreationNativeService,
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    return yield* prepareShippingOptionCreationCommands(module, prepared);
  }));
});

export const makeLocalShippingOptionCreationCommands = Effect.fn("ShippingOptionAdapter.standaloneCreation")(function* () {
  return yield* makeLocalShippingOptionCreationForProfile("standalone");
});
export const makeLocalShippingOptionCreationWithReferenceDetachmentCommands = Effect.fn("ShippingOptionAdapter.referenceDetachment")(function* () {
  return yield* makeLocalShippingOptionCreationForProfile("reference-detachment");
});

type ShippingOptionNativeService = Pick<FulfillmentModuleService, "upsertShippingOptions" | "deleteShippingOptions" |
  "validateShippingOptionsForPriceCalculation" | "listShippingOptions" | "listAndCountShippingOptions" | "listServiceZones" |
  "listAndCountServiceZones" | "listFulfillmentSets" | "listAndCountFulfillmentSets" | "listFulfillmentProviders" | "listAndCountFulfillmentProviders">;
export const bindShippingOptionCreationNativeService = (native: FulfillmentModuleService) => ({
  upsertShippingOptions: native.upsertShippingOptions.bind(native), deleteShippingOptions: native.deleteShippingOptions.bind(native),
  validateShippingOptionsForPriceCalculation: native.validateShippingOptionsForPriceCalculation.bind(native),
  listShippingOptions: native.listShippingOptions.bind(native), listAndCountShippingOptions: native.listAndCountShippingOptions.bind(native),
  listServiceZones: native.listServiceZones.bind(native), listAndCountServiceZones: native.listAndCountServiceZones.bind(native),
  listFulfillmentSets: native.listFulfillmentSets.bind(native), listAndCountFulfillmentSets: native.listAndCountFulfillmentSets.bind(native),
  listFulfillmentProviders: native.listFulfillmentProviders.bind(native), listAndCountFulfillmentProviders: native.listAndCountFulfillmentProviders.bind(native),
});

/** Reuse native commands, authenticated method tokens, graph reads and receipt
 * contracts when a named combined module owns the same genuine constructor. */
export function prepareShippingOptionCreationCommands<Service extends { readonly service: ShippingOptionNativeService; readonly context: Context }>(module: PreparedCommerceModule<Service>,
  prepared: Result.Result.Success<ReturnType<typeof prepareShippingOptionCreationRepository>>) {
  return Result.gen(function* () {
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingOptionCreation.prepare");
    const upsert = commands.write("shippingOptionCreateForWorkflow", prepare(decodeShippingOptionCreates),
      // SAFETY: runtime admission preserves the native rule validator's wider
      // JSON values. Genuine native create and checked DML own their meaning.
      ({ service, context }, input) => service.upsertShippingOptions(input as CreateShippingOptionDTO[], context));
    const remove = commands.write("shippingOptionPhysicalDeleteForWorkflow", prepare(decodeShippingOptionPhysicalIds), async ({ service, context }, ids) => {
      const result = await service.deleteShippingOptions([...ids], context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const validate = commands.read("shippingOptionValidateCalculationForCreate", prepare(decodeShippingOptionCreates),
      ({ service, context }, input) => service.validateShippingOptionsForPriceCalculation(input as CreateShippingOptionDTO[], context));
    const readPrepare = prepare(decodeShippingOptionReadInput);
    const providerReadPrepare = prepare(decodeShippingProviderReadInput);
    const optionList = commands.read("shippingOptionListForCreate", readPrepare, ({ service, context }, input) => service.listShippingOptions(input.filters === undefined ? undefined : input.filters.id === undefined ? {} : { id: typeof input.filters.id === "string" ? input.filters.id : [...input.filters.id] },
      input.config as FindConfig<ShippingOptionDTO> | undefined, context));
    const zoneList = commands.read("shippingOptionServiceZoneListForCreate", readPrepare, ({ service, context }, input) => service.listServiceZones(input.filters,
      input.config as FindConfig<ServiceZoneDTO> | undefined, context));
    const setList = commands.read("shippingOptionFulfillmentSetListForCreate", readPrepare, ({ service, context }, input) => service.listFulfillmentSets(input.filters,
      input.config as FindConfig<FulfillmentSetDTO> | undefined, context));
    const providerList = commands.read("shippingOptionProviderListForCreate", providerReadPrepare, ({ service, context }, input) => service.listFulfillmentProviders(input.filters,
      input.config as FindConfig<FulfillmentProviderDTO> | undefined, context));
    const optionCount = commands.read("shippingOptionCountForCreate", readPrepare, ({ service, context }, input) => service.listAndCountShippingOptions(input.filters,
      input.config as FindConfig<ShippingOptionDTO> | undefined, context));
    const zoneCount = commands.read("shippingOptionServiceZoneCountForCreate", readPrepare, ({ service, context }, input) => service.listAndCountServiceZones(input.filters,
      input.config as FindConfig<ServiceZoneDTO> | undefined, context));
    const setCount = commands.read("shippingOptionFulfillmentSetCountForCreate", readPrepare, ({ service, context }, input) => service.listAndCountFulfillmentSets(input.filters,
      input.config as FindConfig<FulfillmentSetDTO> | undefined, context));
    const providerCount = commands.read("shippingOptionProviderCountForCreate", providerReadPrepare, ({ service, context }, input) => service.listAndCountFulfillmentProviders(input.filters,
      input.config as FindConfig<FulfillmentProviderDTO> | undefined, context));
    const event = (objectName: string, action: "created" | "deleted") => buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName, action });
    const upsertShippingOptions = yield* defineWorkflowMethod({ command: upsert, arguments: createArguments, encode: ([rows]) => rows,
      output: prepared.contracts.decodeRows, moduleEvents: ["shipping_option_type", "shipping_option", "shipping_option_rule"].map(name => event(name, "created")) });
    const deleteShippingOptions = yield* defineWorkflowMethod({ command: remove, arguments: deleteArguments, encode: ([ids]) => ids,
      output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [event("shipping_option", "deleted")] });
    const validateShippingOptionsForPriceCalculation = yield* defineWorkflowMethod({ command: validate, arguments: createArguments, encode: ([rows]) => rows,
      output: commerceDecoder(Schema.Array(Schema.Boolean).check(Schema.isMaxLength(4)), "storedCorruption") });
    const encodeRead = ([filters, config]: Result.Result.Success<ReturnType<typeof readArguments>>) => ({ ...(filters === undefined ? {} : { filters }), ...(config === undefined ? {} : { config }) });
    const decodeProjection = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
    const listShippingOptions = yield* defineWorkflowMethod({ command: optionList, arguments: decodeShippingOptionListArguments, encode: encodeRead, output: decodeProjection });
    const listServiceZones = yield* defineWorkflowMethod({ command: zoneList, arguments: readArguments, encode: encodeRead, output: decodeProjection });
    const listFulfillmentSets = yield* defineWorkflowMethod({ command: setList, arguments: readArguments, encode: encodeRead, output: decodeProjection });
    const listFulfillmentProviders = yield* defineWorkflowMethod({ command: providerList, arguments: providerReadArguments, encode: encodeRead,
      output: commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption") });
    const joiner = fulfillmentStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const selected = [[prepared.contracts.option, "ShippingOption", optionCount], [prepared.contracts.zone, "ServiceZone", zoneCount],
      [prepared.contracts.set, "FulfillmentSet", setCount], [prepared.contracts.provider, "FulfillmentProvider", providerCount]] as const;
    const selectedModels = new Set<string>(selected.map(([, model]) => model));
    const aliases = yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => typeof alias.entity === "string" && selectedModels.has(alias.entity)) });
    const reads: GraphModuleDefinition["reads"][number][] = [];
    for (const [table, model, command] of selected) reads.push({ model, command, table: yield* prepared.reads.catalog.table(table.name),
      paths: model === "ServiceZone" ? yield* relationPaths(prepared.reads.catalog, table.name, ["fulfillment_set"], { nativeFields: true }) : [],
      orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount });
    const admitted = [upsert, remove, validate, optionList, zoneList, setList, providerList, optionCount, zoneCount, setCount, providerCount],
      policy = shippingOptionCreationPolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { upsertShippingOptions, deleteShippingOptions, validateShippingOptionsForPriceCalculation,
        listShippingOptions, listServiceZones, listFulfillmentSets, listFulfillmentProviders }, graph: { aliases, reads }, logical: { ...policy, commands: admitted, ...(prepared.contracts.referenceDetachments.length ? { detachDeletedReferences: true as const } : {}) } });
    return { upsert, remove, validate, optionList, zoneList, setList, providerList, optionCount, zoneCount, setCount, providerCount,
      commands: admitted, workflow, withService: module.use, contracts: prepared.contracts, logicalEventPolicy: () => policy };
  });
}

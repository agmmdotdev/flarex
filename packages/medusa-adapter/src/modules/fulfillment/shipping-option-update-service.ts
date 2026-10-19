import { Effect, Result, Schema } from "effect";
import { ShippingOption, ShippingOptionRule, ServiceZone, FulfillmentSet, FulfillmentProvider } from "@medusajs/fulfillment/models";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { coerceFilterValue } from "@medusajs/drizzle/filter-value";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreateShippingOptionDTO, UpsertShippingOptionDTO, CreateShippingOptionRuleDTO, FindConfig, ShippingOptionDTO, ShippingOptionRuleDTO, ServiceZoneDTO, FulfillmentSetDTO, FulfillmentProviderDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { commerceDecoder } from "../../value/decoder";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { ShippingOptionUpdates, ShippingOptionUpdateFilters, ShippingOptionUpdateReadConfig, decodeShippingOptionUpdates, decodeShippingOptionUpdateRead } from "./shipping-option-update-input";
import { ShippingProviderReadFilters } from "./shipping-option-create-query";
import { prepareShippingOptionUpdateRepository } from "./shipping-option-update-repository";
import { prepareShippingOptionRuleRepository } from "./shipping-option-rule-repository";
import { shippingOptionUpdatePolicy } from "./shipping-option-update-receipt";
import { NativePreimageConfig } from "../../workflow/preimage";

const upsertArguments = commerceDecoder(Schema.Tuple([ShippingOptionUpdates]), "invalidInput");
const readArguments = commerceDecoder(Schema.Union([Schema.Tuple([]), Schema.Tuple([ShippingOptionUpdateFilters]),
  Schema.Tuple([ShippingOptionUpdateFilters, Schema.Union([ShippingOptionUpdateReadConfig, Schema.Undefined])])]), "invalidInput");
const rawOptionReadArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([Schema.Struct({ id: Schema.Array(Schema.Union([Schema.String.check(Schema.isMaxLength(256)), Schema.Undefined])).check(Schema.isMaxLength(4)) })]),
  Schema.Tuple([Schema.Struct({ id: Schema.Array(Schema.Union([Schema.String.check(Schema.isMaxLength(256)), Schema.Undefined])).check(Schema.isMaxLength(4)) }), Schema.Union([ShippingOptionUpdateReadConfig, Schema.Undefined])]),
]), "invalidInput");
const providerReadArguments = commerceDecoder(Schema.Union([Schema.Tuple([ShippingProviderReadFilters]),
  Schema.Tuple([ShippingProviderReadFilters, Schema.Union([ShippingOptionUpdateReadConfig, Schema.Undefined])])]), "invalidInput");
const decodeProviderRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(ShippingProviderReadFilters), config: Schema.optionalKey(ShippingOptionUpdateReadConfig) }), "invalidInput");

/** Native Option updates and their retained Rule restoration methods borrow
 * one genuine service, subscriber family and trusted outer settlement owner. */
export const makeLocalShippingOptionUpdateCommands = Effect.fn("ShippingOptionAdapter.updateCommands")(function* () {
  const metadata = yield* captureServiceZoneCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingOptionUpdateRepository(metadata.frame), rulePrepared = yield* prepareShippingOptionRuleRepository(metadata.frame, "shipping-option-update");
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-shipping-option-update", profile: "shipping-option-update", providers: "manual",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), rule = rulePrepared.bind(ctx, owner, bound.events);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources, capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: FulfillmentPersistenceModel) => model === ShippingOption ? bound.repository
          : model === ShippingOptionRule ? rule.repository : model === ServiceZone ? bound.zoneRepository : model === FulfillmentSet ? bound.setRepository
            : model === FulfillmentProvider ? bound.providerRepository : bound.denied, events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ upsertShippingOptions: native.upsertShippingOptions.bind(native),
        validateShippingOptionsForPriceCalculation: native.validateShippingOptionsForPriceCalculation.bind(native),
        listShippingOptions: native.listShippingOptions.bind(native), listAndCountShippingOptions: native.listAndCountShippingOptions.bind(native),
        listServiceZones: native.listServiceZones.bind(native), listAndCountServiceZones: native.listAndCountServiceZones.bind(native),
        listFulfillmentSets: native.listFulfillmentSets.bind(native), listAndCountFulfillmentSets: native.listAndCountFulfillmentSets.bind(native),
        listFulfillmentProviders: native.listFulfillmentProviders.bind(native), listAndCountFulfillmentProviders: native.listAndCountFulfillmentProviders.bind(native),
        createShippingOptionRules: native.createShippingOptionRules.bind(native), listShippingOptionRules: native.listShippingOptionRules.bind(native),
        deleteShippingOptionRules: native.deleteShippingOptionRules.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingOptionUpdate.prepare");
    const upsert = commands.write("shippingOptionUpsertForUpdate", prepare(decodeShippingOptionUpdates),
      // SAFETY: native DTOs omit managed retained projections and wider Rule
      // JSON accepted by the executing native validator and checked DML.
      ({ service, context }, input) => service.upsertShippingOptions(input as UpsertShippingOptionDTO[], context));
    const validate = commands.read("shippingOptionValidateCalculationForUpdate", prepare(decodeShippingOptionUpdates),
      ({ service, context }, input) => service.validateShippingOptionsForPriceCalculation(input as CreateShippingOptionDTO[], context));
    const optionList = commands.read("shippingOptionListForUpdate", prepare(decodeShippingOptionUpdateRead), ({ service, context }, input) => service.listShippingOptions(input.filters,
      input.config as FindConfig<ShippingOptionDTO> | undefined, context));
    const zoneList = commands.read("shippingOptionServiceZoneListForUpdate", prepare(decodeShippingOptionUpdateRead), ({ service, context }, input) => service.listServiceZones(input.filters,
      input.config as FindConfig<ServiceZoneDTO> | undefined, context));
    const setList = commands.read("shippingOptionFulfillmentSetListForUpdate", prepare(decodeShippingOptionUpdateRead), ({ service, context }, input) => service.listFulfillmentSets(input.filters,
      input.config as FindConfig<FulfillmentSetDTO> | undefined, context));
    const providerList = commands.read("shippingOptionProviderListForUpdate", prepare(decodeProviderRead), ({ service, context }, input) => service.listFulfillmentProviders(input.filters,
      input.config as FindConfig<FulfillmentProviderDTO> | undefined, context));
    const optionCount = commands.read("shippingOptionCountForUpdate", prepare(decodeShippingOptionUpdateRead), ({ service, context }, input) => service.listAndCountShippingOptions(input.filters,
      input.config as FindConfig<ShippingOptionDTO> | undefined, context));
    const zoneCount = commands.read("shippingOptionServiceZoneCountForUpdate", prepare(decodeShippingOptionUpdateRead), ({ service, context }, input) => service.listAndCountServiceZones(input.filters,
      input.config as FindConfig<ServiceZoneDTO> | undefined, context));
    const setCount = commands.read("shippingOptionFulfillmentSetCountForUpdate", prepare(decodeShippingOptionUpdateRead), ({ service, context }, input) => service.listAndCountFulfillmentSets(input.filters,
      input.config as FindConfig<FulfillmentSetDTO> | undefined, context));
    const providerCount = commands.read("shippingOptionProviderCountForUpdate", prepare(decodeProviderRead), ({ service, context }, input) => service.listAndCountFulfillmentProviders(input.filters,
      input.config as FindConfig<FulfillmentProviderDTO> | undefined, context));
    const ruleCreate = commands.write("shippingOptionRuleCreateForBatch", prepare(rulePrepared.inputs.decodeCreates),
      ({ service, context }, input) => service.createShippingOptionRules(input as CreateShippingOptionRuleDTO[], context));
    const ruleList = commands.read("shippingOptionRuleListForBatch", prepare(rulePrepared.inputs.decodeRead),
      ({ service, context }, input) => service.listShippingOptionRules(input.filters, input.config as FindConfig<ShippingOptionRuleDTO> | undefined, context));
    const ruleRemove = commands.write("shippingOptionRuleDeleteForBatch", prepare(rulePrepared.inputs.decodeIds), async ({ service, context }, input) => {
      const result = await service.deleteShippingOptionRules(input, context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const event = (objectName: string, action: "created" | "updated" | "deleted") => buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName, action });
    const upsertShippingOptions = yield* defineWorkflowMethod({ command: upsert, arguments: upsertArguments, encode: ([rows]) => rows,
      output: prepared.contracts.decodeRows, moduleEvents: [event("shipping_option", "updated"), event("shipping_option_type", "created"), event("shipping_option_type", "updated"),
        ...(["created", "updated", "deleted"] as const).map(action => event("shipping_option_rule", action))] });
    const validateShippingOptionsForPriceCalculation = yield* defineWorkflowMethod({ command: validate, arguments: upsertArguments, encode: ([rows]) => rows,
      output: commerceDecoder(Schema.Array(Schema.Boolean).check(Schema.isMaxLength(4)), "storedCorruption") });
    const encodeRead = ([filters, config]: readonly [filters?: { readonly id?: string | readonly string[] }, config?: typeof ShippingOptionUpdateReadConfig.Type | undefined]) =>
      ({ ...(filters === undefined ? {} : { filters }), ...(config === undefined ? {} : { config }) });
    const decodeOptionArgs = (input: unknown) => Result.gen(function* () {
      const args = yield* rawOptionReadArguments(input);
      return yield* readArguments([{ id: args[0].id.map(value => coerceFilterValue("id", value)) }, ...(args.length === 2 ? [args[1]] : [])]);
    });
    const decodeProjection = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
    const listShippingOptions = yield* defineWorkflowMethod({ command: optionList, arguments: decodeOptionArgs, encode: encodeRead, output: prepared.contracts.decodePreimages });
    const listServiceZones = yield* defineWorkflowMethod({ command: zoneList, arguments: readArguments, encode: encodeRead, output: decodeProjection });
    const listFulfillmentSets = yield* defineWorkflowMethod({ command: setList, arguments: readArguments, encode: encodeRead, output: decodeProjection });
    const listFulfillmentProviders = yield* defineWorkflowMethod({ command: providerList, arguments: providerReadArguments, encode: encodeRead,
      output: commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption") });
    const rawRuleArguments = commerceDecoder(Schema.Tuple([Schema.Unknown]), "invalidInput");
    const rawRuleReadArguments = commerceDecoder(Schema.Tuple([Schema.Unknown, NativePreimageConfig]), "invalidInput");
    const createRuleArguments = (input: unknown) => Result.gen(function* () {
      const [rows] = yield* rawRuleArguments(input);
      return [yield* rulePrepared.inputs.decodeCreates(rows)] as const;
    });
    const listRuleArguments = (input: unknown) => Result.gen(function* () {
      const [filters, config] = yield* rawRuleReadArguments(input);
      const decoded = yield* rulePrepared.inputs.decodeRead({ filters, config });
      return [decoded.filters, config] as const;
    });
    const deleteRuleArguments = (input: unknown) => Result.gen(function* () {
      const [ids] = yield* rawRuleArguments(input);
      return [yield* rulePrepared.inputs.decodeIds(ids)] as const;
    });
    const createShippingOptionRules = yield* defineWorkflowMethod({ command: ruleCreate, arguments: createRuleArguments,
      encode: ([rows]) => rows, output: rulePrepared.contracts.decodeRows, moduleEvents: [event("shipping_option_rule", "created")] });
    const listShippingOptionRules = yield* defineWorkflowMethod({ command: ruleList, arguments: listRuleArguments,
      encode: ([filters, config]) => ({ filters, config }), output: rulePrepared.contracts.decodePreimages });
    const deleteShippingOptionRules = yield* defineWorkflowMethod({ command: ruleRemove, arguments: deleteRuleArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: [event("shipping_option_rule", "deleted")] });
    const joiner = fulfillmentStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const selected = [[prepared.contracts.option, "ShippingOption", optionCount], [prepared.contracts.zone, "ServiceZone", zoneCount],
      [prepared.contracts.set, "FulfillmentSet", setCount], [prepared.contracts.provider, "FulfillmentProvider", providerCount]] as const;
    const models = new Set<string>(selected.map(([, model]) => model));
    const aliases = yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : []).filter(alias => typeof alias.entity === "string" && models.has(alias.entity)) });
    const reads: GraphModuleDefinition["reads"][number][] = [];
    for (const [table, model, command] of selected) reads.push({ model, command, table: yield* prepared.reads.catalog.table(table.name),
      paths: model === "ServiceZone" ? yield* relationPaths(prepared.reads.catalog, table.name, ["fulfillment_set"], { nativeFields: true })
        : model === "ShippingOption" ? yield* relationPaths(prepared.reads.catalog, table.name, ["rules", "type"], { nativeFields: true }) : [],
      orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount });
    const admitted = [upsert, validate, optionList, zoneList, setList, providerList, optionCount, zoneCount, setCount, providerCount, ruleCreate, ruleList, ruleRemove];
    const policy = shippingOptionUpdatePolicy(prepared, rulePrepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { upsertShippingOptions, validateShippingOptionsForPriceCalculation, listShippingOptions, listServiceZones, listFulfillmentSets, listFulfillmentProviders,
        createShippingOptionRules, listShippingOptionRules, deleteShippingOptionRules }, graph: { aliases, reads },
      logical: { ...policy, commands: admitted, reconstitution: "advanceUpdatedAt" } });
    return { upsert, validate, optionList, zoneList, setList, providerList, optionCount, zoneCount, setCount, providerCount,
      ruleCreate, ruleList, ruleRemove, commands: admitted, workflow, withService: module.use, contracts: prepared.contracts, logicalEventPolicy: () => policy };
  }));
});

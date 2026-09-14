import { Effect, Result, Schema } from "effect";
import { Fulfillment, FulfillmentAddress, FulfillmentItem, FulfillmentLabel, FulfillmentProvider, FulfillmentSet, GeoZone, ServiceZone,
  ShippingOption, ShippingOptionRule, ShippingOptionType, ShippingProfile } from "@medusajs/fulfillment/models";
import { FulfillmentModuleService, FulfillmentProviderService } from "@medusajs/fulfillment/services";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { defineWorkflowMethod, defineWorkflowModule } from "./workflow/module";
import { moduleAliases } from "./local-graph/module";
import { decodeGraphCount } from "./local-graph/query";
import type { GraphModuleDefinition } from "./local-graph/model";
import type { IFulfillmentModuleService, DAL, IEventBusModuleService, FindConfig, ShippingProfileDTO, CreateShippingProfileDTO, FilterableShippingProfileProps } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceModule } from "./module-definition";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { commerceServiceCommands } from "./service-commands";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { prepareShippingProfileRepository } from "./shipping-profile-repository";
import { shippingProfileEventPolicy } from "./shipping-profile-events";
import { captureShippingProfileMetadata } from "./shipping-profile-schema";
import { QueryLimit, QueryOffset } from "./query-decoder";

const decodeEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
const decodeEventBatch = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const SimpleShippingProfileInput = Schema.Struct({ id: Schema.optionalKey(Id), name: Schema.String, type: Schema.String });
const decodeCreateArguments = commerceDecoder(Schema.Tuple([
  Schema.Array(SimpleShippingProfileInput).check(Schema.isMaxLength(256)),
]), "invalidInput");
const decodeCreatedProfiles = commerceDecoder(Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Id, name: Schema.String, type: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isMaxLength(256)), "storedCorruption");
const Create = Schema.StructWithRest(Schema.Struct({ name: Schema.String, type: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeCreate = commerceDecoder(Schema.Union([Create, Schema.Array(Create).check(Schema.isMaxLength(256))]), "invalidInput");
const Filters = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256)), Schema.Struct({ $ne: Id })])),
  name: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
  type: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))])),
});
const Config = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
  skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
const decodeRead = commerceDecoder(Schema.Struct({
  filters: Schema.optionalKey(Filters), config: Schema.optionalKey(Config),
}), "invalidInput");
const decodeRetrieve = commerceDecoder(Schema.Struct({ id: Id, config: Schema.optionalKey(Config) }), "invalidInput");

/** One definition per prepared model snapshot; each invocation borrows a fresh
 * command-owned service. There is no global container or second runtime owner.
 * The host supplies settlement, profile admission and the event destination. */
export const makeLocalShippingProfileCommands = Effect.fn("ShippingProfileAdapter.commands")(function* () {
  const metadata = yield* captureShippingProfileMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const { bind, table } = yield* prepareShippingProfileRepository(metadata.frame);
    const bindModule = (ctx: CommerceCommandContext, owner: CommercePromiseOwner) => {
        const bound = bind(ctx, owner);
        const eventBus: IEventBusModuleService = {
          emit: (input, options) => owner.run(Effect.gen(function* () {
            yield* Effect.fromResult(decodeEventOptions(yield* Effect.fromResult(captureCommerceInput(options))));
            const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
            for (const message of yield* Effect.fromResult(decodeEventBatch(captured))) yield* bound.bridge.current().captureLocalEvent(message);
          }).pipe(Effect.catchTag("CommerceTransactionError", error => bound.bridge.current().refuse(error)))),
          subscribe: () => owner.reject(commerceError("unsupportedProfile")), unsubscribe: () => owner.reject(commerceError("unsupportedProfile")),
          releaseGroupedEvents: bound.refuse, clearGroupedEvents: bound.refuse,
        };
        // Real internal services retain the same borrowed manager/persistence owner.
        // No unselected model is mapped to the ShippingProfile repository.
        const denied: DAL.RepositoryService = {
          getFreshManager: bound.repository.getFreshManager, getActiveManager: bound.repository.getActiveManager,
          transaction: bound.repository.transaction,
          serialize: bound.refuse, find: bound.refuse, findAndCount: bound.refuse,
          create: bound.refuse, update: bound.refuse, delete: bound.refuse,
          upsert: bound.refuse, upsertWithReplace: bound.refuse, softDelete: bound.refuse, restore: bound.refuse,
        };
        return { baseRepository: bound.repository, repository: (model: typeof ShippingProfile | typeof FulfillmentAddress
          | typeof Fulfillment | typeof FulfillmentItem | typeof FulfillmentLabel | typeof FulfillmentProvider | typeof FulfillmentSet
          | typeof GeoZone | typeof ServiceZone | typeof ShippingOption | typeof ShippingOptionRule | typeof ShippingOptionType) =>
          model === ShippingProfile ? bound.repository : denied, events: bound.mutationEvents, eventBus, denied };
    };
    const module = yield* defineCommerceModule({
      name: "flarex-shipping-profile-local", models: [FulfillmentAddress, Fulfillment, FulfillmentItem, FulfillmentLabel, FulfillmentProvider, FulfillmentSet,
        GeoZone, ServiceZone, ShippingOption, ShippingOptionRule, ShippingOptionType, ShippingProfile],
      profile: { name: "shipping-profile", capabilities: [], bind: bindModule },
      extensions: { fulfillmentProviderService: { mode: "replace", create: ({ binding, persistence }) => {
        const container = { fulfillmentProviderRepository: binding.denied, modulePersistenceAdapter: persistence };
        return new FulfillmentProviderService(container);
      } } },
      service: ({ binding, dependencies, context }) => {
        // The native constructor forwards the full container to MedusaService,
        // although its declared local dependencies omit the inherited event bus.
        const container = { ...dependencies, [Modules.EVENT_BUS]: binding.eventBus };
        const native = new FulfillmentModuleService(container, { scope: "internal" });
        return { service: Object.freeze({
          createShippingProfiles: native.createShippingProfiles.bind(native),
          retrieveShippingProfile: native.retrieveShippingProfile.bind(native),
          listShippingProfiles: native.listShippingProfiles.bind(native),
          listAndCountShippingProfiles: native.listAndCountShippingProfiles.bind(native),
        }), context };
      },
    }).pipe(Result.mapError(error => commerceError("unsupportedProfile", error)));
    const commands = commerceServiceCommands(module.use);
    const prepare = <Value>(decode: (input: unknown) => Result.Result<Value, ReturnType<typeof commerceError>>) =>
      Effect.fn("ShippingProfileCommand.prepare")((ctx: CommerceCommandContext, input: Json) =>
        Effect.fromResult(decode(input)).pipe(Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))));
    // SAFETY: framework DTOs/configuration are compile-time interfaces; the
    // selected DAL validates native-normalized inputs before any storage call.
    const create = commands.write("shippingProfileCreate", prepare(decodeCreate), ({ service, context }, data) =>
      Array.isArray(data) ? service.createShippingProfiles(data as CreateShippingProfileDTO[], context) : service.createShippingProfiles(data as CreateShippingProfileDTO, context));
    const list = commands.read("shippingProfileList", prepare(decodeRead), ({ service, context }, args) => service.listShippingProfiles(args.filters as FilterableShippingProfileProps | undefined, args.config as FindConfig<ShippingProfileDTO> | undefined, context));
    const count = commands.read("shippingProfileCount", prepare(decodeRead), ({ service, context }, args) => service.listAndCountShippingProfiles(args.filters as FilterableShippingProfileProps | undefined, args.config as FindConfig<ShippingProfileDTO> | undefined, context));
    const retrieve = commands.read("shippingProfileRetrieve", prepare(decodeRetrieve), ({ service, context }, args) => service.retrieveShippingProfile(args.id, args.config as FindConfig<ShippingProfileDTO> | undefined, context));
    const joiner = fulfillmentStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = { aliases: yield* moduleAliases({ ...joiner, alias: (Array.isArray(joiner.alias) ? joiner.alias : joiner.alias === undefined ? [] : [joiner.alias]).filter(alias => alias.entity === "ShippingProfile") }), reads: [{
      model: "ShippingProfile", command: count, table, paths: [], orderable: table.primaryKeys,
      uniqueOrder: table.primaryKeys, multipleOrder: false, decode: decodeGraphCount,
    }] };
    const createShippingProfiles = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments,
      encode: ([profiles]) => profiles, output: decodeCreatedProfiles,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_profile", action: "created" })] });
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description, methods: { createShippingProfiles }, graph,
      // The pinned native module's remaining public methods are sticky refusals;
      // catching a call must not turn unsupported work into a successful root.
      refusedMethods: [
        "retrieveFulfillmentSet", "listFulfillmentSets", "listAndCountFulfillmentSets",
        "createFulfillmentSets", "updateFulfillmentSets", "deleteFulfillmentSets",
        "softDeleteFulfillmentSets", "restoreFulfillmentSets", "retrieveServiceZone",
        "listServiceZones", "listAndCountServiceZones", "createServiceZones",
        "updateServiceZones", "upsertServiceZones", "deleteServiceZones",
        "softDeleteServiceZones", "restoreServiceZones", "retrieveGeoZone",
        "listGeoZones", "listAndCountGeoZones", "createGeoZones",
        "updateGeoZones", "deleteGeoZones", "softDeleteGeoZones",
        "restoreGeoZones", "retrieveShippingOption", "listShippingOptions",
        "listShippingOptionsForContext", "listAndCountShippingOptions", "createShippingOptions",
        "updateShippingOptions", "upsertShippingOptions", "deleteShippingOptions",
        "softDeleteShippingOptions", "restoreShippingOptions", "retrieveShippingProfile",
        "listShippingProfiles", "listAndCountShippingProfiles", "updateShippingProfiles",
        "deleteShippingProfiles", "upsertShippingProfiles", "softDeleteShippingProfiles",
        "restoreShippingProfiles", "retrieveShippingOptionRule", "listShippingOptionRules",
        "listAndCountShippingOptionRules", "createShippingOptionRules", "updateShippingOptionRules",
        "deleteShippingOptionRules", "retrieveShippingOptionType", "createShippingOptionTypes",
        "updateShippingOptionTypes", "upsertShippingOptionTypes", "listShippingOptionTypes",
        "listAndCountShippingOptionTypes", "deleteShippingOptionTypes", "softDeleteShippingOptionTypes",
        "restoreShippingOptionTypes", "retrieveFulfillment", "listFulfillments",
        "listAndCountFulfillments", "createFulfillment", "deleteFulfillment",
        "createReturnFulfillment", "updateFulfillment", "cancelFulfillment",
        "retrieveFulfillmentOptions", "validateFulfillmentOption", "validateFulfillmentData",
        "validateShippingOption", "validateShippingOptionsForPriceCalculation", "calculateShippingOptionsPrices",
        "listFulfillmentProviders"
      ] satisfies (keyof IFulfillmentModuleService)[] });
    return { create, list, count, retrieve, graph, workflow,
      commands: [create, list, count, retrieve],
      withService: module.use,
      eventPolicy: shippingProfileEventPolicy,
    };
  }));
});

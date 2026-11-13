import { withNativeGraphMetadata } from "../../local-graph/native-metadata";
import { Effect, Result, Schema } from "effect";
import { FulfillmentSet, ServiceZone, ShippingOption, ShippingProfile } from "@medusajs/fulfillment/models";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { ManualFulfillmentService } from "@medusajs/fulfillment-manual/services";
import { Modules } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphReadDefinition } from "../../local-graph/model";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { decodeWorkflowCommandInput, type WorkflowIntermediateValue } from "../../workflow/value";
import { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { defineFulfillmentPersistenceModule } from "./fulfillment-module";
import { prepareCartShippingRead, decodeCartShippingReadInput } from "./cart-shipping-read";
import { cartShippingReadPolicy } from "./cart-shipping-receipt";

const Intermediate: Schema.Codec<WorkflowIntermediateValue> = Schema.suspend(() => Schema.Union([
  Schema.String, Schema.Finite, Schema.Boolean, Schema.Null, Schema.Undefined, Schema.Array(Intermediate), Schema.Record(Schema.String, Intermediate),
]));
const RecordValue = Schema.Record(Schema.String, Intermediate);
const Validation = Schema.Struct({ provider_id: Schema.String, option_data: RecordValue, method_data: RecordValue, context: RecordValue });
const decodeValidation = commerceDecoder(Validation, "invalidInput");
const Calculation = Schema.Array(Schema.Struct({ id: Schema.String, provider_id: Schema.String,
  optionData: Schema.NullOr(RecordValue), data: Schema.optionalKey(Schema.Union([RecordValue, Schema.Null, Schema.Undefined])), context: RecordValue }))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeCalculation = commerceDecoder(Calculation, "invalidInput");
const decodeValidationArguments = commerceDecoder(Schema.Tuple([Schema.String, RecordValue, RecordValue, RecordValue]), "invalidInput");
const decodeCalculationArguments = commerceDecoder(Schema.Tuple([Calculation]), "invalidInput");
const Prices = Schema.Array(Schema.StructWithRest(Schema.Struct({ calculated_amount: Schema.Finite,
  is_calculated_price_tax_inclusive: Schema.Boolean }), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
const decodePrices = commerceDecoder(Prices, "storedCorruption");

/** Local Manual-provider methods and native contextual reads share the genuine
 * Fulfillment constructor. No Fulfillment creation or remote provider is exposed. */
export const makeFulfillmentCartShippingCommands = Effect.fn("Fulfillment.cartShippingCommands")(function* () {
  const metadata = yield* captureServiceZoneCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareCartShippingRead(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-fulfillment-cart-shipping", profile: "fulfillment.cart-shipping", providers: "manual",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), repository = bound.repository("shipping_option"), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: repository, repository: model => model === ShippingOption ? repository : model === ShippingProfile ? bound.repository("shipping_profile")
          : model === FulfillmentSet ? bound.repository("fulfillment_set") : model === ServiceZone ? bound.repository("service_zone") : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ listOptions: native.listShippingOptions.bind(native), listProfiles: native.listShippingProfiles.bind(native),
        listSets: native.listFulfillmentSets.bind(native), listZones: native.listServiceZones.bind(native),
        validate: native.validateFulfillmentData.bind(native), calculate: native.calculateShippingOptionsPrices.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("Fulfillment.prepareCartShipping");
    const option = commands.read("shippingOptionCountForCartShipping", prepare(decodeCartShippingReadInput), async ({ service, context }, input) => {
      const rows = await Reflect.apply(service.listOptions, service, [input.filters, input.config, context]); return [rows, rows.length];
    });
    const profile = commands.read("shippingProfileCountForCartShipping", prepare(decodeCartShippingReadInput), async ({ service, context }, input) => {
      const rows = await Reflect.apply(service.listProfiles, service, [input.filters, input.config, context]); return [rows, rows.length];
    });
    const set = commands.read("fulfillmentSetCountForCartShipping", prepare(decodeCartShippingReadInput), async ({ service, context }, input) => {
      const rows = await Reflect.apply(service.listSets, service, [input.filters, input.config, context]); return [rows, rows.length];
    });
    const zone = commands.read("serviceZoneCountForCartShipping", prepare(decodeCartShippingReadInput), async ({ service, context }, input) => {
      const rows = await Reflect.apply(service.listZones, service, [input.filters, input.config, context]); return [rows, rows.length];
    });
    const validation = commands.read("fulfillmentValidateCartShippingData", prepare(value => decodeWorkflowCommandInput(value, decodeValidation)),
      ({ service }, input) => Reflect.apply(service.validate, service, [input.provider_id, input.option_data, input.method_data, input.context]));
    const calculation = commands.read("fulfillmentCalculateCartShippingPrices", prepare(value => decodeWorkflowCommandInput(value, decodeCalculation)),
      ({ service }, input) => Reflect.apply(service.calculate, service, [input]));
    const validateFulfillmentData = yield* defineWorkflowMethod({ command: validation,
      arguments: decodeValidationArguments, inputPresence: "preserveOwnUndefined",
      encode: ([provider_id, option_data, method_data, context]) => ({ provider_id, option_data, method_data, context }),
      output: commerceDecoder(Schema.JsonObject, "storedCorruption") });
    const calculateShippingOptionsPrices = yield* defineWorkflowMethod({ command: calculation,
      arguments: decodeCalculationArguments, inputPresence: "preserveOwnUndefined", encode: ([input]) => input, output: decodePrices });
    const roots = new Map([["shippingOptionCountForCartShipping", "shipping_option"], ["shippingProfileCountForCartShipping", "shipping_profile"],
      ["fulfillmentSetCountForCartShipping", "fulfillment_set"], ["serviceZoneCountForCartShipping", "service_zone"]]);
    const readPolicy = cartShippingReadPolicy(prepared, roots), provider = new ManualFulfillmentService();
    const validateLogicalCall: typeof readPolicy.validateLogicalCall = Effect.fn("Fulfillment.validateCartShippingCall")(function* (call, activity) {
      if (roots.has(call.commandName)) return yield* readPolicy.validateLogicalCall(call, activity);
      if (call.mode !== "read" || call.events.length || activity.observedRows.length || activity.relationalReads.length || activity.mutations.length ||
        activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length) return yield* commerceError("receiptMismatch");
      if (call.commandName === "fulfillmentValidateCartShippingData") {
        const input = yield* Effect.fromResult(decodeWorkflowCommandInput(call.input, decodeValidation));
        if (input.provider_id !== "manual_manual") return yield* commerceError("receiptMismatch");
        const expected = yield* Effect.promise(() => Reflect.apply(provider.validateFulfillmentData, provider, [input.option_data, input.method_data, input.context]));
        if (!jsonEqual(call.result, yield* Effect.fromResult(captureCommerceInput(expected)))) return yield* commerceError("receiptMismatch");
      } else if (call.commandName === "fulfillmentCalculateCartShippingPrices") {
        const input = yield* Effect.fromResult(decodeWorkflowCommandInput(call.input, decodeCalculation));
        // The genuine Manual provider throws for every nonempty quote. Only
        // the native empty calculation can produce an admitted successful call.
        if (input.length || !jsonEqual(call.result, [])) return yield* commerceError("receiptMismatch");
      } else return yield* commerceError("receiptMismatch");
    });
    const joiner = fulfillmentStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const reads: GraphReadDefinition[] = [];
    for (const [table, model, command, paths] of [["shipping_option", "ShippingOption", option,
      ["type", "rules", "shipping_profile", "provider", "service_zone", "service_zone.fulfillment_set", "service_zone.geo_zones"]],
    ["shipping_profile", "ShippingProfile", profile, []], ["fulfillment_set", "FulfillmentSet", set, []], ["service_zone", "ServiceZone", zone, ["fulfillment_set", "geo_zones"]]] as const)
      reads.push({ model, command, table: yield* prepared.catalog.table(table), paths: yield* relationPaths(prepared.catalog, table, paths, { nativeFields: true }),
        nativeFields: true as const, orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount });
    const graph = yield* withNativeGraphMetadata({ aliases: (yield* moduleAliases(joiner)).filter(alias => reads.some(read => read.model === alias.model)), reads }, [joiner], metadata.frame.tables);
    const admitted = [option, profile, set, zone, validation, calculation], policy = { capture: readPolicy.capture, validateLogicalCall };
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { validateFulfillmentData, calculateShippingOptionsPrices }, graph, logical: { ...policy, commands: admitted } });
    return { workflow, graph, commands: admitted, prepared, policy };
  }));
});

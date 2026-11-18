import { Effect, Result, Schema } from "effect";
import type { UpdateShippingOptionTypeDTO, UpsertShippingOptionTypeDTO } from "@medusajs/framework/types";
import { ShippingOptionType } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { prepareShippingOptionTypeUpdateRepository } from "./shipping-option-type-update-repository";
import { shippingOptionTypeUpdatePolicy } from "./shipping-option-type-update-receipt";
import { ShippingOptionTypeUpdateSelector, ShippingOptionTypeUpdateData, ShippingOptionTypeUpdateReadInput, ShippingOptionTypeUpdateUpserts,
  decodeShippingOptionTypeUpdateInput, decodeShippingOptionTypeUpdateUpserts } from "./shipping-option-type-update-input";

const decodeRead = commerceDecoder(ShippingOptionTypeUpdateReadInput, "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Tuple([ShippingOptionTypeUpdateSelector, NativePreimageConfig]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([ShippingOptionTypeUpdateSelector, ShippingOptionTypeUpdateData]), "invalidInput");
const decodeUpsertArguments = commerceDecoder(Schema.Tuple([ShippingOptionTypeUpdateUpserts]), "invalidInput");

/** A selected genuine Fulfillment constructor, limited to native selector
 * updates and genuine physical partial/full upsert retained inverses. */
export const makeShippingOptionTypeUpdateCommands = Effect.fn("ShippingOptionTypeAdapter.updateCommands")(function* () {
  const metadata = yield* captureShippingProfileDeletionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingOptionTypeUpdateRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-shipping-option-type-update", profile: "shipping-option-type-update",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ShippingOptionType ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ listShippingOptionTypes: native.listShippingOptionTypes.bind(native),
        updateShippingOptionTypes: native.updateShippingOptionTypes.bind(native), upsertShippingOptionTypes: native.upsertShippingOptionTypes.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingOptionTypeUpdate.prepare");
    const list = commands.read("shippingOptionTypeListForUpdate", prepare(input => captureCommerceInput(input).pipe(Result.flatMap(decodeRead),
      Result.map(value => ({ filters: value.filters, config: nativePreimageSelection(value.config ?? {}, prepared) })))),
      ({ service, context }, input) => service.listShippingOptionTypes(input.filters, {
        ...(input.config.select === undefined ? {} : { select: [...input.config.select] }),
        ...(input.config.relations === undefined ? {} : { relations: [...input.config.relations] }),
      }, context));
    const updateForWorkflow = commands.write("shippingOptionTypeUpdateForWorkflow", prepare(decodeShippingOptionTypeUpdateInput),
      // SAFETY: native DTO description omits DML null. Checked input retains it.
      ({ service, context }, input) => service.updateShippingOptionTypes(input.selector, input.update as UpdateShippingOptionTypeDTO, context));
    const upsertForWorkflow = commands.write("shippingOptionTypeUpsertForUpdateInverse", prepare(decodeShippingOptionTypeUpdateUpserts),
      // SAFETY: ID-required scalar preimages are runtime checked; native DTOs
      // omit nullable description and overstate missing-row required fields.
      ({ service, context }, input) => service.upsertShippingOptionTypes(input as UpsertShippingOptionTypeDTO[], context));
    const listShippingOptionTypes = yield* defineWorkflowMethod({ command: list, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: prepared.contracts.decodePreimages });
    const moduleEvents = [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_option_type", action: "updated" })];
    const updateShippingOptionTypes = yield* defineWorkflowMethod({ command: updateForWorkflow, arguments: decodeUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: prepared.contracts.decodeRows, moduleEvents });
    const upsertShippingOptionTypes = yield* defineWorkflowMethod({ command: upsertForWorkflow, arguments: decodeUpsertArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeUpsertRows,
      moduleEvents: [...moduleEvents, buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_option_type", action: "created" })] });
    const admitted = [list, updateForWorkflow, upsertForWorkflow], policy = shippingOptionTypeUpdatePolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { listShippingOptionTypes, updateShippingOptionTypes, upsertShippingOptionTypes }, graph: { aliases: [], reads: [] },
      logical: { ...policy, commands: admitted, allowPreservingDeletionUpsert: true } });
    return { list, updateForWorkflow, upsertForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeRows };
  }));
});

import { Effect, Result, Schema } from "effect";
import { ShippingOptionType } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreateShippingOptionTypeDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { prepareShippingOptionTypeCreationRepository } from "./shipping-option-type-repository";
import { ShippingOptionTypeCreates, ShippingOptionTypePhysicalDeletionIds,
  decodeShippingOptionTypeCreates, decodeShippingOptionTypePhysicalDeletionIds } from "./shipping-option-type-input";
import { shippingOptionTypeCreationPolicy } from "./shipping-option-type-receipt";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([ShippingOptionTypeCreates]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([ShippingOptionTypePhysicalDeletionIds]), "invalidInput");

/** One native twelve-model Fulfillment constructor, selecting only Type create
 * and its physical inverse. Existing installed schema/source identity is reused;
 * sibling repositories and provider operations retain denied capabilities. */
export const makeShippingOptionTypeCreationCommands = Effect.fn("ShippingOptionTypeAdapter.createCommands")(function* () {
  const metadata = yield* captureShippingProfileDeletionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingOptionTypeCreationRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-shipping-option-type-create", profile: "shipping-option-type-create",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ShippingOptionType ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ createShippingOptionTypes: native.createShippingOptionTypes.bind(native),
        deleteShippingOptionTypes: native.deleteShippingOptionTypes.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingOptionTypeCreate.prepare");
    const create = commands.write("shippingOptionTypeCreateForWorkflow", prepare(decodeShippingOptionTypeCreates),
      // SAFETY: the native public DTO omits persistence IDs and nullable
      // description. Checked DML and this profile validate both before storage.
      ({ service, context }, input) => service.createShippingOptionTypes(input as CreateShippingOptionTypeDTO[], context));
    const deleteForWorkflow = commands.write("shippingOptionTypePhysicalDeleteForWorkflow", prepare(decodeShippingOptionTypePhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteShippingOptionTypes([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const createShippingOptionTypes = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeRows,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_option_type", action: "created" })] });
    const deleteShippingOptionTypes = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_option_type", action: "deleted" })] });
    const admitted = [create, deleteForWorkflow], policy = shippingOptionTypeCreationPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { createShippingOptionTypes, deleteShippingOptionTypes }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { create, deleteForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeRows };
  }));
});

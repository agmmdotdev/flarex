import { Effect, Result } from "effect";
import { ShippingOption } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { defineFulfillmentPersistenceModule, fulfillmentServiceRouting, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareShippingOptionDeletionRepository } from "./shipping-option-delete-repository";
import { decodeShippingOptionDeletionArguments, decodeShippingOptionDeletionIds } from "./shipping-option-delete-input";
import { shippingOptionDeletionPolicy } from "./shipping-option-delete-receipt";

const definitions = new WeakMap<object, { readonly routing: ReturnType<typeof fulfillmentServiceRouting> }>();
/** Routing retains every native linkable key. The Link composition receives no
 * additional Fulfillment methods from this description. */
export function shippingOptionDeletionServiceDefinition(input: unknown) {
  const definition = typeof input === "object" && input !== null ? definitions.get(input) : undefined;
  return definition === undefined ? undefined : { routing: structuredClone(definition.routing) };
}

export const makeShippingOptionDeletionCommands = Effect.fn("ShippingOptionAdapter.deleteCommands")(function* () {
  const metadata = yield* captureServiceZoneCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingOptionDeletionRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-shipping-option-delete", profile: "shipping-option-delete",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ShippingOption ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ softDeleteShippingOptions: native.softDeleteShippingOptions.bind(native),
        restoreShippingOptions: native.restoreShippingOptions.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingOptionDelete.prepare");
    const softDeleteForWorkflow = commands.write("shippingOptionSoftDeleteForWorkflow", prepare(decodeShippingOptionDeletionIds),
      ({ service, context }, ids) => service.softDeleteShippingOptions([...ids], {}, context));
    const restoreForWorkflow = commands.write("shippingOptionRestoreForWorkflow", prepare(decodeShippingOptionDeletionIds),
      ({ service, context }, ids) => service.restoreShippingOptions([...ids], {}, context));
    const moduleEvents = (action: "deleted" | "restored") => prepared.contracts.entities.map(entity =>
      buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: entity.table.name, action }));
    const softDeleteShippingOptions = yield* defineWorkflowMethod({ command: softDeleteForWorkflow,
      arguments: decodeShippingOptionDeletionArguments, encode: ([ids]) => ids,
      output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("deleted") });
    const restoreShippingOptions = yield* defineWorkflowMethod({ command: restoreForWorkflow,
      arguments: decodeShippingOptionDeletionArguments, encode: ([ids]) => ids,
      output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("restored") });
    const admitted = [softDeleteForWorkflow, restoreForWorkflow], policy = shippingOptionDeletionPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { softDeleteShippingOptions, restoreShippingOptions }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    definitions.set(workflow, { routing: fulfillmentServiceRouting() });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeOutput };
  }));
});

import { Effect, Result } from "effect";
import { ShippingProfile } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { prepareShippingProfileDeletionRepository } from "./shipping-profile-delete-repository";
import { decodeShippingProfileDeletionArguments, decodeShippingProfileDeletionIds } from "./shipping-profile-delete-input";
import { shippingProfileDeletionPolicy } from "./shipping-profile-delete-receipt";

/** Selected native Fulfillment deletion retains its real Option validation;
 * the complete constructor grants no sibling DAL or provider authority. */
export const makeShippingProfileDeletionCommands = Effect.fn("ShippingProfileAdapter.deleteCommands")(function* () {
  const metadata = yield* captureShippingProfileDeletionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingProfileDeletionRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-shipping-profile-delete", profile: "shipping-profile-delete",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ShippingProfile ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ softDeleteShippingProfiles: native.softDeleteShippingProfiles.bind(native),
        restoreShippingProfiles: native.restoreShippingProfiles.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingProfileDelete.prepare");
    const softDeleteForWorkflow = commands.write("shippingProfileSoftDeleteForWorkflow", prepare(decodeShippingProfileDeletionIds),
      ({ service, context }, ids) => service.softDeleteShippingProfiles([...ids], {}, context));
    const restoreForWorkflow = commands.write("shippingProfileRestoreForWorkflow", prepare(decodeShippingProfileDeletionIds),
      ({ service, context }, ids) => service.restoreShippingProfiles([...ids], {}, context));
    const moduleEvents = (action: "deleted" | "restored") => [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT,
      objectName: "shipping_profile", action })];
    const softDeleteShippingProfiles = yield* defineWorkflowMethod({ command: softDeleteForWorkflow,
      arguments: decodeShippingProfileDeletionArguments, encode: ([ids]) => ids,
      output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("deleted") });
    const restoreShippingProfiles = yield* defineWorkflowMethod({ command: restoreForWorkflow,
      arguments: decodeShippingProfileDeletionArguments, encode: ([ids]) => ids,
      output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("restored") });
    const admitted = [softDeleteForWorkflow, restoreForWorkflow], policy = shippingProfileDeletionPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { softDeleteShippingProfiles, restoreShippingProfiles }, graph: { aliases: [], reads: [] },
      logical: { ...policy, commands: admitted } });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy };
  }));
});

import { Effect, Result, Schema } from "effect";
import { ShippingProfile } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreateShippingProfileDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { prepareShippingProfileCreationRepository } from "./shipping-profile-create-repository";
import { ShippingProfileCreates, ShippingProfilePhysicalDeletionIds,
  decodeShippingProfileCreates, decodeShippingProfilePhysicalDeletionIds } from "./shipping-profile-create-input";
import { shippingProfileCreationPolicy } from "./shipping-profile-create-receipt";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([ShippingProfileCreates]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([ShippingProfilePhysicalDeletionIds]), "invalidInput");

/** One native twelve-model Fulfillment constructor, selecting only Profile create
 * and its physical inverse. Existing installed schema/source identity is reused;
 * sibling repositories and provider operations retain denied capabilities. */
export const makeShippingProfileCreationCommands = Effect.fn("ShippingProfileAdapter.createCommands")(function* () {
  const metadata = yield* captureShippingProfileDeletionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingProfileCreationRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-shipping-profile-create", profile: "shipping-profile-create",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ShippingProfile ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ createShippingProfiles: native.createShippingProfiles.bind(native),
        deleteShippingProfiles: native.deleteShippingProfiles.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingProfileCreate.prepare");
    const createForWorkflow = commands.write("shippingProfileCreateForWorkflow", prepare(decodeShippingProfileCreates),
      // SAFETY: the native public DTO omits persistence IDs. Checked DML
      // and this profile validate them before the native service persists.
      ({ service, context }, input) => service.createShippingProfiles(input as CreateShippingProfileDTO[], context));
    const deleteForWorkflow = commands.write("shippingProfilePhysicalDeleteForWorkflow", prepare(decodeShippingProfilePhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteShippingProfiles([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const createShippingProfiles = yield* defineWorkflowMethod({ command: createForWorkflow, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeRows,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_profile", action: "created" })] });
    const deleteShippingProfiles = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_profile", action: "deleted" })] });
    const admitted = [createForWorkflow, deleteForWorkflow], policy = { ...shippingProfileCreationPolicy(prepared.contracts),
      setNullPolicy: { managedUpdate: "preserve" as const } };
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { createShippingProfiles, deleteShippingProfiles }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { createForWorkflow, deleteForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeRows };
  }));
});

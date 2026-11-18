import { Effect, Result, Schema } from "effect";
import { FulfillmentSet } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import type { FulfillmentPhysicalProfile } from "./fulfillment-graph-contracts";
import { captureFulfillmentCreationMetadata, captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareFulfillmentSetCreationRepository } from "./fulfillment-set-create-repository";
import { FulfillmentSetCreates, FulfillmentSetPhysicalDeletionIds,
  decodeFulfillmentSetCreates, decodeFulfillmentSetPhysicalDeletionIds } from "./fulfillment-set-create-input";
import { fulfillmentSetCreationPolicy } from "./fulfillment-set-create-receipt";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([FulfillmentSetCreates]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([FulfillmentSetPhysicalDeletionIds]), "invalidInput");

/** The genuine twelve-model constructor retains native Set behavior. Only
 * scalar creation and its complete historical physical inverse are callable. */
const makeFulfillmentSetCreationCommandsForProfile = Effect.fn("FulfillmentSetAdapter.createCommands")(function* (profile: FulfillmentPhysicalProfile) {
  const metadata = yield* (profile === "reference-detachment" ? captureFulfillmentCreationMetadata() : captureServiceZoneCreationMetadata());
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareFulfillmentSetCreationRepository(metadata.frame, profile);
    const module = yield* defineFulfillmentPersistenceModule({ name: profile === "reference-detachment" ? "flarex-fulfillment-set-create-reference-detachment" : "flarex-fulfillment-set-create",
      profile: profile === "reference-detachment" ? "fulfillment-set-create-reference-detachment" : "fulfillment-set-create",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === FulfillmentSet ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ createFulfillmentSets: native.createFulfillmentSets.bind(native), deleteFulfillmentSets: native.deleteFulfillmentSets.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("FulfillmentSetCreate.prepare");
    const createForWorkflow = commands.write("fulfillmentSetCreateForWorkflow", prepare(decodeFulfillmentSetCreates),
      ({ service, context }, input) => service.createFulfillmentSets(input, context));
    const deleteForWorkflow = commands.write("fulfillmentSetPhysicalDeleteForWorkflow", prepare(decodeFulfillmentSetPhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteFulfillmentSets([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const createFulfillmentSets = yield* defineWorkflowMethod({ command: createForWorkflow, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeRows,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "fulfillment_set", action: "created" })] });
    const deleteFulfillmentSets = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "fulfillment_set", action: "deleted" })] });
    const admitted = [createForWorkflow, deleteForWorkflow], policy = fulfillmentSetCreationPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { createFulfillmentSets, deleteFulfillmentSets }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted, ...(profile === "reference-detachment" ? { detachDeletedReferences: true as const } : {}) } });
    return { createForWorkflow, deleteForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeRows };
  }));
});

export const makeFulfillmentSetCreationCommands = Effect.fn("FulfillmentSetAdapter.standaloneCreation")(function* () {
  return yield* makeFulfillmentSetCreationCommandsForProfile("standalone");
});
export const makeFulfillmentSetCreationWithReferenceDetachmentCommands = Effect.fn("FulfillmentSetAdapter.referenceDetachment")(function* () {
  return yield* makeFulfillmentSetCreationCommandsForProfile("reference-detachment");
});

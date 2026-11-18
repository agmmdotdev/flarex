import { Effect, Result, Schema } from "effect";
import { ServiceZone } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { CreateServiceZoneDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import type { FulfillmentPhysicalProfile } from "./fulfillment-graph-contracts";
import { captureFulfillmentCreationMetadata, captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareServiceZoneCreationRepository } from "./service-zone-create-repository";
import { ServiceZoneCreates, ServiceZonePhysicalDeletionIds, decodeServiceZoneCreates, decodeServiceZonePhysicalDeletionIds } from "./service-zone-create-input";
import { serviceZoneCreationPolicy } from "./service-zone-create-receipt";

const decodeCreateArguments = commerceDecoder(Schema.Tuple([ServiceZoneCreates]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([ServiceZonePhysicalDeletionIds]), "invalidInput");

/** Genuine Fulfillment create and retained physical inverse borrow one settlement. */
const makeServiceZoneCreationCommandsForProfile = Effect.fn("ServiceZoneAdapter.createCommands")(function* (profile: FulfillmentPhysicalProfile) {
  const metadata = yield* (profile === "reference-detachment" ? captureFulfillmentCreationMetadata() : captureServiceZoneCreationMetadata());
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareServiceZoneCreationRepository(metadata.frame, profile);
    const module = yield* defineFulfillmentPersistenceModule({ name: profile === "reference-detachment" ? "flarex-service-zone-create-reference-detachment" : "flarex-service-zone-create",
      profile: profile === "reference-detachment" ? "service-zone-create-reference-detachment" : "service-zone-create",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ServiceZone ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ createServiceZones: native.createServiceZones.bind(native), deleteServiceZones: native.deleteServiceZones.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ServiceZoneCreate.prepare");
    const create = commands.write("serviceZoneCreateForWorkflow", prepare(decodeServiceZoneCreates),
      // SAFETY: native validation receives missing/unknown GeoZone types before
      // DML defaults. Its DTO is narrower than the checked persistence boundary.
      ({ service, context }, input) => service.createServiceZones(input as CreateServiceZoneDTO[], context));
    const deleteForWorkflow = commands.write("serviceZonePhysicalDeleteForWorkflow", prepare(decodeServiceZonePhysicalDeletionIds),
      async ({ service, context }, ids) => {
        const result = await service.deleteServiceZones([...ids], context);
        if (result !== undefined) throw commerceError("storedCorruption");
        return null;
      });
    const createServiceZones = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeRows,
      moduleEvents: ["service_zone", "geo_zone"].map(objectName => buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName, action: "created" })) });
    const deleteServiceZones = yield* defineWorkflowMethod({ command: deleteForWorkflow, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"),
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "service_zone", action: "deleted" })] });
    const admitted = [create, deleteForWorkflow], policy = serviceZoneCreationPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { createServiceZones, deleteServiceZones }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted, ...(profile === "reference-detachment" ? { detachDeletedReferences: true as const } : {}) } });
    return { create, deleteForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeRows };
  }));
});

export const makeServiceZoneCreationCommands = Effect.fn("ServiceZoneAdapter.standaloneCreation")(function* () {
  return yield* makeServiceZoneCreationCommandsForProfile("standalone");
});
export const makeServiceZoneCreationWithReferenceDetachmentCommands = Effect.fn("ServiceZoneAdapter.referenceDetachment")(function* () {
  return yield* makeServiceZoneCreationCommandsForProfile("reference-detachment");
});

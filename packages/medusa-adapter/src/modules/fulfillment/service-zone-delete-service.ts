import { Effect, Result } from "effect";
import { ServiceZone } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareServiceZoneDeletionRepository } from "./service-zone-delete-repository";
import { decodeServiceZoneDeletionArguments, decodeServiceZoneDeletionIds } from "./service-zone-delete-input";
import { serviceZoneDeletionPolicy } from "./service-zone-delete-receipt";

export const makeServiceZoneDeletionCommands = Effect.fn("ServiceZoneAdapter.deleteCommands")(function* () {
  const metadata = yield* captureServiceZoneCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareServiceZoneDeletionRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-service-zone-delete", profile: "service-zone-delete",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ServiceZone ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ softDeleteServiceZones: native.softDeleteServiceZones.bind(native), restoreServiceZones: native.restoreServiceZones.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ServiceZoneDelete.prepare");
    const softDeleteForWorkflow = commands.write("serviceZoneSoftDeleteForWorkflow", prepare(decodeServiceZoneDeletionIds),
      ({ service, context }, ids) => service.softDeleteServiceZones([...ids], {}, context));
    const restoreForWorkflow = commands.write("serviceZoneRestoreForWorkflow", prepare(decodeServiceZoneDeletionIds),
      ({ service, context }, ids) => service.restoreServiceZones([...ids], {}, context));
    const moduleEvents = (action: "deleted" | "restored") => prepared.contracts.entities.map(entity =>
      buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: entity.table.name, action }));
    const softDeleteServiceZones = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeServiceZoneDeletionArguments,
      encode: ([ids]) => ids, output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("deleted") });
    const restoreServiceZones = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeServiceZoneDeletionArguments,
      encode: ([ids]) => ids, output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("restored") });
    const admitted = [softDeleteForWorkflow, restoreForWorkflow], policy = serviceZoneDeletionPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { softDeleteServiceZones, restoreServiceZones }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeOutput };
  }));
});

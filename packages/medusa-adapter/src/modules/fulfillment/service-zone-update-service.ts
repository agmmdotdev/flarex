import { Effect, Result, Schema } from "effect";
import { ServiceZone, GeoZone } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import type { FindConfig, ServiceZoneDTO, UpdateServiceZoneDTO, UpsertServiceZoneDTO } from "@medusajs/framework/types";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { NativePreimageConfig } from "../../workflow/preimage";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareServiceZoneUpdateRepository } from "./service-zone-update-repository";
import { ServiceZoneUpdateSelector, ServiceZoneUpdateData, ServiceZoneUpdateReadInput, ServiceZoneUpdateUpserts,
  decodeServiceZoneUpdateInput, decodeServiceZoneUpdateUpserts } from "./service-zone-update-input";
import { serviceZoneUpdatePolicy } from "./service-zone-update-receipt";

const decodeRead = commerceDecoder(ServiceZoneUpdateReadInput, "invalidInput");
const readArguments = commerceDecoder(Schema.Union([Schema.Tuple([ServiceZoneUpdateSelector]),
  Schema.Tuple([ServiceZoneUpdateSelector, NativePreimageConfig])]), "invalidInput");
const updateArguments = commerceDecoder(Schema.Tuple([ServiceZoneUpdateSelector, ServiceZoneUpdateData]), "invalidInput");
const upsertArguments = commerceDecoder(Schema.Tuple([ServiceZoneUpdateUpserts]), "invalidInput");

/** Native geographic membership/replacement and the genuine projected inverse
 * retain one existing source and outer settlement. Sibling operations are denied. */
export const makeServiceZoneUpdateCommands = Effect.fn("ServiceZoneAdapter.updateCommands")(function* () {
  const metadata = yield* captureServiceZoneCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareServiceZoneUpdateRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-service-zone-update", profile: "service-zone-update",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ServiceZone ? bound.repository : model === GeoZone ? bound.geoRepository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ listServiceZones: native.listServiceZones.bind(native), updateServiceZones: native.updateServiceZones.bind(native),
        upsertServiceZones: native.upsertServiceZones.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ServiceZoneUpdate.prepare");
    const listForWorkflow = commands.read("serviceZoneListForUpdate", prepare(decodeRead),
      ({ service, context }, input) => service.listServiceZones(input.filters, input.config as FindConfig<ServiceZoneDTO> | undefined, context));
    const updateForWorkflow = commands.write("serviceZoneUpdateForWorkflow", prepare(decodeServiceZoneUpdateInput),
      // SAFETY: native workflow permits null names and unchecked new Geo shape;
      // genuine service validation and checked DML retain the refusal boundary.
      ({ service, context }, input) => service.updateServiceZones(input.selector, input.update as UpdateServiceZoneDTO, context));
    const upsertForWorkflow = commands.write("serviceZoneUpsertForUpdateInverse", prepare(decodeServiceZoneUpdateUpserts),
      ({ service, context }, input) => service.upsertServiceZones(input as UpsertServiceZoneDTO[], context));
    const moduleEvents = [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "service_zone", action: "updated" }),
      ...["created", "updated", "deleted"].map(action => buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "geo_zone", action }))];
    const listServiceZones = yield* defineWorkflowMethod({ command: listForWorkflow, arguments: readArguments,
      encode: ([filters, config]) => ({ filters, ...(config === undefined ? {} : { config }) }), output: prepared.contracts.decodePreimages, moduleEvents: [] });
    const updateServiceZones = yield* defineWorkflowMethod({ command: updateForWorkflow, arguments: updateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: prepared.contracts.decodeRows, moduleEvents });
    const upsertServiceZones = yield* defineWorkflowMethod({ command: upsertForWorkflow, arguments: upsertArguments,
      encode: ([rows]) => rows, output: prepared.contracts.decodeRows, moduleEvents });
    const admitted = [listForWorkflow, updateForWorkflow, upsertForWorkflow], policy = serviceZoneUpdatePolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { listServiceZones, updateServiceZones, upsertServiceZones }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { listForWorkflow, updateForWorkflow, upsertForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeRows };
  }));
});

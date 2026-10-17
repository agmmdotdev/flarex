import { Effect, Result, Schema } from "effect";
import { ShippingProfile } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureShippingProfileMetadata } from "./shipping-profile-schema";
import { defineShippingProfilePersistenceModule, type ShippingProfilePersistenceModel } from "./shipping-profile-module";
import { prepareShippingProfileUpdateRepository } from "./shipping-profile-update-repository";
import { shippingProfileUpdatePolicy } from "./shipping-profile-update-receipt";
import { ShippingProfileUpdateSelector, ShippingProfileUpdateData, ShippingProfileUpdateReadInput, ShippingProfileUpdateUpserts,
  decodeShippingProfileUpdateInput, decodeShippingProfileUpdateUpserts } from "./shipping-profile-update-input";

const decodeRead = commerceDecoder(ShippingProfileUpdateReadInput, "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Tuple([ShippingProfileUpdateSelector, NativePreimageConfig]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([ShippingProfileUpdateSelector, ShippingProfileUpdateData]), "invalidInput");
const decodeUpsertArguments = commerceDecoder(Schema.Tuple([ShippingProfileUpdateUpserts]), "invalidInput");

/** A selected genuine Fulfillment constructor, limited to native selector
 * updates and existing-row retained inverses. Ordinary creation stays separate. */
export const makeShippingProfileUpdateCommands = Effect.fn("ShippingProfileAdapter.updateCommands")(function* () {
  const metadata = yield* captureShippingProfileMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingProfileUpdateRepository(metadata.frame);
    const module = yield* defineShippingProfilePersistenceModule({ name: "flarex-shipping-profile-update", profile: "shipping-profile-update",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: ShippingProfilePersistenceModel) => model === ShippingProfile ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ listShippingProfiles: native.listShippingProfiles.bind(native),
        updateShippingProfiles: native.updateShippingProfiles.bind(native), upsertShippingProfiles: native.upsertShippingProfiles.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingProfileUpdate.prepare");
    const list = commands.read("shippingProfileListForUpdate", prepare(input => captureCommerceInput(input).pipe(Result.flatMap(decodeRead),
      Result.map(value => ({ filters: value.filters, config: nativePreimageSelection(value.config ?? {}, prepared) })))),
      ({ service, context }, input) => service.listShippingProfiles(input.filters, {
        ...(input.config.select === undefined ? {} : { select: [...input.config.select] }),
        ...(input.config.relations === undefined ? {} : { relations: [...input.config.relations] }),
      }, context));
    const updateForWorkflow = commands.write("shippingProfileUpdateForWorkflow", prepare(decodeShippingProfileUpdateInput),
      ({ service, context }, input) => service.updateShippingProfiles(input.selector, input.update, context));
    const upsertForWorkflow = commands.write("shippingProfileUpsertForUpdateInverse", prepare(decodeShippingProfileUpdateUpserts),
      ({ service, context }, input) => service.upsertShippingProfiles(input, context));
    const listShippingProfiles = yield* defineWorkflowMethod({ command: list, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: prepared.contracts.decodePreimages });
    const moduleEvents = [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_profile", action: "updated" })];
    const updateShippingProfiles = yield* defineWorkflowMethod({ command: updateForWorkflow, arguments: decodeUpdateArguments,
      encode: ([selector, update]) => ({ selector, update }), output: prepared.contracts.decodeRows, moduleEvents });
    const upsertShippingProfiles = yield* defineWorkflowMethod({ command: upsertForWorkflow, arguments: decodeUpsertArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeRows, moduleEvents });
    const admitted = [list, updateForWorkflow, upsertForWorkflow], policy = shippingProfileUpdatePolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { listShippingProfiles, updateShippingProfiles, upsertShippingProfiles }, graph: { aliases: [], reads: [] },
      logical: { ...policy, commands: admitted } });
    return { list, updateForWorkflow, upsertForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeRows };
  }));
});

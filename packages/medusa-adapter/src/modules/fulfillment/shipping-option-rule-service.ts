import { Effect, Result, Schema } from "effect";
import { ShippingOptionRule } from "@medusajs/fulfillment/models";
import type { CreateShippingOptionRuleDTO, UpdateShippingOptionRuleDTO } from "@medusajs/framework/types";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { NativePreimageConfig, nativePreimageSelection } from "../../workflow/preimage";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { ShippingOptionRuleCreates, ShippingOptionRuleUpdates, ShippingOptionRuleIds, ShippingOptionRuleReadInput,
  ShippingOptionRuleSelector, decodeShippingOptionRuleCreates, decodeShippingOptionRuleUpdates, decodeShippingOptionRuleIds } from "./shipping-option-rule-input";
import { prepareShippingOptionRuleRepository } from "./shipping-option-rule-repository";
import { shippingOptionRulePolicy } from "./shipping-option-rule-receipt";

const decodeRead = commerceDecoder(ShippingOptionRuleReadInput, "invalidInput");
const decodeListArguments = commerceDecoder(Schema.Tuple([ShippingOptionRuleSelector, NativePreimageConfig]), "invalidInput");
const decodeCreateArguments = commerceDecoder(Schema.Tuple([ShippingOptionRuleCreates]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([ShippingOptionRuleUpdates]), "invalidInput");
const decodeDeleteArguments = commerceDecoder(Schema.Tuple([ShippingOptionRuleIds]), "invalidInput");

/** Genuine Fulfillment Rule service methods borrow one queued operation and
 * settlement owner; sibling model repositories remain denied. */
export const makeShippingOptionRuleCommands = Effect.fn("ShippingOptionRuleAdapter.commands")(function* () {
  const metadata = yield* captureServiceZoneCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingOptionRuleRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-shipping-option-rule-batch", profile: "shipping-option-rule-batch",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: (model: FulfillmentPersistenceModel) => model === ShippingOptionRule ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ createShippingOptionRules: native.createShippingOptionRules.bind(native),
        updateShippingOptionRules: native.updateShippingOptionRules.bind(native), deleteShippingOptionRules: native.deleteShippingOptionRules.bind(native),
        listShippingOptionRules: native.listShippingOptionRules.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingOptionRule.prepare");
    const create = commands.write("shippingOptionRuleCreateForBatch", prepare(decodeShippingOptionRuleCreates),
      // SAFETY: runtime structural admission preserves native validator inputs,
      // including supplied IDs and JSON values wider than the public DTO.
      ({ service, context }, input) => service.createShippingOptionRules(input as CreateShippingOptionRuleDTO[], context));
    const update = commands.write("shippingOptionRuleUpdateForBatch", prepare(decodeShippingOptionRuleUpdates),
      // SAFETY: full native validator, then checked DML, owns the wider JSON boundary.
      ({ service, context }, input) => service.updateShippingOptionRules(input as UpdateShippingOptionRuleDTO[], context));
    const remove = commands.write("shippingOptionRuleDeleteForBatch", prepare(decodeShippingOptionRuleIds), async ({ service, context }, ids) => {
      const result = await service.deleteShippingOptionRules([...ids], context);
      if (result !== undefined) throw commerceError("storedCorruption");
      return null;
    });
    const list = commands.read("shippingOptionRuleListForBatch", prepare(input => captureCommerceInput(input).pipe(Result.flatMap(decodeRead),
      Result.map(value => ({ filters: value.filters, config: nativePreimageSelection(value.config ?? {}, prepared) })))),
      ({ service, context }, input) => service.listShippingOptionRules(input.filters, {
        ...(input.config.select === undefined ? {} : { select: [...input.config.select] }),
        ...(input.config.relations === undefined ? {} : { relations: [...input.config.relations] }),
      }, context));
    const event = (action: "created" | "updated" | "deleted") =>
      [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: "shipping_option_rule", action })];
    const createShippingOptionRules = yield* defineWorkflowMethod({ command: create, arguments: decodeCreateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeRows, moduleEvents: event("created") });
    const updateShippingOptionRules = yield* defineWorkflowMethod({ command: update, arguments: decodeUpdateArguments,
      encode: ([input]) => input, output: prepared.contracts.decodeRows, moduleEvents: event("updated") });
    const deleteShippingOptionRules = yield* defineWorkflowMethod({ command: remove, arguments: decodeDeleteArguments,
      encode: ([ids]) => ids, output: commerceDecoder(Schema.Null, "storedCorruption"), moduleEvents: event("deleted") });
    const listShippingOptionRules = yield* defineWorkflowMethod({ command: list, arguments: decodeListArguments,
      encode: ([filters, config]) => ({ filters, config }), output: prepared.contracts.decodePreimages });
    const admitted = [create, update, remove, list], policy = shippingOptionRulePolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { createShippingOptionRules, updateShippingOptionRules, deleteShippingOptionRules, listShippingOptionRules },
      graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { create, update, remove, list, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, contracts: prepared.contracts, output: prepared.contracts.Output };
  }));
});

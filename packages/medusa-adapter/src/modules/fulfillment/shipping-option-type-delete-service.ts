import { Effect, Result } from "effect";
import { ShippingOption, ShippingOptionType } from "@medusajs/fulfillment/models";
import { fulfillmentStaticResources } from "@medusajs/fulfillment/static-manifest";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { defineFulfillmentPersistenceModule, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureShippingProfileDeletionMetadata } from "./shipping-profile-schema";
import { prepareShippingOptionTypeDeletionRepository } from "./shipping-option-type-delete-repository";
import { decodeShippingOptionTypeDeletionArguments, decodeShippingOptionTypeDeletionIds, decodeShippingOptionTypeDeletionRead } from "./shipping-option-type-delete-input";
import { shippingOptionTypeDeletionPolicy } from "./shipping-option-type-delete-receipt";

/** One genuine Fulfillment service exposes Type lifecycle and its root's actual
 * read-only Option graph query. Sibling models and providers remain denied. */
export const makeShippingOptionTypeDeletionCommands = Effect.fn("ShippingOptionTypeAdapter.deleteCommands")(function* () {
  const metadata = yield* captureShippingProfileDeletionMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareShippingOptionTypeDeletionRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-shipping-option-type-delete", profile: "shipping-option-type-delete",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === ShippingOptionType ? bound.repository : model === ShippingOption ? bound.optionRepository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ softDeleteShippingOptionTypes: native.softDeleteShippingOptionTypes.bind(native),
        restoreShippingOptionTypes: native.restoreShippingOptionTypes.bind(native),
        listAndCountShippingOptions: native.listAndCountShippingOptions.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("ShippingOptionTypeDelete.prepare");
    const softDeleteForWorkflow = commands.write("shippingOptionTypeSoftDeleteForWorkflow", prepare(decodeShippingOptionTypeDeletionIds),
      ({ service, context }, ids) => service.softDeleteShippingOptionTypes([...ids], {}, context));
    const restoreForWorkflow = commands.write("shippingOptionTypeRestoreForWorkflow", prepare(decodeShippingOptionTypeDeletionIds),
      ({ service, context }, ids) => service.restoreShippingOptionTypes([...ids], {}, context));
    const countOptions = commands.read("shippingOptionCountForTypeDeletion", prepare(decodeShippingOptionTypeDeletionRead),
      ({ service, context }, input) => service.listAndCountShippingOptions(input.filters,
        { ...input.config, select: [...input.config.select], relations: [...input.config.relations] }, context));
    const moduleEvents = (action: "deleted" | "restored") => [buildModuleResourceEventName({ prefix: Modules.FULFILLMENT,
      objectName: "shipping_option_type", action })];
    const softDeleteShippingOptionTypes = yield* defineWorkflowMethod({ command: softDeleteForWorkflow,
      arguments: decodeShippingOptionTypeDeletionArguments, encode: ([ids]) => ids,
      output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("deleted") });
    const restoreShippingOptionTypes = yield* defineWorkflowMethod({ command: restoreForWorkflow,
      arguments: decodeShippingOptionTypeDeletionArguments, encode: ([ids]) => ids,
      output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("restored") });
    const joiner = fulfillmentStaticResources.joinerConfig;
    if (joiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const graph: GraphModuleDefinition = { aliases: yield* moduleAliases({ ...joiner,
      alias: (Array.isArray(joiner.alias) ? joiner.alias : joiner.alias === undefined ? [] : [joiner.alias]).filter(alias => alias.entity === "ShippingOption") }),
      reads: [{ model: "ShippingOption", command: countOptions, table: prepared.optionTable, paths: [],
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount }] };
    const admitted = [softDeleteForWorkflow, restoreForWorkflow, countOptions], policy = shippingOptionTypeDeletionPolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { softDeleteShippingOptionTypes, restoreShippingOptionTypes }, graph, logical: { ...policy, commands: admitted } });
    return { softDeleteForWorkflow, restoreForWorkflow, countOptions, commands: admitted, workflow, graph, withService: module.use,
      logicalEventPolicy: () => policy };
  }));
});

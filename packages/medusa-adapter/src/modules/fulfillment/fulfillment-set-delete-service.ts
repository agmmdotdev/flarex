import { Effect, Result } from "effect";
import { FulfillmentSet } from "@medusajs/fulfillment/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceServiceCommands, commerceCommandPreparation } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule, defineWorkflowMethod, type WorkflowMethod } from "../../workflow/module";
import { defineFulfillmentPersistenceModule, fulfillmentServiceRouting, type FulfillmentPersistenceModel } from "./fulfillment-module";
import { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareFulfillmentSetDeletionRepository } from "./fulfillment-set-delete-repository";
import { decodeFulfillmentSetLifecycleArguments, decodeFulfillmentSetLifecycleInput } from "./fulfillment-set-delete-input";
import { fulfillmentSetDeletionPolicy } from "./fulfillment-set-delete-receipt";

const definitions = new WeakMap<object, { readonly routing: ReturnType<typeof fulfillmentServiceRouting>;
  readonly softDelete: WorkflowMethod;
  readonly restore: WorkflowMethod }>();
export function fulfillmentSetDeletionServiceDefinition(input: unknown) {
  const definition = typeof input === "object" && input !== null ? definitions.get(input) : undefined;
  return definition === undefined ? undefined : { ...definition, routing: structuredClone(definition.routing) };
}

export const makeFulfillmentSetDeletionCommands = Effect.fn("FulfillmentSetAdapter.deleteCommands")(function* () {
  const metadata = yield* captureServiceZoneCreationMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareFulfillmentSetDeletionRepository(metadata.frame);
    const module = yield* defineFulfillmentPersistenceModule({ name: "flarex-fulfillment-set-delete", profile: "fulfillment-set-delete",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner);
        const eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository,
          repository: (model: FulfillmentPersistenceModel) => model === FulfillmentSet ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus, denied: bound.denied };
      }, service: native => ({ softDeleteFulfillmentSets: native.softDeleteFulfillmentSets.bind(native), restoreFulfillmentSets: native.restoreFulfillmentSets.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("FulfillmentSetDelete.prepare");
    const softDeleteForWorkflow = commands.write("fulfillmentSetSoftDeleteForWorkflow", prepare(decodeFulfillmentSetLifecycleInput),
      ({ service, context }, input) => Array.isArray(input) ? service.softDeleteFulfillmentSets([...input], {}, context)
        : service.softDeleteFulfillmentSets(input.selector, input.config, context));
    const restoreForWorkflow = commands.write("fulfillmentSetRestoreForWorkflow", prepare(decodeFulfillmentSetLifecycleInput),
      ({ service, context }, input) => Array.isArray(input) ? service.restoreFulfillmentSets([...input], {}, context)
        : service.restoreFulfillmentSets(input.selector, input.config, context));
    const moduleEvents = (action: "deleted" | "restored") => prepared.contracts.entities.map(entity =>
      buildModuleResourceEventName({ prefix: Modules.FULFILLMENT, objectName: entity.table.name, action }));
    const softDeleteFulfillmentSets = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeFulfillmentSetLifecycleArguments,
      encode: args => args.length === 1 ? args[0] : { selector: args[0], config: args[1] }, output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("deleted") });
    const restoreFulfillmentSets = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeFulfillmentSetLifecycleArguments,
      encode: args => args.length === 1 ? args[0] : { selector: args[0], config: args[1] }, output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("restored") });
    const admitted = [softDeleteForWorkflow, restoreForWorkflow], policy = fulfillmentSetDeletionPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.FULFILLMENT, source: module.description,
      methods: { softDeleteFulfillmentSets, restoreFulfillmentSets }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    definitions.set(workflow, { routing: fulfillmentServiceRouting(), softDelete: softDeleteFulfillmentSets, restore: restoreFulfillmentSets });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, withService: module.use,
      logicalEventPolicy: () => policy, output: prepared.contracts.Output, decodeOutput: prepared.contracts.decodeOutput };
  }));
});

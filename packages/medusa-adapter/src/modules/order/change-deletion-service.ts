import { Effect, Result } from "effect";
import { OrderChange } from "@medusajs/order/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { defineOrderPersistenceModule } from "./module";
import { captureOrderMetadata } from "./schema";
import { decodeOrderChangeDeletionArguments, decodeOrderChangeDeletionIds } from "./change-deletion-input";
import { prepareOrderChangeDeletionRepository } from "./change-deletion-repository";
import { orderChangeDeletionPolicy } from "./change-deletion-receipt";

/** Native Change deletion and restoration retain complete Action history.
 * Other Order repositories grant no independent operations in this profile. */
export const makeOrderChangeDeletionCommands = Effect.fn("OrderChange.deletionCommands")(function* () {
  const metadata = yield* captureOrderMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareOrderChangeDeletionRepository(metadata.frame);
    const module = yield* defineOrderPersistenceModule({ name: "flarex-order-change-deletion", profile: "order.changeDeletion",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === OrderChange ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => {
        // Native declarations assume every cascade model has a linkable key.
        // Action's unmapped rows remain unknown until the DML decoder checks them.
        const softDeleteOrderChanges: (...args: Parameters<typeof native.softDeleteOrderChanges>) => Promise<unknown> = native.softDeleteOrderChanges.bind(native);
        const restoreOrderChanges: (...args: Parameters<typeof native.restoreOrderChanges>) => Promise<unknown> = native.restoreOrderChanges.bind(native);
        return { softDeleteOrderChanges, restoreOrderChanges };
      }
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderChangeDeletion.prepare");
    const softDeleteForWorkflow = commands.write("orderChangeSoftDeleteForWorkflow", prepare(decodeOrderChangeDeletionIds),
      ({ service, context }, ids) => service.softDeleteOrderChanges([...ids], {}, context));
    const restoreForWorkflow = commands.write("orderChangeRestoreForWorkflow", prepare(decodeOrderChangeDeletionIds),
      ({ service, context }, ids) => service.restoreOrderChanges([...ids], {}, context));
    const moduleEvents = (action: "deleted" | "restored") => ["order_change", "order_change_action"].map(objectName =>
      buildModuleResourceEventName({ prefix: Modules.ORDER, objectName, action }));
    const softDeleteOrderChanges = yield* defineWorkflowMethod({ command: softDeleteForWorkflow, arguments: decodeOrderChangeDeletionArguments,
      encode: ([ids]) => ids, output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("deleted") });
    const restoreOrderChanges = yield* defineWorkflowMethod({ command: restoreForWorkflow, arguments: decodeOrderChangeDeletionArguments,
      encode: ([ids]) => ids, output: prepared.contracts.decodeOutput, moduleEvents: moduleEvents("restored") });
    const admitted = [softDeleteForWorkflow, restoreForWorkflow], policy = orderChangeDeletionPolicy(prepared.contracts);
    const workflow = yield* defineWorkflowModule({ name: Modules.ORDER, source: module.description,
      methods: { softDeleteOrderChanges, restoreOrderChanges }, graph: { aliases: [], reads: [] },
      logical: { ...policy, commands: admitted } });
    return { softDeleteForWorkflow, restoreForWorkflow, commands: admitted, workflow, withService: module.use,
      source: module.description, contracts: prepared.contracts, prepared, logicalEventPolicy: () => policy };
  }));
});

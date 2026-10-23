import { Effect, Result, Schema } from "effect";
import { OrderChange } from "@medusajs/order/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineOrderPersistenceModule } from "./module";
import { captureOrderMetadata } from "./schema";
import { OrderChangeUpdateInput, OrderChangeUpdateRead, decodeOrderChangeUpdateInput, decodeOrderChangeUpdateRead } from "./change-update-input";
import { prepareOrderChangeUpdateRepository } from "./change-update-repository";
import { orderChangeUpdatePolicy } from "./change-update-receipt";

const decodeReadArguments = commerceDecoder(Schema.Tuple([OrderChangeUpdateRead.fields.filters, OrderChangeUpdateRead.fields.config]), "invalidInput");
const decodeUpdateArguments = commerceDecoder(Schema.Tuple([OrderChangeUpdateInput]), "invalidInput");

/** Existing native Order construction with a separate scalar Change authority.
 * Native services retain all normalization, missing-ID and duplicate behavior. */
export const makeOrderChangeUpdateCommands = Effect.fn("OrderChange.updateCommands")(function* () {
  const metadata = yield* captureOrderMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareOrderChangeUpdateRepository(metadata.frame);
    const module = yield* defineOrderPersistenceModule({ name: "flarex-order-change-update", profile: "order.changeUpdate",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === OrderChange ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ listOrderChanges: native.listOrderChanges.bind(native), updateOrderChanges: native.updateOrderChanges.bind(native) })
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderChangeUpdate.prepare");
    const listForWorkflow = commands.read("orderChangeListForUpdate", prepare(decodeOrderChangeUpdateRead), async ({ service, context }, input) => {
      // The finite runtime projection owns its checked DML field strings; the
      // native FindConfig type instead enumerates its authoring DTO keys.
      const result: unknown = await Reflect.apply(service.listOrderChanges, service, [input.filters, input.config, context]);
      return result;
    });
    const updateForWorkflow = commands.write("orderChangeUpdate", prepare(decodeOrderChangeUpdateInput), async ({ service, context }, input) => {
      // Native retained nullable scalar values follow checked DML even where
      // the authoring DTO's optional string fields omit null from their types.
      const result: unknown = await Reflect.apply(service.updateOrderChanges, service, [input, context]);
      return result;
    });
    const listOrderChanges = yield* defineWorkflowMethod({ command: listForWorkflow, arguments: decodeReadArguments,
      encode: ([filters, config]) => ({ filters, config }), output: prepared.contracts.decodePreimages });
    const updateOrderChanges = yield* defineWorkflowMethod({ command: updateForWorkflow, arguments: decodeUpdateArguments,
      encode: ([data]) => data, output: prepared.contracts.decodeRows,
      moduleEvents: [buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: "order_change", action: "updated" })] });
    const admitted = [listForWorkflow, updateForWorkflow], policy = orderChangeUpdatePolicy(prepared);
    const workflow = yield* defineWorkflowModule({ name: Modules.ORDER, source: module.description,
      methods: { listOrderChanges, updateOrderChanges }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { listForWorkflow, updateForWorkflow, commands: admitted, source: module.description, workflow,
      withService: module.use, prepared, contracts: prepared.contracts, logicalEventPolicy: () => policy };
  }));
});

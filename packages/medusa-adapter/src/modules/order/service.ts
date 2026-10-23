import { Effect, Result, Schema } from "effect";
import { Order } from "@medusajs/order/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineOrderPersistenceModule } from "./module";
import { captureOrderMetadata } from "./schema";
import { OrderArchiveIds, OrderArchiveRead, OrderArchiveStatuses,
  decodeOrderArchiveIds, decodeOrderArchiveRead, decodeOrderArchiveStatuses } from "./input";
import { prepareOrderArchiveRepository } from "./repository";
import { orderArchivePolicy } from "./receipt";

const decodeReadArguments = commerceDecoder(Schema.Tuple([OrderArchiveRead.fields.filters, OrderArchiveRead.fields.config]), "invalidInput");
const decodeArchiveArguments = commerceDecoder(Schema.Tuple([OrderArchiveIds]), "invalidInput");
const decodeInverseArguments = commerceDecoder(Schema.Tuple([OrderArchiveStatuses]), "invalidInput");

/** One confined native Order service. Only the archive root's named reads,
 * archive and status-preimage inverse cross the participant boundary. */
export const makeOrderArchiveCommands = Effect.fn("Order.archiveCommands")(function* () {
  const metadata = yield* captureOrderMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareOrderArchiveRepository(metadata.frame);
    const module = yield* defineOrderPersistenceModule({ name: "flarex-order-archive", profile: "order.archive",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === Order ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      },
      service: native => ({ listOrders: native.listOrders.bind(native), archive: native.archive.bind(native),
        updateOrders: native.updateOrders.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderArchive.prepare");
    const listForWorkflow = commands.read("orderStatusPreimages", prepare(decodeOrderArchiveRead),
      ({ service, context }, input) => service.listOrders(input.filters, { select: [...input.config.select] }, context));
    const archiveForWorkflow = commands.write("orderArchive", prepare(decodeOrderArchiveIds),
      ({ service, context }, ids) => service.archive(ids, context));
    const restoreStatusesForWorkflow = commands.write("orderRestoreStatuses", prepare(decodeOrderArchiveStatuses),
      async ({ service, context }, statuses) => await Reflect.apply(service.updateOrders, service, [statuses, undefined, context]));
    const listOrders = yield* defineWorkflowMethod({ command: listForWorkflow,
      arguments: decodeReadArguments,
      encode: ([filters, config]) => ({ filters, config }), output: prepared.contracts.decodePreimages });
    const events = [buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: "order", action: "updated" })];
    const archive = yield* defineWorkflowMethod({ command: archiveForWorkflow,
      arguments: decodeArchiveArguments, encode: ([ids]) => ids,
      output: prepared.contracts.decodeRows, moduleEvents: events });
    const updateOrders = yield* defineWorkflowMethod({ command: restoreStatusesForWorkflow,
      arguments: decodeInverseArguments, encode: ([statuses]) => statuses,
      output: prepared.contracts.decodeRows, moduleEvents: events });
    const policy = orderArchivePolicy(prepared), admitted = [listForWorkflow, archiveForWorkflow, restoreStatusesForWorkflow];
    const workflow = yield* defineWorkflowModule({ name: Modules.ORDER, source: module.description,
      methods: { listOrders, archive, updateOrders }, graph: { aliases: [], reads: [] }, logical: { ...policy, commands: admitted } });
    return { listForWorkflow, archiveForWorkflow, restoreStatusesForWorkflow, commands: admitted, workflow,
      source: module.description, withService: module.use, prepared, contracts: prepared.contracts, logicalEventPolicy: () => policy };
  }));
});

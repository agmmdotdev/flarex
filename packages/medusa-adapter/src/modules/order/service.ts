import { Effect, Result, Schema } from "effect";
import { Order } from "@medusajs/order/models";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { defineOrderPersistenceModule } from "./module";
import { captureOrderMetadata } from "./schema";
import { OrderArchiveIds, OrderArchiveRead, OrderArchiveStatuses, OrderCompletionStatuses,
  decodeOrderArchiveIds, decodeOrderArchiveRead, decodeOrderArchiveStatuses, decodeOrderCompletionStatuses,
  type OrderRetainedStatuses, type OrderStatusProfile } from "./input";
import { prepareOrderArchiveRepository, prepareOrderCompletionRepository } from "./repository";
import { orderArchivePolicy, orderCompletionPolicy } from "./receipt";

const decodeReadArguments = commerceDecoder(Schema.Tuple([OrderArchiveRead.fields.filters, OrderArchiveRead.fields.config]), "invalidInput");
const decodeStatusArguments = commerceDecoder(Schema.Tuple([OrderArchiveIds]), "invalidInput");
const decodeArchiveInverseArguments = commerceDecoder(Schema.Tuple([OrderArchiveStatuses]), "invalidInput");
const decodeCompletionInverseArguments = commerceDecoder(Schema.Tuple([OrderCompletionStatuses]), "invalidInput");

/** The bounded status profiles share their native service and persistence
 * owner while retaining separate command and inverse admission. */
const prepareOrderStatusCommands = Effect.fn("Order.statusCommands")(function* <Statuses extends OrderRetainedStatuses>(
  profile: OrderStatusProfile,
  decodeStatuses: (input: unknown) => Result.Result<Statuses, CommerceTransactionError>,
  decodeInverseArguments: (input: unknown) => Result.Result<readonly [Statuses], CommerceTransactionError>,
) {
  const metadata = yield* captureOrderMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* (profile === "archive" ? prepareOrderArchiveRepository(metadata.frame)
      : prepareOrderCompletionRepository(metadata.frame));
    const module = yield* defineOrderPersistenceModule({ name: `flarex-order-${profile}`, profile: `order.${profile}`,
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: bound.repository, repository: model => model === Order ? bound.repository : bound.denied,
          events: bound.mutationEvents, eventBus };
      },
      service: native => ({ listOrders: native.listOrders.bind(native),
        changeStatus: profile === "archive" ? native.archive.bind(native) : native.completeOrder.bind(native),
        updateOrders: native.updateOrders.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderStatus.prepare");
    const listForWorkflow = commands.read("orderStatusPreimages", prepare(decodeOrderArchiveRead),
      ({ service, context }, input) => service.listOrders(input.filters, { select: [...input.config.select] }, context));
    const statusForWorkflow = commands.write(profile === "archive" ? "orderArchive" : "orderComplete", prepare(decodeOrderArchiveIds),
      ({ service, context }, ids) => service.changeStatus(ids, context));
    const restoreStatusesForWorkflow = commands.write("orderRestoreStatuses", prepare(decodeStatuses),
      async ({ service, context }, statuses) => await Reflect.apply(service.updateOrders, service, [statuses, undefined, context]));
    const listOrders = yield* defineWorkflowMethod({ command: listForWorkflow,
      arguments: decodeReadArguments,
      encode: ([filters, config]) => ({ filters, config }), output: prepared.contracts.decodePreimages });
    const events = [buildModuleResourceEventName({ prefix: Modules.ORDER, objectName: "order", action: "updated" })];
    const changeStatus = yield* defineWorkflowMethod({ command: statusForWorkflow,
      arguments: decodeStatusArguments, encode: ([ids]) => ids,
      output: prepared.contracts.decodeRows, moduleEvents: events });
    const updateOrders = yield* defineWorkflowMethod({ command: restoreStatusesForWorkflow,
      arguments: decodeInverseArguments, encode: ([statuses]) => statuses,
      output: prepared.contracts.decodeRows, moduleEvents: events });
    const policy = profile === "archive" ? orderArchivePolicy(prepared) : orderCompletionPolicy(prepared);
    const admitted = [listForWorkflow, statusForWorkflow, restoreStatusesForWorkflow];
    return { listForWorkflow, statusForWorkflow, restoreStatusesForWorkflow, commands: admitted,
      source: module.description, withService: module.use, prepared, contracts: prepared.contracts,
      logicalEventPolicy: () => policy, methods: { listOrders, changeStatus, updateOrders }, policy };
  }));
});

export const makeOrderArchiveCommands = Effect.fn("Order.archiveCommands")(function* () {
  const { statusForWorkflow: archiveForWorkflow, methods, policy, ...common } = yield* prepareOrderStatusCommands(
    "archive", decodeOrderArchiveStatuses, decodeArchiveInverseArguments);
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: Modules.ORDER, source: common.source,
    methods: { listOrders: methods.listOrders, archive: methods.changeStatus, updateOrders: methods.updateOrders },
    graph: { aliases: [], reads: [] }, logical: { ...policy, commands: common.commands } }));
  return { ...common, archiveForWorkflow, workflow };
});

export const makeOrderCompletionCommands = Effect.fn("Order.completionCommands")(function* () {
  const { statusForWorkflow: completeForWorkflow, methods, policy, ...common } = yield* prepareOrderStatusCommands(
    "complete", decodeOrderCompletionStatuses, decodeCompletionInverseArguments);
  const workflow = yield* Effect.fromResult(defineWorkflowModule({ name: Modules.ORDER, source: common.source,
    methods: { listOrders: methods.listOrders, completeOrder: methods.changeStatus, updateOrders: methods.updateOrders },
    graph: { aliases: [], reads: [] }, logical: { ...policy, commands: common.commands } }));
  return { ...common, completeForWorkflow, workflow };
});

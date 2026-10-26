import { Effect, Result, Schema } from "effect";
import { OrderModuleService } from "@medusajs/order/services";
import type { CreateOrderChangeDTO } from "@medusajs/order/types";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { moduleAliases, relationPaths } from "../../local-graph/module";
import { decodeGraphCount } from "../../local-graph/query";
import { makeReadCatalog } from "../../query/catalog";
import { defineWorkflowMethod, defineWorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { defineOrderPersistenceModule } from "./module";
import { captureOrderMetadata } from "./schema";
import { prepareOrderFinanceRepository } from "./finance-repository";
import { orderFinanceEventCapture } from "./finance-events";
import { validateOrderFinanceRead } from "./finance-read-receipt";
import { validateOrderFinanceTransactions } from "./finance-transactions-receipt";
import { validateOrderFinanceChangeCreation } from "./finance-change-creation-receipt";
import { validateOrderFinanceChangeDeletion } from "./finance-change-deletion-receipt";
import { validateOrderFinanceChangeApplication } from "./finance-change-application-receipt";
import { validateOrderFinanceChangeUndo } from "./finance-change-undo-receipt";
import { OrderFinanceRead, OrderFinanceTransactions, OrderFinanceDelete,
  OrderFinanceChange, OrderFinanceActions, OrderFinanceConfirm, OrderFinanceUndo, decodeOrderFinanceChange, decodeOrderFinanceActions,
  decodeOrderFinanceConfirm, decodeOrderFinanceUndo,
  decodeOrderFinanceRead, decodeOrderFinanceTransactions, decodeOrderFinanceDelete } from "./finance-input";

const readArguments = commerceDecoder(Schema.Tuple([OrderFinanceRead.fields.filters, OrderFinanceRead.fields.config.schema]), "invalidInput");
const addArguments = commerceDecoder(Schema.Tuple([OrderFinanceTransactions]), "invalidInput");
const deleteArguments = commerceDecoder(Schema.Tuple([OrderFinanceDelete]), "invalidInput");
const changeArguments = commerceDecoder(Schema.Tuple([OrderFinanceChange]), "invalidInput");
const actionArguments = commerceDecoder(Schema.Tuple([OrderFinanceActions]), "invalidInput");
const confirmArguments = commerceDecoder(Schema.Tuple([OrderFinanceConfirm]), "invalidInput");
const undoArguments = commerceDecoder(Schema.Tuple([OrderFinanceUndo.fields.order_id, OrderFinanceUndo.fields.previous.schema]), "invalidInput");
const decodeTransactions = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "receiptMismatch");
const decodeChange = commerceDecoder(Schema.JsonObject, "receiptMismatch");
const decodeNull = commerceDecoder(Schema.Null, "receiptMismatch");
const decodeConfirmation = commerceDecoder(Schema.Struct({ items: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  shipping_methods: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), credit_lines: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)) }), "receiptMismatch");

/** One native construction for Payment's financial Order branch. Transaction
 * methods, graph reads, CREDIT_LINE_ADD confirmation and its retained native
 * inverse each authenticate their own storage and event receipts. */
export const makeOrderPaymentFinanceCommands = Effect.fn("OrderFinance.commands")(function* () {
  const metadata = yield* captureOrderMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareOrderFinanceRepository(metadata.frame);
    const module = yield* defineOrderPersistenceModule({ name: "flarex-order-payment-finance", profile: "order.payment-finance",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message),
          check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: { ...bound.denied, serialize: bound.serialize }, repository: bound.repository,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ listAndCountOrders: native.listAndCountOrders.bind(native),
        listAndCountOrderChanges: native.listAndCountOrderChanges.bind(native),
        listOrderTransactions: native.listOrderTransactions.bind(native), addOrderTransactions: native.addOrderTransactions.bind(native),
        deleteOrderTransactions: native.deleteOrderTransactions.bind(native),
        createOrderChange: native.createOrderChange.bind(native), addOrderAction: native.addOrderAction.bind(native),
        deleteOrderChanges: native.deleteOrderChanges.bind(native), deleteOrderChangeActions: native.deleteOrderChangeActions.bind(native),
        confirmOrderChange: native.confirmOrderChange.bind(native), undoLastChange: native.undoLastChange.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderFinance.prepare");
    const orders = commands.read("orderPaymentFinanceOrders", prepare(decodeOrderFinanceRead), async ({ service, context }, input) => {
      const result: unknown = await Reflect.apply(service.listAndCountOrders, service, [input.filters, input.config ?? {}, context]);
      // This native Promise method formats totals after its DAL serialization.
      // Its numeric DTO presentation crosses the existing Promise owner; typed
      // refusals retain that owner's normal domain-failure classification.
      return Result.getOrThrow(captureNativeNumericDto(result));
    });
    const changes = commands.read("orderPaymentFinanceChanges", prepare(decodeOrderFinanceRead),
      ({ service, context }, input) => Reflect.apply(service.listAndCountOrderChanges, service, [input.filters, input.config ?? {}, context]));
    const transactions = commands.read("orderPaymentFinanceTransactionsRead", prepare(decodeOrderFinanceRead),
      ({ service, context }, input) => Reflect.apply(service.listOrderTransactions, service, [input.filters, input.config ?? {}, context]));
    const add = commands.write("orderPaymentFinanceTransactionsAdd", prepare(decodeOrderFinanceTransactions),
      ({ service, context }, input) => Reflect.apply(service.addOrderTransactions, service, [input, context]));
    const remove = commands.write("orderPaymentFinanceTransactionsDelete", prepare(decodeOrderFinanceDelete), async ({ service, context }, input) => {
      await service.deleteOrderTransactions(input, context); return null;
    });
    const createChange = commands.write("orderPaymentFinanceChangeCreate", prepare(decodeOrderFinanceChange),
      ({ service, context }, input) => service.createOrderChange(input, context));
    const addActions = commands.write("orderPaymentFinanceActionsCreate", prepare(decodeOrderFinanceActions),
      ({ service, context }, input) => Reflect.apply(service.addOrderAction, service, [input, context]));
    const deleteChanges = commands.write("orderPaymentFinanceChangesDelete", prepare(decodeOrderFinanceDelete), async ({ service, context }, input) => {
      await service.deleteOrderChanges(input, context); return null;
    });
    const deleteActions = commands.write("orderPaymentFinanceActionsDelete", prepare(decodeOrderFinanceDelete), async ({ service, context }, input) => {
      await service.deleteOrderChangeActions(input, context); return null;
    });
    const confirmChanges = commands.write("orderPaymentFinanceChangesConfirm", prepare(decodeOrderFinanceConfirm),
      ({ service, context }, input) => service.confirmOrderChange(input, context));
    const undoChanges = commands.write("orderPaymentFinanceChangesUndo", prepare(decodeOrderFinanceUndo), async ({ service, context }, input) => {
      await service.undoLastChange(input.order_id, input.previous, context); return null;
    });
    const listOrderTransactions = yield* defineWorkflowMethod({ command: transactions, arguments: readArguments,
      encode: ([filters, config]) => ({ filters, config }), output: decodeTransactions });
    const event = (objectName: string, action: string) => buildModuleResourceEventName({ prefix: Modules.ORDER, objectName, action });
    const addOrderTransactions = yield* defineWorkflowMethod({ command: add, arguments: addArguments, encode: ([data]) => data,
      output: decodeTransactions, moduleEvents: [event("order_transaction", "created"), event("order_summary", "updated")] });
    const deleteOrderTransactions = yield* defineWorkflowMethod({ command: remove, arguments: deleteArguments, encode: ([ids]) => ids,
      output: decodeNull, moduleEvents: [event("order_transaction", "deleted"), event("order_summary", "updated")] });
    const createOrderChange = yield* defineWorkflowMethod({ command: createChange, arguments: changeArguments, encode: ([data]) => data,
      output: decodeChange, moduleEvents: [event("order_change", "created")] });
    const addOrderAction = yield* defineWorkflowMethod({ command: addActions, arguments: actionArguments, encode: ([data]) => data,
      output: decodeTransactions, moduleEvents: [event("order_change_action", "created")] });
    const deleteOutput = (value: unknown) => decodeNull(value).pipe(Result.map(() => undefined));
    const deleteOrderChanges = yield* defineWorkflowMethod({ command: deleteChanges, arguments: deleteArguments, encode: ([ids]) => ids,
      output: deleteOutput, moduleEvents: [event("order_change", "deleted")] });
    const deleteOrderChangeActions = yield* defineWorkflowMethod({ command: deleteActions, arguments: deleteArguments, encode: ([ids]) => ids,
      output: deleteOutput, moduleEvents: [event("order_change_action", "deleted")] });
    const confirmOrderChange = yield* defineWorkflowMethod({ command: confirmChanges, arguments: confirmArguments, encode: ([data]) => data,
      output: decodeConfirmation, moduleEvents: [event("order_change", "updated"), event("order", "updated"), event("order_change_action", "updated"),
        ...["order_item", "order_summary", "order_shipping", "order_credit_line"].flatMap(table => [event(table, "created"), event(table, "updated")]),
        event("order_line_item_adjustment", "created")] });
    const undoLastChange = yield* defineWorkflowMethod({ command: undoChanges, arguments: undoArguments,
      encode: ([order_id, previous]) => ({ order_id, previous }), output: deleteOutput,
      moduleEvents: [event("order_change", "updated"), event("order_change_action", "updated"), event("order", "updated"),
        ...["order_summary", "order_item", "order_shipping", "order_credit_line"].map(table => event(table, "deleted"))] });
    const storedOrder = yield* prepared.contracts.catalog.table("order");
    // ReadTable describes the native public projection, not a storage schema
    // or table capability. These two required native presentation fields must
    // reach Order's actual selector so it loads and computes their read closure.
    // The read receipt authenticates the resulting native formatOrder output.
    const presentation = yield* makeReadCatalog([{ ...storedOrder, columns: [...storedOrder.columns, "total", "summary"] }], new Map());
    const aliases = yield* moduleAliases(OrderModuleService.prototype.__joinerConfig());
    const admitted = [orders, changes, transactions, add, remove, createChange, addActions, deleteChanges, deleteActions, confirmChanges, undoChanges];
    const read = validateOrderFinanceRead(prepared), write = validateOrderFinanceTransactions(prepared);
    const creation = validateOrderFinanceChangeCreation(prepared), deletion = validateOrderFinanceChangeDeletion(prepared);
    const confirmation = validateOrderFinanceChangeApplication(prepared), undo = validateOrderFinanceChangeUndo(prepared);
    const capture = orderFinanceEventCapture(prepared);
    const validateLogicalCall: typeof read = (call, activity) => {
      if (call.mode === "read") return read(call, activity);
      switch (call.commandName) {
        case "orderPaymentFinanceChangeCreate": case "orderPaymentFinanceActionsCreate": return creation(call, activity);
        case "orderPaymentFinanceChangesDelete": case "orderPaymentFinanceActionsDelete": return deletion(call, activity);
        case "orderPaymentFinanceChangesConfirm": return confirmation(call, activity);
        case "orderPaymentFinanceChangesUndo": return undo(call, activity);
        default: return write(call, activity);
      }
    };
    const policy = { capture, validateLogicalCall };
    const workflow = yield* defineWorkflowModule({ name: Modules.ORDER, source: module.description,
      methods: { listOrderTransactions, addOrderTransactions, deleteOrderTransactions,
        createOrderChange, addOrderAction, deleteOrderChanges, deleteOrderChangeActions, confirmOrderChange, undoLastChange },
      graph: { aliases: aliases.filter(alias => alias.model === "Order" || alias.model === "OrderChange"), reads: [
        { model: "Order", command: orders, table: yield* presentation.table("order"), paths: [],
          orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount },
        { model: "OrderChange", command: changes, table: yield* prepared.contracts.catalog.table("order_change"),
          paths: yield* relationPaths(prepared.contracts.catalog, "order_change", ["actions"]),
          orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeGraphCount },
      ] }, logical: { ...policy, commands: admitted, allowPreservingDeletionUpsert: "preserveTimestamps" } });
    return { orders, changes, transactions, add, remove, createChange, addActions, deleteChanges, deleteActions, confirmChanges, undoChanges, commands: admitted, workflow, prepared,
      source: module.description, withService: module.use, logicalEventPolicy: () => policy };
  }));
});

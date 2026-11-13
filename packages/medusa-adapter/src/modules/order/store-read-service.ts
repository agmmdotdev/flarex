import { Effect, Result } from "effect";
import { OrderModuleService } from "@medusajs/order/services";
import { Modules } from "@medusajs/framework/utils/portable";
import { OrderProduct } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceCommandPreparation, commerceServiceCommands } from "../../module/commands";
import { commerceModuleEventBus } from "../../module/events";
import { defineWorkflowModule } from "../../workflow/module";
import { moduleAliases } from "../../local-graph/module";
import { extendNativeGraphMetadata, withNativeGraphMetadata } from "../../local-graph/native-metadata";
import { nativeLinkGraphDirectPaths } from "../../local-graph/direct-paths";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { projectNativeRow } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { defineOrderPersistenceModule } from "./module";
import { captureOrderMetadata } from "./schema";
import { prepareOrderCheckoutRead } from "./checkout-read";
import { prepareStoreOrderReadRepository } from "./store-read-repository";
import { decodeStoreOrderRead, decodeStoreOrderCount, storeOrderPageLimit, storeOrderRelatedLimit, storeOrderReadResources } from "./store-read-input";

/** Read-only Store browsing shares native formatting with checkout, with its
 * own authenticated paging/filter profile and no financial method grants. */
export const makeStoreOrderReadCommands = Effect.fn("OrderStoreRead.commands")(function* () {
  const metadata = yield* captureOrderMetadata();
  return yield* Effect.fromResult(Result.gen(function* () {
    const prepared = yield* prepareStoreOrderReadRepository(metadata.frame);
    const module = yield* defineOrderPersistenceModule({ name: "flarex-order-store-read", profile: "order.store-read",
      bind: (ctx, owner) => {
        const bound = prepared.bind(ctx, owner), eventBus = commerceModuleEventBus({ owner, resources: ctx.resources,
          capture: message => bound.bridge.current().captureLocalEvent(message), check: work => bound.bridge.checked(ctx, work), refuse: bound.refuse });
        return { baseRepository: { ...bound.denied, serialize: bound.serialize }, repository: bound.repository,
          events: bound.mutationEvents, eventBus };
      }, service: native => ({ listAndCountOrders: native.listAndCountOrders.bind(native),
        listAndCountOrderLineItems: native.listAndCountOrderLineItems.bind(native) }),
    }).pipe(Result.mapError(cause => commerceError("unsupportedProfile", cause)));
    const commands = commerceServiceCommands(module.use), prepare = commerceCommandPreparation("OrderStoreRead.prepare")(decodeStoreOrderRead);
    const orders = commands.read("orderReadForStore", prepare, async ({ service, context }, input) =>
      Result.getOrThrow(captureNativeNumericDto(await Reflect.apply(service.listAndCountOrders, service, [input.filters, input.config ?? {}, context]), storeOrderReadResources)));
    const lineItems = commands.read("orderLineItemsReadForStore", prepare, async ({ service, context }, input) =>
      Result.getOrThrow(captureNativeNumericDto(await Reflect.apply(service.listAndCountOrderLineItems, service, [input.filters, input.config ?? {}, context]), storeOrderReadResources)));
    const admitted = [orders, lineItems];
    const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("OrderStoreRead.validateRead")(function* (call, activity) {
      if (call.mode !== "read" || !["orderReadForStore", "orderLineItemsReadForStore"].includes(call.commandName) || call.events.length ||
        activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* Effect.fromResult(decodeStoreOrderRead(call.input));
      for (const observation of activity.observedRows) {
        const entity = yield* Effect.fromResult(prepared.contracts.entity(observation.table));
        yield* Effect.fromResult(entity.complete(projectNativeRow(observation.row)));
      }
      const [rows, total] = yield* Effect.fromResult(decodeStoreOrderCount(call.result));
      if (rows.length > (call.commandName === "orderReadForStore" ? storeOrderPageLimit : storeOrderRelatedLimit) || rows.length > total)
        return yield* Effect.fail(commerceError("receiptMismatch"));
    });
    const policy = { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
    const aliases = yield* moduleAliases(OrderModuleService.prototype.__joinerConfig()), read = yield* prepareOrderCheckoutRead(prepared.contracts.catalog);
    const graph = yield* withNativeGraphMetadata({ aliases: aliases.filter(alias => alias.model === "Order" || alias.model === "OrderLineItem"), reads: [
      { model: "Order", command: orders, table: read.table,
        presentation: { ...read.presentation, columns: [...read.presentation.columns, "payment_status", "fulfillment_status"] }, paths: read.paths,
        optionalFields: [...read.optionalFields, "payment_status", "fulfillment_status"], nativeFields: true, allowOrFilters: true,
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeStoreOrderCount },
      { model: "OrderLineItem", command: lineItems, table: read.line, paths: [], nativeFields: true,
        orderable: ["id"], uniqueOrder: ["id"], multipleOrder: false, decode: decodeStoreOrderCount },
    ] }, [OrderModuleService.prototype.__joinerConfig()], metadata.frame.tables);
    const native = yield* extendNativeGraphMetadata(graph, [OrderProduct]);
    const directPaths = yield* nativeLinkGraphDirectPaths(OrderProduct, [{ root: "Order", path: "items.variant",
      maximumSources: 4, maximumTargets: 4, maximumPerSource: 1 }], "OrderLineItem");
    const workflow = yield* defineWorkflowModule({ name: Modules.ORDER, source: module.description, methods: {}, graph: { ...native, directPaths },
      logical: { ...policy, commands: admitted } });
    return { workflow, commands: admitted, orders, lineItems, prepared, source: module.description, logicalEventPolicy: () => policy };
  }));
});

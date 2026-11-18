import { Effect, Schema } from "effect";
import { Modules, CommonEvents, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { isNonArrayRecord } from "@flarex/utils/records";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { inventoryCreateEventPolicy } from "./events";

export function inventoryStockEventPolicy() {
  const creation = inventoryCreateEventPolicy(true);
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literals(["inventory_level", "reservation_item"]),
      action: Schema.Literals([CommonEvents.CREATED, CommonEvents.UPDATED, CommonEvents.DELETED]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 8))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("InventoryStockEvents.capture")(function* (value: unknown) {
    if (isNonArrayRecord(value) && isNonArrayRecord(value.metadata) && value.metadata.object === "inventory_item") return yield* creation.capture(value);
    const message = yield* decode(value);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryStockEvents.validateCall")(function* (call, activity) {
    if (["inventoryCreate", "inventoryCreateLevels", "inventoryCount"].includes(call.commandName)) return yield* creation.validateLogicalCall(call, activity);
    if (activity.setNull.length || activity.referenceReplacements.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (call.mode === "read") {
      if (call.commandName !== "inventoryListReservations" || activity.mutations.length || activity.lifecycle.length || call.events.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    const command = call.commandName;
    if (!["inventoryAdjust", "inventoryReserve", "inventoryUpdateReservation", "inventoryRelease"].includes(command)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set<string>();
    for (const mutation of activity.mutations) {
      const row = mutation.after;
      if (row === null || typeof row.id !== "string" || !["inventory_level", "reservation_item"].includes(mutation.table)) return yield* Effect.fail(commerceError("receiptMismatch"));
      const action = mutation.table === "reservation_item" && command === "inventoryRelease" ? CommonEvents.DELETED
        : mutation.operation === "insert" ? CommonEvents.CREATED : CommonEvents.UPDATED;
      if ((command === "inventoryAdjust" && mutation.table !== "inventory_level") ||
        (mutation.operation === "insert" && (command !== "inventoryReserve" || mutation.table !== "reservation_item")))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      expected.add(JSON.stringify([mutation.table, action, row.id]));
    }
    if (command !== "inventoryRelease" && activity.lifecycle.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(JSON.stringify([message.metadata.object, message.metadata.action, id]))) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

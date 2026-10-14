import { Effect, Schema } from "effect";
import { Modules, CommonEvents, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../../value/input";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";

/** Inventory admits item creation and the native empty level call only. */
export function inventoryCreateEventPolicy() {
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const name = buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_item", action: CommonEvents.CREATED });
  const decode = Schema.decodeUnknownEffect(Schema.Struct({ name: Schema.Literal(name),
    metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literal("inventory_item"), action: Schema.Literal(CommonEvents.CREATED) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
  }), { onExcessProperty: "error" });
  const capture = Effect.fn("InventoryEvents.capture")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources));
    return yield* decode(value).pipe(Effect.mapError(cause => commerceError("unadmittedEvent", cause)));
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryEvents.validateCall")(function* (call, activity) {
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (call.mode === "read") {
      if (activity.mutations.length || call.events.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    if (call.commandName === "inventoryCreateLevels") {
      if (!Array.isArray(call.input) || !Array.isArray(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.input.length || call.result.length || activity.mutations.length || call.events.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    if (Array.isArray(call.input) !== Array.isArray(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const inputs = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== "inventoryCreate" || inputs.length > 4 || results.length !== inputs.length ||
      activity.mutations.length !== inputs.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set<string>();
    for (const [index, mutation] of activity.mutations.entries()) {
      const id = mutation.after?.id;
      if (mutation.ordinal !== index || mutation.table !== "inventory_item" || mutation.operation !== "insert" ||
        mutation.before !== null || typeof id !== "string" || mutation.after?.deleted_at !== null || expected.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      expected.add(id);
    }
    const returned = new Set<string>();
    for (const row of results) {
      if (!isJsonObject(row) || typeof row.id !== "string" || !expected.has(row.id) || returned.has(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      returned.add(row.id);
    }
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

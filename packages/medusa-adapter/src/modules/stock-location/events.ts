import { Effect, Schema } from "effect";
import { Modules, CommonEvents, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { moduleEventDecoder } from "../../module/events";
import { commerceError, defaultCommerceResources, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../../repository/scalar-id-read";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";

export function stockLocationCreateEventPolicy(validateRead: LogicalCallReceiptValidation) {
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.STOCK_LOCATION),
      object: Schema.Literals(["stock_location", "stock_location_address"]), action: Schema.Literal(CommonEvents.CREATED) }),
    data: Schema.Struct({ id: Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isLengthBetween(1, 4))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("StockLocationEvents.capture")(function* (input: unknown) {
    const message = yield* decode(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.STOCK_LOCATION,
      objectName: message.metadata.object, action: CommonEvents.CREATED })) return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StockLocationEvents.validateCall")(function* (call, activity) {
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (call.mode === "read") return yield* validateRead(call, activity);
    if (call.commandName !== "stockLocationCreate" || Array.isArray(call.input) !== Array.isArray(call.result))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const inputs = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    const addresses = inputs.filter(row => isJsonObject(row) && row.address !== undefined).length;
    if (inputs.length > 4 || results.length !== inputs.length || activity.mutations.length !== inputs.length + addresses)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set<string>();
    const ids = new Map<string, Set<string>>([["stock_location", new Set()], ["stock_location_address", new Set()]]);
    for (const [index, mutation] of activity.mutations.entries()) {
      const id = mutation.after?.id;
      const target = ids.get(mutation.table);
      if (mutation.ordinal !== index || target === undefined || mutation.operation !== "insert" || mutation.before !== null ||
        typeof id !== "string" || mutation.after?.deleted_at !== null || target.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      target.add(id); expected.add(mutation.table + ":" + id);
    }
    if (ids.get("stock_location")?.size !== inputs.length || ids.get("stock_location_address")?.size !== addresses)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const returned = new Set<string>();
    for (const row of results) {
      if (!isJsonObject(row) || typeof row.id !== "string" || !ids.get("stock_location")?.has(row.id) || returned.has(row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      returned.add(row.id);
      if (row.address !== undefined && (!isJsonObject(row.address) || typeof row.address.id !== "string" ||
        row.address_id !== row.address.id || !ids.get("stock_location_address")?.has(row.address.id)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(message.metadata.object + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

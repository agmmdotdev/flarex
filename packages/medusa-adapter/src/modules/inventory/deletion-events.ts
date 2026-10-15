import { Effect, Schema } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { moduleEventDecoder } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { inventoryCreateEventPolicy } from "./events";
import { decodeInventoryDeletionInput, inventoryDeletionIds, inventoryDeletionLinkableKeys } from "./deletion-lifecycle";
import { inventoryItemReservedQuantity } from "./deletion-read";

const models = new Map([["inventory_item", "InventoryItem"], ["inventory_level", "InventoryLevel"], ["reservation_item", "ReservationItem"]]);
const decodeComputedResult = commerceDecoder(Schema.Tuple([Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Schema.String, reserved_quantity: Schema.Number.check(Schema.isFinite()),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(8)), Schema.Int]), "receiptMismatch");

export function inventoryDeletionEventPolicy() {
  const creation = inventoryCreateEventPolicy();
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literals(["inventory_item", "inventory_level", "reservation_item"]),
      action: Schema.Literal(CommonEvents.DELETED) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(16))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("InventoryDeletionEvents.capture")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources));
    if (!isJsonObject(value) || value.metadata === undefined || !isJsonObject(value.metadata) || value.metadata.action !== CommonEvents.DELETED)
      return yield* creation.capture(value);
    const message = yield* decode(value);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: message.metadata.object, action: CommonEvents.DELETED }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryDeletionEvents.validateCall")(function* (call, activity) {
    if (call.commandName !== "inventorySoftDeleteItems") {
      yield* creation.validateLogicalCall(call, activity);
      const config = isJsonObject(call.input) ? call.input.config : undefined;
      if (call.commandName === "inventoryCount" && config !== undefined && isJsonObject(config) &&
        Array.isArray(config.select) && config.select.includes("reserved_quantity")) {
        const [rows] = yield* Effect.fromResult(decodeComputedResult(call.result));
        for (const row of rows) {
          const levels = activity.observedRows.filter(observation => observation.table === "inventory_level" &&
            observation.row.inventory_item_id === row.id && observation.row.deleted_at === null).map(observation => observation.row);
          if (row.reserved_quantity !== (yield* inventoryItemReservedQuantity(levels).pipe(
            Effect.mapError(cause => commerceError("receiptMismatch", cause))))) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      return;
    }
    const input = yield* Effect.fromResult(decodeInventoryDeletionInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const ids = inventoryDeletionIds(input.selector), requested = new Set(ids);
    if (call.mode !== "write" || ids.length > 8 || !isJsonObject(call.result) || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const observed = new Map<string, JsonObject>();
    for (const { table, row } of activity.observedRows) if (models.has(table) && typeof row.id === "string") observed.set(table + ":" + row.id, row);
    for (const change of [...activity.mutations].reverse()) if (models.has(change.table) && typeof change.before?.id === "string")
      observed.set(change.table + ":" + change.before.id, change.before);
    const roots = new Set([...observed.entries()].flatMap(([key, row]) => key.startsWith("inventory_item:") &&
      typeof row.id === "string" && requested.has(row.id) && row.deleted_at === null ? [row.id] : []));
    const expected = new Set([...roots].map(id => "inventory_item:" + id));
    for (const [key, row] of observed) if (!key.startsWith("inventory_item:") && typeof row.inventory_item_id === "string" && roots.has(row.inventory_item_id)) expected.add(key);
    const events = new Set<string>(), matched = new Set<number>(), changed = new Map<string, string[]>();
    for (const transition of activity.lifecycle) {
      const id = transition.key.id, model = models.get(transition.table), ordinal = transition.attemptOrdinal;
      if (model === undefined || typeof id !== "string" || Object.keys(transition.key).length !== 1 || transition.operation !== "softDelete" ||
        typeof transition.afterDeletedAt !== "string" || ordinal === null || !expected.delete(transition.table + ":" + id) || matched.has(ordinal))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const change = activity.mutations[ordinal], before = observed.get(transition.table + ":" + id);
      if (change === undefined || change.ordinal !== ordinal || change.operation !== "patch" || change.table !== transition.table ||
        change.before?.id !== id || change.after?.id !== id || before === undefined || before.deleted_at !== transition.beforeDeletedAt ||
        change.before.deleted_at !== transition.beforeDeletedAt || change.after.deleted_at !== transition.afterDeletedAt ||
        (transition.table === "inventory_item" && transition.beforeDeletedAt !== null)) return yield* Effect.fail(commerceError("receiptMismatch"));
      matched.add(ordinal); events.add(transition.table + ":" + id);
      const group = changed.get(model) ?? []; group.push(id); changed.set(model, group);
    }
    if (expected.size || matched.size !== activity.mutations.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const output = new Map<string, readonly string[]>(), pick = input.config.returnLinkableKeys;
    for (const [key, model] of Object.entries(inventoryDeletionLinkableKeys)) {
      const group = changed.get(model);
      if (group !== undefined && (!pick?.length || pick.includes(key))) output.set(key, group);
    }
    if (Object.keys(call.result).length !== output.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const [key, expectedIds] of output) {
      const returned = call.result[key];
      if (!Array.isArray(returned) || returned.length !== expectedIds.length || returned.some((id, index) => id !== expectedIds[index]))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    for (const event of call.events) {
      const message = yield* decode(event);
      if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: message.metadata.object, action: CommonEvents.DELETED }))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!events.delete(message.metadata.object + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (events.size) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

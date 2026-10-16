import { Effect, Result, Schema } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { moduleEventDecoder } from "../../module/events";
import { captureCommerceInput } from "../../value/input";
import { commerceDecoder } from "../../value/decoder";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { orderNativeIdRows } from "../../repository/result";
import { decodeInventoryItemDeletionReadInput } from "./delete-item-input";
import { jsonEqual } from "flarex-protocol/json";
import type { compileInventoryDeletionContracts } from "./deletion-contracts";
import { inventoryCreateEventPolicy } from "./events";
import { decodeInventoryDeletionInput, inventoryDeletionIds, inventoryDeletionLinkableKeys } from "./deletion-lifecycle";
import { inventoryItemReservedQuantity } from "./deletion-read";

const models = new Map([["inventory_item", "InventoryItem"], ["inventory_level", "InventoryLevel"], ["reservation_item", "ReservationItem"]]);
const decodeComputedResult = commerceDecoder(Schema.Tuple([Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Schema.String, reserved_quantity: Schema.Number.check(Schema.isFinite()),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(8)), Schema.Int]), "receiptMismatch");

export function inventoryDeletionEventPolicy(contracts: Result.Result.Success<ReturnType<typeof compileInventoryDeletionContracts>>,
  admission: "product-deletions" | "item-deletions" = "product-deletions") {
  const dedicated = admission === "item-deletions", maximumRoots = dedicated ? 4 : 8;
  const softDeleteCommand = dedicated ? "inventoryItemSoftDeleteForWorkflow" : "inventorySoftDeleteItems";
  const restoreCommand = dedicated ? "inventoryItemRestoreForWorkflow" : undefined;
  const countCommand = dedicated ? "inventoryItemCountForDeletion" : "inventoryCount";
  const creation = inventoryCreateEventPolicy();
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literals(["inventory_item", "inventory_level", "reservation_item"]),
      action: dedicated ? Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED]) : Schema.Literal(CommonEvents.DELETED) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(16))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("InventoryDeletionEvents.capture")(function* (input: unknown) {
    const value = yield* Effect.fromResult(captureCommerceInput(input, defaultCommerceResources));
    if (!isJsonObject(value) || value.metadata === undefined || !isJsonObject(value.metadata) || (value.metadata.action !== CommonEvents.DELETED && (!dedicated || value.metadata.action !== CommonEvents.RESTORED)))
      return yield* (dedicated ? Effect.fail(commerceError("unadmittedEvent")) : creation.capture(value));
    const message = yield* decode(value);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return { ...message, metadata: { ...message.metadata }, data: { ...message.data } } satisfies Json;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryDeletionEvents.validateCall")(function* (call, activity) {
    const operation = call.commandName === softDeleteCommand ? "softDelete" : call.commandName === restoreCommand ? "restore" : undefined;
    // Validate complete native storage before any receipt projection. Managed
    // fields are the only values a lifecycle transition may change.
    for (const observation of activity.observedRows) yield* contracts.decodeRow(observation.table, observation.row)
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    for (const change of activity.mutations) {
      if (change.before !== null) yield* contracts.decodeRow(change.table, change.before).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (change.after !== null) yield* contracts.decodeRow(change.table, change.after).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    }
    for (const transition of activity.lifecycle) if (transition.rowAtOperation !== null)
      yield* contracts.decodeRow(transition.table, transition.rowAtOperation).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (operation === undefined) {
      if (dedicated && call.commandName !== countCommand) return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* creation.validateLogicalCall(call, activity);
      if (dedicated) {
        const input = yield* Effect.fromResult(decodeInventoryItemDeletionReadInput(call.input))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const ids = typeof input.filters.id === "string" ? [input.filters.id] : input.filters.id, requested = new Set(ids);
        const selected: (JsonObject & { id: string })[] = [];
        for (const observation of activity.observedRows) {
          const row = observation.row;
          if (observation.table === "inventory_item") {
            if (typeof row.id !== "string" || !requested.has(row.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
            if (row.deleted_at === null) selected.push({ ...row, id: row.id });
          } else if (observation.table !== "inventory_level" || typeof row.inventory_item_id !== "string" ||
            !requested.has(row.inventory_item_id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
        const [rows, count] = yield* Effect.fromResult(decodeComputedResult(call.result));
        const ordered = orderNativeIdRows(selected, buildQuery(input.filters, { order: { id: "ASC" } }).where);
        if (count !== ordered.length || rows.length !== ordered.length || rows.some((row, index) =>
          row.id !== ordered[index]?.id || Object.keys(row).length !== 2)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      const config = isJsonObject(call.input) ? call.input.config : undefined;
      if (call.commandName === countCommand && config !== undefined && isJsonObject(config) &&
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
    if (call.mode !== "write" || ids.length > maximumRoots || !isJsonObject(call.result) || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const observed = new Map<string, JsonObject>();
    for (const { table, row } of activity.observedRows) if (models.has(table) && typeof row.id === "string") observed.set(table + ":" + row.id, row);
    for (const transition of activity.lifecycle) if (transition.rowAtOperation !== null && typeof transition.rowAtOperation.id === "string")
      observed.set(transition.table + ":" + transition.rowAtOperation.id, transition.rowAtOperation);
    for (const change of [...activity.mutations].reverse()) if (models.has(change.table) && typeof change.before?.id === "string")
      observed.set(change.table + ":" + change.before.id, change.before);
    const roots = new Set([...observed.entries()].flatMap(([key, row]) => key.startsWith("inventory_item:") &&
      typeof row.id === "string" && requested.has(row.id) && (operation === "restore" || row.deleted_at === null) ? [row.id] : []));
    const expected = new Set([...roots].map(id => "inventory_item:" + id));
    for (const [key, row] of observed) if (!key.startsWith("inventory_item:") && typeof row.inventory_item_id === "string" && roots.has(row.inventory_item_id)) expected.add(key);
    for (const [key, row] of observed) {
      if (key.startsWith("inventory_item:")) {
        if (typeof row.id !== "string" || !requested.has(row.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      } else if (typeof row.inventory_item_id !== "string" || !roots.has(row.inventory_item_id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    for (const [table, maximum] of [["inventory_level", 2], ["reservation_item", 1]] as const) for (const root of roots) {
      if ([...observed].filter(([key, row]) => key.startsWith(table + ":") && row.inventory_item_id === root).length > maximum)
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    const events = new Set<string>(), matched = new Set<number>(), changed = new Map<string, string[]>();
    for (const transition of activity.lifecycle) {
      const id = transition.key.id, model = models.get(transition.table), ordinal = transition.attemptOrdinal;
      if (model === undefined || typeof id !== "string" || Object.keys(transition.key).length !== 1 || transition.operation !== operation ||
        (operation === "softDelete" ? typeof transition.afterDeletedAt !== "string" : transition.afterDeletedAt !== null) ||
        !expected.delete(transition.table + ":" + id) || ordinal !== null && matched.has(ordinal))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const before = observed.get(transition.table + ":" + id);
      if (before === undefined || before.deleted_at !== transition.beforeDeletedAt ||
        operation === "softDelete" && transition.table === "inventory_item" && transition.beforeDeletedAt !== null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (ordinal === null) {
        if (operation !== "restore" || transition.beforeDeletedAt !== null || transition.rowAtOperation === null ||
          !jsonEqual(before, transition.rowAtOperation)) return yield* Effect.fail(commerceError("receiptMismatch"));
      } else {
        const change = activity.mutations[ordinal];
        if (change === undefined || change.ordinal !== ordinal || change.operation !== "patch" || change.table !== transition.table ||
          change.before?.id !== id || change.after?.id !== id || change.before.deleted_at !== transition.beforeDeletedAt ||
          change.after.deleted_at !== transition.afterDeletedAt || operation === "restore" && transition.beforeDeletedAt === null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const [field, value] of Object.entries(before)) if (field !== "deleted_at" && field !== "updated_at" &&
          (change.after[field] === undefined || !jsonEqual(value, change.after[field]))) return yield* Effect.fail(commerceError("receiptMismatch"));
        matched.add(ordinal);
      }
      events.add(transition.table + ":" + id);
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
      if (message.metadata.action !== (operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED) ||
        message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: message.metadata.object, action: message.metadata.action }))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!events.delete(message.metadata.object + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (events.size) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

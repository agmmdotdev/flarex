import { compileInventoryItemContracts } from "./item-contracts";
import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName, isPresent } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { mergeMetadata } from "@medusajs/utils/common/merge-metadata";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { matchesPublicRow, projectNativeRow, orderNativeIdRows } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { decodeInventoryItemUpdateCommandInput, decodeInventoryItemUpdateReadInput } from "./update-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileInventoryItemContracts>>;
type Item = Result.Result.Success<ReturnType<Contracts["decodeRow"]>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literal("inventory_item"), action: Schema.Literal("updated") }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);

/** Authenticate the native selected final patch for each ID against full stored
 * rows. Native metadata merging is reused; no independent update is executed. */
export function inventoryItemUpdateEventPolicy(contracts: Contracts) {
  const capture = Effect.fn("InventoryItemEvents.captureUpdate")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_item", action: "updated" }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryItemEvents.validateUpdate")(function* (call, activity) {
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length ||
      activity.mutations.some((mutation, ordinal) => mutation.ordinal !== ordinal))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const observed = new Map<string, Item>();
    const record = Effect.fn("InventoryItemEvents.observeUpdateRow")(function* (table: string, input: JsonObject) {
      const row = yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(input))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (table !== "inventory_item") return yield* Effect.fail(commerceError("receiptMismatch"));
      observed.set(row.id, row);
    });
    for (const entry of activity.observedRows) yield* record(entry.table, entry.row);
    if (call.mode === "read") {
      const result = yield* Effect.fromResult(contracts.decodeRows(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (call.commandName !== "inventoryItemListForUpdate" || activity.mutations.length || call.events.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const input = yield* Effect.fromResult(decodeInventoryItemUpdateReadInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const requested = new Set(input.filters.id);
      if ([...observed.keys()].some(id => !requested.has(id))) return yield* Effect.fail(commerceError("receiptMismatch"));
      const selected = orderNativeIdRows([...observed.values()].filter(row => row.deleted_at === null), buildQuery(input.filters, { order: { id: "ASC" } }).where);
      if (result.length !== selected.length || selected.some((row, index) => !matchesPublicRow(row, result[index] ?? null)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    if (call.commandName !== "inventoryItemUpdateForWorkflow") return yield* Effect.fail(commerceError("receiptMismatch"));
    const commandInput = yield* Effect.fromResult(decodeInventoryItemUpdateCommandInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (Array.isArray(commandInput) !== Array.isArray(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
    const input = Array.isArray(commandInput) ? commandInput : [commandInput];
    const result = yield* Effect.fromResult(contracts.decodeRows(Array.isArray(call.result) ? call.result : [call.result]))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const patches = new Map(input.map(patch => [patch.id, patch]));
    const mutations = new Map<string, (typeof activity.mutations)[number]>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after;
      if (mutation.table !== "inventory_item" || mutation.operation !== "patch" || before === null || after === null ||
        typeof before.id !== "string" || before.id !== after.id || mutations.has(before.id) || before.deleted_at !== null || after.deleted_at !== null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* record(mutation.table, before);
      yield* Effect.fromResult(contracts.decodeRow(projectNativeRow(after))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      mutations.set(before.id, mutation);
    }
    if ([...observed.keys()].some(id => !patches.has(id))) return yield* Effect.fail(commerceError("receiptMismatch"));
    const where = buildQuery({ $or: input.map(({ id }) => ({ id })) }, { order: { id: "ASC" } }).where;
    const selected = orderNativeIdRows([...observed.values()].filter(row => row.deleted_at === null && typeof row.id === "string" && patches.has(row.id)), where);
    if (selected.length !== patches.size || result.length !== selected.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const changed: string[] = [];
    for (const [index, before] of selected.entries()) {
      const id = before.id;
      if (typeof id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
      const patch = patches.get(id), mutation = mutations.get(id);
      if (patch === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const update: JsonObject = { ...patch };
      const empty = Object.keys(update).every(field => field === "id");
      if (empty ? mutation !== undefined : mutation === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const after: JsonObject = mutation?.after ?? before;
      for (const [field, value] of Object.entries(before)) {
        if (field === "updated_at" && !empty) continue;
        let expected = update[field] === undefined ? value : update[field];
        if (field === "metadata" && patch.metadata !== undefined && isPresent(patch.metadata))
          expected = mergeMetadata(before.metadata ?? {}, patch.metadata ?? {});
        if (after[field] === undefined || !jsonEqual(after[field], expected)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (!matchesPublicRow(after, result[index] ?? null)) return yield* Effect.fail(commerceError("receiptMismatch"));
      if (!empty) changed.push(id);
    }
    if (mutations.size !== changed.length || activity.mutations.some((mutation, index) => mutation.after?.id !== changed[index]))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    let emitted = 0;
    for (const input of call.events) {
      const message = yield* capture(input);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== changed[emitted++]) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (emitted !== changed.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

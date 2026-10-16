import { compileInventoryLevelContracts } from "./level-contracts";
import { Effect, Result, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { projectNativeRow, orderNativeIdRows } from "../../repository/result";
import { captureExactNumericRow } from "../../value/exact-numeric";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { decodeInventoryLevelUpdateCommandInput, decodeInventoryLevelUpdateReadInput } from "./update-level-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
type Level = Effect.Success<ReturnType<Contracts["decodeStoredRow"]>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literal("inventory_level"), action: Schema.Literal("updated") }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);
const pairKey = (row: Readonly<{ inventory_item_id: string; location_id: string }>) => JSON.stringify([row.inventory_item_id, row.location_id]);

/** Receipt authentication derives expectations after genuine native pair lookup,
 * caller-ID precedence and keyed update. It performs no independent mutation. */
export function inventoryLevelUpdateEventPolicy(contracts: Contracts) {
  const mismatch = () => commerceError("receiptMismatch");
  const capture = Effect.fn("InventoryLevelEvents.captureUpdate")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: "updated" }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryLevelEvents.validateUpdate")(function* (call, activity) {
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length ||
      activity.mutations.some((mutation, ordinal) => mutation.ordinal !== ordinal)) return yield* Effect.fail(mismatch());
    const observed = new Map<string, Level>();
    const record = Effect.fn("InventoryLevelEvents.observeUpdateRow")(function* (table: string, input: JsonObject) {
      if (table !== "inventory_level") return yield* Effect.fail(mismatch());
      const row = yield* contracts.decodeStoredRow(projectNativeRow(input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      observed.set(row.id, row);
      if (observed.size > 8) return yield* Effect.fail(mismatch());
    });
    for (const entry of activity.observedRows) yield* record(entry.table, entry.row);
    if (call.mode === "read") {
      if (call.commandName !== "inventoryLevelListForUpdate" || activity.mutations.length || call.events.length) return yield* Effect.fail(mismatch());
      const input = yield* Effect.fromResult(decodeInventoryLevelUpdateReadInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const result = yield* Effect.fromResult(contracts.decodeRows(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const requested = new Set(input.filters.$or.map(pairKey));
      if ([...observed.values()].some(row => !requested.has(pairKey(row)))) return yield* Effect.fail(mismatch());
      const selected = orderNativeIdRows([...observed.values()].filter(row => row.deleted_at === null),
        buildQuery(input.filters, { order: { id: "ASC" } }).where);
      if (result.length !== selected.length) return yield* Effect.fail(mismatch());
      for (const [index, row] of selected.entries())
        if (!(yield* contracts.matchesResult(row, result[index] ?? null).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)))))
          return yield* Effect.fail(mismatch());
      return;
    }
    if (call.commandName !== "inventoryLevelUpdateForWorkflow") return yield* Effect.fail(mismatch());
    const commandInput = yield* Effect.fromResult(decodeInventoryLevelUpdateCommandInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (Array.isArray(commandInput) !== Array.isArray(call.result)) return yield* Effect.fail(mismatch());
    const input = Array.isArray(commandInput) ? commandInput : [commandInput];
    const result = yield* Effect.fromResult(contracts.decodeRows(Array.isArray(call.result) ? call.result : [call.result]))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const mutations = new Map<string, (typeof activity.mutations)[number]>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after;
      if (mutation.table !== "inventory_level" || mutation.operation !== "patch" || before === null || after === null ||
        typeof before.id !== "string" || before.id !== after.id || mutations.has(before.id) || before.deleted_at !== null || after.deleted_at !== null)
        return yield* Effect.fail(mismatch());
      yield* record(mutation.table, before);
      yield* contracts.decodeStoredRow(projectNativeRow(after)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      mutations.set(before.id, mutation);
    }
    const pairRows = new Map([...observed.values()].filter(row => row.deleted_at === null).map(row => [pairKey(row), row]));
    const resolved: Array<{ id: string; pairId: string; patch: (typeof input)[number] }> = [];
    for (const patch of input) {
      const pair = pairRows.get(pairKey(patch));
      if (pair === undefined) return yield* Effect.fail(mismatch());
      resolved.push({ id: patch.id ?? pair.id, pairId: pair.id, patch });
    }
    const patches = new Map(resolved.map(({ id, patch }) => [id, { ...patch, id }]));
    const allowed = new Set(resolved.flatMap(({ id, pairId }) => [id, pairId]));
    if ([...observed.keys()].some(id => !allowed.has(id))) return yield* Effect.fail(mismatch());
    const selected = orderNativeIdRows([...observed.values()].filter(row => row.deleted_at === null && patches.has(row.id)),
      buildQuery({ $or: resolved.map(({ id }) => ({ id })) }, { order: { id: "ASC" } }).where);
    if (selected.length !== patches.size || result.length !== selected.length || mutations.size !== selected.length)
      return yield* Effect.fail(mismatch());
    for (const [index, before] of selected.entries()) {
      const patch = patches.get(before.id), mutation = mutations.get(before.id);
      if (patch === undefined || mutation?.after === null || mutation?.after === undefined) return yield* Effect.fail(mismatch());
      const update = yield* captureExactNumericRow(patch, contracts.numeric).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const after = projectNativeRow(mutation.after);
      for (const [field, value] of Object.entries(before)) {
        if (field === "updated_at") continue;
        const expected = update[field] === undefined ? value : update[field];
        if (after[field] === undefined || !jsonEqual(after[field], expected)) return yield* Effect.fail(mismatch());
      }
      if (!(yield* contracts.matchesResult(after, result[index] ?? null).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)))))
        return yield* Effect.fail(mismatch());
      if (activity.mutations[index]?.after?.id !== before.id) return yield* Effect.fail(mismatch());
    }
    let emitted = 0;
    for (const input of call.events) {
      const message = yield* capture(input);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== selected[emitted++]?.id) return yield* Effect.fail(mismatch());
    }
    if (emitted !== selected.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}

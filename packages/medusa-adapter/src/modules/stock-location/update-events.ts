import { Effect, Schema } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { mergeMetadata } from "@medusajs/utils/common/merge-metadata";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { decodeOptionalServiceResult } from "../../module/result";
import { matchesPublicRow } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { compileStockLocationUpdateContracts, decodeStockLocationAddressUpserts, decodeStockLocationRootUpdateInput } from "./update-input";
import type { Result } from "effect";

type Contracts = Result.Result.Success<ReturnType<typeof compileStockLocationUpdateContracts>>;
const encoder = new TextEncoder();
const orderRows = (rows: readonly JsonObject[], where: unknown) => preservePrimaryKeyOrFilterOrder([...rows].sort((a, b) =>
  compareBytesLexicographically(encoder.encode(String(a.id)), encoder.encode(String(b.id)))), where, ["id"], [["id", "ASC"]]);

/** Bind every native return/event to actual scalar writes or observed no-op
 * rows. Address upsert may create standalone rows: no Location owner is assumed. */
export function stockLocationUpdateEventPolicy(contracts: Contracts) {
  const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = moduleEventDecoder(Schema.Struct({ name: Schema.String,
    metadata: Schema.Struct({ source: Schema.Literal(Modules.STOCK_LOCATION),
      object: Schema.Literals(["stock_location", "stock_location_address"]), action: Schema.Literals(["created", "updated"]) }),
    data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
  }), defaultCommerceResources);
  const capture = Effect.fn("StockLocationEvents.captureUpdate")(function* (input: unknown) {
    const event = yield* decode(input);
    if (event.name !== buildModuleResourceEventName({ prefix: Modules.STOCK_LOCATION, objectName: event.metadata.object, action: event.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return event;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("StockLocationEvents.validateUpdate")(function* (call, activity) {
    if (activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length ||
      activity.mutations.some((mutation, index) => mutation.ordinal !== index))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (call.mode === "read") {
      if (activity.mutations.length || call.events.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    const expectedEvents: string[] = [];
    const observed = new Map<string, JsonObject>();
    const target = call.commandName === "stockLocationUpdateBySelector" ? "stock_location" : "stock_location_address";
    for (const entry of activity.observedRows) if (entry.table === target && typeof entry.row.id === "string") observed.set(entry.row.id, entry.row);
    for (const mutation of activity.mutations) {
      if (mutation.table !== target || mutation.after === null || typeof mutation.after.id !== "string" ||
        mutation.after.deleted_at !== null || (mutation.operation !== "insert" && mutation.operation !== "patch") ||
        (mutation.operation === "insert" ? mutation.before !== null : mutation.before === null || mutation.before.id !== mutation.after.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (mutation.before !== null) observed.set(mutation.after.id, mutation.before);
      expectedEvents.push(target + ":" + (mutation.operation === "insert" ? "created" : "updated") + ":" + mutation.after.id);
    }
    const verifyPatch = (before: JsonObject, after: JsonObject, update: JsonObject) => {
      for (const [field, value] of Object.entries(before)) {
        if (field === "updated_at") continue;
        const expected = update[field] === undefined ? value : update[field];
        if (after[field] === undefined || !jsonEqual(after[field], expected)) return false;
      }
      return true;
    };
    if (call.commandName === "stockLocationUpdateBySelector") {
      const input = yield* Effect.fromResult(decodeStockLocationRootUpdateInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const result = yield* Effect.fromResult(decodeOptionalServiceResult(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const ids = input.selector.id === undefined ? undefined : new Set(typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id);
      const names = input.selector.name === undefined ? undefined : new Set(typeof input.selector.name === "string" ? [input.selector.name] : input.selector.name);
      const selected = orderRows([...observed.values()].filter(row => row.deleted_at === null &&
        (ids === undefined || typeof row.id === "string" && ids.has(row.id)) &&
        (names === undefined || typeof row.name === "string" && names.has(row.name))), buildQuery(input.selector, { order: { id: "ASC" } }).where);
      const empty = Object.keys(input.update).length === 0;
      if (selected.length > 4 || activity.mutations.length !== (empty ? 0 : selected.length)) return yield* Effect.fail(commerceError("receiptMismatch"));
      // Native selector updates share the same update object across all pairs.
      // Each metadata merge changes that object; the final merged value is
      // consequently written to every selected row, in native selection order.
      const update = { ...input.update };
      if (update.metadata !== undefined && isJsonObject(update.metadata)) {
        let mergedMetadata = update.metadata;
        for (const row of selected) {
          const previous = row.metadata;
          if (previous === undefined || previous !== null && !isJsonObject(previous)) return yield* Effect.fail(commerceError("receiptMismatch"));
          mergedMetadata = mergeMetadata(previous ?? {}, mergedMetadata);
        }
        update.metadata = mergedMetadata;
      }
      let first = selected[0];
      for (const [index, mutation] of activity.mutations.entries()) {
        const before = mutation.before, after = mutation.after;
        if (mutation.operation !== "patch" || before === null || after === null || before.id !== selected[index]?.id || !verifyPatch(before, after, update))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        if (index === 0) first = after;
      }
      if (first === undefined ? result !== undefined : result === undefined || !matchesPublicRow(first, result))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* Effect.fromResult(contracts.decodeOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    } else if (call.commandName === "stockLocationAddressUpsertForWorkflow") {
      const input = yield* Effect.fromResult(decodeStockLocationAddressUpserts(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const result = yield* Effect.fromResult(contracts.decodeAddresses(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const creates = input.filter(row => row.id === undefined), patches = new Map(input.flatMap(row => row.id === undefined ? [] : [[row.id, row] as const]));
      if (patches.size !== input.length - creates.length || result.length !== input.length || activity.mutations.length > input.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      let created = 0, updating = false;
      const rows = new Map<string, JsonObject>();
      const inserted: JsonObject[] = [];
      for (const mutation of activity.mutations) {
        const after = mutation.after;
        if (after === null || typeof after.id !== "string" || rows.has(after.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        if (mutation.operation === "insert") {
          const supplied = creates[created++];
          if (updating || supplied === undefined || Object.entries(supplied).some(([key, value]) => after[key] === undefined || !jsonEqual(after[key], value)))
            return yield* Effect.fail(commerceError("receiptMismatch"));
          inserted.push(after);
        } else {
          updating = true;
          const patch = patches.get(after.id), before = mutation.before;
          if (patch === undefined || before === null) return yield* Effect.fail(commerceError("receiptMismatch"));
          const update = { ...patch };
          if (patch.metadata !== undefined && isJsonObject(patch.metadata)) {
            const previous = before.metadata;
            if (previous === undefined || previous !== null && !isJsonObject(previous)) return yield* Effect.fail(commerceError("receiptMismatch"));
            update.metadata = mergeMetadata(previous ?? {}, patch.metadata);
          }
          if (!verifyPatch(before, after, update)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
        rows.set(after.id, after);
      }
      if (created !== creates.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      const existing = orderRows([...observed.values()].filter(row => typeof row.id === "string" && patches.has(row.id)), { $or: [...patches.keys()].map(id => ({ id })) });
      if (existing.length !== patches.size) return yield* Effect.fail(commerceError("receiptMismatch"));
      const updated = existing.map(before => rows.get(String(before.id)) ?? before);
      for (const before of existing) {
        const patch = patches.get(String(before.id));
        if (patch === undefined || Object.keys(patch).some(key => key !== "id") && !rows.has(String(before.id)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      const returned = [...inserted, ...updated];
      if (returned.length !== result.length || returned.some((row, index) => !matchesPublicRow(row, result[index] ?? null)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    } else return yield* Effect.fail(commerceError("receiptMismatch"));
    let ordinal = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (expectedEvents[ordinal++] !== message.metadata.object + ":" + message.metadata.action + ":" + id)
          return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (ordinal !== expectedEvents.length) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

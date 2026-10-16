import { Effect, Result, Schema } from "effect";
import { CommonEvents, Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { moduleEventDecoder } from "../../module/events";
import { scalarLifecycleReceipt } from "../../repository/scalar-lifecycle-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { compileInventoryLevelContracts } from "./level-contracts";
import { inventoryQuantityProjection } from "./quantity-repository";
import { decodeInventoryLevelDeletionIds, decodeInventoryLevelDeletionReadInput, decodeInventoryLevelDeletionResult,
  matchesInventoryLevelDeletionFilter, matchesInventoryLevelDeletionCandidate } from "./delete-level-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literal("inventory_level"),
    action: Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);
const decodeCount = commerceDecoder(Schema.Tuple([Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 }))]), "receiptMismatch");

/** Both graph reads and generated native lifecycle maps authenticate complete
 * Level storage without extending Item, Reservation, or quantity authority. */
export function inventoryLevelDeletionEventPolicy(contracts: Contracts) {
  const capture = Effect.fn("InventoryLevelDeletion.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if (message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: "inventory_level", action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLifecycle = scalarLifecycleReceipt({ table: "inventory_level", softDeleteCommand: "inventoryLevelSoftDeleteForWorkflow",
    restoreCommand: "inventoryLevelRestoreForWorkflow", maximumRoots: 4, decodeIds: decodeInventoryLevelDeletionIds,
    decodeRow: contracts.decodeCompleteRow, decodeResult: input => decodeInventoryLevelDeletionResult(input).pipe(Result.map(result => ({
      empty: Object.keys(result).length === 0, ids: result.inventory_level_id ?? [],
    }))) });
  const project = inventoryQuantityProjection(contracts.numeric);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryLevelDeletion.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    const observed = new Map<string, Effect.Success<ReturnType<Contracts["decodeStoredRow"]>>>();
    const record = Effect.fn("InventoryLevelDeletion.observe")(function* (table: string, value: JsonObject) {
      if (table !== "inventory_level") return yield* Effect.fail(mismatch());
      const row = yield* contracts.decodeStoredRow(projectNativeRow(value)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      observed.set(row.id, row);
      if (observed.size > 4) return yield* Effect.fail(mismatch());
    });
    for (const entry of activity.observedRows) yield* record(entry.table, entry.row);
    for (const mutation of activity.mutations) {
      if (mutation.before !== null) yield* record(mutation.table, mutation.before);
      if (mutation.after !== null) yield* contracts.decodeStoredRow(projectNativeRow(mutation.after)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    }
    for (const transition of activity.lifecycle) if (transition.rowAtOperation !== null) yield* record(transition.table, transition.rowAtOperation);
    if (call.commandName !== "inventoryLevelCountForDeletion") {
      const { operation, ids } = yield* validateLifecycle(call, activity);
      const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
      let emitted = 0;
      for (const event of call.events) {
        const message = yield* capture(event);
        if (message.metadata.action !== action) return yield* Effect.fail(mismatch());
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (id !== ids[emitted++]) return yield* Effect.fail(mismatch());
      }
      if (emitted !== ids.length) return yield* Effect.fail(mismatch());
      return;
    }
    if (call.mode !== "read" || activity.mutations.length || activity.lifecycle.length || activity.setNull.length ||
      activity.referenceReplacements.length || call.events.length) return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeInventoryLevelDeletionReadInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const [rows, count] = yield* Effect.fromResult(decodeCount(call.result));
    const filters = input.filters ?? {}, config = input.config ?? {};
    if ([...observed.values()].some(row => !matchesInventoryLevelDeletionCandidate(row, filters))) return yield* Effect.fail(mismatch());
    const selected = orderNativeIdRows([...observed.values()].filter(row => row.deleted_at === null && matchesInventoryLevelDeletionFilter(row, filters)),
      buildQuery(filters, { order: { id: "ASC" } }).where);
    const skip = config.skip ?? 0, take = config.take ?? selected.length;
    if (count !== selected.length || rows.length !== Math.min(take, Math.max(0, count - skip))) return yield* Effect.fail(mismatch());
    const fields = config.select === undefined ? undefined : new Set(config.select);
    if (fields !== undefined) for (const numeric of contracts.numeric) if (fields.has(numeric.name)) fields.add("raw_" + numeric.name);
    for (const [index, before] of selected.slice(skip, skip + take).entries()) {
      const partial = fields === undefined ? before : Object.fromEntries(Object.entries(before).filter(([field]) => fields.has(field)));
      const expected = yield* project(partial).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const actual = rows[index];
      if (!isJsonObject(expected) || actual === undefined || !jsonEqual(expected, actual)) return yield* Effect.fail(mismatch());
    }
  });
  return { capture, validateLogicalCall };
}

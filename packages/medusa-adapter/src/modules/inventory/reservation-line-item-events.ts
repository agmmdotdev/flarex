import { Effect, Result, Schema } from "effect";
import { Modules, CommonEvents, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { inventoryLevelReservationAdjustments } from "@medusajs/inventory/inventory-level-quantity";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import { scalarLifecycleReceipt } from "../../repository/scalar-lifecycle-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { captureExactNumericRow } from "../../value/exact-numeric";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import type { prepareReservationLineItemRepository } from "./reservation-line-item-repository";
import { decodeReservationLineItemIds } from "./reservation-line-item-input";

type Contracts = Result.Result.Success<ReturnType<typeof prepareReservationLineItemRepository>>["contracts"];
type Reservation = Effect.Success<ReturnType<Contracts["decodeStoredRow"]>>;
type Level = Effect.Success<ReturnType<Contracts["levelContracts"]["decodeStoredRow"]>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY),
    object: Schema.Literals(["reservation_item", "inventory_level"]),
    action: Schema.Literals([CommonEvents.DELETED, CommonEvents.RESTORED, CommonEvents.UPDATED]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);
const pairKey = (row: Readonly<{ inventory_item_id: string; location_id: string }>) => JSON.stringify([row.inventory_item_id, row.location_id]);

/** Native Line Item lifecycle and reserved-demand receipts. Expected grouped
 * quantities come from the executing native arithmetic owner, never a second
 * adapter implementation. The public void method has no lifecycle map. */
export function inventoryReservationLineItemEventPolicy(contracts: Contracts) {
  const mismatch = () => commerceError("receiptMismatch");
  const capture = Effect.fn("InventoryReservationLineItem.captureEvent")(function* (input: unknown) {
    const message = yield* decodeEvent(input);
    if ((message.metadata.object === "inventory_level" ? message.metadata.action !== CommonEvents.UPDATED
      : message.metadata.action !== CommonEvents.DELETED && message.metadata.action !== CommonEvents.RESTORED) ||
      message.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY,
        objectName: message.metadata.object, action: message.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return message;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryReservationLineItem.validateCall")(function* (call, activity) {
    const operation = call.commandName === "inventoryDeleteReservationsByLineItem" ? "softDelete"
      : call.commandName === "inventoryRestoreReservationsByLineItem" ? "restore" : undefined;
    if (operation === undefined || call.mode !== "write" || call.result !== null || activity.setNull.length || activity.referenceReplacements.length ||
      activity.mutations.some((mutation, ordinal) => mutation.ordinal !== ordinal)) return yield* Effect.fail(mismatch());
    const ids = yield* Effect.fromResult(decodeReservationLineItemIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requested = new Set(ids), reservations = new Map<string, Reservation>(), levels = new Map<string, Level>();
    const record = Effect.fn("InventoryReservationLineItem.observe")(function* (table: string, input: JsonObject) {
      const row = projectNativeRow(input);
      if (table === "reservation_item") {
        const decoded = yield* contracts.decodeStoredRow(row).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (decoded.line_item_id === null || !requested.has(decoded.line_item_id)) return yield* Effect.fail(mismatch());
        reservations.set(decoded.id, decoded);
        if (reservations.size > 4) return yield* Effect.fail(mismatch());
      } else if (table === "inventory_level") {
        const decoded = yield* contracts.levelContracts.decodeStoredRow(row).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        levels.set(decoded.id, decoded);
        if (levels.size > 4) return yield* Effect.fail(mismatch());
      } else return yield* Effect.fail(mismatch());
    });
    for (const entry of activity.observedRows) yield* record(entry.table, entry.row);
    for (const transition of activity.lifecycle) if (transition.rowAtOperation !== null) yield* record(transition.table, transition.rowAtOperation);
    // Observed rows can contain the final pending view; the first mutation
    // preimage is the command's authoritative state for each scoped identity.
    const seen = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.before === null || mutation.after === null || typeof mutation.before.id !== "string" || mutation.before.id !== mutation.after.id)
        return yield* Effect.fail(mismatch());
      const identity = JSON.stringify([mutation.table, mutation.before.id]);
      if (!seen.has(identity)) { seen.add(identity); yield* record(mutation.table, mutation.before); }
      if (mutation.table === "reservation_item")
        yield* contracts.decodeStoredRow(projectNativeRow(mutation.after)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      else if (mutation.table === "inventory_level")
        yield* contracts.levelContracts.decodeStoredRow(projectNativeRow(mutation.after)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      else return yield* Effect.fail(mismatch());
    }
    const roots = orderNativeIdRows([...reservations.values()].filter(row => operation === "restore" || row.deleted_at === null), {});
    const rootIds = roots.map(row => row.id);
    const reservationMutations = activity.mutations.filter(mutation => mutation.table === "reservation_item");
    if (reservationMutations.some((mutation, ordinal) => mutation.ordinal !== ordinal)) return yield* Effect.fail(mismatch());
    // The scalar owner authenticates lifecycle transitions and every managed
    // before/after field. A void native result needs no fabricated result map:
    // its selected identities are derived from the complete native selector.
    const validateLifecycle = scalarLifecycleReceipt({ table: "reservation_item",
      softDeleteCommand: "inventoryDeleteReservationsByLineItem", restoreCommand: "inventoryRestoreReservationsByLineItem", maximumRoots: 4,
      decodeIds: () => Result.succeed([...reservations.keys()]), decodeRow: contracts.decodeCompleteRow,
      decodeResult: () => Result.succeed({ empty: rootIds.length === 0, ids: rootIds }) });
    const lifecycle = yield* validateLifecycle(call, { ...activity,
      observedRows: activity.observedRows.filter(entry => entry.table === "reservation_item"), mutations: reservationMutations });
    if (lifecycle.ids.length !== rootIds.length || lifecycle.ids.some((id, ordinal) => id !== rootIds[ordinal])) return yield* Effect.fail(mismatch());
    const quantityReservations = orderNativeIdRows([...reservations.values()].filter(row => operation === "softDelete" ? row.deleted_at === null : row.deleted_at !== null), {});
    const pairs = new Set(quantityReservations.map(pairKey));
    if ([...levels.values()].some(row => !pairs.has(pairKey(row)))) return yield* Effect.fail(mismatch());
    const activeLevels = orderNativeIdRows([...levels.values()].filter(row => row.deleted_at === null), {});
    if (activeLevels.length !== pairs.size || new Set(activeLevels.map(pairKey)).size !== pairs.size) return yield* Effect.fail(mismatch());
    const expectedUpdates = yield* Effect.try({ try: () => inventoryLevelReservationAdjustments(quantityReservations, activeLevels, operation === "softDelete"),
      catch: cause => commerceError("receiptMismatch", cause) });
    const levelMutations = activity.mutations.slice(reservationMutations.length);
    if (expectedUpdates.length !== levelMutations.length) return yield* Effect.fail(mismatch());
    const expectedEvents = rootIds.map(id => ["reservation_item", operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED, id]);
    for (const [ordinal, update] of expectedUpdates.entries()) {
      const mutation = levelMutations[ordinal];
      if (update === undefined || mutation === undefined || mutation.table !== "inventory_level" || mutation.operation !== "patch" ||
        mutation.before?.id !== update.id || mutation.after?.id !== update.id || mutation.before.deleted_at !== null || mutation.after.deleted_at !== null)
        return yield* Effect.fail(mismatch());
      const before = levels.get(update.id);
      if (before === undefined) return yield* Effect.fail(mismatch());
      const after = projectNativeRow(mutation.after);
      const patch = yield* captureExactNumericRow(update, contracts.levelContracts.numeric.filter(column => column.name === "reserved_quantity"))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      for (const [field, value] of Object.entries(before)) {
        if (field === "updated_at") continue;
        const expected = patch[field] === undefined ? value : patch[field];
        if (after[field] === undefined || !jsonEqual(after[field], expected)) return yield* Effect.fail(mismatch());
      }
      expectedEvents.push(["inventory_level", CommonEvents.UPDATED, update.id]);
    }
    let emitted = 0;
    for (const input of call.events) {
      const message = yield* capture(input);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        const expected = expectedEvents[emitted++];
        if (expected === undefined || message.metadata.object !== expected[0] || message.metadata.action !== expected[1] || id !== expected[2])
          return yield* Effect.fail(mismatch());
      }
    }
    if (emitted !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}

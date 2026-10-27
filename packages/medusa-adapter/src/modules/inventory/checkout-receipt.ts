import { Effect, Result, Schema } from "effect";
import { inventoryLevelReservationAdjustments } from "@medusajs/inventory/inventory-level-quantity";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { moduleEventDecoder } from "../../module/events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { projectNativeRow } from "../../repository/result";
import { captureExactNumericRow } from "../../value/exact-numeric";
import { inventoryQuantityProjection } from "./quantity-repository";
import { decodeCheckoutReservations, decodeCheckoutReservationIds, decodeCheckoutReservationOutput } from "./checkout-input";
import type { compileReservationLineItemContracts } from "./reservation-line-item-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileReservationLineItemContracts>>;
type Level = Effect.Success<ReturnType<Contracts["levelContracts"]["decodeStoredRow"]>>;
type Reservation = Effect.Success<ReturnType<Contracts["decodeStoredRow"]>>;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEvent = moduleEventDecoder(Schema.Struct({ name: Schema.String,
  metadata: Schema.Struct({ source: Schema.Literal(Modules.INVENTORY), object: Schema.Literals(["reservation_item", "inventory_level"]),
    action: Schema.Literals(["created", "updated", "deleted"]) }),
  data: Schema.Struct({ id: Schema.Union([Id, Schema.Array(Id).check(Schema.isLengthBetween(1, 4))]) }),
}), defaultCommerceResources);
const pairKey = (row: { readonly inventory_item_id: string; readonly location_id: string }) => JSON.stringify([row.inventory_item_id, row.location_id]);

/** Authenticate native creation/deletion, exact DTOs and grouped stock deltas.
 * The executing Inventory arithmetic helper owns the expected level updates;
 * this policy supplies no availability or reservation algorithm. */
export function inventoryCheckoutPolicy(contracts: Contracts) {
  const mismatch = () => commerceError("receiptMismatch");
  const project = inventoryQuantityProjection(contracts.numeric);
  const capture = Effect.fn("InventoryCheckout.captureEvent")(function* (value: unknown) {
    const event = yield* decodeEvent(value);
    if ((event.metadata.object === "inventory_level" ? event.metadata.action !== "updated" : event.metadata.action === "updated") ||
      event.name !== buildModuleResourceEventName({ prefix: Modules.INVENTORY, objectName: event.metadata.object, action: event.metadata.action }))
      return yield* Effect.fail(commerceError("unadmittedEvent"));
    return event;
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryCheckout.validateReceipt")(function* (call, activity) {
    const create = call.commandName === "inventoryReserveForCheckout";
    if ((!create && call.commandName !== "inventoryDeleteReservationsForCheckout") || call.mode !== "write" ||
      activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length ||
      activity.mutations.some((entry, ordinal) => entry.ordinal !== ordinal)) return yield* Effect.fail(mismatch());
    const inputs = create ? yield* Effect.fromResult(decodeCheckoutReservations(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : [];
    const ids = create ? [] : yield* Effect.fromResult(decodeCheckoutReservationIds(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const results = create ? yield* Effect.fromResult(decodeCheckoutReservationOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : [];
    if (create ? results.length !== inputs.length : call.result !== null) return yield* Effect.fail(mismatch());
    const reservations: Reservation[] = [], levels = new Map<string, Level>(), reservationIds = new Set<string>();
    const expectedEvents = new Set<string>();
    let levelPhase = false;
    for (const mutation of activity.mutations) {
      if (mutation.table === "inventory_level") {
        levelPhase = true;
        if (mutation.operation !== "patch" || mutation.before === null || mutation.after === null)
          return yield* Effect.fail(mismatch());
        const before = yield* contracts.levelContracts.decodeStoredRow(projectNativeRow(mutation.before))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        yield* contracts.levelContracts.decodeStoredRow(projectNativeRow(mutation.after))
          .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (before.deleted_at !== null || mutation.after.id !== before.id || levels.has(before.id)) return yield* Effect.fail(mismatch());
        levels.set(before.id, before);
        expectedEvents.add(JSON.stringify(["inventory_level", "updated", before.id]));
        continue;
      }
      if (levelPhase || mutation.table !== "reservation_item" || (create
        ? mutation.operation !== "insert" || mutation.before !== null || mutation.after === null
        : mutation.operation !== "delete" || mutation.before === null || mutation.after !== null))
        return yield* Effect.fail(mismatch());
      const stored = create ? mutation.after : mutation.before;
      if (stored === null) return yield* Effect.fail(mismatch());
      const row = yield* contracts.decodeStoredRow(projectNativeRow(stored)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (row.deleted_at !== null || row.line_item_id === null || reservationIds.has(row.id)) return yield* Effect.fail(mismatch());
      reservationIds.add(row.id);
      if (create) {
        const input = inputs[reservations.length], result = results[reservations.length];
        if (input === undefined || result === undefined) return yield* Effect.fail(mismatch());
        const expected = yield* captureExactNumericRow(input, contracts.numeric, true).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        const storedValues: JsonObject = row;
        for (const [field, value] of Object.entries(expected)) if (storedValues[field] === undefined || !jsonEqual(storedValues[field], value))
          return yield* Effect.fail(mismatch());
        if (row.external_id !== null || row.description !== null || row.created_by !== null || row.metadata !== null ||
          !jsonEqual(yield* project(row), result)) return yield* Effect.fail(mismatch());
      } else if (!ids.includes(row.id)) return yield* Effect.fail(mismatch());
      reservations.push(row);
      expectedEvents.add(JSON.stringify(["reservation_item", create ? "created" : "deleted", row.id]));
    }
    if (reservations.length > 4 || levels.size > 4 || create && reservations.length !== inputs.length)
      return yield* Effect.fail(mismatch());
    const pairs = new Set(reservations.map(pairKey));
    if (levels.size !== pairs.size || [...levels.values()].some(row => !pairs.has(pairKey(row))) ||
      new Set([...levels.values()].map(pairKey)).size !== pairs.size) return yield* Effect.fail(mismatch());
    const updates = yield* Effect.try({ try: () => inventoryLevelReservationAdjustments(create ? inputs : reservations, [...levels.values()], !create),
      catch: cause => commerceError("receiptMismatch", cause) });
    const expectedUpdates = new Map(updates.filter(value => value !== undefined).map(value => [value.id, value]));
    for (const mutation of activity.mutations.slice(reservations.length)) {
      const before = typeof mutation.before?.id === "string" ? levels.get(mutation.before.id) : undefined;
      const update = before === undefined ? undefined : expectedUpdates.get(before.id);
      if (before === undefined || update === undefined || mutation.after === null) return yield* Effect.fail(mismatch());
      const patch = yield* captureExactNumericRow(update, contracts.levelContracts.numeric.filter(column => column.name === "reserved_quantity"))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const after = projectNativeRow(mutation.after);
      for (const [field, value] of Object.entries(before)) if (field !== "updated_at") {
        const expected = patch[field] ?? value;
        if (after[field] === undefined || !jsonEqual(after[field], expected)) return yield* Effect.fail(mismatch());
      }
    }
    // Call-local observations may hold the final pending view. Authenticate
    // every observed endpoint against the actual mutation identity and pair.
    for (const entry of activity.observedRows) {
      if (entry.table === "inventory_level") {
        const row = yield* contracts.levelContracts.decodeStoredRow(projectNativeRow(entry.row)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (!levels.has(row.id)) return yield* Effect.fail(mismatch());
      } else if (entry.table === "reservation_item") {
        const row = yield* contracts.decodeStoredRow(projectNativeRow(entry.row)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
        if (!reservationIds.has(row.id)) return yield* Effect.fail(mismatch());
      } else return yield* Effect.fail(mismatch());
    }
    for (const value of call.events) {
      const event = yield* capture(value);
      for (const id of Array.isArray(event.data.id) ? event.data.id : [event.data.id])
        if (!expectedEvents.delete(JSON.stringify([event.metadata.object, event.metadata.action, id]))) return yield* Effect.fail(mismatch());
    }
    if (expectedEvents.size) return yield* Effect.fail(mismatch());
  });
  return { capture, validateLogicalCall };
}

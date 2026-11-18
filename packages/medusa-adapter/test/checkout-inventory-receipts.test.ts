import { Effect, Result } from "effect";
import { beforeAll, expect, it, vi } from "vitest";
import { MathBN } from "@medusajs/framework/utils/portable";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { compileReservationLineItemContracts } from "../src/modules/inventory/reservation-line-item-input";
import { inventoryCheckoutPolicy } from "../src/modules/inventory/checkout-receipt";
import { decodeCheckoutReservations, normalizeCheckoutReservationArguments } from "../src/modules/inventory/checkout-input";
import { captureExactNumericRow } from "../src/value/exact-numeric";
import { inventoryQuantityProjection } from "../src/modules/inventory/quantity-repository";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileReservationLineItemContracts>>;
let policy: ReturnType<typeof inventoryCheckoutPolicy>;
const time = "2026-10-27T00:00:00.000Z", later = "2026-10-27T00:01:00.000Z";
const event = (object: "reservation_item" | "inventory_level", action: "created" | "deleted" | "updated", id: string): Json => ({
  name: "inventory." + object.replaceAll("_", "-") + "." + action, metadata: { source: "inventory", object, action }, data: { id },
});
beforeAll(async () => {
  contracts = Result.getOrThrow(compileReservationLineItemContracts((await Effect.runPromise(captureInventoryMetadata())).frame.tables));
  policy = inventoryCheckoutPolicy(contracts);
});
const creation = async (quantity = "1.25", previous = "2", reserved = "3.25") => {
  const input = { line_item_id: "line", inventory_item_id: "item", location_id: "location", quantity, allow_backorder: false };
  const row = await Effect.runPromise(captureExactNumericRow({ ...input, id: "reservation", external_id: null, description: null,
    created_by: null, metadata: null, created_at: time, updated_at: time, deleted_at: null }, contracts.numeric, true));
  const level = (quantity: string, updated_at: string) => captureExactNumericRow({ id: "level", inventory_item_id: "item", location_id: "location",
    stocked_quantity: "10", reserved_quantity: quantity, incoming_quantity: "0", metadata: null,
    created_at: time, updated_at, deleted_at: null }, contracts.levelContracts.numeric, true);
  const before = await Effect.runPromise(level(previous, time)), after = await Effect.runPromise(level(reserved, later));
  const result = await Effect.runPromise(inventoryQuantityProjection(contracts.numeric)(row));
  if (!isJsonObject(result)) throw new Error("Expected one native Reservation DTO");
  const call: Call = { commandName: "inventoryReserveForCheckout", mode: "write", input: [input], result: [result],
    events: [event("reservation_item", "created", "reservation"), event("inventory_level", "updated", "level")],
    fromAttempt: 0, toAttempt: 2, fromLifecycle: 0, toLifecycle: 0 };
  const activity: Activity = { observedRows: [{ table: "inventory_level", row: after }], lifecycle: [], setNull: [], referenceReplacements: [], relationalReads: [],
    mutations: [{ ordinal: 0, table: "reservation_item", operation: "insert", before: null, after: row },
      { ordinal: 1, table: "inventory_level", operation: "patch", before, after }] };
  return { call, activity, input, row, before, after, result };
};
const refused = async (call: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(call, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

it("captures genuine MathBN demand exactly while rejecting accessors, managed fields, nonfinite values and overflow", () => {
  const row = { line_item_id: "line", inventory_item_id: "item", location_id: "location", quantity: MathBN.mult(3, 1.25), allow_backorder: false };
  expect(Result.getOrThrow(normalizeCheckoutReservationArguments([[row]]))[0][0]?.quantity).toBe("3.75");
  const getter = vi.fn(() => 1), foreign = Object.defineProperty({}, "quantity", { get: getter, enumerable: true });
  expect(Result.isFailure(normalizeCheckoutReservationArguments([[foreign]]))).toBe(true);
  expect(getter).not.toHaveBeenCalled();
  for (const value of [[{ ...row, quantity: "-1" }], [{ ...row, quantity: "Infinity" }],
    [{ ...row, quantity: "1", raw_quantity: { value: "1", precision: 20 } }], Array.from({ length: 5 }, () => ({ ...row, quantity: "1" }))])
    expect(Result.isFailure(decodeCheckoutReservations(value))).toBe(true);
});

it("authenticates native creation, exact raw quantities, complete DTOs and reserved-only Level updates", async () => {
  const { call, activity, input, row, before, after, result } = await creation();
  await Effect.runPromise(policy.validateLogicalCall(call, activity));
  await refused({ ...call, input: [{ ...input, line_item_id: "foreign" }] }, activity);
  await refused({ ...call, input: [{ ...input, quantity: "2" }] }, activity);
  await refused({ ...call, result: [{ ...result, quantity: 2 }] }, activity);
  await refused({ ...call, events: call.events.slice(1) }, activity);
  await refused({ ...call, events: [...call.events, call.events[0] ?? null] }, activity);
  await refused(call, { ...activity, mutations: [activity.mutations[0]!, { ordinal: 1, table: "inventory_level", operation: "patch", before,
    after: { ...after, metadata: { changed: true } } }] });
  await refused(call, { ...activity, mutations: [activity.mutations[0]!, { ordinal: 1, table: "inventory_level", operation: "patch", before,
    after: { ...after, raw_reserved_quantity: { value: "99", precision: 20 } } }] });
  await refused(call, { ...activity, mutations: [{ ordinal: 0, table: "reservation_item", operation: "insert", before: null, after: { ...row, created_by: "foreign" } }, activity.mutations[1]!] });
  await refused(call, { ...activity, observedRows: [{ table: "inventory_item", row: {} }] });
});

it("authenticates physical reservation deletion and exact native release without accepting tombstones or missing release", async () => {
  const { call, row, before, after } = await creation();
  const deletion: Call = { ...call, commandName: "inventoryDeleteReservationsForCheckout", input: ["reservation"], result: null,
    events: [event("reservation_item", "deleted", "reservation"), event("inventory_level", "updated", "level")] };
  const activity: Activity = { observedRows: [{ table: "reservation_item", row }], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [],
    mutations: [{ ordinal: 0, table: "reservation_item", operation: "delete", before: row, after: null },
      { ordinal: 1, table: "inventory_level", operation: "patch", before: after, after: { ...before, updated_at: later } }] };
  await Effect.runPromise(policy.validateLogicalCall(deletion, activity));
  await refused({ ...deletion, input: ["foreign"] }, activity);
  await refused(deletion, { ...activity, mutations: activity.mutations.slice(0, 1) });
  await refused(deletion, { ...activity, mutations: [{ ordinal: 0, table: "reservation_item", operation: "delete", before: { ...row, deleted_at: time }, after: null }, activity.mutations[1]!] });
});

it("retains native input precision for level adjustment before each stored quantity is rounded", async () => {
  const { call, activity, row } = await creation("0.123456789012345678944", "0.000000000000000000002", "0.12345678901234567895");
  expect(row.raw_quantity).toEqual({ value: "0.12345678901234567894", precision: 20 });
  await Effect.runPromise(policy.validateLogicalCall(call, activity));
});

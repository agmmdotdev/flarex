import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { compileReservationLineItemContracts, decodeReservationLineItemIds } from "../src/modules/inventory/reservation-line-item-input";
import { inventoryReservationLineItemEventPolicy } from "../src/modules/inventory/reservation-line-item-events";
import { captureExactNumericRow } from "../src/value/exact-numeric";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let contracts: Result.Result.Success<ReturnType<typeof compileReservationLineItemContracts>>;
let policy: ReturnType<typeof inventoryReservationLineItemEventPolicy>;
const time = "2026-10-17T00:00:00.000Z", later = "2026-10-17T00:01:00.000Z";
const reservation = (id: string, changes: JsonObject = {}) => Effect.runPromise(captureExactNumericRow({ id,
  line_item_id: "line", inventory_item_id: "item", location_id: "location", quantity: 3,
  allow_backorder: false, external_id: null, description: "keep", created_by: null, metadata: { keep: true },
  created_at: time, updated_at: time, deleted_at: null, ...changes }, contracts.numeric, true));
const level = (id = "level", changes: JsonObject = {}) => Effect.runPromise(captureExactNumericRow({ id,
  inventory_item_id: "item", location_id: "location", stocked_quantity: 10, reserved_quantity: 3, incoming_quantity: 1.25,
  metadata: { keep: true }, created_at: time, updated_at: time, deleted_at: null, ...changes }, contracts.levelContracts.numeric, true));
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const event = (id: string, object: "reservation_item" | "inventory_level", action: "deleted" | "restored" | "updated"): Json => ({
  name: `inventory.${object.replaceAll("_", "-")}.${action}`, metadata: { source: "inventory", object, action }, data: { id } });
const call = (ids: readonly string[], events: readonly Json[] = [], restore = false): Call => ({
  commandName: restore ? "inventoryRestoreReservationsByLineItem" : "inventoryDeleteReservationsByLineItem", mode: "write",
  input: [...ids], result: null, events, fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const refused = async (receipt: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
const deletion = async () => {
  const a = await reservation("a", { quantity: 1.25 }), b = await reservation("b", { quantity: 2.5 }), historical = await reservation("old", { quantity: 9, deleted_at: time });
  const before = await level("level", { reserved_quantity: 6 }), after = await level("level", { reserved_quantity: 2.25, updated_at: later });
  const changed = [a, b].map(row => ({ ...row, deleted_at: later, updated_at: later }));
  const evidence: Activity = { ...empty(), observedRows: [
    ...changed.map(row => ({ table: "reservation_item", row })), { table: "reservation_item", row: historical }, { table: "inventory_level", row: after },
  ], mutations: [
    ...changed.map((after, ordinal) => ({ ordinal, table: "reservation_item", operation: "patch" as const, before: [a, b][ordinal] ?? null, after })),
    { ordinal: 2, table: "inventory_level", operation: "patch", before, after },
  ], lifecycle: ["a", "b"].map((id, attemptOrdinal) => ({ table: "reservation_item", operation: "softDelete", key: { id },
    beforeDeletedAt: null, afterDeletedAt: later, attemptOrdinal, rowAtOperation: null })) };
  const receipt = call(["line", "missing", "line"], [event("a", "reservation_item", "deleted"), event("b", "reservation_item", "deleted"), event("level", "inventory_level", "updated")]);
  return { evidence, receipt, a, b, before, after };
};

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureInventoryMetadata());
  contracts = Result.getOrThrow(compileReservationLineItemContracts(metadata.frame.tables));
  policy = inventoryReservationLineItemEventPolicy(contracts);
});

describe("native Reservation Line Item receipts", () => {
  it("preserves bounded raw order and duplicates without admitting selectors or managed data", () => {
    for (const ids of [[], ["line"], ["b", "a", "b", "missing"]]) expect(Result.getOrThrow(decodeReservationLineItemIds(ids))).toEqual(ids);
    for (const ids of [[""], ["a", "a", "a", "a", "a"], { line_item_id: ["line"] }, [null]])
      expect(Result.isFailure(decodeReservationLineItemIds(ids))).toBe(true);
  });

  it("authenticates full checked Reservation DML and exact quantity companions", async () => {
    const row = await reservation("a", { quantity: 0.125 });
    await Effect.runPromise(contracts.decodeStoredRow(row));
    const missing = { ...row }; delete missing.raw_quantity;
    for (const invalid of [missing, { ...row, raw_quantity: { value: "9", precision: 20 } }, { ...row, allow_backorder: null }, { ...row, unexpected: true }])
      expect(await Effect.runPromise(Effect.result(contracts.decodeStoredRow(invalid)))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  });

  it("authenticates grouped fractional release while retaining older tombstones and raw missing selectors", async () => {
    const { receipt, evidence } = await deletion();
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    await refused({ ...receipt, result: {} }, evidence);
    await refused({ ...receipt, mode: "read" }, evidence);
    await refused({ ...receipt, commandName: "inventoryRelease" }, evidence);
    await refused({ ...receipt, input: ["foreign"] }, evidence);
  });

  it("restores only deleted demand but retains active no-op roots and all native restored events", async () => {
    const active = await reservation("a", { quantity: 2 }), deleted = await reservation("b", { quantity: 3, deleted_at: time });
    const restored = { ...deleted, deleted_at: null, updated_at: later };
    const before = await level("level", { reserved_quantity: 2 }), after = await level("level", { reserved_quantity: 5, updated_at: later });
    const evidence: Activity = { ...empty(), observedRows: [{ table: "reservation_item", row: active }, { table: "reservation_item", row: restored },
      { table: "inventory_level", row: after }], mutations: [
        { ordinal: 0, table: "reservation_item", operation: "patch", before: deleted, after: restored },
        { ordinal: 1, table: "inventory_level", operation: "patch", before, after },
      ], lifecycle: [
        { table: "reservation_item", operation: "restore", key: { id: "a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active },
        { table: "reservation_item", operation: "restore", key: { id: "b" }, beforeDeletedAt: time, afterDeletedAt: null, attemptOrdinal: 0, rowAtOperation: null },
      ] };
    const receipt = call(["line", "line"], [event("a", "reservation_item", "restored"), event("b", "reservation_item", "restored"), event("level", "inventory_level", "updated")], true);
    await Effect.runPromise(policy.validateLogicalCall(receipt, evidence));
    const forged = await level("level", { reserved_quantity: 7, updated_at: later });
    const first = evidence.mutations[0], second = evidence.mutations[1];
    if (first === undefined || second === undefined) throw new Error("Missing restore mutations");
    await refused(receipt, { ...evidence, mutations: [first, { ...second, after: forged }] });
    await refused({ ...receipt, events: receipt.events.slice(1) }, evidence);
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.map(value => ({ ...value, rowAtOperation: null })) });
  });

  it("permits empty/missing selections and repeated active restoration without double counting demand", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call([]), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call(["missing"]), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call([], [], true), empty()));
    const active = await reservation("a", { quantity: 2 });
    const evidence: Activity = { ...empty(), observedRows: [{ table: "reservation_item", row: active }], lifecycle: [
      { table: "reservation_item", operation: "restore", key: { id: "a" }, beforeDeletedAt: null, afterDeletedAt: null, attemptOrdinal: null, rowAtOperation: active },
    ] };
    await Effect.runPromise(policy.validateLogicalCall(call(["line"], [event("a", "reservation_item", "restored")], true), evidence));
    await refused(call(["line"], [], true), evidence);
    await refused(call(["line"], [event("a", "reservation_item", "restored")], true), { ...evidence,
      observedRows: [...evidence.observedRows, { table: "inventory_level", row: await level() }] });
  });

  it("refuses altered quantities, metadata, endpoints, lifecycle membership and unrelated effects", async () => {
    const { receipt, evidence, after } = await deletion();
    const mutation = evidence.mutations[2]; if (mutation === undefined) throw new Error("Missing Level fixture");
    for (const change of [{ reserved_quantity: "0", raw_reserved_quantity: { value: "0", precision: 20 } },
      { incoming_quantity: "0", raw_incoming_quantity: { value: "0", precision: 20 } }, { metadata: {} }, { created_at: later },
      { location_id: "other" }, { inventory_item_id: "other" }])
      await refused(receipt, { ...evidence, mutations: [...evidence.mutations.slice(0, 2), { ...mutation, after: { ...after, ...change } }] });
    await refused(receipt, { ...evidence, lifecycle: evidence.lifecycle.slice(0, 1) });
    await refused(receipt, { ...evidence, lifecycle: [...evidence.lifecycle].reverse() });
    await refused(receipt, { ...evidence, mutations: evidence.mutations.map(value => ({ ...value, ordinal: value.ordinal + 1 })) });
    await refused(receipt, { ...evidence, observedRows: [...evidence.observedRows, { table: "inventory_item", row: after }] });
    await refused(receipt, { ...evidence, mutations: [...evidence.mutations, { ...mutation, ordinal: 3 }] });
  });

  it("authenticates exact event family, identity, action and native root-before-Level order", async () => {
    const { receipt, evidence } = await deletion();
    const firstEvent = receipt.events[0]; if (firstEvent === undefined) throw new Error("Missing deletion event");
    for (const events of [[], receipt.events.slice(0, 2), [...receipt.events].reverse(),
      [event("a", "reservation_item", "restored"), ...receipt.events.slice(1)],
      [event("foreign", "reservation_item", "deleted"), ...receipt.events.slice(1)], [...receipt.events, firstEvent]])
      await refused({ ...receipt, events }, evidence);
    for (const input of [event("a", "inventory_level", "deleted"), event("a", "reservation_item", "updated"),
      { name: "inventory.reservation-item.restored", metadata: { source: "inventory", object: "reservation_item", action: "restored" }, data: { id: "a", extra: true } }])
      expect(await Effect.runPromise(Effect.result(policy.capture(input)))).toMatchObject({ _tag: "Failure", failure: { reason: "unadmittedEvent" } });
  });

  it("counts complete deleted history and requires the exact active affected Level set", async () => {
    const { receipt, evidence } = await deletion();
    const extra = await Promise.all(["extra-1", "extra-2"].map(id => reservation(id, { deleted_at: time })));
    await refused(receipt, { ...evidence, observedRows: [...evidence.observedRows, ...extra.map(row => ({ table: "reservation_item", row }))] });
    await refused(receipt, { ...evidence, observedRows: evidence.observedRows.filter(entry => entry.table !== "inventory_level"), mutations: evidence.mutations.slice(0, 2) });
    const levelMutation = evidence.mutations[2]; if (levelMutation?.before === null || levelMutation?.before === undefined) throw new Error("Missing Level preimage");
    await refused(receipt, { ...evidence, mutations: [...evidence.mutations.slice(0, 2), { ...levelMutation, before: { ...levelMutation.before, deleted_at: time } }] });
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import type { Json, JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { compileInventoryItemContracts } from "../src/modules/inventory/item-contracts";
import { compileInventoryLevelContracts } from "../src/modules/inventory/level-contracts";
import { compileInventoryDeletionContracts } from "../src/modules/inventory/deletion-contracts";
import { inventoryItemCreationEventPolicy } from "../src/modules/inventory/create-item-events";
import { decodeInventoryItemCreates, decodeInventoryItemPhysicalDeletionIds } from "../src/modules/inventory/create-item-input";
import { captureExactNumericRow } from "../src/value/exact-numeric";

type Call = Parameters<LogicalCallReceiptValidation>[0];
type Activity = Parameters<LogicalCallReceiptValidation>[1];
let policy: ReturnType<typeof inventoryItemCreationEventPolicy>;
let item: Result.Result.Success<ReturnType<typeof compileInventoryItemContracts>>;
let level: Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
let reservationNumeric: Parameters<typeof captureExactNumericRow>[1];
const time = "2026-10-17T00:00:00.000Z";
const empty = (): Activity => ({ observedRows: [], mutations: [], lifecycle: [], setNull: [], relationalReads: [], referenceReplacements: [] });
const itemRow = (id: string, changes: JsonObject = {}): JsonObject => ({ id, ...item.creationDefaults,
  created_at: time, updated_at: time, deleted_at: null, ...changes });
const event = (id: string, object: "inventory_item" | "inventory_level" = "inventory_item", action: "created" | "deleted" = "created"): Json => ({
  name: `inventory.${object.replaceAll("_", "-")}.${action}`, metadata: { source: "inventory", object, action }, data: { id },
});
const call = (input: Json, result: Json, events: readonly Json[] = [], commandName = "inventoryCreate"): Call => ({
  commandName, mode: "write", input, result, events, fromAttempt: 0, toAttempt: 0, fromLifecycle: 0, toLifecycle: 0,
});
const created = (rows: readonly JsonObject[]): Activity => ({ ...empty(), mutations: rows.map((after, ordinal) => ({
  ordinal, table: "inventory_item", operation: "insert", before: null, after,
})) });
const deleted = (roots: readonly JsonObject[], levels: readonly JsonObject[] = [], reservations: readonly JsonObject[] = []): Activity => {
  const ordered = [...levels.map(row => ({ table: "inventory_level", row })), ...reservations.map(row => ({ table: "reservation_item", row })),
    ...roots.map(row => ({ table: "inventory_item", row }))];
  return { ...empty(), observedRows: ordered, mutations: ordered.map(({ table, row: before }, ordinal) => ({ ordinal, table, operation: "delete", before, after: null })) };
};
const refuse = async (receipt: Call, activity: Activity) => expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(receipt, activity))))
  .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });

beforeAll(async () => {
  const metadata = await Effect.runPromise(captureInventoryMetadata()), itemTable = metadata.frame.tables.find(table => table.name === "inventory_item"),
    levelTable = metadata.frame.tables.find(table => table.name === "inventory_level"), reservation = metadata.frame.tables.find(table => table.name === "reservation_item");
  if (itemTable === undefined || levelTable === undefined || reservation === undefined) throw new Error("Missing native Inventory DML");
  item = Result.getOrThrow(compileInventoryItemContracts(itemTable)); level = Result.getOrThrow(compileInventoryLevelContracts(levelTable));
  reservationNumeric = reservation.columns.filter(column => column.type === "bigNumber");
  policy = inventoryItemCreationEventPolicy(item, level, Result.getOrThrow(compileInventoryDeletionContracts(metadata.frame.tables)));
});

describe("native standalone Inventory Item creation receipts", () => {
  it("authenticates complete ordered Item DTOs, metadata, signed dimensions and actual DML defaults", async () => {
    const input: JsonObject[] = [{ id: "explicit-a", sku: "A", weight: -1.25, height: 1e100, requires_shipping: false, metadata: { nested: [true, "kept"] } },
      { sku: "B", title: "Second", length: 2.5, metadata: null }, {}, { description: "Fourth", width: -0.125 }];
    const rows = input.map((value, index) => itemRow("generated-" + index, value)), receipt = call(input, rows, rows.map(row => event(String(row.id)))), activity = created(rows);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    const first = rows[0]; if (first === undefined) throw new Error("Missing first Item");
    for (const output of [[...rows].reverse(), [first, first, ...rows.slice(2)], rows.slice(1)])
      await refuse({ ...receipt, result: output }, activity);
    for (const changes of [{ title: "forged" }, { weight: 1.25 }, { metadata: {} }, { requires_shipping: true }, { unknown: true }])
      await refuse({ ...receipt, result: [{ ...first, ...changes }, ...rows.slice(1)] }, activity);
    const incomplete = { ...first }; delete incomplete.thumbnail;
    await refuse({ ...receipt, result: [incomplete, ...rows.slice(1)] }, activity);
    const wrongDefault = itemRow("default-forged", { requires_shipping: false });
    await refuse(call([{}], [wrongDefault], [event("default-forged")]), created([wrongDefault]));
    const wrongInput = itemRow("dimension-forged", { weight: 3 });
    await refuse(call([{ weight: -3 }], [wrongInput], [event("dimension-forged")]), created([wrongInput]));
  });

  it("retains empty calls, the existing internal ID disposition and four-raw-Item bounds", async () => {
    await Effect.runPromise(policy.validateLogicalCall(call([], []), empty()));
    const row = itemRow("explicit", { sku: null });
    await Effect.runPromise(policy.validateLogicalCall(call([{ id: "explicit", sku: null }], [row], [event("explicit")]), created([row])));
    await refuse(call([{ id: "other" }], [row], [event("explicit")]), created([row]));
    expect(Result.isSuccess(decodeInventoryItemCreates([{}, {}, {}, {}]))).toBe(true);
    expect(Result.isFailure(decodeInventoryItemCreates([{}, {}, {}, {}, {}]))).toBe(true);
    expect(Result.getOrThrow(decodeInventoryItemPhysicalDeletionIds(["a", "a", "missing"]))).toEqual(["a", "a", "missing"]);
    expect(Result.isFailure(decodeInventoryItemPhysicalDeletionIds(["a", "a", "a", "a", "a"]))).toBe(true);
    for (const input of [{ reserved_quantity: 1 }, { stocked_quantity: 1 }, { location_levels: [] }, { created_at: time }])
      expect(Result.isFailure(decodeInventoryItemCreates([input]))).toBe(true);
  });

  it("authenticates the full sixteen-row historical physical closure with only four root Item events", async () => {
    const roots = Array.from({ length: 4 }, (_, index) => itemRow("item" + index, { deleted_at: index % 2 ? time : null }));
    const levels: JsonObject[] = [], reservations: JsonObject[] = [];
    for (const [index, root] of roots.entries()) {
      for (let child = 0; child < 2; child++) levels.push(await Effect.runPromise(captureExactNumericRow({ id: `level-${index}-${child}`,
        inventory_item_id: root.id, location_id: "location" + child, stocked_quantity: 5.125, reserved_quantity: 3.25, incoming_quantity: 2.75,
        metadata: { keep: true }, created_at: time, updated_at: time, deleted_at: child ? time : null }, level.numeric, true)));
      reservations.push(await Effect.runPromise(captureExactNumericRow({ id: "reservation" + index, inventory_item_id: root.id,
        location_id: "location0", quantity: 3.25, line_item_id: null, allow_backorder: false, external_id: null, description: null,
        created_by: null, metadata: { keep: true }, created_at: time, updated_at: time, deleted_at: index % 2 ? time : null }, reservationNumeric)));
    }
    const ids = roots.map(row => String(row.id)), receipt = call(ids, null, ids.map(id => event(id, "inventory_item", "deleted")), "inventoryItemPhysicalDeleteForWorkflow"),
      activity = deleted(roots, levels, reservations);
    await Effect.runPromise(policy.validateLogicalCall(receipt, activity));
    await refuse({ ...receipt, result: ids }, activity);
    await refuse({ ...receipt, events: [...receipt.events, event("level-0-0", "inventory_level", "deleted")] }, activity);
    await refuse({ ...receipt, events: receipt.events.slice(1) }, activity);
    await refuse({ ...receipt, events: [...receipt.events].reverse() }, activity);
    await refuse(receipt, { ...activity, mutations: activity.mutations.slice(1).map((value, ordinal) => ({ ...value, ordinal })) });
    const [parent] = activity.mutations.slice(-4);
    if (parent === undefined) throw new Error("Missing root physical mutation");
    await refuse(receipt, { ...activity, mutations: [parent, ...activity.mutations.filter(value => value !== parent)].map((value, ordinal) => ({ ...value, ordinal })) });
    await refuse({ ...receipt, commandName: "inventoryItemSoftDeleteForWorkflow" }, activity);
    await refuse(receipt, { ...activity, mutations: activity.mutations.map(value => ({ ...value, operation: "patch" })) });
    const extraLevel = { ...levels[0], id: "third-level" };
    await refuse(receipt, deleted(roots, [...levels, extraLevel], reservations));
    const extraReservation = { ...reservations[0], id: "second-reservation" };
    await refuse(receipt, deleted(roots, levels, [...reservations, extraReservation]));
  });

  it("refuses malformed quantities, foreign descendants and unrequested roots before accepting a void inverse", async () => {
    const root = itemRow("item"), receipt = call(["item"], null, [event("item", "inventory_item", "deleted")], "inventoryItemPhysicalDeleteForWorkflow");
    const child = await Effect.runPromise(captureExactNumericRow({ id: "level", inventory_item_id: "item", location_id: "location",
      stocked_quantity: 1, reserved_quantity: 1, incoming_quantity: 1, metadata: null, created_at: time, updated_at: time, deleted_at: null }, level.numeric));
    await Effect.runPromise(policy.validateLogicalCall(receipt, deleted([root], [child])));
    await refuse(receipt, deleted([root], [{ ...child, inventory_item_id: "outside" }]));
    const incomplete = { ...child }; delete incomplete.raw_stocked_quantity;
    await refuse(receipt, deleted([root], [incomplete]));
    await refuse({ ...receipt, input: ["other"] }, deleted([root], [child]));
    await refuse(receipt, { ...deleted([root]), observedRows: [{ table: "product_variant_inventory_item", row: root }] });
    await Effect.runPromise(policy.validateLogicalCall(call([], null, [], "inventoryItemPhysicalDeleteForWorkflow"), empty()));
    await Effect.runPromise(policy.validateLogicalCall(call(["missing"], null, [], "inventoryItemPhysicalDeleteForWorkflow"), empty()));
  });
});

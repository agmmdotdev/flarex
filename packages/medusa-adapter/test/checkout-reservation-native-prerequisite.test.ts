import { expect, it, vi } from "vitest";
import type { Context, DAL, InventoryTypes } from "@medusajs/framework/types";
import { InventoryItem, ReservationItem } from "@medusajs/inventory/models";
import { InventoryLevelService, InventoryModuleService } from "@medusajs/inventory/services";
import { ModulesSdkUtils } from "@medusajs/framework/utils/portable";

const unexpected = (): never => { throw new Error("Unexpected native reservation prerequisite call"); };
const unexpectedAsync = async (): Promise<never> => unexpected();
const denied: DAL.RepositoryService = { getFreshManager: unexpected, getActiveManager: unexpected, transaction: unexpectedAsync,
  serialize: unexpectedAsync, find: unexpectedAsync, findAndCount: unexpectedAsync, create: unexpectedAsync,
  update: unexpectedAsync, delete: unexpectedAsync, softDelete: unexpectedAsync, restore: unexpectedAsync,
  upsert: unexpectedAsync, upsertWithReplace: unexpectedAsync };

/** Scripted DAL rows isolate the actual native availability owner. The genuine
 * service decides whether creation is reached; no test arithmetic or storage
 * engine implements that decision. Connected tests use both real databases. */
function witness(levels = [{ item: "item", location: "location", available: "3" }]) {
  const Item = ModulesSdkUtils.MedusaInternalService(InventoryItem), Reservation = ModulesSdkUtils.MedusaInternalService(ReservationItem);
  const create = vi.fn(async () => []), update = vi.fn(async () => []);
  const levelRepository = { ...denied, find: async () => levels.map((row, index) => ({ id: "level-" + index,
    inventory_item_id: row.item, location_id: row.location,
    stocked_quantity: row.available, reserved_quantity: "0", available_quantity: row.available })), update,
    getStockedQuantity: unexpectedAsync, getReservedQuantity: unexpectedAsync, getAvailableQuantity: unexpectedAsync };
  const service = new InventoryModuleService({ baseRepository: denied,
    inventoryItemService: new Item({ inventoryItemRepository: denied }),
    reservationItemService: new Reservation({ reservationItemRepository: { ...denied, create } }),
    inventoryLevelService: new InventoryLevelService({ inventoryLevelRepository: levelRepository }) });
  const context: Context = { manager: {}, transactionManager: {} };
  return { service, context, create, update };
}
const input = (quantity: number | string, extra: Partial<InventoryTypes.CreateReservationItemInput> = {}): InventoryTypes.CreateReservationItemInput => ({
  inventory_item_id: "item", location_id: "location", line_item_id: "line", quantity, ...extra,
});

it("refuses combined non-backorder demand on one level before creating any reservations", async () => {
  const { service, context, create, update } = witness();
  await expect(service.createReservationItems_([
    { inventory_item_id: "item", location_id: "location", line_item_id: "line-a", quantity: 2 },
    { inventory_item_id: "item", location_id: "location", line_item_id: "line-b", quantity: 2 },
  ], context)).rejects.toMatchObject({ type: "not_allowed", message: "Not enough stock available for item item at location location" });
  expect(create).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

it("retains exact decimal demand at and immediately above availability", async () => {
  const exact = witness([{ item: "item", location: "location", available: "0.3" }]);
  await expect(exact.service.createReservationItems_([input("0.1"), input("0.2")], exact.context)).resolves.toEqual([]);
  expect(exact.create).toHaveBeenCalledTimes(1);
  const insufficient = witness([{ item: "item", location: "location", available: "0.2999999999999999999" }]);
  await expect(insufficient.service.createReservationItems_([input("0.1"), input("0.2")], insufficient.context))
    .rejects.toMatchObject({ type: "not_allowed" });
  expect(insufficient.create).not.toHaveBeenCalled();
});

it("keeps Inventory Item and Location identities separate when grouping demand", async () => {
  for (const rows of [[{ item: "item", location: "location", available: "3" }, { item: "other", location: "location", available: "3" }],
    [{ item: "item", location: "location", available: "3" }, { item: "item", location: "other", available: "3" }]]) {
    const local = witness(rows);
    await expect(local.service.createReservationItems_(rows.map(row => input(2, { inventory_item_id: row.item, location_id: row.location })), local.context)).resolves.toEqual([]);
    expect(local.create).toHaveBeenCalledTimes(1);
  }
});

it("retains native backorder eligibility while checking the complete ordinary demand", async () => {
  for (const rows of [[input(100, { allow_backorder: true }), input(2)], [input(2), input(100, { allow_backorder: true })]]) {
    const local = witness();
    await expect(local.service.createReservationItems_(rows, local.context)).resolves.toEqual([]);
    expect(local.create).toHaveBeenCalledTimes(1);
  }
  const insufficient = witness();
  await expect(insufficient.service.createReservationItems_([input(2), input(100, { allow_backorder: true }), input(2)], insufficient.context))
    .rejects.toMatchObject({ type: "not_allowed" });
  expect(insufficient.create).not.toHaveBeenCalled();
  const backordered = witness([{ item: "item", location: "location", available: "0" }]);
  await expect(backordered.service.createReservationItems_([input(2, { allow_backorder: true }), input(3, { allow_backorder: true })], backordered.context)).resolves.toEqual([]);
});

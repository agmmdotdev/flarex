import { describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import type { Context, DAL } from "@medusajs/framework/types";
import { MathBN, ModulesSdkUtils } from "@medusajs/framework/utils/portable";
import { InventoryItem, ReservationItem } from "@medusajs/inventory/models";
import { InventoryLevelService, InventoryModuleService } from "@medusajs/inventory/services";
import { encodeExactNumeric } from "../src/value/exact-numeric";

const time = "2026-10-17T00:00:00.000Z";
const reservation = (id: string, quantity: number, deleted_at: string | null = null) => ({ id, inventory_item_id: "item", location_id: "location",
  line_item_id: "line", quantity, raw_quantity: { value: String(quantity), precision: 20 }, allow_backorder: false,
  external_id: null, description: null, created_by: null, metadata: null, created_at: time, updated_at: time, deleted_at });
const level = (reserved_quantity: number) => ({ id: "level", inventory_item_id: "item", location_id: "location", stocked_quantity: 10,
  reserved_quantity, incoming_quantity: 0, available_quantity: 10 - reserved_quantity,
  raw_stocked_quantity: { value: "10", precision: 20 }, raw_reserved_quantity: { value: String(reserved_quantity), precision: 20 },
  raw_incoming_quantity: { value: "0", precision: 20 }, metadata: null, created_at: time, updated_at: time, deleted_at: null });
const unexpected = (): never => { throw new Error("Unexpected native witness repository method"); };
const unexpectedAsync = async (): Promise<never> => unexpected();
const denied: DAL.RepositoryService = { getFreshManager: unexpected, getActiveManager: unexpected, transaction: unexpectedAsync,
  serialize: unexpectedAsync, find: unexpectedAsync, findAndCount: unexpectedAsync, create: unexpectedAsync,
  update: unexpectedAsync, delete: unexpectedAsync, softDelete: unexpectedAsync, restore: unexpectedAsync,
  upsert: unexpectedAsync, upsertWithReplace: unexpectedAsync };
const decodeAdjustments = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String, reserved_quantity: Schema.Unknown })));

/** Scripted DAL results characterize genuine native methods and decorators.
 * There is no simulated lifecycle/arithmetic/query engine or database here.
 * The real native internal service owns buildQuery/default-order conversion. */
function nativeWitness(input: { active: ReturnType<typeof reservation>[]; restored: ReturnType<typeof reservation>[];
  selectedLevels: ReturnType<typeof level>[] }) {
  const trace: string[] = [];
  const findReservations = vi.fn(async (_query: unknown, _context?: Context) => { trace.push("reservation.find"); return input.active; });
  const restoreReservations = vi.fn(async (_selector: unknown, _context?: Context): Promise<[ReturnType<typeof reservation>[], Record<string, unknown[]>]> => {
    trace.push("reservation.restore"); return [input.restored, { ReservationItem: input.restored }];
  });
  const softDeleteReservations = vi.fn(async (_selector: unknown, _context?: Context): Promise<[ReturnType<typeof reservation>[], Record<string, unknown[]>]> => {
    trace.push("reservation.softDelete"); return [[], {}];
  });
  const reservationRepository: DAL.RepositoryService = { ...denied, find: findReservations, restore: restoreReservations, softDelete: softDeleteReservations };
  const findLevels = vi.fn(async (_query: unknown, _context?: Context) => { trace.push("level.find"); return input.selectedLevels; });
  const updateLevels = vi.fn(async (_pairs: unknown, _context?: Context) => { trace.push("level.update"); return []; });
  const levelRepository = { ...denied, find: findLevels, update: updateLevels,
    getStockedQuantity: unexpectedAsync, getReservedQuantity: unexpectedAsync, getAvailableQuantity: unexpectedAsync };
  const ItemService = ModulesSdkUtils.MedusaInternalService(InventoryItem), ReservationService = ModulesSdkUtils.MedusaInternalService(ReservationItem);
  const itemService = new ItemService({ inventoryItemRepository: denied });
  const reservationService = new ReservationService({ reservationItemRepository: reservationRepository });
  const inventoryLevelService = new InventoryLevelService({ inventoryLevelRepository: levelRepository });
  const levelAdjustments = vi.spyOn(inventoryLevelService, "update");
  const service = new InventoryModuleService({ baseRepository: denied, inventoryItemService: itemService,
    reservationItemService: reservationService, inventoryLevelService });
  // These inert objects only satisfy the genuine decorator's provided-context
  // branch. Unexpected manager/transaction acquisition throws above.
  const context: Context = { manager: {}, transactionManager: {} };
  return { service, context, trace, findReservations, restoreReservations, softDeleteReservations, findLevels, updateLevels, levelAdjustments };
}

describe("native Reservation restoration by Line Item visibility witness", () => {
  it("records all-deleted history being restored while native adjustment receives no Reservation preimages", async () => {
    const deleted = reservation("deleted", 3, time), restored = { ...deleted, deleted_at: null };
    const env = nativeWitness({ active: [], restored: [restored], selectedLevels: [] });
    try {
      const ids = ["line", "line", "missing"]; expect(await env.service.restoreReservationItemsByLineItem(ids, env.context)).toBeUndefined();
      expect(env.findReservations).toHaveBeenCalledTimes(1);
      expect(env.findReservations.mock.calls[0]?.[0]).toMatchObject({ where: { line_item_id: ["line", "missing"] }, options: { orderBy: { id: "ASC" } } });
      const query = env.findReservations.mock.calls[0]?.[0];
      expect(query).not.toHaveProperty("options.filters.softDeletable.withDeleted");
      expect(env.restoreReservations).toHaveBeenCalledExactlyOnceWith({ line_item_id: ids }, expect.objectContaining({ transactionManager: env.context.transactionManager }));
      expect(env.findLevels.mock.calls[0]?.[0]).toMatchObject({ where: { $or: [{ id: [] }] } });
      expect(env.levelAdjustments.mock.calls[0]?.[0]).toEqual([]); expect(env.updateLevels).not.toHaveBeenCalled();
      expect(env.trace).toEqual(["reservation.find", "reservation.restore", "level.find"]);
      // Expected Inventory invariant: restoring quantity3 should request a
      // reserved quantity increase of3. The observed native call requests none.
      expect(env.levelAdjustments.mock.calls[0]?.[0]).not.toEqual([{ id: "level", reserved_quantity: 3 }]);
      console.info("Native Line Item restoration witness", { history: "all-deleted", query,
        restoreSelector: env.restoreReservations.mock.calls[0]?.[0], levelAdjustments: env.levelAdjustments.mock.calls[0]?.[0] });
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it("records mixed history using the already-active quantity again instead of the newly restored quantity", async () => {
    const active = reservation("active", 2), deleted = reservation("deleted", 3, time);
    const env = nativeWitness({ active: [active], restored: [active, { ...deleted, deleted_at: null }], selectedLevels: [level(2)] });
    try {
      expect(await env.service.restoreReservationItemsByLineItem(["line"], env.context)).toBeUndefined();
      expect(env.findReservations.mock.calls[0]?.[0]).toMatchObject({ where: { line_item_id: ["line"] } });
      expect(env.findReservations.mock.calls[0]?.[0]).not.toHaveProperty("options.filters.softDeletable.withDeleted");
      expect(env.restoreReservations).toHaveBeenCalledExactlyOnceWith({ line_item_id: ["line"] }, expect.objectContaining({ transactionManager: env.context.transactionManager }));
      const adjustment = decodeAdjustments(env.levelAdjustments.mock.calls[0]?.[0]); expect(adjustment).toHaveLength(1);
      expect(adjustment[0]?.id).toBe("level");
      if (adjustment[0] === undefined) throw new Error("Missing genuine native Level adjustment");
      const quantity = await Effect.runPromise(encodeExactNumeric(adjustment[0].reserved_quantity));
      expect(MathBN.eq(quantity.value, 4)).toBe(true);
      // Expected Inventory invariant is2 active +3 restored =5. Native currently
      // requests2 +2 active =4, independently of the returned restored bodies.
      expect(MathBN.eq(quantity.value, 5)).toBe(false);
      expect(env.updateLevels).toHaveBeenCalledTimes(1);
      expect(env.trace).toEqual(["reservation.find", "reservation.restore", "level.find", "level.find", "level.update"]);
      console.info("Native Line Item restoration witness", { history: "mixed", query: env.findReservations.mock.calls[0]?.[0],
        restoreSelector: env.restoreReservations.mock.calls[0]?.[0], requestedReserved: quantity.value, expectedReserved: 5 });
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it("controls the witness with genuine grouped deletion arithmetic and unchanged raw Line Item selectors", async () => {
    const env = nativeWitness({ active: [reservation("a", 2), reservation("b", 3)], restored: [], selectedLevels: [level(5)] });
    try {
      const ids = ["line", "line"]; expect(await env.service.deleteReservationItemsByLineItem(ids, env.context)).toBeUndefined();
      expect(env.findReservations.mock.calls[0]?.[0]).toMatchObject({ where: { line_item_id: ["line"] } });
      expect(env.softDeleteReservations).toHaveBeenCalledExactlyOnceWith({ line_item_id: ids }, expect.objectContaining({ transactionManager: env.context.transactionManager })); expect(env.restoreReservations).not.toHaveBeenCalled();
      const adjustment = decodeAdjustments(env.levelAdjustments.mock.calls[0]?.[0]); expect(adjustment).toHaveLength(1);
      if (adjustment[0] === undefined) throw new Error("Missing genuine native delete adjustment");
      const quantity = await Effect.runPromise(encodeExactNumeric(adjustment[0].reserved_quantity));
      expect(MathBN.eq(quantity.value, 0)).toBe(true);
      expect(env.trace).toEqual(["reservation.find", "reservation.softDelete", "level.find", "level.find", "level.update"]);
      console.info("Native Line Item deletion witness", { query: env.findReservations.mock.calls[0]?.[0],
        selector: env.softDeleteReservations.mock.calls[0]?.[0], requestedReserved: quantity.value });
    } finally { env.levelAdjustments.mockRestore(); }
  });
});

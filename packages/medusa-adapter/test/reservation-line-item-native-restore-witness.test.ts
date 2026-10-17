import { describe, expect, it, vi } from "vitest";
import { Effect, Schema } from "effect";
import type { Context, DAL, InventoryTypes } from "@medusajs/framework/types";
import { MathBN, ModulesSdkUtils } from "@medusajs/framework/utils/portable";
import { InventoryItem, ReservationItem } from "@medusajs/inventory/models";
import { InventoryLevelService, InventoryModuleService } from "@medusajs/inventory/services";
import { encodeExactNumeric } from "../src/value/exact-numeric";

const time = "2026-10-17T00:00:00.000Z";
const reservation = (id: string, quantity: number, deleted_at: InventoryTypes.ReservationItemDTO["deleted_at"] = null) => ({ id, inventory_item_id: "item", location_id: "location",
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
function nativeWitness(input: { history: ReturnType<typeof reservation>[]; restored: ReturnType<typeof reservation>[];
  selectedLevels: ReturnType<typeof level>[]; onRestore?: () => void }) {
  const trace: string[] = [];
  const findReservations = vi.fn(async (_query: unknown, _context?: Context) => { trace.push("reservation.find"); return input.history; });
  const restoreReservations = vi.fn(async (_selector: unknown, _context?: Context): Promise<[ReturnType<typeof reservation>[], Record<string, unknown[]>]> => {
    trace.push("reservation.restore"); input.onRestore?.(); return [input.restored, { ReservationItem: input.restored }];
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

describe("native Reservation by-Line-Item restoration quantity invariants", () => {
  it("restores all-deleted quantity from a complete withDeleted preimage without changing the raw selector", async () => {
    const deleted = reservation("deleted", 3, time), env = nativeWitness({ history: [deleted], restored: [{ ...deleted, deleted_at: null }], selectedLevels: [level(0)] });
    try {
      const ids = ["line", "line", "missing"]; expect(await env.service.restoreReservationItemsByLineItem(ids, env.context)).toBeUndefined();
      expect(env.findReservations).toHaveBeenCalledTimes(1);
      expect(env.findReservations.mock.calls[0]?.[0]).toMatchObject({ where: { line_item_id: ["line", "missing"] },
        options: { orderBy: { id: "ASC" }, filters: { softDeletable: { withDeleted: true } } } });
      expect(env.restoreReservations).toHaveBeenCalledExactlyOnceWith({ line_item_id: ids }, expect.objectContaining({ transactionManager: env.context.transactionManager }));
      const adjustment = decodeAdjustments(env.levelAdjustments.mock.calls[0]?.[0]); expect(adjustment).toHaveLength(1);
      if (adjustment[0] === undefined) throw new Error("Missing genuine restored Level adjustment");
      const quantity = await Effect.runPromise(encodeExactNumeric(adjustment[0].reserved_quantity)); expect(MathBN.eq(quantity.value, 3)).toBe(true);
      expect(env.updateLevels).toHaveBeenCalledTimes(1); expect(env.trace).toEqual(["reservation.find", "reservation.restore", "level.find", "level.find", "level.update"]);
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it("adds only deleted quantity in mixed active/deleted history and ignores already-active returned roots", async () => {
    const active = reservation("active", 2), deleted = reservation("deleted", 3, time);
    const env = nativeWitness({ history: [active, deleted], restored: [active, { ...deleted, deleted_at: null }], selectedLevels: [level(2)] });
    try {
      await env.service.restoreReservationItemsByLineItem(["line"], env.context);
      expect(env.findReservations.mock.calls[0]?.[0]).toMatchObject({ options: { filters: { softDeletable: { withDeleted: true } } } });
      const adjustment = decodeAdjustments(env.levelAdjustments.mock.calls[0]?.[0]); expect(adjustment).toHaveLength(1);
      if (adjustment[0] === undefined) throw new Error("Missing mixed-history Level adjustment");
      const quantity = await Effect.runPromise(encodeExactNumeric(adjustment[0].reserved_quantity)); expect(MathBN.eq(quantity.value, 5)).toBe(true);
      expect(env.updateLevels).toHaveBeenCalledTimes(1);
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it("keeps an already-active-only selection a quantity no-op while preserving the native restore call", async () => {
    const active = reservation("active", 2), env = nativeWitness({ history: [active], restored: [active], selectedLevels: [] });
    try {
      const ids = ["line", "line"]; await env.service.restoreReservationItemsByLineItem(ids, env.context);
      expect(env.findReservations.mock.calls[0]?.[0]).toMatchObject({ options: { filters: { softDeletable: { withDeleted: true } } } });
      expect(env.restoreReservations).toHaveBeenCalledExactlyOnceWith({ line_item_id: ids }, expect.objectContaining({ transactionManager: env.context.transactionManager }));
      expect(env.levelAdjustments.mock.calls[0]?.[0]).toEqual([]); expect(env.updateLevels).not.toHaveBeenCalled();
      expect(env.findLevels.mock.calls[0]?.[0]).toMatchObject({ where: { $or: [{ id: [] }] } });
      expect(env.trace).toEqual(["reservation.find", "reservation.restore", "level.find"]);
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it.each([{ ids: [] }, { ids: ["missing"] }, { ids: ["missing", "missing"] }])("preserves direct native empty/missing restore calls without inventing quantity adjustments: %j", async ({ ids }) => {
    const env = nativeWitness({ history: [], restored: [], selectedLevels: [] });
    try {
      await env.service.restoreReservationItemsByLineItem(ids, env.context);
      expect(env.findReservations.mock.calls[0]?.[0]).toMatchObject({ options: { filters: { softDeletable: { withDeleted: true } } } });
      expect(env.restoreReservations).toHaveBeenCalledExactlyOnceWith({ line_item_id: ids }, expect.objectContaining({ transactionManager: env.context.transactionManager }));
      expect(env.levelAdjustments.mock.calls[0]?.[0]).toEqual([]); expect(env.updateLevels).not.toHaveBeenCalled();
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it("does not add the same quantity on repeated restore with separately scripted already-active history", async () => {
    const deleted = reservation("deleted", 3, time), restored = { ...deleted, deleted_at: null };
    const env = nativeWitness({ history: [deleted], restored: [restored], selectedLevels: [level(0)] });
    try {
      await env.service.restoreReservationItemsByLineItem(["line"], env.context);
      const first = decodeAdjustments(env.levelAdjustments.mock.calls[0]?.[0]); if (first[0] === undefined) throw new Error("Missing first restore adjustment");
      expect(MathBN.eq((await Effect.runPromise(encodeExactNumeric(first[0].reserved_quantity))).value, 3)).toBe(true);
      // These are exact second-call DAL responses, not a fake visibility or
      // lifecycle engine. The genuine native method selects the preimages.
      env.findReservations.mockResolvedValueOnce([restored]); env.findLevels.mockResolvedValueOnce([]);
      await env.service.restoreReservationItemsByLineItem(["line"], env.context);
      expect(env.findReservations.mock.calls[1]?.[0]).toMatchObject({ options: { filters: { softDeletable: { withDeleted: true } } } });
      expect(env.restoreReservations).toHaveBeenCalledTimes(2); expect(env.levelAdjustments.mock.calls[1]?.[0]).toEqual([]); expect(env.updateLevels).toHaveBeenCalledTimes(1);
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it("snapshots Date-marked deleted preimages before native restore can mutate managed entity fields", async () => {
    const deleted = reservation("deleted", 3, new Date(time)), restored = { ...deleted, deleted_at: null };
    const env = nativeWitness({ history: [deleted], restored: [restored], selectedLevels: [level(0)], onRestore: () => {
      deleted.deleted_at = null; deleted.quantity = 99; deleted.inventory_item_id = "changed-by-managed-entity"; deleted.location_id = "changed-location";
    } });
    try {
      await env.service.restoreReservationItemsByLineItem(["line"], env.context);
      const adjustment = decodeAdjustments(env.levelAdjustments.mock.calls[0]?.[0]); expect(adjustment).toHaveLength(1);
      if (adjustment[0] === undefined) throw new Error("Missing captured preimage adjustment");
      expect(MathBN.eq((await Effect.runPromise(encodeExactNumeric(adjustment[0].reserved_quantity))).value, 3)).toBe(true);
      expect(env.findLevels.mock.calls[0]?.[0]).toMatchObject({ where: { $or: [{ id: [] }, { inventory_item_id: "item", location_id: "location" }] } });
      expect(deleted.quantity).toBe(99);
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it("preserves native exact grouped zero/fractional arithmetic while excluding already-active history", async () => {
    const active = reservation("active", 2), deleted = [reservation("zero", 0, time), reservation("a", 1.125, time), reservation("b", 0.375, time)];
    const env = nativeWitness({ history: [active, ...deleted], restored: [active, ...deleted.map(row => ({ ...row, deleted_at: null }))], selectedLevels: [level(2)] });
    try {
      await env.service.restoreReservationItemsByLineItem(["line"], env.context);
      const adjustment = decodeAdjustments(env.levelAdjustments.mock.calls[0]?.[0]); expect(adjustment).toHaveLength(1);
      if (adjustment[0] === undefined) throw new Error("Missing genuine grouped fractional restore");
      expect(MathBN.eq((await Effect.runPromise(encodeExactNumeric(adjustment[0].reserved_quantity))).value, 3.5)).toBe(true);
    } finally { env.levelAdjustments.mockRestore(); }
  });

  it("preserves the original grouped deletion control and default active-only read", async () => {
    const env = nativeWitness({ history: [reservation("a", 2), reservation("b", 3)], restored: [], selectedLevels: [level(5)] });
    try {
      const ids = ["line", "line"]; await env.service.deleteReservationItemsByLineItem(ids, env.context);
      expect(env.findReservations.mock.calls[0]?.[0]).toMatchObject({ where: { line_item_id: ["line"] } });
      expect(env.findReservations.mock.calls[0]?.[0]).not.toHaveProperty("options.filters.softDeletable.withDeleted");
      expect(env.softDeleteReservations).toHaveBeenCalledExactlyOnceWith({ line_item_id: ids }, expect.objectContaining({ transactionManager: env.context.transactionManager }));
      expect(env.restoreReservations).not.toHaveBeenCalled();
      const adjustment = decodeAdjustments(env.levelAdjustments.mock.calls[0]?.[0]); if (adjustment[0] === undefined) throw new Error("Missing delete control adjustment");
      expect(MathBN.eq((await Effect.runPromise(encodeExactNumeric(adjustment[0].reserved_quantity))).value, 0)).toBe(true);
    } finally { env.levelAdjustments.mockRestore(); }
  });
});

import { Effect } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { medusaLifecycle } from "../../repository/lifecycle";
import { captureCommerceInput } from "../../value/input";
import type { captureInventoryMetadata } from "./schema";
import type { compileInventoryDeletionContracts } from "./deletion-contracts";
import type { Result } from "effect";
import { decodeInventoryItemPhysicalSelection } from "./create-item-input";
import { validateInventoryItemLifecycleClosure } from "./deletion-lifecycle";

/** Native database FK cascades remove the complete Item-owned history. Only
 * root IDs reach the genuine internal service's afterDelete dispatcher. */
export const deleteInventoryItemCreation = Effect.fn("InventoryAdapter.deleteItemCreation")(function* (
  ctx: CommerceCommandContext, frame: Effect.Success<ReturnType<typeof captureInventoryMetadata>>["frame"],
  contracts: Result.Result.Success<ReturnType<typeof compileInventoryDeletionContracts>>, input: unknown,
) {
  const selected = yield* Effect.fromResult(decodeInventoryItemPhysicalSelection(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
  const item = frame.tables.find(table => table.name === "inventory_item"), level = frame.tables.find(table => table.name === "inventory_level"),
    reservation = frame.tables.find(table => table.name === "reservation_item");
  if (item === undefined || level === undefined || reservation === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const catalog = { tables: [item, level, reservation], entities: [{ table: item, model: "InventoryItem" },
    { table: level, model: "InventoryLevel" }, { table: reservation, model: "ReservationItem" }] };
  const lifecycle = medusaLifecycle(ctx, catalog, "delete"), roots = yield* lifecycle.roots(item, [...new Set(selected.$or.map(row => row.id))]);
  if (roots.length > 4) return yield* Effect.fail(commerceError("limitExceeded"));
  const plan = yield* lifecycle.plan(item, roots);
  yield* validateInventoryItemLifecycleClosure(roots, plan.rows(level), plan.rows(reservation));
  for (const table of catalog.tables) for (const row of plan.rows(table)) yield* contracts.decodeRow(table.name, row);
  const result = yield* plan.apply(), ids: string[] = [];
  for (const row of result.roots) {
    if (typeof row.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
    ids.push(row.id);
  }
  return ids;
});

import { Effect, Schema } from "effect";
import { inventoryStaticResources } from "@medusajs/inventory/static-manifest";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { medusaLifecycle } from "../../repository/lifecycle";
import { ScalarId } from "../../repository/scalar-id-read";
import type { captureInventoryMetadata } from "./schema";

export const InventoryDeletionIds = Schema.Array(ScalarId).check(Schema.isMaxLength(8));
const Selector = Schema.Struct({ id: Schema.Union([ScalarId, InventoryDeletionIds]) });
export const InventoryDeletionSelection = Schema.Union([ScalarId, InventoryDeletionIds, Selector, Schema.Array(Selector).check(Schema.isMaxLength(8))]);
export function inventoryDeletionIds(selection: typeof InventoryDeletionSelection.Type): string[] {
  return (Array.isArray(selection) ? selection : [selection]).flatMap(member => typeof member === "string" ? [member]
    : typeof member.id === "string" ? [member.id] : [...member.id]);
}
export const inventoryDeletionLinkableKeys = inventoryStaticResources.joinerConfig?.linkableKeys ?? {};
export const InventoryDeletionConfig = Schema.Struct({ returnLinkableKeys: Schema.optionalKey(Schema.Array(Schema.String.check(
  Schema.makeFilter(key => Object.hasOwn(inventoryDeletionLinkableKeys, key)),
)).check(Schema.isMaxLength(Object.keys(inventoryDeletionLinkableKeys).length))) });
export const InventoryDeletionInput = Schema.Struct({ selector: InventoryDeletionSelection, config: InventoryDeletionConfig });
export const decodeInventoryDeletionInput = commerceDecoder(InventoryDeletionInput, "invalidInput");
const decodeSelection = commerceDecoder(InventoryDeletionSelection, "unsupportedProfile");

/** Native Inventory owns both cascades. Bounds cover persisted history before
 * any lifecycle transition; repeated IDs retain the native membership semantics. */
export const softDeleteInventoryItems = Effect.fn("InventoryAdapter.softDeleteItems")(function* (
  ctx: CommerceCommandContext, metadata: Effect.Success<ReturnType<typeof captureInventoryMetadata>>["frame"], input: unknown,
) {
  const selection = yield* Effect.fromResult(decodeSelection(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
  const ids = inventoryDeletionIds(selection);
  if (ids.length > 8) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const item = metadata.tables.find(table => table.name === "inventory_item"), level = metadata.tables.find(table => table.name === "inventory_level"),
    reservation = metadata.tables.find(table => table.name === "reservation_item");
  if (item === undefined || level === undefined || reservation === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const catalog = { tables: [item, level, reservation], entities: [{ table: item, model: "InventoryItem" },
    { table: level, model: "InventoryLevel" }, { table: reservation, model: "ReservationItem" }] };
  const lifecycle = medusaLifecycle(ctx, catalog, "softDelete"), roots = yield* lifecycle.roots(item, [...new Set(ids)]);
  const plan = yield* lifecycle.plan(item, roots), rootIds = new Set(roots.map(row => row.id));
  for (const [table, maximum] of [[level, 2], [reservation, 1]] as const) {
    const counts = new Map<string, number>();
    for (const row of plan.rows(table)) {
      if (typeof row.id !== "string" || typeof row.inventory_item_id !== "string" || !rootIds.has(row.inventory_item_id))
        return yield* Effect.fail(commerceError("storedCorruption"));
      const count = (counts.get(row.inventory_item_id) ?? 0) + 1;
      counts.set(row.inventory_item_id, count);
      if (count > maximum) return yield* Effect.fail(commerceError("limitExceeded"));
    }
  }
  return yield* plan.apply();
});

import { Effect, Result, Schema } from "effect";
import { MathBN } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import { ScalarId } from "../../repository/scalar-id-read";
import type { prepareScalarRepository } from "../../repository/scalar";
import type { ReadTable } from "../../query/catalog";
import { InventoryDeletionIds } from "./deletion-lifecycle";

const decodeQuery = commerceDecoder(Schema.Struct({ where: Schema.Struct({ id: Schema.Union([ScalarId, InventoryDeletionIds]) }),
  options: Schema.optionalKey(Schema.StructWithRest(Schema.Struct({ fields: Schema.optionalKey(Schema.Array(Schema.String)) }),
    [Schema.Record(Schema.String, Schema.Json)])),
}), "unsupportedProfile");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");

/** The pinned InventoryItem formula sums active persisted level quantities and
 * applies Number only at serialization. An empty complete SUM is null, hence 0. */
export const inventoryItemReservedQuantity = Effect.fn("InventoryDeletion.reservedQuantity")(function* (levels: readonly JsonObject[]) {
  if (levels.length > 2) return yield* Effect.fail(commerceError("limitExceeded"));
  const checked = yield* projectExactNumericColumns([...levels], [{ name: "reserved_quantity" }], "exact");
  if (!Array.isArray(checked)) return yield* Effect.fail(commerceError("storedCorruption"));
  const quantities: string[] = [];
  for (const row of checked) {
    if (typeof row !== "object" || row === null || Array.isArray(row) || typeof row.reserved_quantity !== "string")
      return yield* Effect.fail(commerceError("storedCorruption"));
    quantities.push(row.reserved_quantity);
  }
  const numeric = yield* Effect.try({ try: () => Number(quantities.length === 0 ? null : MathBN.sum(...quantities).toString()),
    catch: cause => commerceError("storedCorruption", cause) });
  if (!Number.isFinite(numeric)) return yield* Effect.fail(commerceError("storedCorruption"));
  return numeric;
});

export function inventoryDeletionReadTable(table: ReadTable): ReadTable {
  return { ...table, columns: [...table.columns, "reserved_quantity"] };
}

/** Only this named DAL projection recognizes the computed field. Its physical
 * read still goes through the scalar owner; levels use complete bounded reads. */
export function inventoryDeletionFind(bound: ReturnType<Result.Result.Success<ReturnType<typeof prepareScalarRepository>>["bind"]>) {
  return Effect.fn("InventoryDeletion.findItems")(function* (ctx: CommerceCommandContext, input: unknown, withCount: boolean) {
    const query = yield* Effect.fromResult(decodeQuery(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
    const fields = query.options?.fields, computed = fields?.includes("reserved_quantity") ?? false;
    if (computed && !fields?.includes("id")) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const physical = fields?.filter(field => field !== "reserved_quantity");
    const result = yield* bound.find(ctx, { ...query, ...(query.options === undefined ? {} : { options: { ...query.options,
      ...(physical === undefined ? {} : { fields: physical }) } }) }, withCount);
    const rows = yield* Effect.fromResult(decodeRows([...result.rows]));
    if (!computed) return result;
    const store = yield* ctx.table("inventory_level"), output: JsonObject[] = [];
    for (const row of rows) {
      if (typeof row.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
      const levels = yield* store.find(ctx.manager, { fields: ["id", "inventory_item_id", "deleted_at", "reserved_quantity", "raw_reserved_quantity"],
        predicate: { kind: "and", children: [{ kind: "in", column: "inventory_item_id", values: [row.id] }, { kind: "isNull", column: "deleted_at" }] },
        take: ctx.resources.queryRows, order: { column: "id", direction: "asc" } });
      if (levels.some(level => level.inventory_item_id !== row.id || level.deleted_at !== null)) return yield* Effect.fail(commerceError("storedCorruption"));
      const projected = { ...row, reserved_quantity: yield* inventoryItemReservedQuantity(levels) };
      output.push(Object.fromEntries(Object.entries(projected).filter(([key]) => fields?.includes(key))));
    }
    return { ...result, rows: output };
  });
}

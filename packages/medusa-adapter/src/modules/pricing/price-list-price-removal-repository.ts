import { Effect, Result } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { populateCommerceRelations, type CommerceRelationReadContext } from "../../query/relations";
import { resolveCommerceRelationFilter } from "../../query/relation-filter";
import { projectNativeRow } from "../../repository/result";
import { projectExactNumericColumns } from "../../value/exact-numeric";
import type { PriceListPriceRemovalContracts } from "./price-list-price-removal-input";

/** Original 157 listPrices SQL INNER JOINs active PriceSets and LEFT JOINs
 * active PriceLists. Shared indexed relation owners preserve those distinct
 * joins; no candidate selection or ordering occurs in JS. */
export const readPriceListPriceRemovalRows = Effect.fn("PricingLists.readPriceRemovalRows")(function* (
  ctx: CommerceCommandContext, contracts: PriceListPriceRemovalContracts, input: unknown,
) {
  const plan = yield* Effect.fromResult(contracts.compileNativeReadPlan(input));
  const admitSelection: NonNullable<CommerceRelationReadContext["admitSelection"]> = (table, rows) => Result.gen(function* () {
    for (const inputRow of rows) {
      const row = projectNativeRow(inputRow);
      if (table === contracts.tables.price.name) yield* contracts.decodePriceRow(row);
      else if (table === contracts.tables.list.name) yield* contracts.decodeListRow(row);
      else if (table === contracts.tables.set.name) yield* contracts.decodeSetRow(row);
      else return yield* Result.fail(commerceError("unsupportedProfile"));
      if (row.deleted_at !== null) return yield* Result.fail(commerceError("storedCorruption"));
    }
  });
  const readContext = { ...ctx, admitSelection };
  const store = yield* ctx.table(contracts.tables.price.name);
  const selected = yield* store.find(ctx.manager, plan.rootQuery());
  if (selected.length === 0) return [];
  const setIds: string[] = [];
  for (const inputRow of selected) {
    const row = yield* Effect.fromResult(contracts.decodePriceRow(projectNativeRow(inputRow)));
    if (row.deleted_at !== null || typeof row.price_set_id !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
    setIds.push(row.price_set_id);
  }
  const membership = yield* resolveCommerceRelationFilter(readContext, contracts.tables.price.name, "price_set",
    plan.setPredicate(setIds), contracts.relations);
  const roots: JsonObject[] = [];
  const matched = yield* store.find(ctx.manager, plan.rootQuery(membership));
  yield* Effect.fromResult(admitSelection(contracts.tables.price.name, matched));
  for (const row of matched) roots.push(projectNativeRow(row));
  const populated = yield* populateCommerceRelations(readContext, contracts.tables.price.name, roots,
    ["price_set", "price_list"], contracts.relations, new Map());
  const values: JsonObject[] = [];
  for (const inputRow of populated) {
    const { price_set, price_list, ...scalar } = inputRow;
    if (price_set === undefined || !isJsonObject(price_set) || typeof price_set.id !== "string" ||
      price_list === undefined || !(price_list === null || isJsonObject(price_list)))
      return yield* ctx.refuse(commerceError("storedCorruption"));
    // MikroORM's filtered nullable relation masks its public scalar FK too.
    values.push({ ...scalar, price_set: { id: price_set.id }, price_list: price_list === null ? null : projectNativeRow(price_list),
      ...(price_list === null ? { price_list_id: null } : {}) });
  }
  const projected = yield* projectExactNumericColumns(values, contracts.tables.price.columns.filter(column => column.type === "bigNumber"));
  const output = yield* Effect.fromResult(contracts.decodeReadOutput(projected));
  return structuredClone(output);
});

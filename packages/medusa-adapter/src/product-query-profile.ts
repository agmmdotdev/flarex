import { Effect } from "effect";
import { productRelations, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";

const hasOnlyKeys = (value: JsonObject, allowed: readonly string[]) =>
  Object.keys(value).every(key => allowed.includes(key));
const selectedStrings = (value: Json, allowed: readonly string[]): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === "string" && allowed.includes(item));

/** Capability policy for the private Product profile, after Medusa buildQuery.
 * This admits a subset of DAL options; it is not a replacement query builder. */
export const decodeProductQuery = Effect.fn("ProductAdapter.decodeQuery")(function* (
  catalog: ProductRuntimeMetadata, input: unknown,
) {
  const value = yield* Effect.fromResult(captureCommerceInput(input));
  if (!isJsonObject(value) || !hasOnlyKeys(value, ["where", "options"])) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const where = value.where ?? {};
  const options = value.options ?? {};
  if (!isJsonObject(where) || !isJsonObject(options) ||
      !hasOnlyKeys(options, ["fields", "populate", "limit", "offset", "orderBy"])) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const relations = options.populate ?? [];
  if (!selectedStrings(relations, productRelations)) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const scalarFields = catalog.product.table.columns.map(column => column.name);
  const selected = options.fields ?? scalarFields;
  if (!selectedStrings(selected, scalarFields) || selected.length === 0) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const skip = options.offset ?? 0;
  const take = options.limit ?? 15;
  if (typeof skip !== "number" || !Number.isSafeInteger(skip) || skip < 0 || skip > 255 ||
      typeof take !== "number" || !Number.isSafeInteger(take) || take < 0 || take > 256) {
    return yield* Effect.fail(commerceError("limitExceeded"));
  }
  const order = options.orderBy ?? { id: "ASC" };
  if (!isJsonObject(order) || !hasOnlyKeys(order, ["id", "handle", "images"])) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  if (order.images !== undefined && (!isJsonObject(order.images) ||
      Object.keys(order.images).length !== 1 || order.images.rank !== "ASC")) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const orders = Object.entries(order).filter(([key]) => key !== "images");
  if (orders.length > 1 || orders.some(([, direction]) => direction !== "ASC" && direction !== "DESC")) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const ordered = orders[0];
  const predicates: Json[] = [{ kind: "isNull", column: "deleted_at" }];
  for (const [column, filter] of Object.entries(where)) {
    if (!["id", "handle"].includes(column)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const values = Array.isArray(filter) ? filter : [filter];
    if (values.length > 256 || values.some(member => typeof member !== "string")) {
      return yield* Effect.fail(commerceError("invalidInput"));
    }
    predicates.push({ kind: "in", column, values });
  }
  return {
    // Preserve the previous loader order so overlapping paths share their
    // complete option-value read regardless of the caller's path order.
    selected, relations: productRelations.filter(path => relations.includes(path)),
    query: {
      fields: [...new Set([...selected, "id"])], skip, take,
      order: { column: ordered?.[0] ?? "id", direction: ordered?.[1] === "DESC" ? "desc" : "asc" },
      predicate: { kind: "and", children: predicates },
    } satisfies JsonObject,
  };
});

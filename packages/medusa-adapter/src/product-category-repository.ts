import { Effect, Schema } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { QueryEnvelope, QueryOffset } from "./query-decoder";
import { readCommerceRelationRows } from "./commerce-relations";
import { compileProjection } from "./query/projection";
import { categoryReadProjection } from "./product-read-profile";
import { executeRead, type CatalogSelection } from "./query/read";
import { valuePredicate } from "./query/predicate";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256))])),
  name: Schema.optionalKey(Schema.String), handle: Schema.optionalKey(Schema.String),
  parent_category_id: Schema.optionalKey(Schema.NullOr(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256))]))),
  is_internal: Schema.optionalKey(Schema.Boolean), is_active: Schema.optionalKey(Schema.Boolean),
}), "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), populate: Schema.optionalKey(Schema.Array(Schema.String)),
  limit: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 256 }))), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])), rank: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  disableIdentityMap: Schema.optionalKey(Schema.Literal(true)),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Literal(false) }) })),
}), "unsupportedProfile");
const decodePrepared = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(256)), "invalidInput");
const decodeRefs = commerceDecoder(Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(256)), "invalidInput");
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.Struct({ id: Id }), update: Schema.JsonObject })).check(Schema.isMaxLength(256)), "invalidInput");
const decodeRank = commerceDecoder(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), "invalidInput");

/** The original service owns tree hydration. Its repository reads a complete,
 * scoped and bounded catalog before applying pagination and field projection. */
export const findCategoryRows = Effect.fn("ProductCategory.find")(function* (ctx: CommerceCommandContext, metadata: ProductRuntimeMetadata, input: unknown) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
  const where = yield* Effect.fromResult(decodeWhere(envelope.where ?? {}));
  const options = yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
  // The pinned service hydrates these exact tree hints after the DAL read.
  const relations = (options.populate ?? []).filter(path => path !== "parent_category" && path !== "category_children");
  if (relations.some(path => path !== "products")) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const projection = yield* Effect.fromResult(compileProjection(metadata.readCatalog, metadata.category.table.name, options.fields, relations, categoryReadProjection));
  const children: Json[] = [{ kind: "isNull", column: "deleted_at" }];
  for (const [column, value] of Object.entries(where)) children.push(valuePredicate(column, value));
  const select = (all: readonly JsonObject[]): CatalogSelection => {
    const order = Object.entries(options.orderBy ?? { id: "ASC", rank: "ASC" });
    const sorted = [...all].sort((a, b) => {
      for (const [column, direction] of order) {
        const left = a[column], right = b[column];
        const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
        if (compared) return direction === "DESC" ? -compared : compared;
      }
      return 0;
    });
    const start = options.offset ?? 0;
    return { rows: sorted.slice(start, options.limit === undefined ? undefined : start + options.limit), count: all.length };
  };
  const result = yield* executeRead(ctx, metadata.readCatalog, {
    table: metadata.category.table.name, query: { predicate: { kind: "and", children } },
    projection, paths: relations, withDeleted: false, relationFilters: [], ordering: new Map(),
    window: { kind: "catalog", order: "id", select },
  }, true);
  if (result.count === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
  return { rows: result.rows, count: result.count };
});

export const insertCategoryRows = Effect.fn("ProductCategory.insert")(function* (ctx: CommerceCommandContext, metadata: ProductRuntimeMetadata, input: unknown) {
  const prepared = yield* Effect.fromResult(captureCommerceInput(input)).pipe(Effect.flatMap(value => Effect.fromResult(decodePrepared(value))));
  const store = yield* ctx.table(metadata.category.table.name);
  const result: JsonObject[] = [];
  const reranked: JsonObject[] = [];
  for (const inputRow of prepared) {
    const decoded = yield* Effect.fromResult(metadata.valueProfile.decodeRow(metadata.category.table.name, inputRow));
    const { products, ...row } = decoded.supplied;
    if (typeof row.id !== "string" || typeof row.mpath !== "string") return yield* Effect.fail(commerceError("invalidInput"));
    const rank = yield* Effect.fromResult(decodeRank(row.rank));
    // Pinned Category repository insertion shifts existing siblings at/after rank.
    const siblings = yield* readCommerceRelationRows(ctx, metadata.category.table.name, { kind: "and", children: [
      { kind: "isNull", column: "deleted_at" }, row.parent_category_id == null ? { kind: "isNull", column: "parent_category_id" } : { kind: "in", column: "parent_category_id", values: [row.parent_category_id] },
    ] });
    const shifted: JsonObject[] = [];
    for (const sibling of siblings) {
      if (typeof sibling.rank !== "number" || typeof sibling.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
      if (sibling.rank >= rank) shifted.push({ id: sibling.id, rank: sibling.rank + 1 });
    }
    if (shifted.length) reranked.push(...yield* store.write(ctx.manager, "update", shifted));
    result.push(...yield* store.write(ctx.manager, "insert", [row]));
    if (products !== undefined) {
      const refs = yield* Effect.fromResult(decodeRefs(products));
      if (new Set(refs.map(ref => ref.id)).size !== refs.length) return yield* Effect.fail(commerceError("invalidInput"));
      const relation = metadata.queryRelations.get(metadata.category.table.name)?.get("products");
      if (relation?.join.type !== "manyToMany" || relation.join.sourceColumns.length !== 1 || relation.join.targetColumns.length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const source = relation.join.sourceColumns[0], target = relation.join.targetColumns[0];
      if (source === undefined || target === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      if (refs.length) yield* (yield* ctx.table(relation.join.pivotTable)).write(ctx.manager, "insert", refs.map(ref => ({ [source]: row.id, [target]: ref.id })));
    }
  }
  return { rows: result, reranked };
});

/** Only service-prepared updates may carry mpath; external commands cannot. */
export const updateCategoryRows = Effect.fn("ProductCategory.update")(function* (ctx: CommerceCommandContext, metadata: ProductRuntimeMetadata, input: unknown) {
  const pairs = yield* Effect.fromResult(captureCommerceInput(input)).pipe(Effect.flatMap(value => Effect.fromResult(decodePairs(value))));
  const rows: JsonObject[] = [];
  for (const pair of pairs) {
    const { mpath, ...external } = pair.update;
    yield* Effect.fromResult(metadata.valueProfile.validateRelatedUpdateData(metadata.category.table.name, external));
    if (mpath !== undefined && typeof mpath !== "string") return yield* Effect.fail(commerceError("invalidInput"));
    if (pair.update.rank !== undefined) yield* Effect.fromResult(decodeRank(pair.update.rank));
    rows.push({ ...pair.update, id: pair.entity.id });
  }
  return yield* (yield* ctx.table(metadata.category.table.name)).write(ctx.manager, "update", rows);
});

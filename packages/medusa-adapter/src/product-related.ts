import { Effect, Schema } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { captureCommerceInput } from "./commerce-input";
import { commerceDecoder } from "./commerce-decoder";
import { QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";
import { decodeGraphArray } from "./product-value-profile";
import { readCommerceRelationRows, populateCommerceRelations } from "./commerce-relations";
import { productInverseProjection, projectProductInverseRows } from "./product-inverse-query";
import { productParentProjection, projectProductParentRows } from "./product-parent-query";
import { projectRowFields } from "@medusajs/drizzle/relation-query";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
const decodeNamedValue = commerceDecoder(Schema.String, "unsupportedProfile");
const decodeFilter = commerceDecoder(Schema.Union([Schema.Null, Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))]), "unsupportedProfile");
const decodeOr = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.String })).check(Schema.isMinLength(1), Schema.isMaxLength(256)), "unsupportedProfile");
const decodeAssignmentPairs = commerceDecoder(Schema.Array(Schema.Struct({ variant_id: Schema.String, image_id: Schema.String })).check(Schema.isMaxLength(256)), "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  populate: Schema.optionalKey(Schema.Array(Schema.String)),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  filters: Schema.optionalKey(Schema.Struct({ softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }) })),
}), "unsupportedProfile");

/** Internal service reads share the command's manager; this is no public DAL. */
export const findProductRelated = Effect.fn("ProductAdapter.findRelated")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table" | "resources">, metadata: ProductRuntimeMetadata, entity: ProductEntityMetadata, input: unknown, withCount: boolean,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
  const where = yield* Effect.fromResult(decodeWhere(envelope.where ?? {}));
  const options = yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
  const relations = options.populate ?? [];
  const inverseProjection = (entity === metadata.tag || entity === metadata.collection) ? yield* productInverseProjection(metadata, entity === metadata.tag ? "tag" : "collection", options.fields, relations) : undefined;
  const parentProjection = entity === metadata.option || entity === metadata.variant ? yield* productParentProjection(metadata, entity === metadata.option ? "option" : "variant", options.fields, relations) : undefined;
  // Pinned Type projections retain primary keys even when select omits them.
  const fields = inverseProjection?.rootFields ?? parentProjection?.rootFields ?? (options.fields === undefined ? entity.table.columns.map(column => column.name)
    : entity === metadata.type ? [...new Set([...entity.table.columns.filter(column => column.primaryKey).map(column => column.name), ...options.fields])]
      : options.fields);
  if (fields.some(name => !entity.table.columns.some(column => column.name === name))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  if (inverseProjection === undefined && parentProjection === undefined && relations.some(name => !metadata.queryRelations.get(entity.table.name)?.has(name))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const withDeleted = options.filters?.softDeletable.withDeleted ?? false;
  const children: Json[] = !withDeleted && entity.table.columns.some(column => column.name === "deleted_at") ? [{ kind: "isNull", column: "deleted_at" }] : [];
  for (const [name, value] of Object.entries(where)) {
    if (((entity === metadata.type || entity === metadata.tag) && name === "value" || entity === metadata.collection && (name === "title" || name === "handle") || (entity === metadata.option || entity === metadata.variant) && name === "title") && entity.table.columns.some(column => column.name === name)) {
      const text = yield* Effect.fromResult(decodeNamedValue(value));
      children.push({ kind: "in", column: name, values: [text] });
      continue;
    }
    if (name === "$or") {
      if (entity === metadata.assignment) {
        const pairs = yield* Effect.fromResult(decodeAssignmentPairs(value));
        children.push({ kind: "or", children: pairs.map(pair => ({ kind: "and", children: Object.entries(pair).map(([column, value]) => ({ kind: "in", column, values: [value] })) })) });
        continue;
      }
      const selectors = yield* Effect.fromResult(decodeOr(value));
      children.push({ kind: "in", column: "id", values: [...new Set(selectors.map(selector => selector.id))] });
      continue;
    }
    if (name !== "id" && !entity.table.foreignKeys.some(key => key.columns.includes(name))) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const filter = yield* Effect.fromResult(decodeFilter(value));
    children.push(filter === null ? { kind: "isNull", column: name } : { kind: "in", column: name, values: typeof filter === "string" ? [filter] : filter });
  }
  const query = { fields, take: options.limit ?? 15, skip: options.offset ?? 0,
    order: { column: "id", direction: options.orderBy?.id === "DESC" ? "desc" : "asc" },
    predicate: { kind: "and", children },
  } satisfies JsonObject;
  const project = Effect.fn("ProductAdapter.projectRelated")(function* (rows: readonly JsonObject[]) {
    if (inverseProjection !== undefined) return yield* projectProductInverseRows(rows, inverseProjection, relations.length > 0);
    if (parentProjection !== undefined) return yield* projectProductParentRows(rows, parentProjection);
    const selected = new Set([...fields, ...relations]);
    return rows.map(row => projectRowFields(row, selected));
  });
  if (options.limit === undefined && options.offset === undefined) {
    const complete = yield* readCommerceRelationRows(ctx, entity.table.name, query.predicate);
    const ordered = options.orderBy?.id === "DESC" ? [...complete].reverse() : complete;
    const populated = yield* populateCommerceRelations(ctx, entity.table.name, ordered, relations, metadata.queryRelations, new Map(), withDeleted);
    return { rows: yield* project(populated), count: withCount ? complete.length : undefined };
  }
  const store = yield* ctx.table(entity.table.name);
  const rows = yield* store.find(ctx.manager, { ...query, fields: [...new Set([...fields, "id"])] });
  const populated = yield* populateCommerceRelations(ctx, entity.table.name, rows, relations, metadata.queryRelations, new Map(), withDeleted);
  return { rows: yield* project(populated), count: withCount ? yield* store.count(ctx.manager, query) : undefined };
});

export const updateProductRelated = Effect.fn("ProductAdapter.updateRelated")(function* (
  ctx: CommerceCommandContext, metadata: ProductRuntimeMetadata, entity: ProductEntityMetadata, input: unknown,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const rows = yield* Effect.fromResult(metadata.valueProfile.decodeRelatedUpdatePairs(entity.table.name, captured));
  const store = yield* ctx.table(entity.table.name);
  return yield* store.write(ctx.manager, "update", rows);
});

export const insertProductRelated = Effect.fn("ProductAdapter.insertRelated")(function* (
  ctx: CommerceCommandContext, metadata: ProductRuntimeMetadata, entity: ProductEntityMetadata, input: unknown,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const supplied = yield* Effect.fromResult(decodeGraphArray(captured));
  yield* Effect.fromResult(metadata.valueProfile.validateRelatedCreate(entity.table.name, supplied));
  const rows: JsonObject[] = [];
  for (const value of supplied) {
    const row = yield* Effect.fromResult(metadata.valueProfile.decodeRow(entity.table.name, value));
    const id = generateEntityId(row.id, entity.prefix);
    rows.push({ ...row.supplied, id });
  }
  const store = yield* ctx.table(entity.table.name);
  // Insert, never upsert: existing IDs and late FK/unique failures roll back.
  return yield* store.write(ctx.manager, "insert", rows);
});

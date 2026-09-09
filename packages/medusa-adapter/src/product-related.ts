import { Effect, Schema } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { captureCommerceInput } from "./commerce-input";
import { commerceDecoder } from "./commerce-decoder";
import { QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";
import { decodeGraphArray } from "./product-value-profile";
import { compileProjection } from "./query/projection";
import { compileWhere } from "./query/predicate";
import { executeRead, orderedCatalog } from "./query/read";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeRelatedWhere = commerceDecoder(Schema.JsonObject, "unsupportedProfile");
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
  // Retain the entry's structural validation order before compiling capabilities.
  const where = yield* Effect.fromResult(decodeRelatedWhere(envelope.where ?? {}));
  const options = yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
  const relations = options.populate ?? [];
  const profile = metadata.relatedReads.get(entity.table.name);
  if (profile === undefined || relations.some(path => !profile.paths.includes(path))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const projection = yield* Effect.fromResult(compileProjection(metadata.readCatalog, entity.table.name, options.fields, relations, profile.projection));
  const withDeleted = options.filters?.softDeletable.withDeleted ?? false;
  const decoded = yield* Effect.fromResult(compileWhere(where, profile.where));
  const children: Json[] = !withDeleted && entity.table.columns.some(column => column.name === "deleted_at")
    ? [{ kind: "isNull", column: "deleted_at" }] : [];
  if (decoded.kind === "and") children.push(...decoded.children);
  else children.push(decoded);
  const direction = options.orderBy?.id === "DESC" ? "desc" : "asc";
  return yield* executeRead(ctx, metadata.readCatalog, {
    table: entity.table.name, projection, paths: relations, withDeleted, relationFilters: [], ordering: new Map(),
    query: { fields: projection.storageFields, take: options.limit ?? 15, skip: options.offset ?? 0,
      order: { column: "id", direction }, predicate: { kind: "and", children } },
    window: options.limit === undefined && options.offset === undefined
      ? { kind: "catalog", order: "id", select: orderedCatalog(direction) }
      : { kind: "database", countAt: "afterPopulation" },
  }, withCount);
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

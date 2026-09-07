import { Effect, Schema } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { captureCommerceInput } from "./commerce-input";
import { commerceDecoder } from "./commerce-decoder";
import { QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";
import { decodeGraphArray } from "./product-value-profile";
import { readCommerceRelationRows } from "./commerce-relations";
import { projectRowFields } from "@medusajs/drizzle/relation-query";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.Struct({ id: Schema.optionalKey(Schema.Union([
  Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256)),
])) }), "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  populate: Schema.optionalKey(Schema.Array(Schema.Never)),
  limit: Schema.optionalKey(QueryLimit), offset: Schema.optionalKey(QueryOffset),
  orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
}), "unsupportedProfile");
export const decodeCollectionReplacement = commerceDecoder(Schema.Struct({ relations: Schema.Tuple([Schema.Literal("products")]) }), "unsupportedProfile");

/** Internal service reads share the command's manager; this is no public DAL. */
export const findProductRelated = Effect.fn("ProductAdapter.findRelated")(function* (
  ctx: CommerceCommandContext, entity: ProductEntityMetadata, input: unknown, withCount: boolean,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const envelope = yield* Effect.fromResult(decodeEnvelope(captured));
  const where = yield* Effect.fromResult(decodeWhere(envelope.where ?? {}));
  const options = yield* Effect.fromResult(decodeOptions(envelope.options ?? {}));
  const fields = options.fields ?? entity.table.columns.map(column => column.name);
  if (fields.some(name => !entity.table.columns.some(column => column.name === name))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const query = { fields, take: options.limit ?? 15, skip: options.offset ?? 0,
    order: { column: "id", direction: options.orderBy?.id === "DESC" ? "desc" : "asc" },
    predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" },
      ...(where.id === undefined ? [] : [{ kind: "in", column: "id", values: typeof where.id === "string" ? [where.id] : where.id }]) ] },
  } satisfies JsonObject;
  if (options.limit === undefined && options.offset === undefined) {
    const complete = yield* readCommerceRelationRows(ctx, entity.table.name, query.predicate);
    const ordered = options.orderBy?.id === "DESC" ? [...complete].reverse() : complete;
    const selected = new Set(fields);
    return { rows: ordered.map(row => projectRowFields(row, selected)), count: withCount ? complete.length : undefined };
  }
  const store = yield* ctx.table(entity.table.name);
  return { rows: yield* store.find(ctx.manager, query), count: withCount ? yield* store.count(ctx.manager, query) : undefined };
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
    rows.push({ ...row.supplied, id: generateEntityId(row.id, entity.prefix) });
  }
  const store = yield* ctx.table(entity.table.name);
  // Insert, never upsert: existing IDs and late FK/unique failures roll back.
  return yield* store.write(ctx.manager, "insert", rows);
});

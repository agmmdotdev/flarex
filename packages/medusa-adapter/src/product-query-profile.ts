import { Effect, Schema } from "effect";
import { productRelations, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { queryDecoder, QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";

const decodeEnvelope = queryDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = queryDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile");
const decodeOptions = queryDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Unknown),
  populate: Schema.optionalKey(Schema.Unknown),
  limit: Schema.optionalKey(Schema.Unknown),
  offset: Schema.optionalKey(Schema.Unknown),
  orderBy: Schema.optionalKey(Schema.Unknown),
}), "unsupportedProfile");
const decodeRelations = queryDecoder(Schema.Array(Schema.Literals(productRelations)), "unsupportedProfile");
const decodeFields = queryDecoder(Schema.Array(Schema.String).check(Schema.isMinLength(1)), "unsupportedProfile");
const decodeOffset = queryDecoder(QueryOffset, "limitExceeded");
const decodeLimit = queryDecoder(QueryLimit, "limitExceeded");
const Direction = Schema.Literals(["ASC", "DESC"]);
const decodeOrder = queryDecoder(Schema.Struct({
  id: Schema.optionalKey(Direction),
  handle: Schema.optionalKey(Direction),
  images: Schema.optionalKey(Schema.Struct({ rank: Schema.Literal("ASC") })),
}).check(Schema.makeFilter(order => order.id === undefined || order.handle === undefined)), "unsupportedProfile");
const decodeColumn = queryDecoder(Schema.Literals(["id", "handle"]), "unsupportedProfile");
const decodeFilter = queryDecoder(Schema.Union([
  Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256)),
]), "invalidInput");

/** Decode in the existing profile order so malformed input, unsupported
 * capabilities and bounds retain their distinct first failure. */
export const decodeProductQuery = Effect.fn("ProductAdapter.decodeQuery")(function* (
  catalog: ProductRuntimeMetadata, input: unknown,
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const value = yield* Effect.fromResult(decodeEnvelope(captured));
  const where = yield* Effect.fromResult(decodeWhere(value.where ?? {}));
  const options = yield* Effect.fromResult(decodeOptions(value.options ?? {}));
  const relations = yield* Effect.fromResult(decodeRelations(options.populate ?? []));
  const scalarFields = catalog.product.table.columns.map(column => column.name);
  const selected = yield* Effect.fromResult(decodeFields(options.fields ?? scalarFields));
  if (selected.some(field => !scalarFields.includes(field))) {
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const skip = yield* Effect.fromResult(decodeOffset(options.offset ?? 0));
  const take = yield* Effect.fromResult(decodeLimit(options.limit ?? 15));
  const order = yield* Effect.fromResult(decodeOrder(options.orderBy ?? { id: "ASC" }));
  const predicates: Json[] = [{ kind: "isNull", column: "deleted_at" }];
  for (const [key, inputFilter] of Object.entries(where)) {
    const column = yield* Effect.fromResult(decodeColumn(key));
    const filter = yield* Effect.fromResult(decodeFilter(inputFilter));
    predicates.push({ kind: "in", column, values: typeof filter === "string" ? [filter] : filter });
  }
  return {
    // Canonical path order lets overlapping paths share their option-value read.
    selected, relations: productRelations.filter(path => relations.includes(path)),
    query: {
      fields: [...new Set([...selected, "id"])], skip, take,
      order: { column: order.handle === undefined ? "id" : "handle", direction: (order.id ?? order.handle) === "DESC" ? "desc" : "asc" },
      predicate: { kind: "and", children: predicates },
    } satisfies JsonObject,
  };
});

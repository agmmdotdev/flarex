import { Result, Schema } from "effect";
import { compileProjection } from "./query/projection";
import { valuePredicate } from "./query/predicate";
import { publicProductProjection, internalProductProjection } from "./product-read-profile";
import { productRelations, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";
import { commerceDecoder } from "./commerce-decoder";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.Record(Schema.String, Schema.Unknown), "unsupportedProfile");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Unknown),
  populate: Schema.optionalKey(Schema.Unknown),
  limit: Schema.optionalKey(Schema.Unknown),
  offset: Schema.optionalKey(Schema.Unknown),
  orderBy: Schema.optionalKey(Schema.Unknown),
  filters: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
}), "unsupportedProfile");
const decodeSoftDelete = commerceDecoder(Schema.Struct({ withDeleted: Schema.Boolean }), "unsupportedProfile");
const decodeSearch = commerceDecoder(Schema.Struct({ value: Schema.String, fromEntity: Schema.String }), "unsupportedProfile");
const decodePrimaryOr = commerceDecoder(Schema.Array(Schema.Struct({ id: Schema.optionalKey(Schema.String) })).check(Schema.isMaxLength(256)), "unsupportedProfile");
const decodeRelations = commerceDecoder(Schema.Array(Schema.Literals([...productRelations, "*", "variants.images"])), "unsupportedProfile");
const decodeFields = commerceDecoder(Schema.Array(Schema.String).check(Schema.isMinLength(1)), "unsupportedProfile");
const decodeOffset = commerceDecoder(QueryOffset, "limitExceeded");
const decodeLimit = commerceDecoder(QueryLimit, "limitExceeded");
const Direction = Schema.Literals(["ASC", "DESC"]);
const decodeOrder = commerceDecoder(Schema.Struct({
  id: Schema.optionalKey(Direction),
  handle: Schema.optionalKey(Direction),
  images: Schema.optionalKey(Schema.Struct({ rank: Schema.Literal("ASC") })),
}).check(Schema.makeFilter(order => order.id === undefined || order.handle === undefined)), "unsupportedProfile");
const decodeColumn = commerceDecoder(Schema.Literals(["id", "handle", "collection_id", "type_id"]), "unsupportedProfile");
const decodeFilter = commerceDecoder(Schema.Union([
  Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256)),
]), "invalidInput");
const Filter = Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))]);
const decodeVariants = commerceDecoder(Schema.Struct({ options: Schema.Struct({
  option_id: Schema.optionalKey(Filter), value: Schema.optionalKey(Filter),
}) }), "unsupportedProfile");
const decodeCategories = commerceDecoder(Schema.Struct({ id: Filter }), "unsupportedProfile");
const decodeDeletedComparison = commerceDecoder(Schema.Struct({ $gt: Schema.String }), "unsupportedProfile");
// The pinned Drizzle parameter conversion uses JavaScript Date parsing. Keep
// that foreign string convention here; core accepts canonical UTC instants only.
const deletedInstant = (value: string) => Result.try({ try: () => new Date(value).toISOString(), catch: cause => commerceError("invalidInput", cause) });

/** Decode in the existing profile order so malformed input, unsupported
 * capabilities and bounds retain their distinct first failure. */
export function decodeProductQuery(
  catalog: ProductRuntimeMetadata, input: unknown, internalProduct = false,
) {
  return Result.gen(function* () {
    const captured = yield* captureCommerceInput(input);
    const value = yield* decodeEnvelope(captured);
    const where = yield* decodeWhere(value.where ?? {});
    const options = yield* decodeOptions(value.options ?? {});
    const requested = yield* decodeRelations(options.populate ?? []);
    // The unchanged Product service builds variants.images from the explicit
    // assignment entity after this DAL query. Admit its two prerequisite reads.
    const relations = requested.includes("*") ? [...productRelations]
      : [...requested.filter(name => name !== "variants.images"), ...(requested.includes("variants.images") ? ["variants", "images"] : [])];
    const scalarFields = catalog.product.table.columns.map(column => column.name);
    const selected = yield* decodeFields(options.fields ?? scalarFields);
    const projection = yield* compileProjection(catalog.readCatalog, catalog.product.table.name, selected, relations,
      internalProduct ? internalProductProjection : publicProductProjection);
    const skip = yield* decodeOffset(options.offset ?? 0);
    const take = yield* decodeLimit(options.limit ?? (internalProduct ? 256 : 15));
    const order = yield* decodeOrder(options.orderBy ?? { id: "ASC" });
    const optionFilters = options.filters ?? {};
    const withDeleted = optionFilters.softDeletable === undefined ? false
      : (yield* decodeSoftDelete(optionFilters.softDeletable)).withDeleted;
    const predicates: Json[] = withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }];
    let searched = false;
    for (const [name, filter] of Object.entries(optionFilters)) {
      if (name === "softDeletable") continue;
      if (!name.startsWith("freeTextSearch_") || searched) return yield* Result.fail(commerceError("unsupportedProfile"));
      const search = yield* decodeSearch(filter);
      if (search.fromEntity !== catalog.product.model) return yield* Result.fail(commerceError("unsupportedProfile"));
      searched = true;
      predicates.push({ kind: "or", children: catalog.searchableProductColumns.map(column => ({
        kind: "textLikeAscii", column, pattern: "%" + search.value + "%",
      })) });
    }
    const relationFilters: { path: string; predicate: Json }[] = [];
    for (const [key, inputFilter] of Object.entries(where)) {
      if (key === "$or" && internalProduct) {
        const members = yield* decodePrimaryOr(inputFilter);
        predicates.push({ kind: "or", children: members.map(member => ({
          kind: "in", column: "id", values: member.id === undefined ? [] : [member.id],
        })) });
        continue;
      }
      if (key === "deleted_at") {
        const comparison = yield* decodeDeletedComparison(inputFilter);
        predicates.push({ kind: "greaterThan", column: "deleted_at", value: yield* deletedInstant(comparison.$gt) });
        continue;
      }
      if (key === "variants" || key === "categories") {
        const values = key === "variants"
          ? (yield* decodeVariants(inputFilter)).options
          : yield* decodeCategories(inputFilter);
        relationFilters.push({ path: key === "variants" ? "variants.options" : "categories", predicate: {
          kind: "and", children: [...(withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }]), ...Object.entries(values).map(([column, value]) => ({
            kind: "in", column, values: typeof value === "string" ? [value] : value,
          }))],
        } });
        continue;
      }
      const column = yield* decodeColumn(key);
      const filter = yield* decodeFilter(inputFilter);
      predicates.push(valuePredicate(column, filter));
    }
    return {
      // Canonical path order lets overlapping paths share their option-value read.
      projection, selected, relationFilters, withDeleted, relations: productRelations.filter(path => relations.includes(path)),
      query: {
        fields: projection.storageFields, skip, take,
        order: { column: order.handle === undefined ? "id" : "handle", direction: (order.id ?? order.handle) === "DESC" ? "desc" : "asc" },
        predicate: { kind: "and", children: predicates },
      } satisfies JsonObject,
    };
  });
}

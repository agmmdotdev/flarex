import { Result, Schema, type Effect } from "effect";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import type { capturePricingMetadata } from "./schema";
import { PricePreferencesInput, PricingId } from "./input";
import { NativePreimageConfig } from "../../workflow/preimage";
import { compileWhere, valuePredicate, type Predicate, type WherePolicy } from "../../query/predicate";
import { jsonEqual } from "flarex-protocol/json";

const Text = Schema.String.check(Schema.isLengthBetween(1, 256));
export const StorePreferencePair = Schema.Struct({ attribute: Text, value: Text });
export const StorePreferenceFilters = Schema.Struct({ $or: Schema.Array(StorePreferencePair).pipe(Schema.mutable).check(Schema.isMaxLength(4)) });
const Create = Schema.Struct({ attribute: Text, value: Text, is_tax_inclusive: Schema.optionalKey(Schema.Boolean) });
const Update = Schema.Struct({ id: PricingId, attribute: Schema.optionalKey(Text),
  value: Schema.optionalKey(Schema.NullOr(Text)), is_tax_inclusive: Schema.optionalKey(Schema.Boolean) });
const Previous = Schema.Struct({ id: PricingId, attribute: Text, value: Schema.NullOr(Text), is_tax_inclusive: Schema.Boolean,
  created_at: Schema.String, updated_at: Schema.String, deleted_at: Schema.NullOr(Schema.String) });
export const StorePreferenceUpserts = Schema.Array(Schema.Union([Create, Update, Previous])).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const PricePreferenceIds = Schema.Array(PricingId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
// Deletion selectors retain native raw strings, including an empty ID that
// matches no stored row. Stored identities and other profiles remain strict.
export const PricePreferenceDeletionIds = Schema.Array(Schema.String.check(Schema.isMaxLength(256)))
  .pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodePricePreferenceDeletionIds = commerceDecoder(PricePreferenceDeletionIds, "invalidInput");
export const decodePricePreferenceDeletionArguments = commerceDecoder(Schema.Tuple([PricePreferenceDeletionIds]), "invalidInput");
export const decodePricePreferenceDeletionOutput = commerceDecoder(Schema.Struct({
  price_preference_id: Schema.optionalKey(PricePreferenceIds),
}), "storedCorruption");
const decodeLifecycleTuple = commerceDecoder(Schema.Tuple([
  Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)),
  Schema.Struct({ PricePreference: Schema.optionalKey(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4))) }),
]), "storedCorruption");
export const decodeStorePreferenceFilters = commerceDecoder(StorePreferenceFilters, "invalidInput");
export const decodePricePreferenceIds = commerceDecoder(PricePreferenceIds, "invalidInput");
export const decodePricePreferenceCreates = commerceDecoder(PricePreferencesInput, "unsupportedProfile");
export const decodeStorePreferenceUpsertShape = commerceDecoder(StorePreferenceUpserts, "invalidInput");
export const decodePricePreferenceDeleteWhere = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: PricingId })).check(Schema.isMaxLength(4)) }), "unsupportedProfile");
export const decodeStorePreferenceFindWhere = commerceDecoder(Schema.Union([StorePreferenceFilters,
  Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: PricingId })).check(Schema.isMaxLength(4)) })]), "unsupportedProfile");
const decodeOutputShape = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeId = commerceDecoder(PricingId, "storedCorruption");

const QueryText = Schema.String.check(Schema.isMaxLength(256));
const Membership = Schema.Array(QueryText).check(Schema.isMaxLength(256));
const Comparison = Schema.Struct({
  $eq: Schema.optionalKey(Schema.NullOr(QueryText)), $ne: Schema.optionalKey(Schema.NullOr(QueryText)),
  $in: Schema.optionalKey(Membership), $nin: Schema.optionalKey(Membership),
  $gt: Schema.optionalKey(QueryText), $gte: Schema.optionalKey(QueryText),
  $lt: Schema.optionalKey(QueryText), $lte: Schema.optionalKey(QueryText),
  $like: Schema.optionalKey(QueryText), $ilike: Schema.optionalKey(QueryText),
  $re: Schema.optionalKey(QueryText), $fulltext: Schema.optionalKey(QueryText),
  $exists: Schema.optionalKey(Schema.Boolean),
});
const SelectorValue = Schema.Union([Schema.NullOr(QueryText), Membership, Comparison]);
const decodeSelectorValue = commerceDecoder(SelectorValue, "unsupportedProfile");
const isMembership = (value: typeof SelectorValue.Type): value is typeof Membership.Type => Array.isArray(value);
export const PricePreferenceUpdateSelector = Schema.JsonObject;
export const PricePreferenceUpdateData = Schema.Struct({
  attribute: Schema.optionalKey(Schema.NullOr(QueryText)), value: Schema.optionalKey(Schema.NullOr(QueryText)),
  is_tax_inclusive: Schema.optionalKey(Schema.Boolean),
});
export const PricePreferenceUpdateInput = Schema.Struct({ selector: PricePreferenceUpdateSelector, update: PricePreferenceUpdateData });
export const PricePreferenceUpdateListInput = Schema.Struct({ filters: PricePreferenceUpdateSelector, config: NativePreimageConfig });
export const PricePreferenceUpdateUpserts = Schema.Array(Schema.Struct({ id: PricingId,
  ...PricePreferenceUpdateData.fields })).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeUpdateInputShape = commerceDecoder(PricePreferenceUpdateInput, "invalidInput");
const decodeUpdateListShape = commerceDecoder(PricePreferenceUpdateListInput, "invalidInput");
export const decodePricePreferenceUpdateUpserts = commerceDecoder(PricePreferenceUpdateUpserts, "invalidInput");
const decodeSelector = commerceDecoder(PricePreferenceUpdateSelector, "unsupportedProfile");
const decodeBranches = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(128)), "unsupportedProfile");
const operators = [["$gt", "gt"], ["$gte", "gte"], ["$lt", "lt"], ["$lte", "lte"], ["$like", "like"], ["$ilike", "ilike"], ["$re", "regex"], ["$fulltext", "fulltext"]] as const;
function preferenceField(column: string) {
  return (input: unknown): Result.Result<Predicate, ReturnType<typeof commerceError>> => Result.gen(function* () {
    const value = yield* decodeSelectorValue(input);
    if (value === null || typeof value === "string") return valuePredicate(column, value);
    if (isMembership(value)) return valuePredicate(column, value);
    const comparison = value;
    const children: Predicate[] = [];
    if (comparison.$eq !== undefined) children.push(valuePredicate(column, comparison.$eq));
    if (comparison.$ne !== undefined) children.push(comparison.$ne === null
        ? { kind: "postgresText", column, operator: "exists", value: true }
        : { kind: "textNotEqual", column, value: comparison.$ne });
    if (comparison.$in !== undefined) children.push(valuePredicate(column, comparison.$in));
    if (comparison.$nin !== undefined) children.push({ kind: "postgresText", column, operator: "notIn", values: comparison.$nin });
    if (comparison.$exists !== undefined) children.push({ kind: "postgresText", column, operator: "exists", value: comparison.$exists });
    for (const [operator, mapped] of operators) {
      const operand = comparison[operator];
      if (operand !== undefined) children.push({ kind: "postgresText", column, operator: mapped, value: operand });
    }
    return { kind: "and", children };
  });
}
export const pricePreferenceUpdateWhere: WherePolicy = {
  decode: decodeSelector,
  fields: new Map(["id", "attribute", "value"].map(column => [column, {
    column, decodePredicate: preferenceField(column),
  }])),
  // Source traversal is an early guard. Shared admission still applies its
  // 64-node / depth-8 / 256-operand limits to the complete normalized tree,
  // including adapter AND wrappers and the active-row predicate.
  logical: { decodeBranches, nodes: 128, depth: 8, operands: 256, unwrapMembership: input => input, emptyLogical: "ignore" },
};
const decodePricePreferenceUpdateSelector = (selector: JsonObject) => compileWhere(selector, pricePreferenceUpdateWhere)
  .pipe(Result.map(() => selector));
export const decodePricePreferenceUpdate = (input: unknown) => Result.gen(function* () {
  const data = yield* decodeUpdateInputShape(input); yield* decodePricePreferenceUpdateSelector(data.selector); return data;
});
export const decodePricePreferenceUpdateList = (input: unknown) => Result.gen(function* () {
  const data = yield* decodeUpdateListShape(input);
  yield* decodePricePreferenceUpdateSelector(data.filters);
  if (data.config.select === undefined || data.config.select.some(field => !["id", "attribute", "value", "is_tax_inclusive"].includes(field)) ||
    (data.config.relations?.length ?? 0) !== 0) return yield* Result.fail(commerceError("unsupportedProfile"));
  return data;
});

/** Profile grammar follows the checked native table; raw preference values are
 * independent of Store's lowercased StoreCurrency values. */
export function compilePricePreferenceContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const table = metadata.tables.find(table => table.name === "price_preference");
    if (table === undefined || table.foreignKeys.length || table.relationships.length ||
      !table.columns.some(column => column.name === "attribute" && column.type === "text" && !column.nullable) ||
      !table.columns.some(column => column.name === "value" && column.type === "text" && column.nullable) ||
      !table.columns.some(column => column.name === "is_tax_inclusive" && column.type === "boolean" && !column.nullable))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table), projection = yield* compileRowProjection(table);
    const decodeRow = (input: unknown) => Result.gen(function* () {
      const row = yield* complete(input), id = yield* decodeId(row.id);
      const captured: JsonObject & Readonly<{ id: string }> = { ...row, id };
      return captured;
    });
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeOutputShape(input), output = [];
      for (const row of rows) output.push(yield* decodeRow(row));
      return output;
    });
    const decodeUpdateListOutput = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeOutputShape(input), output = [];
      for (const row of rows) {
        const selected = yield* projection(row), id = yield* decodeId(selected.id);
        output.push({ ...selected, id });
      }
      return output;
    });
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const tuple = yield* decodeLifecycleTuple(input);
      if (!jsonEqual(tuple[0], tuple[1].PricePreference ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      const rows = yield* decodeOutput(tuple[0]);
      const cascades: Record<string, object[]> = {};
      if (tuple[1].PricePreference !== undefined) cascades.PricePreference = rows.map(row => ({ ...row }));
      return [rows.map(row => ({ ...row })), cascades] satisfies [object[], Record<string, unknown[]>];
    });
    const updatePredicate = (input: unknown) => compileWhere(input, pricePreferenceUpdateWhere).pipe(Result.map(predicate =>
      ({ kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] } satisfies Predicate)));
    // Workflow hosts require a Schema; preserve the one complete DML verdict
    // used by repositories, native method results and logical call receipts.
    const Output = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }),
      [Schema.Record(Schema.String, Schema.Json)])).check(Schema.makeFilter(rows =>
      Result.isSuccess(decodeOutput(rows)) || "Expected complete native PricePreference rows"));
    const decodeUpsert = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeStorePreferenceUpsertShape(input);
      for (const row of rows) {
        yield* projection(row);
        if ("created_at" in row) yield* decodeRow(row);
      }
      return rows;
    });
    return { table, decodeRow, decodeOutput, Output, decodeUpsert, decodeUpdateListOutput, updatePredicate,
      decodeLifecycleResult, decodeDeletionOutput: decodePricePreferenceDeletionOutput };
  });
}

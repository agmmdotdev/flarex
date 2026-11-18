import { Result, Schema, type Effect } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileRowProjection } from "../../value/complete-row";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { commerceRelationReadQuery } from "../../query/relations";
import { compilePriceListCreationContracts } from "./list-input";
import { PriceListInput, PricingId } from "./input";
import type { capturePricingMetadata } from "./schema";

const Text = Schema.String.check(Schema.isMaxLength(256));
const Ids = Schema.Array(Text).check(Schema.isMaxLength(4));
const Rules = Schema.Record(Text, Schema.Array(Text).check(Schema.isMaxLength(defaultCommerceResources.queryRows)))
  .check(Schema.makeFilter(value => Object.keys(value).length <= defaultCommerceResources.queryRows));
const Fields = { id: Text, title: Schema.optionalKey(Text), description: Schema.optionalKey(Schema.NullOr(Text)),
  status: PriceListInput.fields.status, starts_at: PriceListInput.fields.starts_at, ends_at: PriceListInput.fields.ends_at };
/** Original inverse rules come from the complete selected native history, rather
 * than the smaller forward input envelope. Shared budgets still bound both. */
export const PriceListUpdatesInput = Schema.Array(Schema.Struct({ ...Fields, rules: Schema.optionalKey(Rules) }))
  .check(Schema.isMaxLength(4));
export const PriceListUpdateWorkflowInput = Schema.Struct({ price_lists_data: Schema.Array(Schema.Struct({ ...Fields,
  rules: PriceListInput.fields.rules })).check(Schema.isMaxLength(4)) });
const SelectedField = Schema.Literals(["id", "title", "description", "status", "starts_at", "ends_at",
  "price_list_rules.attribute", "price_list_rules.value"]);
export const PriceListUpdateReadConfig = Schema.Struct({ select: Schema.optionalKey(Schema.Array(SelectedField).check(Schema.isMaxLength(8))),
  relations: Schema.optionalKey(Schema.Array(Schema.Literal("price_list_rules")).check(Schema.isMaxLength(1))) });
export const PriceListUpdateReadInput = Schema.Struct({ filters: Schema.Struct({ id: Ids }), config: Schema.optionalKey(PriceListUpdateReadConfig) });
const decodeReadInput = commerceDecoder(PriceListUpdateReadInput, "invalidInput");
export const decodePriceListUpdateRead = (input: unknown) => decodeReadInput(input).pipe(Result.map(({ filters, config = {} }) => ({ filters, config })));
export const decodePriceListUpdate = commerceDecoder(PriceListUpdatesInput, "invalidInput");

export const NormalizedPriceListUpdateRule = Schema.Struct({ attribute: Text,
  value: Schema.Array(Text).check(Schema.isMaxLength(defaultCommerceResources.queryRows)) });
export const NormalizedPriceListUpdate = Schema.Struct({ ...Fields,
  rules_count: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: defaultCommerceResources.queryRows }))),
  price_list_rules: Schema.optionalKey(Schema.Array(NormalizedPriceListUpdateRule)
    .check(Schema.isMaxLength(defaultCommerceResources.queryRows))),
});
const decodeNativeRead = commerceDecoder(Schema.Struct({ where: Schema.Struct({ id: Ids }), options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(SelectedField).check(Schema.isMaxLength(8))),
  populate: Schema.Array(Schema.Literal("price_list_rules")).check(Schema.isMaxLength(1)),
  orderBy: Schema.Struct({ id: Schema.Literal("ASC") }),
}) }), "unsupportedProfile");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeChildren = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(defaultCommerceResources.queryRows)), "storedCorruption");
const decodeId = commerceDecoder(PricingId, "storedCorruption");
const ActionRows = Schema.Array(Schema.Struct({ id: PricingId })).pipe(Schema.mutable).check(Schema.isMaxLength(defaultCommerceResources.queryRows));
const decodeActions = commerceDecoder(Schema.Struct({ created: Schema.Struct({ PriceListRule: Schema.optionalKey(ActionRows) }),
  updated: Schema.Struct({ PriceList: Schema.optionalKey(ActionRows) }), deleted: Schema.Struct({ PriceListRule: Schema.optionalKey(ActionRows) }) }), "storedCorruption");
const childProjection: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage",
  selectableRelations: [], nested: new Map() };
const rootProjection: ProjectionPolicy = { ...childProjection, allowedPaths: ["price_list_rules"],
  selectableRelations: ["price_list_rules"], nested: new Map([["price_list_rules", childProjection]]) };
type IdentifiedRow = JsonObject & Readonly<{ id: string }>;
type ListRow = IdentifiedRow & Readonly<{ price_list_rules?: IdentifiedRow[] }>;

/** Checked metadata owns complete storage values and sparse native projections.
 * Native buildQuery owns ID deduplication and field/population normalization. */
export function compilePriceListUpdateContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const creation = yield* compilePriceListCreationContracts(metadata), { list, listRule } = creation.tables;
    const relation = describeToManyRelation(list, "price_list_rules", metadata.tables);
    if (relation?.join.type !== "hasMany" || relation.join.foreignKeys.length !== 1 || relation.join.foreignKeys[0] !== "price_list_id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map([[list.name, new Map([["price_list_rules", relation]])]]);
    const catalog = yield* makeReadCatalog([list, listRule].map(table => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: ["id"],
      foreignKeys: table.foreignKeys.flatMap(key => key.columns), companions: {} })), relations);
    const root = yield* compileRowProjection(list), child = yield* compileRowProjection(listRule);
    const identify = (row: JsonObject) => decodeId(row.id).pipe(Result.map(id => {
      const identified: IdentifiedRow = { ...row, id }; return identified;
    }));
    const decodeProjection = (input: unknown, update: boolean) => Result.gen(function* () {
      const rows: ListRow[] = [];
      for (const row of yield* decodeRows(input)) {
        const { price_list_rules, ...scalar } = row;
        // Projection decoding validates a subset without transforming its JSON
        // representation; retain the already captured object's definite values.
        yield* root(scalar);
        const selected = yield* identify(scalar);
        if (update && Object.keys(selected).some(key => !["id", "title", "description", "status", "starts_at", "ends_at", "rules_count"].includes(key)))
          return yield* Result.fail(commerceError("storedCorruption"));
        if (price_list_rules === undefined) { rows.push(selected); continue; }
        const rules: IdentifiedRow[] = [];
        for (const value of yield* decodeChildren(price_list_rules)) {
          yield* child(value);
          const rule = yield* identify(value);
          if (update && (typeof rule.attribute !== "string" || !Object.hasOwn(rule, "value") || rule.price_list_id !== selected.id ||
            Object.keys(rule).some(key => !["id", "attribute", "value", "price_list_id"].includes(key))))
            return yield* Result.fail(commerceError("storedCorruption"));
          rules.push(rule);
        }
        rows.push({ ...selected, price_list_rules: rules });
      }
      return rows;
    });
    const decodeReadOutput = (input: unknown) => decodeProjection(input, false);
    const decodeUpdateOutput = (input: unknown) => decodeProjection(input, true);
    const compileNativeReadPlan = (input: unknown) => Result.gen(function* () {
      const envelope = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeNativeRead));
      const { fields, populate } = envelope.options;
      if (fields !== undefined && !fields.includes("id")) return yield* Result.fail(commerceError("unsupportedProfile"));
      const projection = yield* compileProjection(catalog, list.name, fields, populate, rootProjection);
      const rootQuery = commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
        { kind: "in", column: "id", values: envelope.where.id }, { kind: "isNull", column: "deleted_at" }] }, "id", { includeIdentities: true });
      const ruleQuery = (rootIds: readonly string[]) => rootIds.length === 0 || !populate.includes("price_list_rules") ? undefined :
        commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [
          { kind: "in", column: "price_list_id", values: [...rootIds] }, { kind: "isNull", column: "deleted_at" }] },
        { kind: "storageInsertion", direction: "asc" }, { includeIdentities: true });
      return { rootQuery, ruleQuery, projection, paths: populate };
    });
    const compileReadPlan = (input: unknown) => Result.gen(function* () {
      const { filters, config = {} } = yield* decodePriceListUpdateRead(input);
      return yield* compileNativeReadPlan(buildQuery({ id: [...filters.id] }, {
        ...(config.select === undefined ? {} : { select: [...config.select] }),
        ...(config.relations === undefined ? {} : { relations: [...config.relations] }), order: { id: "ASC" } }));
    });
    const OutputShape = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId,
      price_list_rules: Schema.optionalKey(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }),
        [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(defaultCommerceResources.queryRows))) }),
      [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
    const UpdateOutput = OutputShape.check(Schema.makeFilter(rows => Result.isSuccess(decodeUpdateOutput(rows)) || "Expected sparse native PriceList update rows"));
    const ReadOutput = OutputShape.check(Schema.makeFilter(rows => Result.isSuccess(decodeReadOutput(rows)) || "Expected native PriceList read projections"));
    return { tables: { list, listRule }, catalog, relations, decodeListRow: creation.decodeListRow,
      decodeListRuleRow: creation.decodeListRuleRow, decodeReadOutput, decodeUpdateOutput, decodeActions, ReadOutput, UpdateOutput,
      compileNativeReadPlan, compileReadPlan };
  });
}

export type PriceListUpdateContracts = Result.Result.Success<ReturnType<typeof compilePriceListUpdateContracts>>;

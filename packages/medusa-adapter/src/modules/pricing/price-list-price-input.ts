import { Result, Schema, type Effect } from "effect";
import { describeToManyRelation } from "@medusajs/drizzle/relation-query";
import { PricingRuleOperator } from "@medusajs/framework/utils/portable";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { compileWhere, type WherePolicy, type ScalarFilter, type Predicate } from "../../query/predicate";
import { commerceRelationReadQuery, type CommerceRelation } from "../../query/relations";
import { makeReadCatalog } from "../../query/catalog";
import { compileProjection, type ProjectionPolicy } from "../../query/projection";
import { captureCommerceInput } from "../../value/input";
import { compilePriceListCreationContracts } from "./list-input";
import { compilePriceListUpdateContracts, PriceListUpdateReadInput } from "./list-update-input";
import { ListPriceInput, PricingId } from "./input";
import type { capturePricingMetadata } from "./schema";

const Text = Schema.String.check(Schema.isMaxLength(256));
const NumberValue = Schema.Number.check(Schema.isFinite());
const Quantity = Schema.optionalKey(Schema.NullOr(NumberValue));
const Fields = { currency_code: Text, amount: NumberValue, min_quantity: Quantity, max_quantity: Quantity,
  rules: ListPriceInput.fields.rules };
/** Retain omitted quantity keys: native hashing distinguishes omission and null. */
export const PriceListPriceCreationWorkflowInput = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Text,
  prices: Schema.Array(Schema.Struct({ ...Fields, variant_id: Text })).check(Schema.isMaxLength(2)),
})).check(Schema.isMaxLength(4)) });
export const AddPriceListPricesInput = Schema.Array(Schema.Struct({ price_list_id: Text,
  prices: Schema.Array(Schema.Struct({ ...Fields, price_set_id: Text })).check(Schema.isMaxLength(2)),
})).check(Schema.isMaxLength(4));
export const decodeAddPriceListPrices = commerceDecoder(AddPriceListPricesInput, "invalidInput");
export const PriceListPriceReadInput = Schema.Struct({ filters: PriceListUpdateReadInput.fields.filters,
  config: Schema.optionalKey(Schema.Struct({})) });
const decodeRead = commerceDecoder(PriceListPriceReadInput, "invalidInput");
export const decodePriceListPriceRead = (input: unknown) => decodeRead(input).pipe(Result.map(({ filters, config = {} }) => ({ filters, config })));
export const PriceListPriceRemovalIds = Schema.Array(Text).pipe(Schema.mutable).check(Schema.isMaxLength(8));
export const decodePriceListPriceRemovalIds = commerceDecoder(PriceListPriceRemovalIds, "invalidInput");
export const decodePriceListPricePhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: Text })).check(Schema.isMaxLength(8)),
}), "unsupportedProfile");

const Numeric = Schema.Union([Schema.String, NumberValue]);
const ManagedRule = { created_at: Schema.optionalKey(Schema.String), updated_at: Schema.optionalKey(Schema.String),
  deleted_at: Schema.optionalKey(Schema.Null) };
export const NormalizedPriceListPriceRule = Schema.Struct({ id: Schema.optionalKey(PricingId),
  attribute: Text, value: Text, operator: Schema.optionalKey(Schema.Literals(Object.values(PricingRuleOperator))),
  priority: Schema.optionalKey(NumberValue),
  price_id: Schema.optionalKey(PricingId), ...ManagedRule });
export const NormalizedPriceListPrice = Schema.Struct({ id: Schema.optionalKey(PricingId),
  price_set_id: Text, price_list_id: Text, currency_code: Text, amount: Numeric,
  min_quantity: Schema.optionalKey(Schema.NullOr(Numeric)), max_quantity: Schema.optionalKey(Schema.NullOr(Numeric)),
  rules_count: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: defaultCommerceResources.queryRows }))),
  price_rules: Schema.optionalKey(Schema.Array(NormalizedPriceListPriceRule).check(Schema.isMaxLength(defaultCommerceResources.queryRows))),
});
export const EncodedPriceListPrice = Schema.Struct({ ...NormalizedPriceListPrice.fields,
  raw_amount: Schema.optionalKey(ExactNumericRaw), raw_min_quantity: Schema.optionalKey(Schema.NullOr(ExactNumericRaw)),
  raw_max_quantity: Schema.optionalKey(Schema.NullOr(ExactNumericRaw)) });
// A declared empty raw rules record survives native normalization as an
// undeclared DML field. Preserve the existing typed refusal at this boundary.
export const decodeNormalizedPriceListPrice = commerceDecoder(NormalizedPriceListPrice, "invalidInput");
const decodeCandidateEnvelope = commerceDecoder(Schema.Struct({ where: Schema.Unknown, options: Schema.Struct({
  populate: Schema.Tuple([Schema.Literal("price_rules")]), orderBy: Schema.Struct({ id: Schema.Literal("ASC") }),
}) }), "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.Struct({ id: Schema.optionalKey(Schema.Unknown),
  price_list_id: Schema.optionalKey(Schema.Unknown), price_set_id: Schema.optionalKey(Schema.Unknown),
  currency_code: Schema.optionalKey(Schema.Unknown), min_quantity: Schema.optionalKey(Schema.Unknown), max_quantity: Schema.optionalKey(Schema.Unknown),
  $or: Schema.optionalKey(Schema.Unknown),
}), "unsupportedProfile");
const Membership = Schema.Union([Text, Schema.Array(Text).check(Schema.isMaxLength(8)),
  Schema.Struct({ $in: Schema.Array(Text).check(Schema.isMaxLength(8)) })]);
const decodeMembership = commerceDecoder(Membership, "unsupportedProfile");
const decodeText = (input: unknown) => decodeMembership(input).pipe(Result.map(value =>
  typeof value === "object" && "$in" in value ? value.$in : value));
const decodeQuantity = commerceDecoder(Schema.NullOr(NumberValue), "unsupportedProfile");
const quantityFilter = (column: string): ScalarFilter => ({ column, decodePredicate: input => decodeQuantity(input).pipe(
  Result.map((value): Predicate => value === null ? { kind: "isNull", column } : { kind: "numericIn", column, values: [value] }),
) });
const Constraint = Schema.Struct({ currency_code: Text, price_set_id: Text,
  min_quantity: Quantity, max_quantity: Quantity });
const decodeCandidateWhereShape = commerceDecoder(Schema.Union([
  Schema.Struct({ price_list_id: Membership, ...Constraint.fields }),
  Schema.Struct({ price_list_id: Membership, $or: Schema.Array(Constraint).check(Schema.isMaxLength(8)) }),
  Schema.Struct({ price_list_id: Schema.Tuple([]) }),
]), "unsupportedProfile");
const candidateWhere: WherePolicy = { decode: decodeWhere, fields: new Map<string, ScalarFilter>([
  ...["id", "price_list_id", "price_set_id", "currency_code"].map(column => [column, { column, decode: decodeText }] as const),
  ...["min_quantity", "max_quantity"].map(column => [column, quantityFilter(column)] as const),
]), logical: { decodeBranches: commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(8)), "unsupportedProfile"),
  nodes: 16, depth: 2, operands: 64, unwrapMembership: input => input } };
const decodeOutputRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");
const decodeChildren = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(defaultCommerceResources.queryRows)), "storedCorruption");
const decodeId = commerceDecoder(PricingId, "storedCorruption");
const decodeRaw = commerceDecoder(ExactNumericRaw, "storedCorruption");
const ActionRows = Schema.Array(Schema.Struct({ id: PricingId })).pipe(Schema.mutable).check(Schema.isMaxLength(defaultCommerceResources.queryRows));
const ActionModels = Schema.Struct({ Price: Schema.optionalKey(ActionRows), PriceRule: Schema.optionalKey(ActionRows) });
const decodeActions = commerceDecoder(Schema.Struct({ created: ActionModels, updated: ActionModels,
  deleted: Schema.Struct({ PriceRule: Schema.optionalKey(ActionRows) }) }), "storedCorruption");
type IdentifiedRow = JsonObject & Readonly<{ id: string }>;
type OutputRow = IdentifiedRow & Readonly<{ price_rules?: IdentifiedRow[] }>;

/** DML validates full stored rows before the native normalizer sees candidates;
 * the final native DTO is sparse and follows a separate checked projection. */
export function compilePriceListPriceCreationContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const creation = yield* compilePriceListCreationContracts(metadata), listReadContracts = yield* compilePriceListUpdateContracts(metadata);
    const { list, price, rule } = creation.tables;
    const relation = describeToManyRelation(price, "price_rules", metadata.tables);
    const set = metadata.tables.find(table => table.name === "price_set");
    if (!set || relation?.join.type !== "hasMany" || relation.join.foreignKeys.length !== 1 || relation.join.foreignKeys[0] !== "price_id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const setForeign = price.foreignKeys.find(key => key.referencedTable === set.name);
    if (setForeign?.columns.length !== 1 || setForeign.columns[0] !== "price_set_id" ||
      setForeign.referencedColumns.length !== 1 || setForeign.referencedColumns[0] !== "id")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const relations = new Map([[price.name, new Map<string, CommerceRelation>([["price_rules", relation], ["price_set", {
      name: "price_set", sourcePrimaryKeys: ["id"], targetTable: set.name, targetPrimaryKeys: ["id"],
      join: { type: "belongsTo", foreignKeys: ["price_set_id"] },
    }]])]]);
    const decodeSetRow = yield* compileCompleteRow(set);
    const catalog = yield* makeReadCatalog([price, rule, set].map(table => ({ name: table.name,
      columns: table.columns.map(column => column.name), primaryKeys: ["id"], foreignKeys: table.foreignKeys.flatMap(key => key.columns),
      companions: Object.fromEntries(table.columns.filter(column => column.type === "bigNumber").map(column => [column.name, "raw_" + column.name])),
    })), relations);
    const scalarPolicy: ProjectionPolicy = { keys: "retain", storageKeys: "last", joinKeys: "storage", selectableRelations: [], nested: new Map() };
    const projection = yield* compileProjection(catalog, price.name, undefined, ["price_rules"],
      { ...scalarPolicy, allowedPaths: ["price_rules"], selectableRelations: ["price_rules"], nested: new Map([["price_rules", scalarPolicy]]) });
    const priceProjection = yield* compileRowProjection(price), ruleProjection = yield* compileRowProjection(rule);
    const identify = (row: JsonObject) => decodeId(row.id).pipe(Result.map(id => { const value: IdentifiedRow = { ...row, id }; return value; }));
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const output: OutputRow[] = [];
      for (const value of yield* decodeOutputRows(input)) {
        const { price_rules, ...scalar } = value;
        yield* priceProjection(scalar);
        const row = yield* identify(scalar);
        for (const name of ["amount", "min_quantity", "max_quantity"]) if (row[name] !== undefined && row[name] !== null)
          yield* decodeRaw(row["raw_" + name]);
        if (price_rules === undefined) { output.push(row); continue; }
        const children: IdentifiedRow[] = [];
        for (const inputRule of yield* decodeChildren(price_rules)) {
          yield* ruleProjection(inputRule);
          const child = yield* identify(inputRule);
          children.push(child);
        }
        output.push({ ...row, price_rules: children });
      }
      return output;
    });
    const compileNativeCandidatePlan = (input: unknown) => Result.gen(function* () {
      const envelope = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeCandidateEnvelope));
      const where = yield* decodeCandidateWhereShape(envelope.where), predicate = yield* compileWhere(where, candidateWhere);
      const constraints = "$or" in where ? where.$or : "price_set_id" in where ? [where] : [];
      const setPredicate = { kind: "and", children: [
        { kind: "in", column: "id", values: [...new Set(constraints.map(row => row.price_set_id))] },
        { kind: "isNull", column: "deleted_at" },
      ] };
      return { setPredicate, setQuery: commerceRelationReadQuery(defaultCommerceResources, setPredicate),
      rootQuery: (activeSetMembership: JsonObject) => commerceRelationReadQuery(defaultCommerceResources, { kind: "and", children: [predicate,
        { kind: "isNull", column: "deleted_at" }, activeSetMembership] }, "id", { includeIdentities: true }),
      ruleQuery: (ids: readonly string[]) => ids.length === 0 ? undefined : commerceRelationReadQuery(defaultCommerceResources,
        { kind: "and", children: [{ kind: "in", column: "price_id", values: [...new Set(ids)] }, { kind: "isNull", column: "deleted_at" }] },
        "id", { includeIdentities: true }), projection, paths: ["price_rules"] };
    });
    const Output = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }), [Schema.Record(Schema.String, Schema.Json)]))
      .check(Schema.isMaxLength(8), Schema.makeFilter(rows => Result.isSuccess(decodeOutput(rows)) || "Expected sparse native PriceList Price DTOs"));
    return { tables: { list, price, rule, set }, relations, catalog, listReadContracts, projection,
      decodeListRow: creation.decodeListRow, decodePriceRow: creation.decodePriceRow, decodePriceRuleRow: creation.decodePriceRuleRow, decodeSetRow,
      decodeOutput, decodeActions, Output, compileNativeCandidatePlan };
  });
}
export type PriceListPriceCreationContracts = Result.Result.Success<ReturnType<typeof compilePriceListPriceCreationContracts>>;

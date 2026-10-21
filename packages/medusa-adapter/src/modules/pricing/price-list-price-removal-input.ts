import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { compileCompleteRow } from "../../value/complete-row";
import { compileWhere, type WherePolicy } from "../../query/predicate";
import { commerceRelationReadQuery, type CommerceRelation } from "../../query/relations";
import { compilePriceListCreationContracts } from "./list-input";
import { PriceListPriceRemovalIds } from "./price-list-price-input";
import { PricingId } from "./input";
import type { capturePricingMetadata } from "./schema";

export { decodePriceListPriceRemovalIds } from "./price-list-price-input";
export const PriceListPriceRemovalWorkflowInput = Schema.Struct({ ids: PriceListPriceRemovalIds });
export const decodePriceListPriceRemovalLifecycleArguments = commerceDecoder(Schema.Tuple([PriceListPriceRemovalIds]), "invalidInput");
export const PriceListPriceRemovalReadInput = Schema.Struct({ filters: Schema.Struct({ id: PriceListPriceRemovalIds }),
  config: Schema.Struct({ relations: Schema.Tuple([Schema.Literal("price_list")]) }) });
export const decodePriceListPriceRemovalRead = commerceDecoder(PriceListPriceRemovalReadInput, "invalidInput");
const decodeWhere = commerceDecoder(PriceListPriceRemovalReadInput.fields.filters, "unsupportedProfile");
const decodeIds = commerceDecoder(PriceListPriceRemovalIds, "unsupportedProfile");
const where: WherePolicy = { decode: decodeWhere, fields: new Map([["id", { column: "id", decode: decodeIds }]]) };
const decodeEnvelope = commerceDecoder(Schema.Struct({ where: PriceListPriceRemovalReadInput.fields.filters,
  options: Schema.Struct({ populate: Schema.Tuple([Schema.Literal("price_list")]),
    orderBy: Schema.Struct({ id: Schema.Literal("ASC") }) }) }), "unsupportedProfile");
const decodeRows = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(8)), "storedCorruption");
const decodeReferences = commerceDecoder(Schema.Struct({ price_set: Schema.Struct({ id: PricingId }),
  price_list: Schema.NullOr(Schema.JsonObject) }), "storedCorruption");
const LifecycleRows = Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(defaultCommerceResources.queryRows));
const decodeLifecycleTuple = commerceDecoder(Schema.Tuple([
  LifecycleRows.check(Schema.isMaxLength(8)), Schema.Struct({
    Price: Schema.optionalKey(LifecycleRows.check(Schema.isMaxLength(8))), PriceRule: Schema.optionalKey(LifecycleRows),
  }),
]), "storedCorruption");
const LifecycleOutput = Schema.Struct({
  price_id: Schema.optionalKey(Schema.Array(PricingId).check(Schema.isMaxLength(8))),
  price_rule_id: Schema.optionalKey(Schema.Array(PricingId).check(Schema.isMaxLength(defaultCommerceResources.queryRows))),
});
const decodeLifecycleOutput = commerceDecoder(LifecycleOutput, "storedCorruption");

/** Original listPrices selects Prices, rather than Lists. Complete DML values
 * remain authoritative before native nullable relation presentation. */
export function compilePriceListPriceRemovalContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const base = yield* compilePriceListCreationContracts(metadata);
    const { price, list } = base.tables, set = metadata.tables.find(table => table.name === "price_set");
    if (set === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const decodeSetRow = yield* compileCompleteRow(set);
    const families = [
      { table: price, model: "Price", linkableKey: "price_id", maximum: 8, decodeRow: base.decodePriceRow },
      { table: base.tables.rule, model: "PriceRule", linkableKey: "price_rule_id", maximum: defaultCommerceResources.queryRows, decodeRow: base.decodePriceRuleRow },
    ] as const;
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const [rawRoots, groups] = yield* decodeLifecycleTuple(input), roots: JsonObject[] = [], cascades: Record<string, JsonObject[]> = {};
      for (const row of rawRoots) roots.push(yield* base.decodePriceRow(row));
      for (const family of families) {
        const group = groups[family.model];
        if (group === undefined) continue;
        const rows: JsonObject[] = [];
        for (const row of group) rows.push(yield* family.decodeRow(row));
        cascades[family.model] = rows;
      }
      if (!jsonEqual(roots, cascades.Price ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      return [roots, cascades] satisfies [JsonObject[], Record<string, JsonObject[]>];
    });
    const members = new Map<string, CommerceRelation>();
    for (const [name, target, foreignKey, nullable] of [["price_list", list, "price_list_id", true],
      ["price_set", set, "price_set_id", false]] as const) {
      const key = price.foreignKeys.find(key => key.referencedTable === target.name);
      if (key?.columns.length !== 1 || key.columns[0] !== foreignKey || key.referencedColumns.length !== 1 || key.referencedColumns[0] !== "id" ||
        price.columns.find(column => column.name === foreignKey)?.nullable !== nullable)
        return yield* Result.fail(commerceError("unsupportedProfile"));
      members.set(name, { name, sourcePrimaryKeys: ["id"], targetTable: target.name,
        targetPrimaryKeys: ["id"], join: { type: "belongsTo", foreignKeys: [foreignKey] } });
    }
    const relations = new Map([[price.name, members]]);
    const decodeReadOutput = (input: unknown) => Result.gen(function* () {
      const captured = yield* captureCommerceInput(input).pipe(Result.mapError(cause => commerceError("storedCorruption", cause)));
      const output: JsonObject[] = [];
      for (const inputRow of yield* decodeRows(captured)) {
        const { price_set, price_list, ...scalar } = inputRow;
        const row = yield* base.decodePriceRow(scalar);
        const reference = yield* decodeReferences({ price_set, price_list });
        if (row.deleted_at !== null || reference.price_set.id !== row.price_set_id)
          return yield* Result.fail(commerceError("storedCorruption"));
        if (reference.price_list === null) {
          if (row.price_list_id !== null) return yield* Result.fail(commerceError("storedCorruption"));
        } else {
          const populated = yield* base.decodeListRow(reference.price_list);
          if (populated.id !== row.price_list_id || populated.deleted_at !== null)
            return yield* Result.fail(commerceError("storedCorruption"));
        }
        output.push({ ...row, ...reference });
      }
      return output;
    });
    const compileNativeReadPlan = (input: unknown) => Result.gen(function* () {
      const envelope = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeEnvelope));
      const predicate = yield* compileWhere(envelope.where, where);
      const active = { kind: "and", children: [predicate, { kind: "isNull", column: "deleted_at" }] };
      return { rootQuery: (membership?: JsonObject) => commerceRelationReadQuery(defaultCommerceResources,
        membership === undefined ? active : { kind: "and", children: [active, membership] }, "id", { includeIdentities: true }),
        setPredicate: (ids: readonly string[]) => ({ kind: "and", children: [
          { kind: "in", column: "id", values: [...ids] }, { kind: "isNull", column: "deleted_at" }] }),
      };
    });
    return { ...base, tables: { ...base.tables, set }, relations, decodeSetRow, decodeReadOutput, compileNativeReadPlan,
      families, decodeLifecycleResult, decodeOutput: decodeLifecycleOutput, Output: LifecycleOutput };
  });
}
export type PriceListPriceRemovalContracts = Result.Result.Success<ReturnType<typeof compilePriceListPriceRemovalContracts>>;

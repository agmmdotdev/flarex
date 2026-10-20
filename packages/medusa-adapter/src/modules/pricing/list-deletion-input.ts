import { Result, Schema, type Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compilePriceListCreationContracts, PriceListDeletionIds } from "./list-input";
import { PricingId } from "./input";
import type { capturePricingMetadata } from "./schema";

export const PriceListDeletionWorkflowInput = Schema.Struct({ ids: PriceListDeletionIds });
const rows = Schema.Array(Schema.JsonObject);
const lifecycleTuple = commerceDecoder(Schema.Tuple([rows.check(Schema.isMaxLength(4)), Schema.Struct({
  PriceList: Schema.optionalKey(rows.check(Schema.isMaxLength(4))), Price: Schema.optionalKey(rows),
  PriceListRule: Schema.optionalKey(rows), PriceRule: Schema.optionalKey(rows),
})]), "storedCorruption");
const OutputShape = Schema.Struct({
  price_list_id: Schema.optionalKey(Schema.Array(PricingId).check(Schema.isMaxLength(4))),
  price_id: Schema.optionalKey(Schema.Array(PricingId)),
  PriceListRule: Schema.optionalKey(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: PricingId }), [Schema.Record(Schema.String, Schema.Json)]))),
  price_rule_id: Schema.optionalKey(Schema.Array(PricingId)),
});
const decodeOutputShape = commerceDecoder(OutputShape, "storedCorruption");

/** Deletion and restoration own current complete history, rather than the
 * creation graph's two-child input shape. Reuse its checked scalar DML owners. */
export function compilePriceListDeletionContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const complete = yield* compilePriceListCreationContracts(metadata), { list, price, listRule, rule } = complete.tables;
    const families = [
      { table: list, model: "PriceList", linkableKey: "price_list_id", maximum: 4, decodeRow: complete.decodeListRow },
      { table: price, model: "Price", linkableKey: "price_id", maximum: defaultCommerceResources.queryRows, decodeRow: complete.decodePriceRow },
      { table: listRule, model: "PriceListRule", linkableKey: "PriceListRule", maximum: defaultCommerceResources.queryRows, decodeRow: complete.decodeListRuleRow },
      { table: rule, model: "PriceRule", linkableKey: "price_rule_id", maximum: defaultCommerceResources.queryRows, decodeRow: complete.decodePriceRuleRow },
    ] as const;
    const decodeLifecycleResult = (input: unknown) => Result.gen(function* () {
      const [rawRoots, rawGroups] = yield* lifecycleTuple(input), roots: JsonObject[] = [], cascades: Record<string, JsonObject[]> = {};
      for (const row of rawRoots) roots.push(yield* complete.decodeListRow(row));
      for (const family of families) {
        const group = rawGroups[family.model];
        if (group === undefined) continue;
        const decoded: JsonObject[] = [];
        for (const row of group) decoded.push(yield* family.decodeRow(row));
        cascades[family.model] = decoded;
      }
      if (!jsonEqual(roots, cascades.PriceList ?? [])) return yield* Result.fail(commerceError("storedCorruption"));
      return [roots, cascades] satisfies [JsonObject[], Record<string, JsonObject[]>];
    });
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const map = yield* decodeOutputShape(input);
      if (map.PriceListRule === undefined) return map;
      const rules: Result.Result.Success<ReturnType<typeof complete.decodeListRuleRow>>[] = [];
      for (const row of map.PriceListRule) rules.push(yield* complete.decodeListRuleRow(row));
      return { ...map, PriceListRule: rules };
    });
    const Output = OutputShape.check(Schema.makeFilter(value => Result.isSuccess(decodeOutput(value)) || "Expected complete native PriceList lifecycle result map"));
    return { tables: complete.tables, families, decodeLifecycleResult, decodeOutput, Output };
  });
}
export type PriceListDeletionContracts = Result.Result.Success<ReturnType<typeof compilePriceListDeletionContracts>>;

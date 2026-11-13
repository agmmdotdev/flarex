import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileWhere, type ScalarFilter, type WherePolicy } from "../../query/predicate";
import { scalarIdWhere, ScalarId } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { preparePromotionActiveFilter, preparePromotionComputeQuery, replayPromotionActiveFilterClock } from "./compute-query";

export type PromotionUsageTable = "promotion" | "promotion_campaign_budget" | "promotion_campaign_budget_usage";
export const promotionUsagePaths = ["campaign", "campaign.budget", "campaign.budget.usages"] as const;
const envelope = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), populate: Schema.Array(Schema.String),
  limit: Schema.optionalKey(Schema.Number), offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.Struct({ id: Schema.Literal("ASC") }),
}) }), "unsupportedProfile");
const attributeWhere: WherePolicy = { decode: commerceDecoder(Schema.Struct({ budget_id: ScalarId, attribute_value: Schema.String }), "unsupportedProfile"),
  fields: new Map<string, ScalarFilter>([["budget_id", { column: "budget_id", decode: commerceDecoder(ScalarId, "unsupportedProfile") }],
    ["attribute_value", { column: "attribute_value", decode: commerceDecoder(Schema.String, "unsupportedProfile") }]]) };

/** Only native register/revert, internal keyed updates and the existing Cart
 * Promotion graph ABI enter this profile. Usage does not request value sorting. */
export function preparePromotionUsageQuery(table: PromotionUsageTable, input: unknown) {
  return Result.gen(function* () {
    const value = yield* captureCommerceInput(input).pipe(Result.flatMap(envelope));
    if (table === "promotion" && value.options.limit !== undefined)
      return yield* preparePromotionComputeQuery(table, input);
    if (value.options.fields !== undefined || value.options.limit !== undefined || value.options.offset !== undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const paths = value.options.populate;
    if (table === "promotion" && value.where.status === "active") {
      if (paths.length !== 2 && paths.length !== 3 || paths.some((path, index) => path !== promotionUsagePaths[index]))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      return { value, active: true as const, graph: false as const, ...yield* preparePromotionActiveFilter(value.where) };
    }
    if (table === "promotion_campaign_budget_usage" && Object.hasOwn(value.where, "budget_id")) {
      if (paths.length > 1 || paths.some(path => path !== "budget")) return yield* Result.fail(commerceError("unsupportedProfile"));
      return { value, active: false as const, graph: false as const, predicate: yield* compileWhere(value.where, attributeWhere) };
    }
    if (paths.length) return yield* Result.fail(commerceError("unsupportedProfile"));
    return { value, active: false as const, graph: false as const, predicate: yield* compileWhere(value.where, scalarIdWhere) };
  });
}

/** Retain the actual native query clock without replacing its live clock. */
export function replayPromotionUsageQueryClock(input: unknown, retained: string) {
  return Result.gen(function* () {
    const value = yield* captureCommerceInput(input).pipe(Result.flatMap(envelope));
    if (value.where.status !== "active") return value;
    return { ...value, where: yield* replayPromotionActiveFilterClock(value.where, retained) };
  });
}

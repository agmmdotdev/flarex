import { Effect, Result, Schema } from "effect";
import { commerceError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileWhere, type Predicate, type ScalarFilter, type WherePolicy } from "../../query/predicate";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { captureNativeDateRecord, captureNativeRecord } from "../../value/native-record";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Membership = Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(256)),
  Schema.Struct({ $in: Schema.Array(Id).check(Schema.isMaxLength(256)) })]);
const decodeMembership = commerceDecoder(Membership, "unsupportedProfile");
const decodeCodeMembership = commerceDecoder(Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256)),
  Schema.Struct({ $in: Schema.Array(Schema.String).check(Schema.isMaxLength(256)) })]), "unsupportedProfile");
const RootFields = { id: Schema.optionalKey(Schema.Unknown), code: Schema.optionalKey(Schema.Unknown),
  is_automatic: Schema.optionalKey(Schema.Boolean), $or: Schema.optionalKey(Schema.Unknown), $and: Schema.optionalKey(Schema.Unknown) };
const logical = { decodeBranches: commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(commerceLimits.filterNodes)), "unsupportedProfile"),
  nodes: commerceLimits.filterNodes, depth: commerceLimits.filterDepth, operands: commerceLimits.filterOperands,
  unwrapMembership: (input: unknown) => input };
const scalar = (column: string, decode = decodeMembership): ScalarFilter => ({ column, decode: input => Result.gen(function* () {
  const value = yield* decode(input);
  return typeof value === "string" ? value : "$in" in value ? value.$in : value;
}) });
const rootWhere: WherePolicy = { decode: commerceDecoder(Schema.Struct(RootFields), "unsupportedProfile"), logical,
  fields: new Map<string, ScalarFilter>([["id", scalar("id")], ["code", scalar("code", decodeCodeMembership)],
    ["is_automatic", { column: "is_automatic", decode: commerceDecoder(Schema.Boolean, "unsupportedProfile") }]]) };
const usageWhere: WherePolicy = { decode: commerceDecoder(Schema.Struct({ budget_id: Id, attribute_value: Schema.String }), "unsupportedProfile"),
  fields: new Map<string, ScalarFilter>([["budget_id", scalar("budget_id")],
    ["attribute_value", { column: "attribute_value", decode: commerceDecoder(Schema.String, "unsupportedProfile") }]]) };
const dates = Schema.Struct({ $and: Schema.Tuple([
  Schema.Struct({ $or: Schema.Tuple([Schema.Struct({ starts_at: Schema.Null }), Schema.Struct({ starts_at: Schema.Struct({ $lte: Schema.String }) })]) }),
  Schema.Struct({ $or: Schema.Tuple([Schema.Struct({ ends_at: Schema.Null }), Schema.Struct({ ends_at: Schema.Struct({ $gt: Schema.String }) })]) }),
]) });
const decodeActive = commerceDecoder(Schema.Struct({ status: Schema.Literal("active"), $or: Schema.Tuple([
  Schema.Struct({ campaign_id: Schema.Null, ...RootFields }), Schema.Struct({ ...RootFields, campaign: dates }),
]) }), "unsupportedProfile");
export const promotionComputePaths = ["application_method", "application_method.target_rules", "application_method.target_rules.values",
  "application_method.buy_rules", "application_method.buy_rules.values", "rules", "rules.values", "campaign", "campaign.budget"] as const;
const decodeEnvelope = commerceDecoder(Schema.Struct({ where: Schema.JsonObject, options: Schema.Struct({
  fields: Schema.optionalKey(Schema.Array(Schema.String)), populate: Schema.Array(Schema.String),
  limit: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 256 }))),
  offset: Schema.optionalKey(Schema.Literal(0)),
  orderBy: Schema.Union([Schema.Struct({ id: Schema.Literal("ASC") }), Schema.Struct({ application_method: Schema.Struct({ value: Schema.Literal("DESC") }) })]),
}) }), "unsupportedProfile");

/** Only the genuine active query's two Date leaves accept native Date values.
 * Other values retain ordinary descriptor/JSON capture and bounded decoding. */
export const capturePromotionComputeQuery = Effect.fn("Promotion.captureComputeQuery")(function* (input: unknown) {
  const envelope = yield* captureNativeRecord(input), where = yield* captureNativeRecord(envelope.where);
  if (where.status !== "active") return envelope;
  const pair = yield* capturePair(where.$or), first = yield* captureNativeRecord(pair[0]), second = yield* captureNativeRecord(pair[1]);
  const campaign = yield* captureNativeRecord(second.campaign), conditions = yield* capturePair(campaign.$and), normalized: Record<string, unknown>[] = [];
  for (const [index, name, operator] of [[0, "starts_at", "$lte"], [1, "ends_at", "$gt"]] as const) {
    const condition = yield* captureNativeRecord(conditions[index]), branches = yield* capturePair(condition.$or);
    const absent = yield* captureNativeRecord(branches[0]), present = yield* captureNativeRecord(branches[1]);
    present[name] = yield* captureNativeDateRecord(present[name], [operator]);
    normalized.push({ ...condition, $or: [absent, present] });
  }
  return { ...envelope, where: { ...where, $or: [first, { ...second, campaign: { ...campaign, $and: normalized } }] } };
});
const capturePair = Effect.fn("Promotion.captureQueryPair")(function* (input: unknown) {
  const pair = yield* Effect.try({ try: () => {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) throw commerceError("unsupportedProfile");
    const length = Object.getOwnPropertyDescriptor(input, "length"), first = Object.getOwnPropertyDescriptor(input, "0"), second = Object.getOwnPropertyDescriptor(input, "1");
    if (Reflect.ownKeys(input).length !== 3 || length?.value !== 2 ||
      !first?.enumerable || !second?.enumerable || !("value" in first) || !("value" in second))
      throw commerceError("unsupportedProfile");
    return [first.value, second.value] satisfies [unknown, unknown];
  }, catch: cause => commerceError("unsupportedProfile", cause) });
  return pair;
});

export function preparePromotionComputeQuery(table: "promotion" | "promotion_campaign_budget_usage", input: unknown) {
  return Result.gen(function* () {
    const value = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeEnvelope));
    // Native public graph calls carry a finite count/page window. Their
    // explicit select suppresses the service's default application_method.
    const graph = table === "promotion" && value.options.limit !== undefined;
    if (!graph && (value.options.limit !== undefined || value.options.offset !== undefined))
      return yield* Result.fail(commerceError("unsupportedProfile"));
    if (graph) {
      if (!("id" in value.options.orderBy) || value.options.populate.length || !value.options.fields?.length || value.options.fields.some(field => field !== "id" && field !== "code"))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      return { value, active: false as const, graph: true as const, predicate: yield* compileWhere(value.where, rootWhere) };
    }
    if (table === "promotion_campaign_budget_usage") {
      if (value.options.fields !== undefined || value.options.populate.length || !("id" in value.options.orderBy))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      return { value, active: false as const, graph: false as const, predicate: yield* compileWhere(value.where, usageWhere) };
    }
    if ("application_method" in value.options.orderBy) {
      if (value.options.fields !== undefined || value.options.populate.length !== promotionComputePaths.length ||
        value.options.populate.some((path, index) => path !== promotionComputePaths[index]))
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const filters = yield* decodeActive(value.where), [absent, present] = filters.$or;
      const { campaign_id: _absent, ...candidateA } = absent, { campaign, ...candidateB } = present;
      const left = yield* compileWhere(candidateA, rootWhere), right = yield* compileWhere(candidateB, rootWhere);
      const start = campaign.$and[0].$or[1].starts_at.$lte, end = campaign.$and[1].$or[1].ends_at.$gt;
      if (start !== end)
        return yield* Result.fail(commerceError("unsupportedProfile"));
      const campaignPredicate: Predicate = { kind: "and", children: [{ kind: "isNull", column: "deleted_at" },
        { kind: "or", children: [{ kind: "isNull", column: "starts_at" }, { kind: "lessThan", column: "starts_at", value: start }, { kind: "in", column: "starts_at", values: [start] }] },
        { kind: "or", children: [{ kind: "isNull", column: "ends_at" }, { kind: "greaterThan", column: "ends_at", value: end }] },
      ] };
      return { value, active: true as const, graph: false as const, candidateA: left, candidateB: right, campaignPredicate, nativeNow: start };
    }
    if (value.options.populate.length || value.options.fields?.join("\0") !== "id\0code")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return { value, active: false as const, graph: false as const, predicate: yield* compileWhere(value.where, rootWhere) };
  });
}

/** Receipt reconstruction retains only the two actual native clock leaves.
 * This does not run in the live service or expose a configurable business clock. */
export function replayPromotionComputeQueryClock(input: unknown, retained: string) {
  return Result.gen(function* () {
    const value = yield* captureCommerceInput(input).pipe(Result.flatMap(decodeEnvelope));
    if (!("application_method" in value.options.orderBy)) return value;
    const filters = yield* decodeActive(value.where), [absent, present] = filters.$or;
    const { campaign, ...candidate } = present;
    return { ...value, where: { ...filters, $or: [absent, { ...candidate, campaign: { ...campaign, $and: [
      { $or: [{ starts_at: null }, { starts_at: { $lte: retained } }] },
      { $or: [{ ends_at: null }, { ends_at: { $gt: retained } }] },
    ] } }] } };
  });
}

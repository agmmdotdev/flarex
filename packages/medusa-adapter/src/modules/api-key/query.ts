import { Result, Schema } from "effect";
import { commerceError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import type { Predicate, ScalarFilter, WherePolicy } from "../../query/predicate";
import { ApiKeyId, ApiKeyIds } from "./contracts";

const decodeIds = commerceDecoder(Schema.Union([ApiKeyId, ApiKeyIds]), "unsupportedProfile");
const decodeType = commerceDecoder(Schema.Literals(["publishable", "secret"]), "unsupportedProfile");
const decodeRevocation = commerceDecoder(Schema.Union([
  Schema.Null, Schema.Struct({ $eq: Schema.Null }),
  Schema.Struct({ $gt: Schema.String }), Schema.Struct({ $lt: Schema.String }),
]), "unsupportedProfile");

/** These are the genuine native validation predicates, including the secret
 * key check performed while revoking publishable keys. Shared storage owns
 * timestamp comparison and indexed candidate bounds. */
export const apiKeyWhere: WherePolicy = {
  decode: commerceDecoder(Schema.Struct({ id: Schema.optionalKey(Schema.Unknown),
    type: Schema.optionalKey(Schema.Unknown), revoked_at: Schema.optionalKey(Schema.Unknown),
    $or: Schema.optionalKey(Schema.Unknown), $and: Schema.optionalKey(Schema.Unknown),
  }), "unsupportedProfile"),
  fields: new Map<string, ScalarFilter>([
    ["id", { column: "id", decode: decodeIds }],
    ["type", { column: "type", decode: decodeType }],
    ["revoked_at", { column: "revoked_at", decodePredicate: input => Result.gen(function* () {
      const value = yield* decodeRevocation(input);
      if (value === null || "$eq" in value) return { kind: "isNull", column: "revoked_at" } satisfies Predicate;
      const instant = yield* Result.try({ try: () => new Date("$lt" in value ? value.$lt : value.$gt).toISOString(),
        catch: cause => commerceError("invalidInput", cause) });
      return { kind: "$lt" in value ? "lessThan" : "greaterThan", column: "revoked_at", value: instant } satisfies Predicate;
    }) }],
  ]),
  logical: { decodeBranches: commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(commerceLimits.filterNodes)), "unsupportedProfile"),
    nodes: commerceLimits.filterNodes, depth: commerceLimits.filterDepth, operands: commerceLimits.filterOperands,
    unwrapMembership: input => input },
};

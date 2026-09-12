import { describe, expect, it } from "vitest";
import { Result, Schema } from "effect";
import { commerceDecoder } from "../src/commerce-decoder";
import { compileWhere, type WherePolicy } from "../src/query/predicate";
import { commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";

const text = commerceDecoder(Schema.String, "unsupportedProfile");
const policy: WherePolicy = {
  decode: commerceDecoder(Schema.JsonObject, "unsupportedProfile"),
  fields: new Map([
    ["product_id", { column: "left_key", decode: text }],
    ["shipping_profile_id", { column: "right_key", decode: text, decodeNotEqual: text }],
  ]),
  logical: { decodeBranches: commerceDecoder(Schema.Array(Schema.JsonObject), "unsupportedProfile"),
    nodes: commerceLimits.filterNodes, depth: commerceLimits.filterDepth, operands: commerceLimits.filterOperands,
    unwrapMembership: input => input,
  },
};

describe("explicit shared text inequality", () => {
  it("compiles the native shipping-profile cardinality query using renamed storage columns", () => {
    expect(Result.getOrThrow(compileWhere({ $or: [{ shipping_profile_id: { $ne: "sp-new" }, product_id: "prod-one" }] }, policy)))
      .toEqual({ kind: "and", children: [{ kind: "or", children: [{ kind: "and", children: [
        { kind: "textNotEqual", column: "right_key", value: "sp-new" },
        { kind: "in", column: "left_key", values: ["prod-one"] },
      ] }] }] });
  });

  it("does not widen undeclared fields or accept malformed operator envelopes", () => {
    for (const input of [
      { product_id: { $ne: "p" } }, { shipping_profile_id: { $ne: null } },
      { shipping_profile_id: { $ne: ["s"] } }, { shipping_profile_id: { $ne: "s", $in: ["s"] } },
      { shipping_profile_id: { $in: { $ne: "s" } } }, { shipping_profile_id: { $ne: "s", extra: true } },
    ]) expect(Result.match(compileWhere(input, policy), {
      onFailure: error => error.reason, onSuccess: () => "unexpected success",
    })).toBe("unsupportedProfile");
  });

  it("charges inequality before decoding the next operand and retains node/depth limits", () => {
    const leaf = { shipping_profile_id: { $ne: "s" } };
    expect(Result.isSuccess(compileWhere(leaf, { ...policy, logical: { ...policy.logical!, operands: 1 } }))).toBe(true);
    for (const input of [{ $and: [leaf, { product_id: 3 }] }, { $or: Array.from({ length: 64 }, () => leaf) }]) {
      expect(Result.match(compileWhere(input, { ...policy, logical: { ...policy.logical!, operands: 1 } }), {
        onFailure: error => error.reason, onSuccess: () => "unexpected success",
      })).toBe("limitExceeded");
    }
  });
});

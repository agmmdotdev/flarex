import { Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";
import { QueryLimit, QueryOffset } from "./query-decoder";
import type { WherePolicy } from "./query/predicate";

/** The bounded ID-only native read profile used by the Inventory children. */
export const ScalarId = Schema.String.check(Schema.isLengthBetween(1, 256));
const strings = commerceDecoder(Schema.Union([ScalarId, Schema.Array(ScalarId).check(Schema.isMaxLength(8))]), "unsupportedProfile");
export const scalarIdWhere: WherePolicy = { decode: commerceDecoder(Schema.JsonObject, "unsupportedProfile"),
  fields: new Map([["id", { column: "id", decode: strings }]]),
  selectors: { mode: "membership", key: "id", decode: commerceDecoder(Schema.Array(Schema.Struct({ id: ScalarId })), "unsupportedProfile") },
};
export const ScalarIdRead = Schema.Struct({ filters: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Union([ScalarId, Schema.Array(ScalarId)])) })),
  config: Schema.optionalKey(Schema.Struct({ select: Schema.optionalKey(Schema.Array(Schema.String)), relations: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(0))),
    take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(QueryOffset), order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })) })),
});
